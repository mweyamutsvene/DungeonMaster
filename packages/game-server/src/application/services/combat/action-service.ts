
import { nanoid } from "nanoid";

import { resolveAttack, type AttackSpec } from "../../../domain/combat/attack-resolver.js";
import { SeededDiceRoller } from "../../../domain/rules/dice-roller.js";
import type { Ability } from "../../../domain/entities/core/ability-scores.js";
import { concentrationCheckOnDamage, isConcentrating, endConcentration, type ConcentrationState } from "../../../domain/rules/concentration.js";
import { attemptMovement, crossesThroughReach, type Position, type MovementAttempt } from "../../../domain/rules/movement.js";
import { canMakeOpportunityAttack } from "../../../domain/rules/opportunity-attack.js";
import { resolveShove } from "../../../domain/rules/grapple-shove.js";

import { NotFoundError, ValidationError } from "../../errors.js";
import {
  normalizeResources,
  readBoolean,
  hasSpentAction,
  spendAction,
  markDisengaged,
  getPosition,
  setPosition,
  hasReactionAvailable,
  useReaction,
} from "./helpers/resource-utils.js";
import type { ICombatRepository } from "../../repositories/combat-repository.js";
import type { IEventRepository } from "../../repositories/event-repository.js";
import type { IGameSessionRepository } from "../../repositories/game-session-repository.js";
import type { CombatEncounterRecord, CombatantStateRecord, JsonValue } from "../../types.js";
import type { ICombatantResolver } from "./helpers/combatant-resolver.js";
import type { ICombatNarrator } from "./ai/combat-narrator.js";
import type { CombatantRef } from "./helpers/combatant-ref.js";
import { findCombatantStateByRef } from "./helpers/combatant-ref.js";
import { resolveEncounterOrThrow } from "./helpers/encounter-resolver.js";

type AbilityScoresData = Record<Ability, number>;

