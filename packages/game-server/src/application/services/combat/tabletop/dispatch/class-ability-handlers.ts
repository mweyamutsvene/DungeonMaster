/**
 * ClassAbilityHandlers — class ability and bonus-action ability handlers.
 *
 * Extracted from ActionDispatcher (Phase: God-Module Decomposition §2a).
 */

import { ValidationError } from "../../../../errors.js";
import { nanoid } from "nanoid";
import { calculateDistance } from "../../../../../domain/rules/movement.js";
import { getAbilityModifier, getProficiencyBonus } from "../../../../../domain/rules/ability-checks.js";
import { ClassFeatureResolver } from "../../../../../domain/entities/classes/class-feature-resolver.js";
import { createEffect } from "../../../../../domain/entities/combat/effects.js";
import type {
  SessionCharacterRecord,
  SessionMonsterRecord,
  SessionNPCRecord,
} from "../../../../types.js";
import type { LlmRoster, CombatantRef } from "../../../../commands/game-command.js";
import { inferActorRef } from "../combat-text-parser.js";
import {
  getPosition,
  normalizeResources,
  hasBonusActionAvailable,
  useBonusAction,
  spendResourceFromPool,
  addActiveEffectsToResources,
  getActiveEffects,
  setActiveEffects,
} from "../../helpers/resource-utils.js";
import { findCombatantByEntityId } from "../../helpers/combatant-lookup.js";
import { TabletopEventEmitter } from "../tabletop-event-emitter.js";
import { SavingThrowResolver } from "../rolls/saving-throw-resolver.js";
import type {
  TabletopCombatServiceDeps,
  ActionParseResult,
} from "../tabletop-types.js";
import type { AbilityActor, AbilityCombatContext } from "../../../../../domain/abilities/ability-executor.js";

// ─── Shared adapter helpers ────────────────────────────────────────────

function buildAbilityActor(
  actorId: string,
  name: string,
  hpCurrent: number,
  hpMax: number,
  speed: number,
): AbilityActor {
  return {
    getId: () => actorId,
    getName: () => name,
    getCurrentHP: () => hpCurrent,
    getMaxHP: () => hpMax,
    getSpeed: () => speed,
    modifyHP: (amount: number) => {
      const newHP = Math.min(hpMax, Math.max(0, hpCurrent + amount));
      return { actualChange: newHP - hpCurrent };
    },
  };
}

function buildTargetActor(
  targetRef: CombatantRef,
  targetName: string,
): AbilityActor {
  const getTargetId = (ref: CombatantRef): string => {
    if (ref.type === "Monster") return ref.monsterId!;
    if (ref.type === "Character") return ref.characterId!;
    return ref.npcId!;
  };
  return {
    getId: () => getTargetId(targetRef),
    getName: () => targetName,
    getCurrentHP: () => 0,
    getMaxHP: () => 0,
    getSpeed: () => 30,
    modifyHP: () => ({ actualChange: 0 }),
  };
}

function combatantRefToEntityId(ref: CombatantRef): string {
  if (ref.type === "Character") return ref.characterId!;
  if (ref.type === "Monster") return ref.monsterId!;
  return ref.npcId!;
}

export class ClassAbilityHandlers {
  constructor(
    private readonly deps: TabletopCombatServiceDeps,
    private readonly eventEmitter: TabletopEventEmitter,
    private readonly debugLogsEnabled: boolean,
  ) {}

