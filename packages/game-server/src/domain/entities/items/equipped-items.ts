export type EquippedArmorCategory = "light" | "medium" | "heavy";

export interface EquippedArmorClassFormula {
  base: number;
  addDexterityModifier: boolean;
  dexterityModifierMax?: number;
}

export interface EquippedArmor {
  name: string;
  category: EquippedArmorCategory;
  armorClass: EquippedArmorClassFormula;
}

export interface EquippedShield {
  name: string;
  /**
   * Typical shields grant +2 AC, but we keep this flexible for magic shields.
   */
  armorClassBonus: number;
}

export interface EquippedItems {
  armor?: EquippedArmor;
  shield?: EquippedShield;
}

export interface ArmorTraining {
  light: boolean;
  medium: boolean;
  heavy: boolean;
  shield: boolean;
}
