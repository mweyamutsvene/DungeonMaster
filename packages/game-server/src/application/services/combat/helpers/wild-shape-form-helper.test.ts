import { describe, expect, it } from "vitest";

import type { WildShapeBeastStatBlock } from "../../../../domain/entities/classes/druid.js";
import {
  applyDamageToWildShapeForm,
  clearWildShapeForm,
  createWildShapeFormState,
  readWildShapeForm,
  withWildShapeForm,
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
    const resources = withWildShapeForm({ resourcePools: [] }, form);

    const result = applyDamageToWildShapeForm(resources, 4);
    const updatedForm = readWildShapeForm(result.updatedResources);

    expect(result.formBroken).toBe(false);
    expect(result.absorbedByForm).toBe(4);
    expect(result.spilloverDamage).toBe(0);
    expect(updatedForm?.hpRemainingInForm).toBe(6);
  });

  it("breaks form and returns spillover damage when incoming damage exceeds form HP", () => {
    const form = createWildShapeFormState("Beast of the Land", beast, "druid-1", 1);
    const resources = withWildShapeForm({ resourcePools: [] }, form);

    const result = applyDamageToWildShapeForm(resources, 14);

    expect(result.formBroken).toBe(true);
    expect(result.absorbedByForm).toBe(10);
    expect(result.spilloverDamage).toBe(4);
    expect(readWildShapeForm(result.updatedResources)).toBeNull();
  });

  it("clears form object and legacy wild-shape keys", () => {
    const cleared = clearWildShapeForm({
      wildShapeActive: true,
      wildShapeForm: { foo: "bar" },
      tempHp: 10,
      wildShapeHp: 10,
      wildShapeHpMax: 10,
      wildShapeAc: 13,
      wildShapeAttackBonus: 5,
      wildShapeDamage: "1d8",
      wildShapeMultiattack: false,
      wildShapeSpeed: "30 ft",
      activeEffects: [{ source: "Wild Shape", type: "custom", target: "custom", duration: "permanent" }],
    });

    const rec = cleared as Record<string, unknown>;
    expect(rec.wildShapeActive).toBeUndefined();
    expect(rec.wildShapeForm).toBeUndefined();
    expect(rec.tempHp).toBeUndefined();

    const effects = (rec.activeEffects as Array<Record<string, unknown>> | undefined) ?? [];
    expect(effects.some((e) => e.source === "Wild Shape")).toBe(false);
  });
});