  /**
   * Handle class abilities (like Action Surge) via AbilityRegistry.
   * These are abilities that don't consume action economy but may consume class resources.
   */
  async handleClassAbility(
    sessionId: string,
    encounterId: string,
    actorId: string,
    abilityId: string,
    characters: SessionCharacterRecord[],
    monsters: SessionMonsterRecord[],
    npcs: SessionNPCRecord[],
    roster: LlmRoster,
    text: string,
  ): Promise<ActionParseResult> {
    const actor = inferActorRef(actorId, roster);

    if (actor.type !== "Character") {
      throw new ValidationError("Class abilities can only be used by characters");
    }

    const character = characters.find((c) => c.id === actorId);
    if (!character) {
      throw new ValidationError("Character not found");
    }

    const sheet = (character.sheet ?? {}) as any;
    const level = sheet?.level ?? character?.level ?? 1;
    const className = sheet?.className ?? character?.className ?? "";

    const combatantStates = await this.deps.combatRepo.listCombatants(encounterId);
    const actorCombatant = combatantStates.find(
      (c: any) => c.combatantType === "Character" && c.characterId === actorId,
    );
    if (!actorCombatant) {
      throw new ValidationError("Character not in combat");
    }

    const resources = actorCombatant.resources ?? {};

    // Resolve target from action text or nearest hostile. Some class actions are untargeted,
    // so missing target remains valid unless the executor requires one.
    const actorPos = getPosition(actorCombatant.resources ?? {});
    let targetRef: CombatantRef | null = null;
    let targetName: string | null = null;

    const lowerText = text.toLowerCase();
    for (const monster of monsters) {
      if (lowerText.includes(monster.name.toLowerCase())) {
        targetRef = { type: "Monster", monsterId: monster.id };
        targetName = monster.name;
        break;
      }
    }

    if (!targetRef) {
      for (const npc of npcs) {
        if (lowerText.includes(npc.name.toLowerCase())) {
          targetRef = { type: "NPC", npcId: npc.id };
          targetName = npc.name;
          break;
        }
      }
    }

    if (!targetRef && actorPos) {
      const hostiles = combatantStates.filter((c: any) => c.hpCurrent > 0 && c.id !== actorCombatant.id && c.combatantType !== "Character");
      if (hostiles.length > 0) {
        let nearest = hostiles[0]!;
        let minDist = Infinity;
        for (const hostile of hostiles) {
          const hostilePos = getPosition(hostile.resources ?? {});
          if (!hostilePos) continue;
          const dist = calculateDistance(actorPos, hostilePos);
          if (dist < minDist) {
            minDist = dist;
            nearest = hostile;
          }
        }

        if (nearest.combatantType === "Monster" && nearest.monsterId) {
          targetRef = { type: "Monster", monsterId: nearest.monsterId };
          targetName = monsters.find((m) => m.id === nearest.monsterId)?.name ?? "target";
        } else if (nearest.combatantType === "NPC" && nearest.npcId) {
          targetRef = { type: "NPC", npcId: nearest.npcId };
          targetName = npcs.find((n) => n.id === nearest.npcId)?.name ?? "target";
        }
      }
    }

    const targetActor: AbilityActor | undefined = targetRef
      ? buildTargetActor(targetRef, targetName ?? "target")
      : undefined;

    let brutalStrikeVariant: "hamstring-blow" | "forceful-blow" | "staggering-blow" | undefined;
    const normalizedText = text.toLowerCase();
    if (normalizedText.includes("forceful")) brutalStrikeVariant = "forceful-blow";
    else if (normalizedText.includes("staggering")) brutalStrikeVariant = "staggering-blow";
    else if (normalizedText.includes("hamstring") || normalizedText.includes("brutal strike")) brutalStrikeVariant = "hamstring-blow";

    const mockCreature = buildAbilityActor(
      actorId,
      character.name,
      actorCombatant.hpCurrent ?? sheet?.currentHp ?? sheet?.maxHp ?? 0,
      actorCombatant.hpMax ?? sheet?.maxHp ?? 0,
      sheet?.speed ?? 30,
    );

    const mockCombat: AbilityCombatContext = {
      hasUsedAction: () => false,
      getRound: () => 0,
      getTurnIndex: () => 0,
      addEffect: () => {},
      getPosition: () => undefined,
      setPosition: () => {},
    };

    const result = await this.deps.abilityRegistry.execute({
      sessionId,
      encounterId,
      actor: mockCreature,
      combat: mockCombat,
      abilityId,
      target: targetActor,
      params: {
        actor,
        target: targetRef ?? undefined,
        targetId: targetRef ? combatantRefToEntityId(targetRef) : undefined,
        targetName,
        variant: brutalStrikeVariant,
        resources,
        className,
        level,
        sheet,
      },
      services: {},
    });

    if (!result.success) {
      throw new ValidationError(result.error || result.summary);
    }

    let updatedResources = result.data?.updatedResources;
    if (updatedResources) {
      // Stamp round/turn on any ActiveEffects that lack them (for proper expiry tracking)
      const encounter = await this.deps.combatRepo.getEncounterById(encounterId);
      const round = encounter?.round ?? 1;
      const turn = encounter?.turn ?? 0;
      const effects = getActiveEffects(updatedResources as any);
      const needsStamp = effects.some(e => e.appliedAtRound === undefined);
      if (needsStamp) {
        const stamped = effects.map(e =>
          e.appliedAtRound === undefined
            ? { ...e, appliedAtRound: round, appliedAtTurnIndex: turn }
            : e
        );
        updatedResources = setActiveEffects(updatedResources as any, stamped);
      }

      await this.deps.combatRepo.updateCombatantState(actorCombatant.id, {
        resources: updatedResources as any,
      });
    }

    // ── AoE post-processing: Turn Undead ──────────────────────────────
    // The executor validated resource spend; now resolve saves against
    // each Undead within 30 ft and apply Frightened on failure.
    if (result.data?.aoeEffect === "turnUndead" && this.deps.diceRoller) {
      const turnSummary = await this.processTurnUndeadAoE(
        sessionId,
        encounterId,
        actorId,
        actorCombatant,
        result.data.saveDC as number,
        (result.data.saveAbility as string) || "wisdom",
        characters,
      );
      if (turnSummary) {
        return {
          requiresPlayerInput: false,
          actionComplete: true,
          type: "SIMPLE_ACTION_COMPLETE",
          action: "Turn Undead",
          message: `${result.summary} ${turnSummary}`,
        };
      }
    }

    // Brutal Strike is validated by the executor, but variant-specific damage/effects are
    // resolved here against the concrete target combatant in encounter state.
    if (result.data?.brutalStrikeVariant && result.data?.brutalStrikeTargetId) {
      const brutalSummary = await this.processBrutalStrike(
        encounterId,
        actorId,
        result.data,
        characters,
        monsters,
        npcs,
      );
      return {
        requiresPlayerInput: false,
        actionComplete: true,
        type: "SIMPLE_ACTION_COMPLETE",
        action: (result.data?.abilityName as string) ?? abilityId,
        message: brutalSummary ? `${result.summary} ${brutalSummary}` : result.summary,
      };
    }

    return {
      requiresPlayerInput: false,
      actionComplete: true,
      type: "SIMPLE_ACTION_COMPLETE",
      action: (result.data?.abilityName as string) ?? abilityId,
      message: result.summary,
    };
  }

