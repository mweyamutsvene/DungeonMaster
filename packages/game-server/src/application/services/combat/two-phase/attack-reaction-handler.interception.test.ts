import { beforeEach, describe, expect, it } from "vitest";

import { AttackReactionHandler } from "./attack-reaction-handler.js";
import { CombatantResolver } from "../helpers/combatant-resolver.js";
import {
  InMemoryPendingActionRepository,
  MemoryCharacterRepository,
  MemoryCombatRepository,
  MemoryEventRepository,
  MemoryGameSessionRepository,
  MemoryMonsterRepository,
  MemoryNPCRepository,
} from "../../../../infrastructure/testing/memory-repos.js";
import type { PendingAttackData } from "../../../../domain/entities/combat/pending-action.js";

const sessionId = "session-interception";
const encounterId = "enc-interception";
const fighterCharacterId = "char-fighter-icep";
const wizardCharacterId = "char-wizard-icep";
const monsterId = "monster-ogre";
const fighterCombatantId = "combatant-fighter-icep";
const wizardCombatantId = "combatant-wizard-icep";
const monsterCombatantId = "combatant-ogre";

function queueRoller(queue: number[]) {
  const values = [...queue];
  return {
    rollDie(_sides: number, count = 1, modifier = 0) {
      let total = modifier;
      const rolls: number[] = [];
      for (let i = 0; i < count; i++) {
        const v = values.shift() ?? 1;
        total += v;
        rolls.push(v);
      }
      return { total, rolls };
    },
  };
}

/**
 * Interception reaction requires a protector who has:
 *   - hasInterceptionStyle = true
 *   - hasShieldEquipped OR hasWeaponEquipped
 *   - reaction available
 *   - within 5ft of the target
 * This suite fixes the Fighter at level 1 (PB +2) and shield-equipped.
 */
async function setupEncounter(args: {
  sessions: MemoryGameSessionRepository;
  combat: MemoryCombatRepository;
  characters: MemoryCharacterRepository;
  monsters: MemoryMonsterRepository;
}) {
  const { sessions, combat, characters, monsters } = args;
  await sessions.create({ id: sessionId, storyFramework: {} });

  await characters.createInSession(sessionId, {
    id: fighterCharacterId,
    name: "Thane",
    level: 1,
    className: "Fighter",
    sheet: {
      className: "Fighter",
      level: 1,
      armorClass: 18,
      maxHp: 12,
      currentHp: 12,
      abilityScores: {
        strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 10,
      },
    },
  });

  await characters.createInSession(sessionId, {
    id: wizardCharacterId,
    name: "Vex",
    level: 1,
    className: "Wizard",
    sheet: {
      className: "Wizard",
      level: 1,
      armorClass: 12,
      maxHp: 30,
      currentHp: 30,
      abilityScores: {
        strength: 8, dexterity: 14, constitution: 12, intelligence: 18, wisdom: 12, charisma: 10,
      },
    },
  });

  await monsters.createInSession(sessionId, {
    id: monsterId,
    name: "Ogre",
    monsterDefinitionId: null,
    statBlock: {
      armorClass: 11,
      hp: 59,
      maxHp: 59,
      abilityScores: {
        strength: 19, dexterity: 8, constitution: 16, intelligence: 5, wisdom: 7, charisma: 7,
      },
    },
  });

  await combat.createEncounter(sessionId, {
    id: encounterId,
    status: "Active",
    round: 1,
    turn: 0,
  });

  await combat.createCombatants(encounterId, [
    {
      id: fighterCombatantId,
      combatantType: "Character",
      characterId: fighterCharacterId,
      monsterId: null,
      npcId: null,
      initiative: 15,
      hpCurrent: 12,
      hpMax: 12,
      conditions: [],
      resources: {
        position: { x: 5, y: 0 },
        speed: 30,
        reactionUsed: false,
        hasProtectionStyle: false,
        hasInterceptionStyle: true,
        hasShieldEquipped: true,
        hasWeaponEquipped: true,
      },
    },
    {
      id: wizardCombatantId,
      combatantType: "Character",
      characterId: wizardCharacterId,
      monsterId: null,
      npcId: null,
      initiative: 12,
      hpCurrent: 30,
      hpMax: 30,
      conditions: [{ condition: "Concentrating", source: "bless", roundsRemaining: 10 }],
      resources: {
        position: { x: 0, y: 0 },
        speed: 30,
        reactionUsed: false,
      },
    },
    {
      id: monsterCombatantId,
      combatantType: "Monster",
      characterId: null,
      monsterId,
      npcId: null,
      initiative: 10,
      hpCurrent: 59,
      hpMax: 59,
      conditions: [],
      resources: {
        position: { x: 5, y: 5 },
        speed: 40,
        reach: 5,
      },
    },
  ]);
}

