/**
 * Character Class
 * 
 * Represents a player character in D&D 5e.
 * Extends Creature with character-specific features like level, class, and experience.
 */

import { Creature, type CreatureData } from "./creature.js";
import type { SpeciesSaveAdvantage } from "./species.js";
import type { ResourcePool } from "../combat/resource-pool.js";
import { spendResource } from "../combat/resource-pool.js";
import type { CharacterClassId } from "../classes/class-definition.js";
import { isCharacterClassId } from "../classes/class-definition.js";
import { getClassDefinition } from "../classes/registry.js";
import { classHasFeature } from "../classes/registry.js";
import { UNARMORED_DEFENSE } from "../classes/feature-keys.js";
import { barbarianUnarmoredDefenseAC } from "../classes/barbarian.js";
import { monkUnarmoredDefenseAC } from "../classes/monk.js";
import type { RestType } from "../../rules/rest.js";
import { refreshClassResourcePools } from "../../rules/rest.js";
import { defaultResourcePoolsForClass } from "../../rules/class-resources.js";
import type { DiceRoller } from "../../rules/dice-roller.js";
import { maxHitPoints } from "../../rules/hit-points.js";
import { computeFeatModifiers } from "../../rules/feat-modifiers.js";
import type { FightingStyleId } from "../classes/fighting-style.js";
import { getFightingStyleFeatId } from "../classes/fighting-style.js";
import type { ASIChoice } from "../../rules/ability-score-improvement.js";
import { applyASIChoices, collectASIFeatIds } from "../../rules/ability-score-improvement.js";
import type { Skill } from "../core/skills.js";
import { computeSkillModifier } from "../core/skills.js";

export interface LevelUpOptions {
  hpMethod?: "average" | "roll";
  diceRoller?: DiceRoller;
}

function reconcileResourcePools(existing: readonly ResourcePool[], defaults: readonly ResourcePool[]): ResourcePool[] {
  const byName = new Map(existing.map((p) => [p.name, p] as const));

  return defaults.map((pool) => {
    const previous = byName.get(pool.name);
    if (!previous) {
      // Newly gained feature/resource: start full.
      return pool;
    }
    // Max may change with level; do not auto-refill current.
    return {
      ...pool,
      current: Math.min(previous.current, pool.max),
    };
  });
}

export interface CharacterData extends CreatureData {
  level: number;
  characterClass: string;
  background?: string;
  /**
   * Normalized class id used for mechanics.
   * If omitted, we will try to infer it from `characterClass`.
   */
  classId?: CharacterClassId;
  
  /**
   * Character subclass (e.g., "Open Hand" for Monk, "Champion" for Fighter).
   * Typically chosen at level 3 for most classes.
   */
  subclass?: string;
  
  /**
   * Level at which subclass was chosen (usually 3).
   */
  subclassLevel?: number;
  
  experiencePoints: number;

  /**
   * Class/feature resources tracked as generic pools (rage, ki, pactMagic, etc).
   */
  resourcePools?: readonly ResourcePool[];

  /**
   * Chosen feats by id (e.g. "feat_alert").
   */
  featIds?: readonly string[];

  /**
   * Chosen fighting style (e.g. "archery", "defense").
   * Granted by Fighter (level 1), Paladin (level 2), Ranger (level 2),
   * or the Fighting Initiate feat.
   */
  fightingStyle?: FightingStyleId;

  /**
   * Multi-class support: array of class entries with per-class levels.
   * When present, takes precedence over the single `characterClass` + `level` fields.
   * When absent, the character is single-class and classLevels is derived from the single fields.
   */
  classLevels?: Array<{ classId: string; level: number; subclass?: string }>;

  /**
   * Darkvision range in feet (0 means none). Typically from species traits.
   */
  darkvisionRange?: number;

  /**
   * Damage resistances from species traits (e.g. ["poison"] for Dwarf, ["fire"] for Tiefling).
   */
  speciesDamageResistances?: readonly string[];

  /**
   * Saving throw advantages from species traits (e.g. Elf: advantage vs charmed).
   */
  speciesSaveAdvantages?: readonly SpeciesSaveAdvantage[];

  /**
   * Ability Score Improvement choices applied at ASI levels (4, 8, 12, 16, 19, etc.).
   */
  asiChoices?: readonly ASIChoice[];

