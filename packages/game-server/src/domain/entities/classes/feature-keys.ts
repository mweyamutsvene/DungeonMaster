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
export const RETALIATION = "retaliation";

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
export const HEROIC_WARRIOR = "heroic-warrior";
export const SUPERIOR_CRITICAL = "superior-critical";
export const SURVIVOR = "survivor";

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
export const ACROBATIC_MOVEMENT = "acrobatic-movement";
export const SELF_RESTORATION = "self-restoration";
export const DEFLECT_ENERGY = "deflect-energy";
export const TONGUE_OF_SUN_AND_MOON = "tongue-of-sun-and-moon";
export const DIAMOND_SOUL = "diamond-soul";
export const EMPTY_BODY = "empty-body";
export const PERFECT_SELF = "perfect-self";
// Way of the Open Hand subclass
export const QUIVERING_PALM = "quivering-palm";
export const PERFECT_FOCUS = "perfect-focus";

// ── Rogue ───────────────────────────────────────────────────
export const SNEAK_ATTACK = "sneak-attack";
export const CUNNING_ACTION = "cunning-action";
export const UNCANNY_DODGE = "uncanny-dodge";
export const EVASION = "evasion";
// Thief subclass
export const FAST_HANDS = "fast-hands";
export const SECOND_STORY_WORK = "second-story-work";
export const SUPREME_SNEAK = "supreme-sneak";
export const USE_MAGIC_DEVICE = "use-magic-device";
export const THIEFS_REFLEXES = "thiefs-reflexes";

// ── Paladin ─────────────────────────────────────────────────
export const DIVINE_SMITE = "divine-smite";
export const LAY_ON_HANDS = "lay-on-hands";
export const AURA_OF_PROTECTION = "aura-of-protection";
export const DIVINE_SENSE = "divine-sense";

// ── Cleric / Paladin (shared) ───────────────────────────────
export const CHANNEL_DIVINITY = "channel-divinity";
export const TURN_UNDEAD = "turn-undead";
export const DESTROY_UNDEAD = "destroy-undead";

// ── Ranger ──────────────────────────────────────────────────
export const FAVORED_ENEMY = "favored-enemy";
export const DEFT_EXPLORER = "deft-explorer";
export const ROVING = "roving";
export const TIRELESS = "tireless";
export const RELENTLESS_HUNTER = "relentless-hunter";
export const NATURES_VEIL = "natures-veil";
export const PRECISE_HUNTER = "precise-hunter";
export const FERAL_SENSES = "feral-senses";
export const FOE_SLAYER = "foe-slayer";

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
export const MYSTIC_ARCANUM_6 = "mystic-arcanum-6";
export const MYSTIC_ARCANUM_7 = "mystic-arcanum-7";
export const MYSTIC_ARCANUM_8 = "mystic-arcanum-8";
export const MYSTIC_ARCANUM_9 = "mystic-arcanum-9";
export const ELDRITCH_MASTER = "eldritch-master";

// ── Druid ───────────────────────────────────────────────────
export const WILD_SHAPE = "wild-shape";
// Circle of the Land subclass
export const CIRCLE_SPELLS = "circle-spells";
export const LANDS_AID = "lands-aid";

// ── Sorcerer ────────────────────────────────────────────────
export const SORCERY_POINTS = "sorcery-points";
export const METAMAGIC = "metamagic";
export const INNATE_SORCERY = "innate-sorcery";
// Draconic Sorcery subclass
export const DRACONIC_RESILIENCE = "draconic-resilience";
export const DRACONIC_ANCESTRY = "draconic-ancestry";
export const ELEMENTAL_AFFINITY = "elemental-affinity";

// ── Cleric subclasses ───────────────────────────────────────
// Life Domain
export const DISCIPLE_OF_LIFE = "disciple-of-life";
export const PRESERVE_LIFE = "preserve-life";
export const LIFE_DOMAIN_SPELLS = "life-domain-spells";

// ── Paladin subclasses ──────────────────────────────────────
// Oath of Devotion
export const SACRED_WEAPON = "sacred-weapon";
export const OATH_OF_DEVOTION_SPELLS = "oath-of-devotion-spells";

// ── Warlock subclasses ──────────────────────────────────────
// The Fiend
export const DARK_ONES_BLESSING = "dark-ones-blessing";
export const FIEND_EXPANDED_SPELLS = "fiend-expanded-spells";

// ── Wizard subclasses ───────────────────────────────────────
// School of Evocation
export const SCULPT_SPELLS = "sculpt-spells";
export const EVOCATION_SAVANT = "evocation-savant";

// ── Bard subclasses ─────────────────────────────────────────
// College of Lore
export const CUTTING_WORDS = "cutting-words";
export const ADDITIONAL_MAGICAL_SECRETS = "additional-magical-secrets";
export const BONUS_PROFICIENCIES = "bonus-proficiencies";