describe("AttackReactionHandler — Interception fighting style", () => {
  let sessions: MemoryGameSessionRepository;
  let combat: MemoryCombatRepository;
  let characters: MemoryCharacterRepository;
  let monsters: MemoryMonsterRepository;
  let npcs: MemoryNPCRepository;
  let pendingActions: InMemoryPendingActionRepository;
  let events: MemoryEventRepository;
  let handler: AttackReactionHandler;

  beforeEach(async () => {
    sessions = new MemoryGameSessionRepository();
    combat = new MemoryCombatRepository();
    characters = new MemoryCharacterRepository();
    monsters = new MemoryMonsterRepository();
    npcs = new MemoryNPCRepository();
    pendingActions = new InMemoryPendingActionRepository();
    events = new MemoryEventRepository();
    await setupEncounter({ sessions, combat, characters, monsters });

    const resolver = new CombatantResolver(characters, monsters, npcs);
    handler = new AttackReactionHandler(sessions, combat, resolver, pendingActions, events);
  });

  async function initAndAccept(damageSpec: PendingAttackData["damageSpec"]) {
    const initiated = await handler.initiate(sessionId, {
      encounterId,
      actor: { type: "Monster", monsterId },
      target: { type: "Character", characterId: wizardCharacterId },
      attackName: "Greatclub",
      attackRoll: 20,
    });
    expect(initiated.status).toBe("awaiting_reactions");
    const pendingActionId = initiated.pendingActionId!;

    // Prime damageSpec + totals on the pending action.
    const pending = await pendingActions.getById(pendingActionId);
    Object.assign(pending!.data as PendingAttackData, {
      d20Roll: 20,
      attackBonus: 0,
      attackTotal: 20,
      attackRoll: 20,
      rollMode: "normal" as const,
      originalRollMode: "normal" as const,
      targetAC: 12,
      damageSpec,
    });
    await pendingActions.update(pending!);

    const icepOpp = pending!.reactionOpportunities.find((o) => o.reactionType === "interception");
    expect(icepOpp, "Interception reaction should be offered").toBeDefined();
    await pendingActions.addReactionResponse(pendingActionId, {
      opportunityId: icepOpp!.id,
      combatantId: icepOpp!.combatantId,
      choice: "use",
      respondedAt: new Date(),
    });

    return pendingActionId;
  }

  it("reduces damage by 1d10 + protector PB (damage 15, reduction roll 6, PB 2 → final 7)", async () => {
    const pendingActionId = await initAndAccept({
      diceCount: 1, diceSides: 1, modifier: 14, damageType: "bludgeoning",
    });

    const completed = await handler.complete(
      sessionId,
      {
        pendingActionId,
        // Queue: damage d1 = 1, then Interception d10 = 6. Total raw damage = 1+14 = 15.
        // Reduction = 6 + PB(2) = 8. Final damage = 15 - 8 = 7.
        diceRoller: queueRoller([1, 6]),
      },
      { async initiateDamageReaction() { return { status: "no_reactions" as const }; } },
    );

    expect(completed.hit).toBe(true);
    expect(completed.damageApplied).toBe(7);

    const wizardState = (await combat.listCombatants(encounterId)).find((c) => c.id === wizardCombatantId);
    expect(wizardState?.hpCurrent).toBe(30 - 7);

    // Protector's reaction consumed.
    const fighterState = (await combat.listCombatants(encounterId)).find((c) => c.id === fighterCombatantId);
    expect((fighterState?.resources as { reactionUsed?: boolean }).reactionUsed).toBe(true);

    // InterceptionApplied event emitted with expected fields.
    const applied = (await events.listBySession(sessionId)).find((e) => e.type === "InterceptionApplied");
    expect(applied, "expected InterceptionApplied event").toBeDefined();
    expect(applied?.payload).toMatchObject({
      protectorId: fighterCombatantId,
      targetId: wizardCombatantId,
      interceptRoll: 6,
      profBonus: 2,
      reduction: 8,
      rawDamage: 15,
      finalDamage: 7,
    });
  });

  it("floors damage at 0 when reduction >= incoming damage", async () => {
    const pendingActionId = await initAndAccept({
      diceCount: 1, diceSides: 1, modifier: 9, damageType: "bludgeoning",
    });

    const completed = await handler.complete(
      sessionId,
      {
        pendingActionId,
        // damage d1 = 1 + 9 = 10. Interception d10 = 10; reduction = 10 + 2 = 12. Final = max(0, 10-12) = 0.
        diceRoller: queueRoller([1, 10]),
      },
      { async initiateDamageReaction() { return { status: "no_reactions" as const }; } },
    );

    expect(completed.hit).toBe(true);
    expect(completed.damageApplied).toBe(0);

    const wizardState = (await combat.listCombatants(encounterId)).find((c) => c.id === wizardCombatantId);
    // HP unchanged — damage was fully absorbed.
    expect(wizardState?.hpCurrent).toBe(30);

    // Concentration-save suppression assertion: the `if (damageApplied > 0)` guard
    // prevents the DamageApplied event from firing, which is what downstream
    // concentration-save triggers observe. Proxy assertion: no DamageApplied event.
    const recorded = await events.listBySession(sessionId);
    expect(recorded.find((e) => e.type === "DamageApplied")).toBeUndefined();

    // Protector's reaction still consumed.
    const fighterState = (await combat.listCombatants(encounterId)).find((c) => c.id === fighterCombatantId);
    expect((fighterState?.resources as { reactionUsed?: boolean }).reactionUsed).toBe(true);
  });
});
