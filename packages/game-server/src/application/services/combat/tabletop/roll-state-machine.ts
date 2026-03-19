/**
 * RollStateMachine - Handles all dice-roll resolution for tabletop combat.
 *
 * Manages the state transitions:
 *   INITIATIVE → combat started
 *   ATTACK     → hit/miss → DAMAGE pending
 *   DAMAGE     → HP reduction, victory check, flurry strike 2
 *   DEATH_SAVE → stabilized / dead / revived
 *
 * Extracted from TabletopCombatService (Phase 3, Step 14).
 */

import { nanoid } from "nanoid";
import { ValidationError } from "../../../errors.js";
import { calculateDistance } from "../../../../domain/rules/movement.js";
import {
  getPosition,
  normalizeResources,
  getResourcePools,
  updateResourcePool,
  readBoolean,
  readNumber,
  hasResourceAvailable,
  spendResourceFromPool,
  hasBonusActionAvailable,
  useBonusAction,
  getActiveEffects,
  setActiveEffects,
  addActiveEffectsToResources,
  isConditionImmuneByEffects,
} from "../helpers/resource-utils.js";
import {
  calculateBonusFromEffects,
  calculateFlatBonusFromEffects,
  createEffect,
  getDamageDefenseEffects,
  getEffectsByType,
  removeTriggeredEffects,
  type ActiveEffect,
  type DiceValue,
} from "../../../../domain/entities/combat/effects.js";
import { applyKoEffectsIfNeeded, applyDamageWhileUnconscious } from "../helpers/ko-handler.js";
import { ClassFeatureResolver } from "../../../../domain/entities/classes/class-feature-resolver.js";
import { hasFeralInstinct } from "../../../../domain/entities/classes/barbarian.js";
import { hasDangerSense } from "../../../../domain/entities/classes/barbarian.js";
import { divineSmiteDice } from "../../../../domain/entities/classes/paladin.js";
import { buildCombatResources } from "../../../../domain/entities/classes/combat-resource-builder.js";
import { isFinesse } from "../../../../domain/entities/items/weapon-properties.js";
import { getEligibleOnHitEnhancements, matchOnHitEnhancementsInText } from "../../../../domain/entities/classes/combat-text-profile.js";
import { getAllCombatTextProfiles } from "../../../../domain/entities/classes/registry.js";
import {
  normalizeConditions,
  readConditionNames,
  addCondition,
  removeCondition,
  createCondition,
  type Condition,
} from "../../../../domain/entities/combat/conditions.js";
import {
  buildGameCommandSchemaHint,
  parseGameCommand,
  type LlmRoster,
} from "../../../commands/game-command.js";
import { applyDamageDefenses, extractDamageDefenses } from "../../../../domain/rules/damage-defenses.js";
import type { CombatVictoryStatus } from "../combat-victory-policy.js";
import { sneakAttackDiceForLevel, isSneakAttackEligible } from "../../../../domain/entities/classes/rogue.js";
import { getMartialArtsDieSize } from "../../../../domain/rules/martial-arts-die.js";
import {
  makeDeathSave,
  applyDeathSaveResult,
  resetDeathSaves,
  takeDamageWhileUnconscious,
  type DeathSaves,
} from "../../../../domain/rules/death-saves.js";

import { computeFeatModifiers } from "../../../../domain/rules/feat-modifiers.js";
import { doubleDiceInFormula, parseDamageModifier } from "./combat-text-parser.js";
import type { TabletopEventEmitter } from "./tabletop-event-emitter.js";
import { SavingThrowResolver } from "./saving-throw-resolver.js";
import type { WeaponMasteryProperty } from "../../../../domain/rules/weapon-mastery.js";
import { concentrationCheckOnDamage } from "../../../../domain/rules/concentration.js";
import {
  getConcentrationSpellName,
  breakConcentration,
  computeConSaveModifier,
} from "../helpers/concentration-helper.js";
import { addGroundItem } from "../../../../domain/rules/combat-map.js";
import type { CombatMap } from "../../../../domain/rules/combat-map.js";
import type { GroundItem } from "../../../../domain/entities/items/ground-item.js";
import type {
  TabletopCombatServiceDeps,
  TabletopPendingAction,
  InitiatePendingAction,
  InitiativeSwapPendingAction,
  AttackPendingAction,
  DamagePendingAction,
  DeathSavePendingAction,
  SavingThrowPendingAction,
  SavingThrowAutoResult,
  CombatStartedResult,
  AttackResult,
  DamageResult,
  HitRiderEnhancement,
  HitRiderEnhancementResult,
  SaveOutcome,
  SurpriseSpec,
} from "./tabletop-types.js";

// ----- Standalone helper -----

/**
 * Check if a creature is surprised based on the surprise spec.
 * @param creatureId The creature's canonical ID (characterId / monsterId / npcId)
 * @param surprise The surprise spec from the initiate action
 * @param side Which side the creature is on ("party" for PCs/NPCs, "enemy" for monsters)
 */
function isCreatureSurprised(
  creatureId: string,
  surprise: SurpriseSpec | undefined,
  side: "party" | "enemy",
): boolean {
  if (!surprise) return false;
  if (surprise === "party") return side === "party";
  if (surprise === "enemies") return side === "enemy";
  return surprise.surprised.includes(creatureId);
}

/**
 * Compute the initiative roll mode for a server-rolled creature.
 * Factors in surprise + pre-combat conditions (Invisible, Incapacitated).
 * D&D 5e 2024: advantage + disadvantage cancel to normal.
 */
function computeInitiativeRollMode(
  creatureId: string,
  surprise: SurpriseSpec | undefined,
  side: "party" | "enemy",
  conditions?: unknown[],
  classInfo?: { className: string; level: number },
): "normal" | "advantage" | "disadvantage" {
  let adv = 0;
  let disadv = 0;

  if (isCreatureSurprised(creatureId, surprise, side)) disadv++;

  let isIncapacitated = false;
  if (conditions && Array.isArray(conditions)) {
    const condLower = conditions.map((c: unknown) =>
      typeof c === "string" ? c.toLowerCase()
        : typeof c === "object" && c !== null && "condition" in c ? String((c as any).condition).toLowerCase()
        : "",
    );
    if (condLower.includes("invisible")) adv++;
    if (condLower.includes("incapacitated")) isIncapacitated = true;
    if (isIncapacitated) disadv++;
  }

  // D&D 5e 2024: Feral Instinct (Barbarian 7+) grants advantage on initiative
  // and negates surprise disadvantage if not incapacitated
  if (classInfo && classInfo.className.toLowerCase() === "barbarian" && hasFeralInstinct(classInfo.level)) {
    adv++;
    if (isCreatureSurprised(creatureId, surprise, side) && !isIncapacitated && disadv > 0) {
      disadv--;
    }
  }

  if (adv > 0 && disadv > 0) return "normal";
  if (adv > 0) return "advantage";
  if (disadv > 0) return "disadvantage";
  return "normal";
}

/**
 * Roll initiative with the given mode using a dice roller.
 * advantage → 2d20 take highest, disadvantage → 2d20 take lowest.
 */
function rollInitiativeD20(
  diceRoller: { d20(): { total: number } } | undefined,
  mode: "normal" | "advantage" | "disadvantage",
): number {
  if (!diceRoller) return 10;
  const roll1 = diceRoller.d20().total;
  if (mode === "normal") return roll1;
  const roll2 = diceRoller.d20().total;
  return mode === "advantage" ? Math.max(roll1, roll2) : Math.min(roll1, roll2);
}

/**
 * Load session entities and build an LlmRoster.
 * Shared by TabletopCombatService, RollStateMachine, and ActionDispatcher.
 */
export async function loadRoster(
  deps: Pick<TabletopCombatServiceDeps, "characters" | "monsters" | "npcs">,
  sessionId: string,
) {
  const characters = await deps.characters.listBySession(sessionId);
  const monsters = await deps.monsters.listBySession(sessionId);
  const npcs = await deps.npcs.listBySession(sessionId);

  const roster: LlmRoster = {
    characters: characters.map((c) => ({ id: c.id, name: c.name })),
    monsters: monsters.map((m) => ({ id: m.id, name: m.name })),
    npcs: npcs.map((n) => ({ id: n.id, name: n.name })),
  };

  return { characters, monsters, npcs, roster };
}

// ----- RollStateMachine -----

export class RollStateMachine {
  private readonly savingThrowResolver: SavingThrowResolver | null;

  constructor(
    private readonly deps: TabletopCombatServiceDeps,
    private readonly eventEmitter: TabletopEventEmitter,
    private readonly debugLogsEnabled: boolean,
  ) {
    this.savingThrowResolver = deps.diceRoller
      ? new SavingThrowResolver(deps.combatRepo, deps.diceRoller, debugLogsEnabled)
      : null;
  }

  /**
   * Drop a thrown weapon on the ground at the target position after a thrown attack.
   * Creates a GroundItem from the WeaponSpec and persists the updated map.
   */
  private async dropThrownWeaponOnGround(
    encounter: any,
    actorId: string,
    targetId: string,
    weaponSpec: { name: string; kind: "melee" | "ranged"; attackBonus: number; damage?: { diceCount: number; diceSides: number; modifier: number }; damageType?: string; properties?: string[]; normalRange?: number; longRange?: number; mastery?: string },
    round: number,
  ): Promise<void> {
    const mapData = encounter.mapData as CombatMap | undefined;
    if (!mapData) return;

    // Find target position — that's where the thrown weapon lands
    const combatants = await this.deps.combatRepo.listCombatants(encounter.id);
    const targetCombatant = combatants.find(
      (c: any) => c.characterId === targetId || c.monsterId === targetId || c.npcId === targetId,
    );
    const targetPos = targetCombatant ? getPosition(targetCombatant.resources ?? {}) : null;
    if (!targetPos) return;

    // Build range string from normalRange/longRange
    let rangeStr: string | undefined;
    if (weaponSpec.normalRange && weaponSpec.normalRange > 0) {
      rangeStr = weaponSpec.longRange
        ? `${weaponSpec.normalRange}/${weaponSpec.longRange}`
        : `${weaponSpec.normalRange}`;
    }

    const groundItem: GroundItem = {
      id: nanoid(),
      name: weaponSpec.name,
      position: { ...targetPos },
      source: "thrown",
      droppedBy: actorId,
      round,
      weaponStats: {
        name: weaponSpec.name,
        kind: weaponSpec.kind === "ranged" ? "ranged" : "melee",
        ...(rangeStr ? { range: rangeStr } : {}),
        attackBonus: weaponSpec.attackBonus,
        damage: weaponSpec.damage ?? { diceCount: 1, diceSides: 4, modifier: 0 },
        ...(weaponSpec.damageType ? { damageType: weaponSpec.damageType } : {}),
        ...(weaponSpec.properties ? { properties: weaponSpec.properties } : {}),
        ...(weaponSpec.mastery ? { mastery: weaponSpec.mastery } : {}),
      },
    };

    const updatedMap = addGroundItem(mapData, groundItem);
    await this.deps.combatRepo.updateEncounter(encounter.id, { mapData: updatedMap as any });

    if (this.debugLogsEnabled) {
      console.log(`[RollStateMachine] Thrown weapon ${weaponSpec.name} dropped at (${targetPos.x}, ${targetPos.y}) by ${actorId}`);
    }
  }

  /**
   * Drop loot from a defeated monster onto the battlefield as ground items.
   * Reads the `loot` array from the monster's stat block and places each item
   * at the monster's last known position on the map.
   */
  private async dropMonsterLoot(
    encounter: any,
    targetCombatant: any,
    monsters: any[],
  ): Promise<void> {
    const mapData = encounter.mapData as CombatMap | undefined;
    if (!mapData) return;

    // Find the monster record for its stat block
    const monsterId = targetCombatant.monsterId;
    const monster = monsters.find((m) => m.id === monsterId);
    if (!monster) return;

    const statBlock = monster.statBlock as Record<string, unknown> | undefined;
    const loot = statBlock?.loot;
    if (!Array.isArray(loot) || loot.length === 0) return;

    // Get monster's position for drop location
    const monsterPos = getPosition(targetCombatant.resources ?? {});
    if (!monsterPos) return;

    let currentMap = mapData;
    for (const lootEntry of loot) {
      if (!lootEntry || typeof lootEntry !== "object") continue;
      const entry = lootEntry as Record<string, unknown>;
      const name = entry.name;
      if (typeof name !== "string") continue;

      const groundItem: GroundItem = {
        id: nanoid(),
        name,
        position: { ...monsterPos },
        source: "loot",
        round: encounter.round ?? 1,
        ...(entry.weaponStats && typeof entry.weaponStats === "object"
          ? { weaponStats: entry.weaponStats as GroundItem["weaponStats"] }
          : {}),
        ...(entry.inventoryItem && typeof entry.inventoryItem === "object"
          ? { inventoryItem: entry.inventoryItem as GroundItem["inventoryItem"] }
          : {}),
      };

      currentMap = addGroundItem(currentMap, groundItem);

      if (this.debugLogsEnabled) {
        console.log(`[RollStateMachine] Monster loot dropped: ${name} at (${monsterPos.x}, ${monsterPos.y})`);
      }
    }

    await this.deps.combatRepo.updateEncounter(encounter.id, { mapData: currentMap as any });
  }

  /**
   * Process a roll result (initiative, attack, damage, death save, or saving throw).
   * Routes to the appropriate handler based on the pending action type.
   * SAVING_THROW actions are auto-resolved (no player roll needed).
   */
  async processRollResult(
    sessionId: string,
    text: string,
    actorId: string,
  ): Promise<CombatStartedResult | AttackResult | DamageResult | SavingThrowAutoResult> {
    const { characters, monsters, npcs, roster } = await loadRoster(this.deps, sessionId);

    // Get pending action
    const encounters = await this.deps.combatRepo.listEncountersBySession(sessionId);
    const encounter = encounters.find((e: any) => e.status === "Pending" || e.status === "Active") ?? encounters[0];

    if (!encounter) {
      throw new ValidationError("No active encounter found");
    }

    const pendingAction = await this.deps.combatRepo.getPendingAction(encounter.id);
    if (!pendingAction || typeof pendingAction !== "object") {
      throw new ValidationError("No pending action found");
    }

    const action = pendingAction as TabletopPendingAction;

    // Determine expected roll type
    let expectedRollType = "initiative";
    if (action.type === "ATTACK") expectedRollType = "attack";
    else if (action.type === "DAMAGE") expectedRollType = "damage";
    else if (action.type === "DEATH_SAVE") expectedRollType = "deathSave";
    else if (action.type === "SAVING_THROW") expectedRollType = "savingThrow";
    else if (action.type === "INITIATIVE_SWAP") expectedRollType = "initiativeSwap";

    // SAVING_THROW is auto-resolved — no player roll needed
    if (action.type === "SAVING_THROW") {
      return this.handleSavingThrowAction(sessionId, encounter, action as SavingThrowPendingAction, characters, monsters, npcs);
    }

    // INITIATIVE_SWAP is a choice, not a dice roll — handle before parseRollValue
    if (action.type === "INITIATIVE_SWAP") {
      return this.handleInitiativeSwap(
        action as InitiativeSwapPendingAction,
        text,
        characters,
        monsters,
        npcs,
      );
    }

    // Parse roll value
    const command = await this.parseRollValue(text, expectedRollType, roster);

    // Route to appropriate handler
    if (action.type === "INITIATIVE" && command.rollType === "initiative") {
      return this.handleInitiativeRoll(sessionId, encounter, action, command, actorId, characters, monsters, npcs);
    }

    if (action.type === "ATTACK" && command.rollType === "attack") {
      return this.handleAttackRoll(sessionId, encounter, action, command, actorId, characters, monsters, npcs);
    }

    if (action.type === "DAMAGE" && command.rollType === "damage") {
      return this.handleDamageRoll(sessionId, encounter, action, command, actorId, characters, monsters, npcs, text);
    }

    if (action.type === "DEATH_SAVE") {
      return this.handleDeathSaveRoll(sessionId, encounter, action as DeathSavePendingAction, command, actorId);
    }

    throw new ValidationError(`Roll type ${command.rollType} not yet implemented for action type ${action.type}`);
  }

