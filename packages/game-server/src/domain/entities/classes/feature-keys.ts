/**
 * Standard feature key constants for ClassDefinition.features maps.
 *
 * Use these constants (instead of raw strings) when calling `classHasFeature()`
 * or `hasFeature()` to get compile-time safety and IDE autocomplete.
 *
 * The underlying type is `string` (not a closed union) so homebrew / unique
 * classes can declare custom feature keys without modifying this file.
 */

// ── Barbarian ───────────────────────────────────────────────
export const RAGE = "rage";
export const RECKLESS_ATTACK = "reckless-attack";
export const DANGER_SENSE = "danger-sense";
export const FERAL_INSTINCT = "feral-instinct";

// ── Fighter ─────────────────────────────────────────────────
export const ACTION_SURGE = "action-surge";
export const SECOND_WIND = "second-wind";
export const TWO_EXTRA_ATTACKS = "two-extra-attacks";
export const THREE_EXTRA_ATTACKS = "three-extra-attacks";

// ── Monk ────────────────────────────────────────────────────
export const MARTIAL_ARTS = "martial-arts";
export const FLURRY_OF_BLOWS = "flurry-of-blows";
export const PATIENT_DEFENSE = "patient-defense";
export const STEP_OF_THE_WIND = "step-of-the-wind";
export const STUNNING_STRIKE = "stunning-strike";
export const DEFLECT_ATTACKS = "deflect-attacks";
export const UNCANNY_METABOLISM = "uncanny-metabolism";
export const WHOLENESS_OF_BODY = "wholeness-of-body";
export const OPEN_HAND_TECHNIQUE = "open-hand-technique";

// ── Rogue ───────────────────────────────────────────────────
export const SNEAK_ATTACK = "sneak-attack";
export const CUNNING_ACTION = "cunning-action";
export const UNCANNY_DODGE = "uncanny-dodge";
export const EVASION = "evasion";

// ── Paladin ─────────────────────────────────────────────────
export const DIVINE_SMITE = "divine-smite";
export const LAY_ON_HANDS = "lay-on-hands";

// ── Cleric / Paladin (shared) ───────────────────────────────
export const CHANNEL_DIVINITY = "channel-divinity";
export const TURN_UNDEAD = "turn-undead";

// ── Cross-class (martial) ───────────────────────────────────
export const EXTRA_ATTACK = "extra-attack";
export const UNARMORED_DEFENSE = "unarmored-defense";

// ── Spellcasting ────────────────────────────────────────────
export const SPELLCASTING = "spellcasting";
export const ARCANE_RECOVERY = "arcane-recovery";
export const PACT_MAGIC = "pact-magic";

// ── Bard ────────────────────────────────────────────────────
export const BARDIC_INSPIRATION = "bardic-inspiration";

// ── Druid ───────────────────────────────────────────────────
export const WILD_SHAPE = "wild-shape";

// ── Sorcerer ────────────────────────────────────────────────
export const SORCERY_POINTS = "sorcery-points";
export const METAMAGIC = "metamagic";
