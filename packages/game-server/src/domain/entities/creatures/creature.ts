/**
 * Base Creature Class
 * 
 * Abstract base class for all combatants (Characters and Monsters).
 * Contains core combat statistics and mechanics shared by all creatures.
 */

import { AbilityScores, type Ability } from "../core/ability-scores.js";
import type { DiceRoller } from "../../rules/dice-roller.js";
import type { ArmorTraining, EquippedItems } from "../items/equipped-items.js";

export interface CreatureData {
  id: string;
  name: string;
  maxHP: number;
  currentHP: number;
  armorClass: number;
  speed: number;
  abilityScores: AbilityScores;

  /**
   * Optional equipped items used for derived calculations (e.g. armor class).
   * If omitted, `armorClass` is used as-is.
   */
  equipment?: EquippedItems;

  /**
   * Optional training flags that affect how some equipment functions.
   *
   * If omitted, defaults to trained for backward compatibility.
   */
  armorTraining?: Partial<ArmorTraining>;
}

export abstract class Creature {
  protected id: string;
  protected name: string;
  protected maxHP: number;
  protected currentHP: number;
  protected armorClass: number;
  protected speed: number;
  protected abilityScores: AbilityScores;
  protected conditions: Set<string> = new Set();

  protected equipment?: EquippedItems;
  protected armorTraining: ArmorTraining;

  constructor(data: CreatureData) {
    this.id = data.id;
    this.name = data.name;
    this.maxHP = data.maxHP;
    this.currentHP = data.currentHP;
    this.armorClass = data.armorClass;
    this.speed = data.speed;
    this.abilityScores = data.abilityScores;

    this.equipment = data.equipment
      ? {
          armor: data.equipment.armor
            ? {
                name: data.equipment.armor.name,
                category: data.equipment.armor.category,
                armorClass: { ...data.equipment.armor.armorClass },
              }
            : undefined,
          shield: data.equipment.shield
            ? {
                name: data.equipment.shield.name,
                armorClassBonus: data.equipment.shield.armorClassBonus,
              }
            : undefined,
        }
      : undefined;

    this.armorTraining = {
      light: data.armorTraining?.light ?? true,
      medium: data.armorTraining?.medium ?? true,
      heavy: data.armorTraining?.heavy ?? true,
      shield: data.armorTraining?.shield ?? true,
    };
  }

  // === Getters ===

  getId(): string {
    return this.id;
  }

  getName(): string {
    return this.name;
  }

  getMaxHP(): number {
    return this.maxHP;
  }

  getCurrentHP(): number {
    return this.currentHP;
  }

  getAC(): number {
    // Preserve existing behavior unless equipment is explicitly provided.
    if (!this.equipment?.armor && !this.equipment?.shield) {
      return this.armorClass;
    }

    const dexterityModifier = this.getAbilityModifier("dexterity");
    let ac = 10 + dexterityModifier;

    if (this.equipment.armor) {
      const formula = this.equipment.armor.armorClass;
      const cappedDexterityModifier =
        typeof formula.dexterityModifierMax === "number"
          ? Math.min(dexterityModifier, formula.dexterityModifierMax)
          : dexterityModifier;

      ac = formula.base + (formula.addDexterityModifier ? cappedDexterityModifier : 0);
    }

    // Shield bonus only applies if trained with shields.
    if (this.equipment.shield && this.armorTraining.shield) {
      ac += this.equipment.shield.armorClassBonus;
    }

    return ac;
  }

  getEquipment(): EquippedItems | undefined {
    if (!this.equipment) return undefined;
    return {
      armor: this.equipment.armor
        ? { ...this.equipment.armor, armorClass: { ...this.equipment.armor.armorClass } }
        : undefined,
      shield: this.equipment.shield ? { ...this.equipment.shield } : undefined,
    };
  }

  getArmorTraining(): ArmorTraining {
    return { ...this.armorTraining };
  }

  isWearingUntrainedArmor(): boolean {
    const armor = this.equipment?.armor;
    if (!armor) return false;

    if (armor.category === "light") return !this.armorTraining.light;
    if (armor.category === "medium") return !this.armorTraining.medium;
    return !this.armorTraining.heavy;
  }