  private parseDiceNotation(dice: string): { count: number; sides: number } {
    const m = dice.trim().toLowerCase().match(/^(\d+)d(\d+)$/);
    if (!m) return { count: 1, sides: 6 };
    const count = Math.max(1, Number.parseInt(m[1]!, 10));
    const sides = Math.max(2, Number.parseInt(m[2]!, 10));
    return { count, sides };
  }

  private resolveEntityName(
    entityId: string,
    characters: SessionCharacterRecord[],
    monsters: SessionMonsterRecord[],
    npcs: SessionNPCRecord[],
  ): string {
    const char = characters.find((c) => c.id === entityId);
    if (char) return char.name;
    const monster = monsters.find((m) => m.id === entityId);
    if (monster) return monster.name;
    const npc = npcs.find((n) => n.id === entityId);
    if (npc) return npc.name;
    return "target";
  }

  private async processBrutalStrike(
    encounterId: string,
    actorId: string,
    data: Record<string, unknown>,
    characters: SessionCharacterRecord[],
    monsters: SessionMonsterRecord[],
    npcs: SessionNPCRecord[],
  ): Promise<string | null> {
    if (!this.deps.diceRoller) return null;

    const targetId = typeof data.brutalStrikeTargetId === "string" ? data.brutalStrikeTargetId : "";
    const variant = typeof data.brutalStrikeVariant === "string" ? data.brutalStrikeVariant : "hamstring-blow";
    const bonusDice = typeof data.brutalStrikeBonusDice === "string" ? data.brutalStrikeBonusDice : "1d6";
    if (!targetId) return null;

    const encounter = await this.deps.combatRepo.getEncounterById(encounterId);
    const round = encounter?.round ?? 1;
    const turn = encounter?.turn ?? 0;

    const combatants = await this.deps.combatRepo.listCombatants(encounterId);
    const targetCombatant = findCombatantByEntityId(combatants, targetId);
    if (!targetCombatant || targetCombatant.hpCurrent <= 0) return null;

    const actorCharacter = characters.find((c) => c.id === actorId);
    const actorSheet = (actorCharacter?.sheet ?? {}) as Record<string, unknown>;

    // Bonus damage: roll the brutal strike die and apply directly to HP.
    const { count, sides } = this.parseDiceNotation(bonusDice);
    const damageRoll = this.deps.diceRoller.rollDie(sides, count);
    const bonusDamage = Math.max(0, damageRoll.total);

    let hpAfter = targetCombatant.hpCurrent;
    if (bonusDamage > 0) {
      hpAfter = Math.max(0, targetCombatant.hpCurrent - bonusDamage);
      await this.deps.combatRepo.updateCombatantState(targetCombatant.id, {
        hpCurrent: hpAfter,
      });
    }

    const targetName = this.resolveEntityName(targetId, characters, monsters, npcs);

    if (variant === "hamstring-blow") {
      const hamstringEffect = createEffect(
        nanoid(),
        "speed_multiplier",
        "speed",
        "until_start_of_next_turn",
        {
          value: 0.5,
          source: "Brutal Strike: Hamstring Blow",
          sourceCombatantId: actorId,
          appliedAtRound: round,
          appliedAtTurnIndex: turn,
          expiresAt: { event: "start_of_turn", combatantId: actorId },
          description: "Speed is halved until the start of the barbarian's next turn.",
        },
      );
      const updatedResources = addActiveEffectsToResources(targetCombatant.resources ?? {}, hamstringEffect);
      await this.deps.combatRepo.updateCombatantState(targetCombatant.id, {
        resources: updatedResources as any,
      });
      return `${targetName} takes ${bonusDamage} bonus damage (${bonusDice}) and has speed halved until the start of your next turn.`;
    }

    if (variant === "forceful-blow") {
      const abilityScores = (actorSheet.abilityScores ?? {}) as Record<string, unknown>;
      const strScoreRaw = abilityScores.strength ?? abilityScores.str ?? 10;
      const strScore = typeof strScoreRaw === "number" ? strScoreRaw : 10;
      const levelRaw = actorSheet.level ?? actorCharacter?.level ?? 1;
      const level = typeof levelRaw === "number" ? levelRaw : 1;
      const saveDC = 8 + getAbilityModifier(strScore) + getProficiencyBonus(level);

      const savingThrowResolver = new SavingThrowResolver(
        this.deps.combatRepo,
        this.deps.diceRoller,
        this.debugLogsEnabled,
      );
      const saveAction = savingThrowResolver.buildPendingAction({
        actorId: targetId,
        sourceId: actorId,
        ability: "strength",
        dc: saveDC,
        reason: "Brutal Strike (Forceful Blow)",
        onSuccess: { summary: "Resists the shove." },
        onFailure: {
          summary: "Pushed 15 feet.",
          movement: { push: 15 },
        },
      });

      const resolution = await savingThrowResolver.resolve(
        saveAction,
        encounterId,
        characters,
        monsters,
        npcs,
      );

      const pushSummary = resolution.success
        ? `${targetName} succeeds STR save (${resolution.total} vs DC ${saveDC}) and is not pushed.`
        : `${targetName} fails STR save (${resolution.total} vs DC ${saveDC}) and is pushed 15 feet.`;
      return `${targetName} takes ${bonusDamage} bonus damage (${bonusDice}). ${pushSummary}`;
    }

    if (variant === "staggering-blow") {
      const staggeringEffect = createEffect(
        nanoid(),
        "disadvantage",
        "custom",
        "until_triggered",
        {
          source: "Brutal Strike: Staggering Blow",
          sourceCombatantId: actorId,
          appliedAtRound: round,
          appliedAtTurnIndex: turn,
          expiresAt: { event: "start_of_turn", combatantId: actorId },
          description: "Disadvantage on the next attack roll or saving throw.",
        },
      );
      const updatedResources = addActiveEffectsToResources(targetCombatant.resources ?? {}, staggeringEffect);
      await this.deps.combatRepo.updateCombatantState(targetCombatant.id, {
        resources: updatedResources as any,
      });
      return `${targetName} takes ${bonusDamage} bonus damage (${bonusDice}) and has disadvantage on the next attack roll or saving throw before the start of your next turn.`;
    }

    return `${targetName} takes ${bonusDamage} bonus damage (${bonusDice}).`;
  }

