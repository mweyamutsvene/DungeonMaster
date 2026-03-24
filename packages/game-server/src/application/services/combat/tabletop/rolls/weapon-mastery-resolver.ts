/**
 * WeaponMasteryResolver — resolves automatic weapon mastery effects after a hit.
 *
 * Handles all 7 mastery types: push, topple, vex, sap, slow, cleave, nick, graze.
 * These effects are AUTOMATIC (not opt-in like Stunning Strike) and are resolved
 * separately from the HitRiderEnhancement pipeline.
 *
 * Extracted from RollStateMachine (Phase: God-Module Decomposition §2.1).
 */

import { nanoid } from "nanoid";
import { calculateDistance } from "../../../../../domain/rules/movement.js";
import { isFinesse } from "../../../../../domain/entities/items/weapon-properties.js";
import { ClassFeatureResolver } from "../../../../../domain/entities/classes/class-feature-resolver.js";
import {
  getPosition,
  normalizeResources,
  isConditionImmuneByEffects,
  addActiveEffectsToResources,
} from "../../helpers/resource-utils.js";
import {
  normalizeConditions,
  addCondition,
  createCondition,
  type Condition,
} from "../../../../../domain/entities/combat/conditions.js";
import { createEffect } from "../../../../../domain/entities/combat/effects.js";
import { applyKoEffectsIfNeeded } from "../../helpers/ko-handler.js";
import type { SavingThrowResolver } from "./saving-throw-resolver.js";
import type { WeaponMasteryProperty } from "../../../../../domain/rules/weapon-mastery.js";
import type { TabletopCombatServiceDeps, WeaponSpec } from "../tabletop-types.js";

export class WeaponMasteryResolver {
  constructor(
    private readonly deps: TabletopCombatServiceDeps,
    private readonly savingThrowResolver: SavingThrowResolver | null,
    private readonly debugLogsEnabled: boolean,
  ) {}

  /**
   * Resolve automatic weapon mastery effects after damage is dealt.
   *
   * Returns a suffix string to append to the damage message.
   * Effects are applied to combat state (conditions, resources, position).
   */
  async resolve(
    mastery: WeaponMasteryProperty,
    actorId: string,
    targetId: string,
    encounterId: string,
    sessionId: string,
    weaponSpec: WeaponSpec,
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
}
