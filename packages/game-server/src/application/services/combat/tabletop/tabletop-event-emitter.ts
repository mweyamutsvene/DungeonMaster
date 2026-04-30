/**
 * Event emission and narration helpers for the tabletop combat flow.
 *
 * Encapsulates:
 * - generateNarration(): LLM narrative flavor text
 * - emitAttackEvents(): SSE attack resolved + narrative
 * - emitDamageEvents(): SSE damage applied + narrative
 * - markActionSpent(): consume one attack from the action economy
 */

import { nanoid } from "nanoid";
import type { ICombatRepository } from "../../../repositories/combat-repository.js";
import type { IEventRepository } from "../../../repositories/event-repository.js";
import type { INarrativeGenerator } from "../../../../infrastructure/llm/narrative-generator.js";
import { useAttack } from "../helpers/resource-utils.js";

export interface TabletopEventEmitterDeps {
  combatRepo: ICombatRepository;
  events?: IEventRepository;
  narrativeGenerator?: INarrativeGenerator;
  debugLogsEnabled: boolean;
}

export class TabletopEventEmitter {
  constructor(private readonly deps: TabletopEventEmitterDeps) {}

  /**
   * Generate narrative flavor text for an event using the LLM.
   * Returns undefined if no narrative generator is configured.
   */
  async generateNarration(eventType: string, payload: Record<string, unknown>): Promise<string | undefined> {
    if (!this.deps.narrativeGenerator) {
      return undefined;
    }

    try {
      const narration = await this.deps.narrativeGenerator.narrate({
        storyFramework: { genre: "fantasy", tone: "heroic", ...(payload.actorName ? { actorName: payload.actorName } : {}) },
        events: [{ type: eventType, payload }],
      });
      return narration;
    } catch (err) {
      if (this.deps.debugLogsEnabled) {
        console.error("[TabletopCombat] Narration failed:", err);
      }
      return undefined;
    }
  }

  /**
   * Consume one attack from the actor's action economy.
   */
  async markActionSpent(encounterId: string, actorId: string): Promise<void> {
    const combatantStates = await this.deps.combatRepo.listCombatants(encounterId);
    const actorCombatant = combatantStates.find(
      (c: any) => c.characterId === actorId || c.monsterId === actorId || c.npcId === actorId,
    );
    if (actorCombatant) {
      const updatedResources = useAttack(actorCombatant.resources ?? {});
      await this.deps.combatRepo.updateCombatantState(actorCombatant.id, {
        resources: updatedResources as any,
      });
    }
  }

  /**
   * Emit SSE events for an attack resolution (hit/miss).
   */
  async emitAttackEvents(
    sessionId: string,
    encounterId: string,
    attackerId: string,
    targetId: string,
    characters: any[],
    monsters: any[],
    hit: boolean,
    rollValue: number,
    total: number,
    opts?: { attackBonus?: number; targetAC?: number; attackName?: string },
  ): Promise<void> {
    if (!this.deps.events) return;

    const attackerRef = { type: "Character" as const, characterId: attackerId };
    const targetRef = monsters.some((m) => m.id === targetId)
      ? ({ type: "Monster" as const, monsterId: targetId } as const)
      : characters.some((c) => c.id === targetId)
        ? ({ type: "Character" as const, characterId: targetId } as const)
        : ({ type: "NPC" as const, npcId: targetId } as const);

    const attackerName = characters.find((c) => c.id === attackerId)?.name ?? "Player";
    const targetName = monsters.find((m) => m.id === targetId)?.name ?? characters.find((c) => c.id === targetId)?.name ?? "Target";

    await this.deps.events.append(sessionId, {
      id: nanoid(),
      type: "AttackResolved",
      payload: {
        encounterId,
        attacker: attackerRef,
        target: targetRef,
        attackName: opts?.attackName ?? "Attack",
        attackRoll: rollValue,
        attackBonus: opts?.attackBonus ?? (total - rollValue),
        attackTotal: total,
        targetAC: opts?.targetAC,
        hit,
        critical: rollValue === 20,
        result: {
          hit,
          critical: rollValue === 20,
          attack: { d20: rollValue, total },
          damage: { applied: 0, roll: { total: 0, rolls: [] } },
        },
      },
    });

    await this.deps.events.append(sessionId, {
      id: nanoid(),
      type: "NarrativeText",
      payload: {
        encounterId,
        actor: attackerRef,
        actorName: attackerName,
        text: hit
          ? `${attackerName} strikes ${targetName}!`
          : `${attackerName} swings at ${targetName} but misses.`,
      },
    });
  }