  /**
   * Resolve Turn Undead AoE: find all Undead monsters within 30 ft,
   * roll Wisdom saving throws, and apply Frightened on failure.
   *
   * @returns A summary string of results, or null if no undead were in range.
   */
  private async processTurnUndeadAoE(
    sessionId: string,
    encounterId: string,
    actorId: string,
    actorCombatant: { resources: unknown },
    saveDC: number,
    saveAbility: string,
    characters: SessionCharacterRecord[],
  ): Promise<string | null> {
    const allCombatants = await this.deps.combatRepo.listCombatants(encounterId);
    const actorResNorm = normalizeResources(actorCombatant.resources);
    const actorPos = getPosition(actorResNorm);
    if (!actorPos) return null;

    const monsters = await this.deps.monsters.listBySession(sessionId);
    const npcs = await this.deps.npcs.listBySession(sessionId);

    const savingThrowResolver = new SavingThrowResolver(
      this.deps.combatRepo,
      this.deps.diceRoller!,
      this.debugLogsEnabled,
    );

    const turnResults: string[] = [];

    for (const combatant of allCombatants) {
      if (combatant.combatantType !== "Monster" || !combatant.monsterId) continue;

      // Check if the monster is Undead
      const monsterRecord = monsters.find((m: any) => m.id === combatant.monsterId);
      if (!monsterRecord) continue;
      const statBlock = monsterRecord.statBlock as Record<string, unknown> | null;
      const creatureType = ((statBlock?.type as string) ?? "").toLowerCase();
      if (creatureType !== "undead") continue;

      // Check within 30 ft
      const cRes = normalizeResources(combatant.resources);
      const cPos = getPosition(cRes);
      if (!cPos) continue;
      const dist = calculateDistance(actorPos, cPos);
      if (dist > 30) continue;

      // Build & resolve the Wisdom saving throw
      const saveAction = savingThrowResolver.buildPendingAction({
        actorId: combatant.monsterId,
        sourceId: actorId,
        ability: saveAbility,
        dc: saveDC,
        reason: "Turn Undead",
        onSuccess: { summary: "Resists the turning" },
        onFailure: {
          summary: "Turned!",
          conditions: { add: ["Frightened"] },
        },
      });

      const resolution = await savingThrowResolver.resolve(
        saveAction,
        encounterId,
        characters,
        monsters as any[],
        npcs as any[],
      );

      const monsterName = monsterRecord.name ?? "Unknown";
      if (resolution.success) {
        turnResults.push(`${monsterName} succeeds (rolled ${resolution.total} vs DC ${saveDC})`);
      } else {
        turnResults.push(`${monsterName} fails (rolled ${resolution.total} vs DC ${saveDC}) — Frightened!`);
      }
    }

    return turnResults.length > 0 ? turnResults.join("; ") : null;
  }

