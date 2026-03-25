import { describe, it, expect, beforeEach, vi } from "vitest";
import { SpellActionHandler } from "./spell-action-handler.js";
import type { TabletopCombatServiceDeps } from "./tabletop-types.js";
import type { TabletopEventEmitter } from "./tabletop-event-emitter.js";
import { MemoryCombatRepository } from "../../../../infrastructure/testing/memory-repos.js";
import type { LlmRoster } from "../../../../application/commands/game-command.js";
import { FixedDiceRoller } from "../../../../domain/rules/dice-roller.js";
import { ValidationError } from "../../../errors.js";
import { AbilityRegistry } from "../abilities/ability-registry.js";

const SESSION_ID = "session-1";
const ENCOUNTER_ID = "enc-1";
const ACTOR_ID = "wizard-1";
const TARGET_ID = "goblin-1";

const roster: LlmRoster = {
  characters: [{ id: ACTOR_ID, name: "Gandalf" }],
  monsters: [{ id: TARGET_ID, name: "Goblin" }],
  npcs: [],
};

const characters = [
  {
    id: ACTOR_ID,
    sheet: {
      preparedSpells: [
        { name: "Fire Bolt", level: 0, attackType: "ranged_spell", damageDice: "1d10", damageType: "fire" },
        {
          name: "Burning Hands",
          level: 1,
          saveAbility: "dexterity",
          damage: { diceCount: 3, diceSides: 6 },
          damageType: "fire",
          concentration: false,
          upcastScaling: { additionalDice: { diceCount: 1, diceSides: 6 } },
        },
        {
          name: "Cure Wounds",
          level: 1,
          healing: { diceCount: 1, diceSides: 8, modifier: 3 },
          concentration: false,
          upcastScaling: { additionalDice: { diceCount: 1, diceSides: 8 } },
        },
        { name: "Bless", level: 1, concentration: true, effects: [{ type: "buff", duration: 10 }] },
        {
          name: "Spirit Guardians",
          level: 3,
          concentration: true,
          zone: {
            shape: "aura",
            radiusFt: 15,
            effects: [
              { trigger: "enter", saveAbility: "wisdom", damageDice: "3d8", damageType: "radiant" },
            ],
          },
        },
        { name: "Magic Missile", level: 1, damageDice: "3d4+3", damageType: "force", concentration: false },
      ],
      spellAttackBonus: 5,
      spellSaveDC: 13,
      spellcastingAbility: "intelligence",
      abilityScores: { strength: 8, dexterity: 14, constitution: 12, intelligence: 16, wisdom: 10, charisma: 10 },
    },
  },
];

