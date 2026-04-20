# Action Types Reference

All 20 action types available in the scenario runner, with examples.

---

## 1. `initiate` — Start Combat

Sends a combat action text that triggers initiative. The server responds asking for an initiative roll.

```json
{
  "type": "initiate",
  "actor": "Hero Name",
  "input": { "text": "I attack the goblin" },
  "expect": {
    "rollType": "initiative",
    "requiresPlayerInput": true,
    "disadvantage": false,
    "advantage": false
  }
}
```

- `actor` — optional, defaults to first character
- Any attack/spell text works as the trigger

---

## 2. `rollResult` — Submit a Dice Roll

Submits a roll result for the current pending roll (initiative, attack, damage, save).

```json
{
  "type": "rollResult",
  "input": { "text": "I rolled 18" },
  "expect": {
    "rollType": "damage",
    "hit": true,
    "isCritical": false,
    "combatStarted": true,
    "actionComplete": false,
    "requiresPlayerInput": true,
    "combatEnded": false,
    "deathSaveResult": "success",
    "deathSaves": { "successes": 1, "failures": 0 },
    "eligibleEnhancements": [{ "keyword": "stunningStrike" }],
    "stunningStrike": { "saved": false, "conditionApplied": "Stunned" },
    "openHandTechnique": { "saved": true }
  }
}
```

**Roll format**: `"18"`, `"I rolled 18"`, `"rolled a 15"` — natural language parsed.

**After initiative**: `combatStarted: true` on success.
**After attack**: `hit: true/false`, then `rollType: "damage"` if hit.
**After damage**: `actionComplete: true` (unless Extra Attack chains).

---

## 3. `action` — Player Combat Action

The primary action type for player turns. Sends free-text combat commands.

```json
{
  "type": "action",
  "actor": "Hero Name",
  "input": { "text": "cast Spirit Guardians" },
  "comment": "Cast concentration spell",
  "expect": {
    "rollType": "attack",
    "requiresPlayerInput": true,
    "actionComplete": true,
    "type": "SIMPLE_ACTION_COMPLETE",
    "error": false,
    "errorContains": "Cannot cast",
    "advantage": true,
    "disadvantage": false
  }
}
```

### Common action text patterns

| Pattern | Example |
|---------|---------|
| Attack | `"I attack the Goblin with my Longsword"` |
| Spell (attack roll) | `"cast Guiding Bolt at Skeleton Archer"` |
| Spell (save-based) | `"cast Sacred Flame at Ghoul"` |
| Spell (buff/heal) | `"cast Bless on Brother Aldric"` |
| Spell (bonus action) | `"cast Healing Word on Brother Aldric"` |
| Spell (concentration) | `"cast Spirit Guardians"` (no target needed for self-centered) |
| Move | `"move to (35, 10)"` |
| Class ability | `"action surge"`, `"second wind"`, `"flurry of blows"` |
| Channel divinity | `"turn undead"` |
| Dodge | `"dodge"` |
| Dash | `"dash"` |
| Disengage | `"disengage"` |
| Help | `"help"` |
| Hide | `"hide"` |
| End turn | Use `endTurn` action type instead |

### Handling errors

To test that an action is correctly rejected:
```json
{
  "type": "action",
  "input": { "text": "cast Healing Word on Brother Aldric" },
  "comment": "Should fail — two-spell rule: leveled action spell already cast",
  "expect": { "error": true, "errorContains": "Cannot cast a leveled bonus action spell" }
}
```

---

## 4. `npcAction` — NPC Combat Action

Execute an action as a party-allied NPC.

```json
{
  "type": "npcAction",
  "input": { "text": "attack Goblin", "npcIndex": 0 },
  "expect": { "rollType": "attack", "requiresPlayerInput": true }
}
```

---

## 5. `endTurn` — End Player's Turn

Ends the current character's turn, advancing to the next combatant.

```json
{
  "type": "endTurn",
  "actor": "Hero Name",
  "expect": { "nextCombatant": "Goblin" }
}
```

---

## 6. `waitForTurn` — Wait for Player's Next Turn

Skips AI turns and waits until it's the player character's turn again.

```json
{
  "type": "waitForTurn",
  "actor": "Hero Name",
  "comment": "Wait through monster rounds",
  "timeout": 10000
}
```

- Default timeout: 5000ms
- Monster actions happen automatically between turns
- Zone spell damage (Spirit Guardians) triggers during this wait

---

## 7. `assertState` — Check Game State

Pure assertion — doesn't send any API call. See [assertions reference](./assertions.md).

```json
{
  "type": "assertState",
  "expect": {
    "characterHp": { "min": 30, "max": 42 },
    "monstersAlive": 2,
    "combatStatus": "Active"
  }
}
```

---

## 8. `configureAi` — Change AI Behavior Mid-Scenario

```json
{
  "type": "configureAi",
  "input": {
    "defaultBehavior": "endTurn",
    "monsterBehaviors": { "Goblin Boss": "castSpell" }
  }
}
```

---

## 9. `queueMonsterActions` — Script Exact Monster Actions

Queue specific decisions consumed in FIFO order. When queue is empty, falls back to default behavior.

```json
{
  "type": "queueMonsterActions",
  "input": {
    "decisions": [
      { "action": "attack", "target": "Hero Name", "attackName": "Scimitar", "endTurn": true },
      { "action": "moveToward", "target": "Hero Name", "desiredRange": 5, "endTurn": false },
      { "action": "castSpell", "spellName": "Hold Person", "target": "Hero Name", "endTurn": true }
    ]
  }
}
```

### Available decision actions
`attack`, `move`, `moveToward`, `moveAwayFrom`, `dash`, `dodge`, `disengage`, `help`, `hide`, `grapple`, `escapeGrapple`, `shove`, `search`, `useObject`, `castSpell`, `useFeature`, `endTurn`

---

## 10. `moveComplete` — Complete a Pending Move

Used when a move triggers an opportunity attack and needs explicit completion.

```json
{
  "type": "moveComplete",
  "rolls": [18, 8],
  "expect": { "success": true, "hit": true, "damageDealt": 8 }
}
```

---

## 11. `playerOaRoll` — Submit Player Opportunity Attack Roll

When an AI move triggers a player opportunity attack.

```json
{
  "type": "playerOaRoll",
  "input": { "attackRoll": 18, "damageRoll": 12 },
  "expect": { "hit": true }
}
```

---

## 12. `waitForPlayerOa` — Wait for AI Move That Triggers Player OA

```json
{
  "type": "waitForPlayerOa",
  "timeout": 5000
}
```

---

## 13. `waitForShieldReaction` — Wait for Shield Reaction Prompt

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
