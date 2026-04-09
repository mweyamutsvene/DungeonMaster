/**
 * DeterministicAiDecisionMaker — Heuristic-based AI that plays reasonable turns
 * without requiring an LLM.
 *
 * Layer: Application (AI module)
 * Implements: IAiDecisionMaker
 *
 * Decision priority per step:
 * 1. Stand up from Prone (move to current position)
 * 1b. Triage — heal dying allies (0 HP with death saves) before attacking
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
 * Check if any living enemy is within melee reach (5ft) of the combatant.
 */
function hasAdjacentEnemy(
  combatantPos: { x: number; y: number } | undefined,
  enemies: AiCombatContext["enemies"],
): boolean {
  if (!combatantPos) return false;
  return enemies.some(
    e => e.hp.current > 0 && e.distanceFeet !== undefined && e.distanceFeet <= 5,
  );
}

/**
 * Check if the creature has a bonus-action Disengage ability (Cunning Action or Nimble Escape).
 * Returns the bonus action identifier string, or undefined.
 */
function hasBonusDisengage(combatant: AiCombatContext["combatant"]): string | undefined {
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
function findDyingAlly(allies: AiCombatContext["allies"]): AiCombatContext["allies"][number] | undefined {
  return allies
    .filter(a => a.hp.current === 0 && a.deathSaves &&
      a.deathSaves.failures < 3 && a.deathSaves.successes < 3)
    .sort((a, b) => (b.deathSaves?.failures ?? 0) - (a.deathSaves?.failures ?? 0))[0];
}

/**
 * Pick a healing action to save a dying ally (0 HP with active death saves).
 * Prefers bonus-action heals (Healing Word) to leave the main action free.
 */
function pickHealingForDyingAlly(
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
        // Prefer bonus-action spells (Healing Word) for efficiency
        if (a.isBonusAction && !b.isBonusAction) return -1;
        if (!a.isBonusAction && b.isBonusAction) return 1;
        return a.level - b.level; // Prefer lower level slots
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
function pickBonusAction(
  combatant: AiCombatContext["combatant"],
  enemies: AiCombatContext["enemies"],
  allies?: AiCombatContext["allies"],
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

  // 7. Bonus-action healing spells (Healing Word) — heal ally below 50% HP
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
          // Return a special token so the caller knows to cast a BA healing spell
          return `castSpell:${baHealingSpells[0]!.name}:${hurtAlly.name}`;
        }
      }
    }
  }

  // 8. Spiritual Weapon attack — if Spiritual Weapon is active (concentration)
  if (combatant.concentrationSpell?.toLowerCase() === "spiritual weapon") {
    return "spiritualWeaponAttack";
  }

  return undefined;
}

/**
 * Check if a bonus action token represents a spell cast (e.g., "castSpell:Healing Word:Ally").
 */
function isBonusActionSpellCast(token: string): boolean {
  return token.startsWith("castSpell:");
}

/**
 * Estimate the number of enemies that would be hit by an AoE spell.
 * Uses Chebyshev distance (D&D grid diagonal = 5ft) to approximate targeting.
 * For each enemy position as potential AoE center, counts enemies within radius.
 */
function estimateAoETargets(
  spell: AiSpellInfo,
  combatantPos: { x: number; y: number } | undefined,
  enemies: AiCombatContext["enemies"],
): number {
  const area = spell.area as { type?: string; size?: number } | undefined;
  if (!area || typeof area.size !== "number") return 1;

  const radiusFeet = area.size;
  const positionedEnemies = enemies.filter(e => e.position && e.hp.current > 0);
  if (positionedEnemies.length <= 1) return positionedEnemies.length || 1;

  // For each enemy position as potential AoE center, count enemies within radius
  let maxTargets = 1;
  for (const center of positionedEnemies) {
    let count = 0;
    for (const e of positionedEnemies) {
      // Grid positions: 1 cell = 5 feet. Use Chebyshev distance (D&D diagonal = 5ft).
      const dx = Math.abs(e.position!.x - center.position!.x) * 5;
      const dy = Math.abs(e.position!.y - center.position!.y) * 5;
      const dist = Math.max(dx, dy);
      if (dist <= radiusFeet) count++;
    }
    if (count > maxTargets) maxTargets = count;
  }

  return maxTargets;
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
  /** Spell is a buff (Bless, Shield of Faith, etc.) — target self or ally */
  isBuff?: boolean;
  /** Spell is a debuff (Hold Person, Cause Fear, etc.) — target enemy */
  isDebuff?: boolean;
}