  /**
   * Emit SSE events for damage application.
   */
  async emitDamageEvents(
    sessionId: string,
    encounterId: string,
    attackerId: string,
    targetId: string,
    characters: any[],
    monsters: any[],
    totalDamage: number,
    hpAfter: number,
  ): Promise<void> {
    if (!this.deps.events) return;

    const attackerRef = { type: "Character" as const, characterId: attackerId };
    const targetRef = monsters.some((m) => m.id === targetId)
      ? ({ type: "Monster" as const, monsterId: targetId } as const)
      : characters.some((c) => c.id === targetId)
        ? ({ type: "Character" as const, characterId: targetId } as const)
        : ({ type: "NPC" as const, npcId: targetId } as const);

    const attackerName = characters.find((c) => c.id === attackerId)?.name ?? "Player";
    const targetName = monsters.find((m) => m.id === targetId)?.name ?? characters.find((c) => c.id === targetId)?.name ?? "Target";

    await this.deps.events.append(sessionId, {
      id: nanoid(),
      type: "DamageApplied",
      payload: {
        encounterId,
        target: targetRef,
        amount: totalDamage,
        hpCurrent: hpAfter,
      },
    });

    await this.deps.events.append(sessionId, {
      id: nanoid(),
      type: "NarrativeText",
      payload: {
        encounterId,
        actor: attackerRef,
        actorName: attackerName,
        text:
          hpAfter === 0
            ? `${attackerName} deals ${totalDamage} damage to ${targetName}. ${targetName} falls!`
            : `${attackerName} deals ${totalDamage} damage to ${targetName}.`,
      },
    });
  }

  /**
   * Emit SSE events for healing application.
   */
  async emitHealingEvents(
    sessionId: string,
    encounterId: string,
    healerId: string,
    targetId: string,
    characters: any[],
    monsters: any[],
    healAmount: number,
    hpAfter: number,
  ): Promise<void> {
    if (!this.deps.events) return;

    const healerRef = characters.some((c) => c.id === healerId)
      ? ({ type: "Character" as const, characterId: healerId } as const)
      : monsters.some((m) => m.id === healerId)
        ? ({ type: "Monster" as const, monsterId: healerId } as const)
        : ({ type: "NPC" as const, npcId: healerId } as const);

    const targetRef = characters.some((c) => c.id === targetId)
      ? ({ type: "Character" as const, characterId: targetId } as const)
      : monsters.some((m) => m.id === targetId)
        ? ({ type: "Monster" as const, monsterId: targetId } as const)
        : ({ type: "NPC" as const, npcId: targetId } as const);

    const healerName = characters.find((c) => c.id === healerId)?.name ?? monsters.find((m) => m.id === healerId)?.name ?? "Healer";
    const targetName = characters.find((c) => c.id === targetId)?.name ?? monsters.find((m) => m.id === targetId)?.name ?? "Target";

    await this.deps.events.append(sessionId, {
      id: nanoid(),
      type: "HealingApplied",
      payload: {
        encounterId,
        healer: healerRef,
        target: targetRef,
        amount: healAmount,
        hpCurrent: hpAfter,
      },
    });

    await this.deps.events.append(sessionId, {
      id: nanoid(),
      type: "NarrativeText",
      payload: {
        encounterId,
        actor: healerRef,
        text: `${healerName} heals ${targetName} for ${healAmount} HP.`,
      },
    });
  }

  /**
   * Emit SSE events for concentration check results.
   */
  async emitConcentrationEvent(
    sessionId: string,
    encounterId: string,
    combatantId: string,
    characters: any[],
    monsters: any[],
    opts: {
      maintained: boolean;
      spellName: string;
      dc: number;
      roll: number;
      damage: number;
    },
  ): Promise<void> {
    if (!this.deps.events) return;

    const combatantRef = characters.some((c) => c.id === combatantId)
      ? ({ type: "Character" as const, characterId: combatantId } as const)
      : monsters.some((m) => m.id === combatantId)
        ? ({ type: "Monster" as const, monsterId: combatantId } as const)
        : ({ type: "NPC" as const, npcId: combatantId } as const);

    const combatantName =
      characters.find((c) => c.id === combatantId)?.name ??
      monsters.find((m) => m.id === combatantId)?.name ??
      "Caster";

    await this.deps.events.append(sessionId, {
      id: nanoid(),
      type: opts.maintained ? "ConcentrationMaintained" : "ConcentrationBroken",
      payload: {
        encounterId,
        combatant: combatantRef,
        spellName: opts.spellName,
        dc: opts.dc,
        roll: opts.roll,
        damage: opts.damage,
      },
    });

    await this.deps.events.append(sessionId, {
      id: nanoid(),
      type: "NarrativeText",
      payload: {
        encounterId,
        actor: combatantRef,
        text: opts.maintained
          ? `${combatantName} maintains concentration on ${opts.spellName}. (CON save: ${opts.roll} vs DC ${opts.dc})`
          : `${combatantName} loses concentration on ${opts.spellName}! (CON save: ${opts.roll} vs DC ${opts.dc})`,
      },
    });
  }
}
