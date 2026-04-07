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
export const BRUTAL_STRIKE = "brutal-strike";
export const RELENTLESS_RAGE = "relentless-rage";
export const PERSISTENT_RAGE = "persistent-rage";
export const INDOMITABLE_MIGHT = "indomitable-might";
export const PRIMAL_CHAMPION = "primal-champion";
// Path of the Berserker subclass
export const FRENZY = "frenzy";
export const MINDLESS_RAGE = "mindless-rage";
export const INTIMIDATING_PRESENCE = "intimidating-presence";

// ── Fighter ─────────────────────────────────────────────────
export const ACTION_SURGE = "action-surge";
export const SECOND_WIND = "second-wind";
export const INDOMITABLE = "indomitable";
export const TWO_EXTRA_ATTACKS = "two-extra-attacks";
export const THREE_EXTRA_ATTACKS = "three-extra-attacks";
// Champion subclass
export const IMPROVED_CRITICAL = "improved-critical";
export const REMARKABLE_ATHLETE = "remarkable-athlete";
export const ADDITIONAL_FIGHTING_STYLE = "additional-fighting-style";
export const SUPERIOR_CRITICAL = "superior-critical";

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
// Thief subclass
export const FAST_HANDS = "fast-hands";
export const SECOND_STORY_WORK = "second-story-work";
export const SUPREME_SNEAK = "supreme-sneak";

// ── Paladin ─────────────────────────────────────────────────
export const DIVINE_SMITE = "divine-smite";
export const LAY_ON_HANDS = "lay-on-hands";
export const AURA_OF_PROTECTION = "aura-of-protection";

// ── Cleric / Paladin (shared) ───────────────────────────────
export const CHANNEL_DIVINITY = "channel-divinity";
export const TURN_UNDEAD = "turn-undead";

// ── Ranger ──────────────────────────────────────────────────
export const FAVORED_ENEMY = "favored-enemy";

// ── Cross-class (martial) ───────────────────────────────────
export const EXTRA_ATTACK = "extra-attack";
export const UNARMORED_DEFENSE = "unarmored-defense";
export const WEAPON_MASTERY = "weapon-mastery";
export const FIGHTING_STYLE = "fighting-style";

// ── Spellcasting ────────────────────────────────────────────
export const SPELLCASTING = "spellcasting";
export const ARCANE_RECOVERY = "arcane-recovery";
export const PACT_MAGIC = "pact-magic";

// ── Bard ────────────────────────────────────────────────────
export const BARDIC_INSPIRATION = "bardic-inspiration";
export const JACK_OF_ALL_TRADES = "jack-of-all-trades";
export const FONT_OF_INSPIRATION = "font-of-inspiration";
export const COUNTERCHARM = "countercharm";

// ── Warlock ─────────────────────────────────────────────────
export const ELDRITCH_INVOCATIONS = "eldritch-invocations";
export const PACT_BOON = "pact-boon";

// ── Druid ───────────────────────────────────────────────────
export const WILD_SHAPE = "wild-shape";

// ── Sorcerer ────────────────────────────────────────────────
export const SORCERY_POINTS = "sorcery-points";
export const METAMAGIC = "metamagic";
