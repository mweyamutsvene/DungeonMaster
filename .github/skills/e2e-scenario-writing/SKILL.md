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

---

## Class Combat Suite (`class-combat/`)

The `class-combat/` directory is a comprehensive multi-round E2E suite covering every PHB class at level 5. Each class has 3–4 scenarios that exercise synergistic ability groups in realistic multi-round combat.

### Suite Location & Plan

- **Scenarios**: `packages/game-server/scripts/test-harness/scenarios/class-combat/<class>/<scenario>.json`
- **Master plan**: `.github/prompts/plan-class-combat-suite.prompt.md` — lists every scenario with setup, round plan, and ability coverage
- **Coverage tracker**: `packages/game-server/scripts/test-harness/scenarios/class-combat/COVERAGE.md` — tracks pass/fail, ability coverage, and known gaps
- **Cross-class regressions**: `class-combat/core/` — scenarios that span multiple classes (e.g., healing-dice-regression)

### Design Principles (Class Combat)

1. **Bumped HP** — heroes at 100–150, monsters at 80–150 to sustain 3–5 rounds
2. **Fully scripted monsters** via `queueMonsterActions` for full determinism
3. **Level 5** — Extra Attack, subclass features, L3 spells all online
4. **Round-boundary `assertState`** — checkpoint assertions after each round to localize failures
5. **Resource tracking** — assert resource pool depletion (ki, spell slots, rage, etc.) after each spend
6. **Don't work around bugs** — if a scenario reveals an engine bug, document it in COVERAGE.md as a GAP and assert the buggy behavior (or let it fail), never weaken the test to pass

### File Structure

```
scripts/test-harness/scenarios/class-combat/
├── COVERAGE.md              # Ability coverage tracker + known gaps
├── core/                    # Cross-class regression scenarios
│   └── healing-dice-regression.json
├── fighter/                 # F1, F2, F3
│   ├── burst-and-endurance.json
│   ├── weapon-mastery-tactics.json
│   └── tank-vs-resistance.json
├── monk/                    # M1, M2, M3, M4
│   ├── flurry-and-open-hand.json
│   ├── stunning-strike-lockdown.json
│   ├── deflect-and-patient-defense.json
│   └── ki-resource-depletion.json
├── rogue/                   # R1, R2, R3
│   ├── sneak-attack-advantage.json
│   ├── cunning-escape-artist.json
│   └── evasion-vs-aoe.json
├── wizard/                  # W1, W2, W3, W4
│   ├── aoe-blaster.json
│   ├── shield-and-counterspell.json
│   ├── absorb-elements-melee.json
│   └── spell-slot-economy.json
├── barbarian/               # B1, B2, B3
│   ├── rage-and-reckless.json
│   ├── frenzy-extra-attack.json
│   └── rage-resistance-types.json
├── cleric/                  # C1, C2, C3, C4
│   ├── party-healer.json
│   ├── bless-and-bane-party.json
│   ├── turn-undead-horde.json
│   └── divine-support-multiround.json
├── paladin/                 # P1, P2, P3
│   ├── smite-and-heal.json
│   ├── party-aura-tank.json
│   └── channel-divinity-smite-burst.json
└── warlock/                 # WL1, WL2, WL3
    ├── hex-and-blast.json
    ├── hellish-rebuke-defense.json
    └── hold-and-control.json
```

### Running Class Combat Scenarios

```bash
# Single scenario
pnpm -C packages/game-server test:e2e:combat:mock -- --scenario=class-combat/fighter/burst-and-endurance

# All class-combat scenarios
pnpm -C packages/game-server test:e2e:combat:mock -- --all

# Multiple specific scenarios (PowerShell)
$scenarios = @("class-combat/fighter/burst-and-endurance", "class-combat/monk/flurry-and-open-hand")
$failed = @()
foreach ($s in $scenarios) {
  pnpm -C packages/game-server test:e2e:combat:mock -- --scenario=$s | Out-Host
  if ($LASTEXITCODE -ne 0) { $failed += $s }
}
```

### Adding a New Class Combat Scenario

#### Step 1: Check the plan
Read `.github/prompts/plan-class-combat-suite.prompt.md` for the scenario ID (e.g., F2, M3, WL2), setup details, round plan, and ability grouping.

#### Step 2: Create the scenario JSON
Follow these conventions:

**Naming**: `"name": "ClassName: Descriptive Title — Ability1 + Ability2 + Ability3"`

**Character sheet** must include:
- `className`, `subclass`, `level: 5`
- `features` array listing class features explicitly
- `resourcePools` for all class resources (ki, rage, actionSurge, secondWind, channelDivinity)
- `spellSlots`, `preparedSpells`, `spellcastingAbility`, `spellSaveDC`, `spellAttackBonus` for casters

