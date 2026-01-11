import type { DiceRoll } from "./dice-roller.js";

export type AttackKind = "melee" | "ranged";

// Feat ids are designed to match the ids produced by scripts/import-rulebook.ts:
//   id = `feat_${slugify(feat.name)}` where slugify uses '-' for separators.
export const FEAT_ABILITY_SCORE_IMPROVEMENT = "feat_ability-score-improvement";
export const FEAT_ALERT = "feat_alert";
export const FEAT_ARCHERY = "feat_archery";
export const FEAT_DEFENSE = "feat_defense";
export const FEAT_GRAPPLER = "feat_grappler";
export const FEAT_GREAT_WEAPON_FIGHTING = "feat_great-weapon-fighting";
export const FEAT_MAGIC_INITIATE = "feat_magic-initiate";
export const FEAT_SAVAGE_ATTACKER = "feat_savage-attacker";
export const FEAT_SKILLED = "feat_skilled";
export const FEAT_TWO_WEAPON_FIGHTING = "feat_two-weapon-fighting";

export interface WeaponContext {
  /**
   * Weapon properties (e.g. "Two-Handed", "Versatile", "Light").
   * These come from the equipment rules, but we keep them as strings for now.
   */
  properties?: readonly string[];
  /**
   * How many hands are being used to wield the weapon for this attack.
   */
  hands?: 1 | 2;
}

export interface FeatModifiers {
  // Alert
  initiativeAddProficiency: boolean;
  initiativeSwapEnabled: boolean;

  // Fighting Style feats
  rangedAttackBonus: number;

  /**
   * Defense is only applicable while wearing Light/Medium/Heavy armor.
   * (We don't currently model worn armor in-domain; callers should apply this when applicable.)
   */
  armorClassBonusWhileArmored: number;

  /**
   * Great Weapon Fighting: treat any 1 or 2 on a damage die as a 3.
   * This is a deterministic transform of already-rolled dice.
   */
  greatWeaponFightingDamageDieMinimum: number;

  /**
   * Two-Weapon Fighting: add ability modifier to bonus attack damage.
   * Requires action-economy + weapon rules integration to apply.
   */
  twoWeaponFightingAddsAbilityModifierToBonusAttackDamage: boolean;

  // Other feats (placeholders until the relevant subsystems exist)
  savageAttackerEnabled: boolean;
  skilledProficiencyChoices: number;
  grapplerEnabled: boolean;
  magicInitiateEnabled: boolean;
  abilityScoreImprovementEnabled: boolean;
}

export function computeFeatModifiers(featIds: readonly string[]): FeatModifiers {
  const set = new Set(featIds);

  return {
    // Alert
    initiativeAddProficiency: set.has(FEAT_ALERT),
    initiativeSwapEnabled: set.has(FEAT_ALERT),

    // Fighting style feats
    rangedAttackBonus: set.has(FEAT_ARCHERY) ? 2 : 0,
    armorClassBonusWhileArmored: set.has(FEAT_DEFENSE) ? 1 : 0,
    greatWeaponFightingDamageDieMinimum: set.has(FEAT_GREAT_WEAPON_FIGHTING) ? 3 : 0,
    twoWeaponFightingAddsAbilityModifierToBonusAttackDamage: set.has(FEAT_TWO_WEAPON_FIGHTING),

    // Other feats (placeholders)
    savageAttackerEnabled: set.has(FEAT_SAVAGE_ATTACKER),
    skilledProficiencyChoices: set.has(FEAT_SKILLED) ? 3 : 0,
    grapplerEnabled: set.has(FEAT_GRAPPLER),
    magicInitiateEnabled: set.has(FEAT_MAGIC_INITIATE),
    abilityScoreImprovementEnabled: set.has(FEAT_ABILITY_SCORE_IMPROVEMENT),
  };
}

export function applyDamageDieMinimum(roll: DiceRoll, minimum: number): DiceRoll {
  if (!Number.isInteger(minimum) || minimum < 1) {
    return roll;
  }

  const sumRolls = roll.rolls.reduce((sum, r) => sum + r, 0);
  const modifier = roll.total - sumRolls;
  const nextRolls = roll.rolls.map((r) => (r < minimum ? minimum : r));
  const nextTotal = nextRolls.reduce((sum, r) => sum + r, 0) + modifier;
  return { rolls: nextRolls, total: nextTotal };
}

export function shouldApplyGreatWeaponFighting(params: {
  attackKind?: AttackKind;
  weapon?: WeaponContext;
}): boolean {
  if (params.attackKind !== "melee") return false;

  const hands = params.weapon?.hands;
  const properties = params.weapon?.properties ?? [];
  const props = new Set(properties.map((p) => p.trim().toLowerCase()));

  const twoHandedOrVersatile = props.has("two-handed") || props.has("versatile");
  return hands === 2 && twoHandedOrVersatile;
}