  /**
   * Skills the character is proficient in (e.g. ["athletics", "perception", "stealth"]).
   */
  skillProficiencies?: readonly string[];

  /**
   * Skills the character has expertise in (double proficiency, e.g. Rogue expertise).
   */
  skillExpertise?: readonly string[];

  /**
   * Spell IDs currently prepared (for prepared casters: Cleric, Druid, Paladin, Wizard).
   */
  preparedSpells?: readonly string[];

  /**
   * Spell IDs permanently known (for known casters: Bard, Ranger, Sorcerer, Warlock).
   */
  knownSpells?: readonly string[];
}

export class Character extends Creature {
  private level: number;
  private characterClass: string;
  private background?: string;
  private classId?: CharacterClassId;
  private subclass?: string;
  private subclassLevel?: number;
  private experiencePoints: number;
  private resourcePools: ResourcePool[];
  private featIds: string[];
  private fightingStyle?: FightingStyleId;
  private darkvisionRange: number;
  private speciesDamageResistances: string[];
  private speciesSaveAdvantages: readonly SpeciesSaveAdvantage[];
  private classLevelsData?: Array<{ classId: string; level: number; subclass?: string }>;
  private asiChoices: ASIChoice[];
  private skillProficiencies: string[];
  private skillExpertise: string[];
  private preparedSpells: string[];
  private knownSpells: string[];

  constructor(data: CharacterData) {
    super(data);
    this.level = data.level;
    this.characterClass = data.characterClass;
    this.background = data.background;
    this.classId = data.classId;
    this.subclass = data.subclass;
    this.subclassLevel = data.subclassLevel;
    if (!this.classId) {
      const normalized = data.characterClass.trim().toLowerCase();
      if (isCharacterClassId(normalized)) {
        this.classId = normalized;
      }
    }
    this.experiencePoints = data.experiencePoints;
    this.darkvisionRange = data.darkvisionRange ?? 0;
    this.speciesDamageResistances = data.speciesDamageResistances ? [...data.speciesDamageResistances] : [];
    this.speciesSaveAdvantages = data.speciesSaveAdvantages ?? [];
    if (data.resourcePools) {
      this.resourcePools = [...data.resourcePools];
    } else if (this.classId) {
      this.resourcePools = defaultResourcePoolsForClass({
        classId: this.classId,
        level: this.level,
        charismaModifier: this.getAbilityModifier("charisma"),
      });
    } else {
      this.resourcePools = [];
    }

    this.featIds = data.featIds ? [...data.featIds] : [];
    this.fightingStyle = data.fightingStyle;
    if (data.classLevels && data.classLevels.length > 0) {
      this.classLevelsData = [...data.classLevels];
    }
    this.asiChoices = data.asiChoices ? [...data.asiChoices] : [];
    this.skillProficiencies = data.skillProficiencies ? [...data.skillProficiencies] : [];
    this.skillExpertise = data.skillExpertise ? [...data.skillExpertise] : [];
    this.preparedSpells = data.preparedSpells ? [...data.preparedSpells] : [];
    this.knownSpells = data.knownSpells ? [...data.knownSpells] : [];
  }

  // === Getters ===

  getLevel(): number {
    return this.level;
  }

  /**
   * Returns the total character level (sum of all class levels for multiclass,
   * or the single level for single-class characters).
   */
  getTotalLevel(): number {
    if (this.classLevelsData && this.classLevelsData.length > 0) {
      return this.classLevelsData.reduce((sum, cl) => sum + cl.level, 0);
    }
    return this.level;
  }

  getClass(): string {
    return this.characterClass;
  }

  getBackground(): string | undefined {
    return this.background;
  }

  getClassId(): CharacterClassId | undefined {
    return this.classId;
  }

  /**
   * Returns the normalized class levels array.
   * For single-class characters, derives it from the single class fields.
   * For multi-class characters, returns the stored classLevels array.
   */
  getClassLevels(): Array<{ classId: string; level: number; subclass?: string }> {
    if (this.classLevelsData && this.classLevelsData.length > 0) {
      return [...this.classLevelsData];
    }
    const id = this.classId ?? this.characterClass?.toLowerCase();
    if (!id) return [];
    return [{ classId: id, level: this.level, ...(this.subclass ? { subclass: this.subclass } : {}) }];
  }

