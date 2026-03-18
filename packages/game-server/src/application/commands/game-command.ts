import { ValidationError } from "../errors.js";

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function readOptionalString(x: Record<string, unknown>, key: string): string | undefined {
  const v = x[key];
  if (v === undefined) return undefined;
  if (typeof v !== "string") throw new ValidationError(`${key} must be a string`);
  return v;
}

function readRequiredString(x: Record<string, unknown>, key: string): string {
  const v = x[key];
  if (typeof v !== "string" || v.length === 0) throw new ValidationError(`${key} must be a non-empty string`);
  return v;
}

function readOptionalInteger(x: Record<string, unknown>, key: string): number | undefined {
  const v = x[key];
  if (v === undefined) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v)) throw new ValidationError(`${key} must be an integer`);
  return v;
}

export type CombatantRef =
  | { type: "Character"; characterId: string }
  | { type: "Monster"; monsterId: string }
  | { type: "NPC"; npcId: string };

export type EndTurnCommand = {
  kind: "endTurn";
  encounterId?: string;
  actor: CombatantRef;
};

export type MoveCommand = {
  kind: "move";
  encounterId?: string;
  actor: CombatantRef;
  destination: { x: number; y: number };
};

export type MoveTowardCommand = {
  kind: "moveToward";
  encounterId?: string;
  actor: CombatantRef;
  target: CombatantRef;
  /** Desired stopping distance in feet. Default 5 (melee). */
  desiredRange?: number;
};

export type AttackCommand = {
  kind: "attack";
  encounterId?: string;
  attacker: CombatantRef;
  target: CombatantRef;
  seed?: number;
  spec?: unknown;
  monsterAttackName?: string;
};

export type RollResultCommand = {
  kind: "rollResult";
  rollType: "initiative" | "attack" | "damage" | "savingThrow" | "abilityCheck";
  value?: number;        // Single roll value
  values?: number[];     // For advantage/disadvantage (2d20)
  context?: string;      // Optional player description
};

/**
 * Query command for asking questions about character data, combat state, etc.
 * The CLI resolves most of these locally from cached data.
 */
export type QueryCommand = {
  kind: "query";
  subject: "hp" | "weapons" | "spells" | "features" | "party" | "stats" | "equipment" | "ac" | "actions" | "tactical" | "environment";
};

export type GameCommand = EndTurnCommand | MoveCommand | MoveTowardCommand | AttackCommand | RollResultCommand | QueryCommand;

export type LlmRoster = {
  characters: Array<{ id: string; name: string }>;
  monsters: Array<{ id: string; name: string }>;
  npcs: Array<{ id: string; name: string }>;
};

