import { describe, expect, it } from "vitest";

import type { CombatantStateRecord } from "../../../types.js";
import { detectOpportunityAttacks } from "./oa-detection.js";

function makeCombatant(overrides: Partial<CombatantStateRecord> & { id: string }): CombatantStateRecord {
  return {
    id: overrides.id,
    encounterId: "enc-oa",
    combatantType: "Character",
    characterId: `char-${overrides.id}`,
    monsterId: null,
    npcId: null,
    initiative: 10,
    hpCurrent: 10,
    hpMax: 10,
    conditions: [],
    resources: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("detectOpportunityAttacks", () => {
  it("detects a direct leave-reach movement", () => {
    const actor = makeCombatant({
      id: "actor",
      resources: { position: { x: 0, y: 0 }, speed: 30 },
    });
    const observer = makeCombatant({
      id: "observer",
      resources: { position: { x: 5, y: 0 }, reach: 5, reactionUsed: false },
    });

    const detections = detectOpportunityAttacks({
      combatants: [actor, observer],
      actor,
      from: { x: 0, y: 0 },
      to: { x: 15, y: 0 },
    });

    expect(detections).toHaveLength(1);
    expect(detections[0]?.combatant.id).toBe("observer");
    expect(detections[0]?.canAttack).toBe(true);
    expect(detections[0]?.hasReaction).toBe(true);
  });

  it("uses path cells for leave-reach detection", () => {
    const actor = makeCombatant({
      id: "actor",
      resources: { position: { x: 0, y: 0 }, speed: 30 },
    });
    const observer = makeCombatant({
      id: "observer",
      resources: { position: { x: 10, y: 0 }, reach: 5, reactionUsed: false },
    });

    const directOnly = detectOpportunityAttacks({
      combatants: [actor, observer],
      actor,
      from: { x: 0, y: 0 },
      to: { x: 20, y: 0 },
    });
    expect(directOnly).toHaveLength(0);

    const withPath = detectOpportunityAttacks({
      combatants: [actor, observer],
      actor,
      from: { x: 0, y: 0 },
      to: { x: 20, y: 0 },
      pathCells: [{ x: 5, y: 0 }, { x: 10, y: 0 }, { x: 15, y: 0 }, { x: 20, y: 0 }],
    });

    expect(withPath).toHaveLength(1);
    expect(withPath[0]?.combatant.id).toBe("observer");
  });

  it("only applies sentinel and war caster flags when requested", () => {
    const actor = makeCombatant({
      id: "actor",
      resources: { position: { x: 0, y: 0 }, speed: 30, disengaged: true },
    });
    const observer = makeCombatant({
      id: "observer",
      resources: {
        position: { x: 5, y: 0 },
        reach: 5,
        reactionUsed: false,
        sentinelEnabled: true,
        warCasterEnabled: true,
      },
    });

    const withoutFlags = detectOpportunityAttacks({
      combatants: [actor, observer],
      actor,
      from: { x: 0, y: 0 },
      to: { x: 15, y: 0 },
    });
    expect(withoutFlags[0]?.canAttack).toBe(false);
    expect(withoutFlags[0]?.canCastSpellAsOA).toBe(false);

    const withFlags = detectOpportunityAttacks({
      combatants: [actor, observer],
      actor,
      from: { x: 0, y: 0 },
      to: { x: 15, y: 0 },
      includeObserverFeatFlags: true,
    });
    expect(withFlags[0]?.canAttack).toBe(true);
    expect(withFlags[0]?.canCastSpellAsOA).toBe(true);
    expect(withFlags[0]?.reducesSpeedToZero).toBe(true);
  });
});