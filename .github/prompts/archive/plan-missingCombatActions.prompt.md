# Plan: Add Missing Combat Actions via Test Harness TDD

Expand the test harness with scenarios for missing actions, then implement CLI support. Focus on high-utility actions first.

## Current State

### Implemented Actions
| Action | Where Tested | Status |
|--------|--------------|--------|
| Attack | happy-path, two-goblins, etc. | ✅ |
| Move | All scenarios | ✅ |
| Dash | rogue-tactics, multi-action | ✅ |
| Dodge | fighter-dodge | ✅ |
| Disengage | rogue-tactics | ✅ |
| Help | fighter-help | ✅ |
| Shove (push/prone) | fighter-shove | ✅ |
| Cast Spell | wizard-cast | ✅ |
| End Turn | All scenarios | ✅ |
| Opportunity Attack | opportunity-attack, player-opportunity-attack | ✅ |

### Implemented Bonus Actions
| Bonus Action | Class | Where Tested | Status |
|--------------|-------|--------------|--------|
| Flurry of Blows | Monk | monk-flurry | ✅ |
| Patient Defense | Monk | Parser exists | ✅ |
| Step of the Wind | Monk | Parser exists | ✅ |
| Action Surge | Fighter | fighter-action-surge | ✅ |
| Cunning Action | Rogue | Executor registered | ✅ |
| Offhand Attack | All (Light weapons) | Executor exists | ✅ |

## Missing Actions

### Standard Actions (D&D 5e 2024)
| Action | Description | Priority |
|--------|-------------|----------|
| **Grapple** | Unarmed Strike option - target saves or gains Grappled condition (Speed 0) | High |
| **Hide** | DC 15 Stealth check while obscured/behind cover; gain Invisible condition | Medium |
| **Ready** | Prepare action with trigger condition; uses reaction when triggered | Medium |
| **Search** | Wisdom (Perception/Investigation) check | Low |
| **Study** | Intelligence check for knowledge | Low |
| **Influence** | Charisma check to alter attitude | Low |
| **Utilize** | Use a nonmagical object | Low |

### Missing Bonus Actions
| Class | Bonus Action | Description | Priority |
|-------|--------------|-------------|----------|
| **Fighter** | Second Wind | Regain 1d10 + Fighter level HP (1/short rest) | High |
| **Barbarian** | Rage | Enter rage, gain resistance and damage bonus | Medium |
| **Rogue** | Steady Aim | Gain advantage on next attack, Speed becomes 0 | Low |

## Implementation Steps

### Phase 1: Grapple (Low friction - reuse Shove framework)

1. **Create test scenario** `grapple-test.json`:
   - Fighter attempts to grapple a goblin
   - Contest: STR (Athletics) vs target's STR (Athletics) or DEX (Acrobatics)
   - Success: target gains Grappled condition (Speed 0)
   - Test escape attempt on monster's turn

2. **Add MockIntentParser pattern**:
   ```typescript
   // Pattern: "grapple <target>" or "I grapple the <target>"
   if (/\bgrapple\b/i.test(text)) {
     return { kind: "grapple", targetName: extractTarget(text) };
   }
   ```

3. **Add TabletopCombatService handler**:
   - Route through existing `handlePlayerInitiatedAction()`
   - Use `grapple-shove.ts` domain logic (already exists)

### Phase 2: Second Wind (Simple resource + heal)

1. **Create test scenario** `fighter-second-wind.json`:
   - Fighter takes damage, uses Second Wind bonus action
   - Regains 1d10 + 5 HP (at level 5)
   - Resource depleted, cannot use again until short rest

2. **Add executor** in `executors/fighter/second-wind-executor.ts`:
   - Similar pattern to Action Surge executor
   - Check `resourcePools.secondWind > 0`
   - Roll healing, apply to character HP

3. **Initialize resource** in `handleInitiativeRoll()`:
   - Add `secondWind: 1` to Fighter's resource pools

### Phase 3: Hide (Stealth + condition)

1. **Create test scenario** `rogue-hide.json`:
   - Rogue uses Cunning Action to Hide as bonus action
   - Makes DC 15 Stealth check
   - Success: gains Hidden/Invisible condition
   - Next attack has advantage

2. **Add MockIntentParser pattern**:
   ```typescript
   if (/\bhide\b/i.test(text)) {
     return { kind: "hide" };
   }
   ```

3. **Implement Hide handler**:
   - Stealth check vs DC 15 (or highest enemy passive Perception)
   - Track Hidden condition in combat state
   - Grant advantage on next attack

### Phase 4: Ready (Complex - trigger system)

1. **Create test scenario** `ready-action.json`:
   - Fighter readies attack: "I ready my attack for when the goblin moves"
   - Store prepared action + trigger condition
   - When trigger fires, resolve as reaction

2. **Extend pending action system**:
   - New pending action type: `readied`
   - Store: action type, target (optional), trigger description
   - On trigger match: prompt for reaction resolution

## Scenario File Templates

### grapple-test.json
```json
{
  "name": "Grapple: Fighter restrains Goblin",
  "description": "A Fighter uses the Grapple option of Unarmed Strike to restrain a Goblin.",
  "setup": { ... },
  "actions": [
    { "type": "initiateAction", "input": { "text": "I grapple the goblin" } },
    { "type": "rollResult", "input": { "text": "I rolled 15" }, "comment": "STR check" },
    { "type": "waitForTurn", "expect": { "combatantName": "...", "hasCondition": "grappled" } }
  ]
}
```

### fighter-second-wind.json
```json
{
  "name": "Fighter Second Wind: Bonus action heal",
  "description": "A Fighter uses Second Wind to recover HP during combat.",
  "setup": { "character": { "sheet": { "currentHp": 20, "maxHp": 44 } } },
  "actions": [
    { "type": "initiateAction", "input": { "text": "I use second wind" } },
    { "type": "rollResult", "input": { "text": "I rolled 7" }, "expect": { "hpGained": 12 } }
  ]
}
```

## Further Considerations

1. **Grapple escape?** Monster AI should attempt escape (Athletics/Acrobatics vs grappler's Athletics). Add to AI decision maker.

2. **Hide break conditions?** Hidden ends when you attack, cast spell, or are spotted. Need to track and clear condition.

3. **Ready action complexity?** Full implementation needs trigger parsing NLP. MVP: support "ready attack" without complex triggers.

4. **Condition system?** Grappled, Hidden, Prone exist but may need better tracking. Consider `combatant.conditions[]` array.

## Priority Order

1. ✅ Grapple - Domain logic exists, wire like Shove
2. ✅ Second Wind - Simple heal + resource, like Action Surge pattern
3. ⏳ Hide - Medium complexity, needs condition tracking
4. ⏳ Ready - High complexity, defer until reaction system mature
