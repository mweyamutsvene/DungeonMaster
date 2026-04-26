import { normalizeOriginFeatId } from "../feats/origin-feats.js";
import type { BackgroundDefinition } from "./types.js";

const BACKGROUNDS: readonly BackgroundDefinition[] = [
  {
    id: "acolyte",
    name: "Acolyte",
    abilityScoreOptions: ["intelligence", "wisdom", "charisma"],
    skillProficiencies: ["insight", "religion"],
    toolProficiency: "calligrapher-supplies",
    language: "any",
    originFeat: normalizeOriginFeatId("magic-initiate-cleric"),
    startingEquipment: [
      { name: "calligrapher-supplies", quantity: 1 },
      { name: "holy-symbol", quantity: 1 },
    ],
  },
  {
    id: "artisan",
    name: "Artisan",
    abilityScoreOptions: ["strength", "dexterity", "intelligence"],
    skillProficiencies: ["investigation", "persuasion"],
    toolProficiency: "artisan-tools",
    language: "any",
    originFeat: normalizeOriginFeatId("crafter"),
    startingEquipment: [
      { name: "artisan-tools", quantity: 1 },
      { name: "traveler-clothes", quantity: 1 },
    ],
  },
  {
    id: "charlatan",
    name: "Charlatan",
    abilityScoreOptions: ["dexterity", "constitution", "charisma"],
    skillProficiencies: ["deception", "sleightOfHand"],
    toolProficiency: "forgery-kit",
    language: "any",
    originFeat: normalizeOriginFeatId("skilled"),
    startingEquipment: [
      { name: "forgery-kit", quantity: 1 },
      { name: "costume", quantity: 1 },
    ],
  },
  {
    id: "criminal",
    name: "Criminal",
    abilityScoreOptions: ["dexterity", "constitution", "intelligence"],
    skillProficiencies: ["sleightOfHand", "stealth"],
    toolProficiency: "thieves-tools",
    language: "any",
    originFeat: normalizeOriginFeatId("alert"),
    startingEquipment: [
      { name: "thieves-tools", quantity: 1 },
      { name: "dagger", quantity: 2 },
    ],
  },
  {
    id: "entertainer",
    name: "Entertainer",
    abilityScoreOptions: ["strength", "dexterity", "charisma"],
    skillProficiencies: ["acrobatics", "performance"],
    toolProficiency: "musical-instrument",
    language: "any",
    originFeat: normalizeOriginFeatId("musician"),
    startingEquipment: [
      { name: "musical-instrument", quantity: 1 },
      { name: "costume", quantity: 1 },
    ],
  },
  {
    id: "farmer",
    name: "Farmer",
    abilityScoreOptions: ["strength", "constitution", "wisdom"],
    skillProficiencies: ["animalHandling", "nature"],
    toolProficiency: "artisan-tools",
    language: "any",
    originFeat: normalizeOriginFeatId("tough"),
    startingEquipment: [
      { name: "sickle", quantity: 1 },
      { name: "healers-kit", quantity: 1 },
    ],
  },
  {
    id: "guard",
    name: "Guard",
    abilityScoreOptions: ["strength", "intelligence", "wisdom"],
    skillProficiencies: ["athletics", "perception"],
    toolProficiency: "gaming-set",
    language: "any",
    originFeat: normalizeOriginFeatId("alert"),
    startingEquipment: [
      { name: "spear", quantity: 1 },
      { name: "torch", quantity: 3 },
    ],
  },
  {
    id: "guide",
    name: "Guide",
    abilityScoreOptions: ["dexterity", "constitution", "wisdom"],
    skillProficiencies: ["stealth", "survival"],
    toolProficiency: "cartographer-tools",
    language: "any",
    originFeat: normalizeOriginFeatId("magic-initiate-druid"),
    startingEquipment: [
      { name: "map-case", quantity: 1 },
      { name: "rope", quantity: 1 },
    ],
  },
  {
    id: "hermit",
    name: "Hermit",
    abilityScoreOptions: ["constitution", "wisdom", "charisma"],
    skillProficiencies: ["medicine", "religion"],
    toolProficiency: "herbalism-kit",
    language: "any",
    originFeat: normalizeOriginFeatId("healer"),
    startingEquipment: [
      { name: "herbalism-kit", quantity: 1 },
      { name: "blanket", quantity: 1 },
    ],
  },
  {
    id: "merchant",
    name: "Merchant",
    abilityScoreOptions: ["constitution", "intelligence", "charisma"],
    skillProficiencies: ["insight", "persuasion"],
    toolProficiency: "navigator-tools",
    language: "any",
    originFeat: normalizeOriginFeatId("lucky"),
    startingEquipment: [
      { name: "abacus", quantity: 1 },
      { name: "ledger", quantity: 1 },
    ],
  },
  {
    id: "noble",
    name: "Noble",
    abilityScoreOptions: ["strength", "intelligence", "charisma"],
    skillProficiencies: ["history", "persuasion"],
    toolProficiency: "gaming-set",
    language: "any",
    originFeat: normalizeOriginFeatId("skilled"),
    startingEquipment: [
      { name: "fine-clothes", quantity: 1 },
      { name: "signet-ring", quantity: 1 },
    ],
  },
  {
    id: "sage",
    name: "Sage",
    abilityScoreOptions: ["constitution", "intelligence", "wisdom"],
    skillProficiencies: ["arcana", "history"],
    toolProficiency: "calligrapher-supplies",
    language: "any",
    originFeat: normalizeOriginFeatId("magic-initiate-wizard"),
    startingEquipment: [
      { name: "quarterstaff", quantity: 1 },
      { name: "book", quantity: 1 },
    ],
  },
  {
    id: "sailor",
    name: "Sailor",
    abilityScoreOptions: ["strength", "dexterity", "wisdom"],
    skillProficiencies: ["athletics", "perception"],
    toolProficiency: "navigator-tools",
    language: "any",
    originFeat: normalizeOriginFeatId("tavern-brawler"),
    startingEquipment: [
      { name: "rope", quantity: 1 },
      { name: "club", quantity: 1 },
    ],
  },
  {
    id: "scribe",
    name: "Scribe",
    abilityScoreOptions: ["dexterity", "intelligence", "wisdom"],
    skillProficiencies: ["investigation", "perception"],
    toolProficiency: "calligrapher-supplies",
    language: "any",
    originFeat: normalizeOriginFeatId("skilled"),
    startingEquipment: [
      { name: "calligrapher-supplies", quantity: 1 },
      { name: "book", quantity: 1 },
    ],
  },
  {
    id: "soldier",
    name: "Soldier",
    abilityScoreOptions: ["strength", "dexterity", "constitution"],
    skillProficiencies: ["athletics", "intimidation"],
    toolProficiency: "gaming-set",
    language: "any",
    originFeat: normalizeOriginFeatId("savage-attacker"),
    startingEquipment: [
      { name: "spear", quantity: 1 },
      { name: "shortbow", quantity: 1 },
    ],
  },
  {
    id: "wayfarer",
    name: "Wayfarer",
    abilityScoreOptions: ["dexterity", "wisdom", "charisma"],
    skillProficiencies: ["insight", "survival"],
    toolProficiency: "thieves-tools",
    language: "any",
    originFeat: normalizeOriginFeatId("lucky"),
    startingEquipment: [
      { name: "bedroll", quantity: 1 },
      { name: "waterskin", quantity: 1 },
    ],
  },
];

const BACKGROUND_BY_ID: ReadonlyMap<string, BackgroundDefinition> = new Map(
  BACKGROUNDS.map((background) => [background.id, background] as const),
);

export function listBackgroundDefinitions(): readonly BackgroundDefinition[] {
  return BACKGROUNDS;
}

export function getBackgroundDefinition(backgroundId: string): BackgroundDefinition {
  const id = backgroundId.trim().toLowerCase();
  const background = BACKGROUND_BY_ID.get(id);
  if (!background) {
    throw new Error(`Unknown background: ${backgroundId}`);
  }
  return background;
}
