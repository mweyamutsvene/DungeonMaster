/**
 * AttackHandlers — attack target resolution, distance enrichment, and attack
 * action handling.
 *
 * Extracted from ActionDispatcher (Phase: God-Module Decomposition §2c).
 */

import { ValidationError } from "../../../../errors.js";
import { calculateDistance } from "../../../../../domain/rules/movement.js";
import type { CombatMap } from "../../../../../domain/rules/combat-map.js";
import { getCoverLevel, getCoverACBonus } from "../../../../../domain/rules/combat-map.js";
import {
  getPosition,
  normalizeResources,
  canMakeAttack,
  setAttacksAllowed,
  getAttacksAllowedThisTurn,
  getResourcePools,
  readBoolean,
  getActiveEffects,
  removeActiveEffectById,
  getDrawnWeapons,
  addDrawnWeapon,
  getInventory,
} from "../../helpers/resource-utils.js";
import {
  hasAdvantageFromEffects,
  hasDisadvantageFromEffects,
} from "../../../../../domain/entities/combat/effects.js";
import { ClassFeatureResolver } from "../../../../../domain/entities/classes/class-feature-resolver.js";
import { matchAttackEnhancements } from "../../../../../domain/entities/classes/combat-text-profile.js";
import { getAllCombatTextProfiles } from "../../../../../domain/entities/classes/registry.js";
import {
  deriveRollModeFromConditions,
  inferActorRef,
  findAllCombatantsByName,
} from "../combat-text-parser.js";
import { readConditionNames, normalizeConditions, getExhaustionD20Penalty, isAttackBlockedByCharm } from "../../../../../domain/entities/combat/conditions.js";
import { resolveWeaponMastery } from "../../../../../domain/rules/weapon-mastery.js";
import { lookupMagicItemById } from "../../../../../domain/entities/items/magic-item-catalog.js";
import { getWeaponMagicBonuses } from "../../../../../domain/entities/items/inventory.js";

import type { TabletopEventEmitter } from "../tabletop-event-emitter.js";
import type {
  TabletopCombatServiceDeps,
  ActionParseResult,
  AttackPendingAction,
  WeaponSpec,
} from "../tabletop-types.js";
import type {
  AttackCommand,
  LlmRoster,
  CombatantRef,
} from "../../../../commands/game-command.js";
import type {
  SessionCharacterRecord,
  SessionMonsterRecord,
  SessionNPCRecord,
} from "../../../../types.js";

export class AttackHandlers {
  constructor(
    private readonly deps: TabletopCombatServiceDeps,
    private readonly eventEmitter: TabletopEventEmitter,
    private readonly debugLogsEnabled: boolean,
  ) {}

  /**
   * Resolve the best attack target from a target name or nearest hostile.
   */
  public async resolveAttackTarget(
    encounterId: string,
    actorId: string,
    roster: LlmRoster,
    targetName: string | undefined,
    preferNearest: boolean,
  ): Promise<CombatantRef> {
    const combatants = await this.deps.combatRepo.listCombatants(encounterId);
    const actorCombatant = combatants.find(
      (c: any) => c.characterId === actorId || c.monsterId === actorId || c.npcId === actorId,
    );
    const actorPos = actorCombatant ? getPosition(actorCombatant.resources ?? {}) : null;
    const actorRef = inferActorRef(actorId, roster);

    if (targetName) {
      const candidates = findAllCombatantsByName(targetName, roster);
      if (candidates.length === 0) {
        throw new ValidationError(`No target found matching "${targetName}"`);
      }

      // Filter out dead/unconscious candidates (HP <= 0)
      const aliveCandidates = candidates.filter((ref) => {
        const refId = ref.type === "Character" ? (ref as any).characterId
          : ref.type === "Monster" ? (ref as any).monsterId
          : (ref as any).npcId;
        const comb = combatants.find(
          (c: any) => c.characterId === refId || c.monsterId === refId || c.npcId === refId,
        );
        if (!comb) return true; // keep if we can't verify
        const hp = typeof (comb.resources as any)?.currentHp === "number" ? (comb.resources as any).currentHp : null;
        return hp === null || hp > 0;
      });

      if (aliveCandidates.length === 0) {
        throw new ValidationError(`All targets matching "${targetName}" are dead or unconscious`);
      }
      if (aliveCandidates.length === 1 || !actorPos) return aliveCandidates[0]!;

      // Pick the nearest alive candidate
      let bestRef = aliveCandidates[0]!;
      let bestDist = Infinity;
      for (const ref of aliveCandidates) {
        const refId = ref.type === "Character" ? (ref as any).characterId
          : ref.type === "Monster" ? (ref as any).monsterId
          : (ref as any).npcId;

        const comb = combatants.find(
          (c: any) => c.characterId === refId || c.monsterId === refId || c.npcId === refId,
        );
        if (!comb) continue;
        const pos = getPosition(comb.resources ?? {});
        if (!pos) continue;
        const dist = calculateDistance(actorPos, pos);
        if (dist < bestDist) {
          bestDist = dist;
          bestRef = ref;
        }
      }
      return bestRef;
    }

    // No target name — pick nearest hostile
    if (!actorPos) throw new ValidationError("Cannot determine actor position to find nearest target");

    let bestRef: CombatantRef | null = null;
    let bestDist = Infinity;

    for (const c of combatants) {
      // Skip self
      if (c.characterId === actorId || c.monsterId === actorId || c.npcId === actorId) continue;

      // Identify hostiles
      const isHostile =
        (actorRef.type === "Character" && (c.combatantType === "Monster" || c.combatantType === "NPC")) ||
        (actorRef.type !== "Character" && c.combatantType === "Character");
      if (!isHostile) continue;

      // Skip dead/unconscious
      const hp = typeof (c.resources as any)?.currentHp === "number" ? (c.resources as any).currentHp : null;
      if (hp !== null && hp <= 0) continue;

      const pos = getPosition(c.resources ?? {});
      if (!pos) continue;

      const dist = calculateDistance(actorPos, pos);
      if (dist < bestDist) {
        bestDist = dist;
        if (c.combatantType === "Character" && c.characterId) {
          bestRef = { type: "Character", characterId: c.characterId };
        } else if (c.combatantType === "Monster" && c.monsterId) {
          bestRef = { type: "Monster", monsterId: c.monsterId };
        } else if (c.combatantType === "NPC" && c.npcId) {
          bestRef = { type: "NPC", npcId: c.npcId };
        }
      }
    }

    if (!bestRef) throw new ValidationError("No hostile targets found");
    return bestRef;
  }