**Monster stat blocks** must include:
- `actions` array with Multiattack entry (required for multi-attack monsters):
  ```json
  "actions": [
    { "name": "Multiattack", "description": "The orc makes two greataxe attacks." }
  ]
  ```
- `attacks` array with explicit `attackName` for each weapon
- `type` field for creature type ("undead", "humanoid", etc.) — needed for Turn Undead, Divine Smite bonus

**Monster scripting** — always use `queueMonsterActions` for determinism:
```json
{
  "type": "queueMonsterActions",
  "comment": "Round 1 monster turns: Orc attacks Fighter, Hobgoblin attacks Fighter",
  "input": {
    "decisions": [
      { "action": "attack", "target": "Sir Marcus", "attackName": "Greataxe", "endTurn": false },
      { "action": "attack", "target": "Sir Marcus", "attackName": "Greataxe", "endTurn": true },
      { "action": "attack", "target": "Sir Marcus", "attackName": "Longsword", "endTurn": false },
      { "action": "attack", "target": "Sir Marcus", "attackName": "Longsword", "endTurn": true }
    ]
  }
}
```

> **CRITICAL**: Always include `attackName` in queued monster attack decisions. Without it, the handler throws a `ValidationError`.

> **CRITICAL**: For Multiattack, queue one `attack` decision per individual attack. Set `endTurn: false` on all but the last attack of each monster's turn.

#### Step 3: Structure the action sequence

A typical round in a class-combat scenario follows this pattern:

```
1. queueMonsterActions (script this round's monster turns)
2. Player action (attack, spell, class ability)
3. rollResult steps (initiative → attack → damage chain)
4. assertState (resource/HP checkpoint after player's round)
5. endTurn (player ends turn)
6. waitForTurn (monsters auto-execute from queue, come back to player)
7. assertState (HP checkpoint after monster attacks)
```

For **multi-PC party scenarios**, add `"actor": "Character Name"` to every action/endTurn/waitForTurn step:
```json
{ "type": "action", "actor": "Brother Aldric", "input": { "text": "cast Sacred Flame at Skeleton Archer" } }
```

#### Step 4: Add round-boundary assertions

After every player turn and every monster turn, add `assertState` to checkpoint:

```json
{
  "type": "assertState",
  "comment": "=== END ROUND 1 ===: Verify resources after Action Surge",
  "expect": {
    "characterResource": { "poolName": "actionSurge", "current": 0, "max": 1 },
    "characterHp": { "min": 70, "max": 100 },
    "monsterHp": { "name": "Orc Warchief", "min": 80, "max": 110 }
  }
}
```

**Use HP ranges** (`min`/`max`) not exact values — dice rolls are random. Calculate bounds:
- **Minimum damage** per hit: `modifier` (assume all dice roll 1)
- **Maximum damage** per hit: `(diceCount × diceSides) + modifier`
- **Monster HP after N hits**: `maxHp - (N × maxDamage)` to `maxHp - (N × minDamage)`

#### Step 5: Update COVERAGE.md

After creating or modifying a scenario:

1. Update the **Coverage Summary** table (increment abilities/scenarios counts)
2. Check off abilities in the class's ability table
3. Add scenario references to the `Scenario` column
4. If the scenario reveals a bug, add a **GAP-N** entry to the "Implementation Gaps" section with:
   - **Symptom**: What failed
   - **Root Cause**: Why it failed (or hypothesis)
   - **Impact**: What scenarios/abilities are blocked
   - **Status**: OPEN / FIXED / Workaround

#### Step 6: Run and validate

```bash
pnpm -C packages/game-server test:e2e:combat:mock -- --scenario=class-combat/<class>/<scenario-name>
```

If a scenario fails due to an **engine bug** (not a scenario authoring error):
- Document the GAP in COVERAGE.md
- Keep the scenario — it serves as a regression test for when the bug is fixed
- Do NOT weaken assertions to make it pass

### Multi-PC Party Scenario Conventions

Party scenarios (C1, C2, C4, P2) require special handling:

1. Use `"characters": [...]` array instead of `"character"` in setup
2. Every `action`, `endTurn`, and `waitForTurn` step must have `"actor": "Name"`
3. Initiative rolls need one `rollResult` per character (all roll high to go before monsters)
4. Turn order: characters act in the order they appear in the `characters` array
5. Use `waitForTurn` with `actor` to cycle between PCs:
   ```json
   { "type": "endTurn", "actor": "Valeria" },
   { "type": "waitForTurn", "actor": "Brother Aldric" }
   ```

### Known Gaps & Patterns

These are documented in COVERAGE.md but summarized here for scenario authors:

