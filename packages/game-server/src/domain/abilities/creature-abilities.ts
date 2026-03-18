import type { Combat } from "../combat/combat.js";
import type { Creature } from "../entities/creatures/creature.js";
import { Character } from "../entities/creatures/character.js";
import { isCharacterClassId } from "../entities/classes/class-definition.js";
import { getClassDefinition } from "../entities/classes/registry.js";

/**
 * Extract class info from a creature, supporting Characters (via methods)
 * and NPCs/Monsters (via stat block JSON).
 */
export function extractClassInfo(
  creature: Creature,
  statBlock?: unknown,
): { classId: string; level: number } | undefined {
  if (creature instanceof Character) {
    const classId = creature.getClassId();
    const level = creature.getLevel();
    if (classId && level > 0) return { classId, level };
    return undefined;
  }

  // NPC/Monster: extract from stat block
  if (statBlock && typeof statBlock === "object") {
    const sb = statBlock as Record<string, unknown>;
    const className = typeof sb.className === "string" ? sb.className.toLowerCase() : undefined;
    const level = typeof sb.level === "number" ? sb.level : undefined;
    if (className && level && level > 0) return { classId: className, level };
  }

  return undefined;
}

export type AbilityEconomy = "action" | "bonus" | "reaction";
export type AbilitySource = "base" | "class" | "monster";

export interface ResourceCost {
  pool: string;
  amount: number;
}

export interface AbilityAttackSummary {
  kind: "melee" | "ranged" | "melee-or-ranged";
  attackBonus: number;
  reachFeet?: number;
  rangeFeet?: { normal: number; long?: number };
  damage?: {
    diceCount: number;
    diceSides: number;
    modifier: number;
    average?: number;
    type?: string;
    raw: string;
  };
}

export interface CreatureAbility {
  id: string;
  name: string;
  economy: AbilityEconomy;
  source: AbilitySource;
  summary?: string;
  resourceCost?: ResourceCost;
  attack?: AbilityAttackSummary;
  /** Data-driven execution intent hint. Consumer narrows on `kind`. */
  executionIntent?: { kind: string; [key: string]: unknown };
}

export type AbilityExecutionIntentKind = "attack" | "choice" | "text" | "flurry-of-blows";

export type AbilityExecutionIntent =
  | {
      kind: "attack";
      economy: AbilityEconomy;
      name: string;
      attack: AbilityAttackSummary;
      summary?: string;
    }
  | {
      kind: "choice";
      economy: AbilityEconomy;
      name: string;
      options: Array<{
        id: string;
        name: string;
        summary?: string;
      }>;
      summary?: string;
    }
  | {
      kind: "flurry-of-blows";
      economy: AbilityEconomy;
      name: string;
      unarmedStrikes: number;
      summary?: string;
    }
  | {
      kind: "text";
      economy: AbilityEconomy;
      name: string;
      summary?: string;
    };

export interface ListCreatureAbilitiesParams {
  creature: Creature;

  /**
   * Optional combat instance used for availability checks (action economy).
   */
  combat?: Combat;

  /**
   * Optional monster stat block JSON (e.g. ParsedMonsterStatBlock stored in DB).
   */
  monsterStatBlock?: unknown;
}

function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

function makeMonsterAbilityId(section: AbilityEconomy, name: string): string {
  return `monster:${section}:${slugify(name)}`;
}

function makeClassAbilityId(classId: string, name: string): string {
  return `class:${classId}:${slugify(name)}`;
}

type MonsterAbilityLike = {
  name?: unknown;
  text?: unknown;
  attack?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function coerceAbilityArray(value: unknown): MonsterAbilityLike[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord) as MonsterAbilityLike[];
}

function coerceAttackSummary(value: unknown): AbilityAttackSummary | undefined {
  if (!isRecord(value)) return undefined;

  const kindRaw = value.kind;
  const kind: AbilityAttackSummary["kind"] | null =
    kindRaw === "melee" || kindRaw === "ranged" || kindRaw === "melee-or-ranged" ? kindRaw : null;
  if (!kind) return undefined;

  const bonusRaw = value.attackBonus;
  const attackBonus = typeof bonusRaw === "number" ? bonusRaw : Number.NaN;
  if (!Number.isFinite(attackBonus)) return undefined;

  const reachFeet = typeof value.reachFeet === "number" ? value.reachFeet : undefined;
  const rangeFeet = isRecord(value.rangeFeet)
    ? {
        normal: typeof value.rangeFeet.normal === "number" ? value.rangeFeet.normal : 0,
        long: typeof value.rangeFeet.long === "number" ? value.rangeFeet.long : undefined,
      }
    : undefined;

  const damage = isRecord(value.damage)
    ? {
        diceCount: typeof value.damage.diceCount === "number" ? value.damage.diceCount : 0,
        diceSides: typeof value.damage.diceSides === "number" ? value.damage.diceSides : 0,
        modifier: typeof value.damage.modifier === "number" ? value.damage.modifier : 0,
        average: typeof value.damage.average === "number" ? value.damage.average : undefined,
        type: typeof value.damage.type === "string" ? value.damage.type : undefined,
        raw: typeof value.damage.raw === "string" ? value.damage.raw : "",
      }
    : undefined;

  return {
    kind,
    attackBonus,
    reachFeet,
    rangeFeet,
    damage,
  };
}