  /**
   * Build an enriched roster that includes distanceFeet for each combatant,
   * so the LLM can disambiguate same-named targets.
   */
  public async enrichRosterWithDistances(
    encounterId: string,
    actorId: string,
    roster: LlmRoster,
  ): Promise<LlmRoster> {
    const combatants = await this.deps.combatRepo.listCombatants(encounterId);
    const actorCombatant = combatants.find(
      (c: any) => c.characterId === actorId || c.monsterId === actorId || c.npcId === actorId,
    );
    const actorPos = actorCombatant ? getPosition(actorCombatant.resources ?? {}) : null;
    if (!actorPos) return roster; // Can't compute distances without actor position

    const withDist = <T extends { id: string; name: string }>(
      entries: T[],
      idField: "characterId" | "monsterId" | "npcId",
    ): Array<T & { distanceFeet?: number }> =>
      entries.map((entry) => {
        const comb = combatants.find((c: any) => c[idField] === entry.id);
        if (!comb) return entry;
        const pos = getPosition(comb.resources ?? {});
        if (!pos) return entry;
        return { ...entry, distanceFeet: Math.round(calculateDistance(actorPos, pos)) };
      });

    return {
      characters: withDist(roster.characters, "characterId"),
      monsters: withDist(roster.monsters, "monsterId"),
      npcs: withDist(roster.npcs, "npcId"),
    };
  }