  // ----- Private helpers -----

  private async parseRollValue(text: string, expectedRollType: string, roster: LlmRoster) {
    const numberFromText = (() => {
      const m = text.match(/\b(\d{1,3})\b/);
      if (!m) return null;
      const n = Number(m[1]);
      return Number.isFinite(n) ? n : null;
    })();

    const looksLikeARoll = /\broll(?:ed)?\b/i.test(text);

    if (looksLikeARoll && numberFromText !== null) {
      return { kind: "rollResult", value: numberFromText, rollType: expectedRollType };
    }

    if (!this.deps.intentParser) {
      if (numberFromText !== null) {
        return { kind: "rollResult", value: numberFromText, rollType: expectedRollType };
      }
      throw new ValidationError("Could not parse roll value from text and LLM is not configured");
    }

    const contextHint = `\n\nCONTEXT: The player has a pending action. When they say "I rolled X", interpret this as rollType="${expectedRollType}".`;
    const intent = await this.deps.intentParser.parseIntent({
      text,
      schemaHint: buildGameCommandSchemaHint(roster) + contextHint,
    });

    try {
      const command = parseGameCommand(intent);
      if (command.kind === "rollResult") return command;
      return {
        kind: "rollResult",
        value: (intent as any).value ?? (intent as any).result ?? (intent as any).roll,
        values: (intent as any).values,
        rollType: (intent as any).rollType ?? expectedRollType,
      };
    } catch {
      if (numberFromText !== null) {
        return { kind: "rollResult", value: numberFromText, rollType: expectedRollType };
      }
      return {
        kind: "rollResult",
        value: (intent as any).value ?? (intent as any).result ?? (intent as any).roll,
        rollType: expectedRollType,
      };
    }
  }

  // ----- Roll handlers -----

  private async handleInitiativeRoll(
    sessionId: string,
    encounter: any,
    action: InitiatePendingAction,
    command: any,
    actorId: string,
    characters: any[],
    monsters: any[],
    npcs: any[],
  ): Promise<CombatStartedResult> {
    const rollValue = command.value ?? (Array.isArray(command.values) ? command.values[0] : 0);

    const character = characters.find((c) => c.id === actorId);
    let dexModifier = 0;

    if (character && typeof character.sheet === "object" && character.sheet !== null) {
      const sheet = character.sheet as any;
      if (sheet.abilityScores?.dexterity) {
        dexModifier = Math.floor((sheet.abilityScores.dexterity - 10) / 2);
      }
    }

    // Alert feat: add proficiency bonus to initiative
    let alertBonus = 0;
    if (character && typeof character.sheet === "object" && character.sheet !== null) {
      const sheet = character.sheet as Record<string, unknown>;
      const charFeatIds: string[] = (sheet.featIds as string[] | undefined) ?? (sheet.feats as string[] | undefined) ?? [];
      if (charFeatIds.length > 0) {
        const featMods = computeFeatModifiers(charFeatIds);
        if (featMods.initiativeAddProficiency) {
          const charLevel = ClassFeatureResolver.getLevel(sheet as any, (character as any).level);
          alertBonus = ClassFeatureResolver.getProficiencyBonus(sheet as any, charLevel);
          if (this.debugLogsEnabled) console.log(`[RollStateMachine] Alert feat: +${alertBonus} proficiency bonus to initiative`);
        }
      }
    }

    const finalInitiative = rollValue + dexModifier + alertBonus;

    // Include all session monsters
    const intendedTargetIds: string[] = action.intendedTargets ?? (action.intendedTarget ? [action.intendedTarget] : []);
    const allMonsterIds = monsters.map((m) => m.id);
    const targetIds: string[] = [...new Set([...intendedTargetIds, ...allMonsterIds])];

    // Build combatants
    const combatants: any[] = [];

    if (character) {
      const sheet = character.sheet as any;
      const charPosition = sheet?.position;
      const charClassName = character.className ?? sheet?.className ?? "";
      const charLevel = ClassFeatureResolver.getLevel(sheet, character.level);

      // Build resources using centralized domain builder (class-agnostic)
      const combatRes = buildCombatResources({
        className: charClassName,
        level: charLevel,
        sheet: sheet ?? {},
      });

      const charResources: Record<string, unknown> = {};
      if (charPosition) {
        charResources.position = charPosition;
      }
      if (combatRes.resourcePools.length > 0) {
        charResources.resourcePools = combatRes.resourcePools;
      }
      if (combatRes.hasShieldPrepared) {
        (charResources as any).hasShieldPrepared = true;
      }
      if (combatRes.hasCounterspellPrepared) {
        (charResources as any).hasCounterspellPrepared = true;
      }
      if (combatRes.hasAbsorbElementsPrepared) {
        (charResources as any).hasAbsorbElementsPrepared = true;
      }
      if (combatRes.hasHellishRebukePrepared) {
        (charResources as any).hasHellishRebukePrepared = true;
      }

      // D&D 5e 2024: Danger Sense (Barbarian 2+) — permanent advantage on DEX saving throws
      if (charClassName.toLowerCase() === "barbarian" && hasDangerSense(charLevel)) {
        const dangerSenseEffect = createEffect(nanoid(), "advantage", "saving_throws", "permanent", {
          ability: "dexterity",
          source: "Danger Sense",
          description: "Advantage on DEX saving throws (Danger Sense)",
        });
        addActiveEffectsToResources(charResources, dangerSenseEffect);
      }

      // D&D 5e 2024: Track which weapons are currently drawn (in-hand).
      // At combat start, all character weapons are drawn and ready.
      const sheetAttacks = Array.isArray(sheet?.attacks) ? sheet.attacks as Array<{ name?: string }> : [];
      if (sheetAttacks.length > 0) {
        charResources.drawnWeapons = sheetAttacks
          .map(a => a.name)
          .filter((n): n is string => typeof n === "string" && n.length > 0);
      }

      // Initialize inventory from character sheet (potions, consumables, etc.)
      if (Array.isArray(sheet?.inventory) && sheet.inventory.length > 0) {
        charResources.inventory = sheet.inventory;
      }

      combatants.push({
        combatantType: "Character" as const,
        characterId: actorId,
        initiative: finalInitiative,
        hpCurrent: sheet?.currentHp ?? sheet?.maxHp ?? 10,
        hpMax: sheet?.maxHp ?? 10,
        resources: Object.keys(charResources).length > 0 ? charResources : undefined,
      });
    }

    // Add remaining session characters (multi-PC support)
    for (const otherChar of characters.filter((c) => c.id !== actorId)) {
      const otherSheet = otherChar.sheet as any;
      let otherDexMod = 0;
      if (otherSheet?.abilityScores?.dexterity) {
        otherDexMod = Math.floor((otherSheet.abilityScores.dexterity - 10) / 2);
      }

      // Extract class info early (needed for Feral Instinct initiative check)
      const otherClassName = otherChar.className ?? otherSheet?.className ?? "";
      const otherLevel = ClassFeatureResolver.getLevel(otherSheet ?? {}, (otherChar as any).level);

      // Alert feat bonus for non-initiator characters
      let otherAlertBonus = 0;
      const otherFeatIds: string[] = (otherSheet?.featIds as string[] | undefined) ?? (otherSheet?.feats as string[] | undefined) ?? [];
      if (otherFeatIds.length > 0) {
        const otherFeatMods = computeFeatModifiers(otherFeatIds);
        if (otherFeatMods.initiativeAddProficiency) {
          otherAlertBonus = ClassFeatureResolver.getProficiencyBonus(otherSheet ?? {}, otherLevel);
          if (this.debugLogsEnabled) console.log(`[RollStateMachine] Alert feat (multi-PC): +${otherAlertBonus} proficiency bonus for "${otherChar.name}"`);
        }
      }

      // Auto-roll initiative for non-initiator characters (with surprise/condition modifiers)
      const otherInitMode = computeInitiativeRollMode(otherChar.id, action.surprise, "party", otherSheet?.conditions, otherClassName && otherLevel > 0 ? { className: otherClassName, level: otherLevel } : undefined);
      const otherRoll = rollInitiativeD20(this.deps.diceRoller, otherInitMode);
      if (otherInitMode !== "normal" && this.debugLogsEnabled) {
        console.log(`[RollStateMachine] Character "${otherChar.name}" initiative with ${otherInitMode}: roll=${otherRoll}`);
      }
      const otherInitiative = otherRoll + otherDexMod + otherAlertBonus;

      // Build combat resources for this character
      const otherCombatRes = buildCombatResources({
        className: otherClassName,
        level: otherLevel,
        sheet: otherSheet ?? {},
      });

      const otherResources: Record<string, unknown> = {};
      if (otherSheet?.position) {
        otherResources.position = otherSheet.position;
      }
      if (otherCombatRes.resourcePools.length > 0) {
        otherResources.resourcePools = otherCombatRes.resourcePools;
      }
      if (otherCombatRes.hasShieldPrepared) {
        (otherResources as any).hasShieldPrepared = true;
      }
      if (otherCombatRes.hasCounterspellPrepared) {
        (otherResources as any).hasCounterspellPrepared = true;
      }
      if (otherCombatRes.hasAbsorbElementsPrepared) {
        (otherResources as any).hasAbsorbElementsPrepared = true;
      }
      if (otherCombatRes.hasHellishRebukePrepared) {
        (otherResources as any).hasHellishRebukePrepared = true;
      }

      // D&D 5e 2024: Danger Sense (Barbarian 2+) — permanent advantage on DEX saving throws
      if (otherClassName.toLowerCase() === "barbarian" && hasDangerSense(otherLevel)) {
        const dangerSenseEffect = createEffect(nanoid(), "advantage", "saving_throws", "permanent", {
          ability: "dexterity",
          source: "Danger Sense",
          description: "Advantage on DEX saving throws (Danger Sense)",
        });
        addActiveEffectsToResources(otherResources, dangerSenseEffect);
      }

      // D&D 5e 2024: Initialize drawn weapons for multi-PC characters
      const otherSheetAttacks = Array.isArray(otherSheet?.attacks) ? otherSheet.attacks as Array<{ name?: string }> : [];
      if (otherSheetAttacks.length > 0) {
        otherResources.drawnWeapons = otherSheetAttacks
          .map((a: { name?: string }) => a.name)
          .filter((n: string | undefined): n is string => typeof n === "string" && n.length > 0);
      }

      // Initialize inventory from character sheet (potions, consumables, etc.)
      if (Array.isArray(otherSheet?.inventory) && otherSheet.inventory.length > 0) {
        otherResources.inventory = otherSheet.inventory;
      }

      combatants.push({
        combatantType: "Character" as const,
        characterId: otherChar.id,
        initiative: otherInitiative,
        hpCurrent: otherSheet?.currentHp ?? otherSheet?.maxHp ?? 10,
        hpMax: otherSheet?.maxHp ?? 10,
        resources: Object.keys(otherResources).length > 0 ? otherResources : undefined,
      });

      if (this.debugLogsEnabled) console.log(`[RollStateMachine] Multi-PC: Added "${otherChar.name}" with initiative ${otherInitiative} (roll=${otherRoll}, dex=${otherDexMod}, alert=${otherAlertBonus})`);
    }

    for (const targetId of targetIds) {
      const monster = monsters.find((m) => m.id === targetId);
      if (monster) {
        const statBlock = monster.statBlock as any;
        const monsterDexMod = statBlock.abilityScores?.dexterity
          ? Math.floor((statBlock.abilityScores.dexterity - 10) / 2)
          : 0;

        // Extract class info early (needed for Feral Instinct initiative check)
        const monsterClassName = typeof statBlock?.className === "string" ? statBlock.className : "";
        const monsterLevel = typeof statBlock?.level === "number" ? statBlock.level : 0;

        // D&D 5e 2024: Use d20 roll for monster initiative (with surprise/condition modifiers)
        const monsterInitMode = computeInitiativeRollMode(targetId, action.surprise, "enemy", statBlock?.conditions, monsterClassName && monsterLevel > 0 ? { className: monsterClassName, level: monsterLevel } : undefined);
        const monsterRoll = rollInitiativeD20(this.deps.diceRoller, monsterInitMode);
        if (monsterInitMode !== "normal" && this.debugLogsEnabled) {
          console.log(`[RollStateMachine] Monster "${monster.name}" initiative with ${monsterInitMode}: roll=${monsterRoll}`);
        }
        const monsterInitiative = monsterRoll + monsterDexMod;

        const monsterPosition = statBlock?.position;
        const monsterResources: Record<string, unknown> = {};
        if (monsterPosition) {
          monsterResources.position = monsterPosition;
        }

        // Auto-initialize class resource pools for monsters with class levels
        if (monsterClassName && monsterLevel > 0) {
          const monsterCombatRes = buildCombatResources({
            className: monsterClassName,
            level: monsterLevel,
            sheet: statBlock ?? {},
          });
          if (monsterCombatRes.resourcePools.length > 0) {
            monsterResources.resourcePools = monsterCombatRes.resourcePools;
          }
          if (monsterCombatRes.hasShieldPrepared) {
            (monsterResources as any).hasShieldPrepared = true;
          }
          if (monsterCombatRes.hasCounterspellPrepared) {
            (monsterResources as any).hasCounterspellPrepared = true;
          }
          if (monsterCombatRes.hasAbsorbElementsPrepared) {
            (monsterResources as any).hasAbsorbElementsPrepared = true;
          }
          if (monsterCombatRes.hasHellishRebukePrepared) {
            (monsterResources as any).hasHellishRebukePrepared = true;
          }
        }

        combatants.push({
          combatantType: "Monster" as const,
          monsterId: targetId,
          initiative: monsterInitiative,
          hpCurrent: statBlock.hp ?? statBlock.maxHp ?? 10,
          hpMax: statBlock.maxHp ?? statBlock.hp ?? 10,
          resources: Object.keys(monsterResources).length > 0 ? monsterResources : undefined,
        });
      }
    }

    // Add NPCs to combat (party allies)
    for (const npc of npcs) {
      const statBlock = npc.statBlock as any;
      const npcDexMod = statBlock?.abilityScores?.dexterity
        ? Math.floor((statBlock.abilityScores.dexterity - 10) / 2)
        : 0;

      // Extract class info early (needed for Feral Instinct initiative check)
      const npcClassName = typeof statBlock?.className === "string" ? statBlock.className : "";
      const npcLevel = typeof statBlock?.level === "number" ? statBlock.level : 0;

      // D&D 5e 2024: Use d20 roll for NPC initiative (with surprise/condition modifiers)
      // NPCs are party allies, so they use "party" side for surprise
      const npcInitMode = computeInitiativeRollMode(npc.id, action.surprise, "party", statBlock?.conditions, npcClassName && npcLevel > 0 ? { className: npcClassName, level: npcLevel } : undefined);
      const npcRoll = rollInitiativeD20(this.deps.diceRoller, npcInitMode);
      if (npcInitMode !== "normal" && this.debugLogsEnabled) {
        console.log(`[RollStateMachine] NPC "${npc.name}" initiative with ${npcInitMode}: roll=${npcRoll}`);
      }
      const npcInitiative = npcRoll + npcDexMod;

      const npcPosition = statBlock?.position;
      const npcResources: Record<string, unknown> = {};
      if (npcPosition) {
        npcResources.position = npcPosition;
      }

      // Auto-initialize class resource pools for NPCs with class levels
      if (npcClassName && npcLevel > 0) {
        const npcCombatRes = buildCombatResources({
          className: npcClassName,
          level: npcLevel,
          sheet: statBlock ?? {},
        });
        if (npcCombatRes.resourcePools.length > 0) {
          npcResources.resourcePools = npcCombatRes.resourcePools;
        }
        if (npcCombatRes.hasShieldPrepared) {
          (npcResources as any).hasShieldPrepared = true;
        }
        if (npcCombatRes.hasCounterspellPrepared) {
          (npcResources as any).hasCounterspellPrepared = true;
        }
        if (npcCombatRes.hasAbsorbElementsPrepared) {
          (npcResources as any).hasAbsorbElementsPrepared = true;
        }
        if (npcCombatRes.hasHellishRebukePrepared) {
          (npcResources as any).hasHellishRebukePrepared = true;
        }
      }

      combatants.push({
        combatantType: "NPC" as const,
        npcId: npc.id,
        initiative: npcInitiative,
        hpCurrent: statBlock?.hp ?? statBlock?.maxHp ?? 10,
        hpMax: statBlock?.maxHp ?? statBlock?.hp ?? 10,
        resources: Object.keys(npcResources).length > 0 ? npcResources : undefined,
      });
    }

    // Check for existing combatants
    const existingCombatants = await this.deps.combatRepo.listCombatants(encounter.id);
    if (existingCombatants.length > 0) {
      throw new ValidationError("Combat already started - encounter has combatants");
    }

    await this.deps.combat.addCombatantsToEncounter(sessionId, encounter.id, combatants);
    const combatantStates = await this.deps.combatRepo.listCombatants(encounter.id);

    const turnOrder = combatantStates.map((c: any) => ({
      actorId: c.characterId || c.monsterId || c.npcId || c.id,
      actorName:
        c.combatantType === "Character"
          ? characters.find((ch) => ch.id === c.characterId)?.name ?? "Character"
          : c.combatantType === "Monster"
            ? monsters.find((m) => m.id === c.monsterId)?.name ?? "Monster"
            : npcs.find((n) => n.id === c.npcId)?.name ?? "NPC",
      initiative: c.initiative ?? 0,
    }));

    const currentTurn = turnOrder[0] ?? null;

    // --- Uncanny Metabolism auto-trigger on initiative ---
    // D&D 5e 2024: When a Monk rolls initiative and has Uncanny Metabolism available (1/long rest),
    // they regain all Focus Points (ki) and heal for martial arts die + monk level.
    let uncannyMetabolismResult: CombatStartedResult["uncannyMetabolism"];
    if (character) {
      const sheet = character.sheet as any;
      const charClassName = character.className ?? sheet?.className ?? "";
      const charLevel = ClassFeatureResolver.getLevel(sheet, character.level);
      if (ClassFeatureResolver.hasUncannyMetabolism(sheet, charClassName, charLevel)) {
        const charCombatant = combatantStates.find((c: any) => c.characterId === actorId);
        if (charCombatant) {
          const resources = charCombatant.resources as Record<string, unknown> | undefined;
          const pools = getResourcePools(resources ?? {});
          const metabolismPool = pools.find((p) => p.name === "uncanny_metabolism");
          const kiPool = pools.find((p) => p.name === "ki");
          if (metabolismPool && metabolismPool.current > 0 && kiPool) {
            // Roll martial arts die for healing
            const martialArtsDieSize = getMartialArtsDieSize(charLevel);
            const dieRoll = this.deps.diceRoller
              ? this.deps.diceRoller.rollDie(martialArtsDieSize, 1)
              : { total: Math.floor(Math.random() * martialArtsDieSize) + 1, rolls: [0] };
            const healAmount = dieRoll.total + charLevel;

            // Restore all ki to max
            const kiRestored = kiPool.max - kiPool.current;
            let updatedResources = updateResourcePool(resources ?? {}, "ki", (p) => ({
              ...p, current: p.max,
            }));
            // Spend uncanny_metabolism pool
            updatedResources = updateResourcePool(updatedResources, "uncanny_metabolism", (p) => ({
              ...p, current: p.current - 1,
            }));

            // Apply healing (capped at max HP)
            const hpBefore = charCombatant.hpCurrent ?? charCombatant.hpMax ?? 10;
            const hpMax = charCombatant.hpMax ?? 10;
            const hpAfter = Math.min(hpBefore + healAmount, hpMax);

            await this.deps.combatRepo.updateCombatantState(charCombatant.id, {
              resources: updatedResources,
              hpCurrent: hpAfter,
            });

            uncannyMetabolismResult = {
              kiRestored,
              healAmount,
              martialArtsDieRoll: dieRoll.total,
              hpAfter,
            };
          }
        }
      }
    }

    // --- D&D 5e 2024 Alert Feat: Initiative Swap ---
    // "After you roll Initiative, you can swap your Initiative with one willing ally."
    let alertSwapAvailable = false;
    let swapEligibleTargets: Array<{ actorId: string; actorName: string; initiative: number }> = [];
    if (character && typeof character.sheet === "object" && character.sheet !== null) {
      const sheet = character.sheet as Record<string, unknown>;
      const charFeatIds: string[] = (sheet.featIds as string[] | undefined) ?? (sheet.feats as string[] | undefined) ?? [];
      if (charFeatIds.length > 0) {
        const featMods = computeFeatModifiers(charFeatIds);
        if (featMods.initiativeSwapEnabled) {
          // Eligible targets: party allies (other PCs + NPCs) — not enemies, not self
          swapEligibleTargets = turnOrder.filter((t) => {
            if (t.actorId === actorId) return false;
            if (characters.some((c) => c.id === t.actorId)) return true;
            if (npcs.some((n) => n.id === t.actorId)) return true;
            return false;
          });
          alertSwapAvailable = swapEligibleTargets.length > 0;
        }
      }
    }

    if (alertSwapAvailable) {
      // Store pending action for swap decision — don't start AI yet
      const swapAction: InitiativeSwapPendingAction = {
        type: "INITIATIVE_SWAP",
        timestamp: new Date(),
        actorId,
        encounterId: encounter.id,
        sessionId,
        eligibleTargets: swapEligibleTargets,
      };
      await this.deps.combatRepo.setPendingAction(encounter.id, swapAction as any);

      const targetList = swapEligibleTargets.map((t) => `${t.actorName} (${t.initiative})`).join(", ");
      const narration = await this.eventEmitter.generateNarration("combatStarted", {
        initiativeRoll: rollValue,
        dexModifier,
        finalInitiative,
        firstActor: currentTurn?.actorName,
      });

      return {
        rollType: "initiative",
        rawRoll: rollValue,
        modifier: dexModifier,
        total: finalInitiative,
        combatStarted: true,
        encounterId: encounter.id,
        turnOrder,
        currentTurn,
        message: `Initiative rolled! Alert feat: swap initiative with an ally? Eligible: ${targetList}. Say "swap with <name>" or "no swap".`,
        narration,
        uncannyMetabolism: uncannyMetabolismResult,
        requiresPlayerInput: true,
        initiativeSwapOffer: {
          alertHolderId: actorId,
          alertHolderName: character?.name ?? "Character",
          eligibleTargets: swapEligibleTargets,
        },
      };
    }

    // No swap — clear pending action and proceed normally
    await this.deps.combatRepo.clearPendingAction(encounter.id);

    // If monster acts first, start AI orchestrator
    if (this.deps.aiOrchestrator && currentTurn?.actorId && monsters.some((m) => m.id === currentTurn.actorId)) {
      void this.deps.aiOrchestrator.processAllMonsterTurns(sessionId, encounter.id).catch(console.error);
    }

    const narration = await this.eventEmitter.generateNarration("combatStarted", {
      initiativeRoll: rollValue,
      dexModifier,
      finalInitiative,
      firstActor: currentTurn?.actorName,
    });

    return {
      rollType: "initiative",
      rawRoll: rollValue,
      modifier: dexModifier,
      total: finalInitiative,
      combatStarted: true,
      encounterId: encounter.id,
      turnOrder,
      currentTurn,
      message: `Combat started! ${currentTurn?.actorName}'s turn (Initiative: ${currentTurn?.initiative}).`,
      narration,
      uncannyMetabolism: uncannyMetabolismResult,
    };
  }