export function buildGameCommandSchemaHint(roster: LlmRoster): string {
  return [
    "You must output exactly ONE JSON object matching this TypeScript-like schema:",
    "", 
    "type CombatantRef =",
    "  | { type: 'Character'; characterId: string }",
    "  | { type: 'Monster'; monsterId: string }",
    "  | { type: 'NPC'; npcId: string };",
    "",
    "type AttackSpec = {",
    "  kind?: 'melee' | 'ranged';",
    "  attackBonus: number; // integer",
    "  attackAbility?: 'strength'|'dexterity'|'constitution'|'intelligence'|'wisdom'|'charisma';",
    "  mode?: 'normal'|'advantage'|'disadvantage';",
    "  damage: { diceCount: number; diceSides: number; modifier?: number };",
    "};",
    "", 
    "type GameCommand =",
    "  | { kind: 'endTurn'; encounterId?: string; actor: CombatantRef }",
    "  | { kind: 'move'; encounterId?: string; actor: CombatantRef; destination: { x: number; y: number } }",
    "  | { kind: 'moveToward'; encounterId?: string; actor: CombatantRef; target: CombatantRef; desiredRange?: number }",
    "  | { kind: 'attack'; encounterId?: string; attacker: CombatantRef; target: CombatantRef; seed?: number; spec?: AttackSpec; monsterAttackName?: string }",
    "  | { kind: 'rollResult'; rollType: 'initiative'|'attack'|'damage'|'savingThrow'|'abilityCheck'; value?: number; values?: number[]; context?: string }",
    "  | { kind: 'query'; subject: 'hp'|'weapons'|'spells'|'features'|'party'|'stats'|'equipment'|'ac'|'actions'|'tactical'|'environment' };",
    "",
    "QUESTION DETECTION:",
    "If the player is asking a question about their character or the game state, use kind='query' with the appropriate subject:",
    "- 'hp' - asking about hit points, health, damage taken",
    "- 'weapons' - asking about weapons, attacks available",
    "- 'spells' - asking about spells, cantrips, spell slots",
    "- 'features' - asking about class features, abilities, racial traits",
    "- 'party' - asking about party members, allies, companions",
    "- 'stats' - asking about ability scores, modifiers, proficiency",
    "- 'equipment' - asking about inventory, items, gear, what they're carrying",
    "- 'ac' - asking about armor class, defenses",
    "- 'actions' - asking about what actions they can take, turn economy",
    "- 'tactical' - asking about distances, positions, who's nearest, can I reach (combat positioning)",    "- 'environment' - asking about the room, surroundings, cover, terrain, obstacles, objects in the area",    "",
    "Rules:",
    "- Use ONLY ids from the roster below.",
    "- If combat is not mentioned, omit encounterId.",
    "- For kind='move':",
    "  - destination.x and destination.y are coordinates in FEET.",
    "- For kind='moveToward':",
    "  - Use this when the player wants to move to/toward/near a creature by name.",
    "  - target is a CombatantRef identifying who to move toward.",
    "  - desiredRange is how close to get (in feet). Default 5 for melee. Use 30+ for ranged positioning.",
    "  - Infer desiredRange from context: 'move to the orc' → 5, 'get within bow range' → 30, 'get close' → 5.",
    "- For kind='attack':",
    "  - spec is optional for Character attackers (server reads from character sheet if omitted).",
    "  - If attacker.type='Monster', include either spec OR monsterAttackName.",
    "  - When multiple creatures share the same name, use the distanceFeet field in the roster to pick the right one.",
    "  - If the player says 'nearest' or doesn't name a specific target, pick the target with the smallest distanceFeet.",
    "  - For melee attacks, prefer targets within 5ft (distanceFeet ≤ 5).",
    "- For kind='rollResult':",
    "  - Extract the dice roll value(s) from natural language (e.g., 'I rolled a 15' → value: 15).",
    "  - For advantage/disadvantage rolls, use values array (e.g., 'I rolled 12 and 8' → values: [12, 8]).",
    "  - Infer rollType from context (initiative, attack, damage, saving throw, ability check).",
    "- Do not include extra keys.",
    "",
    "Example (character attack):",
    "{",
    "  'kind': 'attack',",
    "  'attacker': { 'type': 'Character', 'characterId': '<from roster>' },",
    "  'target': { 'type': 'Monster', 'monsterId': '<from roster>' },",
    "  'spec': { 'kind': 'melee', 'attackBonus': 5, 'damage': { 'diceCount': 1, 'diceSides': 8, 'modifier': 3 } }",
    "}",
    "",
    "Example (move to coordinates):",
    "{",
    "  'kind': 'move',",
    "  'actor': { 'type': 'Character', 'characterId': '<from roster>' },",
    "  'destination': { 'x': 35, 'y': 25 }",
    "}",
    "",
    "Example (move toward creature):",
    "{",
    "  'kind': 'moveToward',",
    "  'actor': { 'type': 'Character', 'characterId': '<from roster>' },",
    "  'target': { 'type': 'Monster', 'monsterId': '<from roster>' },",
    "  'desiredRange': 5",
    "}",
    "",
    "Example (roll result - single):",
    "{ 'kind': 'rollResult', 'rollType': 'initiative', 'value': 15 }",
    "",
    "Example (roll result - advantage):",
    "{ 'kind': 'rollResult', 'rollType': 'attack', 'values': [12, 8] }",
    "", 
    "Roster (valid IDs — distanceFeet shows distance from the acting creature in feet):",
    JSON.stringify(roster, null, 2),
  ].join("\n");
}

export function parseCombatantRef(input: unknown, path: string): CombatantRef {
  if (!isRecord(input)) throw new ValidationError(`${path} must be an object`);

  const type = input.type;
  if (type === "Character") {
    return { type: "Character", characterId: readRequiredString(input, "characterId") };
  }
  if (type === "Monster") {
    return { type: "Monster", monsterId: readRequiredString(input, "monsterId") };
  }

  if (type === "NPC") {
    return { type: "NPC", npcId: readRequiredString(input, "npcId") };
  }

  throw new ValidationError(`${path}.type must be 'Character', 'Monster', or 'NPC'`);
}

