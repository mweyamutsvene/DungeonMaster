/**
 * DeterministicAiDecisionMaker — Heuristic-based AI that plays reasonable turns
 * without requiring an LLM.
 *
 * Layer: Application (AI module)
 * Implements: IAiDecisionMaker
 *
 * Decision priority per step:
 * 1. Stand up from Prone (move to current position)
 * 2. Evaluate and select a target via scoreTargets()
 * 3. Move to reach target (melee) or maintain range (ranged)
 * 4. Attack with best available attack (repeat for Extra Attacks)
 * 5. Use available bonus actions (Flurry of Blows, Second Wind at low HP, etc.)
 * 6. End turn
 *
 * Handles Monsters, NPCs, and AI-controlled Characters.
 */

import type { IAiDecisionMaker, AiDecision, AiCombatContext } from "./ai-types.js";
import { scoreTargets } from "./ai-target-scorer.js";

/**
 * Determine if a creature is primarily ranged based on its available attacks.
 * Checks for "ranged" keyword in attack descriptions, or common ranged attack names.
 */
function isRangedCreature(combatant: AiCombatContext["combatant"]): boolean {
  const attacks = (combatant.attacks ?? []) as Array<{ name?: string; type?: string; kind?: string; reach?: number; range?: number | string }>;
  if (attacks.length === 0) return false;

  // If ALL attacks are ranged, it's a ranged creature
  const rangedCount = attacks.filter(a => {
    const kind = (a.kind ?? a.type ?? "").toLowerCase();
    const name = (a.name ?? "").toLowerCase();
    return kind.includes("ranged") ||
      name.includes("longbow") || name.includes("shortbow") ||
      name.includes("crossbow") || name.includes("javelin") ||
      name.includes("sling") || name.includes("dart") ||
      name.includes("ray") || name.includes("bolt") ||
      name.includes("blast");
  }).length;

  // If more than half attacks are ranged, treat as ranged
  return rangedCount > attacks.length / 2;
}

/**
 * Find the best attack from available attacks array.
 * Prefers higher damage output. Falls back to first available.
 */
function pickBestAttack(
  attacks: Array<{ name?: string; damage?: string; toHit?: number }>,
): string | undefined {
  if (attacks.length === 0) return undefined;

  // Simple heuristic: pick attack with highest toHit, or just the first one
  let best = attacks[0];
  for (const atk of attacks) {
    if (atk.toHit !== undefined && best?.toHit !== undefined && atk.toHit > best.toHit) {
      best = atk;
    }
  }
  return best?.name;
}

/**
 * Check if a bonus action is available and beneficial.
 * Returns the bonus action name to use, or undefined.
 */
