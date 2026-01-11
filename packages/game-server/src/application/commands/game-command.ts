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

export type GameCommand = EndTurnCommand | AttackCommand | RollResultCommand;

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
    "  | { kind: 'attack'; encounterId?: string; attacker: CombatantRef; target: CombatantRef; seed?: number; spec?: AttackSpec; monsterAttackName?: string }",
    "  | { kind: 'rollResult'; rollType: 'initiative'|'attack'|'damage'|'savingThrow'|'abilityCheck'; value?: number; values?: number[]; context?: string };",
    "", 
    "Rules:",
    "- Use ONLY ids from the roster below.",
    "- If combat is not mentioned, omit encounterId.",
    "- For kind='attack':",
    "  - If attacker.type='Character', you MUST include spec.",
    "  - If attacker.type='Monster', include either spec OR monsterAttackName.",
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
    "Example (roll result - single):",
    "{ 'kind': 'rollResult', 'rollType': 'initiative', 'value': 15 }",
    "",
    "Example (roll result - advantage):",
    "{ 'kind': 'rollResult', 'rollType': 'attack', 'values': [12, 8] }",
    "", 
    "Roster (valid IDs):",
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
  if (kind !== "attack" && kind !== "endTurn" && kind !== "rollResult") {
    throw new ValidationError("command.kind must be 'attack', 'endTurn', or 'rollResult'");
  }

  const encounterId = readOptionalString(input, "encounterId");

  if (kind === "endTurn") {
    const actor = parseCombatantRef(input.actor, "actor");
    return { kind, encounterId, actor };
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

  if (attacker.type === "Character") {
    if (spec === undefined) {
      throw new ValidationError(
        "attack.spec is required when attacker.type is 'Character' (include attackBonus and damage dice)",
      );
    }
  } else {
    // Monster attackers can omit spec if selecting an attack by name from stat block.
    if (spec === undefined && !monsterAttackName) {
      throw new ValidationError(
        "attack requires either spec or monsterAttackName when attacker.type is 'Monster'",
      );
    }
  }

  return { kind, encounterId, attacker, target, seed, spec, monsterAttackName };
}
