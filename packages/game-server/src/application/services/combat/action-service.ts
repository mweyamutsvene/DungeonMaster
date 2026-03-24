
import { nanoid } from "nanoid";

import { resolveAttack, type AttackSpec } from "../../../domain/combat/attack-resolver.js";
import { SeededDiceRoller } from "../../../domain/rules/dice-roller.js";
import type { Ability } from "../../../domain/entities/core/ability-scores.js";
import type { RollMode } from "../../../domain/rules/advantage.js";
import { concentrationCheckOnDamage } from "../../../domain/rules/concentration.js";
import {
  getConcentrationSpellName,
  breakConcentration,
  computeConSaveModifier,
} from "./helpers/concentration-helper.js";
import { attemptMovement, crossesThroughReach, calculateDistance, type Position, type MovementAttempt } from "../../../domain/rules/movement.js";
import { canMakeOpportunityAttack } from "../../../domain/rules/opportunity-attack.js";
import { shoveTarget, grappleTarget, escapeGrapple, isTargetTooLarge } from "../../../domain/rules/grapple-shove.js";
import { attemptHide } from "../../../domain/rules/hide.js";
import { attemptSearch } from "../../../domain/rules/search-use-object.js";

import { NotFoundError, ValidationError } from "../../errors.js";
import {
  normalizeConditions,
  addCondition,
  removeCondition,
  createCondition,
  type Condition,
} from "../../../domain/entities/combat/conditions.js";
import {
  normalizeResources,
  readBoolean,
  hasSpentAction,
  spendAction,
  markDisengaged,
  getPosition,
  setPosition,
  hasReactionAvailable,
  getEffectiveSpeed,
  useReaction,
  addActiveEffectsToResources,
  getActiveEffects,
  isConditionImmuneByEffects,
  canMakeAttack,
  useAttack,
  setAttacksAllowed,
  getAttacksAllowedThisTurn,
} from "./helpers/resource-utils.js";
import { ClassFeatureResolver } from "../../../domain/entities/classes/class-feature-resolver.js";
import {
  createEffect,
  hasAdvantageFromEffects,
  hasDisadvantageFromEffects,
  calculateFlatBonusFromEffects,
  calculateBonusFromEffects,
  getDamageDefenseEffects,
} from "../../../domain/entities/combat/effects.js";
import { applyKoEffectsIfNeeded } from "./helpers/ko-handler.js";
import { deriveRollModeFromConditions } from "./tabletop/combat-text-parser.js";
import type { ICombatRepository } from "../../repositories/combat-repository.js";
import type { IEventRepository } from "../../repositories/event-repository.js";
import type { IGameSessionRepository } from "../../repositories/game-session-repository.js";
import type { CombatEncounterRecord, CombatantStateRecord, JsonValue } from "../../types.js";
import type { ICombatantResolver } from "./helpers/combatant-resolver.js";
import type { CombatantRef } from "./helpers/combatant-ref.js";
import { findCombatantStateByRef } from "./helpers/combatant-ref.js";
import { resolveEncounterOrThrow } from "./helpers/encounter-resolver.js";
import { isRecord, readNumber } from "./helpers/json-helpers.js";

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

/**
 * Compute flat + dice bonus and roll mode from ActiveEffects on ability_checks.
 * Must be called AFTER creating the SeededDiceRoller so dice bonuses are deterministic.
 */
