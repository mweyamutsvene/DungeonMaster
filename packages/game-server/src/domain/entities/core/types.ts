export type EntityId = string;

export type CreatureSize =
  | "Tiny"
  | "Small"
  | "Medium"
  | "Large"
  | "Huge"
  | "Gargantuan";

export type CreatureKind = "Humanoid" | "Beast" | "Undead" | "Construct" | "Fiend" | "Fey" | "Celestial" | "Dragon" | "Elemental" | "Giant" | "Monstrosity" | "Ooze" | "Plant" | "Aberration" | "Other";

export type Alignment =
  | "Lawful Good"
  | "Neutral Good"
  | "Chaotic Good"
  | "Lawful Neutral"
  | "Neutral"
  | "Chaotic Neutral"
  | "Lawful Evil"
  | "Neutral Evil"
  | "Chaotic Evil"
  | "Unaligned";
