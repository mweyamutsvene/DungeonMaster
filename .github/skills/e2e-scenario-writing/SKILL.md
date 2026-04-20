---
name: e2e-scenario-writing
description: 'Write, debug, and extend E2E JSON combat test scenarios for the DungeonMaster game-server test harness. USE FOR: creating new combat scenarios, converting AgentTestPlayer run reports into deterministic E2E tests, debugging failing scenario steps, understanding the scenario JSON schema. DO NOT USE FOR: unit tests (use VitestWriter agent), modifying game-server source code, or running non-combat tests.'
argument-hint: 'Describe the combat flow or feature you want to test'
---

# E2E Combat Scenario Writing

Write deterministic JSON combat scenarios that run against the game-server test harness. Scenarios exercise the full 2-phase tabletop combat flow via HTTP API calls against an in-process Fastify server with in-memory repos and mock LLM/AI.

## When to Use

- Creating a new E2E test scenario for a combat feature
- Converting an AgentTestPlayer live-play report into a deterministic regression test
- Debugging why a scenario step is failing
- Extending an existing scenario with new combat interactions

## Quick Start

1. Create a JSON file in `packages/game-server/scripts/test-harness/scenarios/<category>/`
2. Define setup (character sheet + monsters) and actions (combat sequence)
3. Run: `pnpm -C packages/game-server test:e2e:combat:mock -- --scenario=<category>/<name>`

> **CRITICAL**: Use `=` (not space) between `--scenario` and the value. The value is relative to the `scenarios/` folder, without `.json` extension.

## File Organization

```
scripts/test-harness/scenarios/
├── core/              # Basic combat flows (happy-path, movement, multi-pc)
├── fighter/           # Fighter class abilities (action-surge, second-wind)
├── monk/              # Monk abilities (flurry, stunning-strike, deflect)
├── rogue/             # Rogue tactics (cunning-action, sneak-attack)
├── wizard/            # Wizard spells (shield-reaction, spell-casting)
├── barbarian/         # Barbarian features (rage, reckless-attack)
├── cleric/            # Cleric features (turn-undead, healing)
├── paladin/           # Paladin features (divine-smite, lay-on-hands)
├── grapple/           # Grapple mechanics
├── terrain/           # Terrain and map mechanics (pits, difficult terrain)
├── opportunity-attack/# OA scenarios
├── death-saves/       # Death save mechanics
├── inventory/         # Item pickup, equip, drop
├── rest/              # Short and long rest scenarios
└── conditions/        # Condition application and mechanics
```

## Scenario JSON Schema

See [schema reference](./references/scenario-schema.md) for the complete JSON structure.

## Action Types Reference

See [action types reference](./references/action-types.md) for all 20 action types with examples.

## Assertion Reference

See [assertions reference](./references/assertions.md) for all `assertState` fields.

## Workflow for Converting AgentTestPlayer Reports

1. **Read the report** — identify key combat events, dice rolls, and outcomes
2. **Define setup** — extract character sheet (ability scores, HP, AC, spells, attacks) and monster stat blocks
3. **Map events to actions** — each player action becomes an `action`, `initiate`, or `rollResult` step
4. **Add assertions** — verify HP changes, conditions, resource consumption, concentration
5. **Handle AI turns** — use `waitForTurn` + `endTurn` for monster rounds, or `queueMonsterActions` for exact replay
6. **Run and iterate** — fix assertion values based on actual server output

## Common Pitfalls & Solutions

### Target naming
- Use exact creature names from setup: `"cast Healing Word on Brother Aldric"` (not `"on myself"`)
- Monster names must match the `name` field in setup exactly (case-insensitive for spells)

### Two-spell rule (D&D 5e 2024)
- If you cast a leveled spell as a bonus action, you can only cast cantrips (not leveled spells) as your action that turn, and vice versa
- Test with `expect.error: true` and `expect.errorContains` to verify enforcement

### Spell slot tracking
- Spell slots are named `spellSlot_1`, `spellSlot_2`, `spellSlot_3` etc. in resource pools
- Assert with `characterResource: { poolName: "spellSlot_1", current: 3, max: 4 }`

### Extra Attack auto-chaining
- When damage resolves and the character has Extra Attack, the server auto-chains to the next attack
- The scenario runner auto-completes these chains by sending natural-1 miss rolls
- To test the chain explicitly, set `expect.actionComplete: false` on the damage step

