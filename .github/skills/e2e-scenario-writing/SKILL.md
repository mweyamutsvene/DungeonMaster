---
name: e2e-scenario-writing
description: 'Write, debug, and extend deterministic E2E JSON combat scenarios for the DungeonMaster game-server test harness. USE FOR: creating new combat scenarios, fixing failing scenario steps, converting live play or bug reports into deterministic regressions, and understanding the current scenario runner schema. DO NOT USE FOR: unit tests, non-combat tests, or unrelated source-code changes outside the scenario harness.'
argument-hint: 'Describe the combat flow or feature you want to test'
---

# E2E Combat Scenario Writing

Write deterministic JSON combat scenarios that run against the game-server combat harness. Scenarios hit the real Fastify API against an in-process app backed by in-memory repos, mock LLM services, and a queueable seeded dice roller.

The authoritative implementation lives in:

- `packages/game-server/scripts/test-harness/combat-e2e.ts`
- `packages/game-server/scripts/test-harness/scenario-runner.ts`

This skill should stay aligned with those files first. Nearby passing scenarios are the second source of truth.

## When to Use

- Creating a new E2E test scenario for a combat feature
- Converting live play, bug reports, or transcripts into deterministic regressions
- Debugging why a scenario step is failing
- Extending an existing scenario with new combat interactions
- Updating scenario docs or references to match the current runner

## Quick Start

1. Start from the nearest existing passing scenario, not from a blank file.
2. Place the new JSON in `packages/game-server/scripts/test-harness/scenarios/<category>/` beside similar coverage.
3. Define `setup` and `actions`.
4. Run a single scenario with:

```powershell
pnpm -C packages/game-server test:e2e:combat:mock -- --scenario=<category>/<name>
```

5. Run the full suite with:

```powershell
pnpm -C packages/game-server test:e2e:combat:mock -- --all --no-color
```

6. Use verbose output when debugging:

```powershell
pnpm -C packages/game-server test:e2e:combat:mock -- --scenario=<category>/<name> --verbose
pnpm -C packages/game-server test:e2e:combat:mock -- --scenario=<category>/<name> --detailed
```

> **CRITICAL**: Use `=` (not space) between `--scenario` and the value. The value is relative to the `scenarios/` folder, without `.json` extension.

## File Organization

Prefer the nearest existing category instead of inventing a new one unless the coverage area is genuinely new.

Current top-level scenario directories in the repo include:

```
scripts/test-harness/scenarios/
├── barbarian/
├── bard/
├── class-combat/
├── cleric/
├── conditions/
├── core/
├── death-saves/
├── druid/
├── feat/
├── fighter/
├── mastery/
├── monk/
├── packages/
├── paladin/
├── ranger/
├── rogue/
├── sorcerer/
├── warlock/
└── wizard/
```

## References

- See [schema reference](./references/scenario-schema.md) for the current scenario shape.
- See [action types reference](./references/action-types.md) for the current runner action surface.
- See [assertions reference](./references/assertions.md) for the current `assertState` fields.

## Golden Examples

When authoring or debugging, start from one of these passing scenarios before inventing a new shape.

- `packages/game-server/scripts/test-harness/scenarios/wizard/spell-delivery-modes-full-spectrum.json`
  Best reference for a compact single-PC spell scenario with attack-roll, save-based, healing, buff, zone, and auto-hit delivery paths. Also shows honest material-component setup for `Bless`.

- `packages/game-server/scripts/test-harness/scenarios/core/surprise-alert-willing-swap-red.json`
  Best reference for multi-PC setup, `actor` usage, `setSurprise`, queued initiative dice, initiative swap prompts, and roll-result error expectations.

- `packages/game-server/scripts/test-harness/scenarios/class-combat/monk/deflect-and-patient-defense.json`
  Best reference for round-structured class-combat authoring, `queueMonsterActions`, `queueDiceRolls`, reaction waits, `reactionRespond`, and checkpoint assertions around resource tracking.

- `packages/game-server/scripts/test-harness/scenarios/ranger/party-scout.json`
  Best reference for a larger multi-PC scenario with multiple acting characters, concentration tracking across turns, class-feature interactions, and explicit per-actor turn sequencing.

Use the smallest example that already matches the flow you need. Copying a smaller correct scenario is usually better than adapting a large one.

## Recommended Workflow

1. Find the closest passing scenario and copy its structure.
2. Keep the scenario deterministic.
3. Use `queueDiceRolls` for server-side dice you need to control.
4. Use `queueMonsterActions` when monster turns must be exact.
5. Use `assertState` after important boundaries so failures localize cleanly.
6. Re-run the single scenario until green.
7. Only then run the broader suite.

## Determinism Rules

- Prefer explicit queued dice over loose HP ranges when the outcome matters.
- Prefer scripted monster decisions over default AI when sequencing matters.
- If the scenario is multi-PC, use `actor` on character-specific steps.
- If a feature consumes resources, assert the corresponding pool after the spend.
- If a spell has material requirements, model the inventory or focus honestly. Do not weaken the scenario to hide a real requirement.

## Common Pitfalls

- Target names come from scenario setup. Use the exact names the runner and parser will see.
- `assertState.characterHp` only supports `min` and `max`, not `exact`.
- Extra Attack and similar chained flows often require `expect.actionComplete: false` on intermediate damage steps.
- Material components are enforced for many spells. If the scenario casts one, make the setup support it.
- `setSurprise` is an action before combat initiation, not a setup key.
- `sheet` and monster `statBlock` are mostly pass-through. Do not overfit to old doc tables when a nearby passing scenario already shows the correct shape.

## Debugging Tips

1. Run with `--verbose` first.
2. Use `--detailed` when you need request and response bodies.
3. Match failures by step number against the `actions` array.
4. Add `comment` fields so failures are readable.
5. Add checkpoint assertions instead of waiting until the end of the scenario.

## Class-Combat Scenarios

The `class-combat/` suite is still the long-form deterministic regression layer for multi-round class kits. Treat nearby passing class-combat scenarios as the strongest authoring reference for:

- multi-round scripting
- round-boundary resource assertions
- queued monster action choreography
- reaction timing
- larger HP pools used to keep abilities online for several rounds

## Accuracy Rule

If the docs and the runner disagree, trust the runner. If the runner and a passing scenario disagree, trust the passing scenario first and then confirm in the runner.


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
