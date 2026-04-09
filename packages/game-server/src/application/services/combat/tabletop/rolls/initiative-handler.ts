/**
 * InitiativeHandler — handles initiative roll and initiative swap resoltuion.
 *
 * Extracted from RollStateMachine (Phase: God-Module Decomposition §2.1).
 * Responsible for:
 *   - Building combatant list from session entities
 *   - Applying class resource pools at combat start
 *   - Uncanny Metabolism auto-trigger
 *   - Alert feat initiative swap offer / resolution
 *   - Kicking off AI orchestrator when monster acts first
 */

import { nanoid } from "nanoid";
import { ValidationError } from "../../../../errors.js";
import { ClassFeatureResolver } from "../../../../../domain/entities/classes/class-feature-resolver.js";
import { classHasFeature } from "../../../../../domain/entities/classes/registry.js";
import { UNCANNY_METABOLISM, DANGER_SENSE } from "../../../../../domain/entities/classes/feature-keys.js";
import { buildCombatResources } from "../../../../../domain/entities/classes/combat-resource-builder.js";
import { createEffect } from "../../../../../domain/entities/combat/effects.js";
import {
  getResourcePools,
  updateResourcePool,
  addActiveEffectsToResources,
} from "../../helpers/resource-utils.js";
import { findCombatantByEntityId } from "../../helpers/combatant-lookup.js";
import { getMartialArtsDieSize } from "../../../../../domain/rules/martial-arts-die.js";
import { computeFeatModifiers } from "../../../../../domain/rules/feat-modifiers.js";
import { parseLegendaryTraits } from "../../../../../domain/entities/creatures/legendary-actions.js";
import { computeInitiativeRollMode } from "../tabletop-utils.js";
import type { TabletopEventEmitter } from "../tabletop-event-emitter.js";
import { assertValidTransition } from "../pending-action-state-machine.js";
import type {
  TabletopCombatServiceDeps,
  InitiatePendingAction,
  InitiativeSwapPendingAction,
  CombatStartedResult,
} from "../tabletop-types.js";

// ---------------------------------------------------------------------------
// Private helper — roll initiative d20 with advantage/disadvantage
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Private helper — build combatant resources from entity sheet/statBlock
// ---------------------------------------------------------------------------

function buildCombatantResources(
  className: string,
  level: number,
  sheet: any,
  classLevels?: Array<{ classId: string; level: number; subclass?: string }>,
): Record<string, unknown> {
  const resources: Record<string, unknown> = {};

  // Position
  if (sheet?.position) {
    resources.position = sheet.position;
  }

  // Combat resources (class pools, spell prep flags)
  const combatRes = buildCombatResources({
    className,
    level,
    sheet: sheet ?? {},
    classLevels,
  });
  if (combatRes.resourcePools.length > 0) {
    resources.resourcePools = combatRes.resourcePools;
  }
  if (combatRes.hasShieldPrepared) {
    (resources as any).hasShieldPrepared = true;
  }
  if (combatRes.hasCounterspellPrepared) {
    (resources as any).hasCounterspellPrepared = true;
  }
  if (combatRes.hasAbsorbElementsPrepared) {
    (resources as any).hasAbsorbElementsPrepared = true;
  }
  if (combatRes.hasHellishRebukePrepared) {
    (resources as any).hasHellishRebukePrepared = true;
  }
  if (combatRes.warCasterEnabled) {
    (resources as any).warCasterEnabled = true;
  }
  if (combatRes.sentinelEnabled) {
    (resources as any).sentinelEnabled = true;
  }
  if (combatRes.pactSlotLevel !== undefined) {
    (resources as any).pactSlotLevel = combatRes.pactSlotLevel;
  }

  // D&D 5e 2024: Danger Sense (Barbarian 2+) — permanent advantage on DEX saving throws
  if (className.toLowerCase() === "barbarian" && classHasFeature("barbarian", DANGER_SENSE, level)) {
    const dangerSenseEffect = createEffect(nanoid(), "advantage", "saving_throws", "permanent", {
      ability: "dexterity",
      source: "Danger Sense",
      description: "Advantage on DEX saving throws (Danger Sense)",
    });
    addActiveEffectsToResources(resources, dangerSenseEffect);
  }

  // D&D 5e 2024: Drawn weapons — at combat start, all equipped weapons are drawn and ready
  const attacks = Array.isArray(sheet?.attacks) ? sheet.attacks as Array<{ name?: string }> : [];
  if (attacks.length > 0) {
    resources.drawnWeapons = attacks
      .map((a: { name?: string }) => a.name)
      .filter((n: string | undefined): n is string => typeof n === "string" && n.length > 0);
  }

  // Inventory (potions, consumables, etc.)
  if (Array.isArray(sheet?.inventory) && sheet.inventory.length > 0) {
    resources.inventory = sheet.inventory;
  }

  // Legendary action resources
  const legendary = parseLegendaryTraits(sheet as Record<string, unknown>);
  if (legendary) {
    resources.legendaryActionCharges = legendary.legendaryActionCharges;
    resources.legendaryActionsRemaining = legendary.legendaryActionCharges;
    resources.legendaryActions = legendary.legendaryActions as unknown[];
    if (legendary.lairActions) {
      resources.lairActions = legendary.lairActions as unknown[];
    }
    if (legendary.isInLair) {
      resources.isInLair = true;
    }
  }

  return resources;
}

// ---------------------------------------------------------------------------
// InitiativeHandler
// ---------------------------------------------------------------------------