  /**
   * Handle attack action – resolve weapon, validate range, create pending attack.
   */
  public async handleAttackAction(
    sessionId: string,
    encounterId: string,
    actorId: string,
    text: string,
    command: AttackCommand,
    characters: SessionCharacterRecord[],
    monsters: SessionMonsterRecord[],
    npcs: SessionNPCRecord[],
  ): Promise<ActionParseResult> {
    const targetId = command.target
      ? command.target.type === "Character"
        ? command.target.characterId
        : command.target.type === "Monster"
          ? command.target.monsterId
          : command.target.npcId
      : undefined;

    const target =
      monsters.find((m) => m.id === targetId) ||
      characters.find((c) => c.id === targetId) ||
      npcs.find((n) => n.id === targetId);

    if (!target) {
      throw new ValidationError("Target not found");
    }

    // Validate positions
    const combatantStates = await this.deps.combatRepo.listCombatants(encounterId);
    const actorCombatant = combatantStates.find((c: any) => c.combatantType === "Character" && c.characterId === actorId);
    if (!actorCombatant) throw new ValidationError("Actor not found in encounter");

    const actorChar = characters.find((c) => c.id === actorId);
    const actorSheet = (actorChar?.sheet ?? {}) as any;
    const actorLevel = ClassFeatureResolver.getLevel(actorSheet, actorChar?.level);
    const actorClassName = actorChar?.className ?? actorSheet?.className ?? "";

    // Merge picked-up weapons into the attacks array so they can be used in attacks
    const pickedUp = Array.isArray((actorCombatant.resources as any)?.pickedUpWeapons)
      ? (actorCombatant.resources as any).pickedUpWeapons as any[]
      : [];
    if (pickedUp.length > 0 && Array.isArray(actorSheet.attacks)) {
      for (const pw of pickedUp) {
        const exists = actorSheet.attacks.some((a: any) => a.name?.toLowerCase() === pw.name?.toLowerCase());
        if (!exists) actorSheet.attacks.push(pw);
      }
    }

    // Ensure attacksAllowedThisTurn is set based on Extra Attack feature
    let currentResources = actorCombatant.resources;
    if (getAttacksAllowedThisTurn(currentResources) === 1) {
      const attacksPerAction = ClassFeatureResolver.getAttacksPerAction(actorSheet, actorClassName, actorLevel);
      if (attacksPerAction > 1) {
        currentResources = setAttacksAllowed(currentResources, attacksPerAction);
        await this.deps.combatRepo.updateCombatantState(actorCombatant.id, {
          resources: currentResources as any,
        });
      }
    }

    if (!canMakeAttack(currentResources)) {
      throw new ValidationError("Actor has already spent their action this turn");
    }

    const targetCombatant = combatantStates.find((c: any) => c.monsterId === targetId || c.characterId === targetId || c.npcId === targetId);
    if (!targetCombatant) throw new ValidationError("Target not found in encounter");

    // D&D 2024 Charmed: can't attack the charmer
    const actorConditionsForCharm = normalizeConditions(actorCombatant.conditions as unknown[]);
    if (isAttackBlockedByCharm(actorConditionsForCharm, targetCombatant.id)) {
      throw new ValidationError("Cannot attack this target — Charmed condition prevents targeting the charmer");
    }

    const actorPos = getPosition(actorCombatant.resources ?? {});
    const targetPos = getPosition(targetCombatant.resources ?? {});
    if (!actorPos || !targetPos) throw new ValidationError("Actor and target must have positions set");

    const lowered = text.toLowerCase();
    const textImpliesRanged =
      /\b(bow|shortbow|longbow|crossbow|shoot|arrow|ranged|sling|dart|throw|javelin|hurl)\b/.test(lowered);
    let inferredKind: "melee" | "ranged" = textImpliesRanged ? "ranged" : "melee";

    const spec = command.spec as any;
    if (spec?.kind === "ranged" || spec?.kind === "melee") {
      inferredKind = spec.kind;
    } else if (!textImpliesRanged && !spec) {
      const attacks = (actorSheet?.attacks ?? []) as any[];
      const matchedByName = attacks.find((a: any) => a.name && lowered.includes(a.name.toLowerCase()));
      if (matchedByName?.kind === "ranged") inferredKind = "ranged";
    }

    const dist = calculateDistance(actorPos, targetPos);

    // D&D 5e 2024: Thrown weapon detection — allows melee weapons to be thrown as ranged attacks
    let isThrownAttack = false;
    let thrownNormalRange: number | undefined;
    let thrownLongRange: number | undefined;
    const textImpliesThrown = /\b(throw|hurl|toss)\b/.test(lowered);

    // Helper: extract thrown range from property string like "Thrown (Range 20/60)"
    const parseThrownRange = (props: string[]): { normal: number; long: number } | null => {
      for (const p of props) {
        const match = typeof p === "string" && p.match(/thrown\s*\(\s*range\s+(\d+)\s*\/\s*(\d+)\s*\)/i);
        if (match) return { normal: parseInt(match[1]!, 10), long: parseInt(match[2]!, 10) };
      }
      // Check for bare "thrown" property (without embedded range)
      if (props.some(p => typeof p === "string" && p.toLowerCase().trim() === "thrown")) return { normal: 20, long: 60 };
      return null;
    };

    // Helper: find a throwable weapon from the actor's sheet, optionally matching a name from user text
    // Matches both melee weapons with Thrown (e.g. Handaxe, Javelin) AND ranged weapons with Thrown (e.g. Dart)
    const findThrownWeapon = (): any | null => {
      const allAttacks = (actorSheet?.attacks ?? actorSheet?.equipment?.weapons ?? []) as any[];
      const throwable = allAttacks.filter((a: any) => {
        const props = (a.properties ?? []) as string[];
        return props.some((p: string) => typeof p === "string" && /thrown/i.test(p));
      });
      if (throwable.length === 0) return null;
      // Try to match a specific weapon name from the text (e.g. "throw dart")
      const named = throwable.find((w: any) => w.name && lowered.includes(w.name.toLowerCase()));
      if (named) return named;
      // If text names a specific object (e.g. "throw rock"), don't silently fall back to a different throwable.
      // Only fall back when no particular item was specified (e.g. "throw something" / "throw at orc").
      const throwObjMatch = lowered.match(/\b(?:throw|hurl|toss)\s+(?:a\s+|the\s+|my\s+)?(\w+)/);
      if (throwObjMatch) {
        const thrownObj = throwObjMatch[1]!;
        const genericWords = ["at", "it", "that", "something", "anything", "one", "weapon"];
        if (!genericWords.includes(thrownObj)) {
          return null; // User named a specific item that doesn't match — let the error path handle it
        }
      }
      return throwable[0];
    };

    if (textImpliesThrown) {
      // Explicit thrown intent — find a melee weapon with the Thrown property
      const thrownWeapon = findThrownWeapon();
      if (thrownWeapon) {
        isThrownAttack = true;
        inferredKind = "ranged";
        // For ranged+Thrown weapons (e.g. Dart), use the weapon's own range field;
        // for melee+Thrown weapons (e.g. Handaxe), extract from the Thrown property
        if (thrownWeapon.kind === "ranged" && thrownWeapon.range && typeof thrownWeapon.range === "string" && thrownWeapon.range.toLowerCase() !== "melee") {
          const parts = thrownWeapon.range.split("/").map(Number);
          if (parts.length >= 1 && !isNaN(parts[0])) thrownNormalRange = parts[0];
          if (parts.length >= 2 && !isNaN(parts[1])) thrownLongRange = parts[1];
        } else {
          const range = parseThrownRange((thrownWeapon.properties ?? []) as string[]);
          if (range) { thrownNormalRange = range.normal; thrownLongRange = range.long; }
        }
        if (this.debugLogsEnabled) console.log(`[AttackHandlers] Thrown weapon: ${thrownWeapon.name} (range ${thrownNormalRange}/${thrownLongRange})`);
      } else {
        // Player said "throw X" but has no throwable weapon — build a helpful error
        const allAttacks = (actorSheet?.attacks ?? actorSheet?.equipment?.weapons ?? []) as any[];
        // Check if the user named a specific weapon that exists but isn't throwable
        const namedWeapon = allAttacks.find((a: any) =>
          a.name && lowered.includes(a.name.toLowerCase()),
        );
        if (namedWeapon) {
          throw new ValidationError(
            `${namedWeapon.name} doesn't have the Thrown property and can't be thrown.`,
          );
        }
        // User tried to throw something that isn't even a weapon
        const weaponNames = allAttacks.map((a: any) => a.name).filter(Boolean);
        const hint = weaponNames.length > 0
          ? ` Your available attacks: ${weaponNames.join(", ")}.`
          : "";
        throw new ValidationError(
          `You don't have anything you can throw.${hint}`,
        );
      }
    }

    if (inferredKind === "melee") {
      const actorResources = normalizeResources(actorCombatant.resources ?? {});
      const reach = typeof (actorResources as any).reach === "number" ? (actorResources as any).reach : 5;
      if (dist > reach + 0.0001) {
        // Auto-throw: if out of melee reach, check for a thrown weapon before rejecting
        const thrownWeapon = findThrownWeapon();
        if (thrownWeapon) {
          isThrownAttack = true;
          inferredKind = "ranged";
          if (thrownWeapon.kind === "ranged" && thrownWeapon.range && typeof thrownWeapon.range === "string" && thrownWeapon.range.toLowerCase() !== "melee") {
            const parts = thrownWeapon.range.split("/").map(Number);
            if (parts.length >= 1 && !isNaN(parts[0])) thrownNormalRange = parts[0];
            if (parts.length >= 2 && !isNaN(parts[1])) thrownLongRange = parts[1];
          } else {
            const range = parseThrownRange((thrownWeapon.properties ?? []) as string[]);
            if (range) { thrownNormalRange = range.normal; thrownLongRange = range.long; }
          }
          if (this.debugLogsEnabled) console.log(`[AttackHandlers] Auto-throw: ${thrownWeapon.name} (target at ${Math.round(dist)}ft, beyond melee reach)`);
        } else {
          throw new ValidationError(`Target is out of reach (${Math.round(dist)}ft > ${Math.round(reach)}ft)`);
        }
      }
    }

    // D&D 5e 2024: Cover AC bonus — check terrain between attacker and target
    let coverACBonus = 0;
    {
      const encounter = await this.deps.combatRepo.getEncounterById(encounterId);
      const map = encounter?.mapData as unknown as CombatMap | undefined;
      if (map && map.cells && map.cells.length > 0) {
        const coverLevel = getCoverLevel(map, actorPos, targetPos);
        if (coverLevel === "full") {
          throw new ValidationError("Target has full cover and cannot be targeted");
        }
        coverACBonus = getCoverACBonus(coverLevel);
        if (this.debugLogsEnabled && coverACBonus > 0) {
          console.log(`[AttackHandlers] Target has ${coverLevel} cover → +${coverACBonus} AC bonus`);
        }
      }
    }

    const isUnarmed = /\b(unarmed|fist|punch|kick)\b/.test(lowered);
    const unarmedStats = ClassFeatureResolver.getUnarmedStrikeStats(actorSheet, actorClassName, actorLevel);

    const specDamage = spec?.damage;

    // Look for equipped weapon in character sheet.
    // Always look up for thrown attacks (even with LLM spec) so we get name, properties, and range.
    let equippedWeapon: { name: string; attackBonus: number; damage: { diceCount: number; diceSides: number; modifier: number } } | null = null;
    if (isThrownAttack) {
      equippedWeapon = findThrownWeapon() ?? null;
    } else if (!spec) {
      if (actorSheet?.equipment?.weapons) {
        const weapons = actorSheet.equipment.weapons as any[];
        equippedWeapon = weapons.find((w) => w.kind === inferredKind && w.equipped)
          ?? weapons.find((w) => w.kind === inferredKind)
          ?? weapons.find((w) => w.equipped)
          ?? weapons[0]
          ?? null;
      }
      if (!equippedWeapon && actorSheet?.attacks) {
        const attacks = actorSheet.attacks as any[];
        equippedWeapon = attacks.find((a) => a.kind === inferredKind) ?? attacks[0] ?? null;
      }
    }

    const diceCount = typeof specDamage?.diceCount === "number"
      ? specDamage.diceCount
      : equippedWeapon?.damage?.diceCount ?? 1;
    const diceSidesRaw = typeof specDamage?.diceSides === "number"
      ? specDamage.diceSides
      : equippedWeapon?.damage?.diceSides ?? 8;
    const modifierRaw = typeof specDamage?.modifier === "number"
      ? specDamage.modifier
      : equippedWeapon?.damage?.modifier ?? unarmedStats.damageModifier;
    const attackBonusRaw = typeof spec?.attackBonus === "number"
      ? spec.attackBonus
      : equippedWeapon?.attackBonus ?? unarmedStats.attackBonus;

    const finalDiceSides = isUnarmed ? unarmedStats.damageDie : diceSidesRaw;
    let finalModifier = isUnarmed ? unarmedStats.damageModifier : modifierRaw;
    let finalAttackBonus = isUnarmed ? unarmedStats.attackBonus : attackBonusRaw;

    // D&D 5e 2024: Magic item weapon bonuses (+1/+2/+3 weapons)
    // Applied at weaponSpec construction time so they flow through to rolls.
    if (!isUnarmed) {
      const inventory = getInventory(currentResources);
      if (inventory.length > 0) {
        const magicBonuses = getWeaponMagicBonuses(
          inventory,
          spec?.name ?? equippedWeapon?.name ?? "",
          lookupMagicItemById,
          inferredKind as "melee" | "ranged",
        );
        if (magicBonuses.attackBonus !== 0 || magicBonuses.damageBonus !== 0) {
          finalAttackBonus += magicBonuses.attackBonus;
          finalModifier += magicBonuses.damageBonus;
          if (this.debugLogsEnabled) {
            console.log(`[AttackHandlers] Magic weapon bonus: +${magicBonuses.attackBonus} attack, +${magicBonuses.damageBonus} damage`);
          }
        }
      }
    }

    // Versatile weapon 1h/2h auto-detection (D&D 5e 2024)
    let weaponHands: 1 | 2 | undefined;
    let effectiveDiceSides = finalDiceSides;
    if (!isUnarmed) {
      const weaponProps = (spec?.properties ?? (equippedWeapon as any)?.properties ?? []) as string[];
      const isVersatile = weaponProps.some((p: string) => typeof p === "string" && p.toLowerCase() === "versatile");
      if (isVersatile) {
        // Check for versatileDamage on the weapon/spec
        const versatileDamage = (spec as any)?.versatileDamage ?? (equippedWeapon as any)?.versatileDamage;
        // Check text for explicit grip declaration
        const textLower = text.toLowerCase();
        const explicitTwoHanded = /\b(two.hand(?:ed)?|2h|two hand(?:ed)?)\b/.test(textLower);
        const explicitOneHanded = /\b(one.hand(?:ed)?|1h|one hand(?:ed)?)\b/.test(textLower);

        if (explicitOneHanded) {
          weaponHands = 1;
        } else if (explicitTwoHanded) {
          weaponHands = 2;
        } else if (isThrownAttack) {
          // D&D 5e 2024: Thrown weapons always use 1-handed damage (can't throw two-handed)
          weaponHands = 1;
        } else {
          // Auto-detect: default to 2h unless holding shield or second weapon
          const hasShield = !!(actorSheet?.equipment?.armor?.type === "shield"
            || (actorSheet?.equipment?.shield));
          const attacks = (actorSheet?.attacks ?? actorSheet?.equipment?.weapons ?? []) as any[];
          const hasSecondWeapon = attacks.filter((a: any) => a.kind === "melee").length >= 2;
          weaponHands = (hasShield || hasSecondWeapon) ? 1 : 2;
        }

        if (weaponHands === 2 && versatileDamage?.diceSides) {
          effectiveDiceSides = versatileDamage.diceSides;
          if (this.debugLogsEnabled) console.log(`[AttackHandlers] Versatile weapon wielded two-handed → ${diceCount}d${effectiveDiceSides}`);
        } else if (weaponHands === 1) {
          if (this.debugLogsEnabled) console.log(`[AttackHandlers] Versatile weapon wielded one-handed → ${diceCount}d${effectiveDiceSides}`);
        }
      }
    }

    const weaponName = isUnarmed
      ? "Unarmed Strike"
      : spec?.name ?? equippedWeapon?.name ?? "Attack";

    // D&D 5e 2024: Check if the weapon is drawn (in-hand).
    // Unarmed strikes don't require drawing. If drawnWeapons is not initialized (legacy), skip check.
    if (!isUnarmed && weaponName !== "Attack") {
      const drawnWeapons = getDrawnWeapons(currentResources);
      if (drawnWeapons !== undefined && !drawnWeapons.some(n => n.toLowerCase() === weaponName.toLowerCase())) {
        // Weapon not drawn — try to auto-draw using free interaction
        const attackResources = normalizeResources(currentResources);
        const objInteractionUsed = readBoolean(attackResources, "objectInteractionUsed") ?? false;
        if (!objInteractionUsed) {
          // Auto-draw the weapon (free interaction)
          currentResources = addDrawnWeapon(currentResources, weaponName);
          currentResources = { ...(currentResources as Record<string, unknown>), objectInteractionUsed: true } as any;
          await this.deps.combatRepo.updateCombatantState(actorCombatant.id, {
            resources: currentResources as any,
          });
          if (this.debugLogsEnabled) console.log(`[AttackHandlers] Auto-drew ${weaponName} (free interaction)`);
        } else {
          const drawn = drawnWeapons.join(", ");
          const hint = drawn ? ` Currently drawn: ${drawn}.` : "";
          throw new ValidationError(
            `${weaponName} is not drawn and your free Object Interaction is already used this turn.${hint} ` +
            `Use "draw ${weaponName}" on your next turn, or drop your current weapon (free) and pick up ${weaponName}.`,
          );
        }
      }
    }

    const modText = finalModifier === 0 ? "" : finalModifier > 0 ? `+${finalModifier}` : `${finalModifier}`;
    const damageFormula = `${diceCount}d${effectiveDiceSides}${modText}`;

    const inferredDamageType: string | undefined = isUnarmed
      ? "bludgeoning"
      : spec?.damageType ?? (equippedWeapon as any)?.damageType ?? undefined;

    const inferredProperties: string[] | undefined = isUnarmed
      ? undefined
      : spec?.properties ?? (equippedWeapon as any)?.properties ?? undefined;

    // Parse range
    let normalRange: number | undefined;
    let longRange: number | undefined;
    if (inferredKind === "ranged") {
      // D&D 5e 2024: Thrown weapons get range from the Thrown property, not the weapon.range field
      if (isThrownAttack && thrownNormalRange) {
        normalRange = thrownNormalRange;
        longRange = thrownLongRange;
      } else {
        const rangeSource = spec?.range ?? (equippedWeapon as any)?.range;
        if (typeof rangeSource === "string") {
          // Handle "melee" range string for thrown weapons that don't have numeric range
          if (rangeSource.toLowerCase() !== "melee") {
            const parts = rangeSource.split("/").map(Number);
            if (parts.length >= 1 && !isNaN(parts[0])) normalRange = parts[0];
            if (parts.length >= 2 && !isNaN(parts[1])) longRange = parts[1];
          }
        } else if (rangeSource && typeof rangeSource === "object") {
          normalRange = typeof rangeSource.normal === "number" ? rangeSource.normal : undefined;
          longRange = typeof rangeSource.long === "number"
            ? rangeSource.long
            : typeof rangeSource.max === "number"
              ? rangeSource.max
              : undefined;
        }
      }
    }

    if (inferredKind === "ranged") {
      const maxRange = longRange ?? normalRange ?? 600;
      if (dist > maxRange + 0.0001) {
        throw new ValidationError(`Target is out of range (${Math.round(dist)}ft > ${Math.round(maxRange)}ft)`);
      }
    }

    // D&D 5e 2024: Exhaustion penalty applies as flat negative modifier on attack rolls
    const attackerActiveConditions = normalizeConditions(actorCombatant.conditions as unknown[]);
    const exhaustionPenalty = getExhaustionD20Penalty(attackerActiveConditions);

    // D&D 5e 2024: Exhaustion penalty on attack rolls (-2 per exhaustion level)
    if (exhaustionPenalty !== 0) {
      finalAttackBonus += exhaustionPenalty;
      if (this.debugLogsEnabled) console.log(`[AttackHandlers] Exhaustion penalty ${exhaustionPenalty} on attack roll`);
    }

    const weaponSpec: WeaponSpec = {
      name: weaponName,
      kind: inferredKind,
      attackBonus: finalAttackBonus,
      damage: { diceCount, diceSides: effectiveDiceSides, modifier: finalModifier },
      damageFormula,
      damageType: inferredDamageType,
      properties: inferredProperties,
      normalRange,
      longRange,
      mastery: resolveWeaponMastery(
        weaponName,
        actorSheet ?? {},
        actorClassName,
        (equippedWeapon as any)?.mastery ?? spec?.mastery,
      ),
      ...(weaponHands ? { hands: weaponHands } : {}),
      ...(isThrownAttack ? { isThrownAttack: true } : {}),
    };

    // D&D 5e 2024: Loading property — only one shot per action/bonus/reaction regardless of Extra Attack
    if (weaponSpec.properties?.some((p: string) => typeof p === "string" && p.toLowerCase() === "loading")) {
      const loadRes = normalizeResources(currentResources);
      if ((loadRes as any).loadingWeaponFiredThisTurn) {
        throw new ValidationError(
          `${weaponSpec.name} has the Loading property — you can only fire it once per action, regardless of Extra Attack`,
        );
      }
    }

    // Derive advantage/disadvantage from conditions + ranged situational modifiers
    let extraDisadvantage = 0;

    // Heavy weapon + Small/Tiny creature → disadvantage (D&D 5e 2024)
    if (inferredProperties?.some((p: string) => p.toLowerCase() === "heavy")) {
      const actorSize = (actorSheet?.size ?? "Medium") as string;
      const sizeNormalized = actorSize.charAt(0).toUpperCase() + actorSize.slice(1).toLowerCase();
      if (sizeNormalized === "Small" || sizeNormalized === "Tiny") {
        extraDisadvantage++;
        if (this.debugLogsEnabled) console.log(`[AttackHandlers] Heavy weapon + ${sizeNormalized} creature → disadvantage`);
      }
    }

    if (inferredKind === "ranged") {
      if (normalRange && dist > normalRange + 0.0001) {
        extraDisadvantage++;
        if (this.debugLogsEnabled) console.log(`[AttackHandlers] Ranged attack at long range (${Math.round(dist)}ft > ${normalRange}ft) → disadvantage`);
      }
      const hostileWithin5ft = combatantStates.some((c: any) => {
        if (c.id === actorCombatant.id) return false;
        const actorIsPC = actorCombatant.combatantType === "Character" || actorCombatant.combatantType === "NPC";
        const otherIsPC = c.combatantType === "Character" || c.combatantType === "NPC";
        if (actorIsPC === otherIsPC) return false;
        const otherPos = getPosition(c.resources ?? {});
        if (!otherPos) return false;
        return calculateDistance(actorPos, otherPos) <= 5.0001;
      });
      if (hostileWithin5ft) {
        extraDisadvantage++;
        if (this.debugLogsEnabled) console.log(`[AttackHandlers] Ranged attack with hostile in melee → disadvantage`);
      }
    }

    const attackerConditions = normalizeConditions(actorCombatant.conditions as unknown[]);
    const targetConditions = normalizeConditions(targetCombatant.conditions as unknown[]);

    let extraAdvantage = 0;

    // ActiveEffect-based advantage/disadvantage
    const actorActiveEffects = getActiveEffects(actorCombatant.resources ?? {});
    const targetActiveEffects = getActiveEffects(targetCombatant.resources ?? {});
    // Attacker's own effects granting advantage on all attack rolls
    if (hasAdvantageFromEffects(actorActiveEffects, 'attack_rolls')) {
      extraAdvantage++;
      if (this.debugLogsEnabled) console.log(`[AttackHandlers] ActiveEffect: attacker has advantage on attack_rolls`);
    }
    // Melee-specific advantage (e.g., Reckless Attack)
    if (inferredKind === 'melee' && hasAdvantageFromEffects(actorActiveEffects, 'melee_attack_rolls')) {
      extraAdvantage++;
      if (this.debugLogsEnabled) console.log(`[AttackHandlers] ActiveEffect: attacker has advantage on melee_attack_rolls`);
    }
    // Ranged-specific advantage (e.g., Archery features)
    if (inferredKind === 'ranged' && hasAdvantageFromEffects(actorActiveEffects, 'ranged_attack_rolls')) {
      extraAdvantage++;
      if (this.debugLogsEnabled) console.log(`[AttackHandlers] ActiveEffect: attacker has advantage on ranged_attack_rolls`);
    }
    // Attacker's own effects granting disadvantage on attack rolls (e.g., penalty effects)
    if (hasDisadvantageFromEffects(actorActiveEffects, 'attack_rolls')) {
      extraDisadvantage++;
      if (this.debugLogsEnabled) console.log(`[AttackHandlers] ActiveEffect: attacker has disadvantage on attack_rolls`);
    }
    // Melee-specific disadvantage
    if (inferredKind === 'melee' && hasDisadvantageFromEffects(actorActiveEffects, 'melee_attack_rolls')) {
      extraDisadvantage++;
      if (this.debugLogsEnabled) console.log(`[AttackHandlers] ActiveEffect: attacker has disadvantage on melee_attack_rolls`);
    }
    // Ranged-specific disadvantage
    if (inferredKind === 'ranged' && hasDisadvantageFromEffects(actorActiveEffects, 'ranged_attack_rolls')) {
      extraDisadvantage++;
      if (this.debugLogsEnabled) console.log(`[AttackHandlers] ActiveEffect: attacker has disadvantage on ranged_attack_rolls`);
    }
    // Target's effects that affect attacks against them (e.g., Dodge, Faerie Fire, Reckless Attack incoming)
    // Effects with targetCombatantId matching the target grant advantage/disadvantage on attacks against that target
    for (const eff of targetActiveEffects) {
      if (eff.target !== 'attack_rolls' && eff.target !== 'melee_attack_rolls' && eff.target !== 'ranged_attack_rolls') continue;
      // Skip melee-only target effects when attack is ranged (and vice versa)
      if (eff.target === 'melee_attack_rolls' && inferredKind !== 'melee') continue;
      if (eff.target === 'ranged_attack_rolls' && inferredKind !== 'ranged') continue;
      if (eff.targetCombatantId && eff.targetCombatantId !== targetId) continue;
      if (!eff.targetCombatantId) continue; // Skip self-buffs (handled above)
      if (eff.type === 'advantage') {
        extraAdvantage++;
        if (this.debugLogsEnabled) console.log(`[AttackHandlers] ActiveEffect on target: advantage on attacks against ${targetId} (${eff.source ?? 'unknown'})`);
      }
      if (eff.type === 'disadvantage') {
        extraDisadvantage++;
        if (this.debugLogsEnabled) console.log(`[AttackHandlers] ActiveEffect on target: disadvantage on attacks against ${targetId} (${eff.source ?? 'unknown'})`);
      }
    }

    // Vex mastery: consume until_triggered advantage effect (one-use)
    const actorNormRes = normalizeResources(actorCombatant.resources);
    const vexEffect = actorActiveEffects.find(
      e => e.source === 'Vex' && e.type === 'advantage' && e.duration === 'until_triggered'
        && e.targetCombatantId === targetId
    );
    if (vexEffect) {
      extraAdvantage++;
      // Consume the Vex effect by removing it
      const updatedRes = removeActiveEffectById(actorCombatant.resources ?? {}, vexEffect.id);
      await this.deps.combatRepo.updateCombatantState(actorCombatant.id, {
        resources: updatedRes as any,
      });
      if (this.debugLogsEnabled) console.log(`[AttackHandlers] Vex mastery (ActiveEffect): +1 advantage vs ${targetId}`);
    }

    // Help action: consume until_triggered advantage effects on the target (one-use)
    const helpEffects = targetActiveEffects.filter(
      e => e.source === 'Help' && e.type === 'advantage' && e.duration === 'until_triggered'
        && e.targetCombatantId === targetId
    );
    if (helpEffects.length > 0) {
      // Remove all Help advantage effects from target (consumed on first attack)
      let updatedTargetRes: Record<string, unknown> = (targetCombatant.resources ?? {}) as Record<string, unknown>;
      for (const helpEff of helpEffects) {
        updatedTargetRes = removeActiveEffectById(updatedTargetRes, helpEff.id) as Record<string, unknown>;
      }
      await this.deps.combatRepo.updateCombatantState(targetCombatant.id, {
        resources: updatedTargetRes as any,
      });
      if (this.debugLogsEnabled) console.log(`[AttackHandlers] Help action advantage consumed on attack against ${targetId}`);
    }

    const rollMode = deriveRollModeFromConditions(attackerConditions, targetConditions, inferredKind, extraAdvantage, extraDisadvantage, dist);

    // Parse attack enhancement declarations via class combat text profiles
    // Only match "onDeclare" enhancements — "onHit" enhancements (Stunning Strike, Divine Smite, OHT)
    // are offered post-hit and opted into via damage roll text (2024 rules).
    const normalizedRes = normalizeResources(actorCombatant.resources);
    const resourcePools = getResourcePools(normalizedRes);
    const attackEnhancements = matchAttackEnhancements(
      text, inferredKind, actorClassName, actorLevel,
      normalizedRes, resourcePools, getAllCombatTextProfiles(),
      "onDeclare",
    );

    const pendingAction: AttackPendingAction = {
      type: "ATTACK",
      timestamp: new Date(),
      actorId,
      attacker: actorId,
      target: targetId,
      targetId,
      weaponSpec,
      rollMode,
      ...(coverACBonus > 0 ? { coverACBonus } : {}),
    };

    await this.deps.combatRepo.setPendingAction(encounterId, pendingAction);

    const attackerName = actorChar?.name ?? "The attacker";
    const narration = await this.eventEmitter.generateNarration("attackRequest", {
      attackerName,
      targetName: (target as any).name,
      weaponName: weaponSpec.name,
    });

    const rollModeText = rollMode === "advantage"
      ? " with advantage (roll 2d20, take higher)"
      : rollMode === "disadvantage"
        ? " with disadvantage (roll 2d20, take lower)"
        : "";
    const rollMessage = `Roll a d20${rollModeText} for attack against ${(target as any).name} (no modifiers; server applies bonuses).`;

    return {
      requiresPlayerInput: true,
      type: "REQUEST_ROLL",
      rollType: "attack",
      message: rollMessage,
      narration,
      diceNeeded: "d20",
      pendingAction,
      actionComplete: false,
      advantage: rollMode === "advantage",
      disadvantage: rollMode === "disadvantage",
    };
  }
}