| Gap | Impact | Workaround |
|-----|--------|------------|
| **GAP-2**: Bless/Bane/Shield of Faith don't consume spell slots | Buff/debuff spell slot assertions will show pre-cast values | Assert slot NOT decremented; add comment noting BUG-4 |
| **GAP-6**: Hex bonus damage not applied to Eldritch Blast beams | WL1 blocked; damage bounds too high | Document and let scenario fail |
| **Weapon Mastery (Cleave)**: auto-hits adjacent enemies | Unexpected secondary damage in scenarios with adjacent monsters | Use HP ranges, position monsters carefully |
| **Extra Attack auto-chaining**: scenario runner sends natural-1 miss rolls | Transparent unless you set `actionComplete: false` on damage step | Let auto-complete handle it unless testing EA explicitly |

### Template: Solo Class Combat Scenario

```json
{
  "name": "ClassName: Title — Ability1 + Ability2",
  "description": "A level 5 Subclass ClassName fights Monster1 and Monster2 across N rounds. Tests Ability1, Ability2, and Extra Attack with resource tracking.",
  "setup": {
    "character": {
      "name": "Hero Name",
      "className": "ClassName",
      "subclass": "SubclassName",
      "level": 5,
      "position": { "x": 10, "y": 10 },
      "sheet": {
        "abilityScores": {
          "strength": 16, "dexterity": 14, "constitution": 16,
          "intelligence": 10, "wisdom": 12, "charisma": 10
        },
        "maxHp": 100, "currentHp": 100,
        "armorClass": 18, "speed": 30,
        "proficiencyBonus": 3,
        "attacks": [
          {
            "name": "Weapon", "kind": "melee", "range": "melee",
            "attackBonus": 7,
            "damage": { "diceCount": 1, "diceSides": 8, "modifier": 4 },
            "damageType": "slashing"
          }
        ],
        "features": [
          { "name": "Extra Attack", "description": "Attack twice per Attack action" }
        ],
        "resourcePools": [
          { "name": "resourceName", "current": 3, "max": 3 }
        ]
      }
    },
    "monsters": [
      {
        "name": "Monster Name",
        "position": { "x": 15, "y": 10 },
        "statBlock": {
          "type": "humanoid",
          "abilityScores": {
            "strength": 16, "dexterity": 12, "constitution": 16,
            "intelligence": 10, "wisdom": 10, "charisma": 10
          },
          "maxHp": 100, "hp": 100,
          "armorClass": 15, "speed": 30,
          "challengeRating": 3,
          "actions": [
            { "name": "Multiattack", "description": "Two longsword attacks." }
          ],
          "attacks": [
            {
              "name": "Longsword", "kind": "melee",
              "attackBonus": 5,
              "damage": { "diceCount": 1, "diceSides": 8, "modifier": 3 },
              "damageType": "slashing"
            }
          ]
        }
      }
    ],
    "aiConfig": { "defaultBehavior": "attack" }
  },
  "actions": [
    {
      "comment": "=== ROUND 1 SETUP: Script monster turns ===",
      "type": "queueMonsterActions",
      "input": {
        "decisions": [
          { "action": "attack", "target": "Hero Name", "attackName": "Longsword", "endTurn": false },
          { "action": "attack", "target": "Hero Name", "attackName": "Longsword", "endTurn": true }
        ]
      }
    },
    {
      "comment": "Start combat",
      "type": "initiate",
      "input": { "text": "I attack the Monster Name" },
      "expect": { "rollType": "initiative", "requiresPlayerInput": true }
    },
    {
      "comment": "Roll high initiative to go first",
      "type": "rollResult",
      "input": { "text": "20" },
      "expect": { "combatStarted": true }
    },
    {
      "comment": "Attack monster (Extra Attack: first hit)",
      "type": "action",
      "input": { "text": "I attack the Monster Name with my Weapon" },
      "expect": { "rollType": "attack", "requiresPlayerInput": true }
    },
    {
      "comment": "Roll attack vs AC 15",
      "type": "rollResult",
      "input": { "text": "18" },
      "expect": { "hit": true, "rollType": "damage", "requiresPlayerInput": true }
    },
    {
      "comment": "Roll damage",
      "type": "rollResult",
      "input": { "text": "10" },
      "expect": { "actionComplete": true }
    },
    {
      "comment": "Checkpoint: verify resource after ability use",
      "type": "assertState",
      "expect": {
        "characterResource": { "poolName": "resourceName", "current": 2, "max": 3 },
        "monsterHp": { "name": "Monster Name", "min": 80, "max": 96 }
      }
    },
    {
      "comment": "End player turn, let monsters act from queue",
      "type": "endTurn"
    },
    {
      "comment": "Wait for next player turn (monsters attack from queue)",
      "type": "waitForTurn"
    },
    {
      "comment": "=== END ROUND 1 ===: Check HP after monster attacks",
      "type": "assertState",
      "expect": {
        "characterHp": { "min": 78, "max": 100 }
      }
    }
  ]
}
```

---

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
