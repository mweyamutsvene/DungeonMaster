# Plan: Ready Action (Phase 6.1)

## Overview

The Ready action allows a creature to delay an action or movement, executing it later as a **Reaction** when a specified trigger occurs. This is the most complex remaining combat action per the D&D 5e 2024 rules.

## D&D 5e 2024 Rules (Rules Glossary)

1. **Costs an Action** — uses the creature's standard action for the turn
2. **Trigger specification** — the creature describes a perceivable circumstance that will trigger the readied response
3. **Response choice** — either:
   - A single action (attack, cast spell, dash, etc.) taken as a **Reaction** when triggered, OR
   - Move up to Speed as a **Reaction** when triggered
4. **Reaction consumption** — when the trigger occurs, the readied response **consumes the creature's Reaction** for that round
5. **Optional** — when the trigger occurs, the creature can choose to take the Reaction or ignore it
6. **Spell readying** special rules:
   - Spell must have action casting time
   - Spell slot is expended immediately on Ready (not when triggered)
   - Holding the spell requires **Concentration**
   - Released with Reaction when trigger fires
   - If Concentration breaks before trigger → spell dissipates with no effect (slot still consumed)
7. **Duration** — the readied action persists until the start of the creature's next turn

## Current State

- `"Ready"` exists in `SpecificActionType` enum — that's it
- No parser, handler, state tracking, trigger detection, or test scenarios
- Reaction framework is production-grade (3-tier: pre-damage, post-damage, spell)

## Implementation Plan

### Phase 6.1a: Non-Spell Ready (estimated 2 days)

#### Step 1: Domain Types

- Add `ReadiedAction` interface to `domain/entities/combat/`:
  ```typescript
  interface ReadiedAction {
    actionType: "attack" | "dash" | "move" | "disengage";
    triggerDescription: string;
    triggerType: "creature_moves" | "creature_attacks" | "creature_enters_range" | "custom";
    targetRef?: ActorRef;
    weaponName?: string;
  }
  ```
- Add `readiedAction?: ReadiedAction` to combatant resources

#### Step 2: Text Parser + Action Economy

- Add `"ready"` to `tryParseSimpleActionText` in `combat-text-parser.ts`
- Create `handleReadyAction()` in `action-dispatcher.ts`:
  - Spend main action
  - Store `readiedAction` in combatant resources
  - Return message: "Readying [action] — will trigger when [trigger]"

#### Step 3: Trigger Detection

- In `CombatService.nextTurn()` or movement/attack handlers:
  - Check if any combatant has a `readiedAction`
  - Evaluate trigger against current game event
  - If trigger matches, create a reaction prompt (reuse existing two-phase framework)
- Clear `readiedAction` at start of creature's next turn

#### Step 4: Reaction Execution

- Add `"readied_action"` to `ReactionType`
- Wire into `reactions.ts` — player chooses to use or decline reaction
- On use: execute the stored action type, consume reaction

#### Step 5: E2E Scenarios

- `core/ready-action-attack.json` — Ready an attack, trigger fires, reaction consumed
- `core/ready-action-move.json` — Ready movement, trigger fires
- `core/ready-action-expire.json` — Ready action expires (trigger never fires)

### Phase 6.1b: Spell Ready (estimated 1-2 additional days)

- Immediate spell slot consumption on Ready
- Concentration tracking for held spell
- Release via reaction when trigger fires
- Dissipation if Concentration breaks
- E2E: `core/ready-spell.json`, `core/ready-spell-concentration-broken.json`

## Dependencies

- Reaction framework (System 3) — ✅ PRODUCTION
- Condition tracking (System 4) — ✅ PRODUCTION
- Turn advancement hooks — ✅ PRODUCTION

## Complexity Assessment

- **Total effort**: 3-5 days
- **Risk**: Trigger detection is the hardest part — LLM-free triggers require structured trigger types
- **Recommendation**: Implement Phase 6.1a (non-spell) first, then 6.1b (spell readying)
