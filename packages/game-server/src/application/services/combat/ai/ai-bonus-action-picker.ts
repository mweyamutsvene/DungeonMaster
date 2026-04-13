/**
 * AI Bonus Action Picker — selects bonus actions and feature-based actions for the AI.
 *
 * Provides:
 * - Bonus action selection (Second Wind, Rage, Patient Defense, Flurry, etc.)
 * - Class feature action selection (Wholeness of Body, Lay on Hands)
 * - Dying ally detection + healing triage
 * - Bonus disengage detection (Cunning Action, Nimble Escape)
 *
 * Layer: Application (AI module)
 */

import type { AiDecision, AiCombatContext } from "./ai-types.js";
import {
  parseSpells,
  hasAvailableSlot,
  getLowestAvailableSlotLevel,
  isBonusActionSpellCast,
} from "./ai-spell-evaluator.js";

/**
 * Check if the creature has a bonus-action Disengage ability (Cunning Action or Nimble Escape).
 * Returns the bonus action identifier string, or undefined.
 */
export function hasBonusDisengage(combatant: AiCombatContext["combatant"]): string | undefined {
  const classAbilities = combatant.classAbilities ?? [];
  // Rogue: Cunning Action
  if (classAbilities.some(a => a.name.toLowerCase().includes("cunning action"))) {
    return "cunningAction:disengage";
  }
  // Monster: Nimble Escape (may appear in bonusActions or traits)
  const checkName = (item: unknown): boolean => {
    if (!item || typeof item !== "object") return false;
    const name = (item as Record<string, unknown>).name;
    return typeof name === "string" && name.toLowerCase().includes("nimble escape");
  };
  if ((combatant.bonusActions ?? []).some(checkName) || (combatant.traits ?? []).some(checkName)) {
    return "nimble_escape_disengage";
  }
  return undefined;
}

/**
 * Find the most critical dying ally (0 HP, death saves in progress).
 * Prioritizes allies with more death save failures.
 */
export function findDyingAlly(allies: AiCombatContext["allies"]): AiCombatContext["allies"][number] | undefined {
  return allies
    .filter(a => a.hp.current === 0 && a.deathSaves &&
      a.deathSaves.failures < 3 && a.deathSaves.successes < 3)
    .sort((a, b) => (b.deathSaves?.failures ?? 0) - (a.deathSaves?.failures ?? 0))[0];
}

/**
 * Pick a healing action to save a dying ally (0 HP with active death saves).
 * Prefers bonus-action heals (Healing Word) to leave the main action free.
 */
export function pickHealingForDyingAlly(
  combatant: AiCombatContext["combatant"],
  dyingAlly: AiCombatContext["allies"][number],
  combatantName: string,
): AiDecision | undefined {
  const resourcePools = combatant.resourcePools ?? [];
  const classAbilities = combatant.classAbilities ?? [];

  // Check for healing spells
  const rawSpells = combatant.spells as unknown[] | undefined;
  if (rawSpells && rawSpells.length > 0) {
    const spells = parseSpells(rawSpells);
    const healingSpells = spells
      .filter(s => s.healing && hasAvailableSlot(resourcePools, s.level))
      .sort((a, b) => {
        if (a.isBonusAction && !b.isBonusAction) return -1;
        if (!a.isBonusAction && b.isBonusAction) return 1;
        return a.level - b.level;
      });

    if (healingSpells.length > 0) {
      const spell = healingSpells[0]!;
      const slotLevel = spell.level === 0 ? undefined : getLowestAvailableSlotLevel(resourcePools, spell.level);
      return {
        action: "castSpell",
        spellName: spell.name,
        spellLevel: slotLevel,
        target: dyingAlly.name,
        endTurn: !spell.isBonusAction,
        intentNarration: `${combatantName} casts ${spell.name} on ${dyingAlly.name} to save them!`,
      };
    }
  }

  // Check for Lay on Hands
  const hasLayOnHands = classAbilities.some(a => a.name.toLowerCase().includes("lay on hands"));
  if (hasLayOnHands) {
    const pool = resourcePools.find(p => {
      const name = p.name.toLowerCase();
      return name === "layonhands" || name.includes("lay on hands") || name === "lay_on_hands";
    });
    if (pool && pool.current > 0) {
      return {
        action: "useFeature",
        featureId: "layOnHands",
        target: dyingAlly.name,
        endTurn: false,
        intentNarration: `${combatantName} uses Lay on Hands on ${dyingAlly.name} to stabilize them!`,
      };
    }
  }

  return undefined;
}

/**
 * Check if a bonus action is available and beneficial.
 * Returns the bonus action name to use, or undefined.
 */
