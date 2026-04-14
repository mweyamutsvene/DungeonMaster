import { describe, expect, it } from "vitest";
import { getSpeciesTraits, getAllSpecies } from "./species-registry.js";

describe("species-registry", () => {
  describe("getSpeciesTraits", () => {
    it("returns Elf with darkvision 60ft and Fey Ancestry", () => {
      const elf = getSpeciesTraits("Elf");
      expect(elf).toBeDefined();
      expect(elf!.darkvisionRange).toBe(60);
      expect(elf!.saveAdvantages).toEqual([{ againstCondition: "charmed" }]);
    });

    it("returns Dwarf with poison resistance and advantage on poison saves", () => {
      const dwarf = getSpeciesTraits("Dwarf");
      expect(dwarf).toBeDefined();
      expect(dwarf!.damageResistances).toEqual(["poison"]);
      expect(dwarf!.saveAdvantages).toEqual([{ againstCondition: "poisoned" }]);
      expect(dwarf!.darkvisionRange).toBe(60);
    });

    it("returns Human with no darkvision and no resistances", () => {
      const human = getSpeciesTraits("Human");
      expect(human).toBeDefined();
      expect(human!.darkvisionRange).toBe(0);
      expect(human!.damageResistances).toEqual([]);
      expect(human!.saveAdvantages).toEqual([]);
    });

    it("returns Halfling with Brave (advantage vs frightened)", () => {
      const halfling = getSpeciesTraits("Halfling");
      expect(halfling).toBeDefined();
      expect(halfling!.saveAdvantages).toEqual([{ againstCondition: "frightened" }]);
      expect(halfling!.darkvisionRange).toBe(0);
    });

    it("returns Dragonborn with darkvision 60ft", () => {
      const db = getSpeciesTraits("Dragonborn");
      expect(db).toBeDefined();
      expect(db!.darkvisionRange).toBe(60);
    });

    it("returns Gnome with Gnome Cunning", () => {
      const gnome = getSpeciesTraits("Gnome");
      expect(gnome).toBeDefined();
      expect(gnome!.darkvisionRange).toBe(60);
      expect(gnome!.saveAdvantages).toEqual([
        { abilities: ["intelligence", "wisdom", "charisma"], qualifier: "magic" },
      ]);
    });

    it("returns Orc with darkvision 120ft", () => {
      const orc = getSpeciesTraits("Orc");
      expect(orc).toBeDefined();
      expect(orc!.darkvisionRange).toBe(120);
    });

    it("returns Tiefling with fire resistance", () => {
      const tiefling = getSpeciesTraits("Tiefling");
      expect(tiefling).toBeDefined();
      expect(tiefling!.damageResistances).toEqual(["fire"]);
      expect(tiefling!.darkvisionRange).toBe(60);
    });

    it("is case-insensitive", () => {
      expect(getSpeciesTraits("elf")).toBeDefined();
      expect(getSpeciesTraits("ELF")).toBeDefined();
      expect(getSpeciesTraits("  Dwarf  ")).toBeDefined();
    });

    it("returns undefined for unknown species", () => {
      expect(getSpeciesTraits("Kenku")).toBeUndefined();
    });

    it("resolves Half-Orc alias to Orc traits", () => {
      const halfOrc = getSpeciesTraits("Half-Orc");
      expect(halfOrc).toBeDefined();
      expect(halfOrc!.darkvisionRange).toBe(120);
    });

    it("resolves Half-Elf alias to Elf traits", () => {
      const halfElf = getSpeciesTraits("Half-Elf");
      expect(halfElf).toBeDefined();
      expect(halfElf!.darkvisionRange).toBe(60);
      expect(halfElf!.saveAdvantages).toEqual([{ againstCondition: "charmed" }]);
    });
  });

  describe("getAllSpecies", () => {
    it("returns all 10 base species", () => {
      const all = getAllSpecies();
      expect(all.length).toBe(10);
      const names = all.map((s) => s.name);
      expect(names).toContain("Human");
      expect(names).toContain("Elf");
      expect(names).toContain("Dwarf");
      expect(names).toContain("Halfling");
      expect(names).toContain("Dragonborn");
      expect(names).toContain("Gnome");
      expect(names).toContain("Orc");
      expect(names).toContain("Tiefling");
      expect(names).toContain("Aasimar");
      expect(names).toContain("Goliath");
    });
  });
});