  /**
   * Handle bonus actions via AbilityRegistry.
   * Builds execution context and delegates to the registered executor.
   *
   * @param skipBonusActionCost - If true, don't check/consume bonus action (Nick mastery)
   */
  async handleBonusAbility(
    sessionId: string,
    encounterId: string,
    actorId: string,
    abilityId: string,
    text: string,
    characters: SessionCharacterRecord[],
    monsters: SessionMonsterRecord[],
    npcs: SessionNPCRecord[],
    roster: LlmRoster,
    skipBonusActionCost = false,
  ): Promise<ActionParseResult> {
    // Check bonus action economy before executing (skipped for Nick mastery)
    if (!skipBonusActionCost) {
      const combatantStatesForCheck = await this.deps.combatRepo.listCombatants(encounterId);
      const actorCombatantForCheck = combatantStatesForCheck.find(
        (c: any) => c.combatantType === "Character" && c.characterId === actorId,
      );
      if (actorCombatantForCheck && !hasBonusActionAvailable(actorCombatantForCheck.resources)) {
        throw new ValidationError("Actor has already spent their bonus action this turn");
      }
    }

    const actorChar = characters.find((c) => c.id === actorId);
    if (!actorChar) {
      throw new ValidationError("Actor not found");
    }

    const actorSheet = (actorChar?.sheet ?? {}) as any;
    const actorClassName = actorChar?.className ?? actorSheet?.className ?? "";
    const actorLevel = ClassFeatureResolver.getLevel(actorSheet, actorChar?.level);

    const combatantStates = await this.deps.combatRepo.listCombatants(encounterId);
    const actorCombatant = combatantStates.find(
      (c: any) => c.combatantType === "Character" && c.characterId === actorId,
    );
    if (!actorCombatant) {
      throw new ValidationError("Actor not found in encounter");
    }

    const actorPos = getPosition(actorCombatant.resources ?? {});
    const resources = (actorCombatant.resources as any) ?? {};

    // Infer target from text or find nearest enemy
    let targetRef: CombatantRef | null = null;
    let targetName: string | null = null;

    for (const m of monsters) {
      if (text.toLowerCase().includes(m.name.toLowerCase())) {
        targetRef = { type: "Monster", monsterId: m.id };
        targetName = m.name;
        break;
      }
    }

    if (!targetRef && actorPos) {
      const hostiles = combatantStates.filter(
        (c: any) => c.combatantType === "Monster" && c.hpCurrent > 0,
      );
      if (hostiles.length > 0) {
        let nearest = hostiles[0];
        let minDist = Infinity;
        for (const h of hostiles) {
          const hPos = getPosition(h.resources ?? {});
          if (!hPos) continue;
          const d = calculateDistance(actorPos, hPos);
          if (d < minDist) {
            minDist = d;
            nearest = h;
          }
        }
        targetRef = { type: "Monster", monsterId: nearest.monsterId! };
        targetName = monsters.find((m) => m.id === nearest.monsterId)?.name ?? "target";
      }
    }

    const actorRef = inferActorRef(actorId, roster);

    // Build services object for executor (bonus action abilities bypass regular action economy)
    const services = {
      attack: (params: any) => this.deps.actions.attack(sessionId, params),
      move: (params: any) => this.deps.twoPhaseActions.initiateMove(sessionId, params),
      disengage: (params: any) => this.deps.actions.disengage(sessionId, { ...params, skipActionCheck: true }),
      dash: (params: any) => this.deps.actions.dash(sessionId, { ...params, skipActionCheck: true }),
      dodge: (params: any) => this.deps.actions.dodge(sessionId, { ...params, skipActionCheck: true }),
      hide: (params: any) => this.deps.actions.hide(sessionId, { ...params, isBonusAction: true, skipActionCheck: true }),
    };

    const mockCreature = buildAbilityActor(
      actorId,
      actorChar.name,
      actorCombatant.hpCurrent ?? actorSheet?.currentHp ?? actorSheet?.maxHp ?? 0,
      actorCombatant.hpMax ?? actorSheet?.maxHp ?? 0,
      actorSheet?.speed ?? 30,
    );

    const mockCombat: AbilityCombatContext = {
      hasUsedAction: (_actorId: string, _actionType: string) => {
        return true;
      },
      getRound: () => 0,
      getTurnIndex: () => 0,
      addEffect: () => {},
      getPosition: () => undefined,
      setPosition: () => {},
    };

    const targetActor: AbilityActor | undefined = targetRef
      ? buildTargetActor(targetRef, targetName ?? "target")
      : undefined;

    const result = await this.deps.abilityRegistry.execute({
      sessionId,
      encounterId,
      actor: mockCreature,
      combat: mockCombat,
      abilityId,
      target: targetActor,
      params: {
        actor: actorRef,
        target: targetRef,
        targetName,
        resources,
        className: actorClassName,
        level: actorLevel,
        sheet: actorSheet,
        tabletopMode: true,
        text,
      },
      services,
    });

    // Handle result
    if (!result.success) {
      throw new ValidationError(result.error || result.summary);
    }

    // If executor returned pendingAction for tabletop flow
    if (result.requiresPlayerInput && result.pendingAction) {
      await this.deps.combatRepo.setPendingAction(encounterId, result.pendingAction as any);

      const currentResources = actorCombatant.resources ?? {};
      let updatedResourcesForBonus = skipBonusActionCost
        ? currentResources
        : useBonusAction(currentResources);

      // Track Nick mastery usage (once per turn)
      if (skipBonusActionCost) {
        updatedResourcesForBonus = {
          ...(updatedResourcesForBonus as Record<string, unknown>),
          nickUsedThisTurn: true,
        } as typeof updatedResourcesForBonus;
      }

      // Spend resource pools upfront (e.g., ki for Flurry of Blows)
      // This must happen when the ability is initiated, not when dice resolve,
      // because the resource commitment is made at ability activation time.
      if (result.resourcesSpent?.kiPoints) {
        try {
          updatedResourcesForBonus = spendResourceFromPool(updatedResourcesForBonus, "ki", result.resourcesSpent.kiPoints);
        } catch {
          // If spending fails, log but continue - the executor already validated
        }
      }
      if (result.resourcesSpent?.secondWind) {
        try {
          updatedResourcesForBonus = spendResourceFromPool(updatedResourcesForBonus, "secondWind", result.resourcesSpent.secondWind);
        } catch {
          // If spending fails, log but continue - the executor already validated
        }
      }

      await this.deps.combatRepo.updateCombatantState(actorCombatant.id, {
        resources: updatedResourcesForBonus as any,
      });

      const narration = await this.eventEmitter.generateNarration("attackRequest", {
        attackerName: actorChar.name,
        targetName: targetName ?? "target",
      });

      return {
        requiresPlayerInput: true,
        type: "REQUEST_ROLL",
        rollType: result.rollType ?? "attack",
        message: result.summary,
        narration,
        diceNeeded: result.diceNeeded ?? "d20",
        pendingAction: result.pendingAction as any,
        actionComplete: false,
      };
    }

    // Executor completed the action (e.g., patient-defense, step-of-the-wind)
    let updatedResourcesForComplete = skipBonusActionCost
      ? resources
      : useBonusAction(resources);

    // Track Nick mastery usage (once per turn)
    if (skipBonusActionCost) {
      updatedResourcesForComplete = {
        ...(updatedResourcesForComplete as Record<string, unknown>),
        nickUsedThisTurn: true,
      } as typeof updatedResourcesForComplete;
    }
    if (result.resourcesSpent?.kiPoints) {
      try {
        updatedResourcesForComplete = spendResourceFromPool(updatedResourcesForComplete, "ki", result.resourcesSpent.kiPoints);
      } catch {
        // If spending fails, log but continue - the executor already validated
      }
    }

    if (result.resourcesSpent?.secondWind) {
      try {
        updatedResourcesForComplete = spendResourceFromPool(updatedResourcesForComplete, "secondWind", result.resourcesSpent.secondWind);
      } catch {
        // If spending fails, log but continue - the executor already validated
      }
    }

    // Handle generic resource pool spending (e.g., wholeness_of_body)
    if (result.data?.spendResource) {
      const { poolName, amount } = result.data.spendResource as { poolName: string; amount: number };
      if (poolName && amount && poolName !== "ki" && poolName !== "secondWind") {
        try {
          updatedResourcesForComplete = spendResourceFromPool(updatedResourcesForComplete, poolName, amount);
        } catch {
          // If spending fails, log but continue - the executor already validated
        }
      }
    }

    // Merge custom flags from executor's updatedResources (e.g., raging, rageDamageBonus)
    // The executor may set flags that the standard pool-spending logic doesn't know about.
    if (result.data?.updatedResources) {
      const executorResources = result.data.updatedResources as Record<string, unknown>;
      updatedResourcesForComplete = {
        ...(updatedResourcesForComplete as Record<string, unknown>),
        ...executorResources,
        // Only mark bonus action as used if we're not skipping the cost (Nick mastery preserves it)
        ...(skipBonusActionCost ? {} : { bonusActionUsed: true }),
      } as typeof updatedResourcesForComplete;
    }

    // Persist jumpDistanceMultiplier from abilities like Step of the Wind
    // so that the jump action can read it from combatant resources.
    if (result.data?.jumpMultiplier && typeof result.data.jumpMultiplier === "number") {
      updatedResourcesForComplete = {
        ...(updatedResourcesForComplete as Record<string, unknown>),
        jumpDistanceMultiplier: result.data.jumpMultiplier,
      } as typeof updatedResourcesForComplete;
    }

    // Build update object
    const updateData: { resources: any; hpCurrent?: number } = {
      resources: updatedResourcesForComplete as any,
    };

    if (result.data?.hpUpdate && typeof (result.data.hpUpdate as any).hpCurrent === "number") {
      updateData.hpCurrent = (result.data.hpUpdate as any).hpCurrent;
    }

    await this.deps.combatRepo.updateCombatantState(actorCombatant.id, updateData);

    return {
      requiresPlayerInput: false,
      actionComplete: true,
      type: "SIMPLE_ACTION_COMPLETE",
      action: abilityId,
      message: result.summary,
    };
  }
}
