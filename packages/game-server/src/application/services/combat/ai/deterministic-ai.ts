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
import type { ScoredTarget } from "./ai-target-scorer.js";

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
  enemies: AiCombatContext["enemies"],
): string | undefined {
  const economy = combatant.economy;
  if (economy?.bonusActionSpent) return undefined;

  const classAbilities = combatant.classAbilities ?? [];
  const resourcePools = combatant.resourcePools ?? [];
  const hpPercent = combatant.hp.percentage;

  // 1. Second Wind (Fighter) — use when below 50% HP
  const hasSecondWind = classAbilities.some(a => a.name.toLowerCase().includes("second wind"));
  if (hasSecondWind && hpPercent < 50) {
    const secondWindPool = resourcePools.find(p => p.name.toLowerCase().includes("second wind") || p.name.toLowerCase() === "secondwind");
    if (secondWindPool && secondWindPool.current > 0) {
      return "secondWind";
    }
  }

  // 2. Rage (Barbarian) — rage at start of combat if not already raging
  const hasRage = classAbilities.some(a => a.name.toLowerCase().includes("rage"));
  const isRaging = (combatant.activeBuffs ?? []).some(b => b.toLowerCase() === "raging");
  if (hasRage && !isRaging) {
    const ragePool = resourcePools.find(p => p.name.toLowerCase() === "rage");
    if (ragePool && ragePool.current > 0) {
      return "rage";
    }
  }

  // Helper: find ki / focus points pool (Monk resource)
  const findKiPool = () => resourcePools.find(p => {
    const name = p.name.toLowerCase();
    return name === "ki" || name === "focuspoints" || name === "focus points";
  });

  // 3. Patient Defense (Monk) — defensive when low HP or surrounded
  const hasPatientDefense = classAbilities.some(a => a.name.toLowerCase().includes("patient defense"));
  if (hasPatientDefense) {
    const kiPool = findKiPool();
    if (kiPool && kiPool.current > 0) {
      const livingEnemies = enemies.filter(e => !e.hp || e.hp.current > 0);
      if (hpPercent < 20 || (hpPercent < 40 && livingEnemies.length >= 2)) {
        return "patientDefense";
      }
    }
  }

  // 4. Flurry of Blows (Monk) — use when ki available and in melee
  const hasFlurry = classAbilities.some(a => a.name.toLowerCase().includes("flurry"));
  if (hasFlurry) {
    const kiPool = findKiPool();
    if (kiPool && kiPool.current > 0) {
      return "flurryOfBlows";
    }
  }

  // 5. Step of the Wind (Monk) — tactical retreat when low HP
  const hasStepOfTheWind = classAbilities.some(a => a.name.toLowerCase().includes("step of the wind"));
  if (hasStepOfTheWind) {
    const kiPool = findKiPool();
    if (kiPool && kiPool.current > 0 && hpPercent < 30) {
      return "stepOfTheWind";
    }
  }

  // 6. Cunning Action (Rogue) — disengage if surrounded / low HP
  const hasCunning = classAbilities.some(a => a.name.toLowerCase().includes("cunning action"));
  if (hasCunning && hpPercent < 30) {
    return "cunningAction:disengage";
  }

  return undefined;
}

// ── Spell type for AI evaluation (parsed from unknown[] spells) ──

interface AiSpellInfo {
  name: string;
  level: number;
  damage?: { diceCount: number; diceSides: number; modifier?: number };
  damageType?: string;
  healing?: { diceCount: number; diceSides: number; modifier?: number };
  saveAbility?: string;
  attackType?: string;
  concentration?: boolean;
  isBonusAction?: boolean;
  area?: unknown;
}

/**
 * Parse the untyped spells array into typed spell info for evaluation.
 */
