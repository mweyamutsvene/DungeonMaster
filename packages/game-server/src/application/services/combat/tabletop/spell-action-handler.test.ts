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
        {
          name: "Healing Word",
          level: 1,
          isBonusAction: true,
          healing: { diceCount: 1, diceSides: 4, modifier: 3 },
          concentration: false,
        },
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
      twoPhaseActions: {
        initiateSpellCast: vi.fn().mockResolvedValue({ status: "no_reactions", counterspellOpportunities: [] }),
      },
      pendingActions: {
        getById: vi.fn().mockResolvedValue(undefined),
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

  // ─────────────────────── AoE save spells ────────────────────────

  describe("AoE save spells (Burning Hands with area)", () => {
    /**
     * Characters fixture with Burning Hands as a 15ft cone AoE.
     * No positional data on combatants → exercises the no-position fallback path.
     */
    const aoeCharacters = [
      {
        id: ACTOR_ID,
        sheet: {
          preparedSpells: [
            {
              name: "Burning Hands",
              level: 1,
              saveAbility: "dexterity",
              damage: { diceCount: 3, diceSides: 6 },
              damageType: "fire",
              halfDamageOnSave: true,
              area: { type: "cone", size: 15 },
            },
          ],
          spellAttackBonus: 5,
          spellSaveDC: 13,
          spellcastingAbility: "intelligence",
          abilityScores: { strength: 8, dexterity: 14, constitution: 12, intelligence: 16, wisdom: 10, charisma: 10 },
        },
      },
    ];

    // Additional monster IDs for multi-target tests
    const GOBLIN_2_ID = "goblin-2";
    const GOBLIN_3_ID = "goblin-3";
    const SKELETON_ID = "skeleton-1";

    /**
     * Build a minimal roster with the caster + any monster IDs provided.
     */
    function makeRoster(monsterIds: Array<{ id: string; name: string }>) {
      return {
        characters: [{ id: ACTOR_ID, name: "Gandalf" }],
        monsters: monsterIds,
        npcs: [],
      };
    }

    describe("no-position fallback path", () => {
      it("with no grid positions and a named target: affects only that target", async () => {
        const result = await handler.handleCastSpell(
          SESSION_ID,
          ENCOUNTER_ID,
          ACTOR_ID,
          { spellName: "Burning Hands", targetName: "Goblin" },
          aoeCharacters,
          makeRoster([{ id: TARGET_ID, name: "Goblin" }]),
        );

        expect(result.type).toBe("SIMPLE_ACTION_COMPLETE");
        expect(result.actionComplete).toBe(true);
        expect(result.message).toContain("Burning Hands");
        // Should mention the Goblin in results
        expect(result.message).toMatch(/goblin/i);
      });

      it("with no grid positions and no named target: affects ALL non-caster combatants", async () => {
        // Add a second goblin to the encounter (no positions on either)
        await combatRepo.createCombatants(ENCOUNTER_ID, [
          {
            id: "comb-goblin-2",
            combatantType: "Monster",
            characterId: null,
            monsterId: GOBLIN_2_ID,
            npcId: null,
            initiative: 8,
            hpCurrent: 15,
            hpMax: 15,
            conditions: [],
            resources: { resourcePools: [] },
          },
        ]);

        const result = await handler.handleCastSpell(
          SESSION_ID,
          ENCOUNTER_ID,
          ACTOR_ID,
          // No targetName: should hit all non-caster combatants
          { spellName: "Burning Hands" },
          aoeCharacters,
          makeRoster([
            { id: TARGET_ID, name: "Goblin" },
            { id: GOBLIN_2_ID, name: "Goblin 2" },
          ]),
        );

        expect(result.type).toBe("SIMPLE_ACTION_COMPLETE");
        // Both goblins should appear in the result message
        expect(result.message).toMatch(/goblin/i);
      });

      it("returns 'No creatures in area' when the only combatant is the caster", async () => {
        // Use an isolated repo so resolveEncounterContext picks the right encounter
        const soloRepo = new MemoryCombatRepository();
        const soloSession = "solo-session";
        const soloEncId = "solo-enc";

        await soloRepo.createEncounter(soloSession, {
          id: soloEncId,
          status: "Active",
          round: 1,
          turn: 0,
        });
        await soloRepo.createCombatants(soloEncId, [
          {
            id: "solo-wizard",
            combatantType: "Character",
            characterId: ACTOR_ID,
            monsterId: null,
            npcId: null,
            initiative: 15,
            hpCurrent: 30,
            hpMax: 30,
            conditions: [],
            resources: {
              resourcePools: [{ name: "spellSlot_1", current: 4, max: 4 }],
            },
          },
        ]);

        const soloDeps = { ...deps, combatRepo: soloRepo } as unknown as TabletopCombatServiceDeps;
        const soloHandler = new SpellActionHandler(soloDeps, eventEmitter, false);

        const result = await soloHandler.handleCastSpell(
          soloSession,
          soloEncId,
          ACTOR_ID,
          { spellName: "Burning Hands" },
          aoeCharacters,
          makeRoster([]),
        );

        expect(result.type).toBe("SIMPLE_ACTION_COMPLETE");
        expect(result.message).toMatch(/no creatures were in the area/i);
      });
    });

    describe("grid position path", () => {
      /**
       * Encounter layout (positions in feet):
       *   Wizard  at (0,  0) — caster, facing right (+x direction)
       *   Goblin1 at (5,  0) — inside 15ft cone
       *   Goblin2 at (10, 0) — inside 15ft cone
       *   Goblin3 at (5,  5) — inside 15ft cone (at boundary)
       *   Skeleton at (-5, 0) — BEHIND caster, outside cone
       *
       * Uses an isolated MemoryCombatRepository per test to avoid encounter
       * selection conflicts with the outer describe block's ENCOUNTER_ID.
       */
      let aoeRepo: MemoryCombatRepository;
      let aoeHandler: SpellActionHandler;
      const AOE_SESSION = "aoe-session";
      const AOE_ENC = "aoe-enc";

      beforeEach(async () => {
        aoeRepo = new MemoryCombatRepository();
        await aoeRepo.createEncounter(AOE_SESSION, {
          id: AOE_ENC,
          status: "Active",
          round: 1,
          turn: 0,
        });

        await aoeRepo.createCombatants(AOE_ENC, [
          {
            id: "aoe-wizard",
            combatantType: "Character",
            characterId: ACTOR_ID,
            monsterId: null,
            npcId: null,
            initiative: 20,
            hpCurrent: 30,
            hpMax: 30,
            conditions: [],
            resources: {
              resourcePools: [{ name: "spellSlot_1", current: 4, max: 4 }],
              position: { x: 0, y: 0 },
            },
          },
          {
            id: "aoe-goblin1",
            combatantType: "Monster",
            characterId: null,
            monsterId: TARGET_ID,
            npcId: null,
            initiative: 15,
            hpCurrent: 20,
            hpMax: 20,
            conditions: [],
            resources: { resourcePools: [], position: { x: 5, y: 0 } },
          },
          {
            id: "aoe-goblin2",
            combatantType: "Monster",
            characterId: null,
            monsterId: GOBLIN_2_ID,
            npcId: null,
            initiative: 12,
            hpCurrent: 20,
            hpMax: 20,
            conditions: [],
            resources: { resourcePools: [], position: { x: 10, y: 0 } },
          },
          {
            id: "aoe-goblin3",
            combatantType: "Monster",
            characterId: null,
            monsterId: GOBLIN_3_ID,
            npcId: null,
            initiative: 10,
            hpCurrent: 20,
            hpMax: 20,
            conditions: [],
            resources: { resourcePools: [], position: { x: 5, y: 5 } },
          },
          {
            id: "aoe-skeleton",
            combatantType: "Monster",
            characterId: null,
            monsterId: SKELETON_ID,
            npcId: null,
            initiative: 8,
            hpCurrent: 30,
            hpMax: 30,
            conditions: [],
            resources: { resourcePools: [], position: { x: -5, y: 0 } },
          },
        ]);

        const aoeDeps = { ...deps, combatRepo: aoeRepo } as unknown as TabletopCombatServiceDeps;
        aoeHandler = new SpellActionHandler(aoeDeps, eventEmitter, false);
      });

      it("hits 3 goblins in the cone and NOT the skeleton behind the caster", async () => {
        const aoeRoster = makeRoster([
          { id: TARGET_ID, name: "Goblin" },
          { id: GOBLIN_2_ID, name: "Goblin 2" },
          { id: GOBLIN_3_ID, name: "Goblin 3" },
          { id: SKELETON_ID, name: "Skeleton" },
        ]);

        // Target Goblin (at x=5,y=0) to set the cone direction (right)
        const result = await aoeHandler.handleCastSpell(
          AOE_SESSION,
          AOE_ENC,
          ACTOR_ID,
          { spellName: "Burning Hands", targetName: "Goblin" },
          aoeCharacters,
          aoeRoster,
        );

        expect(result.type).toBe("SIMPLE_ACTION_COMPLETE");
        expect(result.actionComplete).toBe(true);

        // All 3 goblins should have taken damage (HP reduced)
        const combatants = await aoeRepo.listCombatants(AOE_ENC);
        const g1 = combatants.find((c) => c.monsterId === TARGET_ID)!;
        const g2 = combatants.find((c) => c.monsterId === GOBLIN_2_ID)!;
        const g3 = combatants.find((c) => c.monsterId === GOBLIN_3_ID)!;
        const sk = combatants.find((c) => c.monsterId === SKELETON_ID)!;

        // Goblins in the cone must have taken damage (FixedDiceRoller(10) → d20=10 fails DC 13)
        // With FixedDiceRoller(10): each save roll = 10 + DEX modifier
        // Goblins have no stat block in this test → modifier defaults to 0 → total=10 < DC 13 → fail
        expect(g1.hpCurrent).toBeLessThan(20);
        expect(g2.hpCurrent).toBeLessThan(20);
        expect(g3.hpCurrent).toBeLessThan(20);

        // Skeleton is BEHIND the caster — should be unaffected
        expect(sk.hpCurrent).toBe(30);
      });

      it("hits no creatures when all the area is empty (no targets in cone)", async () => {
        // Use an isolated repo with only the caster and a skeleton BEHIND the caster
        const emptyRepo = new MemoryCombatRepository();
        const EMPTY_SESSION = "empty-session";
        const EMPTY_ENC = "empty-enc";

        await emptyRepo.createEncounter(EMPTY_SESSION, {
          id: EMPTY_ENC,
          status: "Active",
          round: 1,
          turn: 0,
        });
        await emptyRepo.createCombatants(EMPTY_ENC, [
          {
            id: "emp-wizard",
            combatantType: "Character",
            characterId: ACTOR_ID,
            monsterId: null,
            npcId: null,
            initiative: 20,
            hpCurrent: 30,
            hpMax: 30,
            conditions: [],
            resources: {
              resourcePools: [{ name: "spellSlot_1", current: 4, max: 4 }],
              position: { x: 0, y: 0 },
            },
          },
          {
            id: "emp-skeleton",
            combatantType: "Monster",
            characterId: null,
            monsterId: SKELETON_ID,
            npcId: null,
            initiative: 8,
            hpCurrent: 30,
            hpMax: 30,
            conditions: [],
            resources: { resourcePools: [], position: { x: -15, y: 0 } },
          },
        ]);

        const emptyDeps = { ...deps, combatRepo: emptyRepo } as unknown as TabletopCombatServiceDeps;
        const emptyHandler = new SpellActionHandler(emptyDeps, eventEmitter, false);

        const result = await emptyHandler.handleCastSpell(
          EMPTY_SESSION,
          EMPTY_ENC,
          ACTOR_ID,
          // No named target → direction defaults to (1,0) but skeleton is at (-15,0) — behind caster
          { spellName: "Burning Hands" },
          aoeCharacters,
          makeRoster([{ id: SKELETON_ID, name: "Skeleton" }]),
        );

        expect(result.type).toBe("SIMPLE_ACTION_COMPLETE");
        expect(result.message).toMatch(/no creatures were in the area/i);

        // Skeleton HP untouched
        const combatants = await emptyRepo.listCombatants(EMPTY_ENC);
        const sk = combatants.find((c) => c.monsterId === SKELETON_ID)!;
        expect(sk.hpCurrent).toBe(30);
      });

      it("spends a spell slot when casting AoE Burning Hands", async () => {
        const aoeRoster = makeRoster([
          { id: TARGET_ID, name: "Goblin" },
          { id: GOBLIN_2_ID, name: "Goblin 2" },
        ]);

        await aoeHandler.handleCastSpell(
          AOE_SESSION,
          AOE_ENC,
          ACTOR_ID,
          { spellName: "Burning Hands", targetName: "Goblin" },
          aoeCharacters,
          aoeRoster,
        );

        const combatants = await aoeRepo.listCombatants(AOE_ENC);
        const wizard = combatants.find((c) => c.characterId === ACTOR_ID)!;
        const res = wizard.resources as Record<string, unknown>;
        const pools = res.resourcePools as Array<{ name: string; current: number; max: number }>;
        const slot1 = pools.find((p) => p.name === "spellSlot_1")!;
        expect(slot1.current).toBe(3); // one slot spent
      });

      it("result message lists all affected targets with save results", async () => {
        const aoeRoster = makeRoster([
          { id: TARGET_ID, name: "Goblin" },
          { id: GOBLIN_2_ID, name: "Goblin 2" },
          { id: GOBLIN_3_ID, name: "Goblin 3" },
          { id: SKELETON_ID, name: "Skeleton" },
        ]);

        const result = await aoeHandler.handleCastSpell(
          AOE_SESSION,
          AOE_ENC,
          ACTOR_ID,
          { spellName: "Burning Hands", targetName: "Goblin" },
          aoeCharacters,
          aoeRoster,
        );

        // Message should include AoE description and creature summary
        expect(result.message).toContain("Burning Hands");
        expect(result.message).toMatch(/15ft cone/i);
        // At least one goblin name in message
        expect(result.message).toMatch(/goblin/i);
      });
    });
  });

  // ─────── bonus action spell restriction (D&D 5e 2024) ───────

  describe("bonus action spell restriction", () => {
    it("casting a leveled bonus action spell (Healing Word) then a leveled action spell (Burning Hands) throws", async () => {
      // Healing Word is a leveled bonus action spell → sets bonusActionSpellCastThisTurn
      await handler.handleCastSpell(
        SESSION_ID,
        ENCOUNTER_ID,
        ACTOR_ID,
        { spellName: "Healing Word", targetName: "Goblin" },
        characters,
        roster,
      );

      // Now try a leveled action spell → should be blocked
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

    it("casting a leveled action spell (Burning Hands) then a leveled bonus action spell (Healing Word) throws", async () => {
      // Burning Hands is a leveled action spell → sets actionSpellCastThisTurn
      await handler.handleCastSpell(
        SESSION_ID,
        ENCOUNTER_ID,
        ACTOR_ID,
        { spellName: "Burning Hands", targetName: "Goblin" },
        characters,
        roster,
      );

      // Now try a leveled bonus action spell → should be blocked
      await expect(
        handler.handleCastSpell(
          SESSION_ID,
          ENCOUNTER_ID,
          ACTOR_ID,
          { spellName: "Healing Word", targetName: "Goblin" },
          characters,
          roster,
        ),
      ).rejects.toThrow(ValidationError);
    });

    it("casting a leveled bonus action spell (Healing Word) then a cantrip (Fire Bolt) succeeds", async () => {
      // Healing Word is a leveled bonus action spell → sets bonusActionSpellCastThisTurn
      await handler.handleCastSpell(
        SESSION_ID,
        ENCOUNTER_ID,
        ACTOR_ID,
        { spellName: "Healing Word", targetName: "Goblin" },
        characters,
        roster,
      );

      // Cantrips should still be allowed as actions
      const result = await handler.handleCastSpell(
        SESSION_ID,
        ENCOUNTER_ID,
        ACTOR_ID,
        { spellName: "Fire Bolt", targetName: "Goblin" },
        characters,
        roster,
      );

      // Fire Bolt is an attack spell → returns REQUEST_ROLL (not blocked)
      expect(result.type).toBe("REQUEST_ROLL");
    });
  });

  describe("AoE healing (Mass Cure Wounds)", () => {
    const ALLY_ID = "fighter-1";

    const massCureCharacters = [
      {
        id: ACTOR_ID,
        sheet: {
          preparedSpells: [
            {
              name: "Mass Cure Wounds",
              level: 5,
              healing: { diceCount: 3, diceSides: 8 },
              area: { type: "sphere", size: 60 },
              upcastScaling: { additionalDice: { diceCount: 1, diceSides: 8 } },
            },
            {
              name: "Cure Wounds",
              level: 1,
              healing: { diceCount: 1, diceSides: 8, modifier: 3 },
            },
          ],
          spellAttackBonus: 5,
          spellSaveDC: 13,
          spellcastingAbility: "wisdom",
          abilityScores: { strength: 8, dexterity: 14, constitution: 12, intelligence: 10, wisdom: 16, charisma: 10 },
        },
      },
    ];

    const massCureRoster: LlmRoster = {
      characters: [
        { id: ACTOR_ID, name: "Cleric" },
        { id: ALLY_ID, name: "Fighter" },
      ],
      monsters: [{ id: TARGET_ID, name: "Goblin" }],
      npcs: [],
    };

    beforeEach(async () => {
      // Re-create combatants with 3 entries (createCombatants replaces the full list)
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
        {
          id: "comb-fighter",
          combatantType: "Character",
          characterId: ALLY_ID,
          monsterId: null,
          npcId: null,
          initiative: 12,
          hpCurrent: 20,
          hpMax: 40,
          conditions: [],
          resources: { resourcePools: [] },
        },
      ]);
    });

    it("heals all friendly combatants when no target specified", async () => {
      // Damage both friendly characters
      await combatRepo.updateCombatantState("comb-wizard", { hpCurrent: 15 });
      await combatRepo.updateCombatantState("comb-fighter", { hpCurrent: 20 });

      // Add level 5 spell slot
      await combatRepo.updateCombatantState("comb-wizard", {
        resources: {
          resourcePools: [
            { name: "spellSlot_1", current: 4, max: 4 },
            { name: "spellSlot_2", current: 3, max: 3 },
            { name: "spellSlot_3", current: 2, max: 2 },
            { name: "spellSlot_5", current: 1, max: 1 },
          ],
        },
      });

      const result = await handler.handleCastSpell(
        SESSION_ID,
        ENCOUNTER_ID,
        ACTOR_ID,
        { spellName: "Mass Cure Wounds" },
        massCureCharacters,
        massCureRoster,
      );

      expect(result.type).toBe("SIMPLE_ACTION_COMPLETE");
      expect(result.actionComplete).toBe(true);
      expect(result.message).toContain("Mass Cure Wounds");
      expect(result.message).toContain("target(s)");

      // Both friendly characters should be healed
      const combatantsAfter = await combatRepo.listCombatants(ENCOUNTER_ID);
      const wizard = combatantsAfter.find((c) => c.characterId === ACTOR_ID)!;
      const fighter = combatantsAfter.find((c) => c.characterId === ALLY_ID)!;

      // FixedDiceRoller(10) → 3d8 = 30, +3 wisdom mod = 33
      expect(wizard.hpCurrent).toBeGreaterThan(15);
      expect(fighter.hpCurrent).toBeGreaterThan(20);

      // Healing events emitted for each target
      expect(eventEmitter.emitHealingEvents).toHaveBeenCalledTimes(2);
    });

    it("does not heal enemies", async () => {
      await combatRepo.updateCombatantState("comb-wizard", { hpCurrent: 15 });
      await combatRepo.updateCombatantState("comb-goblin", { hpCurrent: 5 });

      await combatRepo.updateCombatantState("comb-wizard", {
        resources: {
          resourcePools: [
            { name: "spellSlot_5", current: 1, max: 1 },
          ],
        },
      });

      const result = await handler.handleCastSpell(
        SESSION_ID,
        ENCOUNTER_ID,
        ACTOR_ID,
        { spellName: "Mass Cure Wounds" },
        massCureCharacters,
        massCureRoster,
      );

      expect(result.type).toBe("SIMPLE_ACTION_COMPLETE");

      // Goblin should NOT be healed
      const combatantsAfter = await combatRepo.listCombatants(ENCOUNTER_ID);
      const goblin = combatantsAfter.find((c) => c.monsterId === TARGET_ID)!;
      expect(goblin.hpCurrent).toBe(5);
    });

    it("revives unconscious allies at 0 HP", async () => {
      await combatRepo.updateCombatantState("comb-fighter", {
        hpCurrent: 0,
        conditions: ["Unconscious"],
        resources: { resourcePools: [], deathSaves: { successes: 1, failures: 2 } },
      });

      await combatRepo.updateCombatantState("comb-wizard", {
        resources: {
          resourcePools: [
            { name: "spellSlot_5", current: 1, max: 1 },
          ],
        },
      });

      // Wizard is at full HP (30/30), so only fighter gets healed
      const result = await handler.handleCastSpell(
        SESSION_ID,
        ENCOUNTER_ID,
        ACTOR_ID,
        { spellName: "Mass Cure Wounds" },
        massCureCharacters,
        massCureRoster,
      );

      expect(result.type).toBe("SIMPLE_ACTION_COMPLETE");
      expect(result.message).toContain("revived!");

      const combatantsAfter = await combatRepo.listCombatants(ENCOUNTER_ID);
      const fighter = combatantsAfter.find((c) => c.characterId === ALLY_ID)!;
      expect(fighter.hpCurrent).toBeGreaterThan(0);
      expect(fighter.conditions).not.toContain("Unconscious");

      const res = fighter.resources as any;
      expect(res.deathSaves).toEqual({ successes: 0, failures: 0 });
    });

    it("skips dead combatants (3 death save failures)", async () => {
      await combatRepo.updateCombatantState("comb-fighter", {
        hpCurrent: 0,
        conditions: ["Unconscious"],
        resources: { resourcePools: [], deathSaves: { successes: 0, failures: 3 } },
      });

      await combatRepo.updateCombatantState("comb-wizard", {
        hpCurrent: 15,
        resources: {
          resourcePools: [
            { name: "spellSlot_5", current: 1, max: 1 },
          ],
        },
      });

      const result = await handler.handleCastSpell(
        SESSION_ID,
        ENCOUNTER_ID,
        ACTOR_ID,
        { spellName: "Mass Cure Wounds" },
        massCureCharacters,
        massCureRoster,
      );

      expect(result.type).toBe("SIMPLE_ACTION_COMPLETE");

      // Dead fighter should NOT be healed
      const combatantsAfter = await combatRepo.listCombatants(ENCOUNTER_ID);
      const fighter = combatantsAfter.find((c) => c.characterId === ALLY_ID)!;
      expect(fighter.hpCurrent).toBe(0);

      // Only wizard healed (1 target)
      expect(result.message).toContain("1 target(s)");
    });

    it("falls through to single-target path when targetName is provided on AoE spell", async () => {
      await combatRepo.updateCombatantState("comb-fighter", { hpCurrent: 20 });

      await combatRepo.updateCombatantState("comb-wizard", {
        resources: {
          resourcePools: [
            { name: "spellSlot_5", current: 1, max: 1 },
          ],
        },
      });

      // Even though Mass Cure Wounds has area, providing a target uses single-target path
      const result = await handler.handleCastSpell(
        SESSION_ID,
        ENCOUNTER_ID,
        ACTOR_ID,
        { spellName: "Mass Cure Wounds", targetName: "Fighter" },
        massCureCharacters,
        massCureRoster,
      );

      expect(result.type).toBe("SIMPLE_ACTION_COMPLETE");
      expect(result.message).toContain("on Fighter");
    });
  });
});
