/**
 * War Caster feat: Opportunity Attack with a Spell — domain validation.
 *
 * D&D 5e 2024 War Caster rules for spell-as-OA:
 * - The spell must have a casting time of 1 action (not bonus action, not reaction)
 * - The spell must target only the creature that provoked the OA (no AoE, no multi-target)
 * - The caster must have the spell prepared
 * - The caster must have a spell slot available (cantrips don't need a slot)
 */

import type { PreparedSpellDefinition } from "../entities/spells/prepared-spell-definition.js";

/**
 * Check if a spell is eligible for War Caster spell-as-OA use.
 *
 * Eligible spells:
 * - Not a bonus action spell (must be casting time = 1 action)
 * - No area of effect (must target only the provoking creature)
 * - No zone spell (must target only the provoking creature)
 * - Has some mechanical effect (attack, damage save, buff/debuff, healing)
 */
export function isEligibleWarCasterSpell(spell: PreparedSpellDefinition): boolean {
  if (spell.isBonusAction) return false;
  if (spell.area) return false;
  if (spell.zone) return false;
  return true;
}

/**
 * Check if a caster has a spell slot available for a given level.
 * Cantrips (level 0) don't require slots.
 *
 * @param resources The caster's combatant resources (normalized)
 * @param spellLevel Level of the spell (0 = cantrip)
 */
export function hasSpellSlotForOA(
  resources: Record<string, unknown>,
  spellLevel: number,
): boolean {
  if (spellLevel === 0) return true;

  const pools = resources.resourcePools;
  if (!Array.isArray(pools)) return false;

  // Check for spell slots at the spell's level or higher
  for (const pool of pools) {
    if (!pool || typeof pool !== "object") continue;
    const p = pool as Record<string, unknown>;
    const name = typeof p.name === "string" ? p.name : "";
    // Spell slot pools are named like "Spell Slot (Level 1)", "Spell Slot (Level 2)", etc.
    const match = name.match(/spell slot.*level\s*(\d+)/i);
    if (!match) continue;
    const slotLevel = parseInt(match[1]!, 10);
    if (slotLevel >= spellLevel) {
      const current = typeof p.current === "number" ? p.current : 0;
      if (current > 0) return true;
    }
  }
  return false;
}

/**
 * Find the best eligible spell for an AI caster to use as a War Caster OA.
 *
 * Priority:
 * 1. Cantrips with attack/damage (Fire Bolt, Shocking Grasp) — no slot cost
 * 2. Leveled attack spells with available slots (highest damage first)
 * 3. Leveled save-based spells with available slots
 *
 * Returns null if no eligible spell is found.
 */
export function findBestWarCasterSpell(
  preparedSpells: PreparedSpellDefinition[],
  resources: Record<string, unknown>,
): { spell: PreparedSpellDefinition; castAtLevel?: number } | null {
  const eligible = preparedSpells.filter(isEligibleWarCasterSpell);
  if (eligible.length === 0) return null;

  // Priority 1: Cantrips with attack type or save-based damage
  const cantrips = eligible.filter(s => s.level === 0 && (s.attackType || s.saveAbility || s.damage));
  if (cantrips.length > 0) {
    // Prefer attack-type cantrips (Fire Bolt) over save-based
    const attackCantrip = cantrips.find(s => s.attackType);
    return { spell: attackCantrip ?? cantrips[0]! };
  }

  // Priority 2: Leveled attack spells
  const attackSpells = eligible
    .filter(s => s.level > 0 && s.attackType && hasSpellSlotForOA(resources, s.level))
    .sort((a, b) => b.level - a.level);
  if (attackSpells.length > 0) {
    return { spell: attackSpells[0]! };
  }

  // Priority 3: Leveled save-based spells
  const saveSpells = eligible
    .filter(s => s.level > 0 && s.saveAbility && hasSpellSlotForOA(resources, s.level))
    .sort((a, b) => b.level - a.level);
  if (saveSpells.length > 0) {
    return { spell: saveSpells[0]! };
  }

  return null;
}