function parseSpells(rawSpells: unknown[]): AiSpellInfo[] {
  const parsed: AiSpellInfo[] = [];
  for (const raw of rawSpells) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const s = raw as Record<string, unknown>;
    const name = typeof s.name === "string" ? s.name : undefined;
    const level = typeof s.level === "number" ? s.level : undefined;
    if (!name || level === undefined) continue;
    parsed.push({
      name,
      level,
      damage: s.damage && typeof s.damage === "object" ? s.damage as AiSpellInfo["damage"] : undefined,
      damageType: typeof s.damageType === "string" ? s.damageType : undefined,
      healing: s.healing && typeof s.healing === "object" ? s.healing as AiSpellInfo["healing"] : undefined,
      saveAbility: typeof s.saveAbility === "string" ? s.saveAbility : undefined,
      attackType: typeof s.attackType === "string" ? s.attackType : undefined,
      concentration: typeof s.concentration === "boolean" ? s.concentration : undefined,
      isBonusAction: typeof s.isBonusAction === "boolean" ? s.isBonusAction : undefined,
      area: s.area,
    });
  }
  return parsed;
}

/**
 * Check if the creature has an available spell slot at or above the given spell level.
 * Spell slot pools are named `spellSlot_N`.
 */
function hasAvailableSlot(
  resourcePools: Array<{ name: string; current: number; max: number }>,
  minLevel: number,
): boolean {
  // Cantrips (level 0) don't need a slot
  if (minLevel === 0) return true;
  return resourcePools.some(p => {
    const match = /^spellSlot_(\d+)$/i.exec(p.name);
    if (!match) return false;
    const slotLevel = parseInt(match[1]!, 10);
    return slotLevel >= minLevel && p.current > 0;
  });
}

/**
 * Get the lowest available slot level at or above the spell's level.
 */
function getLowestAvailableSlotLevel(
  resourcePools: Array<{ name: string; current: number; max: number }>,
  minLevel: number,
): number {
  if (minLevel === 0) return 0;
  let best = Infinity;
  for (const p of resourcePools) {
    const match = /^spellSlot_(\d+)$/i.exec(p.name);
    if (!match) continue;
    const slotLevel = parseInt(match[1]!, 10);
    if (slotLevel >= minLevel && p.current > 0 && slotLevel < best) {
      best = slotLevel;
    }
  }
  return best === Infinity ? minLevel : best;
}

/**
 * Estimate average damage from a spell's damage dice.
 */
function estimateSpellDamage(dmg: AiSpellInfo["damage"]): number {
  if (!dmg) return 0;
  const count = typeof dmg.diceCount === "number" ? dmg.diceCount : 0;
  const sides = typeof dmg.diceSides === "number" ? dmg.diceSides : 0;
  const mod = typeof dmg.modifier === "number" ? dmg.modifier : 0;
  return count * ((sides + 1) / 2) + mod;
}

/**
 * Pick the best spell to cast given the combat situation.
 * Returns a castSpell decision or undefined to fall through to attack logic.
 *
 * Priorities:
 * 1. Healing spells if allies are below 50% HP
 * 2. Damage cantrips (free, no slot cost) against enemies
 * 3. Damage spells if we have slots and no strong melee attacks
 * 4. Skip if creature has good physical attacks (prefer attacking)
 */
function pickSpell(
  combatant: AiCombatContext["combatant"],
  primaryTarget: ScoredTarget,
  allies: AiCombatContext["allies"],
  combatantName: string,
): AiDecision | undefined {
  const rawSpells = combatant.spells as unknown[] | undefined;
  if (!rawSpells || rawSpells.length === 0) return undefined;

  const resourcePools = combatant.resourcePools ?? [];
  const spells = parseSpells(rawSpells);
  if (spells.length === 0) return undefined;

  // Don't cast if already concentrating — keep it simple, don't replace
  if (combatant.concentrationSpell) {
    // Filter out concentration spells, can still cast non-concentration
    const nonConcentration = spells.filter(s => !s.concentration);
    if (nonConcentration.length === 0) return undefined;
    return pickFromCandidates(nonConcentration, combatant, primaryTarget, allies, resourcePools, combatantName);
  }

  return pickFromCandidates(spells, combatant, primaryTarget, allies, resourcePools, combatantName);
}