export function parseGameCommand(input: unknown): GameCommand {
  if (!isRecord(input)) throw new ValidationError("command must be an object");

  const kind = input.kind;
  if (kind !== "attack" && kind !== "move" && kind !== "moveToward" && kind !== "endTurn" && kind !== "rollResult" && kind !== "query") {
    throw new ValidationError("command.kind must be 'attack', 'move', 'moveToward', 'endTurn', 'rollResult', or 'query'");
  }

  const encounterId = readOptionalString(input, "encounterId");

  if (kind === "query") {
    const subject = readRequiredString(input, "subject");
    const validSubjects = ["hp", "weapons", "spells", "features", "party", "stats", "equipment", "ac", "actions", "tactical", "environment"];
    if (!validSubjects.includes(subject)) {
      throw new ValidationError(`query.subject must be one of: ${validSubjects.join(", ")}`);
    }
    return { kind, subject: subject as QueryCommand["subject"] };
  }

  if (kind === "endTurn") {
    const actor = parseCombatantRef(input.actor, "actor");
    return { kind, encounterId, actor };
  }

  if (kind === "move") {
    const actor = parseCombatantRef(input.actor, "actor");
    const destRaw = input.destination;
    if (!isRecord(destRaw)) throw new ValidationError("destination must be an object");
    const x = readOptionalInteger(destRaw, "x");
    const y = readOptionalInteger(destRaw, "y");
    if (x === undefined || y === undefined) {
      throw new ValidationError("destination.x and destination.y are required integers (feet)");
    }
    return { kind, encounterId, actor, destination: { x, y } };
  }

  if (kind === "moveToward") {
    const actor = parseCombatantRef(input.actor, "actor");
    const target = parseCombatantRef(input.target, "target");
    const desiredRange = readOptionalInteger(input, "desiredRange");
    return { kind, encounterId, actor, target, desiredRange };
  }

  if (kind === "rollResult") {
    const rollTypeRaw = input.rollType;
    if (typeof rollTypeRaw !== "string") {
      throw new ValidationError("rollResult.rollType must be a string");
    }
    const validRollTypes = ["initiative", "attack", "damage", "savingThrow", "abilityCheck"];
    if (!validRollTypes.includes(rollTypeRaw)) {
      throw new ValidationError(
        `rollResult.rollType must be one of: ${validRollTypes.join(", ")}`
      );
    }
    const rollType = rollTypeRaw as RollResultCommand["rollType"];

    const value = input.value !== undefined ? readOptionalInteger(input, "value") : undefined;
    const valuesRaw = input.values;
    let values: number[] | undefined;
    if (valuesRaw !== undefined) {
      if (!Array.isArray(valuesRaw)) {
        throw new ValidationError("rollResult.values must be an array");
      }
      values = valuesRaw.map((v, i) => {
        if (typeof v !== "number" || !Number.isInteger(v)) {
          throw new ValidationError(`rollResult.values[${i}] must be an integer`);
        }
        return v;
      });
    }

    const context = readOptionalString(input, "context");

    if (value === undefined && values === undefined) {
      throw new ValidationError("rollResult must have either value or values");
    }

    return { kind, rollType, value, values, context };
  }

  const attacker = parseCombatantRef(input.attacker, "attacker");
  const target = parseCombatantRef(input.target, "target");
  const seed = readOptionalInteger(input, "seed");

  const monsterAttackNameRaw = input.monsterAttackName;
  const monsterAttackName =
    monsterAttackNameRaw === undefined
      ? undefined
      : typeof monsterAttackNameRaw === "string"
        ? monsterAttackNameRaw
        : null;
  if (monsterAttackName === null) {
    throw new ValidationError("monsterAttackName must be a string");
  }

  const spec = input.spec;
  if (spec !== undefined && !isRecord(spec)) {
    throw new ValidationError("spec must be an object");
  }

  // For Character attackers, spec is optional - the server will read from character sheet if not provided.
  // For Monster attackers, either spec or monsterAttackName must be provided.
  if (attacker.type === "Monster" && spec === undefined && !monsterAttackName) {
    throw new ValidationError(
      "attack requires either spec or monsterAttackName when attacker.type is 'Monster'",
    );
  }

  return { kind, encounterId, attacker, target, seed, spec, monsterAttackName };
}
