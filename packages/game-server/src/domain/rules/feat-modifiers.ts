import type { DiceRoll } from "./dice-roller.js";

export type AttackKind = "melee" | "ranged";

// Feat ids are designed to match the ids produced by scripts/import-rulebook.ts:
//   id = `feat_${slugify(feat.name)}` where slugify uses '-' for separators.
export const FEAT_ABILITY_SCORE_IMPROVEMENT = "feat_ability-score-improvement";
export const FEAT_ALERT = "feat_alert";
export const FEAT_ARCHERY = "feat_archery";
export const FEAT_DEFENSE = "feat_defense";
export const FEAT_DUELING = "feat_dueling";
export const FEAT_GRAPPLER = "feat_grappler";
export const FEAT_GREAT_WEAPON_FIGHTING = "feat_great-weapon-fighting";
export const FEAT_MAGIC_INITIATE = "feat_magic-initiate";
export const FEAT_PROTECTION = "feat_protection";
export const FEAT_RESILIENT = "feat_resilient";
export const FEAT_SAVAGE_ATTACKER = "feat_savage-attacker";
export const FEAT_SKILLED = "feat_skilled";
export const FEAT_TOUGH = "feat_tough";
export const FEAT_TWO_WEAPON_FIGHTING = "feat_two-weapon-fighting";
export const FEAT_LUCKY = "feat_lucky";
export const FEAT_SENTINEL = "feat_sentinel";
export const FEAT_WAR_CASTER = "feat_war-caster";

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
   * Dueling: +2 bonus to damage rolls when wielding a melee weapon in one hand
   * and no other weapons (shield is allowed).
   */
  duelingDamageBonus: number;

  /**
   * Great Weapon Fighting: treat any 1 or 2 on a damage die as a 3.
   * This is a deterministic transform of already-rolled dice.
   */
  greatWeaponFightingDamageDieMinimum: number;

  /**
   * Protection: can impose disadvantage on attacks against nearby allies (reaction, requires shield).
   */
  protectionEnabled: boolean;

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

  /**
   * Resilient: grants proficiency in saving throws for one chosen ability.
   * The specific ability is stored on the character sheet, not derived from the feat ID.
   */
  resilientEnabled: boolean;

  /**
   * Tough: +2 max HP per character level.
   */
  toughEnabled: boolean;

  /**
   * Lucky: 3 luck points per long rest — reroll any d20 on attack/check/save.
   */
  luckyEnabled: boolean;

  /**
   * War Caster: advantage on CON saves to maintain concentration.
   * TODO: somatic components with hands full (not currently modeled)
   */
  warCasterEnabled: boolean;

  /**
   * Sentinel: OA hits reduce target speed to 0; OA still triggers even if target Disengaged.
   * TODO: reaction attack when enemy within 5ft attacks a target other than you (effect #3)
   */
  sentinelEnabled: boolean;
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
    duelingDamageBonus: set.has(FEAT_DUELING) ? 2 : 0,
    greatWeaponFightingDamageDieMinimum: set.has(FEAT_GREAT_WEAPON_FIGHTING) ? 3 : 0,
    protectionEnabled: set.has(FEAT_PROTECTION),
    twoWeaponFightingAddsAbilityModifierToBonusAttackDamage: set.has(FEAT_TWO_WEAPON_FIGHTING),

    // Other feats (placeholders)
    savageAttackerEnabled: set.has(FEAT_SAVAGE_ATTACKER),
    skilledProficiencyChoices: set.has(FEAT_SKILLED) ? 3 : 0,
    grapplerEnabled: set.has(FEAT_GRAPPLER),
    magicInitiateEnabled: set.has(FEAT_MAGIC_INITIATE),
    abilityScoreImprovementEnabled: set.has(FEAT_ABILITY_SCORE_IMPROVEMENT),
    resilientEnabled: set.has(FEAT_RESILIENT),
    toughEnabled: set.has(FEAT_TOUGH),
    luckyEnabled: set.has(FEAT_LUCKY),
    warCasterEnabled: set.has(FEAT_WAR_CASTER),
    sentinelEnabled: set.has(FEAT_SENTINEL),
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

/**
 * D&D 5e 2024 Dueling: +2 bonus to damage when wielding a melee weapon in one hand
 * and no other weapons. A shield is allowed.
 */
export function shouldApplyDueling(params: {
  attackKind?: AttackKind;
  weapon?: WeaponContext;
}): boolean {
  if (params.attackKind !== "melee") return false;

  const hands = params.weapon?.hands;
  const properties = params.weapon?.properties ?? [];
  const props = new Set(properties.map((p) => p.trim().toLowerCase()));

  // Dueling requires one-handed wielding. Two-handed weapons are excluded.
  // Versatile weapons wielded in one hand qualify.
  if (hands === 2) return false;
  if (props.has("two-handed")) return false;
  return true;
}
