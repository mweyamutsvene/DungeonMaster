import type { Combat } from "../combat/combat.js";
import type { Creature } from "../entities/creatures/creature.js";
import { Character } from "../entities/creatures/character.js";

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
    });
  }

  return out;
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
 * Minimal ability list used for orchestration/UI.
 *
 * - Monsters: derived from imported stat block JSON.
 * - Characters: includes a small number of class abilities (starting with Monk: Flurry of Blows).
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

  if (creature instanceof Character) {
    const classId = creature.getClassId();
    const level = creature.getLevel();

    if (classId === "monk" && level >= 2) {
      abilities.push({
        id: makeClassAbilityId("monk", "Flurry of Blows"),
        name: "Flurry of Blows",
        economy: "bonus",
        source: "class",
        resourceCost: { pool: "ki", amount: 1 },
        summary: "Spend 1 ki point to make two Unarmed Strikes as a bonus action.",
      });
    }
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

function includesToken(haystack: string | undefined, needle: string): boolean {
  if (!haystack) return false;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/**
 * Minimal execution intent for an ability.
 *
 * This does NOT mutate state; it just returns a structured hint that higher layers
 * (or the LLM) can translate into concrete ops/state transitions.
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

  // Monk: Flurry of Blows.
  if (ability.id.startsWith("class:monk:") && includesToken(name, "flurry of blows")) {
    return {
      kind: "flurry-of-blows",
      economy,
      name,
      unarmedStrikes: 2,
      summary: ability.summary,
    };
  }

  // Goblin: Nimble Escape.
  if (ability.id.startsWith("monster:") && includesToken(name, "nimble escape")) {
    return {
      kind: "choice",
      economy,
      name,
      options: [
        { id: "disengage", name: "Disengage" },
        { id: "hide", name: "Hide" },
      ],
      summary: ability.summary,
    };
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
