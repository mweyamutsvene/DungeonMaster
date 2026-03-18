/**
 * Pure functions for applying damage resistance, vulnerability, and immunity.
 * D&D 5e 2024 rules: resistance = half damage (rounded down), vulnerability = double,
 * immunity = zero damage.
 *
 * Layer: Domain (pure, no side effects).
 */

/**
 * Standard D&D 5e damage types.
 */
export type DamageType =
  | "bludgeoning"
  | "piercing"
  | "slashing"
  | "fire"
  | "cold"
  | "lightning"
  | "thunder"
  | "poison"
  | "acid"
  | "necrotic"
  | "radiant"
  | "force"
  | "psychic";

/**
 * Damage defense profile for a creature.
 */
export interface DamageDefenses {
  damageResistances?: string[];
  damageImmunities?: string[];
  damageVulnerabilities?: string[];
}

export type DamageDefenseResult = {
  /** Adjusted damage amount */
  adjustedDamage: number;
  /** Which defense applied, if any */
  defenseApplied: "resistance" | "vulnerability" | "immunity" | "none";
  /** Original damage before adjustment */
  originalDamage: number;
};

/**
 * Apply damage resistance, immunity, and vulnerability to a damage amount.
 *
 * D&D 5e 2024 rules (order of operations):
 * 1. Immunity → 0 damage (takes priority over everything)
 * 2. Resistance → floor(damage / 2)
 * 3. Vulnerability → damage * 2
 *
 * If a creature somehow has both resistance and vulnerability to the same type,
 * they cancel out (D&D 5e rule).
 */
export function applyDamageDefenses(
  damage: number,
  damageType: string | undefined,
  defenses: DamageDefenses,
): DamageDefenseResult {
  if (damage <= 0 || !damageType) {
    return { adjustedDamage: damage, defenseApplied: "none", originalDamage: damage };
  }

  const normalizedType = damageType.trim().toLowerCase();

  const immunities = (defenses.damageImmunities ?? []).map((s) => s.trim().toLowerCase());
  const resistances = (defenses.damageResistances ?? []).map((s) => s.trim().toLowerCase());
  const vulnerabilities = (defenses.damageVulnerabilities ?? []).map((s) => s.trim().toLowerCase());

  // Immunity takes priority
  if (immunities.includes(normalizedType)) {
    return { adjustedDamage: 0, defenseApplied: "immunity", originalDamage: damage };
  }

  const hasResistance = resistances.includes(normalizedType);
  const hasVulnerability = vulnerabilities.includes(normalizedType);

  // If both resistance and vulnerability, they cancel out
  if (hasResistance && hasVulnerability) {
    return { adjustedDamage: damage, defenseApplied: "none", originalDamage: damage };
  }

  if (hasResistance) {
    return {
      adjustedDamage: Math.floor(damage / 2),
      defenseApplied: "resistance",
      originalDamage: damage,
    };
  }

  if (hasVulnerability) {
    return {
      adjustedDamage: damage * 2,
      defenseApplied: "vulnerability",
      originalDamage: damage,
    };
  }

  return { adjustedDamage: damage, defenseApplied: "none", originalDamage: damage };
}

/**
 * Extract damage defenses from a stat block or resource object.
 * Works with both monster stat blocks and combatant resources.
 */
export function extractDamageDefenses(data: unknown): DamageDefenses {
  if (!data || typeof data !== "object") return {};

  const record = data as Record<string, unknown>;
  const toStringArray = (val: unknown): string[] | undefined => {
    if (!Array.isArray(val)) return undefined;
    return val.filter((x): x is string => typeof x === "string");
  };

  return {
    damageResistances: toStringArray(record.damageResistances),
    damageImmunities: toStringArray(record.damageImmunities),
    damageVulnerabilities: toStringArray(record.damageVulnerabilities),
  };
}
