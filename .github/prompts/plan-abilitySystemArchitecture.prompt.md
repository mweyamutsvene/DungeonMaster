# Plan: Scalable Bonus Action & Ability Execution Architecture

## Current Problem

Today we hardcode bonus actions as string literals:
```typescript
if (bonus === 'nimble_escape_disengage') {
  await this.actionService.disengage(...);
}
```

**This doesn't scale** when we have:
- 13+ classes × 3+ subclasses each = ~40 class variants
- Hundreds of monster abilities from stat blocks
- Feats (Great Weapon Master, Crossbow Expert, etc.)
- Spell effects that grant bonus actions

## Current State Summary

### Ability Listing System
- **Location:** `packages/game-server/src/domain/abilities/creature-abilities.ts`
- **Core Types:**
  - `CreatureAbility`: Base ability record with id, name, economy, source, summary, resourceCost, attack
  - `AbilityExecutionIntent`: Discriminated union (attack, choice, flurry-of-blows, text)
- **Enumeration:** `listCreatureAbilities()` returns hardcoded base attack + monster stat block abilities + Monk "Flurry of Blows"
- **Limited extensibility:** Only Monk's Flurry is implemented for player classes

### Current Execution Flow
1. **LLM Decision** → `AiDecision` struct with `bonusAction` field (string)
2. **MonsterAIService.executeBonusAction()** (lines 1047-1120):
   - String matching against hardcoded identifiers:
     - `"nimble_escape_disengage"` → calls `actionService.disengage()`
     - `"nimble_escape_hide"` → TODO (not implemented)
     - `"cunning_action_dash"` → calls `actionService.dash()`
     - `"offhand_attack"` → TODO
     - `"flurry_of_blows"` → TODO
3. **ActionService Delegation:** Methods like `disengage()`, `dash()`, `dodge()`, etc.
   - Each validates turn/actor state
   - Spends action economy
   - Delegates mechanics to domain layer
   - Persists state + emits events

### Gaps
1. No generic ability execution interface
2. No ability → handler registry
3. No class feature definitions (beyond hardcoded Monk)
4. Monster abilities have no execution logic beyond attacks
5. Intent system incomplete (only "attack" fully supported)
6. Resource spending is duck-typed
7. No UI for ability selection

---

## Proposed Architecture

### Option A: Ability Registry + Generic Executor ⭐ **Recommended**

**Core Idea:** Extend the existing `creature-abilities.ts` system with execution handlers.

```typescript
// Domain: ability-executor.ts
export interface AbilityExecutor {
  execute(context: AbilityExecutionContext): Promise<AbilityExecutionResult>;
}

// Application: ability-registry.ts
class AbilityRegistry {
  private handlers = new Map<string, AbilityExecutor>();
  
  register(abilityIdPattern: RegExp, executor: AbilityExecutor): void;
  execute(abilityId: string, context: AbilityExecutionContext): Promise<AbilityExecutionResult>;
}
```

**LLM Flow:**
1. LLM outputs `"bonusAction": "monster:bonus:nimble-escape"` (ability ID, not action name)
2. Server looks up handler: `registry.execute("monster:bonus:nimble-escape", ctx)`
3. Handler executes: Nimble Escape → present choice → execute chosen sub-action

**Example Handlers:**
- `NimbleEscapeExecutor` → shows choice menu → calls `disengage()` or `hide()`
- `FlurryOfBlowsExecutor` → spends ki → calls `attack()` twice with unarmed strikes
- `OffhandAttackExecutor` → validates two-weapon fighting → calls `attack()` with offhand
- `GenericAttackExecutor` → handles all basic weapon/natural attacks

**Benefits:**
- ✅ Extensible: Add new abilities by registering handlers
- ✅ Testable: Mock registry for unit tests
- ✅ Keeps ActionService focused on core D&D actions (attack, move, dodge, etc.)
- ✅ Leverages existing `CreatureAbility` + `AbilityExecutionIntent` types

**Drawbacks:**
- Requires refactoring existing hardcoded bonus actions
- Need to design `AbilityExecutionContext` carefully

### Option B: Expand ActionService ❌ **Not Recommended**

Add methods for every ability to ActionService.

**Problems:**
- ❌ ActionService becomes a god class (1000s of lines)
- ❌ Hard to maintain (every new ability = modify ActionService)
- ❌ Mixing concerns (core actions vs. class features vs. monster abilities)

### Option C: Hybrid - ActionService + Ability Modules

Keep ActionService for primitives; create separate services for ability categories.

**Benefits:**
- ✅ Separation of concerns
- ✅ Easier to navigate codebase

**Drawbacks:**
- ❌ Still requires manual wiring in MonsterAIService
- ❌ Services proliferate (FighterService, WizardService, etc.)
- ❌ Not fundamentally more scalable than Option B

---

## LLM Context Strategy: Progressive Detail Levels

### Level 1: Own Abilities (Full Detail) ✅ Already Doing This

**For the active combatant**, send complete ability info:
```json
{
  "combatant": {
    "actions": [
      { "name": "Scimitar", "kind": "melee", "attackBonus": 4, "damage": "1d6+2" },
      { "name": "Shortbow", "kind": "ranged", "range": "80/320", "attackBonus": 4, "damage": "1d6+2" }
    ],
    "bonusActions": [
      { "name": "Nimble Escape", "description": "Disengage or Hide as a bonus action" }
    ]
  }
}
```