export function pickBonusAction(
  combatant: AiCombatContext["combatant"],
  enemies: AiCombatContext["enemies"],
  allies?: AiCombatContext["allies"],
): string | undefined {
  const economy = combatant.economy;
  if (economy?.bonusActionSpent) return undefined;

  const classAbilities = combatant.classAbilities ?? [];
  const resourcePools = combatant.resourcePools ?? [];
  const hpPercent = combatant.hp.percentage;

  // 1. Second Wind (Fighter)
  const hasSecondWind = classAbilities.some(a => a.name.toLowerCase().includes("second wind"));
  if (hasSecondWind && hpPercent < 50) {
    const secondWindPool = resourcePools.find(p => p.name.toLowerCase().includes("second wind") || p.name.toLowerCase() === "secondwind");
    if (secondWindPool && secondWindPool.current > 0) {
      return "secondWind";
    }
  }

  // 2. Rage (Barbarian)
  const hasRage = classAbilities.some(a => a.name.toLowerCase().includes("rage"));
  const isRaging = (combatant.activeBuffs ?? []).some(b => b.toLowerCase() === "raging");
  if (hasRage && !isRaging) {
    const ragePool = resourcePools.find(p => p.name.toLowerCase() === "rage");
    if (ragePool && ragePool.current > 0) {
      return "rage";
    }
  }

  // Helper: find ki / focus points pool
  const findKiPool = () => resourcePools.find(p => {
    const name = p.name.toLowerCase();
    return name === "ki" || name === "focuspoints" || name === "focus points";
  });

  // 3. Patient Defense (Monk)
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

  // 4. Flurry of Blows (Monk)
  const hasFlurry = classAbilities.some(a => a.name.toLowerCase().includes("flurry"));
  if (hasFlurry) {
    const kiPool = findKiPool();
    if (kiPool && kiPool.current > 0) {
      return "flurryOfBlows";
    }
  }

  // 5. Step of the Wind (Monk)
  const hasStepOfTheWind = classAbilities.some(a => a.name.toLowerCase().includes("step of the wind"));
  if (hasStepOfTheWind) {
    const kiPool = findKiPool();
    if (kiPool && kiPool.current > 0 && hpPercent < 30) {
      return "stepOfTheWind";
    }
  }

  // 6. Cunning Action (Rogue)
  const hasCunning = classAbilities.some(a => a.name.toLowerCase().includes("cunning action"));
  if (hasCunning && hpPercent < 30) {
    return "cunningAction:disengage";
  }

  // 7. Bonus-action healing spells (Healing Word)
  if (allies && allies.length > 0) {
    const rawSpells = combatant.spells as unknown[] | undefined;
    if (rawSpells && rawSpells.length > 0) {
      const spells = parseSpells(rawSpells);
      const baHealingSpells = spells.filter(
        s => s.isBonusAction && s.healing && hasAvailableSlot(resourcePools, s.level),
      );
      if (baHealingSpells.length > 0) {
        const hurtAlly = allies.find(a => a.hp.current > 0 && a.hp.percentage < 50);
        if (hurtAlly) {
          return `castSpell:${baHealingSpells[0]!.name}:${hurtAlly.name}`;
        }
      }
    }
  }

  // 8. Spiritual Weapon attack
  if (combatant.concentrationSpell?.toLowerCase() === "spiritual weapon") {
    return "spiritualWeaponAttack";
  }

  return undefined;
}

/**
 * Evaluate class features that should be used as the primary action (useFeature).
 * Focused on action-cost healing abilities when HP is low.
 */
export function pickFeatureAction(
  combatant: AiCombatContext["combatant"],
  combatantName: string,
): AiDecision | undefined {
  const classAbilities = combatant.classAbilities ?? [];
  const resourcePools = combatant.resourcePools ?? [];
  const hpPercent = combatant.hp.percentage;

  if (hpPercent >= 50) return undefined;

  // Wholeness of Body (Monk)
  const hasWholenessOfBody = classAbilities.some(a => a.name.toLowerCase().includes("wholeness of body"));
  if (hasWholenessOfBody) {
    const pool = resourcePools.find(p => {
      const name = p.name.toLowerCase();
      return name === "wholeness_of_body" || name.includes("wholeness");
    });
    if (pool && pool.current > 0) {
      return {
        action: "useFeature",
        featureId: "wholenessOfBody",
        endTurn: false,
        intentNarration: `${combatantName} uses Wholeness of Body to heal!`,
      };
    }
  }

  // Lay on Hands (Paladin)
  const hasLayOnHands = classAbilities.some(a => a.name.toLowerCase().includes("lay on hands"));
  if (hasLayOnHands) {
    const pool = resourcePools.find(p => {
      const name = p.name.toLowerCase();
      return name === "layonhands" || name.includes("lay on hands") || name === "lay_on_hands";
    });
    if (pool && pool.current > 0) {
      return {
        action: "useFeature",
        featureId: "layOnHands",
        endTurn: false,
        intentNarration: `${combatantName} uses Lay on Hands!`,
      };
    }
  }

  return undefined;
}

// Re-export for deterministic-ai.ts orchestrator
export { isBonusActionSpellCast };