### Monster turns and AI
- Default: set `aiConfig.defaultBehavior` in setup (e.g., `"attack"`)
- Monsters auto-act between player turns — use `waitForTurn` to skip to next player turn
- For exact monster action sequences: use `queueMonsterActions` with FIFO decision queue
- Queue is consumed in order; when empty, falls back to `defaultBehavior`

### Concentration
- Casting a new concentration spell auto-drops the previous one
- Assert with `characterConcentration: "Bless"` or `characterConcentration: null`
- Zone spells (Spirit Guardians) deal damage at the start of affected creatures' turns

### Roll format
- Initiative: `"I rolled 15"` or `"15"`
- Attack: `"I rolled 18"` or `"18"`
- Damage: `"I rolled 8"` or `"8"`
- The text is parsed, so natural language works

### Positions and distance
- Grid uses Chebyshev distance: `max(|dx|, |dy|)` — each cell = 5ft
- Diagonal movement costs the same as cardinal
- Melee range = 5ft (adjacent cells), ranged varies by weapon

### Spirit Guardians zone damage
- Triggers at the start of each affected creature's turn (not when cast)
- Damage occurs during AI turns, visible in the log between `waitForTurn` calls
- Assert monster HP with `min`/`max` bounds to account for random save outcomes

## Debugging Tips

1. **Run with `--verbose`** to see step summaries
2. **Run with `--detailed`** to see full request/response JSON
3. **Check the step number** in the failure message — count from 1 in the `actions` array
4. **Use `assertState` liberally** — add checkpoint assertions between combat phases
5. **Comment every step** — use the `comment` field to describe what each step tests

## Example: Minimal Scenario

```json
{
  "name": "Feature: Description",
  "description": "What this scenario tests",
  "setup": {
    "character": {
      "name": "Hero Name",
      "className": "Fighter",
      "level": 5,
      "position": { "x": 10, "y": 10 },
      "sheet": {
        "abilityScores": {
          "strength": 16, "dexterity": 14, "constitution": 15,
          "intelligence": 10, "wisdom": 12, "charisma": 8
        },
        "maxHp": 42, "currentHp": 42,
        "armorClass": 18, "speed": 30,
        "proficiencyBonus": 3,
        "attacks": [{
          "name": "Longsword", "kind": "melee", "range": "melee",
          "attackBonus": 6,
          "damage": { "diceCount": 1, "diceSides": 8, "modifier": 3 },
          "damageType": "slashing"
        }]
      }
    },
    "monsters": [{
      "name": "Goblin",
      "position": { "x": 15, "y": 10 },
      "statBlock": {
        "abilityScores": {
          "strength": 8, "dexterity": 14, "constitution": 10,
          "intelligence": 10, "wisdom": 8, "charisma": 8
        },
        "maxHp": 7, "hp": 7,
        "armorClass": 15, "speed": 30,
        "challengeRating": 0.25,
        "attacks": [{
          "name": "Scimitar", "kind": "melee",
          "attackBonus": 4,
          "damage": { "diceCount": 1, "diceSides": 6, "modifier": 2 },
          "damageType": "slashing"
        }]
      }
    }],
    "aiConfig": { "defaultBehavior": "attack" }
  },
  "actions": [
    {
      "comment": "Start combat — server requests initiative roll",
      "type": "initiate",
      "input": { "text": "I attack the goblin" },
      "expect": { "rollType": "initiative", "requiresPlayerInput": true }
    },
    {
      "comment": "Roll high initiative to go first",
      "type": "rollResult",
      "input": { "text": "I rolled 20" },
      "expect": { "combatStarted": true }
    },
    {
      "comment": "Attack the goblin",
      "type": "action",
      "input": { "text": "I attack the Goblin with my Longsword" },
      "expect": { "rollType": "attack", "requiresPlayerInput": true }
    },
    {
      "comment": "Roll attack — needs to beat AC 15",
      "type": "rollResult",
      "input": { "text": "18" },
      "expect": { "hit": true, "rollType": "damage", "requiresPlayerInput": true }
    },
    {
      "comment": "Roll damage — 7 HP goblin should die",
      "type": "rollResult",
      "input": { "text": "10" },
      "expect": { "actionComplete": true }
    },
    {
      "comment": "Verify goblin is dead",
      "type": "assertState",
      "expect": { "monstersAlive": 0, "combatStatus": "Complete" }
    }
  ]
}
```