type CreatureAdapter = {
  getAC(): number;
  getAbilityModifier(ability: Ability): number;
  takeDamage(amount: number): void;
  getFeatIds?: () => readonly string[];
  getD20TestModeForAbility?: (
    ability: Ability,
    baseMode: "normal" | "advantage" | "disadvantage",
  ) => "normal" | "advantage" | "disadvantage";
};

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function readNumber(obj: Record<string, unknown>, key: string): number | null {
  const v = obj[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function extractAbilityScores(raw: unknown): AbilityScoresData | null {
  if (!isRecord(raw)) return null;
  const abilities: Ability[] = [
    "strength",
    "dexterity",
    "constitution",
    "intelligence",
    "wisdom",
    "charisma",
  ];

  const out: Partial<AbilityScoresData> = {};
  for (const a of abilities) {
    const n = readNumber(raw, a);
    if (n === null) return null;
    out[a] = n;
  }

  return out as AbilityScoresData;
}

function modifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function hashStringToInt32(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}

function buildCreatureAdapter(params: {
  armorClass: number;
  abilityScores: AbilityScoresData;
  featIds?: readonly string[];
  hpCurrent: number;
}): { creature: CreatureAdapter; getHpCurrent: () => number } {
  let hpCurrent = params.hpCurrent;

  const creature: CreatureAdapter = {
    getAC: () => params.armorClass,
    getAbilityModifier: (ability) => modifier(params.abilityScores[ability]),
    takeDamage: (amount) => {
      const a = Number.isFinite(amount) ? amount : 0;
      hpCurrent = Math.max(0, hpCurrent - Math.max(0, a));
    },
  };

  if (params.featIds) {
    creature.getFeatIds = () => params.featIds ?? [];
  }

  return { creature, getHpCurrent: () => hpCurrent };
}

type AttackActionInput = {
  encounterId?: string;
  attacker: CombatantRef;
  target: CombatantRef;
  seed?: unknown;
  spec?: unknown;
  monsterAttackName?: string;
};

type SimpleActionBaseInput = {
  encounterId?: string;
  actor: CombatantRef;
  seed?: unknown;
};

type HelpActionInput = SimpleActionBaseInput & {
  target: CombatantRef;
};

type CastSpellActionInput = SimpleActionBaseInput & {
  spellName: string;
};

type ShoveActionInput = SimpleActionBaseInput & {
  target: CombatantRef;
  shoveType?: "push" | "prone";
};

type MoveActionInput = SimpleActionBaseInput & {
  destination: Position;
};

function isAbility(x: unknown): x is Ability {
  return (
    x === "strength" ||
    x === "dexterity" ||
    x === "constitution" ||
    x === "intelligence" ||
    x === "wisdom" ||
    x === "charisma"
  );
}

function parseAttackSpec(input: unknown): AttackSpec {
  if (!isRecord(input)) throw new ValidationError("spec must be an object");

  const nameRaw = input.name;
  const name = nameRaw === undefined ? undefined : typeof nameRaw === "string" ? nameRaw : null;
  if (name === null) throw new ValidationError("spec.name must be a string");

  const attackBonus = readNumber(input, "attackBonus");
  if (attackBonus === null || !Number.isInteger(attackBonus)) {
    throw new ValidationError("spec.attackBonus must be an integer");
  }

  const kindRaw = input.kind;
  const kind = kindRaw === "ranged" ? "ranged" : kindRaw === "melee" ? "melee" : undefined;

  const attackAbilityRaw = input.attackAbility;
  const attackAbility =
    attackAbilityRaw === undefined ? undefined : isAbility(attackAbilityRaw) ? attackAbilityRaw : null;
  if (attackAbility === null) {
    throw new ValidationError("spec.attackAbility must be a valid ability name");
  }

  const modeRaw = input.mode;
  const mode =
    modeRaw === undefined
      ? undefined
      : modeRaw === "normal" || modeRaw === "advantage" || modeRaw === "disadvantage"
        ? modeRaw
        : null;
  if (mode === null) {
    throw new ValidationError("spec.mode must be normal|advantage|disadvantage");
  }

  const damageRaw = input.damage;
  if (!isRecord(damageRaw)) throw new ValidationError("spec.damage must be an object");

  const diceCount = readNumber(damageRaw, "diceCount");
  const diceSides = readNumber(damageRaw, "diceSides");
  const modifierN = damageRaw.modifier;
  const damageModifier = modifierN === undefined ? 0 : typeof modifierN === "number" ? modifierN : null;

  if (diceCount === null || !Number.isInteger(diceCount) || diceCount < 1) {
    throw new ValidationError("spec.damage.diceCount must be an integer >= 1");
  }
  if (diceSides === null || !Number.isInteger(diceSides) || diceSides < 2) {
    throw new ValidationError("spec.damage.diceSides must be an integer >= 2");
  }
  if (damageModifier === null || !Number.isInteger(damageModifier)) {
    throw new ValidationError("spec.damage.modifier must be an integer");
  }

  return {
    name: name ?? undefined,
    kind,
    attackAbility,
    mode,
    attackBonus,
    damage: {
      diceCount,
      diceSides,
      modifier: damageModifier,
    },
  };
}

/**
 * Executes concrete in-combat actions (attack, etc.) against the active encounter state.
 * Layer: Application.
 * Notes: Delegates deterministic mechanics to `domain/` and persists results + emits events/narration.
 */
export class ActionService {
  constructor(
    private readonly sessions: IGameSessionRepository,
    private readonly combat: ICombatRepository,
    private readonly combatants: ICombatantResolver,
    private readonly events?: IEventRepository,
    private readonly narrator?: ICombatNarrator,
  ) {}

  private async resolveActiveActorOrThrow(
    sessionId: string,
    input: { encounterId?: string; actor: CombatantRef },
  ): Promise<{
    encounter: CombatEncounterRecord;
    combatants: CombatantStateRecord[];
    active: CombatantStateRecord;
    actorState: CombatantStateRecord;
  }> {
    const encounter = await resolveEncounterOrThrow(this.sessions, this.combat, sessionId, input.encounterId);
    const combatants = await this.combat.listCombatants(encounter.id);

    const active = combatants[encounter.turn] ?? null;
    if (!active) {
      throw new ValidationError(
        `Encounter turn index out of range: turn=${encounter.turn} combatants=${combatants.length}`,
      );
    }

    const actorState = findCombatantStateByRef(combatants, input.actor);
    if (!actorState) throw new NotFoundError("Actor not found in encounter");

    if (actorState.id !== active.id) {
      throw new ValidationError("It is not the actor's turn");
    }

    if (hasSpentAction(actorState.resources)) {
      throw new ValidationError("Actor has already spent their action this turn");
    }

    return { encounter, combatants, active, actorState };
  }

  private async performSimpleAction(
    sessionId: string,
    input: SimpleActionBaseInput,
    action: "Dodge" | "Dash" | "Disengage" | "CastSpell" | "Help",
    extra?: { target?: CombatantRef; spellName?: string },
  ): Promise<{ actor: CombatantStateRecord }> {
    if (input.seed !== undefined && !Number.isInteger(input.seed)) {
      throw new ValidationError("seed must be an integer");
    }

    const { encounter, combatants, actorState } = await this.resolveActiveActorOrThrow(sessionId, {
      encounterId: input.encounterId,
      actor: input.actor,
    });

    let targetState: CombatantStateRecord | null = null;
    if (extra?.target) {
      targetState = findCombatantStateByRef(combatants, extra.target);
      if (!targetState) throw new NotFoundError("Target not found in encounter");
    }

    const seed =
      (input.seed as number | undefined) ??
      hashStringToInt32(
        `${sessionId}:${encounter.id}:${encounter.round}:${encounter.turn}:${action}:${JSON.stringify(input.actor)}:${JSON.stringify(extra ?? {})}`,
      );

    const actorResources = normalizeResources(actorState.resources);
    
    // Mark turn-state flags for certain actions.
    // Note: Dash affects movement (handled by move via `dashed`), Disengage prevents OAs (handled by `disengaged`).
    let updatedResources: JsonValue = { ...actorResources, actionSpent: true } as JsonValue;
    if (action === "Disengage") {
      updatedResources = markDisengaged(updatedResources);
    }
    if (action === "Dash") {
      updatedResources = { ...(updatedResources as any), dashed: true } as JsonValue;
    }
    
    const updatedActor = await this.combat.updateCombatantState(actorState.id, {
      resources: updatedResources,
    });

    if (this.events) {
      await this.events.append(sessionId, {
        id: nanoid(),
        type: "ActionResolved",
        payload: {
          encounterId: encounter.id,
          actor: input.actor,
          action,
          ...(extra?.spellName ? { spellName: extra.spellName } : {}),
          ...(extra?.target ? { target: extra.target } : {}),
        } satisfies JsonValue,
      });

      if (this.narrator) {
        try {
          const session = await this.sessions.getById(sessionId);
          const actorName = await this.combatants.getName(input.actor, actorState);
          const targetName =
            targetState && extra?.target ? await this.combatants.getName(extra.target, targetState) : undefined;

          const outcomeEvent = {
            type: "ActionOutcome",
            action,
            actor: actorName,
            target: targetName,
            spellName: extra?.spellName,
          };

          const narrative = await this.narrator.narrate({
            storyFramework: session?.storyFramework || {},
            events: [outcomeEvent],
            seed,
          });

          await this.events.append(sessionId, {
            id: nanoid(),
            type: "NarrativeText",
            payload: {
              encounterId: encounter.id,
              actor: input.actor,
              text: narrative.trim(),
            } satisfies JsonValue,
          });
        } catch (error) {
          console.error("Failed to generate action narrative:", error);
        }
      }
    }

    return { actor: updatedActor };
  }

  async attack(sessionId: string, input: AttackActionInput): Promise<{ result: unknown; target: CombatantStateRecord }> {
    const encounter = await resolveEncounterOrThrow(this.sessions, this.combat, sessionId, input.encounterId);
    const combatants = await this.combat.listCombatants(encounter.id);

    const active = combatants[encounter.turn] ?? null;
    if (!active) {
      throw new ValidationError(
        `Encounter turn index out of range: turn=${encounter.turn} combatants=${combatants.length}`,
      );
    }

    const attackerState = findCombatantStateByRef(combatants, input.attacker);
    if (!attackerState) throw new NotFoundError("Attacker not found in encounter");

    if (attackerState.id !== active.id) {
      throw new ValidationError("It is not the attacker's turn");
    }

    if (hasSpentAction(attackerState.resources)) {
      throw new ValidationError("Attacker has already spent their action this turn");
    }

    const targetState = findCombatantStateByRef(combatants, input.target);
    if (!targetState) throw new NotFoundError("Target not found in encounter");

    if (input.seed !== undefined && !Number.isInteger(input.seed)) {
      throw new ValidationError("seed must be an integer");
    }

    const attackerStats = await this.combatants.getCombatStats(input.attacker);
    const targetStats = await this.combatants.getCombatStats(input.target);

    const attackerAC = attackerStats.armorClass;
    const attackerAbilityScores = attackerStats.abilityScores;
    const attackerFeatIds = attackerStats.featIds;
    const attackerEquippedWeapon = attackerStats.equipment?.weapon;
    const attackerEquippedArmor = attackerStats.equipment?.armor;

    const targetAC = targetStats.armorClass;
    const targetAbilityScores = targetStats.abilityScores;
    const targetEquippedWeapon = targetStats.equipment?.weapon;
    const targetEquippedArmor = targetStats.equipment?.armor;

    let spec: AttackSpec | null = null;

    if (input.spec !== undefined) {
      spec = parseAttackSpec(input.spec);
    }

    if (input.attacker.type === "Monster" && !spec) {
      // Preserve existing behavior: allow selecting a monster attack from statBlock by name.
      const attacks = await this.combatants.getMonsterAttacks(input.attacker.monsterId);
      const desiredName = (input.monsterAttackName ?? "").trim().toLowerCase();
      const picked = attacks.find(
        (a: unknown) => isRecord(a) && typeof a.name === "string" && a.name.trim().toLowerCase() === desiredName,
      );

      if (picked && isRecord(picked)) {
        const attackBonus = readNumber(picked, "attackBonus");
        const dmg = isRecord((picked as any).damage) ? ((picked as any).damage as Record<string, unknown>) : null;
        const diceCount = dmg ? readNumber(dmg, "diceCount") : null;
        const diceSides = dmg ? readNumber(dmg, "diceSides") : null;
        const modifierVal = dmg ? (dmg.modifier as unknown) : undefined;

        if (
          attackBonus !== null &&
          Number.isInteger(attackBonus) &&
          diceCount !== null &&
          Number.isInteger(diceCount) &&
          diceSides !== null &&
          Number.isInteger(diceSides)
        ) {
          const modN = modifierVal === undefined ? 0 : typeof modifierVal === "number" ? modifierVal : null;
          if (modN !== null && Number.isInteger(modN)) {
            spec = {
              name: typeof (picked as any).name === "string" ? (picked as any).name : undefined,
              kind: ((picked as any).kind === "ranged" ? "ranged" : "melee") as any,
              attackBonus,
              damage: { diceCount, diceSides, modifier: modN },
            };
          }
        }
      }
    }

    if (!spec) {
      throw new ValidationError("Attack spec is required (or provide monsterAttackName for monster attackers)");
    }

    const seed =
      (input.seed as number | undefined) ??
      hashStringToInt32(
        `${sessionId}:${encounter.id}:${encounter.round}:${encounter.turn}:${JSON.stringify(input.attacker)}:${JSON.stringify(input.target)}:${JSON.stringify(spec)}`,
      );

    const diceRoller = new SeededDiceRoller(seed);

    const attacker = buildCreatureAdapter({
      armorClass: attackerAC,
      abilityScores: attackerAbilityScores,
      featIds: attackerFeatIds,
      hpCurrent: attackerState.hpCurrent,
    }).creature as unknown as any;

    const targetAdapter = buildCreatureAdapter({
      armorClass: targetAC,
      abilityScores: targetAbilityScores,
      hpCurrent: targetState.hpCurrent,
    });

    const target = targetAdapter.creature as unknown as any;
    const result = resolveAttack(diceRoller, attacker, target, spec);

    const newHp = targetAdapter.getHpCurrent();
    const updatedTarget = await this.combat.updateCombatantState(targetState.id, { hpCurrent: newHp });

    await this.combat.updateCombatantState(attackerState.id, {
      resources: spendAction(attackerState.resources),
    });

    if (this.events) {
      await this.events.append(sessionId, {
        id: nanoid(),
        type: "AttackResolved",
        payload: {
          encounterId: encounter.id,
          attacker: { ...input.attacker, weapon: attackerEquippedWeapon, armor: attackerEquippedArmor },
          target: { ...input.target, ac: targetAC, weapon: targetEquippedWeapon, armor: targetEquippedArmor },
          attackName: spec.name || attackerEquippedWeapon,
          result,
        } satisfies JsonValue,
      });

      if ((result as any).hit && (result as any).damage?.applied > 0) {
        await this.events.append(sessionId, {
          id: nanoid(),
          type: "DamageApplied",
          payload: {
            encounterId: encounter.id,
            target: input.target,
            amount: (result as any).damage.applied,
            hpCurrent: newHp,
          } satisfies JsonValue,
        });

        // Check concentration if target is concentrating
        const targetResources = normalizeResources(updatedTarget.resources);
        const concentration = (targetResources as any).concentration as ConcentrationState | undefined;
        
        if (concentration && isConcentrating(concentration)) {
          // Calculate Constitution save modifier
          const conModifier = Math.floor((targetAbilityScores.constitution - 10) / 2);
          
          // Make concentration check
          const checkResult = concentrationCheckOnDamage(
            new SeededDiceRoller(seed + 1000), // Offset seed for concentration roll
            (result as any).damage.applied,
            conModifier,
          );

          if (!checkResult.maintained) {
            // Concentration broken - update resources
            const updatedConcentration = endConcentration(concentration);
            await this.combat.updateCombatantState(targetState.id, {
              resources: { ...targetResources, concentration: updatedConcentration },
            });

            // Emit concentration broken event
            await this.events.append(sessionId, {
              id: nanoid(),
              type: "ConcentrationBroken",
              payload: {
                encounterId: encounter.id,
                combatant: input.target,
                spellId: concentration.activeSpellId,
                dc: checkResult.dc,
                roll: checkResult.check.total,
                damage: (result as any).damage.applied,
              } satisfies JsonValue,
            });
          } else {
            // Concentration maintained - emit event
            await this.events.append(sessionId, {
              id: nanoid(),
              type: "ConcentrationMaintained",
              payload: {
                encounterId: encounter.id,
                combatant: input.target,
                spellId: concentration.activeSpellId,
                dc: checkResult.dc,
                roll: checkResult.check.total,
                damage: (result as any).damage.applied,
              } satisfies JsonValue,
            });
          }
        }
      }

      if (this.narrator) {
        try {
          const session = await this.sessions.getById(sessionId);

          const attackerName = await this.combatants.getName(input.attacker, attackerState);
          const targetName = await this.combatants.getName(input.target, targetState);

          const outcomeEvent = {
            type: "AttackOutcome",
            attacker: attackerName,
            attackerAC,
            attackerWeapon: attackerEquippedWeapon || (spec as any).name,
            attackerArmor: attackerEquippedArmor,
            target: targetName,
            targetAC,
            targetWeapon: targetEquippedWeapon,
            targetArmor: targetEquippedArmor,
            weaponName: (spec as any).name || attackerEquippedWeapon,
            hit: Boolean((result as any).hit),
            critical: Boolean((result as any).critical),
            damage: (result as any).hit ? (result as any).damage?.applied ?? 0 : 0,
            targetHP: newHp,
            attackRoll: (result as any).attack?.total,
          };

          const narrative = await this.narrator.narrate({
            storyFramework: (session as any)?.storyFramework || {},
            events: [outcomeEvent],
            seed,
          });

          await this.events.append(sessionId, {
            id: nanoid(),
            type: "NarrativeText",
            payload: {
              encounterId: encounter.id,
              actor: input.attacker,
              text: narrative.trim(),
            } satisfies JsonValue,
          });
        } catch (error) {
          console.error("Failed to generate attack outcome narrative:", error);
        }
      }
    }

    return { result, target: updatedTarget };
  }

  async dodge(sessionId: string, input: SimpleActionBaseInput): Promise<{ actor: CombatantStateRecord }> {
    return this.performSimpleAction(sessionId, input, "Dodge");
  }

  async dash(sessionId: string, input: SimpleActionBaseInput): Promise<{ actor: CombatantStateRecord }> {
    return this.performSimpleAction(sessionId, input, "Dash");
  }

  async disengage(sessionId: string, input: SimpleActionBaseInput): Promise<{ actor: CombatantStateRecord }> {
    return this.performSimpleAction(sessionId, input, "Disengage");
  }

  async help(sessionId: string, input: HelpActionInput): Promise<{ actor: CombatantStateRecord }> {
    return this.performSimpleAction(sessionId, input, "Help", { target: input.target });
  }

  async castSpell(sessionId: string, input: CastSpellActionInput): Promise<{ actor: CombatantStateRecord }> {
    if (!input.spellName || input.spellName.trim().length === 0) {
      throw new ValidationError("spellName is required");
    }
    return this.performSimpleAction(sessionId, input, "CastSpell", { spellName: input.spellName.trim() });
  }

  async shove(sessionId: string, input: ShoveActionInput): Promise<{
    actor: CombatantStateRecord;
    target: CombatantStateRecord;
    result: {
      success: boolean;
      shoveType: "push" | "prone";
      attackerRoll: number;
      targetRoll: number;
      reason?: string;
      pushedTo?: Position;
    };
  }> {
    if (input.seed !== undefined && !Number.isInteger(input.seed)) {
      throw new ValidationError("seed must be an integer");
    }

    const { encounter, combatants, actorState } = await this.resolveActiveActorOrThrow(sessionId, {
      encounterId: input.encounterId,
      actor: input.actor,
    });

    const targetState = findCombatantStateByRef(combatants, input.target);
    if (!targetState) throw new NotFoundError("Target not found in encounter");
    if (targetState.hpCurrent <= 0) throw new ValidationError("Target is down");
    if (targetState.id === actorState.id) throw new ValidationError("Cannot shove self");

    const actorResources = normalizeResources(actorState.resources);
    const targetResources = normalizeResources(targetState.resources);

    const actorPos = getPosition(actorResources);
    const targetPos = getPosition(targetResources);
    if (!actorPos || !targetPos) {
      throw new ValidationError("Actor and target must have positions set");
    }

    const reachValue = actorResources.reach;
    const reach = typeof reachValue === "number" ? reachValue : 5;
    const dx = targetPos.x - actorPos.x;
    const dy = targetPos.y - actorPos.y;
    const dist = Math.hypot(dx, dy);
    if (!(dist <= reach + 0.0001)) {
      throw new ValidationError("Target is out of reach");
    }

    const shoveType = input.shoveType ?? "push";
    const seed =
      (input.seed as number | undefined) ??
      hashStringToInt32(
        `${sessionId}:${encounter.id}:${encounter.round}:${encounter.turn}:Shove:${JSON.stringify(input.actor)}:${JSON.stringify(input.target)}:${shoveType}`,
      );

    const actorStats = await this.combatants.getCombatStats(input.actor);
    const targetStats = await this.combatants.getCombatStats(input.target);

    const attackerAthleticsModifier = modifier(actorStats.abilityScores.strength);
    const targetContestModifier = Math.max(
      modifier(targetStats.abilityScores.strength),
      modifier(targetStats.abilityScores.dexterity),
    );

    const dice = new SeededDiceRoller(seed);
    const contested = resolveShove(dice, {
      attackerAthleticsModifier,
      targetContestModifier,
      targetTooLarge: false,
      shoveType,
    });

    // Spend action.
    const updatedActor = await this.combat.updateCombatantState(actorState.id, {
      resources: spendAction(actorState.resources),
    });

    let updatedTarget = targetState;
    let pushedTo: Position | undefined;

    if (contested.success && shoveType === "push") {
      const len = dist > 0.0001 ? dist : 1;
      const ux = dx / len;
      const uy = dy / len;
      const proposed: Position = {
        x: Math.round((targetPos.x + ux * 5) * 100) / 100,
        y: Math.round((targetPos.y + uy * 5) * 100) / 100,
      };

      const map = encounter.mapData as any;
      const width = typeof map?.width === "number" ? map.width : null;
      const height = typeof map?.height === "number" ? map.height : null;
      pushedTo = {
        x: width === null ? proposed.x : clamp(proposed.x, 0, width),
        y: height === null ? proposed.y : clamp(proposed.y, 0, height),
      };

      updatedTarget = await this.combat.updateCombatantState(targetState.id, {
        resources: setPosition(targetState.resources, pushedTo),
      });
    }

    if (contested.success && shoveType === "prone") {
      const existing = Array.isArray(targetState.conditions) ? (targetState.conditions as any[]) : [];
      const hasProne = existing.some((c) => (typeof c === "string" ? c.toLowerCase() : "") === "prone");
      const nextConditions = hasProne ? existing : [...existing, "Prone"];
      updatedTarget = await this.combat.updateCombatantState(targetState.id, {
        conditions: nextConditions as any,
      });
    }

    if (this.events) {
      await this.events.append(sessionId, {
        id: nanoid(),
        type: "ActionResolved",
        payload: {
          encounterId: encounter.id,
          actor: input.actor,
          action: "Shove",
          target: input.target,
          shoveType,
          success: contested.success,
          attackerRoll: contested.attackerRoll,
          targetRoll: contested.targetRoll,
          ...(pushedTo ? { pushedTo } : {}),
        } satisfies JsonValue,
      });
    }

    return {
      actor: updatedActor,
      target: updatedTarget,
      result: {
        success: contested.success,
        shoveType,
        attackerRoll: contested.attackerRoll,
        targetRoll: contested.targetRoll,
        reason: contested.reason,
        ...(pushedTo ? { pushedTo } : {}),
      },
    };
  }

  async move(sessionId: string, input: MoveActionInput): Promise<{
    actor: CombatantStateRecord;
    result: {
      from: Position;
      to: Position;
      movedFeet: number;
      opportunityAttacks: Array<{
        attackerId: string;
        targetId: string;
        result: unknown;
      }>;
    };
    opportunityAttacks: Array<{
      attackerId: string;
      targetId: string;
      canAttack: boolean;
      hasReaction: boolean;
    }>;
  }> {
    const encounter = await resolveEncounterOrThrow(this.sessions, this.combat, sessionId, input.encounterId);
    const combatants = await this.combat.listCombatants(encounter.id);

    const actor = findCombatantStateByRef(combatants, input.actor);
    if (!actor) throw new NotFoundError("Actor not found in encounter");

    // Check if actor has action available
    const resources = normalizeResources(actor.resources);
    // Movement is separate from the action economy, but we currently cap it to one move per turn.
    const movementSpent = readBoolean(resources, "movementSpent") ?? false;
    if (movementSpent) {
      throw new ValidationError("Actor has already moved this turn");
    }

    // Get current position
    const currentPos = getPosition(resources);
    if (!currentPos) {
      throw new ValidationError("Actor does not have a position set");
    }

    // Get actor's speed from resources
    const speedValue = resources.speed;
    const speed = typeof speedValue === "number" ? speedValue : 30; // Default to 30ft

    // Check if Dashed (doubles speed)
    const hasDashed = readBoolean(resources, "dashed") ?? false;
    const effectiveSpeed = hasDashed ? speed * 2 : speed;

    // Validate movement
    const movementAttempt: MovementAttempt = {
      from: currentPos,
      to: input.destination,
      speed: effectiveSpeed,
    };

    const movementResult = attemptMovement(movementAttempt);
    if (!movementResult.success) {
      throw new ValidationError(movementResult.reason || "Movement not allowed");
    }

    // Detect opportunity attacks from leaving reach of enemies
    const opportunityAttacks: Array<{
      attackerId: string;
      targetId: string;
      canAttack: boolean;
      hasReaction: boolean;
    }> = [];

    // Check each combatant for opportunity attacks
    for (const other of combatants) {
      if (other.id === actor.id) continue; // Skip self
      if (other.hpCurrent <= 0) continue; // Skip unconscious/dead

      const otherResources = normalizeResources(other.resources);
      const otherPos = getPosition(otherResources);
      if (!otherPos) continue; // Skip if no position

      // Get reach (default 5ft, can be modified by polearms)
      const reachValue = otherResources.reach;
      const reach = typeof reachValue === "number" ? reachValue : 5;

      // Check if movement crosses through reach
      const crossesReach = crossesThroughReach(
        { from: currentPos, to: input.destination },
        otherPos,
        reach,
      );

      if (crossesReach) {
        const hasReaction = hasReactionAvailable(otherResources);
        const isDisengaged = readBoolean(resources, "disengaged") ?? false;
        const canAttack = canMakeOpportunityAttack(
          { reactionUsed: !hasReaction },
          {
            movingCreatureId: actor.id,
            observerId: other.id,
            disengaged: isDisengaged,
            canSee: true, // TODO: implement vision checks
            observerIncapacitated: false, // TODO: check incapacitated condition
            leavingReach: true,
          },
        );

        opportunityAttacks.push({
          attackerId: other.id,
          targetId: actor.id,
          canAttack: canAttack.canAttack,
          hasReaction,
        });
      }
    }

    // Update position and mark action as spent
    const updatedResources = {
      ...resources,
      position: input.destination,
      movementSpent: true,
    };

    const updatedActor = {
      ...actor,
      resources: updatedResources as JsonValue,
    };

    // Save updated position and resources
    await this.combat.updateCombatantState(actor.id, {
      resources: updatedResources as JsonValue,
    });

    // Execute opportunity attacks
    const executedAttacks: Array<{
      attackerId: string;
      targetId: string;
      result: unknown;
    }> = [];

    for (const opp of opportunityAttacks) {
      if (!opp.canAttack) continue; // Skip if can't attack

      const attacker = combatants.find(c => c.id === opp.attackerId);
      if (!attacker) continue;

      // Use the attacker's reaction
      const attackerResources = normalizeResources(attacker.resources);
      const updatedAttackerResources = useReaction(attackerResources);
      await this.combat.updateCombatantState(attacker.id, {
        resources: updatedAttackerResources as JsonValue,
      });

      // Get attacker's weapon/attack
      const attackerRef: CombatantRef = attacker.combatantType === "Character" && attacker.characterId
        ? { type: "Character", characterId: attacker.characterId }
        : attacker.combatantType === "Monster" && attacker.monsterId
        ? { type: "Monster", monsterId: attacker.monsterId }
        : attacker.combatantType === "NPC" && attacker.npcId
        ? { type: "NPC", npcId: attacker.npcId }
        : { type: "Character", characterId: "" }; // Fallback (shouldn't happen)

      const attackerStats = await this.combatants.getCombatStats(attackerRef);

      const targetStats = await this.combatants.getCombatStats(input.actor);

      // Build attack spec (use equipped weapon or default melee attack)
      let spec: AttackSpec | null = null;
      const equippedWeapon = attackerStats.equipment?.weapon;

      if (equippedWeapon) {
        // TODO: Parse weapon stats to build proper spec
        // For now, use basic melee attack
        const strMod = modifier(attackerStats.abilityScores.strength);
        spec = {
          attackBonus: strMod + 2, // Proficiency bonus estimate
          damage: { diceCount: 1, diceSides: 6, modifier: strMod },
          kind: "melee",
        };
      } else if (attacker.combatantType === "Monster") {
        // Try to get monster's first melee attack
        const attacks = await this.combatants.getMonsterAttacks(attacker.monsterId!);
        const meleeAttack = attacks.find((a: any) => a.kind === "melee");
        if (meleeAttack && isRecord(meleeAttack)) {
          const attackBonus = readNumber(meleeAttack, "attackBonus");
          const dmg = isRecord(meleeAttack.damage) ? meleeAttack.damage : null;
          const diceCount = dmg ? readNumber(dmg, "diceCount") : null;
          const diceSides = dmg ? readNumber(dmg, "diceSides") : null;
          const modifierVal = dmg ? dmg.modifier : undefined;

          if (attackBonus !== null && diceCount !== null && diceSides !== null) {
            const modN = modifierVal === undefined ? 0 : typeof modifierVal === "number" ? modifierVal : 0;
            spec = {
              name: typeof meleeAttack.name === "string" ? meleeAttack.name : undefined,
              kind: "melee",
              attackBonus,
              damage: { diceCount, diceSides, modifier: modN },
            };
          }
        }
      }

      if (!spec) {
        // Default unarmed strike
        const strMod = modifier(attackerStats.abilityScores.strength);
        spec = {
          name: "Unarmed Strike",
          attackBonus: strMod,
          damage: { diceCount: 1, diceSides: 4, modifier: strMod },
          kind: "melee",
        };
      }

      // Execute attack
      const seed = hashStringToInt32(
        `${sessionId}:${encounter.id}:opportunity:${opp.attackerId}:${opp.targetId}:${currentPos.x}:${currentPos.y}`,
      );
      const diceRoller = new SeededDiceRoller(seed);

      const attackerAdapter = buildCreatureAdapter({
        armorClass: attackerStats.armorClass,
        abilityScores: attackerStats.abilityScores,
        featIds: attackerStats.featIds,
        hpCurrent: attacker.hpCurrent,
      }).creature as any;

      const targetAdapter = buildCreatureAdapter({
        armorClass: targetStats.armorClass,
        abilityScores: targetStats.abilityScores,
        hpCurrent: updatedActor.hpCurrent,
      });

      const target = targetAdapter.creature as any;
      const attackResult = resolveAttack(diceRoller, attackerAdapter, target, spec);

      // Apply damage to moving actor
      const newHp = targetAdapter.getHpCurrent();
      await this.combat.updateCombatantState(actor.id, {
        hpCurrent: newHp,
      });

      executedAttacks.push({
        attackerId: opp.attackerId,
        targetId: opp.targetId,
        result: attackResult,
      });

      // Emit opportunity attack event
      if (this.events) {
        await this.events.append(sessionId, {
          id: nanoid(),
          type: "OpportunityAttack",
          payload: {
            encounterId: encounter.id,
            attackerId: opp.attackerId,
            targetId: opp.targetId,
            attackName: spec.name || "Melee Attack",
            result: attackResult,
          } satisfies JsonValue,
        });

        if ((attackResult as any).hit && (attackResult as any).damage?.applied > 0) {
          await this.events.append(sessionId, {
            id: nanoid(),
            type: "DamageApplied",
            payload: {
              encounterId: encounter.id,
              target: input.actor,
              amount: (attackResult as any).damage.applied,
              hpCurrent: newHp,
            } satisfies JsonValue,
          });
        }
      }
    }

    // Emit movement event
    if (this.events) {
      await this.events.append(sessionId, {
        id: nanoid(),
        type: "Move",
        payload: {
          encounterId: encounter.id,
          actorId: actor.id,
          from: currentPos,
          to: input.destination,
          distanceMoved: movementResult.distanceMoved,
        } satisfies JsonValue,
      });
    }

    return { 
      actor: updatedActor,
      result: {
        from: currentPos,
        to: input.destination,
        movedFeet: movementResult.distanceMoved,
        opportunityAttacks: executedAttacks.map(ea => ({
          attackerId: ea.attackerId,
          targetId: ea.targetId,
          result: ea.result,
        })),
      },
      opportunityAttacks: executedAttacks.map(ea => ({
        attackerId: ea.attackerId,
        targetId: ea.targetId,
        canAttack: true,
        hasReaction: false, // Reaction was used
      })),
    };
  }
}
