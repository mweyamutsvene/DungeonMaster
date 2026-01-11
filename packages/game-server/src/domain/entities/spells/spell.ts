export type SpellSchool =
  | "Abjuration"
  | "Conjuration"
  | "Divination"
  | "Enchantment"
  | "Evocation"
  | "Illusion"
  | "Necromancy"
  | "Transmutation"
  | "Other";

export interface SpellData {
  id: string;
  name: string;
  level: number;
  school?: SpellSchool;
  ritual?: boolean;

  // Opaque payload for later stages (e.g., DB-derived definition JSON).
  data?: unknown;
}

export class Spell {
  private readonly id: string;
  private readonly name: string;
  private readonly level: number;
  private readonly school: SpellSchool;
  private readonly ritual: boolean;
  private readonly data?: unknown;

  public constructor(spell: SpellData) {
    if (!spell.id) throw new Error("Spell id is required");
    if (!spell.name) throw new Error("Spell name is required");
    if (!Number.isInteger(spell.level) || spell.level < 0 || spell.level > 9) {
      throw new Error("Spell level must be an integer between 0 and 9");
    }

    this.id = spell.id;
    this.name = spell.name;
    this.level = spell.level;
    this.school = spell.school ?? "Other";
    this.ritual = spell.ritual ?? false;
    this.data = spell.data;
  }

  public getId(): string {
    return this.id;
  }

  public getName(): string {
    return this.name;
  }

  public getLevel(): number {
    return this.level;
  }

  public getSchool(): SpellSchool {
    return this.school;
  }

  public isRitual(): boolean {
    return this.ritual;
  }

  public getData(): unknown {
    return this.data;
  }
}