  getSubclass(): string | undefined {
    return this.subclass;
  }

  getSubclassLevel(): number | undefined {
    return this.subclassLevel;
  }

  getExperiencePoints(): number {
    return this.experiencePoints;
  }

  getResourcePools(): ResourcePool[] {
    return [...this.resourcePools];
  }

  getFeatIds(): readonly string[] {
    const ids = [...this.featIds];
    // Unify: fighting style grants an equivalent feat effect
    if (this.fightingStyle) {
      const fsFeatId = getFightingStyleFeatId(this.fightingStyle);
      if (fsFeatId && !ids.includes(fsFeatId)) {
        ids.push(fsFeatId);
      }
    }
    return ids;
  }

  getFightingStyle(): FightingStyleId | undefined {
    return this.fightingStyle;
  }

  getDarkvisionRange(): number {
    return this.darkvisionRange;
  }

  getSpeciesDamageResistances(): readonly string[] {
    return [...this.speciesDamageResistances];
  }

  getSpeciesSaveAdvantages(): readonly SpeciesSaveAdvantage[] {
    return this.speciesSaveAdvantages;
  }

  // === ASI ===

  getASIChoices(): readonly ASIChoice[] {
    return [...this.asiChoices];
  }

  /**
   * Return ability scores with ASI adjustments applied.
   */
  getEffectiveAbilityScores(): Record<string, number> {
    const base: Record<string, number> = { ...this.abilityScores.toJSON() };
    if (this.asiChoices.length === 0) return base;
    return applyASIChoices(base, this.asiChoices, this.level);
  }

  /**
   * Return feat IDs including those gained through ASI feat choices.
   */
  getAllFeatIds(): readonly string[] {
    const ids = [...this.getFeatIds()];
    const asiFeatIds = collectASIFeatIds(this.asiChoices, this.level);
    for (const fid of asiFeatIds) {
      if (!ids.includes(fid)) ids.push(fid);
    }
    return ids;
  }

  // === Skill Proficiencies ===

  getSkillProficiencies(): readonly string[] {
    return [...this.skillProficiencies];
  }

  getSkillExpertise(): readonly string[] {
    return [...this.skillExpertise];
  }

  /**
   * Compute the modifier for a skill check, accounting for proficiency and expertise.
   */
  getSkillModifier(skill: Skill): number {
    const scores: Record<string, number> = { ...this.abilityScores.toJSON() };
    return computeSkillModifier(
      scores,
      skill,
      this.getProficiencyBonus(),
      this.skillProficiencies,
      this.skillExpertise,
    );
  }

  // === Spell Preparation ===

  getPreparedSpells(): readonly string[] {
    return [...this.preparedSpells];
  }

  getKnownSpells(): readonly string[] {
    return [...this.knownSpells];
  }

  /**
   * Character damage resistances = base (from CreatureData) merged with species resistances.
   */
  override getDamageResistances(): readonly string[] {
    const base = super.getDamageResistances();
    if (this.speciesDamageResistances.length === 0) return base;
    if (base.length === 0) return [...this.speciesDamageResistances];
    return [...new Set([...base, ...this.speciesDamageResistances])];
  }

  canSpendResource(poolName: string, amount: number): boolean {
    if (!Number.isInteger(amount) || amount < 0) {
      return false;
    }
    const pool = this.resourcePools.find((p) => p.name === poolName);
    if (!pool) return false;
    return pool.current >= amount;
  }

  spendResource(poolName: string, amount: number): void {
    const index = this.resourcePools.findIndex((p) => p.name === poolName);
    if (index === -1) {
      throw new Error(`Unknown resource pool: ${poolName}`);
    }

    const updated = spendResource(this.resourcePools[index]!, amount);
    const next = [...this.resourcePools];
    next[index] = updated;
    this.resourcePools = next;
  }

  /**
   * Domain-level rest refresh. Uses deterministic class rules.
   */
  takeRest(rest: RestType): void {
    if (!this.classId) {
      return;
    }

    this.resourcePools = refreshClassResourcePools({
      classId: this.classId,
      level: this.level,
      rest,
      pools: this.resourcePools,
      charismaModifier: this.getAbilityModifier("charisma"),
    });
  }

  // === Proficiency Bonus ===