  /**
   * D&D 5e 2024 Alert feat: handle initiative swap decision.
   * Player says "swap with <name>" or "no swap"/"decline".
   */
  private async handleInitiativeSwap(
    action: InitiativeSwapPendingAction,
    text: string,
    characters: any[],
    monsters: any[],
    npcs: any[],
  ): Promise<CombatStartedResult> {
    const { encounterId, sessionId, actorId, eligibleTargets } = action;
    const encounter = await this.deps.combatRepo.findById(encounterId);
    if (!encounter) throw new ValidationError("Encounter not found for initiative swap");

    // Parse swap decision from player text
    const lowerText = text.toLowerCase().trim();
    const declined = /\b(no swap|decline|skip|pass|no)\b/i.test(lowerText);
    let swapTargetId: string | undefined;

    if (!declined) {
      // Try to match "swap with <name>"
      const swapMatch = lowerText.match(/swap\s+(?:with\s+)?(.+)/i);
      const targetName = swapMatch?.[1]?.trim();
      if (targetName) {
        const target = eligibleTargets.find((t) =>
          t.actorName.toLowerCase() === targetName.toLowerCase()
        );
        if (target) {
          swapTargetId = target.actorId;
        } else {
          throw new ValidationError(`No eligible swap target named "${targetName}". Eligible: ${eligibleTargets.map((t) => t.actorName).join(", ")}`);
        }
      } else {
        throw new ValidationError(`Could not parse swap decision. Say "swap with <name>" or "no swap".`);
      }
    }

    // Apply the swap if requested
    if (swapTargetId) {
      const combatants = await this.deps.combatRepo.listCombatants(encounterId);
      const holderCombatant = combatants.find((c: any) =>
        c.characterId === actorId || c.monsterId === actorId || c.npcId === actorId
      );
      const targetCombatant = combatants.find((c: any) =>
        c.characterId === swapTargetId || c.monsterId === swapTargetId || c.npcId === swapTargetId
      );

      if (holderCombatant && targetCombatant) {
        const holderInit = holderCombatant.initiative;
        const targetInit = targetCombatant.initiative;
        await this.deps.combatRepo.updateCombatantState(holderCombatant.id, { initiative: targetInit });
        await this.deps.combatRepo.updateCombatantState(targetCombatant.id, { initiative: holderInit });

        if (this.debugLogsEnabled) {
          const holderName = characters.find((c) => c.id === actorId)?.name ?? actorId;
          const targetName = eligibleTargets.find((t) => t.actorId === swapTargetId)?.actorName ?? swapTargetId;
          console.log(`[RollStateMachine] Alert swap: ${holderName} (${holderInit} → ${targetInit}) ↔ ${targetName} (${targetInit} → ${holderInit})`);
        }
      }
    }

    // Re-read combatants (sorted by initiative after swap)
    const combatantStates = await this.deps.combatRepo.listCombatants(encounterId);
    const turnOrder = combatantStates.map((c: any) => ({
      actorId: c.characterId || c.monsterId || c.npcId || c.id,
      actorName:
        c.combatantType === "Character"
          ? characters.find((ch) => ch.id === c.characterId)?.name ?? "Character"
          : c.combatantType === "Monster"
            ? monsters.find((m) => m.id === c.monsterId)?.name ?? "Monster"
            : npcs.find((n) => n.id === c.npcId)?.name ?? "NPC",
      initiative: c.initiative ?? 0,
    }));
    const currentTurn = turnOrder[0] ?? null;

    // Clear the pending action — combat is now fully started
    await this.deps.combatRepo.clearPendingAction(encounterId);

    // If monster acts first after swap, start AI orchestrator
    if (this.deps.aiOrchestrator && currentTurn?.actorId && monsters.some((m) => m.id === currentTurn.actorId)) {
      void this.deps.aiOrchestrator.processAllMonsterTurns(sessionId, encounterId).catch(console.error);
    }

    const swapTargetName = swapTargetId
      ? eligibleTargets.find((t) => t.actorId === swapTargetId)?.actorName ?? "ally"
      : undefined;
    const swapMsg = swapTargetId
      ? `Initiative swapped with ${swapTargetName}! `
      : "No swap. ";

    return {
      rollType: "initiative",
      rawRoll: 0,
      modifier: 0,
      total: 0,
      combatStarted: true,
      encounterId,
      turnOrder,
      currentTurn,
      message: `${swapMsg}Combat started! ${currentTurn?.actorName}'s turn (Initiative: ${currentTurn?.initiative}).`,
    };
  }

