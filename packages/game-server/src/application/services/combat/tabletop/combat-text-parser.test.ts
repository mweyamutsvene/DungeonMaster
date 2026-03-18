/**
 * Unit tests for combat-text-parser.ts
 *
 * Covers:
 * - tryParseMoveTowardText() range-aware patterns (Phase 4.3 of smart movement follow-ups)
 * - tryParseMoveTowardText() standard patterns
 * - findCombatantByName() matching
 */

import { describe, it, expect } from "vitest";
import { tryParseMoveTowardText, findCombatantByName } from "./combat-text-parser.js";
import type { LlmRoster } from "../../../commands/game-command.js";

// ------------------------------------------------------------------
// Test fixtures
// ------------------------------------------------------------------

const ROSTER: LlmRoster = {
  characters: [
    { id: "char-1", name: "Brave Fighter" },
    { id: "char-2", name: "Elara" },
  ],
  monsters: [
    { id: "mon-1", name: "Goblin Scout" },
    { id: "mon-2", name: "Red Dragon" },
  ],
  npcs: [
    { id: "npc-1", name: "Merchant Bob" },
  ],
};

// ------------------------------------------------------------------
// tryParseMoveTowardText — range-aware patterns
// ------------------------------------------------------------------

describe("tryParseMoveTowardText — range patterns", () => {
  it("parses 'move within 30ft of Goblin Scout'", () => {
    const result = tryParseMoveTowardText("move within 30ft of Goblin Scout", ROSTER);
    expect(result).not.toBeNull();
    expect(result!.target).toEqual({ type: "Monster", monsterId: "mon-1" });
    expect(result!.rawTargetName).toBe("goblin scout");
    expect(result!.desiredRange).toBe(30);
  });

  it("parses 'get within 20 feet of Red Dragon'", () => {
    const result = tryParseMoveTowardText("get within 20 feet of Red Dragon", ROSTER);
    expect(result).not.toBeNull();
    expect(result!.target).toEqual({ type: "Monster", monsterId: "mon-2" });
    expect(result!.desiredRange).toBe(20);
  });

  it("parses 'move within 15 foot from Brave Fighter'", () => {
    const result = tryParseMoveTowardText("move within 15 foot from Brave Fighter", ROSTER);
    expect(result).not.toBeNull();
    expect(result!.target).toEqual({ type: "Character", characterId: "char-1" });
    expect(result!.desiredRange).toBe(15);
  });

  it("parses 'keep 20ft from Red Dragon'", () => {
    const result = tryParseMoveTowardText("keep 20ft from Red Dragon", ROSTER);
    expect(result).not.toBeNull();
    expect(result!.target).toEqual({ type: "Monster", monsterId: "mon-2" });
    expect(result!.desiredRange).toBe(20);
  });

  it("parses 'keep 10 feet away from Goblin Scout'", () => {
    const result = tryParseMoveTowardText("keep 10 feet away from Goblin Scout", ROSTER);
    expect(result).not.toBeNull();
    expect(result!.target).toEqual({ type: "Monster", monsterId: "mon-1" });
    expect(result!.desiredRange).toBe(10);
  });

  it("parses 'move to ranged position near Goblin Scout' → fixedRange 30", () => {
    const result = tryParseMoveTowardText("move to ranged position near Goblin Scout", ROSTER);
    expect(result).not.toBeNull();
    expect(result!.target).toEqual({ type: "Monster", monsterId: "mon-1" });
    expect(result!.desiredRange).toBe(30);
  });

  it("parses 'get within bow range of Red Dragon' → fixedRange 30", () => {
    const result = tryParseMoveTowardText("get within bow range of Red Dragon", ROSTER);
    expect(result).not.toBeNull();
    expect(result!.target).toEqual({ type: "Monster", monsterId: "mon-2" });
    expect(result!.desiredRange).toBe(30);
  });

  it("parses 'move within bow range of Goblin Scout' → fixedRange 30", () => {
    const result = tryParseMoveTowardText("move within bow range of Goblin Scout", ROSTER);
    expect(result).not.toBeNull();
    expect(result!.target).toEqual({ type: "Monster", monsterId: "mon-1" });
    expect(result!.desiredRange).toBe(30);
  });

  it("parses 'get within spell range of Merchant Bob' → fixedRange 30", () => {
    const result = tryParseMoveTowardText("get within spell range of Merchant Bob", ROSTER);
    expect(result).not.toBeNull();
    expect(result!.target).toEqual({ type: "NPC", npcId: "npc-1" });
    expect(result!.desiredRange).toBe(30);
  });

  it("parses 'move within spell range of Red Dragon' → fixedRange 30", () => {
    const result = tryParseMoveTowardText("move within spell range of Red Dragon", ROSTER);
    expect(result).not.toBeNull();
    expect(result!.target).toEqual({ type: "Monster", monsterId: "mon-2" });
    expect(result!.desiredRange).toBe(30);
  });

  it("returns null for ranged pattern with unknown target", () => {
    const result = tryParseMoveTowardText("move within 30ft of Unknown Monster", ROSTER);
    expect(result).toBeNull();
  });
});

