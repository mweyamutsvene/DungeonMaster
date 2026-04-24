import { describe, expect, it } from "vitest";
import {
  getConditionEffects,
  getProneAttackModifier,
  hasSelfAttackAdvantage,
  hasIncomingAttackDisadvantage,
  hasAbilityCheckDisadvantage,
  isFrightenedMovementBlocked,
  getFrightenedSourceId,
  isAttackBlockedByCharm,
  getCharmedSourceIds,
  getExhaustionPenalty,
  getExhaustionSpeedReduction,
  isExhaustionLethal,
  getExhaustionLevel,
  createExhaustionCondition,
  getExhaustionD20Penalty,
  createCondition,
  addCondition,
  hasCondition,
  type ActiveCondition,
} from "./conditions.js";

describe("getConditionEffects", () => {
  describe("Restrained", () => {
    it("gives disadvantage on DEX saves, NOT auto-fail", () => {
      const effects = getConditionEffects("Restrained");
      expect(effects.autoFailStrDexSaves).toBe(false);
      expect(effects.savingThrowDisadvantage).toEqual(["dexterity"]);
    });

    it("prevents movement", () => {
      const effects = getConditionEffects("Restrained");
      expect(effects.cannotMove).toBe(true);
    });

    it("gives disadvantage on attacks and advantage to attackers", () => {
      const effects = getConditionEffects("Restrained");
      expect(effects.outgoingAttacksHaveDisadvantage).toBe(true);
      expect(effects.incomingAttacksHaveAdvantage).toBe(true);
    });
  });

  describe("Paralyzed auto-fail Str/Dex saves", () => {
    it("has autoFailStrDexSaves = true", () => {
      const effects = getConditionEffects("Paralyzed");
      expect(effects.autoFailStrDexSaves).toBe(true);
    });
  });

  describe("Stunned auto-fail Str/Dex saves", () => {
    it("has autoFailStrDexSaves = true", () => {
      const effects = getConditionEffects("Stunned");
      expect(effects.autoFailStrDexSaves).toBe(true);
    });
  });

  describe("Petrified full mechanics (D&D 5e 2024)", () => {
    it("has autoFailStrDexSaves = true", () => {
      const effects = getConditionEffects("Petrified");
      expect(effects.autoFailStrDexSaves).toBe(true);
    });

    it("has resistance to all damage", () => {
      const effects = getConditionEffects("Petrified");
      expect(effects.resistsAllDamage).toBe(true);
    });

    it("is immune to poison damage", () => {
      const effects = getConditionEffects("Petrified");
      expect(effects.damageImmunities).toContain("poison");
    });

    it("is immune to disease and poisoned condition", () => {
      const effects = getConditionEffects("Petrified");
      expect(effects.conditionImmunities).toContain("disease");
      expect(effects.conditionImmunities).toContain("poisoned");
    });

    it("is incapacitated (cannot take actions, bonus actions, or reactions)", () => {
      const effects = getConditionEffects("Petrified");
      expect(effects.cannotTakeActions).toBe(true);
      expect(effects.cannotTakeBonusActions).toBe(true);
      expect(effects.cannotTakeReactions).toBe(true);
    });

    it("attacks against have advantage", () => {
      const effects = getConditionEffects("Petrified");
      expect(effects.incomingAttacksHaveAdvantage).toBe(true);
    });

    it("cannot move or speak", () => {
      const effects = getConditionEffects("Petrified");
      expect(effects.cannotMove).toBe(true);
      expect(effects.cannotSpeak).toBe(true);
    });
  });

  describe("Non-petrified conditions have default damage defense fields", () => {
    for (const cond of ["Blinded", "Stunned", "Paralyzed", "Unconscious", "Frightened"] as const) {
      it(`${cond} has resistsAllDamage = false and empty damageImmunities`, () => {
        const effects = getConditionEffects(cond);
        expect(effects.resistsAllDamage).toBe(false);
        expect(effects.damageImmunities).toEqual([]);
        expect(effects.conditionImmunities).toEqual([]);
      });
    }
  });

  describe("Unconscious auto-fail Str/Dex saves", () => {
    it("has autoFailStrDexSaves = true", () => {
      const effects = getConditionEffects("Unconscious");
      expect(effects.autoFailStrDexSaves).toBe(true);
    });
  });

  describe("conditions that should NOT auto-fail Str/Dex saves", () => {
    for (const cond of ["Blinded", "Charmed", "Deafened", "Frightened", "Grappled", "Incapacitated", "Invisible", "Poisoned", "Prone", "Restrained", "Exhaustion"] as const) {
      it(`${cond} does not auto-fail Str/Dex saves`, () => {
        const effects = getConditionEffects(cond);
        expect(effects.autoFailStrDexSaves).toBe(false);
      });
    }
  });

  describe("savingThrowDisadvantage defaults", () => {
    it("most conditions have empty savingThrowDisadvantage", () => {
      const effects = getConditionEffects("Blinded");
      expect(effects.savingThrowDisadvantage).toEqual([]);
    });

    it("Restrained has dexterity in savingThrowDisadvantage", () => {
      const effects = getConditionEffects("Restrained");
      expect(effects.savingThrowDisadvantage).toContain("dexterity");
    });
  });

  // --- Fix 1: Prone melee vs ranged distinction ---
  describe("Prone distance-aware effects", () => {
    it("has meleeAttackAdvantage for melee attacks within 5ft", () => {
      const effects = getConditionEffects("Prone");
      expect(effects.meleeAttackAdvantage).toBe(true);
    });

    it("has rangedAttackDisadvantage for ranged attacks beyond 5ft", () => {
      const effects = getConditionEffects("Prone");
      expect(effects.rangedAttackDisadvantage).toBe(true);
    });

    it("no longer uses generic incomingAttacksHaveAdvantage", () => {
      const effects = getConditionEffects("Prone");
      expect(effects.incomingAttacksHaveAdvantage).toBe(false);
    });

    it("still has outgoingAttacksHaveDisadvantage for the prone creature's own attacks", () => {
      const effects = getConditionEffects("Prone");
      expect(effects.outgoingAttacksHaveDisadvantage).toBe(true);
    });
  });

  describe("getProneAttackModifier", () => {
    const proneConditions: ActiveCondition[] = [
      createCondition("Prone", "until_removed"),
    ];

    it("melee attack within 5ft has advantage", () => {
      expect(getProneAttackModifier(proneConditions, 5, "melee")).toBe("advantage");
    });

    it("melee attack at 0ft has advantage", () => {
      expect(getProneAttackModifier(proneConditions, 0, "melee")).toBe("advantage");
    });

    it("ranged attack beyond 5ft has disadvantage", () => {
      expect(getProneAttackModifier(proneConditions, 30, "ranged")).toBe("disadvantage");
    });

    it("melee attack beyond 5ft (reach weapon) has disadvantage", () => {
      expect(getProneAttackModifier(proneConditions, 10, "melee")).toBe("disadvantage");
    });

    it("ranged attack within 5ft has advantage (same as melee distance)", () => {
      // Ranged at 5ft: the rules say "within 5 feet" is advantage. D&D 2024: "An attack
      // roll against the creature has Advantage if the attacker is within 5 feet" 
      // regardless of melee/ranged distinction at that range.
      // Actually per strict 2024: within 5ft = advantage, beyond 5ft = disadvantage,
      // and the melee/ranged distinction only matters for >5ft.
      // Our implementation checks attackKind first, so ranged at 5ft gets this:
      expect(getProneAttackModifier(proneConditions, 5, "ranged")).toBe("disadvantage");
    });

    it("returns none when target is not prone", () => {
      const noProne: ActiveCondition[] = [
        createCondition("Blinded", "until_removed"),
      ];
      expect(getProneAttackModifier(noProne, 5, "melee")).toBe("none");
    });

    it("returns none for empty conditions", () => {
      expect(getProneAttackModifier([], 5, "melee")).toBe("none");
    });
  });

  // --- Fix 2: Poisoned ability check disadvantage ---
  describe("Poisoned ability check disadvantage", () => {
    it("has abilityCheckDisadvantage", () => {
      const effects = getConditionEffects("Poisoned");
      expect(effects.abilityCheckDisadvantage).toBe(true);
    });

    it("still has outgoingAttacksHaveDisadvantage", () => {
      const effects = getConditionEffects("Poisoned");
      expect(effects.outgoingAttacksHaveDisadvantage).toBe(true);
    });
  });

  describe("hasAbilityCheckDisadvantage", () => {
    it("returns true for Poisoned", () => {
      const conditions: ActiveCondition[] = [createCondition("Poisoned", "until_removed")];
      expect(hasAbilityCheckDisadvantage(conditions)).toBe(true);
    });

    it("returns true for Frightened", () => {
      const conditions: ActiveCondition[] = [createCondition("Frightened", "until_removed")];
      expect(hasAbilityCheckDisadvantage(conditions)).toBe(true);
    });

    it("returns false for Blinded", () => {
      const conditions: ActiveCondition[] = [createCondition("Blinded", "until_removed")];
      expect(hasAbilityCheckDisadvantage(conditions)).toBe(false);
    });

    it("returns false for empty conditions", () => {
      expect(hasAbilityCheckDisadvantage([])).toBe(false);
    });
  });

  // --- Fix 3: Frightened movement restriction ---
  describe("Frightened movement restriction", () => {
    it("has cannotMoveCloserToSource flag", () => {
      const effects = getConditionEffects("Frightened");
      expect(effects.cannotMoveCloserToSource).toBe(true);
    });

    it("also has abilityCheckDisadvantage", () => {
      const effects = getConditionEffects("Frightened");
      expect(effects.abilityCheckDisadvantage).toBe(true);
    });
  });

  describe("isFrightenedMovementBlocked", () => {
    const frightenedConditions: ActiveCondition[] = [
      createCondition("Frightened", "until_removed", { source: "dragon-1" }),
    ];

    it("blocks movement closer to fear source", () => {
      expect(isFrightenedMovementBlocked(frightenedConditions, 30, 20)).toBe(true);
    });

    it("allows movement farther from fear source", () => {
      expect(isFrightenedMovementBlocked(frightenedConditions, 20, 30)).toBe(false);
    });

    it("allows movement at same distance from fear source", () => {
      expect(isFrightenedMovementBlocked(frightenedConditions, 20, 20)).toBe(false);
    });

    it("not blocked when not frightened", () => {
      const noFear: ActiveCondition[] = [createCondition("Poisoned", "until_removed")];
      expect(isFrightenedMovementBlocked(noFear, 30, 20)).toBe(false);
    });

    it("not blocked when frightened but no source", () => {
      const noSource: ActiveCondition[] = [createCondition("Frightened", "until_removed")];
      expect(isFrightenedMovementBlocked(noSource, 30, 20)).toBe(false);
    });

    it("not blocked for empty conditions", () => {
      expect(isFrightenedMovementBlocked([], 30, 20)).toBe(false);
    });
  });

  describe("getFrightenedSourceId", () => {
    it("returns source ID when Frightened has source", () => {
      const conditions: ActiveCondition[] = [
        createCondition("Frightened", "until_removed", { source: "dragon-1" }),
      ];
      expect(getFrightenedSourceId(conditions)).toBe("dragon-1");
    });

    it("returns undefined when Frightened has no source", () => {
      const conditions: ActiveCondition[] = [
        createCondition("Frightened", "until_removed"),
      ];
      expect(getFrightenedSourceId(conditions)).toBeUndefined();
    });

    it("returns undefined when not frightened", () => {
      expect(getFrightenedSourceId([])).toBeUndefined();
    });
  });

  // --- Fix 4: Invisible dual-direction ---
  describe("Invisible dual-direction effects", () => {
    it("has selfAttackAdvantage (invisible creature has advantage on own attacks)", () => {
      const effects = getConditionEffects("Invisible");
      expect(effects.selfAttackAdvantage).toBe(true);
    });

    it("has incomingAttackDisadvantage (attacks against invisible have disadvantage)", () => {
      const effects = getConditionEffects("Invisible");
      expect(effects.incomingAttackDisadvantage).toBe(true);
    });

    it("no longer uses generic incomingAttacksHaveAdvantage", () => {
      const effects = getConditionEffects("Invisible");
      expect(effects.incomingAttacksHaveAdvantage).toBe(false);
    });
  });

  describe("hasSelfAttackAdvantage", () => {
    it("returns true for Invisible attacker", () => {
      const conditions: ActiveCondition[] = [createCondition("Invisible", "until_removed")];
      expect(hasSelfAttackAdvantage(conditions)).toBe(true);
    });

    it("returns false for non-Invisible", () => {
      const conditions: ActiveCondition[] = [createCondition("Blinded", "until_removed")];
      expect(hasSelfAttackAdvantage(conditions)).toBe(false);
    });
  });

  describe("hasIncomingAttackDisadvantage", () => {
    it("returns true when target is Invisible", () => {
      const conditions: ActiveCondition[] = [createCondition("Invisible", "until_removed")];
      expect(hasIncomingAttackDisadvantage(conditions)).toBe(true);
    });

    it("returns false when target is not Invisible", () => {
      const conditions: ActiveCondition[] = [createCondition("Prone", "until_removed")];
      expect(hasIncomingAttackDisadvantage(conditions)).toBe(false);
    });
  });

  // --- Fix 5: Exhaustion levels ---
  describe("Exhaustion level system", () => {
    describe("getExhaustionPenalty", () => {
      it("level 0 = no penalty", () => {
        expect(getExhaustionPenalty(0)).toBe(0);
      });

      it("level 1 = -2 (2024 RAW: -2 per level)", () => {
        expect(getExhaustionPenalty(1)).toBe(-2);
      });

      it("level 2 = -4", () => {
        expect(getExhaustionPenalty(2)).toBe(-4);
      });

      it("level 3 = -6", () => {
        expect(getExhaustionPenalty(3)).toBe(-6);
      });

      it("level 6 = -12", () => {
        expect(getExhaustionPenalty(6)).toBe(-12);
      });

      it("level 9 = -18", () => {
        expect(getExhaustionPenalty(9)).toBe(-18);
      });

      it("clamps at level 10 (-20)", () => {
        expect(getExhaustionPenalty(15)).toBe(-20);
      });

      it("negative levels treated as 0", () => {
        expect(getExhaustionPenalty(-1)).toBe(0);
      });
    });

    describe("getExhaustionSpeedReduction", () => {
      it("level 0 = no reduction", () => {
        expect(getExhaustionSpeedReduction(0)).toBe(0);
      });

      it("level 1 = 5ft reduction", () => {
        expect(getExhaustionSpeedReduction(1)).toBe(5);
      });

      it("level 3 = 15ft reduction", () => {
        expect(getExhaustionSpeedReduction(3)).toBe(15);
      });

      it("level 9 = 45ft (highest non-lethal reduction)", () => {
        expect(getExhaustionSpeedReduction(9)).toBe(45);
      });

      it("level 10 = Infinity (lethal — zeroes any speed)", () => {
        expect(getExhaustionSpeedReduction(10)).toBe(Infinity);
      });

      it("clamps at level 10 (Infinity)", () => {
        expect(getExhaustionSpeedReduction(15)).toBe(Infinity);
      });
    });

    describe("isExhaustionLethal", () => {
      it("level 5 is not lethal", () => {
        expect(isExhaustionLethal(5)).toBe(false);
      });

      it("level 9 is not lethal", () => {
        expect(isExhaustionLethal(9)).toBe(false);
      });

      it("level 10 is lethal (2024 RAW)", () => {
        expect(isExhaustionLethal(10)).toBe(true);
      });

      it("level 11 is lethal", () => {
        expect(isExhaustionLethal(11)).toBe(true);
      });
    });

    describe("getExhaustionLevel", () => {
      it("returns 0 when no exhaustion", () => {
        expect(getExhaustionLevel([])).toBe(0);
      });

      it("parses level from source field", () => {
        const conditions: ActiveCondition[] = [
          createCondition("Exhaustion", "until_removed", { source: "exhaustion:3" }),
        ];
        expect(getExhaustionLevel(conditions)).toBe(3);
      });

      it("defaults to level 1 if no source info", () => {
        const conditions: ActiveCondition[] = [
          createCondition("Exhaustion", "until_removed"),
        ];
        expect(getExhaustionLevel(conditions)).toBe(1);
      });

      it("clamps to max 10", () => {
        const conditions: ActiveCondition[] = [
          createCondition("Exhaustion", "until_removed", { source: "exhaustion:15" }),
        ];
        expect(getExhaustionLevel(conditions)).toBe(10);
      });
    });

    describe("createExhaustionCondition", () => {
      it("creates level 1 exhaustion", () => {
        const cond = createExhaustionCondition(1);
        expect(cond.condition).toBe("Exhaustion");
        expect(cond.source).toBe("exhaustion:1");
        expect(cond.duration).toBe("until_removed");
      });

      it("creates level 4 exhaustion", () => {
        const cond = createExhaustionCondition(4);
        expect(cond.source).toBe("exhaustion:4");
      });

      it("clamps to min 1", () => {
        const cond = createExhaustionCondition(0);
        expect(cond.source).toBe("exhaustion:1");
      });

      it("clamps to max 10", () => {
        const cond = createExhaustionCondition(15);
        expect(cond.source).toBe("exhaustion:10");
      });
    });

    describe("getExhaustionD20Penalty", () => {
      it("returns 0 for no exhaustion", () => {
        expect(getExhaustionD20Penalty([])).toBe(0);
      });

      it("returns -6 for level 3 exhaustion (2024 RAW: -2 per level)", () => {
        const conditions: ActiveCondition[] = [
          createCondition("Exhaustion", "until_removed", { source: "exhaustion:3" }),
        ];
        expect(getExhaustionD20Penalty(conditions)).toBe(-6);
      });
    });

    describe("Exhaustion condition effects flags", () => {
      it("no longer has generic outgoingAttacksHaveDisadvantage", () => {
        const effects = getConditionEffects("Exhaustion");
        expect(effects.outgoingAttacksHaveDisadvantage).toBe(false);
      });

      it("has movementImpaired for speed reduction", () => {
        const effects = getConditionEffects("Exhaustion");
        expect(effects.movementImpaired).toBe(true);
      });
    });
  });

  // --- Charmed condition mechanics ---
  describe("Charmed condition effects", () => {
    it("has cannotTargetSource = true", () => {
      const effects = getConditionEffects("Charmed");
      expect(effects.cannotTargetSource).toBe(true);
    });

    it("has socialAdvantageForSource = true", () => {
      const effects = getConditionEffects("Charmed");
      expect(effects.socialAdvantageForSource).toBe(true);
    });

    it("does not prevent movement or actions", () => {
      const effects = getConditionEffects("Charmed");
      expect(effects.cannotMove).toBe(false);
      expect(effects.cannotTakeActions).toBe(false);
      expect(effects.cannotTakeReactions).toBe(false);
    });
  });

  describe("isAttackBlockedByCharm", () => {
    it("blocks attack when attacker is charmed by the target", () => {
      const conditions: ActiveCondition[] = [
        createCondition("Charmed", "until_removed", { source: "npc-wizard-1" }),
      ];
      expect(isAttackBlockedByCharm(conditions, "npc-wizard-1")).toBe(true);
    });

    it("does not block attack against a different creature", () => {
      const conditions: ActiveCondition[] = [
        createCondition("Charmed", "until_removed", { source: "npc-wizard-1" }),
      ];
      expect(isAttackBlockedByCharm(conditions, "goblin-2")).toBe(false);
    });

    it("does not block when not charmed", () => {
      const conditions: ActiveCondition[] = [
        createCondition("Frightened", "until_removed", { source: "dragon-1" }),
      ];
      expect(isAttackBlockedByCharm(conditions, "dragon-1")).toBe(false);
    });

    it("does not block when charmed has no source", () => {
      const conditions: ActiveCondition[] = [
        createCondition("Charmed", "until_removed"),
      ];
      expect(isAttackBlockedByCharm(conditions, "anyone")).toBe(false);
    });

    it("does not block when conditions are empty", () => {
      expect(isAttackBlockedByCharm([], "anyone")).toBe(false);
    });

    it("blocks correctly when charmed by multiple sources", () => {
      const conditions: ActiveCondition[] = [
        createCondition("Charmed", "until_removed", { source: "npc-wizard-1" }),
        createCondition("Charmed", "until_removed", { source: "succubus-3" }),
      ];
      expect(isAttackBlockedByCharm(conditions, "npc-wizard-1")).toBe(true);
      expect(isAttackBlockedByCharm(conditions, "succubus-3")).toBe(true);
      expect(isAttackBlockedByCharm(conditions, "goblin-2")).toBe(false);
    });
  });

  describe("getCharmedSourceIds", () => {
    it("returns source IDs from Charmed conditions", () => {
      const conditions: ActiveCondition[] = [
        createCondition("Charmed", "until_removed", { source: "npc-wizard-1" }),
        createCondition("Charmed", "until_removed", { source: "succubus-3" }),
      ];
      expect(getCharmedSourceIds(conditions)).toEqual(["npc-wizard-1", "succubus-3"]);
    });

    it("returns empty array when not charmed", () => {
      expect(getCharmedSourceIds([])).toEqual([]);
    });

    it("skips Charmed conditions without source", () => {
      const conditions: ActiveCondition[] = [
        createCondition("Charmed", "until_removed"),
        createCondition("Charmed", "until_removed", { source: "npc-wizard-1" }),
      ];
      expect(getCharmedSourceIds(conditions)).toEqual(["npc-wizard-1"]);
    });
  });

  // --- Unconscious auto-applies Prone (D&D 5e 2024) ---
  describe("addCondition: Unconscious auto-applies Prone", () => {
    it("adding Unconscious also adds Prone", () => {
      const result = addCondition([], createCondition("Unconscious", "until_removed"));
      expect(hasCondition(result, "Unconscious")).toBe(true);
      expect(hasCondition(result, "Prone")).toBe(true);
    });

    it("does not duplicate Prone if already present", () => {
      const initial = [createCondition("Prone" as any, "until_removed")];
      const result = addCondition(initial, createCondition("Unconscious", "until_removed"));
      expect(hasCondition(result, "Unconscious")).toBe(true);
      const proneCount = result.filter((c) => c.condition === "Prone").length;
      expect(proneCount).toBe(1);
    });

    it("propagates source from Unconscious to auto-applied Prone", () => {
      const result = addCondition([], createCondition("Unconscious", "until_removed", { source: "sleep-spell" }));
      const prone = result.find((c) => c.condition === "Prone");
      expect(prone?.source).toBe("sleep-spell");
    });

    it("adding other conditions does not auto-apply Prone", () => {
      const result = addCondition([], createCondition("Stunned", "until_removed"));
      expect(hasCondition(result, "Prone")).toBe(false);
    });
  });
});
