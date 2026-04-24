/**
 * DeterministicAiDecisionMaker -- Heuristic-based AI that plays reasonable turns
 * without requiring an LLM.
 *
 * Layer: Application (AI module)
 * Implements: IAiDecisionMaker
 *
 * Thin orchestrator that delegates to focused modules:
 * - ai-spell-evaluator.ts -- spell selection, slot evaluation, cantrip picks
 * - ai-bonus-action-picker.ts -- bonus action selection, class features, triage
 * - ai-movement-planner.ts -- movement, positioning, cover-seeking, flanking
 *
 * Decision priority per step:
 * 1. Stand up from Prone (move to current position)
 * 1b. Triage -- heal dying allies (0 HP with death saves) before attacking
 * 2. Evaluate and select a target via scoreTargets()
 * 3. Move to reach target (melee) or maintain range (ranged)
 * 3b. Disengage before retreat if low HP and enemies adjacent
 * 4. Attack with best available attack (repeat for Extra Attacks, re-evaluate targets)
 * 5. Use available bonus actions (Flurry of Blows, Second Wind at low HP, etc.)
 * 6. End turn
 *
 * Handles Monsters, NPCs, and AI-controlled Characters.
 */

import type { IAiDecisionMaker, AiDecision, AiCombatContext } from "./ai-types.js";
import { scoreTargets } from "./ai-target-scorer.js";
import type { CombatMap } from "../../../../domain/rules/combat-map-types.js";

// Extracted modules
import { pickSpell, isBonusActionSpellCast } from "./ai-spell-evaluator.js";
import {
  pickBonusAction,
  pickFeatureAction,
  findDyingAlly,
  pickHealingForDyingAlly,
  hasBonusDisengage,
} from "./ai-bonus-action-picker.js";
import {
  isRangedCreature,
  pickBestAttack,
  hasAdjacentEnemy,
  findCoverPosition,
  findFlankingPosition,
} from "./ai-movement-planner.js";

/**
 * AI2-M2: Consider grapple or shove as tactical alternatives to a regular attack.
 *
 * Heuristics:
 * - **Shove (prone)**: When the creature has multiattack and good STR (mod >= +3).
 *   Shoving prone grants advantage on subsequent melee attacks this turn.
 * - **Grapple**: When the creature has multiattack, good STR, and the target has
 *   high speed (escape risk) or is a caster worth pinning down.
 *
 * Only attempts against targets of similar or smaller size.
 * Returns an AiDecision for grapple/shove, or undefined to fall through to regular attack.
 */
function considerGrappleOrShove(
  combatant: AiCombatContext["combatant"],
  target: { name: string; enemy: AiCombatContext["enemies"][number] },
  attacksPerAction: number,
  combatantName: string,
): AiDecision | undefined {
  // Only consider grapple/shove for creatures with multiattack (can shove + attack)
  if (attacksPerAction < 2) return undefined;

  const selfStr = combatant.abilityScores?.strength ?? 10;
  const selfStrMod = Math.floor((selfStr - 10) / 2);

  // Need decent STR to attempt grapple/shove (Athletics contest)
  if (selfStrMod < 3) return undefined;

  // Size check: can only grapple/shove creatures within one size category
  const sizeOrder = ["tiny", "small", "medium", "large", "huge", "gargantuan"];
  const selfSizeIdx = sizeOrder.indexOf((combatant.size ?? "medium").toLowerCase());
  const targetSizeIdx = sizeOrder.indexOf((target.enemy.size ?? "medium").toLowerCase());
  if (targetSizeIdx > selfSizeIdx + 1) return undefined; // Target is too large

  const targetConditions = (target.enemy.conditions ?? []).map(c => c.toLowerCase());
  const targetAlreadyProne = targetConditions.includes("prone");
  const targetAlreadyGrappled = targetConditions.includes("grappled");

  // Prefer shove (prone) when target isn't already prone — grants advantage on remaining attacks
  if (!targetAlreadyProne) {
    return {
      action: "shove",
      target: target.name,
      endTurn: false,
      intentNarration: `${combatantName} attempts to shove ${target.name} prone!`,
    };
  }

  // Consider grapple when target isn't already grappled and has high speed (escape risk)
  const targetSpeed = target.enemy.speed ?? 30;
  if (!targetAlreadyGrappled && targetSpeed >= 30) {
    return {
      action: "grapple",
      target: target.name,
      endTurn: false,
      intentNarration: `${combatantName} tries to grapple ${target.name}!`,
    };
  }

  return undefined;
}