// ------------------------------------------------------------------
// tryParseMoveTowardText — standard patterns (no desiredRange)
// ------------------------------------------------------------------

describe("tryParseMoveTowardText — standard patterns", () => {
  it("parses 'move to Goblin Scout'", () => {
    const result = tryParseMoveTowardText("move to Goblin Scout", ROSTER);
    expect(result).not.toBeNull();
    expect(result!.target).toEqual({ type: "Monster", monsterId: "mon-1" });
    expect(result!.desiredRange).toBeUndefined();
  });

  it("parses 'move toward Red Dragon'", () => {
    const result = tryParseMoveTowardText("move toward Red Dragon", ROSTER);
    expect(result).not.toBeNull();
    expect(result!.target).toEqual({ type: "Monster", monsterId: "mon-2" });
    expect(result!.desiredRange).toBeUndefined();
  });

  it("parses 'approach Goblin Scout'", () => {
    const result = tryParseMoveTowardText("approach Goblin Scout", ROSTER);
    expect(result).not.toBeNull();
    expect(result!.target).toEqual({ type: "Monster", monsterId: "mon-1" });
  });

  it("parses 'advance on the Red Dragon'", () => {
    const result = tryParseMoveTowardText("advance on the Red Dragon", ROSTER);
    expect(result).not.toBeNull();
    expect(result!.target).toEqual({ type: "Monster", monsterId: "mon-2" });
  });

  it("parses 'close in on Goblin Scout'", () => {
    const result = tryParseMoveTowardText("close in on Goblin Scout", ROSTER);
    expect(result).not.toBeNull();
    expect(result!.target).toEqual({ type: "Monster", monsterId: "mon-1" });
  });

  it("parses 'get close to Brave Fighter'", () => {
    const result = tryParseMoveTowardText("get close to Brave Fighter", ROSTER);
    expect(result).not.toBeNull();
    expect(result!.target).toEqual({ type: "Character", characterId: "char-1" });
  });

  it("parses 'run at Red Dragon'", () => {
    const result = tryParseMoveTowardText("run at Red Dragon", ROSTER);
    expect(result).not.toBeNull();
    expect(result!.target).toEqual({ type: "Monster", monsterId: "mon-2" });
  });

  it("parses 'charge Red Dragon'", () => {
    const result = tryParseMoveTowardText("charge Red Dragon", ROSTER);
    expect(result).not.toBeNull();
    expect(result!.target).toEqual({ type: "Monster", monsterId: "mon-2" });
  });

  it("returns null for unknown target", () => {
    const result = tryParseMoveTowardText("move to Ghost", ROSTER);
    expect(result).toBeNull();
  });

  it("returns null for coordinate-based move", () => {
    const result = tryParseMoveTowardText("move to (10, 15)", ROSTER);
    expect(result).toBeNull();
  });

  it("returns null for empty input", () => {
    const result = tryParseMoveTowardText("", ROSTER);
    expect(result).toBeNull();
  });

  it("strips 'the' article before target name", () => {
    const result = tryParseMoveTowardText("move toward the Goblin Scout", ROSTER);
    expect(result).not.toBeNull();
    expect(result!.target).toEqual({ type: "Monster", monsterId: "mon-1" });
  });
});

// ------------------------------------------------------------------
// findCombatantByName — case-insensitive matching
// ------------------------------------------------------------------

describe("findCombatantByName", () => {
  it("matches character by exact name (case-insensitive)", () => {
    const ref = findCombatantByName("brave fighter", ROSTER);
    expect(ref).toEqual({ type: "Character", characterId: "char-1" });
  });

  it("matches monster by exact name (case-insensitive)", () => {
    const ref = findCombatantByName("goblin scout", ROSTER);
    expect(ref).toEqual({ type: "Monster", monsterId: "mon-1" });
  });

  it("matches NPC by exact name (case-insensitive)", () => {
    const ref = findCombatantByName("merchant bob", ROSTER);
    expect(ref).toEqual({ type: "NPC", npcId: "npc-1" });
  });

  it("returns null for no match", () => {
    const ref = findCombatantByName("unknown monster", ROSTER);
    expect(ref).toBeNull();
  });
});
