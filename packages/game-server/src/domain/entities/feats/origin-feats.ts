export const ORIGIN_FEAT_IDS = {
  alert: "feat_alert",
  crafter: "feat_crafter",
  healer: "feat_healer",
  lucky: "feat_lucky",
  magicInitiate: "feat_magic-initiate",
  musician: "feat_musician",
  savageAttacker: "feat_savage-attacker",
  skilled: "feat_skilled",
  tavernBrawler: "feat_tavern-brawler",
  tough: "feat_tough",
} as const;

export type OriginFeatId = (typeof ORIGIN_FEAT_IDS)[keyof typeof ORIGIN_FEAT_IDS];

const ORIGIN_FEAT_ALIASES: Readonly<Record<string, OriginFeatId>> = {
  alert: ORIGIN_FEAT_IDS.alert,
  crafter: ORIGIN_FEAT_IDS.crafter,
  healer: ORIGIN_FEAT_IDS.healer,
  lucky: ORIGIN_FEAT_IDS.lucky,
  "magic-initiate": ORIGIN_FEAT_IDS.magicInitiate,
  "magic-initiate-cleric": ORIGIN_FEAT_IDS.magicInitiate,
  "magic-initiate-druid": ORIGIN_FEAT_IDS.magicInitiate,
  "magic-initiate-wizard": ORIGIN_FEAT_IDS.magicInitiate,
  musician: ORIGIN_FEAT_IDS.musician,
  "savage-attacker": ORIGIN_FEAT_IDS.savageAttacker,
  skilled: ORIGIN_FEAT_IDS.skilled,
  "tavern-brawler": ORIGIN_FEAT_IDS.tavernBrawler,
  tough: ORIGIN_FEAT_IDS.tough,
};

export function normalizeOriginFeatId(feat: string): OriginFeatId {
  const key = feat.trim().toLowerCase();
  const id = ORIGIN_FEAT_ALIASES[key];
  if (!id) {
    throw new Error(`Unknown origin feat: ${feat}`);
  }
  return id;
}

export function isOriginFeatId(featId: string): featId is OriginFeatId {
  return Object.values(ORIGIN_FEAT_IDS).includes(featId as OriginFeatId);
}
