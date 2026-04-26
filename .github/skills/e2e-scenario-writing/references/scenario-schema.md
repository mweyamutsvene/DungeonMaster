# Scenario JSON Schema Reference

This file describes the current runner-facing scenario shape.

Important constraint:

- `setup.sheet` for characters and `setup.monsters[].statBlock` for monsters are mostly pass-through objects.
- The runner itself only strongly knows the top-level scenario shape and a few setup container keys.
- For detailed sheet and stat-block structure, the most reliable reference is a nearby passing scenario in the same coverage area.

## Top-Level Structure

```typescript
{
  name: string;             // Descriptive scenario name
  description?: string;     // What this scenario tests
  setup: ScenarioSetup;     // Characters, monsters, AI config
  actions: ScenarioAction[]; // Ordered combat sequence
}
```

## Setup: Character

The runner accepts either:

- `setup.character` for a single-PC scenario
- `setup.characters` for a multi-PC scenario

`character` is legacy but still supported.

```typescript
{
  character: {
    name: string;
    className: string;
    level: number;
    subclass?: string;
    position?: { x: number; y: number };
    sheet?: Record<string, unknown>;
  }
}
```

Common `sheet` fields seen in live scenarios include:

- `abilityScores`
- `maxHp`
- `currentHp`
- `armorClass`
- `speed`
- `proficiencyBonus`
- `attacks`
- `spellcastingAbility`
- `spellSaveDC`
- `spellAttackBonus`
- `spellSlots`
- `preparedSpells`
- `resourcePools`
- `features`
- `inventory`
- `conditions`
- `featIds`
- `saveProficiencies`

Use nearby scenarios to confirm the detailed shape needed for a given class or feature.

### Multi-PC Setup

Use `characters` (array) instead of `character` for multi-PC scenarios. Each entry has the same shape. Use `actor` on action steps to specify which character acts.

```json
{
  "characters": [
    { "name": "Fighter", "className": "Fighter", ... },
    { "name": "Cleric", "className": "Cleric", ... }
  ]
}
```

## Setup: Monsters

```typescript
{
  monsters: Array<{
    name: string;
    position?: { x: number; y: number };
    statBlock: Record<string, unknown>
  }>
}
```

Important convention:

- Monsters use `hp` inside `statBlock`.
- Characters use `currentHp` inside `sheet`.

Common monster `statBlock` fields seen in live scenarios include:

- `type`
- `abilityScores`
- `maxHp`
- `hp`
- `armorClass`
- `speed`
- `challengeRating`
- `experienceValue`
- `savingThrows`
- `damageVulnerabilities`
- `damageResistances`
- `damageImmunities`
- `conditionImmunities`
- `actions`
- `bonusActions`
- `attacks`

If a monster takes multiple attacks or has named actions, include the relevant `actions` and `attacks` entries explicitly.

## Setup: AI Configuration

```typescript
{
  aiConfig?: {
    defaultBehavior?: AiBehavior;  // What all monsters do by default
    defaultBonusAction?: string;   // e.g., "nimbleEscape"
    monsterBehaviors?: Record<string, AiBehavior>;  // Per-monster overrides by name
  }
}
```

### AiBehavior values
`"attack"` | `"endTurn"` | `"flee"` | `"castSpell"` | `"approach"` | `"grapple"` | `"escapeGrapple"` | `"hide"` | `"usePotion"` | `"help"`

## Setup: NPCs

```typescript
{
  npcs?: Array<{
    name: string;
    position?: { x: number; y: number };
    faction?: string;
    aiControlled?: boolean;
    statBlock: Record<string, unknown>;
  }>
}
```

## Setup: Ground Items

```typescript
{
  groundItems?: Array<{
    name: string;
    position: { x: number; y: number };
    weaponStats?: {
      name: string;
      kind: "melee" | "ranged";
      range?: string;
      attackBonus: number;
      damage: { diceCount: number; diceSides: number; modifier: number };
      damageType?: string;
      properties?: string[];
    };
  }>
}
```

## Setup: Other Options

```typescript
{
  flankingEnabled?: boolean;  // Enable optional flanking rule
}
```

## Action-Level Setup Helpers

Some encounter state is not part of `setup` and must be expressed as actions:

- `setSurprise` before initiative
- `setTerrain` after combat exists
- `queueMonsterActions` for deterministic AI turns
- `queueDiceRolls` for deterministic internal dice

## Spell Names and Combat Text

Spell names and free-text action commands still need to line up with what the parser and catalog recognize. The safest authoring pattern is:

- copy spell names from a nearby passing scenario
- keep casing and wording close to existing successful commands
- only invent new phrasing when you have a concrete parser reason to do so

## Practical Authoring Guidance

- Start from the smallest passing scenario that already covers the same system.
- Only add fields the scenario actually needs.
- Prefer honest setup over doc-driven shortcuts. If the spell needs inventory, add inventory. If the feature needs a resource pool, add the pool.
- When in doubt, use the live runner and a nearby passing scenario as the source of truth.