function abilityCheckEffectMods(
  resources: unknown,
  diceRoller: SeededDiceRoller,
  ability?: Ability,
): { bonus: number; mode: RollMode } {
  const effects = getActiveEffects(resources ?? {});
  const result = calculateBonusFromEffects(effects, 'ability_checks', ability);
  let bonus = result.flatBonus;
  for (const dr of result.diceRolls) {
    const count = Math.abs(dr.count);
    const sign = dr.count < 0 ? -1 : 1;
    for (let i = 0; i < count; i++) {
      bonus += sign * diceRoller.rollDie(dr.sides).total;
    }
  }
  const hasAdv = hasAdvantageFromEffects(effects, 'ability_checks', ability);
  const hasDisadv = hasDisadvantageFromEffects(effects, 'ability_checks', ability);
  let mode: RollMode = "normal";
  if (hasAdv && !hasDisadv) mode = "advantage";
  else if (hasDisadv && !hasAdv) mode = "disadvantage";
  return { bonus, mode };
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
  /** If true, bypass the action economy check (used by bonus action abilities like Patient Defense) */
  skipActionCheck?: boolean;
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

type GrappleActionInput = SimpleActionBaseInput & {
  target: CombatantRef;
};

type HideActionInput = SimpleActionBaseInput & {
  /** Whether actor has cover or obscurement from enemies (assume true for simplicity) */
  hasCover?: boolean;
  /** Whether to use as bonus action (e.g., Cunning Action) */
  isBonusAction?: boolean;
};

type SearchActionInput = SimpleActionBaseInput & {
  /** Optional: specific target creature to search for */
  targetRef?: CombatantRef;
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
    // TODO: Add narrative generator injection when ActionService narration is implemented
    // See INarrativeGenerator in infrastructure/llm for the active narration interface
  ) {}

  private async resolveActiveActorOrThrow(
    sessionId: string,
    input: { encounterId?: string; actor: CombatantRef; skipActionCheck?: boolean },
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

    // Skip action check for bonus action abilities like Patient Defense
    if (!input.skipActionCheck && hasSpentAction(actorState.resources)) {
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
      skipActionCheck: input.skipActionCheck,
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
    // If skipActionCheck is true (bonus action), don't mark actionSpent - only mark bonusActionUsed.
    let updatedResources: JsonValue;
    if (input.skipActionCheck) {
      // Bonus action version - don't spend the regular action
      updatedResources = { ...actorResources, bonusActionUsed: true } as JsonValue;
    } else {
      updatedResources = { ...actorResources, actionSpent: true } as JsonValue;
    }
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
        },
      });

      // TODO: Re-enable action narration when INarrativeGenerator is wired to ActionService
      // See infrastructure/llm/narrative-generator.ts for the active implementation
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
    if (targetState.hpCurrent <= 0) throw new ValidationError("Target is already defeated");

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
          diceCount >= 1 &&
          diceSides !== null &&
          Number.isInteger(diceSides) &&
          diceSides >= 2
        ) {
          const modN = modifierVal === undefined ? 0 : typeof modifierVal === "number" ? modifierVal : null;
          if (modN !== null && Number.isInteger(modN)) {
            const extractedDamageType = typeof (picked as any).damageType === "string" ? (picked as any).damageType : undefined;
            spec = {
              name: typeof (picked as any).name === "string" ? (picked as any).name : undefined,
              kind: ((picked as any).kind === "ranged" ? "ranged" : "melee") as any,
              attackBonus,
              damage: { diceCount, diceSides, modifier: modN },
              damageType: extractedDamageType,
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

    // -- ActiveEffect integration: advantage/disadvantage + AC bonus + attack bonus + extra damage + defenses --
    const attackerActiveEffects = getActiveEffects(attackerState.resources ?? {});
    const targetActiveEffects = getActiveEffects(targetState.resources ?? {});
    const attackKind: "melee" | "ranged" = spec.kind === "ranged" ? "ranged" : "melee";

    // Count advantage/disadvantage sources from ActiveEffects
    let effectAdvantage = 0;
    let effectDisadvantage = 0;

    // Attacker's self-effects
    if (hasAdvantageFromEffects(attackerActiveEffects, 'attack_rolls')) effectAdvantage++;
    if (attackKind === 'melee' && hasAdvantageFromEffects(attackerActiveEffects, 'melee_attack_rolls')) effectAdvantage++;
    if (attackKind === 'ranged' && hasAdvantageFromEffects(attackerActiveEffects, 'ranged_attack_rolls')) effectAdvantage++;
    if (hasDisadvantageFromEffects(attackerActiveEffects, 'attack_rolls')) effectDisadvantage++;
    if (attackKind === 'melee' && hasDisadvantageFromEffects(attackerActiveEffects, 'melee_attack_rolls')) effectDisadvantage++;
    if (attackKind === 'ranged' && hasDisadvantageFromEffects(attackerActiveEffects, 'ranged_attack_rolls')) effectDisadvantage++;

    // Target's effects on incoming attacks (e.g., Dodge ? disadvantage, Reckless Attack ? advantage)
    for (const eff of targetActiveEffects) {
      if (eff.target !== 'attack_rolls' && eff.target !== 'melee_attack_rolls' && eff.target !== 'ranged_attack_rolls') continue;
      if (eff.target === 'melee_attack_rolls' && attackKind !== 'melee') continue;
      if (eff.target === 'ranged_attack_rolls' && attackKind !== 'ranged') continue;
      if (!eff.targetCombatantId || eff.targetCombatantId !== targetState.id) continue;
      if (eff.type === 'advantage') effectAdvantage++;
      if (eff.type === 'disadvantage') effectDisadvantage++;
    }

    // Resolve advantage/disadvantage from conditions + effects
    const attackerCondNames = normalizeConditions(attackerState.conditions as unknown[]).map(c => c.condition);
    const targetCondNames = normalizeConditions(targetState.conditions as unknown[]).map(c => c.condition);
    const effectRollMode = deriveRollModeFromConditions(attackerCondNames, targetCondNames, attackKind, effectAdvantage, effectDisadvantage);
    if (!spec.mode || spec.mode === "normal") {
      spec.mode = effectRollMode;
    }

    // Attack bonus from ActiveEffects (Bless, etc.)
    const atkBonusResult = calculateBonusFromEffects(attackerActiveEffects, 'attack_rolls');
    spec.attackBonus += atkBonusResult.flatBonus;
    // Pre-roll dice-based attack bonuses and add to flat bonus
    for (const dr of atkBonusResult.diceRolls) {
      const count = Math.abs(dr.count);
      const sign = dr.count < 0 ? -1 : 1;
      for (let i = 0; i < count; i++) {
        spec.attackBonus += sign * diceRoller.rollDie(dr.sides).total;
      }
    }

    // AC bonus from target's ActiveEffects (Shield of Faith, etc.)
    const acBonusFromEffects = calculateFlatBonusFromEffects(targetActiveEffects, 'armor_class');
    const effectAdjustedTargetAC = targetAC + acBonusFromEffects;

    // Extra damage from ActiveEffects (Rage, Hunter's Mark, etc.)
    let effectExtraDamage = 0;
    {
      const dmgEffects = attackerActiveEffects.filter(
        e => (e.type === 'bonus' || e.type === 'penalty')
          && (e.target === 'damage_rolls'
            || (e.target === 'melee_damage_rolls' && attackKind === 'melee')
            || (e.target === 'ranged_damage_rolls' && attackKind === 'ranged'))
          && (!e.targetCombatantId || e.targetCombatantId === targetState.id)
      );
      for (const eff of dmgEffects) {
        if (eff.type === 'bonus') effectExtraDamage += eff.value ?? 0;
        if (eff.type === 'penalty') effectExtraDamage -= eff.value ?? 0;
        if (eff.diceValue) {
          const sign = eff.type === 'penalty' ? -1 : 1;
          const count = Math.abs(eff.diceValue.count);
          for (let i = 0; i < count; i++) {
            effectExtraDamage += sign * diceRoller.rollDie(eff.diceValue.sides).total;
          }
        }
      }
    }
    // Add extra damage to the spec modifier so resolveAttack includes it
    if (effectExtraDamage !== 0) {
      spec.damage = { ...spec.damage, modifier: (spec.damage.modifier ?? 0) + effectExtraDamage };
    }

    // Merge ActiveEffect damage defenses with stat-block defenses
    const mergedDefenses = targetStats.damageDefenses ? { ...targetStats.damageDefenses } : undefined;
    if (spec.damageType) {
      const effDef = getDamageDefenseEffects(targetActiveEffects, spec.damageType);
      if (effDef.resistances || effDef.vulnerabilities || effDef.immunities) {
        const defenses = mergedDefenses ?? {} as any;
        if (effDef.resistances) {
          defenses.damageResistances = [...new Set([...(defenses.damageResistances ?? []), spec.damageType.toLowerCase()])];
        }
        if (effDef.vulnerabilities) {
          defenses.damageVulnerabilities = [...new Set([...(defenses.damageVulnerabilities ?? []), spec.damageType.toLowerCase()])];
        }
        if (effDef.immunities) {
          defenses.damageImmunities = [...new Set([...(defenses.damageImmunities ?? []), spec.damageType.toLowerCase()])];
        }
      }
    }

    const attacker = buildCreatureAdapter({
      armorClass: attackerAC,
      abilityScores: attackerAbilityScores,
      featIds: attackerFeatIds,
      hpCurrent: attackerState.hpCurrent,
    }).creature as unknown as any;

    const targetAdapter = buildCreatureAdapter({
      armorClass: effectAdjustedTargetAC,
      abilityScores: targetAbilityScores,
      hpCurrent: targetState.hpCurrent,
    });

    const target = targetAdapter.creature as unknown as any;
    const result = resolveAttack(diceRoller, attacker, target, spec, {
      targetDefenses: mergedDefenses,
    });

    const newHp = targetAdapter.getHpCurrent();
    console.log(`[ActionService.attack] HP change: ${targetState.hpCurrent} -> ${newHp} (target: ${targetState.id}, combatantType: ${targetState.combatantType})`);
    const updatedTarget = await this.combat.updateCombatantState(targetState.id, { hpCurrent: newHp });
    console.log(`[ActionService.attack] DB updated, returned hpCurrent: ${updatedTarget.hpCurrent}`);

    // Apply KO effects if target dropped to 0 HP
    await applyKoEffectsIfNeeded(targetState, targetState.hpCurrent, newHp, this.combat);

    // -- ActiveEffect: retaliatory damage (Armor of Agathys, Fire Shield) --
    const damageApplied = targetState.hpCurrent - newHp;
    if (damageApplied > 0 && attackKind === "melee") {
      const retaliatory = targetActiveEffects.filter(e => e.type === 'retaliatory_damage');
      if (retaliatory.length > 0 && attackerState.hpCurrent > 0) {
        let totalRetaliatoryDamage = 0;
        for (const eff of retaliatory) {
          let retDmg = eff.value ?? 0;
          if (eff.diceValue) {
            for (let i = 0; i < eff.diceValue.count; i++) {
              retDmg += diceRoller.rollDie(eff.diceValue.sides).total;
            }
          }
          totalRetaliatoryDamage += retDmg;
          console.log(`[ActionService.attack] Retaliatory damage (${eff.source ?? 'effect'}): ${retDmg} ${eff.damageType ?? ''}`);
        }
        if (totalRetaliatoryDamage > 0) {
          const atkHpBefore = attackerState.hpCurrent;
          const atkHpAfter = Math.max(0, atkHpBefore - totalRetaliatoryDamage);
          await this.combat.updateCombatantState(attackerState.id, { hpCurrent: atkHpAfter });
          await applyKoEffectsIfNeeded(attackerState, atkHpBefore, atkHpAfter, this.combat);
          console.log(`[ActionService.attack] Retaliatory damage: ${totalRetaliatoryDamage} to attacker (HP: ${atkHpBefore} ? ${atkHpAfter})`);
        }
      }
    }

    await this.combat.updateCombatantState(attackerState.id, {
      resources: spendAction(attackerState.resources),
    });

    if (this.events) {
      await this.events.append(sessionId, {
        id: nanoid(),
        type: "AttackResolved",
        payload: {
          encounterId: encounter.id,
          attacker: input.attacker,
          target: input.target,
          attackName: spec.name || attackerEquippedWeapon,
          // Flattened fields for easier consumption
          attackRoll: result.attack.d20,
          attackBonus: spec.attackBonus,
          attackTotal: result.attack.total,
          targetAC: targetAC,
          hit: result.hit,
          critical: result.critical,
          damageApplied: result.damage.applied,
          // Full result for backward compatibility
          result,
        },
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
          },
        });

        // Check concentration if target is concentrating
        const concentrationSpellName = getConcentrationSpellName(updatedTarget.resources);
        if (concentrationSpellName) {
          // CON saving throw modifier (ability mod + proficiency if proficient)
          const conSaveMod = computeConSaveModifier(
            targetAbilityScores.constitution,
            targetStats.proficiencyBonus,
            // saveProficiencies not available via CombatantCombatStats yet;
            // fall back to just ability modifier + 0 proficiency override
          );

          const appliedDamage = (result as any).damage.applied as number;
          const checkResult = concentrationCheckOnDamage(
            new SeededDiceRoller(seed + 1000),
            appliedDamage,
            conSaveMod,
          );

          if (!checkResult.maintained) {
            await breakConcentration(
              updatedTarget, encounter.id, this.combat,
            );
          }

          // Emit event
          const eventType = checkResult.maintained
            ? "ConcentrationMaintained"
            : "ConcentrationBroken";
          await this.events.append(sessionId, {
            id: nanoid(),
            type: eventType,
            payload: {
              encounterId: encounter.id,
              combatant: input.target,
              spellName: concentrationSpellName,
              dc: checkResult.dc,
              roll: checkResult.check.total,
              damage: appliedDamage,
            },
          });
        }
      }

      // TODO: Re-enable attack narration when INarrativeGenerator is wired to ActionService
      // See infrastructure/llm/narrative-generator.ts for the active implementation
    }

    return { result, target: updatedTarget };
  }

  async dodge(sessionId: string, input: SimpleActionBaseInput): Promise<{ actor: CombatantStateRecord }> {
    const result = await this.performSimpleAction(sessionId, input, "Dodge");

    // Apply Dodge active effects:
    // 1. Attacks against the dodger have disadvantage
    // 2. Dodger has advantage on DEX saving throws
    const entityId = result.actor.characterId ?? result.actor.monsterId ?? result.actor.npcId ?? result.actor.id;
    const dodgeEffects = [
      createEffect(nanoid(), 'disadvantage', 'attack_rolls', 'until_start_of_next_turn', {
        targetCombatantId: entityId,
        source: 'Dodge',
        description: 'Attacks against this creature have disadvantage',
      }),
      createEffect(nanoid(), 'advantage', 'saving_throws', 'until_start_of_next_turn', {
        ability: 'dexterity',
        source: 'Dodge',
        description: 'Advantage on Dexterity saving throws',
      }),
    ];
    const updatedResources = addActiveEffectsToResources(
      normalizeResources(result.actor.resources),
      ...dodgeEffects,
    );
    const updatedActor = await this.combat.updateCombatantState(result.actor.id, {
      resources: updatedResources,
    });

    return { actor: updatedActor };
  }

  async dash(sessionId: string, input: SimpleActionBaseInput): Promise<{ actor: CombatantStateRecord }> {
    return this.performSimpleAction(sessionId, input, "Dash");
  }

  async disengage(sessionId: string, input: SimpleActionBaseInput): Promise<{ actor: CombatantStateRecord }> {
    return this.performSimpleAction(sessionId, input, "Disengage");
  }

  async hide(sessionId: string, input: HideActionInput): Promise<{
    actor: CombatantStateRecord;
    result: {
      success: boolean;
      stealthRoll: number;
      reason?: string;
    };
  }> {
    if (input.seed !== undefined && !Number.isInteger(input.seed)) {
      throw new ValidationError("seed must be an integer");
    }

    const { encounter, combatants, actorState } = await this.resolveActiveActorOrThrow(sessionId, {
      encounterId: input.encounterId,
      actor: input.actor,
      skipActionCheck: input.isBonusAction ?? input.skipActionCheck, // Skip action check if using bonus action
    });

    const seed =
      (input.seed as number | undefined) ??
      hashStringToInt32(
        `${sessionId}:${encounter.id}:${encounter.round}:${encounter.turn}:Hide:${JSON.stringify(input.actor)}`,
      );

    const actorStats = await this.combatants.getCombatStats(input.actor);
    
    // Get stealth modifier from skills if available, otherwise calculate from Dex + proficiency
    let stealthModifier: number;
    if (actorStats.skills?.stealth !== undefined) {
      // Use pre-calculated stealth modifier from character sheet
      stealthModifier = actorStats.skills.stealth;
    } else {
      // Calculate: Dex mod + proficiency bonus (assuming proficiency in Stealth)
      const dexMod = modifier(actorStats.abilityScores.dexterity);
      stealthModifier = dexMod + actorStats.proficiencyBonus;
    }

    const dice = new SeededDiceRoller(seed);

    // ActiveEffect bonuses on ability checks (e.g., Guidance +1d4 on Stealth)
    const actorCheckMods = abilityCheckEffectMods(actorState.resources, dice, 'dexterity');

    const hideResult = attemptHide(dice, {
      stealthModifier: stealthModifier + actorCheckMods.bonus,
      hasCoverOrObscurement: input.hasCover ?? true, // Assume cover for simplicity
      clearlyVisible: false, // Assume not clearly visible
      mode: actorCheckMods.mode !== "normal" ? actorCheckMods.mode : undefined,
    });

    // Spend action (or bonus action was already spent before calling this)
    let updatedActor = actorState;
    if (!input.isBonusAction && !input.skipActionCheck) {
      updatedActor = await this.combat.updateCombatantState(actorState.id, {
        resources: spendAction(actorState.resources),
      });
    }

    // If hide succeeded, add Hidden condition
    if (hideResult.success) {
      let conditions = normalizeConditions(updatedActor.conditions);
      conditions = addCondition(conditions, createCondition("Hidden" as Condition, "until_removed"));
      updatedActor = await this.combat.updateCombatantState(updatedActor.id, {
        conditions: conditions as any,
        // Store stealth roll for later detection checks
        resources: { ...(updatedActor.resources as any ?? {}), stealthRoll: hideResult.stealthRoll },
      });
    }

    if (this.events) {
      await this.events.append(sessionId, {
        id: nanoid(),
        type: "ActionResolved",
        payload: {
          encounterId: encounter.id,
          actor: input.actor,
          action: "Hide",
          success: hideResult.success,
          stealthRoll: hideResult.stealthRoll,
          reason: hideResult.reason,
        },
      });
    }

    return {
      actor: updatedActor,
      result: {
        success: hideResult.success,
        stealthRoll: hideResult.stealthRoll,
        reason: hideResult.reason,
      },
    };
  }

  /**
   * Search action: Wisdom (Perception) check to reveal Hidden creatures.
   * D&D 5e 2024: The Search action uses a Perception check vs. each hidden creature's Stealth DC.
   */
  async search(sessionId: string, input: SearchActionInput): Promise<{
    actor: CombatantStateRecord;
    result: {
      found: string[];
      roll: number;
    };
  }> {
    if (input.seed !== undefined && !Number.isInteger(input.seed)) {
      throw new ValidationError("seed must be an integer");
    }

    const { encounter, combatants, actorState } = await this.resolveActiveActorOrThrow(sessionId, {
      encounterId: input.encounterId,
      actor: input.actor,
      skipActionCheck: input.skipActionCheck,
    });

    const seed =
      (input.seed as number | undefined) ??
      hashStringToInt32(
        `${sessionId}:${encounter.id}:${encounter.round}:${encounter.turn}:Search:${JSON.stringify(input.actor)}`,
      );

    const actorStats = await this.combatants.getCombatStats(input.actor);

    // Get perception modifier from skills if available, otherwise calculate from Wis + proficiency
    let perceptionModifier: number;
    if (actorStats.skills?.perception !== undefined) {
      perceptionModifier = actorStats.skills.perception;
    } else {
      const wisMod = modifier(actorStats.abilityScores.wisdom);
      perceptionModifier = wisMod + actorStats.proficiencyBonus;
    }

    const dice = new SeededDiceRoller(seed);

    // ActiveEffect bonuses on ability checks (e.g., Guidance +1d4 on Perception)
    const actorCheckMods = abilityCheckEffectMods(actorState.resources, dice, 'wisdom');

    const searchResult = attemptSearch(dice, {
      modifier: perceptionModifier + actorCheckMods.bonus,
      dc: 0, // We'll contest against each hidden creature's stealth
      checkType: "perception",
      mode: actorCheckMods.mode !== "normal" ? actorCheckMods.mode : undefined,
    });
    const perceptionRoll = searchResult.roll;

    // Find all Hidden combatants on the opposing faction
    const found: string[] = [];
    let updatedActor = actorState;

    const actorIsPC = input.actor.type === "Character" || input.actor.type === "NPC";

    for (const combatant of combatants) {
      // Skip self
      const combatantId = combatant.characterId ?? combatant.monsterId ?? combatant.npcId;
      const actorId = (input.actor as any).characterId ?? (input.actor as any).monsterId ?? (input.actor as any).npcId;
      if (combatantId === actorId) continue;

      // Only check opposing faction
      const otherIsPC = combatant.combatantType === "Character" || combatant.combatantType === "NPC";
      if (actorIsPC === otherIsPC) continue;

      // Check if this combatant is Hidden
      const conditions = normalizeConditions(combatant.conditions);
      const isHidden = conditions.some((c: any) => c.condition === "Hidden");
      if (!isHidden) continue;

      // Contest: perception roll vs. stealth DC (stored as stealthRoll on the hidden creature)
      const res = normalizeResources(combatant.resources);
      const stealthDC = typeof (res as any).stealthRoll === "number" ? (res as any).stealthRoll : 10;

      if (perceptionRoll >= stealthDC) {
        // Found! Remove Hidden condition
        const updatedConditions = removeCondition(conditions, "Hidden" as Condition);
        await this.combat.updateCombatantState(combatant.id, {
          conditions: updatedConditions as any,
        });
        const combatantName = combatantId ?? "creature";
        found.push(combatantName);
      }
    }

    // Spend action
    updatedActor = await this.combat.updateCombatantState(actorState.id, {
      resources: spendAction(actorState.resources),
    });

    if (this.events) {
      await this.events.append(sessionId, {
        id: nanoid(),
        type: "ActionResolved",
        payload: {
          encounterId: encounter.id,
          actor: input.actor,
          action: "Search",
          perceptionRoll,
          found,
        },
      });
    }

    return {
      actor: updatedActor,
      result: {
        found,
        roll: perceptionRoll,
      },
    };
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
      attackRoll: number;
      attackTotal: number;
      targetAC: number;
      hit: boolean;
      dc: number;
      saveRoll: number;
      total: number;
      abilityUsed: "strength" | "dexterity";
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
      skipActionCheck: true,
    });

    // D&D 5e 2024: Shove replaces one attack within a multi-attack action (Unarmed Strike).
    // Set up attacksAllowedThisTurn based on Extra Attack, then check canMakeAttack.
    const actorStats = await this.combatants.getCombatStats(input.actor);
    let currentResources = actorState.resources;
    const attacksPerAction = ClassFeatureResolver.getAttacksPerAction(null, actorStats.className, actorStats.level);
    if (attacksPerAction > 1 && getAttacksAllowedThisTurn(currentResources) === 1) {
      currentResources = setAttacksAllowed(currentResources, attacksPerAction);
    }
    if (!canMakeAttack(currentResources)) {
      throw new ValidationError("Actor has no attacks remaining this turn");
    }

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

    const targetStats = await this.combatants.getCombatStats(input.target);

    const attackerStrMod = modifier(actorStats.abilityScores.strength);
    const targetStrMod = modifier(targetStats.abilityScores.strength);
    const targetDexMod = modifier(targetStats.abilityScores.dexterity);

    // Check size - target can be at most one size larger
    const targetTooLarge = isTargetTooLarge(actorStats.size, targetStats.size);

    const dice = new SeededDiceRoller(seed);

    const result = shoveTarget(
      attackerStrMod,
      actorStats.proficiencyBonus,
      targetStats.armorClass,
      targetStrMod,
      targetDexMod,
      targetTooLarge,
      dice,
    );

    // Consume one attack from the multi-attack pool (marks action spent when all attacks used).
    const updatedActor = await this.combat.updateCombatantState(actorState.id, {
      resources: useAttack(currentResources),
    });

    let updatedTarget = targetState;
    let pushedTo: Position | undefined;

    if (result.success && shoveType === "push") {
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

    if (result.success && shoveType === "prone") {
      if (!isConditionImmuneByEffects(targetState.resources, "Prone")) {
        let conditions = normalizeConditions(targetState.conditions);
        conditions = addCondition(conditions, createCondition("Prone" as Condition, "until_removed"));
        updatedTarget = await this.combat.updateCombatantState(targetState.id, {
          conditions: conditions as any,
        });
      }
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
          success: result.success,
          attackRoll: result.attackRoll,
          attackTotal: result.attackTotal,
          targetAC: result.targetAC,
          hit: result.hit,
          dc: result.dc,
          saveRoll: result.saveRoll,
          total: result.total,
          abilityUsed: result.abilityUsed,
          ...(pushedTo ? { pushedTo } : {}),
        },
      });
    }

    return {
      actor: updatedActor,
      target: updatedTarget,
      result: {
        success: result.success,
        shoveType,
        attackRoll: result.attackRoll,
        attackTotal: result.attackTotal,
        targetAC: result.targetAC,
        hit: result.hit,
        dc: result.dc,
        saveRoll: result.saveRoll,
        total: result.total,
        abilityUsed: result.abilityUsed,
        reason: result.reason,
        ...(pushedTo ? { pushedTo } : {}),
      },
    };
  }

  async grapple(sessionId: string, input: GrappleActionInput): Promise<{
    actor: CombatantStateRecord;
    target: CombatantStateRecord;
    result: {
      success: boolean;
      attackRoll: number;
      attackTotal: number;
      targetAC: number;
      hit: boolean;
      dc: number;
      saveRoll: number;
      total: number;
      abilityUsed: "strength" | "dexterity";
      reason?: string;
    };
  }> {
    if (input.seed !== undefined && !Number.isInteger(input.seed)) {
      throw new ValidationError("seed must be an integer");
    }

    const { encounter, combatants, actorState } = await this.resolveActiveActorOrThrow(sessionId, {
      encounterId: input.encounterId,
      actor: input.actor,
      skipActionCheck: true,
    });

    // D&D 5e 2024: Grapple replaces one attack within a multi-attack action (Unarmed Strike).
    // Set up attacksAllowedThisTurn based on Extra Attack, then check canMakeAttack.
    const actorStats = await this.combatants.getCombatStats(input.actor);
    let currentResources = actorState.resources;
    const attacksPerAction = ClassFeatureResolver.getAttacksPerAction(null, actorStats.className, actorStats.level);
    if (attacksPerAction > 1 && getAttacksAllowedThisTurn(currentResources) === 1) {
      currentResources = setAttacksAllowed(currentResources, attacksPerAction);
    }
    if (!canMakeAttack(currentResources)) {
      throw new ValidationError("Actor has no attacks remaining this turn");
    }

    const targetState = findCombatantStateByRef(combatants, input.target);
    if (!targetState) throw new NotFoundError("Target not found in encounter");
    if (targetState.hpCurrent <= 0) throw new ValidationError("Target is down");
    if (targetState.id === actorState.id) throw new ValidationError("Cannot grapple self");

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

    const seed =
      (input.seed as number | undefined) ??
      hashStringToInt32(
        `${sessionId}:${encounter.id}:${encounter.round}:${encounter.turn}:Grapple:${JSON.stringify(input.actor)}:${JSON.stringify(input.target)}`,
      );

    const targetStats = await this.combatants.getCombatStats(input.target);

    const attackerStrMod = modifier(actorStats.abilityScores.strength);
    const targetStrMod = modifier(targetStats.abilityScores.strength);
    const targetDexMod = modifier(targetStats.abilityScores.dexterity);

    // Check size - target can be at most one size larger
    const targetTooLarge = isTargetTooLarge(actorStats.size, targetStats.size);

    // Check free hand - character needs at least one free hand to grapple
    const hasFreeHand = !actorStats.hasTwoHandedWeapon;

    const dice = new SeededDiceRoller(seed);

    const result = grappleTarget(
      attackerStrMod,
      actorStats.proficiencyBonus,
      targetStats.armorClass,
      targetStrMod,
      targetDexMod,
      targetTooLarge,
      hasFreeHand,
      dice,
    );

    // Consume one attack from the multi-attack pool (marks action spent when all attacks used).
    const updatedActor = await this.combat.updateCombatantState(actorState.id, {
      resources: useAttack(currentResources),
    });

    let updatedTarget = targetState;

    if (result.success) {
      // Apply Grappled condition to target, storing grappler identity for escape contests
      if (!isConditionImmuneByEffects(targetState.resources, "Grappled")) {
        let conditions = normalizeConditions(targetState.conditions);
        conditions = addCondition(conditions, createCondition("Grappled" as Condition, "until_removed", {
          source: actorState.id,
        }));
        updatedTarget = await this.combat.updateCombatantState(targetState.id, {
          conditions: conditions as any,
        });
      }
    }

    if (this.events) {
      await this.events.append(sessionId, {
        id: nanoid(),
        type: "ActionResolved",
        payload: {
          encounterId: encounter.id,
          actor: input.actor,
          action: "Grapple",
          target: input.target,
          success: result.success,
          attackRoll: result.attackRoll,
          attackTotal: result.attackTotal,
          targetAC: result.targetAC,
          hit: result.hit,
          dc: result.dc,
          saveRoll: result.saveRoll,
          total: result.total,
          abilityUsed: result.abilityUsed,
        },
      });
    }

    return {
      actor: updatedActor,
      target: updatedTarget,
      result: {
        success: result.success,
        attackRoll: result.attackRoll,
        attackTotal: result.attackTotal,
        targetAC: result.targetAC,
        hit: result.hit,
        dc: result.dc,
        saveRoll: result.saveRoll,
        total: result.total,
        abilityUsed: result.abilityUsed,
        reason: result.reason,
      },
    };
  }

  /**
   * Escape from a grapple (2024 rules).
   * DC = 8 + grappler's STR mod + grappler's proficiency bonus.
   * Escapee rolls Athletics (STR) or Acrobatics (DEX) � picks higher.
   * On success the Grappled condition is removed.
   */
  async escapeGrapple(sessionId: string, input: SimpleActionBaseInput): Promise<{
    actor: CombatantStateRecord;
    result: {
      success: boolean;
      dc: number;
      saveRoll: number;
      total: number;
      abilityUsed: "strength" | "dexterity";
      reason?: string;
    };
  }> {
    if (input.seed !== undefined && !Number.isInteger(input.seed)) {
      throw new ValidationError("seed must be an integer");
    }

    const { encounter, combatants, actorState } = await this.resolveActiveActorOrThrow(sessionId, {
      encounterId: input.encounterId,
      actor: input.actor,
    });

    // Verify actor is actually grappled
    const actorConditions = normalizeConditions(actorState.conditions);
    const isGrappled = actorConditions.some(c => c.condition === "Grappled");
    if (!isGrappled) {
      throw new ValidationError("Actor is not grappled");
    }

    const seed =
      (input.seed as number | undefined) ??
      hashStringToInt32(
        `${sessionId}:${encounter.id}:${encounter.round}:${encounter.turn}:EscapeGrapple:${JSON.stringify(input.actor)}`,
      );

    const actorStats = await this.combatants.getCombatStats(input.actor);

    const escapeeStrMod = modifier(actorStats.abilityScores.strength);
    const escapeeDexMod = modifier(actorStats.abilityScores.dexterity);

    // Look up skill proficiencies for Athletics (STR) and Acrobatics (DEX)
    const skills = actorStats.skills;
    const skillProficiency = skills ? {
      athleticsBonus: typeof skills.athletics === "number" ? actorStats.proficiencyBonus : 0,
      acrobaticsBonus: typeof skills.acrobatics === "number" ? actorStats.proficiencyBonus : 0,
    } : undefined;

    // Find who grappled the actor � look for grapple source on the condition,
    // or fallback to STR +0 / prof +2 if grappler can't be identified
    let grapplerStrMod = 0;
    let grapplerProfBonus = 2;
    const grapplerCondition = actorConditions.find(c => c.condition === "Grappled" && c.source);
    if (grapplerCondition?.source) {
      const grappler = combatants.find(c => c.id === grapplerCondition.source);
      if (grappler) {
        const grapplerRef: CombatantRef =
          grappler.combatantType === "Character"
            ? { type: "Character", characterId: grappler.characterId ?? grappler.id }
            : grappler.combatantType === "NPC"
              ? { type: "NPC", npcId: grappler.npcId ?? grappler.id }
              : { type: "Monster", monsterId: grappler.monsterId ?? grappler.id };
        const grapplerStats = await this.combatants.getCombatStats(grapplerRef);
        grapplerStrMod = modifier(grapplerStats.abilityScores.strength);
        grapplerProfBonus = grapplerStats.proficiencyBonus;
      }
    }

    const dice = new SeededDiceRoller(seed);

    const result = escapeGrapple(
      grapplerStrMod,
      grapplerProfBonus,
      escapeeStrMod,
      escapeeDexMod,
      dice,
      skillProficiency,
    );

    // Spend action
    const updatedResources = spendAction(actorState.resources);

    let updatedActor: CombatantStateRecord;
    if (result.success) {
      // Remove Grappled condition on success
      const conditions = removeCondition(actorConditions, "Grappled" as Condition);
      updatedActor = await this.combat.updateCombatantState(actorState.id, {
        resources: updatedResources,
        conditions: conditions as any,
      });
    } else {
      updatedActor = await this.combat.updateCombatantState(actorState.id, {
        resources: updatedResources,
      });
    }

    if (this.events) {
      await this.events.append(sessionId, {
        id: nanoid(),
        type: "ActionResolved",
        payload: {
          encounterId: encounter.id,
          actor: input.actor,
          action: "EscapeGrapple",
          success: result.success,
          dc: result.dc,
          saveRoll: result.saveRoll,
          total: result.total,
          abilityUsed: result.abilityUsed,
        },
      });
    }

    return {
      actor: updatedActor,
      result: {
        success: result.success,
        dc: result.dc,
        saveRoll: result.saveRoll,
        total: result.total,
        abilityUsed: result.abilityUsed,
        reason: result.reason,
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
    const speed = getEffectiveSpeed(actor.resources);

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
        
        // Check if observer is incapacitated (can't make opportunity attacks)
        const otherConditions = Array.isArray(other.conditions) ? (other.conditions as string[]) : [];
        const observerIncapacitated = otherConditions.some(
          (c) => typeof c === "string" && c.toLowerCase() === "incapacitated",
        );
        
        const canAttack = canMakeOpportunityAttack(
          { reactionUsed: !hasReaction },
          {
            movingCreatureId: actor.id,
            observerId: other.id,
            disengaged: isDisengaged,
            canSee: true, // Vision checks would require line-of-sight calculation
            observerIncapacitated,
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

    // Update position and track remaining movement
    const distanceMoved = currentPos ? calculateDistance(currentPos, input.destination) : 0;
    const currentRemaining = typeof (resources as any).movementRemaining === "number"
      ? (resources as any).movementRemaining
      : (typeof (resources as any).speed === "number" ? (resources as any).speed : 30);
    const newMovementRemaining = Math.max(0, currentRemaining - distanceMoved);
    const updatedResources = {
      ...resources,
      position: input.destination,
      movementSpent: newMovementRemaining <= 0,
      movementRemaining: newMovementRemaining,
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

      // Apply KO effects if target dropped to 0 HP from opportunity attack
      await applyKoEffectsIfNeeded(updatedActor, updatedActor.hpCurrent, newHp, this.combat);

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
          },
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
            },
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
        },
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