function pickFromCandidates(
  spells: AiSpellInfo[],
  combatant: AiCombatContext["combatant"],
  primaryTarget: ScoredTarget,
  allies: AiCombatContext["allies"],
  resourcePools: Array<{ name: string; current: number; max: number }>,
  combatantName: string,
): AiDecision | undefined {
  // 1. Healing: check if any ally (including self) is below 50% HP
  const hurtAllies = allies.filter(a => a.hp.percentage < 50 && a.hp.current > 0);
  if (hurtAllies.length > 0 || combatant.hp.percentage < 50) {
    const healingSpells = spells
      .filter(s => s.healing && hasAvailableSlot(resourcePools, s.level))
      .sort((a, b) => estimateSpellDamage(b.healing) - estimateSpellDamage(a.healing));

    if (healingSpells.length > 0) {
      const spell = healingSpells[0]!;
      // Heal self if we're hurt, otherwise heal the most hurt ally
      const healTarget = combatant.hp.percentage < 50
        ? combatantName
        : (hurtAllies.sort((a, b) => a.hp.percentage - b.hp.percentage)[0]?.name ?? combatantName);
      const slotLevel = spell.level === 0 ? undefined : getLowestAvailableSlotLevel(resourcePools, spell.level);
      return {
        action: "castSpell",
        spellName: spell.name,
        spellLevel: slotLevel,
        target: healTarget,
        endTurn: !spell.isBonusAction,
        intentNarration: `${combatantName} casts ${spell.name} on ${healTarget}.`,
      };
    }
  }

  // 2. Damage cantrips — free to cast, always a good option
  const cantrips = spells
    .filter(s => s.level === 0 && s.damage)
    .sort((a, b) => estimateSpellDamage(b.damage) - estimateSpellDamage(a.damage));

  if (cantrips.length > 0) {
    const cantrip = cantrips[0]!;
    return {
      action: "castSpell",
      spellName: cantrip.name,
      spellLevel: 0,
      target: primaryTarget.name,
      endTurn: true,
      intentNarration: `${combatantName} casts ${cantrip.name} at ${primaryTarget.name}!`,
    };
  }

  // 3. Leveled damage spells — only if creature has weak/no physical attacks
  const attacks = (combatant.attacks ?? []) as Array<{ name?: string; damage?: string; toHit?: number }>;
  const hasStrongAttacks = attacks.length >= 2 || attacks.some(a =>
    typeof a.toHit === "number" && a.toHit >= 5,
  );

  // If creature has strong physical attacks, prefer those over spending slots
  if (hasStrongAttacks) return undefined;

  const damageSpells = spells
    .filter(s => s.level > 0 && s.damage && hasAvailableSlot(resourcePools, s.level))
    .sort((a, b) => estimateSpellDamage(b.damage) - estimateSpellDamage(a.damage));

  if (damageSpells.length > 0) {
    const spell = damageSpells[0]!;
    const slotLevel = getLowestAvailableSlotLevel(resourcePools, spell.level);
    return {
      action: "castSpell",
      spellName: spell.name,
      spellLevel: slotLevel,
      target: primaryTarget.name,
      endTurn: true,
      intentNarration: `${combatantName} casts ${spell.name} at ${primaryTarget.name}!`,
    };
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

    // Step 4b: Spell casting — evaluate before physical attacks
    if (!actionSpent) {
      const spellDecision = pickSpell(combatant, primaryTarget, ctx.allies, input.combatantName);
      if (spellDecision) {
        // Attach bonus action if available and spell doesn't end turn
        if (!bonusActionSpent && !spellDecision.endTurn) {
          const bonusAction = pickBonusAction(combatant, livingEnemies);
          if (bonusAction) {
            spellDecision.bonusAction = bonusAction;
          }
        }
        return spellDecision;
      }
    }

    // Step 5: Attack with best available attack (supports Extra Attack / Multiattack)
    const attacksMade = turnResults.filter(r => r.action === "attack").length;
    const attacksPerAction = combatant.attacksPerAction ?? 1;
    const hasAttacksRemaining = attacksMade < attacksPerAction;

    if (!actionSpent && attackName && hasAttacksRemaining) {
      // Pick the closest target in reach if primary is too far
      let attackTarget = primaryTarget;
      if (primaryTarget.distanceFeet !== Infinity && primaryTarget.distanceFeet > meleeReach && !ranged) {
        // Find closest target in melee reach
        const inReach = scoredTargets.find(t => t.distanceFeet <= meleeReach);
        if (inReach) {
          attackTarget = inReach;
        }
      }

      const isLastAttack = attacksMade + 1 >= attacksPerAction;

      // Only attach bonus action and endTurn on the final attack
      const bonusAction = isLastAttack && !bonusActionSpent ? pickBonusAction(combatant, livingEnemies) : undefined;

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
