/**
 * Temporary HP absorption helper.
 *
 * D&D 5e 2024 RAW: Temporary hit points are separate from a creature's hit
 * point maximum. When a creature takes damage, subtract it from temp HP first;
 * any remaining damage reduces actual HP. Temp HP cannot be added together —
 * the higher pool replaces the lower. This helper only handles subtraction.
 */

export interface TempHpAbsorptionResult {
  /** Final HP value after damage is applied to remaining HP. */
  hpAfter: number;
  /** Final temp HP value after absorption. */
  tempHpAfter: number;
  /** Amount of damage applied to actual HP (not absorbed by temp HP). */
  hpDamage: number;
  /** Amount of damage absorbed by temp HP. */
  tempAbsorbed: number;
}

/**
 * Apply incoming damage against a creature's tempHp pool first, then HP.
 *
 * @param hpCurrent current actual HP before damage
 * @param tempHpCurrent current temp HP (undefined/non-number treated as 0)
 * @param damage non-negative incoming damage
 */
export function applyDamageWithTempHp(
  hpCurrent: number,
  tempHpCurrent: number | undefined,
  damage: number,
): TempHpAbsorptionResult {
  const temp = typeof tempHpCurrent === "number" && tempHpCurrent > 0 ? tempHpCurrent : 0;
  const dmg = Math.max(0, damage);
  const tempAbsorbed = Math.min(temp, dmg);
  const tempHpAfter = temp - tempAbsorbed;
  const hpDamage = dmg - tempAbsorbed;
  const hpAfter = Math.max(0, hpCurrent - hpDamage);
  return { hpAfter, tempHpAfter, hpDamage, tempAbsorbed };
}

/**
 * Read tempHp off a resources JsonValue-like object.
 */
export function readTempHp(resources: unknown): number {
  if (!resources || typeof resources !== "object") return 0;
  const v = (resources as Record<string, unknown>).tempHp;
  return typeof v === "number" && v > 0 ? v : 0;
}

/**
 * Return a new resources object with tempHp set to the given value.
 * Drops the key when value <= 0 to keep snapshots clean.
 */
export function withTempHp(resources: unknown, tempHp: number): Record<string, unknown> {
  const base = (resources && typeof resources === "object")
    ? { ...(resources as Record<string, unknown>) }
    : {};
  if (tempHp > 0) base.tempHp = tempHp;
  else delete base.tempHp;
  return base;
}