  private async handleAttackRoll(
    sessionId: string,
    encounter: any,
    action: AttackPendingAction,
    command: any,
    actorId: string,
    characters: any[],
    monsters: any[],
    npcs: any[],
  ): Promise<AttackResult> {
    const rollValue = command.value ?? (Array.isArray(command.values) ? command.values[0] : 0);

    const targetId = action.targetId || action.target;
    const target =
      monsters.find((m) => m.id === targetId) ||
      characters.find((c) => c.id === targetId) ||
      npcs.find((n) => n.id === targetId);

    if (!target || !targetId) {
      throw new ValidationError("Target not found");
    }

    const baseAC = (target as any).statBlock?.armorClass || (target as any).sheet?.armorClass || 10;
    // D&D 5e 2024: Cover grants AC bonus (half +2, three-quarters +5)
    const coverBonus = (action as any).coverACBonus ?? 0;
    const targetAC = baseAC + coverBonus;
    let attackBonus = action.weaponSpec?.attackBonus ?? 5;

    // Apply feat modifiers to attack bonus (e.g. Archery +2 for ranged)
    const attackerChar = characters.find((c) => c.id === actorId);
    const attackerSheet = (attackerChar?.sheet ?? {}) as Record<string, unknown>;
    const featIds: string[] = (attackerSheet.featIds as string[] | undefined) ?? (attackerSheet.feats as string[] | undefined) ?? [];
    if (featIds.length > 0) {
      const featMods = computeFeatModifiers(featIds);
      if (action.weaponSpec?.kind === "ranged" && featMods.rangedAttackBonus) {
        attackBonus += featMods.rangedAttackBonus;
        if (this.debugLogsEnabled) console.log(`[RollStateMachine] Archery feat: +${featMods.rangedAttackBonus} ranged attack bonus (total bonus: ${attackBonus})`);
      }
    }

    // ── ActiveEffect: attack bonus + AC modifiers ──
    const attackerCombatant = (await this.deps.combatRepo.listCombatants(encounter.id))
      .find((c: any) => c.id === actorId);
    const attackerEffects = getActiveEffects(attackerCombatant?.resources ?? {});
    const targetCombatant = (await this.deps.combatRepo.listCombatants(encounter.id))
      .find((c: any) => c.id === targetId);
    const targetEffects = getActiveEffects(targetCombatant?.resources ?? {});

    // Attack bonus from effects (flat + dice)
    const attackBonusResult = calculateBonusFromEffects(attackerEffects, 'attack_rolls');
    attackBonus += attackBonusResult.flatBonus;
    // Roll dice-based attack bonuses (e.g., Bless 1d4)
    let effectDiceBonus = 0;
    if (this.deps.diceRoller) {
      for (const dr of attackBonusResult.diceRolls) {
        const count = Math.abs(dr.count);
        const sign = dr.count < 0 ? -1 : 1;
        for (let i = 0; i < count; i++) {
          effectDiceBonus += sign * this.deps.diceRoller.rollDie(dr.sides).total;
        }
      }
    }
    attackBonus += effectDiceBonus;
    if (effectDiceBonus !== 0 && this.debugLogsEnabled) {
      console.log(`[RollStateMachine] ActiveEffect attack bonus: +${attackBonusResult.flatBonus} flat, +${effectDiceBonus} dice (total bonus: ${attackBonus})`);
    }

    // AC bonus from effects on target (e.g., Shield of Faith +2 AC)
    const acBonusFromEffects = calculateFlatBonusFromEffects(targetEffects, 'armor_class');
    const effectAdjustedAC = targetAC + acBonusFromEffects;
    if (acBonusFromEffects !== 0 && this.debugLogsEnabled) {
      console.log(`[RollStateMachine] ActiveEffect AC bonus on target: +${acBonusFromEffects} (AC ${targetAC} → ${effectAdjustedAC})`);
    }

    const total = rollValue + attackBonus;
    // D&D 5e 2024: Natural 20 always hits (critical), natural 1 always misses
    const isCritical = rollValue === 20;
    const isCriticalMiss = rollValue === 1;
    const hit = isCriticalMiss ? false : (isCritical ? true : total >= effectAdjustedAC);

    // Emit events
    await this.eventEmitter.emitAttackEvents(sessionId, encounter.id, actorId, targetId, characters, monsters, hit, rollValue, total);

    // D&D 5e 2024: Rage attack tracking — any attack roll counts (hit or miss)
    // Use entity ID matching (characterId/monsterId/npcId) since actorId is an entity ID, not a combatant record ID
    {
      const allCombatants = await this.deps.combatRepo.listCombatants(encounter.id);
      const attackerForRage = allCombatants.find(
        (c: any) => c.characterId === actorId || c.monsterId === actorId || c.npcId === actorId,
      );
      if (attackerForRage) {
        const atkRes = normalizeResources(attackerForRage.resources);
        if (atkRes.raging === true) {
          await this.deps.combatRepo.updateCombatantState(attackerForRage.id, {
            resources: { ...atkRes, rageAttackedThisTurn: true } as any,
          });
          if (this.debugLogsEnabled) console.log(`[RollStateMachine] Rage attack tracked for ${actorId}`);
        }
      }
    }

    // Consume StunningStrikePartial after this attack (only grants advantage on ONE attack)
    {
      const combatantStates = await this.deps.combatRepo.listCombatants(encounter.id);
      const targetCombatant = combatantStates.find(
        (c: any) => c.characterId === targetId || c.monsterId === targetId || c.npcId === targetId,
      );
      if (targetCombatant) {
        const targetConds = normalizeConditions(targetCombatant.conditions);
        if (targetConds.some(c => c.condition === "StunningStrikePartial")) {
          const updatedConds = removeCondition(targetConds, "StunningStrikePartial" as Condition);
          await this.deps.combatRepo.updateCombatantState(targetCombatant.id, {
            conditions: updatedConds as any,
          });
          if (this.debugLogsEnabled) console.log(`[RollStateMachine] Consumed StunningStrikePartial on ${targetId} after attack`);
        }
      }
    }

    // D&D 5e 2024: Making an attack breaks the Hidden condition (hit or miss)
    {
      const combatantStates = await this.deps.combatRepo.listCombatants(encounter.id);
      const actorCombatant = combatantStates.find(
        (c: any) => c.characterId === actorId || c.monsterId === actorId || c.npcId === actorId,
      );
      if (actorCombatant) {
        const actorConds = normalizeConditions(actorCombatant.conditions);
        if (actorConds.some(c => c.condition === "Hidden")) {
          const updatedConds = removeCondition(actorConds, "Hidden" as Condition);
          await this.deps.combatRepo.updateCombatantState(actorCombatant.id, {
            conditions: updatedConds as any,
          });
          if (this.debugLogsEnabled) console.log(`[RollStateMachine] Hidden condition removed from ${actorId} after attack`);
        }
      }
    }

    if (!hit) {
      // Handle miss for Flurry strike 1
      if (action.bonusAction === "flurry-of-blows" && action.flurryStrike === 1) {
        const pendingAction2: AttackPendingAction = {
          type: "ATTACK",
          timestamp: new Date(),
          actorId,
          attacker: actorId,
          target: action.target,
          targetId: action.targetId,
          weaponSpec: action.weaponSpec,
          bonusAction: "flurry-of-blows",
          flurryStrike: 2,
        };

        await this.deps.combatRepo.setPendingAction(encounter.id, pendingAction2);

        return {
          rollType: "attack",
          rawRoll: rollValue,
          modifier: attackBonus,
          total,
          targetAC: effectAdjustedAC,
          hit: false,
          targetHpRemaining: (target as any).statBlock?.hp ?? (target as any).sheet?.maxHp ?? 0,
          requiresPlayerInput: true,
          actionComplete: false,
          type: "REQUEST_ROLL",
          diceNeeded: "d20",
          message: `${rollValue} + ${attackBonus} = ${total} vs AC ${effectAdjustedAC}. Miss! Second strike: Roll a d20.`,
        };
      }

      // Regular miss
      await this.deps.combatRepo.clearPendingAction(encounter.id);
      await this.eventEmitter.markActionSpent(encounter.id, actorId);

      // D&D 5e 2024: Loading property — mark that a Loading weapon was fired this turn
      if (action.weaponSpec?.properties?.some((p: string) => typeof p === "string" && p.toLowerCase() === "loading")) {
        const combatantStatesForLoading = await this.deps.combatRepo.listCombatants(encounter.id);
        const actorForLoading = combatantStatesForLoading.find(
          (c: any) => c.characterId === actorId || c.monsterId === actorId || c.npcId === actorId,
        );
        if (actorForLoading) {
          const loadRes = normalizeResources(actorForLoading.resources);
          await this.deps.combatRepo.updateCombatantState(actorForLoading.id, {
            resources: { ...loadRes, loadingWeaponFiredThisTurn: true } as any,
          });
        }
      }

      // --- Weapon Mastery: Graze ---
      // On a miss, deal damage equal to the ability modifier used for the attack (minimum 0).
      let grazeDamage = 0;
      let grazeSuffix = "";
      if (action.weaponSpec?.mastery === "graze" && !isCriticalMiss) {
        const abilityMod = action.weaponSpec.damage?.modifier ?? 0;
        grazeDamage = Math.max(0, abilityMod);
        if (grazeDamage > 0) {
          const combatantStates = await this.deps.combatRepo.listCombatants(encounter.id);
          const targetCombatant = combatantStates.find(
            (c: any) => c.characterId === targetId || c.monsterId === targetId || c.npcId === targetId,
          );
          if (targetCombatant && targetCombatant.hpCurrent > 0) {
            const hpBefore = targetCombatant.hpCurrent;
            const hpAfter = Math.max(0, hpBefore - grazeDamage);
            await this.deps.combatRepo.updateCombatantState(targetCombatant.id, { hpCurrent: hpAfter });
            await applyKoEffectsIfNeeded(targetCombatant, hpBefore, hpAfter, this.deps.combatRepo);
            grazeSuffix = ` Graze: ${grazeDamage} ${action.weaponSpec.damageType ?? ""} damage. HP: ${hpBefore} → ${hpAfter}.`;
            if (this.debugLogsEnabled) console.log(`[RollStateMachine] Graze mastery: ${grazeDamage} damage to ${targetId} (HP: ${hpBefore} → ${hpAfter})`);
          }
        }
      }

      const narration = await this.eventEmitter.generateNarration(isCriticalMiss ? "criticalMiss" : "attackMiss", {
        attackRoll: rollValue,
        attackBonus,
        total,
        targetAC: effectAdjustedAC,
        targetName: target?.name ?? "target",
        weaponName: action.weaponSpec?.name,
      });

      const missMessage = isCriticalMiss
        ? `Natural 1! Critical Miss!`
        : `${rollValue} + ${attackBonus} = ${total} vs AC ${effectAdjustedAC}. Miss!${grazeSuffix}`;

      // Drop thrown weapon on the ground at target position (miss)
      if (action.weaponSpec?.isThrownAttack) {
        await this.dropThrownWeaponOnGround(encounter, actorId, targetId, action.weaponSpec, encounter.round ?? 1);
      }

      return {
        rollType: "attack",
        rawRoll: rollValue,
        modifier: attackBonus,
        total,
        targetAC: effectAdjustedAC,
        hit: false,
        isCritical: false,
        targetHpRemaining: (target as any).statBlock?.hp ?? (target as any).sheet?.maxHp ?? 0,
        requiresPlayerInput: false,
        actionComplete: true,
        message: missMessage,
        narration,
      };
    }

    // Hit - check Sneak Attack eligibility before building damage formula
    let sneakAttackDiceCount = 0;
    const actorChar = characters.find((c) => c.id === actorId);
    const actorClassName = actorChar?.className ?? (actorChar?.sheet as any)?.className ?? "";
    const actorLevel = ClassFeatureResolver.getLevel((actorChar?.sheet ?? {}) as any, actorChar?.level);

    if (ClassFeatureResolver.isRogue(actorChar?.sheet as any, actorClassName)) {
      const combatantStates = await this.deps.combatRepo.listCombatants(encounter.id);
      const actorCombatant = combatantStates.find((c: any) => c.characterId === actorId);
      const targetCombatant = combatantStates.find((c: any) =>
        c.monsterId === targetId || c.characterId === targetId || c.npcId === targetId);

      // Check ally adjacency: any friendly combatant (not attacker, not target) within 5ft of target
      let allyAdjacentToTarget = false;
      if (targetCombatant) {
        const targetPos = getPosition(targetCombatant.resources ?? {});
        if (targetPos) {
          for (const c of combatantStates) {
            // Skip attacker and target
            if (c.id === actorCombatant?.id || c.id === targetCombatant.id) continue;
            // Skip dead/unconscious allies
            const conds = Array.isArray(c.conditions) ? c.conditions as string[] : [];
            if (conds.some((cd: string) => cd.toLowerCase() === "unconscious" || cd.toLowerCase() === "dead")) continue;
            // Must be same faction as attacker (Characters/NPCs vs Monsters)
            const attackerIsPC = actorCombatant?.combatantType === "Character" || actorCombatant?.combatantType === "NPC";
            const allyIsPC = c.combatantType === "Character" || c.combatantType === "NPC";
            if (attackerIsPC !== allyIsPC) continue;
            // Check distance to target
            const allyPos = getPosition(c.resources ?? {});
            if (allyPos && calculateDistance(allyPos, targetPos) <= 5.0001) {
              allyAdjacentToTarget = true;
              break;
            }
          }
        }
      }

      const sneakUsed = actorCombatant?.resources
        ? (normalizeResources(actorCombatant.resources) as any).sneakAttackUsedThisTurn === true
        : false;

      const eligible = isSneakAttackEligible({
        className: actorClassName,
        weaponKind: action.weaponSpec?.kind ?? "melee",
        weaponProperties: action.weaponSpec?.properties,
        hasAdvantage: action.rollMode === "advantage",
        allyAdjacentToTarget,
        sneakAttackUsedThisTurn: sneakUsed,
      });

      if (eligible) {
        sneakAttackDiceCount = sneakAttackDiceForLevel(actorLevel);
        if (this.debugLogsEnabled) console.log(`[RollStateMachine] Sneak Attack eligible! Adding ${sneakAttackDiceCount}d6`);
      }
    }

    // Hit - request damage roll
    // 2024 rules: on-hit enhancements (Stunning Strike, Divine Smite, OHT) are NOT built here.
    // Instead, we compute eligible enhancements and return them in the hit response.
    // Player opts in by including keywords in their damage roll text.

    // Compute eligible on-hit enhancements for the attacker
    const actorSheet = (actorChar?.sheet ?? {}) as any;
    const actorCombatantForEnhancements = (await this.deps.combatRepo.listCombatants(encounter.id)).find(
      (c: any) => c.characterId === actorId || c.monsterId === actorId || c.npcId === actorId,
    );
    const actorResForEnhancements = normalizeResources(actorCombatantForEnhancements?.resources ?? {});
    const actorResourcePools = getResourcePools(actorResForEnhancements);
    const eligibleEnhancements = actorChar
      ? getEligibleOnHitEnhancements(
          action.weaponSpec?.kind ?? "melee",
          actorClassName,
          actorLevel,
          actorResForEnhancements,
          actorResourcePools,
          getAllCombatTextProfiles(),
          action.bonusAction,
        )
      : [];

    if (this.debugLogsEnabled && eligibleEnhancements.length > 0) {
      console.log(`[RollStateMachine] Eligible on-hit enhancements: ${eligibleEnhancements.map((e) => e.keyword).join(", ")}`);
    }

    const damageAction: DamagePendingAction = {
      type: "DAMAGE",
      timestamp: new Date(),
      actorId,
      targetId: targetId!,
      weaponSpec: action.weaponSpec,
      attackRollResult: total,
      isCritical,
      bonusAction: action.bonusAction,
      flurryStrike: action.flurryStrike,
      sneakAttackDice: sneakAttackDiceCount > 0 ? sneakAttackDiceCount : undefined,
      // Enhancements are built at damage time from player opt-in keywords, not here
    };

    await this.deps.combatRepo.setPendingAction(encounter.id, damageAction);

    // Build damage formula including Sneak Attack dice if eligible
    let baseDamageFormula = action.weaponSpec?.damageFormula ?? "1d8";
    if (sneakAttackDiceCount > 0) {
      // Insert sneak attack dice before the modifier: "1d6+3" → "1d6+3d6+3"
      const modMatch = baseDamageFormula.match(/([+-]\d+)$/);
      if (modMatch) {
        const beforeMod = baseDamageFormula.slice(0, modMatch.index);
        baseDamageFormula = `${beforeMod}+${sneakAttackDiceCount}d6${modMatch[1]}`;
      } else {
        baseDamageFormula = `${baseDamageFormula}+${sneakAttackDiceCount}d6`;
      }
    }

    // On critical hit, double ALL damage dice (weapon + sneak attack per 5e 2024)
    const damageFormula = isCritical ? doubleDiceInFormula(baseDamageFormula) : baseDamageFormula;

    const narration = await this.eventEmitter.generateNarration(isCritical ? "criticalHit" : "attackHit", {
      attackRoll: rollValue,
      attackBonus,
      total,
      targetAC: effectAdjustedAC,
      targetName: target?.name ?? "target",
      damageFormula,
      weaponName: action.weaponSpec?.name,
    });

    const hitMessage = isCritical
      ? `Natural 20! Critical Hit! Roll ${damageFormula} for damage.`
      : `${rollValue} + ${attackBonus} = ${total} vs AC ${effectAdjustedAC}. Hit! Roll ${damageFormula} for damage.`;

    return {
      rollType: "damage",
      rawRoll: rollValue,
      modifier: attackBonus,
      total,
      targetAC: effectAdjustedAC,
      hit: true,
      isCritical,
      requiresPlayerInput: true,
      actionComplete: false,
      type: "REQUEST_ROLL",
      diceNeeded: damageFormula,
      message: hitMessage,
      narration,
      ...(eligibleEnhancements.length > 0 ? { eligibleEnhancements } : {}),
    };
  }