export class InitiativeHandler {
  constructor(
    private readonly deps: TabletopCombatServiceDeps,
    private readonly eventEmitter: TabletopEventEmitter,
    private readonly debugLogsEnabled: boolean,
  ) {}

  async handleInitiativeRoll(
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
          if (this.debugLogsEnabled) console.log(`[InitiativeHandler] Alert feat: +${alertBonus} proficiency bonus to initiative`);
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
      const charClassName = character.className ?? sheet?.className ?? "";
      const charLevel = ClassFeatureResolver.getLevel(sheet, character.level);

      const charClassLevels = Array.isArray(sheet?.classLevels) ? sheet.classLevels : undefined;
      const charResources = buildCombatantResources(charClassName, charLevel, sheet, charClassLevels);

      combatants.push(this.buildCombatantEntry("Character", actorId, finalInitiative, sheet?.currentHp ?? sheet?.maxHp ?? 10, sheet?.maxHp ?? 10, charResources));
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
          if (this.debugLogsEnabled) console.log(`[InitiativeHandler] Alert feat (multi-PC): +${otherAlertBonus} proficiency bonus for "${otherChar.name}"`);
        }
      }

      // Auto-roll initiative for non-initiator characters (with surprise/condition modifiers)
      const otherInitMode = computeInitiativeRollMode(otherChar.id, action.surprise, "party", otherSheet?.conditions, otherClassName && otherLevel > 0 ? { className: otherClassName, level: otherLevel } : undefined);
      const otherRoll = rollInitiativeD20(this.deps.diceRoller, otherInitMode);
      if (otherInitMode !== "normal" && this.debugLogsEnabled) {
        console.log(`[InitiativeHandler] Character "${otherChar.name}" initiative with ${otherInitMode}: roll=${otherRoll}`);
      }
      const otherInitiative = otherRoll + otherDexMod + otherAlertBonus;

      const otherClassLevels = Array.isArray(otherSheet?.classLevels) ? otherSheet.classLevels : undefined;
      const otherResources = buildCombatantResources(otherClassName, otherLevel, otherSheet, otherClassLevels);

      combatants.push(this.buildCombatantEntry("Character", otherChar.id, otherInitiative, otherSheet?.currentHp ?? otherSheet?.maxHp ?? 10, otherSheet?.maxHp ?? 10, otherResources));

      if (this.debugLogsEnabled) console.log(`[InitiativeHandler] Multi-PC: Added "${otherChar.name}" with initiative ${otherInitiative} (roll=${otherRoll}, dex=${otherDexMod}, alert=${otherAlertBonus})`);
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
          console.log(`[InitiativeHandler] Monster "${monster.name}" initiative with ${monsterInitMode}: roll=${monsterRoll}`);
        }
        const monsterInitiative = monsterRoll + monsterDexMod;

        const monsterResources = buildCombatantResources(monsterClassName, monsterLevel, statBlock);

        combatants.push(this.buildCombatantEntry("Monster", targetId, monsterInitiative, statBlock.hp ?? statBlock.maxHp ?? 10, statBlock.maxHp ?? statBlock.hp ?? 10, monsterResources));
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
        console.log(`[InitiativeHandler] NPC "${npc.name}" initiative with ${npcInitMode}: roll=${npcRoll}`);
      }
      const npcInitiative = npcRoll + npcDexMod;

      const npcResources = buildCombatantResources(npcClassName, npcLevel, statBlock);

      combatants.push(this.buildCombatantEntry("NPC", npc.id, npcInitiative, statBlock?.hp ?? statBlock?.maxHp ?? 10, statBlock?.maxHp ?? statBlock?.hp ?? 10, npcResources));
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
      if (classHasFeature(charClassName, UNCANNY_METABOLISM, charLevel)) {
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
      assertValidTransition("INITIATIVE", "INITIATIVE_SWAP");
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
   * Build a combatant entry for the initial combatants array.
   * Handles the repeated id-field selection and resources guard pattern.
   */
  private buildCombatantEntry(
    combatantType: "Character" | "Monster" | "NPC",
    entityId: string,
    initiative: number,
    hpCurrent: number,
    hpMax: number,
    resources: Record<string, unknown>,
  ): any {
    const idField = combatantType === "Character" ? "characterId"
      : combatantType === "Monster" ? "monsterId"
      : "npcId";
    return {
      combatantType,
      [idField]: entityId,
      initiative,
      hpCurrent,
      hpMax,
      resources: Object.keys(resources).length > 0 ? resources : undefined,
    };
  }

  /**
   * D&D 5e 2024 Alert feat: handle initiative swap decision.
   * Player says "swap with <name>" or "no swap"/"decline".
   */
  async handleInitiativeSwap(
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
      const holderCombatant = findCombatantByEntityId(combatants, actorId);
      const targetCombatant = findCombatantByEntityId(combatants, swapTargetId);

      if (holderCombatant && targetCombatant) {
        const holderInit = holderCombatant.initiative;
        const targetInit = targetCombatant.initiative;
        await this.deps.combatRepo.updateCombatantState(holderCombatant.id, { initiative: targetInit });
        await this.deps.combatRepo.updateCombatantState(targetCombatant.id, { initiative: holderInit });

        if (this.debugLogsEnabled) {
          const holderName = characters.find((c) => c.id === actorId)?.name ?? actorId;
          const targetName = eligibleTargets.find((t) => t.actorId === swapTargetId)?.actorName ?? swapTargetId;
          console.log(`[InitiativeHandler] Alert swap: ${holderName} (${holderInit} → ${targetInit}) ↔ ${targetName} (${targetInit} → ${holderInit})`);
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
}
