# Action Types Reference

The current scenario runner supports 22 action types.

These come from `packages/game-server/scripts/test-harness/scenario-runner.ts`. If this file and the runner disagree, trust the runner.

## Quick Matrix

| Type | Purpose |
|------|---------|
| `initiate` | Start combat and request initiative |
| `rollResult` | Submit a pending initiative, attack, damage, or other roll |
| `action` | Perform a player combat action from free text |
| `npcAction` | Perform an action as an allied NPC |
| `applyCondition` | DM override to apply a condition directly |
| `moveComplete` | Finish a pending move, including OA resolution |
| `playerOaRoll` | Submit a player opportunity attack roll |
| `waitForPlayerOa` | Wait for an AI move that prompts a player OA |
| `waitForShieldReaction` | Wait for a Shield reaction prompt |
| `waitForReaction` | Wait for another named reaction prompt |
| `configureAi` | Change default or per-monster AI behavior |
| `queueMonsterActions` | Queue deterministic monster decisions |
| `reactionRespond` | Use or decline a pending reaction |
| `rollInterruptResolve` | Resolve a pending d20 interrupt such as Lucky, Portent, or Bardic Inspiration |
| `queueDiceRolls` | Queue deterministic server-side die results |
| `assertState` | Read combat state and assert it |
| `endTurn` | End the current character turn |
| `waitForTurn` | Wait until a character's turn returns |
| `query` | Test query-style LLM intent parsing |
| `setTerrain` | Apply terrain zones to the combat map |
| `setSurprise` | Set surprise state before initiative |
| `rest` | Take a short or long rest |

## Core Turn Flow Actions

### `initiate`

Starts combat using free-text input and expects an initiative request.

```json
{
  "type": "initiate",
  "actor": "Vanguard",
  "input": { "text": "attack Raider with Longsword" },
  "expect": { "rollType": "initiative", "requiresPlayerInput": true }
}
```

Supported expectation fields:

- `rollType`
- `requiresPlayerInput`
- `disadvantage`
- `advantage`

### `rollResult`

Submits the currently pending player roll.

```json
{
  "type": "rollResult",
  "input": { "text": "I rolled 18" },
  "expect": { "hit": true, "requiresPlayerInput": true, "rollType": "damage" }
}
```

Roll text is natural-language tolerant. Examples: `"18"`, `"I rolled 18"`, `"rolled a 15"`.

Supported expectation fields include:

- `rollType`
- `hit`
- `isCritical`
- `combatStarted`
- `actionComplete`
- `requiresPlayerInput`
- `combatEnded`
- `victoryStatus`
- `deathSaveResult`
- `deathSaves`
- `uncannyMetabolism`
- `openHandTechnique`
- `stunningStrike`
- `eligibleEnhancements`
- `initiativeSwapOffer`
- `currentTurnActor`
- `error`
- `errorContains`

### `action`

Performs a player turn action from free text.

```json
{
  "type": "action",
  "actor": "Arcane Tester",
  "input": { "text": "cast Fire Bolt at Goblin Dummy" },
  "expect": { "rollType": "attack", "requiresPlayerInput": true }
}
```

Typical text patterns:

- attacks
- spells
- movement
- class features
- utility actions such as `dodge`, `dash`, `disengage`, `help`, `hide`

Supported expectation fields:

- `rollType`
- `requiresPlayerInput`
- `actionComplete`
- `type`
- `error`
- `errorContains`
- `advantage`
- `disadvantage`

### `npcAction`

Executes a combat action as an allied NPC by index.

```json
{
  "type": "npcAction",
  "input": { "text": "attack Goblin", "npcIndex": 0 },
  "expect": { "rollType": "attack", "requiresPlayerInput": true }
}
```

### `endTurn`

Ends the acting character's turn.

```json
{
  "type": "endTurn",
  "actor": "Vanguard",
  "expect": { "nextCombatant": "Raider" }
}
```

### `waitForTurn`

Waits through AI turns until the chosen character can act again.