  private async handleDamageRoll(
    sessionId: string,
    encounter: any,
    action: DamagePendingAction,
    command: any,
    actorId: string,
    characters: any[],
    monsters: any[],
    npcs: any[],
    rawText?: string,
  ): Promise<DamageResult> {
    const rollValue = command.value ?? (Array.isArray(command.values) ? command.values[0] : 0);

    const target =
      monsters.find((m) => m.id === action.targetId) ||
      characters.find((c) => c.id === action.targetId) ||
      npcs.find((n) => n.id === action.targetId);

    if (!target) {
      throw new ValidationError("Target not found");
    }

    // --- 2024 On-Hit Enhancement: match player opt-in keywords in damage text ---
    // Enhancement building moved here from handleAttackRoll (was upfront declaration).
    // Player includes keywords like "with stunning strike" or "with topple" in damage text.
    const actorChar = characters.find((c) => c.id === actorId);
    const actorClassName = actorChar?.className ?? (actorChar?.sheet as any)?.className ?? "";
    const actorLevel = ClassFeatureResolver.getLevel((actorChar?.sheet ?? {}) as any, actorChar?.level);

    if (rawText && !action.enhancements) {
      const actorCombatantForEnhancements = (await this.deps.combatRepo.listCombatants(encounter.id)).find(
        (c: any) => c.characterId === actorId || c.monsterId === actorId || c.npcId === actorId,
      );
      const actorResForEnhancements = normalizeResources(actorCombatantForEnhancements?.resources ?? {});
      const actorResourcePools = getResourcePools(actorResForEnhancements);

      // Get raw on-hit enhancement defs for the actor's class
      const profiles = getAllCombatTextProfiles();
      const classProfile = profiles.find((p) => p.classId === actorClassName.toLowerCase());
      const onHitDefs = (classProfile?.attackEnhancements ?? []).filter((e) => (e.trigger ?? "onDeclare") === "onHit");

      // Filter to eligible defs
      const eligibleDefs = onHitDefs.filter((def) => {
        if (actorLevel < def.minLevel) return false;
        if (def.requiresMelee && action.weaponSpec?.kind !== "melee") return false;
        if (def.requiresBonusAction && action.bonusAction !== def.requiresBonusAction) return false;
        if (def.turnTrackingKey && actorResForEnhancements[def.turnTrackingKey] === true) return false;
        if (def.resourceCost) {
          const pool = actorResourcePools.find((p) => p.name === def.resourceCost!.pool);
          if (!pool || pool.current < def.resourceCost.amount) return false;
        }
        return true;
      });

      // Match player keywords in damage text
      const matched = matchOnHitEnhancementsInText(rawText, eligibleDefs);

      if (matched.length > 0) {
        const enhancements: HitRiderEnhancement[] = [];
        const actorSheet = (actorChar?.sheet ?? {}) as any;
        const wisdomScore = actorSheet?.abilityScores?.wisdom ?? 10;
        const profBonus = ClassFeatureResolver.getProficiencyBonus(actorSheet, actorLevel);
        const wisMod = Math.floor((wisdomScore - 10) / 2);
        const saveDC = 8 + profBonus + wisMod;

        for (const match of matched) {
          if (match.keyword === "stunning-strike") {
            enhancements.push({
              abilityId: "class:monk:stunning-strike",
              displayName: "Stunning Strike",
              postDamageEffect: "saving-throw",
              context: {
                saveAbility: "constitution",
                saveDC,
                saveReason: "Stunning Strike",
                sourceId: actorId,
                onSuccess: {
                  conditions: { add: ["StunningStrikePartial"] },
                  speedModifier: 0.5,
                  summary: "Speed halved, next attack has advantage.",
                } satisfies SaveOutcome,
                onFailure: {
                  conditions: { add: ["Stunned"] },
                  summary: "Stunned until start of monk's next turn!",
                } satisfies SaveOutcome,
                expiresAt: { event: "start_of_turn", combatantId: actorId },
                resourceCost: { pool: "ki", amount: 1 },
                turnTrackingKey: "stunningStrikeUsedThisTurn",
              },
            });
          } else if (match.keyword === "divine-smite") {
            // Find lowest available spell slot (1-5)
            let slotLevel = 0;
            for (let sl = 1; sl <= 5; sl++) {
              if (hasResourceAvailable(actorResForEnhancements, `spellSlot_${sl}`, 1)) {
                slotLevel = sl;
                break;
              }
            }
            if (slotLevel > 0 && hasBonusActionAvailable(actorResForEnhancements)) {
              // Spend the spell slot + bonus action
              let updatedSmiteRes = spendResourceFromPool(actorResForEnhancements, `spellSlot_${slotLevel}`, 1);
              updatedSmiteRes = useBonusAction(updatedSmiteRes);
              if (actorCombatantForEnhancements) {
                await this.deps.combatRepo.updateCombatantState(actorCombatantForEnhancements.id, {
                  resources: updatedSmiteRes as any,
                });
              }
              const diceCount = divineSmiteDice(slotLevel);
              enhancements.push({
                abilityId: "class:paladin:divine-smite",
                displayName: "Divine Smite",
                bonusDice: { diceCount, diceSides: 8 },
              });
              if (this.debugLogsEnabled) console.log(`[RollStateMachine] Divine Smite (on-hit): ${diceCount}d8 radiant (level ${slotLevel} slot spent)`);
            }
          } else if (match.keyword === "open-hand-technique" && match.choice) {
            const technique = match.choice;
            if (technique === "addle") {
              enhancements.push({
                abilityId: "class:monk:open-hand-technique",
                displayName: "Open Hand Technique (Addle)",
                postDamageEffect: "apply-condition",
                context: { conditionName: "Addled" },
              });
            } else if (technique === "push") {
              enhancements.push({
                abilityId: "class:monk:open-hand-technique",
                displayName: "Open Hand Technique (Push)",
                postDamageEffect: "saving-throw",
                context: {
                  saveAbility: "strength",
                  saveDC,
                  saveReason: "Open Hand Technique (Push)",
                  sourceId: actorId,
                  onSuccess: { summary: "Resists the push!" } satisfies SaveOutcome,
                  onFailure: { movement: { push: 15 }, summary: "Pushed 15 feet!" } satisfies SaveOutcome,
                },
              });
            } else if (technique === "topple") {
              enhancements.push({
                abilityId: "class:monk:open-hand-technique",
                displayName: "Open Hand Technique (Topple)",
                postDamageEffect: "saving-throw",
                context: {
                  saveAbility: "dexterity",
                  saveDC,
                  saveReason: "Open Hand Technique (Topple)",
                  sourceId: actorId,
                  onSuccess: { summary: "Keeps footing!" } satisfies SaveOutcome,
                  onFailure: { conditions: { add: ["Prone"] }, summary: "Knocked Prone!" } satisfies SaveOutcome,
                },
              });
            }
          }
        }

        if (enhancements.length > 0) {
          action.enhancements = enhancements;
          if (this.debugLogsEnabled) console.log(`[RollStateMachine] On-hit enhancements from damage text: ${enhancements.map((e) => e.displayName).join(", ")}`);
        }
      }
    }

    const damageModifier = parseDamageModifier(action.weaponSpec?.damageFormula, action.weaponSpec?.damage?.modifier);
    let totalDamage = rollValue + damageModifier;

    // ── ActiveEffect: extra damage (flat + dice) ──
    // Includes Rage melee damage bonus, Hunter's Mark, etc.
    const actorCombatant = (await this.deps.combatRepo.listCombatants(encounter.id)).find(
      (c: any) => c.characterId === action.actorId || c.monsterId === action.actorId || c.npcId === action.actorId,
    );
    const actorRes = actorCombatant?.resources ?? {} as Record<string, unknown>;
    {
      const attackerEffects = getActiveEffects(actorCombatant?.resources ?? {});
      const targetId = action.targetId;
      const isMelee = action.weaponSpec?.kind === "melee";
      const isRanged = action.weaponSpec?.kind === "ranged";
      // Filter for damage_rolls effects, honouring targetCombatantId for Hunter's Mark etc.
      // Also match melee/ranged-specific damage effects
      const dmgEffects = attackerEffects.filter(
        e => (e.type === 'bonus' || e.type === 'penalty')
          && (e.target === 'damage_rolls'
            || (e.target === 'melee_damage_rolls' && isMelee)
            || (e.target === 'ranged_damage_rolls' && isRanged))
          && (!e.targetCombatantId || e.targetCombatantId === targetId)
      );
      let effectFlatDmg = 0;
      let effectDiceDmg = 0;
      for (const eff of dmgEffects) {
        if (eff.type === 'bonus') effectFlatDmg += eff.value ?? 0;
        if (eff.type === 'penalty') effectFlatDmg -= eff.value ?? 0;
        if (eff.diceValue && this.deps.diceRoller) {
          const sign = eff.type === 'penalty' ? -1 : 1;
          const count = Math.abs(eff.diceValue.count);
          for (let i = 0; i < count; i++) {
            effectDiceDmg += sign * this.deps.diceRoller.rollDie(eff.diceValue.sides).total;
          }
        }
      }
      const effectDmgTotal = effectFlatDmg + effectDiceDmg;
      if (effectDmgTotal !== 0) {
        totalDamage = Math.max(0, totalDamage + effectDmgTotal);
        if (this.debugLogsEnabled) console.log(`[RollStateMachine] ActiveEffect damage bonus: +${effectFlatDmg} flat, +${effectDiceDmg} dice (total now ${totalDamage})`);
      }
    }

    // Apply damage resistance/immunity/vulnerability
    const damageType = action.weaponSpec?.damageType;
    if (totalDamage > 0 && damageType) {
      const targetSheet = (target as any).statBlock ?? (target as any).sheet ?? {};
      const defenses = extractDamageDefenses(targetSheet);

      // ── ActiveEffect: damage defense modifiers (resistance/vulnerability/immunity) ──
      // Includes Rage B/P/S resistance, spell-granted resistances, etc.
      const targetCombatantForDefenses = (await this.deps.combatRepo.listCombatants(encounter.id)).find(
        (c: any) => c.characterId === action.targetId || c.monsterId === action.targetId || c.npcId === action.targetId,
      );
      if (targetCombatantForDefenses) {
        const tgtEffects = getActiveEffects(targetCombatantForDefenses.resources ?? {});
        const effDef = getDamageDefenseEffects(tgtEffects, damageType);
        if (effDef.resistances) {
          const existing = defenses.damageResistances ?? [];
          defenses.damageResistances = [...new Set([...existing, damageType.toLowerCase()])];
        }
        if (effDef.vulnerabilities) {
          const existing = defenses.damageVulnerabilities ?? [];
          defenses.damageVulnerabilities = [...new Set([...existing, damageType.toLowerCase()])];
        }
        if (effDef.immunities) {
          const existing = defenses.damageImmunities ?? [];
          defenses.damageImmunities = [...new Set([...existing, damageType.toLowerCase()])];
        }
      }

      if (defenses.damageResistances || defenses.damageImmunities || defenses.damageVulnerabilities) {
        const defResult = applyDamageDefenses(totalDamage, damageType, defenses);
        totalDamage = defResult.adjustedDamage;
        if (this.debugLogsEnabled) console.log(`[RollStateMachine] Damage defense: ${defResult.defenseApplied} (${damageType}) ${defResult.originalDamage} → ${totalDamage}`);
      }
    }

    // Apply damage
    const combatantStates = await this.deps.combatRepo.listCombatants(encounter.id);
    const targetCombatant = combatantStates.find(
      (c: any) => c.characterId === action.targetId || c.monsterId === action.targetId || c.npcId === action.targetId,
    );

    const hpBefore = targetCombatant?.hpCurrent ?? 0;
    let hpAfter = hpBefore;

    if (targetCombatant) {
      hpAfter = Math.max(0, targetCombatant.hpCurrent - totalDamage);
      if (this.debugLogsEnabled) console.log(`[RollStateMachine.handleDamageRoll] HP change: ${hpBefore} -> ${hpAfter} (target: ${targetCombatant.id}, damage: ${totalDamage})`);
      await this.deps.combatRepo.updateCombatantState(targetCombatant.id, { hpCurrent: hpAfter });
      await this.eventEmitter.emitDamageEvents(sessionId, encounter.id, actorId, action.targetId, characters, monsters, totalDamage, hpAfter);

      // D&D 5e 2024: Rage damage-taken tracking — track when a raging creature takes damage
      if (totalDamage > 0) {
        const targetRes = normalizeResources(targetCombatant.resources);
        if (targetRes.raging === true) {
          await this.deps.combatRepo.updateCombatantState(targetCombatant.id, {
            resources: { ...targetRes, rageDamageTakenThisTurn: true } as any,
          });
          if (this.debugLogsEnabled) console.log(`[RollStateMachine] Rage damage taken tracked for ${action.targetId}`);
        }
      }

      // If a CHARACTER drops to 0 HP from above 0 HP, initialize death saves + Unconscious
      const wasKod = await applyKoEffectsIfNeeded(
        targetCombatant, hpBefore, hpAfter, this.deps.combatRepo,
        this.debugLogsEnabled ? (msg) => console.log(`[RollStateMachine] ${msg}`) : undefined,
      );

      // D&D 5e 2024: Rage ends immediately when a creature drops to 0 HP (unconscious)
      if (hpAfter === 0) {
        const koTargetForRage = (await this.deps.combatRepo.listCombatants(encounter.id))
          .find((c: any) => c.id === targetCombatant.id);
        if (koTargetForRage) {
          const koRes = normalizeResources(koTargetForRage.resources);
          if (koRes.raging === true) {
            const effects = getActiveEffects(koTargetForRage.resources ?? {});
            const nonRageEffects = effects.filter((e: ActiveEffect) => e.source !== "Rage");
            const updatedRes = setActiveEffects({ ...koRes, raging: false }, nonRageEffects);
            await this.deps.combatRepo.updateCombatantState(koTargetForRage.id, { resources: updatedRes as any });
            if (this.debugLogsEnabled) console.log(`[RollStateMachine] Rage ended on KO for ${action.targetId}`);
          }
        }
      }

      // Auto-break concentration on KO (Unconscious = Incapacitated → concentration ends)
      if (hpAfter === 0 && targetCombatant) {
        const koTarget = (await this.deps.combatRepo.listCombatants(encounter.id))
          .find((c: any) => c.id === targetCombatant.id);
        if (koTarget) {
          const koSpellName = getConcentrationSpellName(koTarget.resources);
          if (koSpellName) {
            await breakConcentration(
              koTarget, encounter.id, this.deps.combatRepo,
              this.debugLogsEnabled ? (msg) => console.log(`[RollStateMachine] ${msg}`) : undefined,
            );
            const targetEntityId = targetCombatant.characterId ?? targetCombatant.monsterId ?? targetCombatant.npcId ?? action.targetId;
            await this.eventEmitter.emitConcentrationEvent(
              sessionId, encounter.id, targetEntityId, characters, monsters,
              { maintained: false, spellName: koSpellName, dc: 0, roll: 0, damage: totalDamage },
            );
            if (this.debugLogsEnabled) console.log(`[RollStateMachine] Concentration auto-broken on KO`);
          }
        }
      }

      // If a CHARACTER already at 0 HP takes more damage, auto-fail death saves
      if (hpBefore === 0 && targetCombatant.combatantType === "Character") {
        const isCritical = action.isCritical ?? false;
        await applyDamageWhileUnconscious(
          targetCombatant, totalDamage, isCritical, this.deps.combatRepo,
          this.debugLogsEnabled ? (msg) => console.log(`[RollStateMachine] ${msg}`) : undefined,
        );
      }

      // Concentration check: if the target is concentrating and took damage, auto-roll CON save
      // If hpAfter === 0, concentration is auto-broken (handled by KO effects / condition-based break)
      if (totalDamage > 0 && hpAfter > 0 && targetCombatant) {
        const latestCombatant = (await this.deps.combatRepo.listCombatants(encounter.id))
          .find((c: any) => c.id === targetCombatant.id);
        const spellName = getConcentrationSpellName(latestCombatant?.resources);
        if (spellName && this.deps.diceRoller) {
          // Get CON save modifier from the character sheet or stat block
          const targetSheet = (target as any).sheet ?? (target as any).statBlock;
          const conScore = targetSheet?.abilityScores?.constitution ?? 10;
          const profBonus = targetSheet?.proficiencyBonus ?? 2;
          const saveProficiencies: string[] = Array.isArray(targetSheet?.saveProficiencies) ? targetSheet.saveProficiencies : [];
          const totalMod = computeConSaveModifier(conScore, profBonus, saveProficiencies);

          const result = concentrationCheckOnDamage(this.deps.diceRoller, totalDamage, totalMod);

          if (this.debugLogsEnabled) console.log(`[RollStateMachine] Concentration check: ${result.check.total} vs DC ${result.dc} → ${result.maintained ? "maintained" : "LOST"}`);

          if (!result.maintained) {
            await breakConcentration(
              latestCombatant!,
              encounter.id,
              this.deps.combatRepo,
              this.debugLogsEnabled ? (msg) => console.log(`[RollStateMachine] ${msg}`) : undefined,
            );
          }

          // Emit concentration event
          const targetEntityId = targetCombatant.characterId ?? targetCombatant.monsterId ?? targetCombatant.npcId ?? action.targetId;
          await this.eventEmitter.emitConcentrationEvent(
            sessionId, encounter.id, targetEntityId, characters, monsters,
            {
              maintained: result.maintained,
              spellName,
              dc: result.dc,
              roll: result.check.total,
              damage: totalDamage,
            },
          );
        }
      }

      // ── ActiveEffect: retaliatory damage (Armor of Agathys, Fire Shield) ──
      if (totalDamage > 0 && action.weaponSpec?.kind === "melee") {
        const tgtEffects = getActiveEffects(targetCombatant.resources ?? {});
        const retaliatory = tgtEffects.filter(e => e.type === 'retaliatory_damage');
        if (retaliatory.length > 0 && this.deps.diceRoller) {
          const attackerForRetaliation = combatantStates.find(
            (c: any) => c.characterId === actorId || c.monsterId === actorId || c.npcId === actorId,
          );
          if (attackerForRetaliation && attackerForRetaliation.hpCurrent > 0) {
            let totalRetaliatoryDamage = 0;
            for (const eff of retaliatory) {
              let retDmg = eff.value ?? 0;
              if (eff.diceValue) {
                for (let i = 0; i < eff.diceValue.count; i++) {
                  retDmg += this.deps.diceRoller.rollDie(eff.diceValue.sides).total;
                }
              }
              totalRetaliatoryDamage += retDmg;
              if (this.debugLogsEnabled) console.log(`[RollStateMachine] Retaliatory damage (${eff.source ?? 'effect'}): ${retDmg} ${eff.damageType ?? ''}`);
            }
            if (totalRetaliatoryDamage > 0) {
              const atkHpBefore = attackerForRetaliation.hpCurrent;
              const atkHpAfter = Math.max(0, atkHpBefore - totalRetaliatoryDamage);
              await this.deps.combatRepo.updateCombatantState(attackerForRetaliation.id, { hpCurrent: atkHpAfter });
              await applyKoEffectsIfNeeded(
                attackerForRetaliation, atkHpBefore, atkHpAfter, this.deps.combatRepo,
                this.debugLogsEnabled ? (msg) => console.log(`[RollStateMachine] ${msg}`) : undefined,
              );
              if (this.debugLogsEnabled) console.log(`[RollStateMachine] Retaliatory damage: ${totalRetaliatoryDamage} to ${actorId} (HP: ${atkHpBefore} → ${atkHpAfter})`);
            }
          }
        }
      }
    }

    // Mark Sneak Attack as used for this turn if it was applied
    if (action.sneakAttackDice && action.sneakAttackDice > 0) {
      const actorCombatant = combatantStates.find((c: any) => c.characterId === actorId);
      if (actorCombatant) {
        const actorRes = normalizeResources(actorCombatant.resources);
        await this.deps.combatRepo.updateCombatantState(actorCombatant.id, {
          resources: { ...actorRes, sneakAttackUsedThisTurn: true } as any,
        });
        if (this.debugLogsEnabled) console.log(`[RollStateMachine] Sneak Attack used this turn — marked`);
      }
    }

    await this.deps.combatRepo.clearPendingAction(encounter.id);

    const targetName = (target as any).name ?? "Target";
    const isFlurryStrike1 = action.bonusAction === "flurry-of-blows" && action.flurryStrike === 1;
    const isFlurryStrike2 = action.bonusAction === "flurry-of-blows" && action.flurryStrike === 2;

    // --- Weapon Mastery: automatic on-hit effects ---
    // Applied after damage, before hit-rider enhancements (which are player opt-in).
    // Only triggers if target is still alive (hpAfter > 0) and weapon has mastery.
    let masterySuffix = "";
    if (action.weaponSpec?.mastery && hpAfter > 0 && totalDamage > 0) {
      masterySuffix = await this.resolveWeaponMastery(
        action.weaponSpec.mastery,
        actorId,
        action.targetId,
        encounter.id,
        sessionId,
        action.weaponSpec,
        characters,
        monsters,
        npcs,
      );
    }

    // Generic hit-rider enhancement resolution (System 2)
    // Processes ALL enhancements through the unified pipeline:
    // Stunning Strike saves, OHT effects, bonus dice (Divine Smite), etc.
    const enhancementResults: HitRiderEnhancementResult[] = [];
    if (action.enhancements && action.enhancements.length > 0 && hpAfter > 0) {
      for (const enhancement of action.enhancements) {
        // Bonus dice enhancements (e.g., Divine Smite radiant damage)
        if (enhancement.bonusDice) {
          let bonusDamage = 0;
          for (let i = 0; i < enhancement.bonusDice.diceCount; i++) {
            const dieRoll = this.deps.diceRoller?.rollDie(enhancement.bonusDice.diceSides);
            bonusDamage += dieRoll?.total ?? 0;
          }
          if (bonusDamage > 0) {
            const targetCombatantForBonus = (await this.deps.combatRepo.listCombatants(encounter.id))
              .find((c: any) => c.characterId === action.targetId || c.monsterId === action.targetId || c.npcId === action.targetId);
            if (targetCombatantForBonus) {
              const bonusHpBefore = targetCombatantForBonus.hpCurrent;
              const newHp = Math.max(0, bonusHpBefore - bonusDamage);
              await this.deps.combatRepo.updateCombatantState(targetCombatantForBonus.id, { hpCurrent: newHp });
              await applyKoEffectsIfNeeded(targetCombatantForBonus, bonusHpBefore, newHp, this.deps.combatRepo);
              hpAfter = newHp;
              totalDamage += bonusDamage;
            }
            enhancementResults.push({
              abilityId: enhancement.abilityId,
              displayName: enhancement.displayName,
              summary: `${enhancement.displayName}: ${bonusDamage} bonus damage!`,
            });
          }
        }

        // Post-damage effects (saving throws, condition application, etc.)
        if (enhancement.postDamageEffect) {
          const effectResult = await this.resolvePostDamageEffect(
            enhancement, actorId, action.targetId, encounter.id,
            characters, monsters, npcs,
          );
          enhancementResults.push(effectResult);
        }
      }
    }

    // Map enhancement results to legacy response fields for backward compatibility
    // (test harness expects stunningStrike/openHandTechnique as separate response fields)
    const stunningStrikeResult = enhancementResults.find((r) => r.abilityId === "class:monk:stunning-strike");
    const ohtResult = enhancementResults.find((r) => r.abilityId === "class:monk:open-hand-technique");
    const genericEnhancements = enhancementResults.filter(
      (r) => r.abilityId !== "class:monk:stunning-strike" && r.abilityId !== "class:monk:open-hand-technique",
    );

    if (isFlurryStrike1) {
      const pendingAction2: AttackPendingAction = {
        type: "ATTACK",
        timestamp: new Date(),
        actorId,
        attacker: actorId,
        target: action.targetId,
        targetId: action.targetId,
        weaponSpec: action.weaponSpec,
        bonusAction: "flurry-of-blows",
        flurryStrike: 2,
        // On-hit enhancements are resolved per-strike via damage text keywords — nothing to propagate
      };

      await this.deps.combatRepo.setPendingAction(encounter.id, pendingAction2);

      const ohtSuffix = ohtResult ? ` ${ohtResult.summary}` : "";
      const ssSuffix = stunningStrikeResult ? ` ${stunningStrikeResult.summary}` : "";
      const enhSuffix = genericEnhancements.map((r) => ` ${r.summary}`).join("");
      return {
        rollType: "attack",
        rawRoll: rollValue,
        modifier: damageModifier,
        total: totalDamage,
        totalDamage,
        targetName,
        hpBefore,
        hpAfter,
        targetHpRemaining: hpAfter,
        actionComplete: false,
        requiresPlayerInput: true,
        type: "REQUEST_ROLL",
        diceNeeded: "d20",
        message: `${rollValue} + ${damageModifier} = ${totalDamage} damage to ${targetName}! HP: ${hpBefore} → ${hpAfter}.${masterySuffix}${ohtSuffix}${ssSuffix}${enhSuffix} Second strike: Roll a d20.`,
        ...(ohtResult ? { openHandTechnique: ohtResult } : {}),
        ...(stunningStrikeResult ? { stunningStrike: stunningStrikeResult } : {}),
      };
    }

    await this.eventEmitter.markActionSpent(encounter.id, actorId);

    // D&D 5e 2024: Loading property — mark that a Loading weapon was fired this turn
    if (action.weaponSpec?.properties?.some((p: string) => typeof p === "string" && p.toLowerCase() === "loading")) {
      const combatantStatesForLoading = await this.deps.combatRepo.listCombatants(encounter.id);
      const actorForLoading = combatantStatesForLoading.find(
        (c: any) => c.characterId === actorId || c.monsterId === actorId || c.npcId === actorId,
      );
      if (actorForLoading) {
        const loadRes = normalizeResources(actorForLoading.resources);
        await this.deps.combatRepo.updateCombatantState(actorForLoading.id, {
          resources: { ...loadRes, loadingWeaponFiredThisTurn: true } as any,
        });
      }
    }

    // Drop thrown weapon on the ground at target position (hit)
    if (action.weaponSpec?.isThrownAttack) {
      await this.dropThrownWeaponOnGround(encounter, actorId, action.targetId, action.weaponSpec, encounter.round ?? 1);
    }

    // Check for victory/defeat if target was defeated
    let combatEnded = false;
    let victoryStatus: CombatVictoryStatus | undefined;
    if (hpAfter <= 0 && this.deps.victoryPolicy) {
      // Re-fetch combatants with updated HP
      const updatedCombatants = await this.deps.combatRepo.listCombatants(encounter.id);
      victoryStatus = await this.deps.victoryPolicy.evaluate({ combatants: updatedCombatants }) ?? undefined;

      if (victoryStatus) {
        combatEnded = true;
        // Update encounter status
        await this.deps.combatRepo.updateEncounter(encounter.id, { status: victoryStatus });

        // Emit CombatEnded event if event repo is available
        if (this.deps.events) {
          await this.deps.events.append(sessionId, {
            id: nanoid(),
            type: "CombatEnded",
            payload: { encounterId: encounter.id, result: victoryStatus },
          });
        }
      }
    }

    // Drop loot from defeated monsters onto the battlefield
    if (hpAfter <= 0 && targetCombatant?.combatantType === "Monster") {
      await this.dropMonsterLoot(encounter, targetCombatant, monsters);
    }

    const narration = await this.eventEmitter.generateNarration(combatEnded ? "combatVictory" : "damageDealt", {
      damageRoll: rollValue,
      damageModifier,
      totalDamage,
      targetName,
      hpBefore,
      hpAfter,
      defeated: hpAfter <= 0,
      victoryStatus,
    });

    const enhancementSuffix = genericEnhancements.map((r) => ` ${r.summary}`).join("");
    return {
      rollType: "damage",
      rawRoll: rollValue,
      modifier: damageModifier,
      total: totalDamage,
      totalDamage,
      targetName,
      hpBefore,
      hpAfter,
      targetHpRemaining: hpAfter,
      actionComplete: true,
      requiresPlayerInput: false,
      message: combatEnded
        ? `${rollValue} + ${damageModifier} = ${totalDamage} damage to ${targetName}! HP: ${hpBefore} → ${hpAfter}. ${victoryStatus}!${masterySuffix}${enhancementSuffix}`
        : `${rollValue} + ${damageModifier} = ${totalDamage} damage to ${targetName}! HP: ${hpBefore} → ${hpAfter}${masterySuffix}${enhancementSuffix}`,
      narration,
      combatEnded,
      victoryStatus,
      ...(ohtResult ? { openHandTechnique: ohtResult } : {}),
      ...(stunningStrikeResult ? { stunningStrike: stunningStrikeResult } : {}),
      ...(genericEnhancements.length > 0 ? { enhancements: genericEnhancements } : {}),
    };
  }