**Rationale:** The LLM needs to know what options it can choose from. This is like showing a player their character sheet.

### Level 2: Enemy Abilities (Summary Only) ⚠️ Need to Add

**For enemies**, send **just names** or brief tags:
```json
{
  "enemies": [
    {
      "name": "Brave Fighter",
      "class": "fighter", "level": 3,
      "hp": {"current": 36, "max": 36},
      "ac": 18,
      "knownAbilities": ["Action Surge", "Second Wind"]
    }
  ]
}
```

**Rationale:** 
- ✅ LLM can make tactical decisions ("Fighter has Action Surge, might attack twice")
- ✅ Doesn't bloat context with full stat blocks
- ✅ Mirrors real D&D: you know the enemy is a wizard, but not their exact spell list

**Implementation Location:** `monster-ai-service.ts` around line 420-460 in `buildCombatContext()`

### Level 3: Allies (Minimal) ✅ Already Good

Current approach is fine:
```json
{
  "allies": [
    {"name": "Goblin Scout", "hp": {"current": 4, "max": 7}}
  ]
}
```

The AI doesn't need to micromanage allies' abilities—just know they exist for positioning/focus-fire decisions.

### Why This Works

1. **Token Efficiency:**
   - Own abilities: ~500 tokens (full detail needed for decision making)
   - Enemy abilities: ~50 tokens per enemy (just names)
   - Total encounter: ~1,000 tokens for abilities in a 4v4 fight

2. **Tactical Awareness:**
   - LLM knows "Fighter has Action Surge" → can anticipate burst damage
   - LLM knows "Goblin has Nimble Escape" → expects hit-and-run tactics
   - LLM doesn't need exact mechanics—server validates everything

3. **Scalability:**
   - As we add more classes/monsters, context grows linearly (not exponentially)
   - Can add filtering later: "only show abilities usable this turn"

4. **Mirrors D&D:**
   - Players know their own abilities in detail
   - Players know enemies' "signature moves" (Action Surge, Nimble Escape)
   - Players don't know exact hidden abilities until revealed

---

## Implementation Steps

### Phase 1: Registry Foundation
1. Create `AbilityExecutor` interface + `AbilityRegistry` class
2. Register handlers for:
   - Nimble Escape (monster bonus action)
   - Flurry of Blows (Monk level 2+)
   - Off-hand Attack (two-weapon fighting)
3. Refactor `MonsterAIService.executeBonusAction()` to use registry

### Phase 2: LLM Integration
1. Update `buildCombatContext()` to add `knownAbilities` to enemy details
2. Update LLM prompts to pass `context.combatant.availableAbilities` (with IDs)
3. LLM outputs `"bonusAction": "monster:bonus:nimble-escape"` instead of `"nimble_escape_disengage"`

### Phase 3: Core Actions
1. Keep ActionService for primitives: `attack()`, `move()`, `dodge()`, etc.
2. Complex abilities delegate to ActionService primitives

### Phase 4: Class Features (Future)
1. Extend `class-registry.ts` to include ability lists per level
2. Auto-generate available abilities from class + level + feats

---

## Open Questions

1. **Should abilities handle their own choice menus?** (e.g., Nimble Escape → "Disengage or Hide?")
   - For AI: Could auto-choose based on context
   - For players: Need to present choice and wait for input

2. **How do we handle abilities that need player input mid-execution?** (e.g., "Which target?" for Healing Word)
   - AI can decide from available targets
   - Players need async input flow

3. **Should we support chained abilities?** (e.g., Action Surge → allows extra action → LLM decides what action)
   - Would require multi-decision loop (already supported via `endTurn: false`)

4. **Do we need ability prerequisites/validation?** (e.g., can't use Flurry of Blows if you didn't attack this turn)
   - Yes, should be part of `AbilityExecutor.canExecute()` or similar

5. **Ability Discovery for enemies?**
   - Could add `revealedAbilities` that grows as enemies use abilities
   - Start empty, populate as combat progresses
   - Mirrors real play: you don't know what the wizard can do until they cast

---

## Relevant File Locations

| File | Purpose |
|------|---------|
| `packages/game-server/src/domain/abilities/creature-abilities.ts` | Core ability types, listing, intent generation |
| `packages/game-server/src/application/services/combat/ai/monster-ai-service.ts` | Bonus action execution (lines 1055-1120), context building (lines 400-550) |
| `packages/game-server/src/application/services/combat/action-service.ts` | Core action methods (attack, dodge, dash, etc.) |
| `packages/game-server/src/infrastructure/llm/ai-decision-maker.ts` | LLM prompts and decision parsing |
| `packages/game-server/src/domain/entities/classes/class-registry.ts` | Class definition lookup |
| `packages/game-server/src/domain/rules/bonus-action.ts` | Bonus action economy rules |

---

## Next Actions

**Immediate:**
1. Implement `AbilityRegistry` + `AbilityExecutor` interface
2. Add `knownAbilities` to enemy context in `buildCombatContext()`
3. Create executors for Nimble Escape, Off-hand Attack, Flurry of Blows

**Short-term:**
1. Refactor existing hardcoded bonus actions to use registry
2. Add tests for new registry system
3. Update LLM prompts to use ability IDs instead of action names

**Long-term:**
1. Build class feature definitions (per class + level)
2. Implement ability discovery system
3. Add player ability selection UI
