import { describe, expect, it } from "vitest";

import type { WildShapeBeastStatBlock } from "../../../../domain/entities/classes/druid.js";
import {
  routeDamageThroughWildShapeForm,
  removeWildShapeForm,
  createWildShapeFormState,
  getWildShapeForm,
  applyWildShapeForm,
  projectCombatVitalsWithWildShape,
  projectArmorClassWithWildShape,
  projectAttacksWithWildShape,
} from "./wild-shape-form-helper.js";

describe("wild-shape-form-helper", () => {
  const beast: WildShapeBeastStatBlock = {
    form: "Beast of the Land",
    ac: 13,
    hp: 10,
    speed: "30 ft., climb 30 ft.",
    attackBonus: 5,
    damage: "1d8",
    multiattack: false,
  };

  it("creates structured wild-shape form state", () => {
    const form = createWildShapeFormState("Beast of the Land", beast, "druid-1", 2);

    expect(form.formName).toBe("Beast of the Land");
    expect(form.maxHp).toBe(10);
    expect(form.hpRemainingInForm).toBe(10);
    expect(form.armorClass).toBe(13);
    expect(form.speedFeet).toBe(30);
    expect(form.attacks[0]?.attackBonus).toBe(5);
    expect(form.attacks[0]?.damage).toEqual({ diceCount: 1, diceSides: 8, modifier: 0 });
  });

  it("applies damage to form pool without spillover while form is active", () => {
    const form = createWildShapeFormState("Beast of the Land", beast, "druid-1", 1);
    const resources = applyWildShapeForm({ resourcePools: [] }, form);

    const result = routeDamageThroughWildShapeForm(resources, 4);
    const updatedForm = getWildShapeForm(result.updatedResources);

    expect(result.formBroken).toBe(false);
    expect(result.absorbedByForm).toBe(4);
    expect(result.spilloverDamage).toBe(0);
    expect(updatedForm?.hpRemainingInForm).toBe(6);
  });

  it("breaks form and returns spillover damage when incoming damage exceeds form HP", () => {
    const form = createWildShapeFormState("Beast of the Land", beast, "druid-1", 1);
    const resources = applyWildShapeForm({ resourcePools: [] }, form);

    const result = routeDamageThroughWildShapeForm(resources, 14);

    expect(result.formBroken).toBe(true);
    expect(result.absorbedByForm).toBe(10);
    expect(result.spilloverDamage).toBe(4);
    expect(getWildShapeForm(result.updatedResources)).toBeNull();
  });

  it("clears form object and removes wild shape active effect", () => {
    const cleared = removeWildShapeForm({
      wildShapeForm: { foo: "bar" },
      activeEffects: [{ source: "Wild Shape", type: "custom", target: "custom", duration: "permanent" }],
    });

    const rec = cleared as Record<string, unknown>;
    expect(rec.wildShapeForm).toBeUndefined();

    const effects = (rec.activeEffects as Array<Record<string, unknown>> | undefined) ?? [];
    expect(effects.some((e) => e.source === "Wild Shape")).toBe(false);
  });

  it("projects combat vitals when transformed", () => {
    const form = createWildShapeFormState("Beast of the Land", beast, "druid-1", 1);
    const resources = applyWildShapeForm({ resourcePools: [] }, form);

    const projected = projectCombatVitalsWithWildShape(resources, {
      maxHP: 20,
      currentHP: 20,
      armorClass: 11,
      speed: 35,
    });

    expect(projected).toEqual({
      maxHP: 10,
      currentHP: 10,
      armorClass: 13,
      speed: 30,
    });
  });

  it("projects armor class and attacks when transformed", () => {
    const form = createWildShapeFormState("Beast of the Land", beast, "druid-1", 1);
    const resources = applyWildShapeForm({ resourcePools: [] }, form);

    expect(projectArmorClassWithWildShape(resources, 10)).toBe(13);

    const attacks = projectAttacksWithWildShape(resources, [{ name: "Longsword" }]);
    expect(Array.isArray(attacks)).toBe(true);
    expect((attacks as Array<Record<string, unknown>>)[0]?.name).toBe("Bestial Strike");
    expect((attacks as Array<Record<string, unknown>>)[0]?.equipped).toBe(true);
  });
});