  /**
   * Armor training penalty: if you wear Light/Medium/Heavy armor without training,
   * you cannot cast spells.
   */
  canCastSpells(): boolean {
    return !this.isWearingUntrainedArmor();
  }

  /**
   * Armor training penalty: if you wear Light/Medium/Heavy armor without training,
   * you have Disadvantage on any D20 Test that involves Strength or Dexterity.
   */
  getD20TestModeForAbility(ability: Ability, baseMode: "normal" | "advantage" | "disadvantage"): "normal" | "advantage" | "disadvantage" {
    const penalized = this.isWearingUntrainedArmor() && (ability === "strength" || ability === "dexterity");
    if (!penalized) return baseMode;

    // Advantage + disadvantage cancel.
    if (baseMode === "advantage") return "normal";
    return "disadvantage";
  }

  getSpeed(): number {
    return this.speed;
  }

  getAbilityScore(ability: Ability): number {
    return this.abilityScores.getScore(ability);
  }

  getAbilityModifier(ability: Ability): number {
    return this.abilityScores.getModifier(ability);
  }

  // === Abstract Methods (must be implemented by subclasses) ===

  abstract getProficiencyBonus(): number;

  // === Hit Points ===

  takeDamage(amount: number): void {
    if (amount < 0) {
      throw new Error('Damage amount cannot be negative');
    }
    this.currentHP = Math.max(0, this.currentHP - amount);
  }

  heal(amount: number): void {
    if (amount < 0) {
      throw new Error('Healing amount cannot be negative');
    }
    this.currentHP = Math.min(this.maxHP, this.currentHP + amount);
  }

  /**
   * Modify creature HP (positive for healing, negative for damage).
   * @param amount - Positive for healing, negative for damage
   * @returns Object with actual change and overflow/overkill
   */
  modifyHP(amount: number): { actualChange: number; overflow: number } {
    if (amount > 0) {
      // Healing
      const hpBefore = this.currentHP;
      this.heal(amount);
      const actualHealing = this.currentHP - hpBefore;
      return {
        actualChange: actualHealing,
        overflow: amount - actualHealing, // overflow healing
      };
    } else if (amount < 0) {
      // Damage
      const damageAmount = Math.abs(amount);
      const hpBefore = this.currentHP;
      this.takeDamage(damageAmount);
      const actualDamage = hpBefore - this.currentHP;
      return {
        actualChange: -actualDamage,
        overflow: -(damageAmount - actualDamage), // overkill damage
      };
    }
    return { actualChange: 0, overflow: 0 };
  }

  isAlive(): boolean {
    return this.currentHP > 0;
  }

  isDead(): boolean {
    return this.currentHP === 0;
  }

  // === Conditions ===

  addCondition(condition: string): void {
    this.conditions.add(condition.toLowerCase());
  }

  removeCondition(condition: string): void {
    this.conditions.delete(condition.toLowerCase());
  }

  hasCondition(condition: string): boolean {
    return this.conditions.has(condition.toLowerCase());
  }

  getConditions(): string[] {
    return Array.from(this.conditions);
  }

  clearAllConditions(): void {
    this.conditions.clear();
  }

  // === Combat ===

  /**
   * Deterministic: returns the initiative modifier only.
   * Rolling the d20 should be handled by a deterministic dice service.
   */
  getInitiativeModifier(): number {
    return this.getAbilityModifier("dexterity");
  }

  /**
   * Deterministic given a deterministic DiceRoller.
   */
  rollInitiative(diceRoller: DiceRoller): number {
    return diceRoller.d20(this.getInitiativeModifier()).total;
  }

  // === Serialization ===

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      maxHP: this.maxHP,
      currentHP: this.currentHP,
      armorClass: this.getAC(),
      speed: this.speed,
      abilityScores: this.abilityScores.toJSON(),
      conditions: this.getConditions(),
      equipment: this.equipment,
      armorTraining: this.armorTraining,
    };
  }
}