/** Module-level debug logger, gated by DM_AI_DEBUG env var */
const aiDebugEnabled =
  process.env.DM_AI_DEBUG === "1" ||
  process.env.DM_AI_DEBUG === "true" ||
  process.env.DM_AI_DEBUG === "yes";

function aiLog(...args: unknown[]): void {
  if (aiDebugEnabled) {
    console.log(...args);
  }
}

export class DeterministicAiDecisionMaker implements IAiDecisionMaker {
  async decide(input: {
    combatantName: string;
    combatantType: string;
    context: unknown;
  }): Promise<AiDecision | null> {
    const ctx = input.context as AiCombatContext | undefined;
    if (!ctx) return { action: "endTurn" };

    const combatant = ctx.combatant;
    const economy = combatant.economy;
    const conditions = (combatant.conditions ?? []).map(c => c.toLowerCase());
    const turnResults = ctx.turnResults ?? [];
    const actionHistory = ctx.actionHistory ?? [];

    // Step 1: Stand up from Prone before doing anything else
    if (conditions.includes("prone") && !economy?.movementSpent) {
      const position = combatant.position;
      if (position) {
        return {
          action: "move",
          destination: position, // Move to current position = stand up
          endTurn: false,
          intentNarration: `${input.combatantName} gets up from prone.`,
        };
      }
    }

    // Get living enemies
    const livingEnemies = ctx.enemies.filter(e => e.hp.current > 0);
    if (livingEnemies.length === 0) {
      return {
        action: "endTurn",
        intentNarration: `${input.combatantName} finds no enemies remaining.`,
      };
    }

    // Check what we've already done this turn (hoisted for early steps)
    const hasMoved = turnResults.some(r => (r.action === "move" || r.action === "moveToward" || r.action === "moveAwayFrom") && r.ok);
    const actionSpent = economy?.actionSpent ?? false;
    const movementSpent = economy?.movementSpent ?? false;
    const bonusActionSpent = economy?.bonusActionSpent ?? false;

    // AI-L2: Flee threshold — if HP is at or below the configured threshold, prioritize escape.
    const fleeThreshold = ctx.fleeThreshold;
    if (fleeThreshold !== undefined && fleeThreshold > 0) {
      const hpFraction = combatant.hp.current / combatant.hp.max;
      if (hpFraction <= fleeThreshold) {
        // Try bonus-action disengage first (Cunning Action / Nimble Escape)
        if (!bonusActionSpent && !actionSpent) {
          const bonusDisengage = hasBonusDisengage(combatant);
          if (bonusDisengage) {
            return {
              action: "dash",
              bonusAction: bonusDisengage,
              endTurn: true,
              intentNarration: `${input.combatantName} panics and flees!`,
            };
          }
        }
        // Action disengage + move away
        if (!actionSpent && !movementSpent) {
          return {
            action: "disengage",
            endTurn: false,
            intentNarration: `${input.combatantName} disengages to flee!`,
          };
        }
        // Already disengaged earlier — move away
        if (!movementSpent && livingEnemies[0]) {
          return {
            action: "moveAwayFrom",
            target: livingEnemies[0].name,
            endTurn: true,
            intentNarration: `${input.combatantName} flees in terror!`,
          };
        }
      }
    }

    // Step 1b: Triage — prioritize healing dying allies over attacking
    if (!actionSpent) {
      const dyingAlly = findDyingAlly(ctx.allies);
      if (dyingAlly) {
        const healAction = pickHealingForDyingAlly(combatant, dyingAlly, input.combatantName);
        if (healAction) return healAction;
      }
    }

    // Step 2: Score and select target
    const scoredTargets = scoreTargets(combatant.position, livingEnemies);
    if (scoredTargets.length === 0) {
      return {
        action: "endTurn",
        intentNarration: `${input.combatantName} finds no suitable targets.`,
      };
    }

    const primaryTarget = scoredTargets[0]!;
    const ranged = isRangedCreature(combatant);
    const speed = combatant.speed ?? 30;

    // Determine what attacks we have
    // AI2-M5: Pass target defenses to pickBestAttack for damage-type-aware selection
    const attacks = (combatant.attacks ?? []) as Array<{ name?: string; damage?: string; toHit?: number; kind?: string; type?: string; reach?: number; damageType?: string }>;
    const targetDefenses = {
      damageImmunities: primaryTarget.enemy.damageImmunities,
      damageResistances: primaryTarget.enemy.damageResistances,
      damageVulnerabilities: primaryTarget.enemy.damageVulnerabilities,
    };
    const attackName = pickBestAttack(attacks, primaryTarget.enemy.ac, targetDefenses);

    // Determine effective melee reach (default 5ft)
    const meleeReach = 5;
    // Desired range for ranged creatures
    const preferredRange = ranged ? 30 : meleeReach;

    // Step 3: Movement — get to a useful position
    if (!movementSpent && !hasMoved && speed > 0) {
      const distToTarget = primaryTarget.distanceFeet;

      if (ranged) {
        // Ranged: maintain distance — if too close, move away; if too far, move closer
        if (distToTarget !== Infinity && distToTarget < 10) {
          // Too close for comfort, try to back away
          return {
            action: "moveAwayFrom",
            target: primaryTarget.name,
            endTurn: false,
            intentNarration: `${input.combatantName} repositions away from ${primaryTarget.name}.`,
          };
        }
        if (distToTarget !== Infinity && distToTarget > 60) {
          // Too far to reliably hit, move closer
          const moveDecision: AiDecision = {
            action: "moveToward",
            target: primaryTarget.name,
            desiredRange: preferredRange,
            endTurn: false,
            intentNarration: `${input.combatantName} moves toward ${primaryTarget.name}.`,
          };
          aiLog(`[DeterministicAI] Ranged moveToward: target=${primaryTarget.name}, dist=${Math.round(distToTarget)}ft, desiredRange=${preferredRange}ft, endTurn=${moveDecision.endTurn}`);
          return moveDecision;
        }
        // AI-M7: Cover-seeking — if in attack range, look for a position with cover
        if (combatant.position && distToTarget !== Infinity && distToTarget <= 60) {
          const aiMap = ctx.mapData as CombatMap | undefined;
          if (aiMap) {
            const coverPos = findCoverPosition(combatant.position, primaryTarget, livingEnemies, speed, aiMap);
            if (coverPos) {
              return {
                action: "move",
                destination: coverPos,
                endTurn: false,
                intentNarration: `${input.combatantName} repositions behind cover.`,
              };
            }
          }
        }
      } else {
        // Melee: close distance if out of reach
        if (distToTarget !== Infinity && distToTarget > meleeReach) {
          // AI-L1: Prefer flanking position over generic moveToward
          if (combatant.position && primaryTarget.enemy.position) {
            const allyPositions = ctx.allies
              .filter(a => a.position && a.hp.current > 0)
              .map(a => a.position!);
            if (allyPositions.length > 0) {
              const aiMap = ctx.mapData as CombatMap | undefined;
              const flankPos = findFlankingPosition(
                combatant.position, primaryTarget.enemy.position, allyPositions, speed, aiMap,
              );
              if (flankPos) {
                return {
                  action: "move",
                  destination: flankPos,
                  endTurn: false,
                  intentNarration: `${input.combatantName} moves to flank ${primaryTarget.name}.`,
                };
              }
            }
          }
          const moveDecision: AiDecision = {
            action: "moveToward",
            target: primaryTarget.name,
            desiredRange: meleeReach,
            endTurn: false,
            intentNarration: `${input.combatantName} moves toward ${primaryTarget.name}.`,
          };
          aiLog(`[DeterministicAI] Melee moveToward: target=${primaryTarget.name}, dist=${Math.round(distToTarget)}ft, desiredRange=${meleeReach}ft, endTurn=${moveDecision.endTurn}`);
          return moveDecision;
        }
      }
    }

    // Step 3b: Disengage-before-retreat — if low HP and enemies adjacent,
    // use Disengage (action or bonus) before retreating to avoid opportunity attacks.
    const hpPercent = combatant.hp.percentage;
    if (hpPercent < 25 && livingEnemies.length > 1 && hasAdjacentEnemy(combatant.position, livingEnemies)) {
      const alreadyDisengaged = turnResults.some(r =>
        r.ok && (r.action === "disengage" || (r.data && typeof r.data === "object" && "bonusAction" in r.data)),
      );
      if (!alreadyDisengaged) {
        // Priority 1: Bonus-action disengage (Cunning Action / Nimble Escape) — preserves main action
        if (!bonusActionSpent) {
          const bonusDisengage = hasBonusDisengage(combatant);
          if (bonusDisengage) {
            return {
              action: "endTurn",
              bonusAction: bonusDisengage,
              endTurn: false,
              intentNarration: `${input.combatantName} disengages to retreat safely!`,
            };
          }
        }
        // Priority 2: Main-action Disengage if action not yet spent
        if (!actionSpent) {
          return {
            action: "disengage",
            endTurn: false,
            intentNarration: `${input.combatantName} disengages to avoid opportunity attacks!`,
          };
        }
      }
    }

    // Step 3c: Dodge — take defensive posture when attacking isn't viable
    // Heuristics: low HP with no good targets in range, or multiple adjacent enemies and no attack
    if (!actionSpent) {
      const adjacentEnemyCount = livingEnemies.filter(
        e => e.hp.current > 0 && e.distanceFeet !== undefined && e.distanceFeet <= 5,
      ).length;
      const hasTargetInRange = scoredTargets.some(t => {
        if (ranged) return t.distanceFeet <= 60;
        return t.distanceFeet <= meleeReach;
      });

      const shouldDodge =
        // Low HP and no reachable targets — hunker down
        (hpPercent < 25 && !hasTargetInRange) ||
        // Surrounded by multiple enemies with nothing useful to attack
        (adjacentEnemyCount >= 2 && !attackName && !hasTargetInRange);

      if (shouldDodge) {
        const bonusAction = !bonusActionSpent ? pickBonusAction(combatant, livingEnemies, ctx.allies) : undefined;
        return {
          action: "dodge",
          bonusAction,
          endTurn: true,
          intentNarration: `${input.combatantName} takes the Dodge action, bracing for attacks!`,
        };
      }
    }

    // Step 4: Use healing potion if low HP AND a potion would heal more than
    // the best available bonus-action healing spell (2024: Healing Word +
    // spellcasting mod ≈ 2.5 + mod). `canUseItems` gates beasts/undead/etc.
    // from drinking potions per RAW.
    if (!actionSpent && ctx.canUseItems && ctx.usableItems.length > 0 && combatant.hp.percentage < 40) {
      const bestPotion = ctx.usableItems
        .filter((i) => i.effectKind === "healing" && typeof i.estimatedHeal === "number")
        .sort((a, b) => (b.estimatedHeal ?? 0) - (a.estimatedHeal ?? 0))[0];
      const potionEV = bestPotion?.estimatedHeal ?? 0;
      const spellEV = ctx.bestBonusHealSpellEV ?? 0;
      // Only drink if the best potion beats the best BA spell heal. Goodberry
      // heals 1 HP flat; Healing Word averages 2.5+mod ≈ 5+ for a L3 caster —
      // a Druid with both should prefer the spell.
      if (bestPotion && potionEV >= spellEV) {
        return {
          action: "useObject",
          endTurn: true,
          intentNarration: `${input.combatantName} drinks a healing potion!`,
        };
      }
    }

    // Step 4b: Spell casting — evaluate before physical attacks
    // AI-M1: D&D 5e 2024 BA spell + action cantrip coordination.
    // If a BA spell is picked, the main action can only be a cantrip (not a leveled spell).
    if (!actionSpent) {
      // Preview bonus action to detect BA spell constraint
      let candidateBA: string | undefined;
      if (!bonusActionSpent) {
        candidateBA = pickBonusAction(combatant, livingEnemies, ctx.allies);
      }
      const baIsSpell = candidateBA ? isBonusActionSpellCast(candidateBA) : false;

      let spellDecision: AiDecision | undefined;

      if (baIsSpell) {
        // BA is a spell → main action restricted to cantrips only
        spellDecision = pickSpell(combatant, primaryTarget, ctx.allies, input.combatantName, ctx.combat.round,
          { cantripsOnly: true, enemies: livingEnemies });
        if (spellDecision) {
          spellDecision.bonusAction = candidateBA;
          return spellDecision;
        }
        // No cantrip available → try unrestricted spell without BA spell attached
        spellDecision = pickSpell(combatant, primaryTarget, ctx.allies, input.combatantName, ctx.combat.round,
          { enemies: livingEnemies });
        if (spellDecision) {
          // Don't attach BA spell to a leveled main action spell
          return spellDecision;
        }
      } else {
        // BA is not a spell (or no BA) → no restriction on main action
        spellDecision = pickSpell(combatant, primaryTarget, ctx.allies, input.combatantName, ctx.combat.round,
          { enemies: livingEnemies });
        if (spellDecision) {
          if (candidateBA && !spellDecision.endTurn) {
            spellDecision.bonusAction = candidateBA;
          }
          return spellDecision;
        }
      }
    }

    // Step 4c: Class feature usage — healing when hurt
    if (!actionSpent) {
      const featureDecision = pickFeatureAction(combatant, input.combatantName);
      if (featureDecision) {
        if (!bonusActionSpent && !featureDecision.endTurn) {
          const bonusAction = pickBonusAction(combatant, livingEnemies, ctx.allies);
          if (bonusAction) {
            featureDecision.bonusAction = bonusAction;
          }
        }
        return featureDecision;
      }
    }

    // Step 5: Attack with best available attack (supports Extra Attack / Multiattack)
    const attacksMade = turnResults.filter(r => r.action === "attack").length;
    const attacksPerAction = combatant.attacksPerAction ?? 1;
    const hasAttacksRemaining = attacksMade < attacksPerAction;

    // Step 4d: Grapple/Shove — consider as tactical options for melee creatures
    // Only on the first attack (before any attacks made), when adjacent to target
    if (!actionSpent && attacksMade === 0 && !ranged && primaryTarget.distanceFeet <= meleeReach) {
      const grappleShoveDecision = considerGrappleOrShove(
        combatant, primaryTarget, attacksPerAction, input.combatantName,
      );
      if (grappleShoveDecision) return grappleShoveDecision;
    }

    if (!actionSpent && attackName && hasAttacksRemaining) {
      // AI-M8: Re-evaluate targets between Extra Attack swings.
      // If the previous attack killed the target, re-score to pick the next best.
      let attackTarget = primaryTarget;

      // Check if the current primary target was killed by a previous attack this turn
      const lastAttack = [...turnResults].reverse().find(r => r.action === "attack" && r.ok);
      if (lastAttack && lastAttack.data?.target === primaryTarget.name && lastAttack.data?.hit) {
        // Previous attack hit our primary target — it may be dead now.
        // Re-score from living enemies (already filtered hp > 0) and pick next best.
        const alternateTarget = scoredTargets.find(t => t.name !== primaryTarget.name);
        if (alternateTarget) {
          attackTarget = alternateTarget;
        }
      }

      if (attackTarget.distanceFeet !== Infinity && attackTarget.distanceFeet > meleeReach && !ranged) {
        // Find closest target in melee reach
        const inReach = scoredTargets.find(t => t.distanceFeet <= meleeReach);
        if (inReach) {
          attackTarget = inReach;
        }
      }

      // B12+: Skip futile melee attack when no target is in reach
      if (!ranged && attackTarget.distanceFeet > meleeReach) {
        // If movement is not spent, try to close distance instead of attacking
        if (!movementSpent && !hasMoved) {
          return {
            action: "moveToward",
            target: attackTarget.name,
            desiredRange: meleeReach,
            endTurn: false,
            intentNarration: `${input.combatantName} moves toward ${attackTarget.name}.`,
          };
        }
        // Movement already spent and no target in reach — end turn
        return {
          action: "endTurn",
          endTurn: true,
          intentNarration: `${input.combatantName} cannot reach any target.`,
        };
      }

      const isLastAttack = attacksMade + 1 >= attacksPerAction;

      // Only attach bonus action and endTurn on the final attack
      const bonusAction = isLastAttack && !bonusActionSpent ? pickBonusAction(combatant, livingEnemies, ctx.allies) : undefined;

      return {
        action: "attack",
        target: attackTarget.name,
        attackName,
        bonusAction,
        endTurn: isLastAttack,
        intentNarration: `${input.combatantName} attacks ${attackTarget.name} with ${attackName}!`,
      };
    }

    // Step 8: If action is spent but we haven't moved, consider retreating at low HP
    if (actionSpent && !movementSpent) {
      if (hpPercent < 25 && livingEnemies.length > 1) {
        // Retreat when low HP and outnumbered
        const nearestEnemy = scoredTargets[0];
        if (nearestEnemy) {
          // If adjacent enemies and bonus-action disengage is available, use it to retreat safely
          if (!bonusActionSpent && hasAdjacentEnemy(combatant.position, livingEnemies)) {
            const bonusDisengage = hasBonusDisengage(combatant);
            if (bonusDisengage) {
              // Use endTurn + bonus disengage first; next iteration will moveAwayFrom safely
              const alreadyDisengaged = turnResults.some(r =>
                r.ok && (r.action === "disengage" || (r.data && typeof r.data === "object" && "bonusAction" in r.data)),
              );
              if (!alreadyDisengaged) {
                return {
                  action: "endTurn",
                  bonusAction: bonusDisengage,
                  endTurn: false,
                  intentNarration: `${input.combatantName} disengages to retreat safely!`,
                };
              }
            }
          }
          return {
            action: "moveAwayFrom",
            target: nearestEnemy.name,
            endTurn: true,
            intentNarration: `${input.combatantName} retreats, badly wounded!`,
          };
        }
      }
    }

    // Step 7: If we have no attacks, Dash toward nearest enemy
    if (!actionSpent && !attackName) {
      return {
        action: "dash",
        endTurn: true,
        intentNarration: `${input.combatantName} dashes forward!`,
      };
    }

    // Step 9: Use bonus action if we haven't used it yet
    // AI-M1: D&D 5e 2024 — if a leveled spell was cast as an action this turn,
    // the BA cannot be another spell (only cantrips allowed, and BA cantrips are rare).
    if (!bonusActionSpent) {
      const bonusAction = pickBonusAction(combatant, livingEnemies, ctx.allies);
      if (bonusAction) {
        // Check if a leveled spell was already cast this turn
        const castLeveledSpellThisTurn = turnResults.some(
          r => r.action === "castSpell" && r.ok &&
            r.decision?.spellLevel !== undefined && r.decision.spellLevel > 0,
        );
        // If action was a leveled spell and BA is a spell, skip the BA spell
        if (castLeveledSpellThisTurn && isBonusActionSpellCast(bonusAction)) {
          // Can't combine BA spell with leveled action spell — skip
        } else {
          return {
            action: "endTurn",
            bonusAction,
            endTurn: true,
            intentNarration: `${input.combatantName} uses ${bonusAction}.`,
          };
        }
      }
    }

    // Default: end turn
    return {
      action: "endTurn",
      intentNarration: `${input.combatantName} ends their turn.`,
    };
  }
}