  /**
   * Handle a death saving throw roll result.
   * D&D 5e: DC 10, nat 20 = revive with 1 HP, nat 1 = 2 failures.
   * 3 successes = stabilized, 3 failures = dead.
   * After the death save, the turn auto-advances (dying characters can't act),
   * unless the character is revived by a nat 20.
   */
  private async handleDeathSaveRoll(
    sessionId: string,
    encounter: any,
    action: DeathSavePendingAction,
    command: { value?: number; values?: number[] },
    actorId: string,
  ): Promise<any> {
    const rollValue = command.value ?? (Array.isArray(command.values) ? command.values[0] : 0);
    const currentDeathSaves = action.currentDeathSaves;

    const saveResult = makeDeathSave(rollValue, currentDeathSaves);
    const updatedDeathSaves = applyDeathSaveResult(currentDeathSaves, saveResult);

    let resultType: string;
    let hpRestored = 0;
    let isStabilized = false;
    let isDead = false;

    if (saveResult.outcome === "dead") {
      resultType = "dead";
      isDead = true;
    } else if (saveResult.outcome === "stabilized") {
      resultType = "stabilized";
      isStabilized = true;
    } else if (saveResult.outcome === "success" && (saveResult as any).criticalSuccess) {
      resultType = "revived";
      hpRestored = 1;
    } else {
      resultType = saveResult.outcome; // "success" or "failure"
    }

    // Update combatant state
    const combatants = await this.deps.combatRepo.listCombatants(encounter.id);
    const actorCombatant = combatants.find((c) => c.characterId === actorId);

    // Compute the actual final death saves for response + storage
    // applyDeathSaveResult returns unchanged counters for dead/stabilized outcomes,
    // but we need to reflect the real final state
    let finalDeathSaves: DeathSaves;
    if (resultType === "revived") {
      finalDeathSaves = resetDeathSaves();
    } else if (isDead) {
      finalDeathSaves = { successes: currentDeathSaves.successes, failures: 3 };
    } else if (isStabilized) {
      finalDeathSaves = { successes: 3, failures: currentDeathSaves.failures };
    } else {
      finalDeathSaves = updatedDeathSaves;
    }

    if (actorCombatant) {
      const resources = normalizeResources(actorCombatant.resources);
      const updatedResources = {
        ...resources,
        deathSaves: finalDeathSaves,
        stabilized: isStabilized || (resultType === "revived" ? false : !!(resources as any).stabilized),
      };

      const updateData: Record<string, unknown> = { resources: updatedResources };

      if (hpRestored > 0) {
        updateData.hpCurrent = hpRestored;
        // Remove Unconscious condition on revival (keep Prone — standing up costs movement)
        const conditions = normalizeConditions(actorCombatant.conditions);
        updateData.conditions = removeCondition(conditions, "Unconscious" as Condition) as any;
      }

      await this.deps.combatRepo.updateCombatantState(actorCombatant.id, updateData);
    }

    // Clear pending action
    await this.deps.combatRepo.clearPendingAction(encounter.id);

    // Emit death save event
    if (this.deps.events) {
      await this.deps.events.append(sessionId, {
        id: nanoid(),
        type: "DeathSave",
        payload: {
          encounterId: encounter.id,
          combatantId: actorCombatant?.id,
          roll: rollValue,
          result: resultType,
          deathSaves: finalDeathSaves,
          ...(hpRestored > 0 ? { hpRestored } : {}),
        },
      });
    }

    // Check victory/defeat after death
    let combatEnded = false;
    let victoryStatus: CombatVictoryStatus | undefined;
    if (isDead && this.deps.victoryPolicy) {
      const updatedCombatants = await this.deps.combatRepo.listCombatants(encounter.id);
      victoryStatus = (await this.deps.victoryPolicy.evaluate({ combatants: updatedCombatants })) ?? undefined;
      if (victoryStatus) {
        combatEnded = true;
        await this.deps.combatRepo.updateEncounter(encounter.id, { status: victoryStatus });
        if (this.deps.events) {
          await this.deps.events.append(sessionId, {
            id: nanoid(),
            type: "CombatEnded",
            payload: { encounterId: encounter.id, result: victoryStatus },
          });
        }
      }
    }

    // Auto-advance turn (dying characters can't act)
    // If revived (nat 20), the player can act normally — don't auto-advance
    if (!hpRestored && !combatEnded) {
      await this.deps.combat.nextTurn(sessionId, { encounterId: encounter.id, skipDeathSaveAutoRoll: true });
      if (this.deps.aiOrchestrator) {
        void this.deps.aiOrchestrator.processAllMonsterTurns(sessionId, encounter.id).catch(console.error);
      }
    }

    // Build message
    let message: string;
    if (resultType === "revived") {
      message = `Death Save: Natural 20! Regains 1 HP and is conscious!`;
    } else if (resultType === "stabilized") {
      message = `Death Save: ${rollValue} — Success! (3 successes) Stabilized!`;
    } else if (resultType === "dead") {
      message = `Death Save: ${rollValue} — ${rollValue === 1 ? "Natural 1! Two failures!" : "Failure!"} (3 failures) Dead!`;
    } else if (resultType === "success") {
      message = `Death Save: ${rollValue} — Success! (${updatedDeathSaves.successes} successes, ${updatedDeathSaves.failures} failures)`;
    } else {
      message = `Death Save: ${rollValue} — ${rollValue === 1 ? "Natural 1! Two failures!" : "Failure!"} (${updatedDeathSaves.successes} successes, ${updatedDeathSaves.failures} failures)`;
    }

    const narration = await this.eventEmitter.generateNarration("deathSave", {
      roll: rollValue,
      result: resultType,
      deathSaves: updatedDeathSaves,
    });

    return {
      rollType: "deathSave",
      rawRoll: rollValue,
      deathSaveResult: resultType,
      deathSaves: finalDeathSaves,
      actionComplete: true,
      requiresPlayerInput: false,
      message,
      narration,
      combatEnded,
      victoryStatus,
    };
  }