```json
{
  "type": "waitForTurn",
  "actor": "Vanguard",
  "timeout": 10000
}
```

## Determinism and AI Control

### `configureAi`

Changes mock AI behavior mid-scenario.

```json
{
  "type": "configureAi",
  "input": {
    "defaultBehavior": "endTurn",
    "monsterBehaviors": { "Goblin Boss": "castSpell" }
  }
}
```

Current `AiBehavior` values are:

- `attack`
- `endTurn`
- `flee`
- `castSpell`
- `approach`
- `grapple`
- `escapeGrapple`
- `hide`
- `usePotion`
- `help`

### `queueMonsterActions`

Queues deterministic monster decisions. The queue is FIFO. When it empties, the mock AI falls back to configured behavior.

```json
{
  "type": "queueMonsterActions",
  "input": {
    "decisions": [
      { "action": "attack", "target": "Hero Name", "attackName": "Scimitar", "endTurn": true },
      { "action": "moveToward", "target": "Hero Name", "desiredRange": 5, "endTurn": false }
    ]
  }
}
```

The runner accepts freeform decision objects with these common fields:

- `action`
- `target`
- `attackName`
- `destination`
- `desiredRange`
- `bonusAction`
- `endTurn`
- `spellName`
- `spellLevel`
- `featureId`
- `seed`

In practice, common decision actions include:

- `attack`
- `move`
- `moveToward`
- `moveAwayFrom`
- `dash`
- `dodge`
- `disengage`
- `help`
- `hide`
- `grapple`
- `escapeGrapple`
- `shove`
- `search`
- `useObject`
- `castSpell`
- `useFeature`
- `endTurn`

### `queueDiceRolls`

Queues raw die faces for the server's next internal dice rolls.

```json
{
  "type": "queueDiceRolls",
  "input": { "values": [15, 6, 6, 1], "label": "monster attack + damage + deflect" }
}
```

Use this for monster attack rolls, saving throws, internal damage dice, and similar server-side randomness.

## Reaction and Interrupt Actions

### `waitForPlayerOa`

Waits for an AI movement sequence that triggers a player opportunity attack.

### `playerOaRoll`

Submits the player OA attack and optional damage roll.

```json
{
  "type": "playerOaRoll",
  "input": { "attackRoll": 18, "damageRoll": 12 },
  "expect": { "hit": true }
}
```

### `moveComplete`

Completes a pending move after reaction handling.

```json
{
  "type": "moveComplete",
  "rolls": [18, 8],
  "expect": { "success": true, "hit": true, "damageDealt": 8 }
}
```

### `waitForShieldReaction`

Waits for a Shield-specific reaction window.

### `waitForReaction`

Waits for a named generic reaction type.

```json
{
  "type": "waitForReaction",
  "input": { "reactionType": "deflect_attacks" },
  "timeout": 10000
}
```

### `reactionRespond`

Uses or declines the currently pending reaction.

```json
{
  "type": "reactionRespond",
  "input": { "choice": "use" }
}
```

For War Caster style reaction spells:

```json
{
  "type": "reactionRespond",
  "input": { "choice": "use", "spellName": "Fire Bolt", "castAtLevel": 0 }
}
```

### `rollInterruptResolve`

Resolves a pending d20 roll interrupt such as Bardic Inspiration, Lucky feat, Halfling Lucky, or Portent.

```json
{
  "type": "rollInterruptResolve",
  "actor": "Lyra",
  "input": { "choice": "bardic-inspiration" },
  "expect": { "requiresPlayerInput": false }
}
```

Allowed `choice` values:

- `decline`
- `bardic-inspiration`
- `lucky-feat`
- `halfling-lucky`
- `portent`

## State Manipulation and Support Actions

### `assertState`

Reads combat state and asserts it. See [assertions reference](./assertions.md).

### `applyCondition`

Applies a condition directly through the DM override route.

```json
{
  "type": "applyCondition",
  "input": {
    "target": "monster:Goblin",
    "condition": "Frightened",
    "duration": "1 minute",
    "sourceMonster": "Dragon"
  }
}
```