describe("SpellActionHandler", () => {
  let combatRepo: MemoryCombatRepository;
  let deps: TabletopCombatServiceDeps;
  let eventEmitter: TabletopEventEmitter;
  let handler: SpellActionHandler;

  beforeEach(async () => {
    combatRepo = new MemoryCombatRepository();

    deps = {
      combatRepo,
      actions: {
        castSpell: vi.fn().mockResolvedValue(undefined),
      },
      diceRoller: new FixedDiceRoller(10),
      abilityRegistry: new AbilityRegistry(),
      monsters: {
        listBySession: vi.fn().mockResolvedValue([
          { id: TARGET_ID, name: "Goblin", stats: { hp: 12, ac: 13 } },
        ]),
      },
      npcs: {
        listBySession: vi.fn().mockResolvedValue([]),
      },
    } as unknown as TabletopCombatServiceDeps;

    eventEmitter = {
      generateNarration: vi.fn().mockResolvedValue(undefined),
      markActionSpent: vi.fn().mockResolvedValue(undefined),
      emitDamageEvents: vi.fn().mockResolvedValue(undefined),
      emitHealingEvents: vi.fn().mockResolvedValue(undefined),
      emitAttackEvents: vi.fn().mockResolvedValue(undefined),
      emitConcentrationEvent: vi.fn().mockResolvedValue(undefined),
    } as unknown as TabletopEventEmitter;

    handler = new SpellActionHandler(deps, eventEmitter, false);

    await combatRepo.createEncounter(SESSION_ID, {
      id: ENCOUNTER_ID,
      status: "Active",
      round: 1,
      turn: 0,
    });

    await combatRepo.createCombatants(ENCOUNTER_ID, [
      {
        id: "comb-wizard",
        combatantType: "Character",
        characterId: ACTOR_ID,
        monsterId: null,
        npcId: null,
        initiative: 15,
        hpCurrent: 30,
        hpMax: 30,
        conditions: [],
        resources: {
          resourcePools: [
            { name: "spellSlot_1", current: 4, max: 4 },
            { name: "spellSlot_2", current: 3, max: 3 },
            { name: "spellSlot_3", current: 2, max: 2 },
          ],
        },
      },
      {
        id: "comb-goblin",
        combatantType: "Monster",
        characterId: null,
        monsterId: TARGET_ID,
        npcId: null,
        initiative: 10,
        hpCurrent: 12,
        hpMax: 12,
        conditions: [],
        resources: { resourcePools: [] },
      },
    ]);
  });

  it("handles spell attack (Fire Bolt) → returns REQUEST_ROLL", async () => {
    const result = await handler.handleCastSpell(
      SESSION_ID,
      ENCOUNTER_ID,
      ACTOR_ID,
      { spellName: "Fire Bolt", targetName: "Goblin" },
      characters,
      roster,
    );

    expect(result.type).toBe("REQUEST_ROLL");
    expect(result.requiresPlayerInput).toBe(true);
    expect(result.actionComplete).toBe(false);
  });

  it("handles save-based spell (Burning Hands) → auto-resolves save, returns SIMPLE_ACTION_COMPLETE", async () => {
    const result = await handler.handleCastSpell(
      SESSION_ID,
      ENCOUNTER_ID,
      ACTOR_ID,
      { spellName: "Burning Hands", targetName: "Goblin" },
      characters,
      roster,
    );

    expect(result.type).toBe("SIMPLE_ACTION_COMPLETE");
    expect(result.actionComplete).toBe(true);

    // Level 1 spell — slot should be spent
    const combatants = await combatRepo.listCombatants(ENCOUNTER_ID);
    const caster = combatants.find((c) => c.characterId === ACTOR_ID)!;
    const res = caster.resources as Record<string, unknown>;
    const pools = res.resourcePools as Array<{ name: string; current: number; max: number }>;
    const slot1 = pools.find((p) => p.name === "spellSlot_1")!;
    expect(slot1.current).toBe(3);
  });

  it("handles healing spell (Cure Wounds) → heals target, returns SIMPLE_ACTION_COMPLETE", async () => {
    await combatRepo.updateCombatantState("comb-goblin", { hpCurrent: 5 });

    const result = await handler.handleCastSpell(
      SESSION_ID,
      ENCOUNTER_ID,
      ACTOR_ID,
      { spellName: "Cure Wounds", targetName: "Goblin" },
      characters,
      roster,
    );

    expect(result.type).toBe("SIMPLE_ACTION_COMPLETE");
    expect(result.actionComplete).toBe(true);
  });

  it("handles buff/debuff spell (Bless) → returns SIMPLE_ACTION_COMPLETE", async () => {
    const result = await handler.handleCastSpell(
      SESSION_ID,
      ENCOUNTER_ID,
      ACTOR_ID,
      { spellName: "Bless", targetName: "Goblin" },
      characters,
      roster,
    );

    expect(result.type).toBe("SIMPLE_ACTION_COMPLETE");
    expect(result.actionComplete).toBe(true);
  });

  it("handles zone spell (Spirit Guardians) → returns SIMPLE_ACTION_COMPLETE", async () => {
    const result = await handler.handleCastSpell(
      SESSION_ID,
      ENCOUNTER_ID,
      ACTOR_ID,
      { spellName: "Spirit Guardians" },
      characters,
      roster,
    );

    expect(result.type).toBe("SIMPLE_ACTION_COMPLETE");
    expect(result.actionComplete).toBe(true);

    // Level 3 spell — slot should be spent
    const combatants = await combatRepo.listCombatants(ENCOUNTER_ID);
    const caster = combatants.find((c) => c.characterId === ACTOR_ID)!;
    const res = caster.resources as Record<string, unknown>;
    const pools = res.resourcePools as Array<{ name: string; current: number; max: number }>;
    const slot3 = pools.find((p) => p.name === "spellSlot_3")!;
    expect(slot3.current).toBe(1);
  });

  it("handles simple/fallback spell (Magic Missile) → calls actions.castSpell", async () => {
    const result = await handler.handleCastSpell(
      SESSION_ID,
      ENCOUNTER_ID,
      ACTOR_ID,
      { spellName: "Magic Missile", targetName: "Goblin" },
      characters,
      roster,
    );

    expect(result.type).toBe("SIMPLE_ACTION_COMPLETE");
    expect(deps.actions.castSpell).toHaveBeenCalled();
  });

  it("concentration: casting second concentration spell drops first", async () => {
    // Set caster as concentrating on Bless
    await combatRepo.updateCombatantState("comb-wizard", {
      resources: {
        resourcePools: [
          { name: "spellSlot_1", current: 4, max: 4 },
          { name: "spellSlot_3", current: 2, max: 2 },
        ],
        concentrationSpellName: "Bless",
      },
    });

    await handler.handleCastSpell(
      SESSION_ID,
      ENCOUNTER_ID,
      ACTOR_ID,
      { spellName: "Spirit Guardians" },
      characters,
      roster,
    );

    const combatants = await combatRepo.listCombatants(ENCOUNTER_ID);
    const caster = combatants.find((c) => c.characterId === ACTOR_ID)!;
    const res = caster.resources as Record<string, unknown>;
    expect(res.concentrationSpellName).toBe("Spirit Guardians");
  });

  it("throws when no spell slots available", async () => {
    await combatRepo.updateCombatantState("comb-wizard", {
      resources: {
        resourcePools: [
          { name: "spellSlot_1", current: 0, max: 4 },
          { name: "spellSlot_3", current: 2, max: 2 },
        ],
      },
    });

    await expect(
      handler.handleCastSpell(
        SESSION_ID,
        ENCOUNTER_ID,
        ACTOR_ID,
        { spellName: "Burning Hands", targetName: "Goblin" },
        characters,
        roster,
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("unknown spell falls through to simple action gracefully", async () => {
    const result = await handler.handleCastSpell(
      SESSION_ID,
      ENCOUNTER_ID,
      ACTOR_ID,
      { spellName: "Nonexistent Spell" },
      characters,
      roster,
    );

    expect(result.type).toBe("SIMPLE_ACTION_COMPLETE");
    expect(deps.actions.castSpell).toHaveBeenCalled();
  });

  // ─────────────────────── upcasting (castAtLevel) ────────────────────────

  describe("upcasting (castAtLevel)", () => {
    it("upcast Cure Wounds (1→2) spends level-2 slot, not level-1 slot", async () => {
      await combatRepo.updateCombatantState("comb-goblin", { hpCurrent: 5 });

      await handler.handleCastSpell(
        SESSION_ID,
        ENCOUNTER_ID,
        ACTOR_ID,
        { spellName: "Cure Wounds", targetName: "Goblin", castAtLevel: 2 },
        characters,
        roster,
      );

      const combatants = await combatRepo.listCombatants(ENCOUNTER_ID);
      const caster = combatants.find((c) => c.characterId === ACTOR_ID)!;
      const res = caster.resources as Record<string, unknown>;
      const pools = res.resourcePools as Array<{ name: string; current: number; max: number }>;
      const slot1 = pools.find((p) => p.name === "spellSlot_1")!;
      const slot2 = pools.find((p) => p.name === "spellSlot_2")!;
      // Level-1 slot untouched; level-2 slot consumed
      expect(slot1.current).toBe(4);
      expect(slot2.current).toBe(2);
    });

    it("upcast Burning Hands (1→2) spends level-2 slot, not level-1 slot", async () => {
      await handler.handleCastSpell(
        SESSION_ID,
        ENCOUNTER_ID,
        ACTOR_ID,
        { spellName: "Burning Hands", targetName: "Goblin", castAtLevel: 2 },
        characters,
        roster,
      );

      const combatants = await combatRepo.listCombatants(ENCOUNTER_ID);
      const caster = combatants.find((c) => c.characterId === ACTOR_ID)!;
      const res = caster.resources as Record<string, unknown>;
      const pools = res.resourcePools as Array<{ name: string; current: number; max: number }>;
      const slot1 = pools.find((p) => p.name === "spellSlot_1")!;
      const slot2 = pools.find((p) => p.name === "spellSlot_2")!;
      expect(slot1.current).toBe(4);
      expect(slot2.current).toBe(2);
    });

    it("throws ValidationError when trying to upcast a cantrip (Fire Bolt)", async () => {
      await expect(
        handler.handleCastSpell(
          SESSION_ID,
          ENCOUNTER_ID,
          ACTOR_ID,
          { spellName: "Fire Bolt", targetName: "Goblin", castAtLevel: 2 },
          characters,
          roster,
        ),
      ).rejects.toThrow(ValidationError);
    });

    it("throws ValidationError when castAtLevel is below the spell's base level", async () => {
      await expect(
        handler.handleCastSpell(
          SESSION_ID,
          ENCOUNTER_ID,
          ACTOR_ID,
          { spellName: "Spirit Guardians", targetName: "Goblin", castAtLevel: 2 },
          characters,
          roster,
        ),
      ).rejects.toThrow(ValidationError);
    });

    it("throws ValidationError when castAtLevel exceeds 9", async () => {
      await expect(
        handler.handleCastSpell(
          SESSION_ID,
          ENCOUNTER_ID,
          ACTOR_ID,
          { spellName: "Burning Hands", targetName: "Goblin", castAtLevel: 10 },
          characters,
          roster,
        ),
      ).rejects.toThrow(ValidationError);
    });
  });
});
