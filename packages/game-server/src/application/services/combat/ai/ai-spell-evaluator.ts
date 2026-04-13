/**
 * AI Spell Evaluator — spell selection and evaluation for the deterministic AI.
 *
 * Provides:
 * - Spell parsing from untyped arrays
 * - Slot availability / level resolution
 * - Damage estimation
 * - AoE target counting
 * - Best-spell-to-cast decision (healing, debuff, buff, cantrip, leveled damage)
 *
 * Layer: Application (AI module)
 */

import type { AiDecision, AiCombatContext } from "./ai-types.js";
import type { ScoredTarget } from "./ai-target-scorer.js";

// ── Spell type for AI evaluation (parsed from unknown[] spells) ──

export interface AiSpellInfo {
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
export function parseSpells(rawSpells: unknown[]): AiSpellInfo[] {
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
export function hasAvailableSlot(
  resourcePools: Array<{ name: string; current: number; max: number }>,
  minLevel: number,
): boolean {
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
export function getLowestAvailableSlotLevel(
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
export function estimateSpellDamage(dmg: AiSpellInfo["damage"]): number {
  if (!dmg) return 0;
  const count = typeof dmg.diceCount === "number" ? dmg.diceCount : 0;
  const sides = typeof dmg.diceSides === "number" ? dmg.diceSides : 0;
  const mod = typeof dmg.modifier === "number" ? dmg.modifier : 0;
  return count * ((sides + 1) / 2) + mod;
}

/**
 * AI2-M5: Adjust expected damage based on target's damage resistances, immunities, and vulnerabilities.
 * Returns a multiplier: 0 for immune, 0.5 for resistant, 2 for vulnerable, 1 otherwise.
 */
export function getDamageTypeMultiplier(
  damageType: string | undefined,
  target: { damageImmunities?: string[]; damageResistances?: string[]; damageVulnerabilities?: string[] },
): number {
  if (!damageType) return 1;
  const normalized = damageType.trim().toLowerCase();
  const immunities = (target.damageImmunities ?? []).map(s => s.trim().toLowerCase());
  if (immunities.includes(normalized)) return 0;
  const resistances = (target.damageResistances ?? []).map(s => s.trim().toLowerCase());
  const vulnerabilities = (target.damageVulnerabilities ?? []).map(s => s.trim().toLowerCase());
  const hasResist = resistances.includes(normalized);
  const hasVuln = vulnerabilities.includes(normalized);
  if (hasResist && hasVuln) return 1; // cancel out
  if (hasResist) return 0.5;
  if (hasVuln) return 2;
  return 1;
}

/**
 * Estimate the number of enemies that would be hit by an AoE spell.
 */
export function estimateAoETargets(
  spell: AiSpellInfo,
  combatantPos: { x: number; y: number } | undefined,
  enemies: AiCombatContext["enemies"],
): number {
  const area = spell.area as { type?: string; size?: number } | undefined;
  if (!area || typeof area.size !== "number") return 1;

  const radiusFeet = area.size;
  const positionedEnemies = enemies.filter(e => e.position && e.hp.current > 0);
  if (positionedEnemies.length <= 1) return positionedEnemies.length || 1;

  let maxTargets = 1;
  for (const center of positionedEnemies) {
    let count = 0;
    for (const e of positionedEnemies) {
      const dx = Math.abs(e.position!.x - center.position!.x) * 5;
      const dy = Math.abs(e.position!.y - center.position!.y) * 5;
      const dist = Math.max(dx, dy);
      if (dist <= radiusFeet) count++;
    }
    if (count > maxTargets) maxTargets = count;
  }

  return maxTargets;
}

/**
 * Check if a bonus action token represents a spell cast (e.g., "castSpell:Healing Word:Ally").
 */
export function isBonusActionSpellCast(token: string): boolean {
  return token.startsWith("castSpell:");
}

/**
 * Pick the best spell to cast given the combat situation.
 * Returns a castSpell decision or undefined to fall through to attack logic.
 */
export function pickSpell(
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

  if (combatant.concentrationSpell) {
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

  if (!cantripsOnly) {
    // 1. Healing: check if any ally (including self) is below 50% HP
    const hurtAllies = allies.filter(a => a.hp.percentage < 50 && a.hp.current > 0);
    if (hurtAllies.length > 0 || combatant.hp.percentage < 50) {
      const healingSpells = spells
        .filter(s => s.healing && !s.isBonusAction && hasAvailableSlot(resourcePools, s.level))
        .sort((a, b) => estimateSpellDamage(b.healing) - estimateSpellDamage(a.healing));

      if (healingSpells.length > 0) {
        const spell = healingSpells[0]!;
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
    .sort((a, b) => b.level - a.level);

  if (debuffSpells.length > 0) {
    const highValueTarget = primaryTarget;
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
      .filter(s => !activeBuffs.includes(s.name.toLowerCase()))
      .sort((a, b) => b.level - a.level);

    if (buffSpells.length > 0) {
      const spell = buffSpells[0]!;
      const slotLevel = spell.level === 0 ? undefined : getLowestAvailableSlotLevel(resourcePools, spell.level);
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
  // AI2-M5: Factor in target damage resistances/immunities when ranking
  const cantrips = spells
    .filter(s => s.level === 0 && s.damage)
    .filter(s => getDamageTypeMultiplier(s.damageType, primaryTarget.enemy) > 0) // Skip immune targets
    .sort((a, b) => {
      const aTargets = a.area ? estimateAoETargets(a, combatant.position, enemies) : 1;
      const bTargets = b.area ? estimateAoETargets(b, combatant.position, enemies) : 1;
      const aMult = getDamageTypeMultiplier(a.damageType, primaryTarget.enemy);
      const bMult = getDamageTypeMultiplier(b.damageType, primaryTarget.enemy);
      return (estimateSpellDamage(b.damage) * bTargets * bMult) - (estimateSpellDamage(a.damage) * aTargets * aMult);
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

  if (cantripsOnly) return undefined;

  // 3. Leveled damage spells
  const attacks = (combatant.attacks ?? []) as Array<{ name?: string; damage?: string; toHit?: number }>;
  const hasStrongAttacks = attacks.length >= 2 || attacks.some(a =>
    typeof a.toHit === "number" && a.toHit >= 5,
  );

  if (hasStrongAttacks) return undefined;

  const damageSpells = spells
    .filter(s => s.level > 0 && s.damage && hasAvailableSlot(resourcePools, s.level))
    .filter(s => getDamageTypeMultiplier(s.damageType, primaryTarget.enemy) > 0) // Skip immune targets
    .sort((a, b) => {
      const aTargets = a.area ? estimateAoETargets(a, combatant.position, enemies) : 1;
      const bTargets = b.area ? estimateAoETargets(b, combatant.position, enemies) : 1;
      const aMult = getDamageTypeMultiplier(a.damageType, primaryTarget.enemy);
      const bMult = getDamageTypeMultiplier(b.damageType, primaryTarget.enemy);
      return (estimateSpellDamage(b.damage) * bTargets * bMult) - (estimateSpellDamage(a.damage) * aTargets * aMult);
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