function coerceMonsterAbilitiesFromStatBlock(statBlock: unknown): CreatureAbility[] {
  if (!isRecord(statBlock)) return [];

  const actions = coerceAbilityArray(statBlock.actions);
  const bonusActions = coerceAbilityArray(statBlock.bonusActions);
  const reactions = coerceAbilityArray(statBlock.reactions);

  const out: CreatureAbility[] = [];

  for (const a of actions) {
    const name = typeof a.name === "string" ? a.name : "";
    if (!name) continue;

    out.push({
      id: makeMonsterAbilityId("action", name),
      name,
      economy: "action",
      source: "monster",
      summary: typeof a.text === "string" ? a.text : undefined,
      attack: coerceAttackSummary(a.attack),
      executionIntent: coerceExecutionIntent(a),
    });
  }

  for (const a of bonusActions) {
    const name = typeof a.name === "string" ? a.name : "";
    if (!name) continue;

    out.push({
      id: makeMonsterAbilityId("bonus", name),
      name,
      economy: "bonus",
      source: "monster",
      summary: typeof a.text === "string" ? a.text : undefined,
      executionIntent: coerceExecutionIntent(a),
    });
  }

  for (const a of reactions) {
    const name = typeof a.name === "string" ? a.name : "";
    if (!name) continue;

    out.push({
      id: makeMonsterAbilityId("reaction", name),
      name,
      economy: "reaction",
      source: "monster",
      summary: typeof a.text === "string" ? a.text : undefined,
      executionIntent: coerceExecutionIntent(a),
    });
  }

  return out;
}

/** Coerce an executionIntent from a stat block ability entry (monster JSON). */
function coerceExecutionIntent(entry: MonsterAbilityLike): CreatureAbility["executionIntent"] {
  const raw = (entry as Record<string, unknown>).executionIntent;
  if (!isRecord(raw)) return undefined;
  if (typeof raw.kind !== "string") return undefined;
  return raw as { kind: string; [key: string]: unknown };
}

/** Map ClassCapability.economy to AbilityEconomy. "free" is excluded (not an economy slot). */
function capabilityEconomyToAbilityEconomy(economy: string): AbilityEconomy | null {
  switch (economy) {
    case "action": return "action";
    case "bonusAction": return "bonus";
    case "reaction": return "reaction";
    default: return null; // "free" capabilities aren't action-economy abilities
  }
}

/**
 * Convert class capabilities (from the class registry) into CreatureAbility[].
 * Only capabilities that declare an `abilityId` and have a mappable economy are included.
 */
function classCapabilitiesToCreatureAbilities(classId: string, level: number): CreatureAbility[] {
  if (!isCharacterClassId(classId)) return [];
  const classDef = getClassDefinition(classId);
  if (!classDef.capabilitiesForLevel) return [];

  const capabilities = classDef.capabilitiesForLevel(level);
  const abilities: CreatureAbility[] = [];

  for (const cap of capabilities) {
    if (!cap.abilityId) continue; // Skip display-only capabilities (Extra Attack, etc.)
    const economy = capabilityEconomyToAbilityEconomy(cap.economy);
    if (!economy) continue; // Skip "free" abilities (handled as enhancements, not standalone)

    abilities.push({
      id: cap.abilityId,
      name: cap.name,
      economy,
      source: "class",
      summary: cap.effect,
      resourceCost: cap.resourceCost,
      executionIntent: cap.executionIntent,
    });
  }

  return abilities;
}

function canSpendEconomy(combat: Combat | undefined, creatureId: string, economy: AbilityEconomy): boolean {
  if (!combat) return true;

  switch (economy) {
    case "action":
      return combat.canSpendAction(creatureId);
    case "bonus":
      return combat.canSpendBonusAction(creatureId);
    case "reaction":
      return combat.canSpendReaction(creatureId);
  }
}

function canPayResourceCost(creature: Creature, cost: ResourceCost | undefined): boolean {
  if (!cost) return true;

  const maybe = creature as unknown as {
    canSpendResource?: (poolName: string, amount: number) => boolean;
  };

  return typeof maybe.canSpendResource === "function" ? maybe.canSpendResource(cost.pool, cost.amount) : false;
}

