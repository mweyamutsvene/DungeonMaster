/**
 * AttackHandlers — attack target resolution, distance enrichment, and attack
 * action handling.
 *
 * Extracted from ActionDispatcher (Phase: God-Module Decomposition §2c).
 */

import { ValidationError } from "../../../../errors.js";
import { calculateDistance } from "../../../../../domain/rules/movement.js";
import type { CombatMap } from "../../../../../domain/rules/combat-map.js";
import { getCoverLevel, getCoverACBonus, hasElevationAdvantage, getObscurationAttackModifiers } from "../../../../../domain/rules/combat-map.js";
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
import { findCombatantByEntityId } from "../../helpers/combatant-lookup.js";
import {
  hasAdvantageFromEffects,
  hasDisadvantageFromEffects,
} from "../../../../../domain/entities/combat/effects.js";
import { ClassFeatureResolver } from "../../../../../domain/entities/classes/class-feature-resolver.js";
import { matchAttackEnhancements } from "../../../../../domain/entities/classes/combat-text-profile.js";
import { getAllCombatTextProfiles } from "../../../../../domain/entities/classes/registry.js";
import { classHasFeature } from "../../../../../domain/entities/classes/registry.js";
import { CUNNING_STRIKE } from "../../../../../domain/entities/classes/feature-keys.js";
import { parseCunningStrikeOption } from "../../../../../domain/entities/classes/rogue.js";
import {
  deriveRollModeFromConditions,
  inferActorRef,
  findAllCombatantsByName,
} from "../combat-text-parser.js";
import { readConditionNames, normalizeConditions, getExhaustionD20Penalty, isAttackBlockedByCharm } from "../../../../../domain/entities/combat/conditions.js";
import { resolveWeaponMastery } from "../../../../../domain/rules/weapon-mastery.js";
import { lookupMagicItemById } from "../../../../../domain/entities/items/magic-item-catalog.js";
import { getWeaponMagicBonuses } from "../../../../../domain/entities/items/inventory.js";
import { checkFlanking } from "../../../../../domain/rules/flanking.js";
import { getWeaponThrownRange, lookupWeapon } from "../../../../../domain/entities/items/weapon-catalog.js";
import type { CombatMap as FlankingCombatMap } from "../../../../../domain/rules/combat-map-types.js";
import { rollModePrompt } from "../roll-state-machine.js";

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
import { getClassBackedActorSource } from "../../helpers/class-backed-actor.js";
import { readWildShapeForm } from "../../helpers/wild-shape-form-helper.js";

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
    const actorCombatant = findCombatantByEntityId(combatants, actorId);
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
        const comb = findCombatantByEntityId(combatants, refId);
        if (!comb) return true; // keep if we can't verify
        return comb.hpCurrent > 0;
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

        const comb = findCombatantByEntityId(combatants, refId);
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
      if (c.hpCurrent <= 0) continue;

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
    const actorCombatant = findCombatantByEntityId(combatants, actorId);
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
    weaponHint?: string,
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
    const actorCombatant = findCombatantByEntityId(combatantStates, actorId);
    if (!actorCombatant) throw new ValidationError("Actor not found in encounter");

    const actorSource = getClassBackedActorSource(actorId, characters, npcs);
    const actorSheet = { ...((actorSource?.sheet ?? {}) as Record<string, unknown>) } as any;
    const wildShapeForm = readWildShapeForm(actorCombatant.resources);
    if (wildShapeForm && wildShapeForm.attacks.length > 0) {
      actorSheet.attacks = wildShapeForm.attacks.map((attack) => ({ ...attack, equipped: true }));
    }
    const actorLevel = actorSource?.level ?? ClassFeatureResolver.getLevel(actorSheet, undefined);
    const actorClassName = actorSource?.className ?? actorSheet?.className ?? "";

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

    const targetCombatant = findCombatantByEntityId(combatantStates, targetId!);
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

    if (textImpliesThrown) {
      // Explicit thrown intent — find a melee weapon with the Thrown property
      const thrownWeapon = this.findThrownWeapon(actorSheet, lowered);
      if (thrownWeapon) {
        isThrownAttack = true;
        inferredKind = "ranged";
        const thrownRange = this.resolveThrownRange(thrownWeapon);
        thrownNormalRange = thrownRange.normalRange;
        thrownLongRange = thrownRange.longRange;
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
        // BUG-1 fix: If the player explicitly named a melee weapon (e.g. "attack with longsword"),
        // don't silently switch to a thrown weapon — that's confusing and unexpected.
        // Only auto-throw when no specific weapon was named or the named weapon has Thrown.
        const allWeapons = (actorSheet?.attacks ?? actorSheet?.equipment?.weapons ?? []) as any[];
        const namedMeleeWeapon = allWeapons.find((w: any) => {
          if (!w.name) return false;
          if (!lowered.includes(w.name.toLowerCase())) return false;
          const props = (w.properties ?? []) as string[];
          return !props.some((p: string) => /thrown/i.test(p));
        });
        if (namedMeleeWeapon) {
          throw new ValidationError(
            `Target is out of reach (${Math.round(dist)}ft > ${Math.round(reach)}ft). ${namedMeleeWeapon.name} doesn't have the Thrown property.`,
          );
        }

        // Auto-throw: if out of melee reach, check for a thrown weapon before rejecting
        const thrownWeapon = this.findThrownWeapon(actorSheet, lowered);
        if (thrownWeapon) {
          isThrownAttack = true;
          inferredKind = "ranged";
          const thrownRange = this.resolveThrownRange(thrownWeapon);
          thrownNormalRange = thrownRange.normalRange;
          thrownLongRange = thrownRange.longRange;
          if (this.debugLogsEnabled) console.log(`[AttackHandlers] Auto-throw: ${thrownWeapon.name} (target at ${Math.round(dist)}ft, beyond melee reach)`);
        } else {
          throw new ValidationError(`Target is out of reach (${Math.round(dist)}ft > ${Math.round(reach)}ft)`);
        }
      }
    }

    // D&D 5e 2024: Cover AC bonus — check terrain between attacker and target
    const coverACBonus = await this.computeCoverACBonus(encounterId, actorPos, targetPos);

    const isUnarmed = /\b(unarmed|fist|punch|kick)\b/.test(lowered);
    const unarmedStats = ClassFeatureResolver.getUnarmedStrikeStats(actorSheet, actorClassName, actorLevel);

    const specDamage = spec?.damage;

    // Look for equipped weapon in character sheet.
    // Always look up for thrown attacks (even with LLM spec) so we get name, properties, and range.
    let equippedWeapon: { name: string; attackBonus: number; damage: { diceCount: number; diceSides: number; modifier: number } } | null = null;
    if (isThrownAttack) {
      equippedWeapon = this.findThrownWeapon(actorSheet, lowered) ?? null;
    } else if (!spec) {
      // Name-based weapon lookup from parsed "with my <weapon>" hint
      if (weaponHint) {
        const hint = weaponHint.toLowerCase();
        const weapons = (actorSheet?.equipment?.weapons ?? []) as any[];
        equippedWeapon = weapons.find((w: any) => w.name?.toLowerCase() === hint) ?? null;
        if (!equippedWeapon) {
          equippedWeapon = weapons.find((w: any) => w.name?.toLowerCase().includes(hint)) ?? null;
        }
        if (!equippedWeapon) {
          const attacks = (actorSheet?.attacks ?? []) as any[];
          equippedWeapon = attacks.find((a: any) => a.name?.toLowerCase() === hint) ?? null;
          if (!equippedWeapon) {
            equippedWeapon = attacks.find((a: any) => a.name?.toLowerCase().includes(hint)) ?? null;
          }
        }
        if (equippedWeapon) {
          inferredKind = (equippedWeapon as any).kind ?? inferredKind;
        }
      }

      // Fallback: match by inferredKind from text keywords
      if (!equippedWeapon) {
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
    }

    // Priority: sheet-resolved equippedWeapon > LLM spec > unarmed defaults.
    // For Character attackers, the sheet is always more reliable than LLM-provided values.
    const diceCount = equippedWeapon?.damage?.diceCount !== undefined
      ? equippedWeapon.damage.diceCount
      : typeof specDamage?.diceCount === "number"
        ? specDamage.diceCount
        : 1;
    const diceSidesRaw = equippedWeapon?.damage?.diceSides !== undefined
      ? equippedWeapon.damage.diceSides
      : typeof specDamage?.diceSides === "number"
        ? specDamage.diceSides
        : 8;
    const modifierRaw = equippedWeapon?.damage?.modifier !== undefined
      ? equippedWeapon.damage.modifier
      : typeof specDamage?.modifier === "number"
        ? specDamage.modifier
        : unarmedStats.damageModifier;
    const attackBonusRaw = equippedWeapon?.attackBonus !== undefined
      ? equippedWeapon.attackBonus
      : typeof spec?.attackBonus === "number"
        ? spec.attackBonus
        : unarmedStats.attackBonus;

    const finalDiceSides = isUnarmed ? unarmedStats.damageDie : diceSidesRaw;
    let finalModifier = isUnarmed ? unarmedStats.damageModifier : modifierRaw;
    let finalAttackBonus = isUnarmed ? unarmedStats.attackBonus : attackBonusRaw;

    // D&D 5e 2024: Magic item weapon bonuses (+1/+2/+3 weapons)
    if (!isUnarmed) {
      const magicBonuses = this.resolveMagicWeaponBonuses(
        currentResources,
        spec?.name ?? equippedWeapon?.name ?? "",
        inferredKind as "melee" | "ranged",
      );
      finalAttackBonus += magicBonuses.attackBonus;
      finalModifier += magicBonuses.damageBonus;
    }

    // Versatile weapon 1h/2h auto-detection (D&D 5e 2024)
    let weaponHands: 1 | 2 | undefined;
    let effectiveDiceSides = finalDiceSides;
    if (!isUnarmed) {
      const versatileResult = this.resolveVersatileGrip(spec, equippedWeapon, text, isThrownAttack, actorSheet, finalDiceSides, diceCount);
      weaponHands = versatileResult.hands;
      effectiveDiceSides = versatileResult.effectiveDiceSides;
    }

    const weaponName = isUnarmed
      ? "Unarmed Strike"
      : spec?.name ?? equippedWeapon?.name ?? "Attack";

    // D&D 5e 2024: Check if the weapon is drawn — auto-draw using free Object Interaction if available
    currentResources = await this.ensureWeaponDrawn(weaponName, isUnarmed, currentResources, actorCombatant.id);

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
      // Catalog fallback: if longRange wasn't populated from character sheet, look it up.
      // Covers cases where the sheet only has normalRange or no range at all (old flat-array sheets).
      if (longRange === undefined) {
        const lookupName = isUnarmed ? "Unarmed Strike" : spec?.name ?? equippedWeapon?.name ?? "";
        const catalogEntry = lookupWeapon(lookupName);
        if (catalogEntry?.range) {
          if (normalRange === undefined) normalRange = catalogEntry.range[0];
          longRange = catalogEntry.range[1];
          if (this.debugLogsEnabled) console.log(`[AttackHandlers] Catalog fallback range for ${lookupName}: ${normalRange}/${longRange}`);
        }
      }

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

    // Derive advantage/disadvantage from conditions, ActiveEffects, and situational rules
    const rollMode = await this.computeAttackRollModifiers({
      actorCombatant,
      targetCombatant,
      targetId: targetId!,
      inferredKind,
      inferredProperties,
      actorSheet,
      normalRange,
      dist,
      actorPos,
      combatantStates,
      encounterId,
    });

    // Parse attack enhancement declarations via class combat text profiles
    // Only match "onDeclare" enhancements — "onHit" enhancements (Stunning Strike, Divine Smite, OHT)
    // are offered post-hit and opted into via damage roll text (2024 rules).
    const normalizedRes = normalizeResources(actorCombatant.resources);
    const resourcePools = getResourcePools(normalizedRes);
    const attackEnhancements = matchAttackEnhancements(
      text, inferredKind, actorClassName, actorLevel,
      normalizedRes, resourcePools, getAllCombatTextProfiles(),
      "onDeclare",
      (actorSheet?.subclass as string) ?? "",
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

    // D&D 5e 2024 Rogue Cunning Strike (L5+): parse optional text rider.
    // poison/trip require melee. disarm/daze/withdraw work with any SA-eligible attack.
    const cunningStrikeOption = parseCunningStrikeOption(text);
    if (cunningStrikeOption) {
      if (!classHasFeature(actorClassName, CUNNING_STRIKE, actorLevel)) {
        throw new ValidationError(
          "Cunning Strike requires Rogue level 5 or higher.",
        );
      }
      if (
        (cunningStrikeOption === "poison" || cunningStrikeOption === "trip") &&
        weaponSpec.kind !== "melee"
      ) {
        throw new ValidationError(
          `Cunning Strike (${cunningStrikeOption}) requires a melee attack.`,
        );
      }
      pendingAction.cunningStrike = cunningStrikeOption;
      if (this.debugLogsEnabled) {
        console.log(`[AttackHandlers] Cunning Strike option declared: ${cunningStrikeOption}`);
      }
    }

    await this.deps.combatRepo.setPendingAction(encounterId, pendingAction);

    const attackerName = actorSource?.name ?? "The attacker";
    const narration = await this.eventEmitter.generateNarration("attackRequest", {
      attackerName,
      targetName: (target as any).name,
      weaponName: weaponSpec.name,
    });

    const rollModeText = rollModePrompt(rollMode);
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

  // ── Private helpers (extracted from handleAttackAction for readability) ──

  /**
   * Parse the Thrown range from weapon properties.
   * E.g. "Thrown (Range 20/60)" → { normal: 20, long: 60 }
   */
  private parseThrownRange(props: string[]): { normal: number; long: number } | null {
    for (const p of props) {
      const match = typeof p === "string" && p.match(/thrown\s*\(\s*range\s+(\d+)\s*\/\s*(\d+)\s*\)/i);
      if (match) return { normal: parseInt(match[1]!, 10), long: parseInt(match[2]!, 10) };
    }
    if (props.some(p => typeof p === "string" && p.toLowerCase().trim() === "thrown")) return { normal: 20, long: 60 };
    return null;
  }

  /**
   * Find a throwable weapon from the actor's attacks, optionally matching a name from user text.
   * Matches both melee weapons with Thrown (e.g. Handaxe) AND ranged weapons with Thrown (e.g. Dart).
   */
  private findThrownWeapon(actorSheet: any, loweredText: string): any | null {
    const allAttacks = (actorSheet?.attacks ?? actorSheet?.equipment?.weapons ?? []) as any[];
    const throwable = allAttacks.filter((a: any) => {
      const props = (a.properties ?? []) as string[];
      return props.some((p: string) => typeof p === "string" && /thrown/i.test(p));
    });
    if (throwable.length === 0) return null;
    const named = throwable.find((w: any) => w.name && loweredText.includes(w.name.toLowerCase()));
    if (named) return named;
    const throwObjMatch = loweredText.match(/\b(?:throw|hurl|toss)\s+(?:a\s+|the\s+|my\s+)?(\w+)/);
    if (throwObjMatch) {
      const thrownObj = throwObjMatch[1]!;
      const genericWords = ["at", "it", "that", "something", "anything", "one", "weapon"];
      if (!genericWords.includes(thrownObj)) {
        return null;
      }
    }
    return throwable[0];
  }

  /**
   * Resolve thrown range for a weapon — from the range field for ranged+Thrown weapons
   * (e.g. Dart) or from the Thrown property for melee+Thrown weapons (e.g. Handaxe).
   */
  private resolveThrownRange(weapon: any): { normalRange?: number; longRange?: number } {
    if (weapon.kind === "ranged" && weapon.range && typeof weapon.range === "string" && weapon.range.toLowerCase() !== "melee") {
      const parts = weapon.range.split("/").map(Number);
      const normalRange = parts.length >= 1 && !isNaN(parts[0]) ? parts[0] : undefined;
      const longRange = parts.length >= 2 && !isNaN(parts[1]) ? parts[1] : undefined;
      return { normalRange, longRange };
    }
    // Use weapon catalog for accurate thrown ranges (e.g., Javelin 30/120 not hardcoded 20/60)
    const weaponName = typeof weapon.name === "string" ? weapon.name : "";
    const catalogRange = getWeaponThrownRange(weaponName, (weapon.properties ?? []) as string[]);
    if (catalogRange) return { normalRange: catalogRange[0], longRange: catalogRange[1] };
    const range = this.parseThrownRange((weapon.properties ?? []) as string[]);
    return range ? { normalRange: range.normal, longRange: range.long } : {};
  }

  /**
   * Compute cover AC bonus from terrain between attacker and target.
   * Throws ValidationError if target has full cover.
   */
  private async computeCoverACBonus(
    encounterId: string,
    actorPos: { x: number; y: number },
    targetPos: { x: number; y: number },
  ): Promise<number> {
    const encounter = await this.deps.combatRepo.getEncounterById(encounterId);
    const map = encounter?.mapData as unknown as CombatMap | undefined;
    if (map && map.cells && map.cells.length > 0) {
      const coverLevel = getCoverLevel(map, actorPos, targetPos);
      if (coverLevel === "full") {
        throw new ValidationError("Target has full cover and cannot be targeted");
      }
      const bonus = getCoverACBonus(coverLevel);
      if (this.debugLogsEnabled && bonus > 0) {
        console.log(`[AttackHandlers] Target has ${coverLevel} cover → +${bonus} AC bonus`);
      }
      return bonus;
    }
    return 0;
  }

  /**
   * Resolve magic weapon bonuses (+1/+2/+3) from inventory for the given weapon.
   */
  private resolveMagicWeaponBonuses(
    currentResources: any,
    weaponName: string,
    kind: "melee" | "ranged",
  ): { attackBonus: number; damageBonus: number } {
    const inventory = getInventory(currentResources);
    if (inventory.length > 0) {
      const bonuses = getWeaponMagicBonuses(inventory, weaponName, lookupMagicItemById, kind);
      if (bonuses.attackBonus !== 0 || bonuses.damageBonus !== 0) {
        if (this.debugLogsEnabled) {
          console.log(`[AttackHandlers] Magic weapon bonus: +${bonuses.attackBonus} attack, +${bonuses.damageBonus} damage`);
        }
        return bonuses;
      }
    }
    return { attackBonus: 0, damageBonus: 0 };
  }

  /**
   * Detect versatile weapon grip (1h/2h) and compute effective dice sides.
   */
  private resolveVersatileGrip(
    spec: any,
    equippedWeapon: any,
    text: string,
    isThrownAttack: boolean,
    actorSheet: any,
    baseDiceSides: number,
    diceCount: number,
  ): { hands?: 1 | 2; effectiveDiceSides: number } {
    const weaponProps = (spec?.properties ?? (equippedWeapon as any)?.properties ?? []) as string[];
    const isVersatile = weaponProps.some((p: string) => typeof p === "string" && p.toLowerCase() === "versatile");
    if (!isVersatile) return { effectiveDiceSides: baseDiceSides };

    const versatileDamage = (spec as any)?.versatileDamage ?? (equippedWeapon as any)?.versatileDamage;
    const textLower = text.toLowerCase();
    const explicitTwoHanded = /\b(two.hand(?:ed)?|2h|two hand(?:ed)?)\b/.test(textLower);
    const explicitOneHanded = /\b(one.hand(?:ed)?|1h|one hand(?:ed)?)\b/.test(textLower);

    let hands: 1 | 2;
    if (explicitOneHanded) {
      hands = 1;
    } else if (explicitTwoHanded) {
      hands = 2;
    } else if (isThrownAttack) {
      hands = 1;
    } else {
      // D&D 5e 2024: versatile weapons default to one-handed.
      // Two-handed grip requires explicit player intent ("two-handed", "2h", "with two hands", etc.).
      hands = 1;
    }

    let effectiveDiceSides = baseDiceSides;
    if (hands === 2 && versatileDamage?.diceSides) {
      effectiveDiceSides = versatileDamage.diceSides;
      if (this.debugLogsEnabled) console.log(`[AttackHandlers] Versatile weapon wielded two-handed → ${diceCount}d${effectiveDiceSides}`);
    } else if (hands === 1) {
      if (this.debugLogsEnabled) console.log(`[AttackHandlers] Versatile weapon wielded one-handed → ${diceCount}d${effectiveDiceSides}`);
    }

    return { hands, effectiveDiceSides };
  }

  /**
   * Ensure the weapon is drawn; auto-draw using free Object Interaction if available.
   * Returns updated resources (may set objectInteractionUsed).
   */
  private async ensureWeaponDrawn(
    weaponName: string,
    isUnarmed: boolean,
    currentResources: any,
    combatantId: string,
  ): Promise<any> {
    if (isUnarmed || weaponName === "Attack") return currentResources;

    const drawnWeapons = getDrawnWeapons(currentResources);
    if (drawnWeapons === undefined || drawnWeapons.some(n => n.toLowerCase() === weaponName.toLowerCase())) {
      return currentResources;
    }

    const attackResources = normalizeResources(currentResources);
    const objInteractionUsed = readBoolean(attackResources, "objectInteractionUsed") ?? false;
    if (!objInteractionUsed) {
      let updated = addDrawnWeapon(currentResources, weaponName);
      updated = { ...(updated as Record<string, unknown>), objectInteractionUsed: true } as any;
      await this.deps.combatRepo.updateCombatantState(combatantId, {
        resources: updated as any,
      });
      if (this.debugLogsEnabled) console.log(`[AttackHandlers] Auto-drew ${weaponName} (free interaction)`);
      return updated;
    }

    const drawn = drawnWeapons.join(", ");
    const hint = drawn ? ` Currently drawn: ${drawn}.` : "";
    throw new ValidationError(
      `${weaponName} is not drawn and your free Object Interaction is already used this turn.${hint} ` +
      `Use "draw ${weaponName}" on your next turn, or drop your current weapon (free) and pick up ${weaponName}.`,
    );
  }

  /**
   * Compute advantage/disadvantage from conditions, ActiveEffects, ranged situational rules,
   * and consume one-use effects (Vex, Help). Returns the final roll mode.
   */
  private async computeAttackRollModifiers(params: {
    actorCombatant: any;
    targetCombatant: any;
    targetId: string;
    inferredKind: "melee" | "ranged";
    inferredProperties?: string[];
    actorSheet: any;
    normalRange?: number;
    dist: number;
    actorPos: { x: number; y: number };
    combatantStates: any[];
    encounterId: string;
  }): Promise<"normal" | "advantage" | "disadvantage"> {
    const {
      actorCombatant, targetCombatant, targetId,
      inferredKind, inferredProperties, actorSheet,
      normalRange, dist, actorPos, combatantStates,
      encounterId,
    } = params;

    let extraDisadvantage = 0;
    let extraAdvantage = 0;
    const encounter = await this.deps.combatRepo.getEncounterById(encounterId);
    const mapData = encounter?.mapData as unknown as FlankingCombatMap | undefined;
    const targetPos = getPosition(targetCombatant.resources ?? {});

    if (mapData && targetPos && hasElevationAdvantage(mapData as unknown as CombatMap, actorPos, targetPos)) {
      extraAdvantage++;
      if (this.debugLogsEnabled) {
        console.log("[AttackHandlers] Higher ground detected -> advantage on attack roll");
      }
    }

    // D&D 5e 2024: Obscuration-based attack modifiers
    if (mapData && targetPos) {
      const obscMods = getObscurationAttackModifiers(mapData as unknown as CombatMap, actorPos, targetPos);
      extraAdvantage += obscMods.advantage;
      extraDisadvantage += obscMods.disadvantage;
      if (this.debugLogsEnabled && (obscMods.advantage > 0 || obscMods.disadvantage > 0)) {
        console.log(`[AttackHandlers] Obscuration: +${obscMods.advantage} advantage, +${obscMods.disadvantage} disadvantage`);
      }
    }

    // D&D 5e 2024 Flanking (optional rule): melee attacks gain advantage when
    // the attacker and an ally are on opposite sides of the target.
    if (inferredKind === "melee") {
      if (mapData?.flankingEnabled) {
        if (targetPos) {
          // Gather positions of living allies (same faction as attacker, excluding attacker and target)
          const actorFaction = this.getActorFaction(actorCombatant, combatantStates);
          const allyPositions: Array<{ x: number; y: number }> = [];
          for (const c of combatantStates) {
            if (c.id === actorCombatant.id || c.id === targetCombatant.id) continue;
            if (c.hpCurrent <= 0) continue;
            const cFaction = this.getActorFaction(c, combatantStates);
            if (cFaction !== actorFaction) continue;
            // Skip incapacitated allies
            const cConditions = normalizeConditions(c.conditions as unknown[]);
            if (cConditions.some((cond: any) => {
              const name = typeof cond === "string" ? cond : cond?.name;
              return name?.toLowerCase() === "incapacitated";
            })) continue;
            const cPos = getPosition(c.resources ?? {});
            if (cPos) allyPositions.push(cPos);
          }
          if (checkFlanking(actorPos, targetPos, allyPositions)) {
            extraAdvantage++;
            if (this.debugLogsEnabled) console.log(`[AttackHandlers] Flanking detected → advantage on melee attack`);
          }
        }
      }
    }

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
        // BUG-2 fix: Dead combatants (HP 0) don't threaten — skip them
        if (c.hpCurrent != null && c.hpCurrent <= 0) return false;
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

    // ActiveEffect-based advantage/disadvantage
    const actorActiveEffects = getActiveEffects(actorCombatant.resources ?? {});
    const targetActiveEffects = getActiveEffects(targetCombatant.resources ?? {});
    if (hasAdvantageFromEffects(actorActiveEffects, 'attack_rolls')) {
      extraAdvantage++;
      if (this.debugLogsEnabled) console.log(`[AttackHandlers] ActiveEffect: attacker has advantage on attack_rolls`);
    }
    if (inferredKind === 'melee' && hasAdvantageFromEffects(actorActiveEffects, 'melee_attack_rolls')) {
      extraAdvantage++;
      if (this.debugLogsEnabled) console.log(`[AttackHandlers] ActiveEffect: attacker has advantage on melee_attack_rolls`);
    }
    if (inferredKind === 'ranged' && hasAdvantageFromEffects(actorActiveEffects, 'ranged_attack_rolls')) {
      extraAdvantage++;
      if (this.debugLogsEnabled) console.log(`[AttackHandlers] ActiveEffect: attacker has advantage on ranged_attack_rolls`);
    }
    if (hasDisadvantageFromEffects(actorActiveEffects, 'attack_rolls')) {
      extraDisadvantage++;
      if (this.debugLogsEnabled) console.log(`[AttackHandlers] ActiveEffect: attacker has disadvantage on attack_rolls`);
    }
    if (inferredKind === 'melee' && hasDisadvantageFromEffects(actorActiveEffects, 'melee_attack_rolls')) {
      extraDisadvantage++;
      if (this.debugLogsEnabled) console.log(`[AttackHandlers] ActiveEffect: attacker has disadvantage on melee_attack_rolls`);
    }
    if (inferredKind === 'ranged' && hasDisadvantageFromEffects(actorActiveEffects, 'ranged_attack_rolls')) {
      extraDisadvantage++;
      if (this.debugLogsEnabled) console.log(`[AttackHandlers] ActiveEffect: attacker has disadvantage on ranged_attack_rolls`);
    }
    // Target's effects that affect attacks against them (e.g., Dodge, Faerie Fire, Reckless Attack incoming)
    for (const eff of targetActiveEffects) {
      if (eff.target !== 'attack_rolls' && eff.target !== 'melee_attack_rolls' && eff.target !== 'ranged_attack_rolls') continue;
      if (eff.target === 'melee_attack_rolls' && inferredKind !== 'melee') continue;
      if (eff.target === 'ranged_attack_rolls' && inferredKind !== 'ranged') continue;
      if (eff.targetCombatantId && eff.targetCombatantId !== targetId) continue;
      if (!eff.targetCombatantId) continue;
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
    const vexEffect = actorActiveEffects.find(
      e => e.source === 'Vex' && e.type === 'advantage' && e.duration === 'until_triggered'
        && e.targetCombatantId === targetId
    );
    if (vexEffect) {
      extraAdvantage++;
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
      let updatedTargetRes: Record<string, unknown> = (targetCombatant.resources ?? {}) as Record<string, unknown>;
      for (const helpEff of helpEffects) {
        updatedTargetRes = removeActiveEffectById(updatedTargetRes, helpEff.id) as Record<string, unknown>;
      }
      await this.deps.combatRepo.updateCombatantState(targetCombatant.id, {
        resources: updatedTargetRes as any,
      });
      if (this.debugLogsEnabled) console.log(`[AttackHandlers] Help action advantage consumed on attack against ${targetId}`);
    }

    // Brutal Strike (Staggering Blow): disadvantage on next attack roll or saving throw.
    // Apply once and consume immediately when used by an attack roll.
    const staggeringEffect = actorActiveEffects.find(
      (e) =>
        e.source === "Brutal Strike: Staggering Blow"
        && e.type === "disadvantage"
        && e.target === "custom"
        && e.duration === "until_triggered",
    );
    if (staggeringEffect) {
      extraDisadvantage++;
      const updatedRes = removeActiveEffectById(actorCombatant.resources ?? {}, staggeringEffect.id);
      await this.deps.combatRepo.updateCombatantState(actorCombatant.id, {
        resources: updatedRes as any,
      });
      if (this.debugLogsEnabled) {
        console.log(`[AttackHandlers] Brutal Strike Staggering Blow consumed on attack for ${actorCombatant.id}`);
      }
    }

    return deriveRollModeFromConditions(attackerConditions, targetConditions, inferredKind, extraAdvantage, extraDisadvantage, dist);
  }

  /**
   * Determine combatant faction from the relational data embedded in the combatant record.
   * Falls back to combatantType as a crude faction proxy.
   */
  private getActorFaction(combatant: any, _combatantStates: any[]): string {
    const char = combatant.character;
    const mon = combatant.monster;
    const npc = combatant.npc;
    if (char?.faction) return char.faction;
    if (mon?.faction) return mon.faction;
    if (npc?.faction) return npc.faction;
    // Check resources for faction (stored by scenario runner / combat start)
    const resFaction = (combatant.resources ?? {}).faction;
    if (typeof resFaction === "string") return resFaction;
    // Crude fallback: Characters are "party", Monsters are "enemies"
    if (combatant.combatantType === "Character") return "party";
    if (combatant.combatantType === "NPC") return "party";
    return "enemies";
  }
}