// ── Well-known buff/debuff spell classification ──

const BUFF_SPELLS = new Set([
  "bless", "shield of faith", "mage armor", "heroism", "longstrider",
  "aid", "protection from evil and good", "sanctuary", "haste",
  "protection from energy", "freedom of movement", "stoneskin",
  "death ward", "beacon of hope",
]);

const DEBUFF_SPELLS = new Set([
  "hold person", "cause fear", "bane", "command", "entangle",
  "faerie fire", "hex", "hunter's mark", "hold monster",
  "blindness/deafness", "ray of enfeeblement", "bestow curse",
  "slow", "fear", "hypnotic pattern", "banishment",
]);

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
      isBuff: BUFF_SPELLS.has(name.toLowerCase()),
      isDebuff: DEBUFF_SPELLS.has(name.toLowerCase()),
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
 * 1b. Debuff spells on high-value threats
 * 1c. Buff spells on self/allies in early combat
 * 2. Damage cantrips (free, no slot cost) against enemies
 * 3. Damage spells if we have slots and no strong melee attacks
 * 4. Skip if creature has good physical attacks (prefer attacking)
 */
function pickSpell(
  combatant: AiCombatContext["combatant"],
  primaryTarget: ScoredTarget,
  allies: AiCombatContext["allies"],
  combatantName: string,
  round?: number,
  options?: { cantripsOnly?: boolean; enemies?: AiCombatContext["enemies"] },
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
    return pickFromCandidates(nonConcentration, combatant, primaryTarget, allies, resourcePools, combatantName, round, options);
  }

  return pickFromCandidates(spells, combatant, primaryTarget, allies, resourcePools, combatantName, round, options);
}