  getProficiencyBonus(): number {
    // D&D 5e proficiency bonus progression
    if (this.level <= 4) return 2;
    if (this.level <= 8) return 3;
    if (this.level <= 12) return 4;
    if (this.level <= 16) return 5;
    return 6;
  }

  // === Initiative ===

  override getInitiativeModifier(): number {
    const base = super.getInitiativeModifier();
    const mods = computeFeatModifiers(this.getFeatIds());
    if (!mods.initiativeAddProficiency) return base;
    return base + this.getProficiencyBonus();
  }

  // === Armor Class ===

  override getAC(): number {
    const wearingArmor = !!this.getEquipment()?.armor;
    const mods = computeFeatModifiers(this.getFeatIds());

    // Unarmored Defense: Barbarian (10 + DEX + CON) or Monk (10 + DEX + WIS)
    if (!wearingArmor && this.classId && classHasFeature(this.classId, UNARMORED_DEFENSE, this.level)) {
      let unarmoredAC: number | undefined;
      if (this.classId === "barbarian") {
        unarmoredAC = barbarianUnarmoredDefenseAC(
          this.getAbilityModifier("dexterity"),
          this.getAbilityModifier("constitution"),
        );
      } else if (this.classId === "monk") {
        unarmoredAC = monkUnarmoredDefenseAC(
          this.getAbilityModifier("dexterity"),
          this.getAbilityModifier("wisdom"),
        );
      }
      if (unarmoredAC !== undefined) {
        // Shield bonus applies on top of Unarmored Defense
        const shield = this.getEquipment()?.shield;
        const shieldBonus = shield && this.getArmorTraining().shield ? shield.armorClassBonus : 0;
        return unarmoredAC + shieldBonus;
      }
    }

    const ac = super.getAC();
    return wearingArmor && mods.armorClassBonusWhileArmored ? ac + mods.armorClassBonusWhileArmored : ac;
  }

  // === Experience & Leveling ===

  addExperience(amount: number): void {
    if (amount < 0) {
      throw new Error('Experience amount cannot be negative');
    }
    this.experiencePoints += amount;
  }

  levelUp(): void {
    this.levelUpWith();
  }

  levelUpWith(options: LevelUpOptions = {}): void {
    if (this.level >= 20) {
      throw new Error("Cannot level up beyond level 20");
    }

    const nextLevel = this.level + 1;

    // Recompute HP if class is known.
    if (this.classId) {
      const hitDie = getClassDefinition(this.classId).hitDie;
      const newMaxHP = maxHitPoints({
        level: nextLevel,
        hitDie,
        constitutionModifier: this.getAbilityModifier("constitution"),
        method: options.hpMethod ?? "average",
        diceRoller: options.diceRoller,
      });

      const delta = newMaxHP - this.maxHP;
      this.maxHP = newMaxHP;
      this.currentHP = Math.min(this.maxHP, this.currentHP + delta);

      // Recompute class resources for new level.
      const defaults = defaultResourcePoolsForClass({
        classId: this.classId,
        level: nextLevel,
        charismaModifier: this.getAbilityModifier("charisma"),
      });
      this.resourcePools = reconcileResourcePools(this.resourcePools, defaults);
    }

    this.level = nextLevel;
  }

  // === Serialization ===

  toJSON() {
    return {
      ...super.toJSON(),
      level: this.level,
      class: this.characterClass,
      ...(this.background ? { background: this.background } : {}),
      classId: this.classId,
      experiencePoints: this.experiencePoints,
      proficiencyBonus: this.getProficiencyBonus(),
      resourcePools: this.resourcePools,
      featIds: this.featIds,
      darkvisionRange: this.darkvisionRange,
      speciesDamageResistances: this.speciesDamageResistances,
      speciesSaveAdvantages: this.speciesSaveAdvantages,
      ...(this.classLevelsData ? { classLevels: this.classLevelsData } : {}),
      ...(this.asiChoices.length > 0 ? { asiChoices: this.asiChoices } : {}),
      ...(this.skillProficiencies.length > 0 ? { skillProficiencies: this.skillProficiencies } : {}),
      ...(this.skillExpertise.length > 0 ? { skillExpertise: this.skillExpertise } : {}),
      ...(this.preparedSpells.length > 0 ? { preparedSpells: this.preparedSpells } : {}),
      ...(this.knownSpells.length > 0 ? { knownSpells: this.knownSpells } : {}),
    };
  }
}
