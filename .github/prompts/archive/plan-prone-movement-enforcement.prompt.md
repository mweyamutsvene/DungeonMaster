# Plan: Enforce Prone Movement Rules

**TL;DR**: The server does not enforce D&D 5e Prone movement rules. A Prone creature should need to spend half its movement to stand up before moving normally, and while Prone it can only crawl (half speed). Currently, Prone creatures move at full speed with no stand-up cost.

## Problem

Per D&D 5e 2024 rules:
- **Prone**: While you have this condition, the only way you can move is by **crawling** (every 1 ft costs 1 extra ft of movement), unless you spend movement equal to **half your Speed** to right yourself and thereby end this condition.
- A Prone creature that wants to move normally must: (1) spend half their speed to stand up, then (2) move with remaining speed.
- A Prone creature that Dashes gets double movement, but still must spend half base speed to stand.

Currently:
- `MOVEMENT_MODIFIERS.PRONE = 0.5` exists in `domain/rules/movement.ts` but is **never referenced** by any movement execution code.
- The AI action executor's `executeMove()` does not check for Prone or deduct stand-up cost.
- The tabletop combat service's `completeMove()` does not check for Prone.
- No code removes the Prone condition when a creature "stands up."
- E2E scenario `prone-effects.json` even notes: "Verify Goblin still has Prone condition (AI doesn't stand up)".

## Observed Bug

Orc Brute was Prone (from Open Hand Technique Topple) and moved 30 ft with Dash as if at full movement. Expected: should have needed ~15 ft to stand up (half of 30 ft speed), then remaining movement.

## Scope

### Server-side changes needed:
1. **Movement service**: When resolving movement for a Prone creature, either:
   - Enforce crawling (half speed) if they don't stand up first
   - Or auto-stand-up (deduct half speed, remove Prone condition) before moving
2. **AI action executor**: Apply Prone stand-up cost in `executeMove()`
3. **Tabletop combat service**: Apply Prone stand-up cost in `completeMove()`
4. **Condition removal**: When standing up, remove the Prone condition from the combatant

### Additional considerations:
- Grappled creatures cannot stand (Grappled condition sets speed to 0, which makes the "spend half speed" impossible when speed is 0)
- Stunned/Incapacitated creatures cannot stand (can't take actions or spend movement)
- The AI should be instructed about Prone movement cost in the system prompt

## Status
- [x] Completed

## Implementation Notes

### Changes Made

1. **`packages/game-server/src/application/services/combat/two-phase-action-service.ts`** — Core prone stand-up enforcement:
   - Added import of `normalizeConditions`, `hasCondition`, `removeCondition` from conditions.ts
   - In `initiateMove()`: after computing `effectiveSpeed`, checks if actor has Prone condition
   - If Prone: deducts `Math.ceil(speed / 2)` from effectiveSpeed as stand-up cost
   - Blocks stand-up if also Grappled, Incapacitated, Stunned, Paralyzed, or Unconscious
   - Removes Prone condition from actor via `updateCombatantState()` after stand-up
   - Returns `standUpCost` in result for callers to display/log

2. **`packages/game-server/src/application/services/combat/ai/ai-action-executor.ts`** — AI speed clamping:
   - Added import of `normalizeConditions`, `hasCondition` from conditions.ts
   - In `executeMove()`: independently deducts stand-up cost from effective speed before clamping destination
   - This ensures AI doesn't try to move further than `initiateMove()` will allow

3. **`packages/game-server/src/infrastructure/llm/ai-decision-maker.ts`** — AI system prompt updated:
   - Added PRONE MOVEMENT RULES section explaining stand-up cost, interaction with Grappled/Stunned, and the mechanical benefits of standing up

4. **`packages/game-server/src/infrastructure/llm/mocks/index.ts`** — Mock AI Prone awareness:
   - When Prone and movement not spent, mock AI now chooses to move to its current position (stand up) before attacking
   - This mirrors realistic AI behavior — standing up removes attack disadvantage

5. **`packages/game-server/scripts/test-harness/scenarios/core/prone-movement.json`** — New E2E scenario:
   - Tests: shove goblin prone, AI stands up on its turn, goblin no longer has Prone after AI turn

6. **`packages/game-server/scripts/test-harness/scenarios/core/prone-effects.json`** — Updated existing scenario:
   - Changed assertion from "AI doesn't stand up" to "AI stands up" to match new correct behavior

### Verification
- TypeScript typecheck: PASS
- Unit tests: 391 passed, 36 skipped
- E2E scenarios: 61 passed (including new prone-movement), 0 failed

### D&D 5e 2024 Rules Applied
- Standing from Prone costs movement equal to half your base Speed (before Dash)
- If creature has Dash, they still pay the stand-up cost once, then use remaining doubled speed
- Cannot stand if Grappled, Incapacitated, Stunned, Paralyzed, or Unconscious
- The `MOVEMENT_MODIFIERS.PRONE = 0.5` constant in movement.ts was NOT used — stand-up is a flat cost deducted from effective speed (which is the correct 5e interpretation: "spend movement equal to half your Speed")