Supported target forms:

- `character`
- `character:Name`
- `monster:Name`
- `monster:0`

### `setTerrain`

Applies terrain zones after an encounter exists.

```json
{
  "type": "setTerrain",
  "input": {
    "terrainZones": [
      { "x": 10, "y": 10, "terrain": "difficult" }
    ]
  }
}
```

### `setSurprise`

Sets surprise state before initiative.

```json
{
  "type": "setSurprise",
  "input": { "surprise": "party" }
}
```

Supported values:

- `enemies`
- `party`
- `{ "surprised": ["Name A", "Name B"] }`

### `rest`

Takes a short or long rest for session characters.

```json
{
  "type": "rest",
  "input": { "restType": "short", "hitDiceSpending": { "Brother Aldric": 1 } },
  "expect": { "poolsRefreshed": ["ki"] }
}
```

Supported expectation fields:

- `poolsRefreshed`
- `characterHp`
- `characterHitDice`
- `hpRecovered`

### `query`

Tests query-style LLM intent parsing.

```json
{
  "type": "query",
  "input": { "text": "How many spell slots do I have left?" },
  "expect": { "isQuery": true, "subject": "spells" }
}
```

Current query subjects include:

- `hp`
- `weapons`
- `spells`
- `features`
- `party`
- `stats`
- `equipment`
- `ac`
- `actions`
- `tactical`
- `environment`

## Authoring Notes

- Use `actor` on character-specific steps in multi-PC scenarios.
- Use `comment` heavily. It makes failures readable.
- Use `expect.error` and `expect.errorContains` when testing rejection behavior.
- Use `queueMonsterActions` and `queueDiceRolls` together when exact monster replay matters.

```json
{
  "type": "waitForShieldReaction",
  "timeout": 5000
}
```

---

## 14. `waitForReaction` — Wait for Generic Reaction Prompt

```json
{
  "type": "waitForReaction",
  "input": { "reactionType": "deflect_attacks" }
}
```

---

## 15. `reactionRespond` — Respond to a Reaction Prompt

```json
{
  "type": "reactionRespond",
  "input": { "choice": "use" }
}
```

For War Caster spell-as-OA:
```json
{
  "type": "reactionRespond",
  "input": { "choice": "use", "spellName": "Fire Bolt" }
}
```

---

## 16. `applyCondition` — DM Override: Apply Condition

Directly applies a condition without going through normal combat flow.

```json
{
  "type": "applyCondition",
  "input": {
    "target": "monster:Goblin",
    "condition": "Frightened",
    "duration": "1 minute",
    "sourceMonster": "Dragon"
  }
}
```

Target format: `"character"` (first PC), `"character:Name"`, `"monster:Name"`, `"monster:0"` (index).

---

## 17. `setTerrain` — Set Terrain Zones

Must be used AFTER combat is initiated.

```json
{
  "type": "setTerrain",
  "input": {
    "terrainZones": [
      { "x": 20, "y": 10, "terrain": "pit", "terrainDepth": 10 },
      { "x": 25, "y": 10, "terrain": "difficult" }
    ]
  }
}
```

---

## 18. `setSurprise` — Set Surprise State

Use BEFORE combat initiate.

```json
{
  "type": "setSurprise",
  "input": { "surprise": "enemies" }
}
```

Or specific combatants:
```json
{
  "type": "setSurprise",
  "input": { "surprise": { "surprised": ["Goblin", "Goblin Archer"] } }
}
```

---

## 19. `rest` — Short or Long Rest

```json
{
  "type": "rest",
  "input": {
    "restType": "short",
    "hitDiceSpending": { "Hero Name": 2 }
  },
  "expect": {
    "poolsRefreshed": ["channelDivinity"],
    "characterHp": { "min": 30 }
  }
}
```

---

## 20. `query` — Test LLM Intent Parsing

```json
{
  "type": "query",
  "input": { "text": "how much HP do I have?" },
  "expect": { "subject": "hp", "isQuery": true }
}
```