  // ----- Saving Throw Handler -----

  /**
   * Handle a SAVING_THROW pending action.
   * Auto-resolves the save (server rolls) and applies the outcome.
   * Returns a SavingThrowAutoResult (cast as DamageResult for the union return type).
   */
  private async handleSavingThrowAction(
    sessionId: string,
    encounter: any,
    action: SavingThrowPendingAction,
    characters: any[],
    monsters: any[],
    npcs: any[],
  ): Promise<any> {
    if (!this.savingThrowResolver) {
      throw new ValidationError("DiceRoller is required for saving throw resolution");
    }

    // Auto-resolve the saving throw
    const resolution = await this.savingThrowResolver.resolve(
      action,
      encounter.id,
      characters,
      monsters,
      npcs,
    );

    // Clear the pending action
    await this.deps.combatRepo.clearPendingAction(encounter.id);

    const narration = await this.eventEmitter.generateNarration("savingThrow", {
      reason: action.reason,
      ability: action.ability,
      dc: action.dc,
      rawRoll: resolution.rawRoll,
      modifier: resolution.modifier,
      total: resolution.total,
      success: resolution.success,
      outcomeSummary: resolution.appliedOutcome.summary,
    });

    return this.savingThrowResolver.buildResult(action, resolution, {
      actionComplete: true,
      requiresPlayerInput: false,
      narration,
    });
  }

  // ----- Weapon Mastery Resolution -----

