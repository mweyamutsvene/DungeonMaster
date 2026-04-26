import { describe, expect, it } from "vitest";
import { computeInitiativeModifiers, computeInitiativeRollMode } from "./tabletop-utils.js";

describe("tabletop-utils initiative modifiers", () => {
  it("clears party-surprise disadvantage for Alert holders", () => {
    const modifiers = computeInitiativeModifiers(
      "char-alert",
      "party",
      "party",
      [],
      undefined,
      ["feat_alert"],
    );

    expect(modifiers).toEqual({ advantage: false, disadvantage: false });
    expect(
      computeInitiativeRollMode(
        "char-alert",
        "party",
        "party",
        [],
        undefined,
        ["feat_alert"],
      ),
    ).toBe("normal");
  });

  it("keeps non-surprise disadvantage sources even with Alert", () => {
    const modifiers = computeInitiativeModifiers(
      "char-alert",
      "party",
      "party",
      ["Incapacitated"],
      undefined,
      ["feat_alert"],
    );

    expect(modifiers).toEqual({ advantage: false, disadvantage: true });
  });
});