function pickFromCandidates(
  spells: AiSpellInfo[],
  combatant: AiCombatContext["combatant"],
  primaryTarget: ScoredTarget,
  allies: AiCombatContext["allies"],
  resourcePools: Array<{ name: string; current: number; max: number }>,
  combatantName: string,
  round?: number,
  options?: { cantripsOnly?: boolean; enemies?: AiCombatContext["enemies"] },
): AiDecision | undefined {
  const cantripsOnly = options?.cantripsOnly ?? false;
  const enemies = options?.enemies ?? [];

  // When cantripsOnly is set (D&D 5e 2024: BA spell restricts action to cantrips),
  // skip healing, debuffs, buffs, and leveled damage — jump straight to cantrips.
  if (!cantripsOnly) {
    // 1. Healing: check if any ally (including self) is below 50% HP
    // Skip BA healing spells here — reserve them for bonus action alongside an attack
    const hurtAllies = allies.filter(a => a.hp.percentage < 50 && a.hp.current > 0);
    if (hurtAllies.length > 0 || combatant.hp.percentage < 50) {
      const healingSpells = spells
        .filter(s => s.healing && !s.isBonusAction && hasAvailableSlot(resourcePools, s.level))
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

  // 1b. Debuff spells — prioritize disabling high-value threats
  const debuffSpells = spells
    .filter(s => s.isDebuff && hasAvailableSlot(resourcePools, s.level))
    .sort((a, b) => b.level - a.level); // Prefer stronger debuffs

  if (debuffSpells.length > 0) {
    // Find a high-value target: prefer concentration casters and low-WIS enemies
    const highValueTarget = primaryTarget; // Target scorer already prioritizes threats
    const spell = debuffSpells[0]!;
    const slotLevel = spell.level === 0 ? undefined : getLowestAvailableSlotLevel(resourcePools, spell.level);
    return {
      action: "castSpell",
      spellName: spell.name,
      spellLevel: slotLevel,
      target: highValueTarget.name,
      endTurn: true,
      intentNarration: `${combatantName} casts ${spell.name} on ${highValueTarget.name}!`,
    };
  }

  // 1c. Buff spells — cast on self or allies early in combat
  const isEarlyCombat = (round ?? 1) <= 2;
  if (isEarlyCombat) {
    const activeBuffs = (combatant.activeBuffs ?? []).map(b => b.toLowerCase());
    const buffSpells = spells
      .filter(s => s.isBuff && hasAvailableSlot(resourcePools, s.level))
      .filter(s => !activeBuffs.includes(s.name.toLowerCase())) // Don't re-cast active buffs
      .sort((a, b) => b.level - a.level); // Prefer stronger buffs

    if (buffSpells.length > 0) {
      const spell = buffSpells[0]!;
      const slotLevel = spell.level === 0 ? undefined : getLowestAvailableSlotLevel(resourcePools, spell.level);
      // Multi-target buffs (Bless) prefer allies; single-target (Shield of Faith, Mage Armor) prefer self
      const isMultiTarget = spell.name.toLowerCase() === "bless" || spell.name.toLowerCase() === "aid";
      const target = isMultiTarget && allies.length > 0
        ? allies[0]!.name
        : combatantName;
      return {
        action: "castSpell",
        spellName: spell.name,
        spellLevel: slotLevel,
        target,
        endTurn: !spell.isBonusAction,
        intentNarration: `${combatantName} casts ${spell.name}${target !== combatantName ? ` on ${target}` : ""}!`,
      };
    }
  }
  } // end if (!cantripsOnly)

  // 2. Damage cantrips — free to cast, always a good option
  // AI-M2: Weight AoE cantrips by estimated number of targets hit
  const cantrips = spells
    .filter(s => s.level === 0 && s.damage)
    .sort((a, b) => {
      const aTargets = a.area ? estimateAoETargets(a, combatant.position, enemies) : 1;
      const bTargets = b.area ? estimateAoETargets(b, combatant.position, enemies) : 1;
      return (estimateSpellDamage(b.damage) * bTargets) - (estimateSpellDamage(a.damage) * aTargets);
    });

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

  // cantripsOnly guard: leveled damage spells are not allowed when BA spell restricts action
  if (cantripsOnly) return undefined;

  // 3. Leveled damage spells — only if creature has weak/no physical attacks
  const attacks = (combatant.attacks ?? []) as Array<{ name?: string; damage?: string; toHit?: number }>;
  const hasStrongAttacks = attacks.length >= 2 || attacks.some(a =>
    typeof a.toHit === "number" && a.toHit >= 5,
  );

  // If creature has strong physical attacks, prefer those over spending slots
  if (hasStrongAttacks) return undefined;

  // AI-M2: Weight AoE damage spells by estimated number of targets hit
  const damageSpells = spells
    .filter(s => s.level > 0 && s.damage && hasAvailableSlot(resourcePools, s.level))
    .sort((a, b) => {
      const aTargets = a.area ? estimateAoETargets(a, combatant.position, enemies) : 1;
      const bTargets = b.area ? estimateAoETargets(b, combatant.position, enemies) : 1;
      return (estimateSpellDamage(b.damage) * bTargets) - (estimateSpellDamage(a.damage) * aTargets);
    });

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

/**
 * Evaluate class features that should be used as the primary action (useFeature).
 * Focused on action-cost healing abilities when HP is low.
 * Bonus-action abilities (Second Wind, Patient Defense, Flurry) are handled
 * separately by pickBonusAction.
 *
 * Priorities:
 * 1. Wholeness of Body (Monk) — if below 50% HP and has resource
 * 2. Lay on Hands (Paladin) — if below 50% HP and has resource
 */
function pickFeatureAction(
  combatant: AiCombatContext["combatant"],
  combatantName: string,
): AiDecision | undefined {
  const classAbilities = combatant.classAbilities ?? [];
  const resourcePools = combatant.resourcePools ?? [];
  const hpPercent = combatant.hp.percentage;

  // Only consider healing features when hurt
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
    const attacks = (combatant.attacks ?? []) as Array<{ name?: string; damage?: string; toHit?: number; kind?: string; type?: string; reach?: number }>;
    const attackName = pickBestAttack(attacks);

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

    // Step 4: Use healing potion if low HP, available, and action not spent
    if (!actionSpent && ctx.hasPotions && combatant.hp.percentage < 40) {
      return {
        action: "useObject",
        endTurn: true,
        intentNarration: `${input.combatantName} drinks a healing potion!`,
      };
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