/**
 * Get class-derived abilities for a given class and level.
 * Used by AI context builder to enrich self-combatant context without
 * requiring a full Creature instance.
 */
export function getClassAbilities(classId: string, level: number): CreatureAbility[] {
  return classCapabilitiesToCreatureAbilities(classId, level);
}

/**
 * Minimal ability list used for orchestration/UI.
 *
 * - Monsters/NPCs: derived from imported stat block JSON.
 * - Class abilities: auto-derived from the class registry via `capabilitiesForLevel()`.
 *   Any class that declares capabilities with `abilityId` gets them surfaced here.
 *   Supports multiclass via multiple `extractClassInfos()` calls (future).
 */
export function listCreatureAbilities(params: ListCreatureAbilitiesParams): CreatureAbility[] {
  const { creature, monsterStatBlock } = params;

  const abilities: CreatureAbility[] = [
    {
      id: "base:attack",
      name: "Attack",
      economy: "action",
      source: "base",
    },
  ];

  abilities.push(...coerceMonsterAbilitiesFromStatBlock(monsterStatBlock));

  // Generic class capability → CreatureAbility conversion via the class registry.
  const classInfo = extractClassInfo(creature, monsterStatBlock);
  if (classInfo) {
    abilities.push(...classCapabilitiesToCreatureAbilities(classInfo.classId, classInfo.level));
  }

  return abilities;
}

export function canUseCreatureAbility(params: ListCreatureAbilitiesParams, ability: CreatureAbility): boolean {
  const { creature, combat } = params;
  if (!canSpendEconomy(combat, creature.getId(), ability.economy)) return false;
  if (!canPayResourceCost(creature, ability.resourceCost)) return false;
  return true;
}

export function spendCreatureAbilityCosts(params: ListCreatureAbilitiesParams, ability: CreatureAbility): void {
  const { creature, combat } = params;

  if (combat) {
    switch (ability.economy) {
      case "action":
        combat.spendAction(creature.getId());
        break;
      case "bonus":
        combat.spendBonusAction(creature.getId());
        break;
      case "reaction":
        combat.spendReaction(creature.getId());
        break;
    }
  }

  if (ability.resourceCost) {
    const maybe = creature as unknown as {
      spendResource?: (poolName: string, amount: number) => void;
    };

    if (typeof maybe.spendResource !== "function") {
      throw new Error(`Creature cannot spend resource '${ability.resourceCost.pool}'`);
    }

    maybe.spendResource(ability.resourceCost.pool, ability.resourceCost.amount);
  }
}

/**
 * Minimal execution intent for an ability.
 *
 * This does NOT mutate state; it just returns a structured hint that higher layers
 * (or the LLM) can translate into concrete ops/state transitions.
 *
 * Resolution order:
 * 1. If the ability has an explicit `attack`, return an attack intent.
 * 2. If the ability carries a data-driven `executionIntent`, use it.
 * 3. Fallback to generic text intent.
 */
export function getAbilityExecutionIntent(ability: CreatureAbility): AbilityExecutionIntent {
  const name = ability.name;
  const economy = ability.economy;

  // Attacks are explicit.
  if (ability.attack) {
    return {
      kind: "attack",
      economy,
      name,
      attack: ability.attack,
      summary: ability.summary,
    };
  }

  // Data-driven execution intent from class capability or stat block.
  if (ability.executionIntent) {
    const ei = ability.executionIntent;
    if (ei.kind === "flurry-of-blows") {
      return {
        kind: "flurry-of-blows",
        economy,
        name,
        unarmedStrikes: typeof ei.unarmedStrikes === "number" ? ei.unarmedStrikes : 2,
        summary: ability.summary,
      };
    }
    if (ei.kind === "choice" && Array.isArray(ei.options)) {
      return {
        kind: "choice",
        economy,
        name,
        options: ei.options as Array<{ id: string; name: string; summary?: string }>,
        summary: ability.summary,
      };
    }
    // Unknown intent kind — fall through to text.
  }

  return {
    kind: "text",
    economy,
    name,
    summary: ability.summary,
  };
}

export type CreatureAbilityMenuItem = {
  ability: CreatureAbility;
  canUse: boolean;
  intent: AbilityExecutionIntent;
};

/**
 * Convenience helper for building a UI/LLM-ready menu.
 *
 * This is intentionally in game-server only; server can opt-in later.
 */
export function buildCreatureAbilityMenu(params: ListCreatureAbilitiesParams): CreatureAbilityMenuItem[] {
  const abilities = listCreatureAbilities(params);
  return abilities.map((ability) => ({
    ability,
    canUse: canUseCreatureAbility(params, ability),
    intent: getAbilityExecutionIntent(ability),
  }));
}