  /**
   * Resolve automatic weapon mastery effects after damage is dealt.
   *
   * Returns a suffix string to append to the damage message.
   * Effects are applied to combat state (conditions, resources, position).
   *
   * Mastery effects are AUTOMATIC (not opt-in like Stunning Strike) and
   * resolved separately from the HitRiderEnhancement pipeline.
   */
  private async resolveWeaponMastery(
    mastery: WeaponMasteryProperty,
    actorId: string,
    targetId: string,
    encounterId: string,
    sessionId: string,
    weaponSpec: import("./tabletop-types.js").WeaponSpec,
    characters: any[],
    monsters: any[],
    npcs: any[],
  ): Promise<string> {
    const target =
      monsters.find((m: any) => m.id === targetId) ||
      characters.find((c: any) => c.id === targetId) ||
      npcs.find((n: any) => n.id === targetId);
    const targetName = (target as any)?.name ?? "Target";

    switch (mastery) {
      case "push": {
        // Push: Strength save or pushed up to 10 feet (Large or smaller)
        if (!this.savingThrowResolver) return "";

        // Get attacker's ability modifier + proficiency for DC
        const actorChar = characters.find((c: any) => c.id === actorId);
        const actorSheet = (actorChar?.sheet ?? {}) as any;
        const actorLevel = ClassFeatureResolver.getLevel(actorSheet, actorChar?.level);
        const profBonus = ClassFeatureResolver.getProficiencyBonus(actorSheet, actorLevel);
        // Use STR or DEX depending on weapon type (finesse can use DEX)
        const strScore = actorSheet?.abilityScores?.strength ?? 10;
        const dexScore = actorSheet?.abilityScores?.dexterity ?? 10;
        const strMod = Math.floor((strScore - 10) / 2);
        const dexMod = Math.floor((dexScore - 10) / 2);
        const abilityMod = isFinesse(weaponSpec.properties) ? Math.max(strMod, dexMod) : strMod;
        const dc = 8 + abilityMod + profBonus;

        const saveAction = this.savingThrowResolver.buildPendingAction({
          actorId: targetId,
          sourceId: actorId,
          ability: "strength",
          dc,
          reason: `${weaponSpec.name} (Push mastery)`,
          onSuccess: { summary: "Resists the push!" },
          onFailure: { movement: { push: 10 }, summary: "Pushed 10 feet!" },
        });

        const resolution = await this.savingThrowResolver.resolve(
          saveAction, encounterId, characters, monsters, npcs,
        );

        if (this.debugLogsEnabled) {
          console.log(`[RollStateMachine] Push mastery: ${targetName} ${resolution.success ? "resists" : "pushed 10ft"} (STR save ${resolution.total} vs DC ${dc})`);
        }

        return resolution.success
          ? ` Push: ${targetName} resists (STR ${resolution.total} vs DC ${dc}).`
          : ` Push: ${targetName} pushed 10 feet (STR ${resolution.total} vs DC ${dc})!`;
      }

      case "topple": {
        // Topple: CON save or knocked Prone
        if (!this.savingThrowResolver) return "";

        const actorChar = characters.find((c: any) => c.id === actorId);
        const actorSheet = (actorChar?.sheet ?? {}) as any;
        const actorLevel = ClassFeatureResolver.getLevel(actorSheet, actorChar?.level);
        const profBonus = ClassFeatureResolver.getProficiencyBonus(actorSheet, actorLevel);
        const strScore = actorSheet?.abilityScores?.strength ?? 10;
        const dexScore = actorSheet?.abilityScores?.dexterity ?? 10;
        const strMod = Math.floor((strScore - 10) / 2);
        const dexMod = Math.floor((dexScore - 10) / 2);
        const abilityMod = isFinesse(weaponSpec.properties) ? Math.max(strMod, dexMod) : strMod;
        const dc = 8 + abilityMod + profBonus;

        const saveAction = this.savingThrowResolver.buildPendingAction({
          actorId: targetId,
          sourceId: actorId,
          ability: "constitution",
          dc,
          reason: `${weaponSpec.name} (Topple mastery)`,
          onSuccess: { summary: "Keeps footing!" },
          onFailure: { conditions: { add: ["Prone"] }, summary: "Knocked Prone!" },
        });

        const resolution = await this.savingThrowResolver.resolve(
          saveAction, encounterId, characters, monsters, npcs,
        );

        if (this.debugLogsEnabled) {
          console.log(`[RollStateMachine] Topple mastery: ${targetName} ${resolution.success ? "keeps footing" : "knocked Prone"} (CON save ${resolution.total} vs DC ${dc})`);
        }

        return resolution.success
          ? ` Topple: ${targetName} keeps footing (CON ${resolution.total} vs DC ${dc}).`
          : ` Topple: ${targetName} knocked Prone (CON ${resolution.total} vs DC ${dc})!`;
      }

      case "vex": {
        // Vex: Gain advantage on next attack against the same target before end of your next turn
        // Uses ActiveEffect with until_triggered duration for one-use advantage
        const combatants = await this.deps.combatRepo.listCombatants(encounterId);
        const actorCombatant = combatants.find(
          (c: any) => c.characterId === actorId || c.monsterId === actorId || c.npcId === actorId,
        );
        if (actorCombatant) {
          const vexEffect = createEffect(nanoid(), "advantage", "attack_rolls", "until_triggered", {
            targetCombatantId: targetId,
            source: "Vex",
            description: `Advantage on next attack against ${targetName}`,
          });
          const updatedResources = addActiveEffectsToResources(actorCombatant.resources ?? {}, vexEffect);
          await this.deps.combatRepo.updateCombatantState(actorCombatant.id, {
            resources: updatedResources as any,
          });
        }

        if (this.debugLogsEnabled) {
          console.log(`[RollStateMachine] Vex mastery: ${actorId} gains advantage on next attack vs ${targetName}`);
        }

        return ` Vex: Advantage on next attack against ${targetName}!`;
      }

      case "sap": {
        // Sap: Target has disadvantage on its next attack roll before your next turn
        const combatants = await this.deps.combatRepo.listCombatants(encounterId);
        const targetCombatant = combatants.find(
          (c: any) => c.characterId === targetId || c.monsterId === targetId || c.npcId === targetId,
        );
        if (targetCombatant && !isConditionImmuneByEffects(targetCombatant.resources, "Sapped")) {
          let conditions = normalizeConditions(targetCombatant.conditions);
          conditions = addCondition(conditions, createCondition("Sapped" as Condition, "until_start_of_next_turn", {
            source: `${weaponSpec.name} (Sap mastery)`,
            expiresAt: { event: "start_of_turn" as const, combatantId: actorId },
          }));
          await this.deps.combatRepo.updateCombatantState(targetCombatant.id, {
            conditions: conditions as any,
          });
        }

        if (this.debugLogsEnabled) {
          console.log(`[RollStateMachine] Sap mastery: ${targetName} has disadvantage on next attack`);
        }

        return ` Sap: ${targetName} has disadvantage on next attack!`;
      }

      case "slow": {
        // Slow: Target's speed reduced by 10ft until start of your next turn
        const combatants = await this.deps.combatRepo.listCombatants(encounterId);
        const targetCombatant = combatants.find(
          (c: any) => c.characterId === targetId || c.monsterId === targetId || c.npcId === targetId,
        );
        if (targetCombatant && !isConditionImmuneByEffects(targetCombatant.resources, "Slowed")) {
          let conditions = normalizeConditions(targetCombatant.conditions);
          conditions = addCondition(conditions, createCondition("Slowed" as Condition, "until_start_of_next_turn", {
            source: `${weaponSpec.name} (Slow mastery)`,
            expiresAt: { event: "start_of_turn" as const, combatantId: actorId },
          }));
          await this.deps.combatRepo.updateCombatantState(targetCombatant.id, {
            conditions: conditions as any,
          });
        }

        if (this.debugLogsEnabled) {
          console.log(`[RollStateMachine] Slow mastery: ${targetName} speed reduced by 10ft`);
        }

        return ` Slow: ${targetName}'s speed reduced by 10ft!`;
      }

      case "cleave": {
        // Cleave: If you hit a creature with a melee attack roll using this weapon,
        // you can make a melee attack roll with the weapon against a second creature
        // within 5 feet of the first that is also within your reach. On a hit, the
        // second creature takes the weapon's damage, but don't add your ability modifier
        // to that damage unless that modifier is negative. Once per turn.
        if (!this.deps.diceRoller) return "";

        // Check once-per-turn limit
        const combatantsForCleave = await this.deps.combatRepo.listCombatants(encounterId);
        const actorCombatantForCleave = combatantsForCleave.find(
          (c: any) => c.characterId === actorId || c.monsterId === actorId || c.npcId === actorId,
        );
        if (!actorCombatantForCleave) return "";

        const cleaveRes = normalizeResources(actorCombatantForCleave.resources);
        if (cleaveRes.cleaveUsedThisTurn) {
          if (this.debugLogsEnabled) console.log(`[RollStateMachine] Cleave mastery: already used this turn`);
          return "";
        }

        // Find the position of the hit target and the attacker
        const targetCombatantForCleave = combatantsForCleave.find(
          (c: any) => c.characterId === targetId || c.monsterId === targetId || c.npcId === targetId,
        );
        if (!targetCombatantForCleave) return "";

        const actorPosForCleave = getPosition(actorCombatantForCleave.resources ?? {});
        const targetPosForCleave = getPosition(targetCombatantForCleave.resources ?? {});
        if (!actorPosForCleave || !targetPosForCleave) return "";

        // Find a second creature within 5ft of the hit target AND within attacker's reach (5ft for melee)
        // Must be alive, hostile, and NOT the original target
        const cleaveReach = 5; // Standard melee reach
        const secondaryTargets = combatantsForCleave.filter((c: any) => {
          if (c.id === actorCombatantForCleave.id) return false; // skip attacker
          if (c.id === targetCombatantForCleave.id) return false; // skip original target
          if (c.hpCurrent <= 0) return false; // skip dead
          const cPos = getPosition(c.resources ?? {});
          if (!cPos) return false;
          // Within 5ft of the original target
          const distToTarget = calculateDistance(targetPosForCleave, cPos);
          if (distToTarget > 5.0001) return false;
          // Within attacker's reach
          const distToAttacker = calculateDistance(actorPosForCleave, cPos);
          if (distToAttacker > cleaveReach + 0.0001) return false;
          return true;
        });

        if (secondaryTargets.length === 0) {
          if (this.debugLogsEnabled) console.log(`[RollStateMachine] Cleave mastery: no adjacent secondary target found`);
          return "";
        }

        // Pick the first available secondary target
        const secondaryTarget = secondaryTargets[0];
        const secondaryTargetId = secondaryTarget.monsterId || secondaryTarget.characterId || secondaryTarget.npcId;
        const secondaryEntity =
          monsters.find((m: any) => m.id === secondaryTargetId) ||
          characters.find((c: any) => c.id === secondaryTargetId) ||
          npcs.find((n: any) => n.id === secondaryTargetId);
        const secondaryTargetName = (secondaryEntity as any)?.name ?? "Target";
        const secondaryTargetAC = (secondaryEntity as any)?.statBlock?.armorClass
          ?? (secondaryEntity as any)?.sheet?.armorClass ?? 10;

        // Mark cleave as used this turn
        await this.deps.combatRepo.updateCombatantState(actorCombatantForCleave.id, {
          resources: { ...cleaveRes, cleaveUsedThisTurn: true } as any,
        });

        // Auto-roll secondary attack
        const cleaveAttackRoll = this.deps.diceRoller.d20();
        const cleaveAttackBonus = weaponSpec.attackBonus ?? 0;
        const cleaveAttackTotal = cleaveAttackRoll.total + cleaveAttackBonus;
        const cleaveHit = cleaveAttackTotal >= secondaryTargetAC;
        const cleaveCritMiss = cleaveAttackRoll.total === 1;
        const cleaveCritHit = cleaveAttackRoll.total === 20;

        if (this.debugLogsEnabled) {
          console.log(`[RollStateMachine] Cleave mastery: secondary attack d20(${cleaveAttackRoll.total}) + ${cleaveAttackBonus} = ${cleaveAttackTotal} vs AC ${secondaryTargetAC} → ${cleaveHit ? "HIT" : "MISS"}`);
        }

        if (!cleaveHit && !cleaveCritHit) {
          return ` Cleave: Attack ${secondaryTargetName} — d20(${cleaveAttackRoll.total}) + ${cleaveAttackBonus} = ${cleaveAttackTotal} vs AC ${secondaryTargetAC}. Miss!`;
        }

        // Roll weapon damage WITHOUT ability modifier (unless modifier is negative)
        const dmgSpec = weaponSpec.damage;
        let cleaveDmg = 0;
        if (dmgSpec) {
          for (let i = 0; i < dmgSpec.diceCount; i++) {
            const dieRoll = this.deps.diceRoller.rollDie(dmgSpec.diceSides);
            cleaveDmg += dieRoll.total;
          }
          // Only add ability modifier if it's negative
          if (dmgSpec.modifier < 0) {
            cleaveDmg = Math.max(0, cleaveDmg + dmgSpec.modifier);
          }
          // Critical hit: double dice
          if (cleaveCritHit) {
            for (let i = 0; i < dmgSpec.diceCount; i++) {
              const dieRoll = this.deps.diceRoller.rollDie(dmgSpec.diceSides);
              cleaveDmg += dieRoll.total;
            }
          }
        }

        // Apply damage to secondary target
        const secondaryHpBefore = secondaryTarget.hpCurrent;
        const secondaryHpAfter = Math.max(0, secondaryHpBefore - cleaveDmg);
        await this.deps.combatRepo.updateCombatantState(secondaryTarget.id, { hpCurrent: secondaryHpAfter });
        await applyKoEffectsIfNeeded(secondaryTarget, secondaryHpBefore, secondaryHpAfter, this.deps.combatRepo);

        if (this.debugLogsEnabled) {
          console.log(`[RollStateMachine] Cleave mastery: ${cleaveDmg} damage to ${secondaryTargetName} (HP: ${secondaryHpBefore} → ${secondaryHpAfter})`);
        }

        return ` Cleave: Attack ${secondaryTargetName} — d20(${cleaveAttackRoll.total}) + ${cleaveAttackBonus} = ${cleaveAttackTotal} vs AC ${secondaryTargetAC}. Hit! ${cleaveDmg} damage (HP: ${secondaryHpBefore} → ${secondaryHpAfter})!`;
      }

      case "nick": {
        // Nick: Light weapon's extra attack is part of the Attack action (not bonus action)
        // This is handled at the action-dispatch level, not post-damage
        return "";
      }

      case "graze": {
        // Graze is handled in the miss path of handleAttackRoll, not here
        return "";
      }

      default:
        return "";
    }
  }

  // ----- Post-Damage Effect Resolution (System 2) -----

  /**
   * Resolve a post-damage effect from a hit-rider enhancement.
   * Handles saving throws (via SavingThrowResolver), condition application, etc.
   *
   * This is the core of the generic hit-rider pipeline — any ability that triggers
   * effects after damage (Stunning Strike, Open Hand Technique, Divine Smite conditions, etc.)
   * routes through here.
   */
  private async resolvePostDamageEffect(
    enhancement: HitRiderEnhancement,
    actorId: string,
    targetId: string,
    encounterId: string,
    characters: any[],
    monsters: any[],
    npcs: any[],
  ): Promise<HitRiderEnhancementResult> {
    const ctx = enhancement.context ?? {};
    const target =
      monsters.find((m) => m.id === targetId) ||
      characters.find((c) => c.id === targetId) ||
      npcs.find((n) => n.id === targetId);
    const targetName = (target as any)?.name ?? "Target";

    // Spend resources if specified in context (e.g. 1 ki for Stunning Strike)
    if (ctx.resourceCost) {
      const { pool, amount } = ctx.resourceCost as { pool: string; amount: number };
      const combatants = await this.deps.combatRepo.listCombatants(encounterId);
      const actorCombatant = combatants.find(
        (c: any) => c.combatantType === "Character" && c.characterId === actorId,
      );
      if (actorCombatant) {
        let updatedRes = updateResourcePool(actorCombatant.resources ?? {}, pool, (p) => ({
          ...p, current: Math.max(0, p.current - amount),
        }));
        const normalized = normalizeResources(updatedRes);
        if (ctx.turnTrackingKey) {
          (normalized as any)[ctx.turnTrackingKey as string] = true;
        }
        await this.deps.combatRepo.updateCombatantState(actorCombatant.id, {
          resources: normalized as any,
        });
        if (this.debugLogsEnabled) {
          console.log(`[RollStateMachine] ${enhancement.displayName}: Spent ${amount} ${pool}`);
        }
      }
    }

    switch (enhancement.postDamageEffect) {
      case "saving-throw": {
        if (!this.savingThrowResolver) {
          return {
            abilityId: enhancement.abilityId,
            displayName: enhancement.displayName,
            summary: `${enhancement.displayName}: Saving throw resolver not available.`,
          };
        }

        const saveAction = this.savingThrowResolver.buildPendingAction({
          actorId: targetId,
          sourceId: (ctx.sourceId as string) ?? actorId,
          ability: ctx.saveAbility as string,
          dc: ctx.saveDC as number,
          reason: ctx.saveReason as string,
          onSuccess: ctx.onSuccess as SaveOutcome,
          onFailure: ctx.onFailure as SaveOutcome,
          context: ctx.expiresAt ? { expiresAt: ctx.expiresAt } : undefined,
        });

        const resolution = await this.savingThrowResolver.resolve(
          saveAction, encounterId, characters, monsters, npcs,
        );

        const abilityUpper = ((ctx.saveAbility as string) ?? "").toUpperCase().slice(0, 3);
        const successSummary = `${enhancement.displayName}: ${targetName} makes ${abilityUpper} save (${resolution.total} vs DC ${resolution.dc})! ${resolution.appliedOutcome.summary}`;
        const failureSummary = `${enhancement.displayName}: ${targetName} fails ${abilityUpper} save (${resolution.total} vs DC ${resolution.dc}) and is ${resolution.conditionsApplied[0] ?? "affected"}!`;

        if (this.debugLogsEnabled) {
          console.log(`[RollStateMachine] ${enhancement.displayName}: ${targetName} ${resolution.success ? "makes" : "fails"} ${abilityUpper} save (${resolution.total} vs DC ${resolution.dc})`);
        }

        return {
          abilityId: enhancement.abilityId,
          displayName: enhancement.displayName,
          summary: resolution.success ? successSummary : failureSummary,
          saved: resolution.success,
          saveRoll: resolution.rawRoll,
          saveTotal: resolution.total,
          saveDC: resolution.dc,
          conditionApplied: resolution.conditionsApplied[0],
        };
      }

      case "apply-condition": {
        const conditionName = ctx.conditionName as string;
        const combatants = await this.deps.combatRepo.listCombatants(encounterId);
        const targetCombatant = combatants.find(
          (c: any) => c.characterId === targetId || c.monsterId === targetId || c.npcId === targetId,
        );
        if (targetCombatant && !isConditionImmuneByEffects(targetCombatant.resources, conditionName)) {
          let conditions = normalizeConditions(targetCombatant.conditions);
          conditions = addCondition(conditions, createCondition(conditionName as Condition, "until_removed", {
            source: enhancement.displayName,
          }));
          await this.deps.combatRepo.updateCombatantState(targetCombatant.id, {
            conditions: conditions as any,
          });
        }

        if (this.debugLogsEnabled) {
          console.log(`[RollStateMachine] ${enhancement.displayName}: ${targetName} is ${conditionName}`);
        }

        return {
          abilityId: enhancement.abilityId,
          displayName: enhancement.displayName,
          summary: `${enhancement.displayName}: ${targetName} has disadvantage on next attack roll!`,
          conditionApplied: conditionName,
        };
      }

      default:
        return {
          abilityId: enhancement.abilityId,
          displayName: enhancement.displayName,
          summary: `${enhancement.displayName} effect triggered.`,
        };
    }
  }

  /**
   * Expose the saving throw resolver for direct access by other modules.
   * Used by the action dispatcher to inject saving throws mid-flow.
   */
  getSavingThrowResolver(): SavingThrowResolver | null {
    return this.savingThrowResolver;
  }
}