function pickBonusAction(
  combatant: AiCombatContext["combatant"],
  _enemies: AiCombatContext["enemies"],
): string | undefined {
  const economy = combatant.economy;
  if (economy?.bonusActionSpent) return undefined;

  const classAbilities = combatant.classAbilities ?? [];
  const resourcePools = combatant.resourcePools ?? [];

  // Second Wind (Fighter) — use when below 50% HP
  const hpPercent = combatant.hp.percentage;
  const hasSecondWind = classAbilities.some(a => a.name.toLowerCase().includes("second wind"));
  if (hasSecondWind && hpPercent < 50) {
    const secondWindPool = resourcePools.find(p => p.name.toLowerCase().includes("second wind") || p.name.toLowerCase() === "secondwind");
    if (secondWindPool && secondWindPool.current > 0) {
      return "secondWind";
    }
  }

  // Flurry of Blows (Monk) — use when ki available and in melee
  const hasFlurry = classAbilities.some(a => a.name.toLowerCase().includes("flurry"));
  if (hasFlurry) {
    const kiPool = resourcePools.find(p => p.name.toLowerCase() === "ki");
    if (kiPool && kiPool.current > 0) {
      return "flurryOfBlows";
    }
  }

  // Cunning Action (Rogue) — disengage if surrounded / low HP
  const hasCunning = classAbilities.some(a => a.name.toLowerCase().includes("cunning action"));
  if (hasCunning && hpPercent < 30) {
    return "cunningAction:disengage";
  }

  // Rage (Barbarian) — rage at start of combat if not already raging
  const hasRage = classAbilities.some(a => a.name.toLowerCase().includes("rage"));
  const isRaging = (combatant.activeBuffs ?? []).some(b => b.toLowerCase() === "raging");
  if (hasRage && !isRaging) {
    const ragePool = resourcePools.find(p => p.name.toLowerCase() === "rage");
    if (ragePool && ragePool.current > 0) {
      return "rage";
    }
  }

  return undefined;
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
    const attacks = (combatant.attacks ?? []) as Array<{ name?: string; damage?: string; toHit?: number; kind?: string; type?: string; reach?: number }>;
    const attackName = pickBestAttack(attacks);

    // Check what we've already done this turn
    const hasAttacked = turnResults.some(r => r.action === "attack" && r.ok);
    const hasMoved = turnResults.some(r => (r.action === "move" || r.action === "moveToward" || r.action === "moveAwayFrom") && r.ok);
    const actionSpent = economy?.actionSpent ?? false;
    const movementSpent = economy?.movementSpent ?? false;
    const bonusActionSpent = economy?.bonusActionSpent ?? false;

    // Determine effective melee reach (default 5ft)
    const meleeReach = 5;
    // Desired range for ranged creatures
    const preferredRange = ranged ? 30 : meleeReach;

    // Step 3: Movement — get to a useful position
    if (!movementSpent && !hasMoved) {
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
          return {
            action: "moveToward",
            target: primaryTarget.name,
            desiredRange: preferredRange,
            endTurn: false,
            intentNarration: `${input.combatantName} moves toward ${primaryTarget.name}.`,
          };
        }
      } else {
        // Melee: close distance if out of reach
        if (distToTarget !== Infinity && distToTarget > meleeReach) {
          return {
            action: "moveToward",
            target: primaryTarget.name,
            desiredRange: meleeReach,
            endTurn: false,
            intentNarration: `${input.combatantName} moves toward ${primaryTarget.name}.`,
          };
        }
      }
    }

    // Step 4: Use healing potion if low HP, available, and action not spent
    if (!actionSpent && ctx.hasPotions && combatant.hp.percentage < 40) {
      return {
        action: "useObject",
        endTurn: true,
        intentNarration: `${input.combatantName} drinks a healing potion!`,
      };
    }

    // Step 5: Attack with best available attack
    if (!actionSpent && attackName) {
      // Pick the closest target in reach if primary is too far
      let attackTarget = primaryTarget;
      if (primaryTarget.distanceFeet !== Infinity && primaryTarget.distanceFeet > meleeReach && !ranged) {
        // Find closest target in melee reach
        const inReach = scoredTargets.find(t => t.distanceFeet <= meleeReach);
        if (inReach) {
          attackTarget = inReach;
        }
      }

      // Determine bonus action
      const bonusAction = !bonusActionSpent ? pickBonusAction(combatant, livingEnemies) : undefined;

      return {
        action: "attack",
        target: attackTarget.name,
        attackName,
        bonusAction,
        endTurn: true,
        intentNarration: `${input.combatantName} attacks ${attackTarget.name} with ${attackName}!`,
      };
    }

    // Step 8: If action is spent but we haven't moved, consider retreating at low HP
    if (actionSpent && !movementSpent) {
      const hpPercent = combatant.hp.percentage;
      if (hpPercent < 25 && livingEnemies.length > 1) {
        // Retreat when low HP and outnumbered
        const nearestEnemy = scoredTargets[0];
        if (nearestEnemy) {
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
    if (!bonusActionSpent) {
      const bonusAction = pickBonusAction(combatant, livingEnemies);
      if (bonusAction) {
        return {
          action: "endTurn",
          bonusAction,
          endTurn: true,
          intentNarration: `${input.combatantName} uses ${bonusAction}.`,
        };
      }
    }

    // Default: end turn
    return {
      action: "endTurn",
      intentNarration: `${input.combatantName} ends their turn.`,
    };
  }
}
