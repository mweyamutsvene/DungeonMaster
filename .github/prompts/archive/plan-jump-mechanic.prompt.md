# Plan: Jump Mechanic Enhancements

## Status: Phase 1 COMPLETE, Phase 2 COMPLETE

## Completed (Phase 1: Core Jump Mechanics)

### Domain Layer (`domain/rules/movement.ts`)
- Added `JumpParams` and `JumpResult` interfaces
- Added `calculateLongJumpDistance(strengthScore, hasRunningStart, multiplier)` — D&D 5e 2024 Long Jump
- Added `calculateHighJumpDistance(strengthModifier, hasRunningStart, multiplier)` — D&D 5e 2024 High Jump
- Both functions respect standing/running start rules and jump distance multiplier (Step of the Wind)

### Domain Tests (`domain/rules/movement.test.ts`)
- 13 new unit tests covering Long Jump and High Jump:
  - Running start, standing, multiplier, floor for odd values, low STR, average STR

### Text Parser (`combat/tabletop/combat-text-parser.ts`)  
- Added `ParsedJump` type and `tryParseJumpText()` function
- Recognizes: "jump", "long jump", "high jump", "jump over X", "leap", "vault", with optional distance
- Default is Long Jump (most common in combat)

### Action Dispatcher (`combat/tabletop/action-dispatcher.ts`)
- Added `handleJumpAction()` — treats jump as movement that costs feet from the budget
- Resolves Strength score/modifier from character sheet or monster statBlock
- Reads `jumpDistanceMultiplier` from combatant resources (set by Step of the Wind)
- Determines running start based on movement already spent this turn (≥10ft = running start)
- Returns `JUMP_COMPLETE` action type with distance info
- Also added persistence of `jumpDistanceMultiplier` from executor `result.data` into combatant resources

### E2E Scenarios
- `core/jump-long.json` — Long Jump with running start (STR 16 → 16ft)
- `core/jump-standing.json` — Standing jump (STR 16 → 8ft), then movement budget exhaustion

### Verification
- Typecheck: PASS
- Unit tests: 450 passed
- E2E scenarios: 73 passed (including 2 new jump scenarios), 0 failed

---

## Completed (Phase 2: Enhanced Jump Mechanics)

### 1. Acrobatics Check on Difficult Terrain Landing ✅
Per D&D 5e 2024: "If you land in Difficult Terrain, you must succeed on a DC 10 Dexterity (Acrobatics) check or have the Prone condition."
- `handleJumpAction()` resolves DEX modifier and Acrobatics proficiency from character sheet
- After computing landing position, checks terrain via `getCellAt(map, landingPosition)`
- If terrain is "difficult", rolls DC 10 Acrobatics check using `abilityCheck(diceRoller, ...)`
- On failure: applies Prone via `addCondition(createCondition("Prone", "until_removed", ...))`
- Fallback: if no dice roller, auto-fails Acrobatics (conservative)

### 2. Athletics Check for Obstacle Clearing (DEFERRED)
Per D&D 5e 2024: This is DM-optional. The "jump over X" text pattern is already parsed but obstacle clearance check is not implemented. Deferred as it requires DM prompting/flagging which is outside current scope.

### 3. Position Update on Jump ✅
- Added `computeJumpLandingPosition(origin, distance, jumpType, directionTarget?)` in `domain/rules/movement.ts`
  - Long Jump: normalizes direction toward target (or positive X), moves `distance` feet, snaps to 5ft grid
  - High Jump: returns origin (vertical displacement, no horizontal movement)
- `handleJumpAction()` updates `resources.position` to the computed landing position
- Direction resolution priority: explicit coordinates > explicit target creature > nearest hostile (via `findNearestHostilePosition()`)
- Enhanced `ParsedJump` with `directionCoords` and `directionTarget` fields
- Enhanced `tryParseJumpText()` to accept optional roster for creature-name direction parsing
- 8 new unit tests for `computeJumpLandingPosition` (43 total movement tests, all passing)

### 4. Integration with Step of the Wind E2E ✅
- `monk/step-of-the-wind-jump.json` — Monk uses Step of the Wind (1 ki), then long jump with ×2 multiplier
  - STR 10 + running start = 10ft base × 2 = 20ft → lands at (30, 10)
  - Verifies ki spending (5 → 4) and position update

### 5. AI Decision Making ✅ (Type Only)
- Added `"jump"` to `AiDecision.action` union in `ai-types.ts`
- AI doesn't yet actively choose to jump — deferred to when scenarios require it

### New E2E Scenarios (Phase 2)
- `core/jump-difficult-terrain.json` — Jump into difficult terrain, failed Acrobatics check → Prone
- `monk/step-of-the-wind-jump.json` — Step of the Wind ×2 jump multiplier verification

### Scenario Runner Enhancement
- Added `characterPosition` assertion to `AssertStateAction` expect type
  - Validates character `resources.position.x` and `resources.position.y` via `GET /combat` endpoint

### Updated E2E Scenarios (Phase 2)
- `core/jump-long.json` — Added `assertState` with `characterPosition: {x: 25, y: 10}`, updated post-jump move target
- `core/jump-standing.json` — Added `assertState` with `characterPosition: {x: 10, y: 10}`, adjusted move to exhaust budget before second jump

### Verification
- Typecheck: PASS
- Unit tests: 458 passed (8 new computeJumpLandingPosition tests)
- E2E scenarios: 75 passed (4 jump scenarios), 0 failed

---

## Implementation Notes

### Seeded Dice Roller Behavior
The E2E test harness uses `SeededDiceRoller(42)` which resets per scenario. The Acrobatics check in `jump-difficult-terrain.json` uses DEX 2 (modifier -4) to ensure deterministic failure: d20=13 + (-4) = 9 < DC 10.

### Direction Inference for Jumps
When no explicit direction is provided, `handleJumpAction()` infers the jump direction toward the nearest hostile creature using `findNearestHostilePosition()`. This is the most natural D&D behavior — characters typically jump toward enemies in combat.

### Files Modified (Phase 2)
1. `domain/rules/movement.ts` — `computeJumpLandingPosition()` function
2. `domain/rules/movement.test.ts` — 8 new tests + import
3. `application/services/combat/tabletop/combat-text-parser.ts` — Enhanced `ParsedJump` + direction parsing
4. `application/services/combat/tabletop/action-dispatcher.ts` — Rewritten `handleJumpAction()`, new `findNearestHostilePosition()`
5. `application/services/combat/ai/ai-types.ts` — Added "jump" to AiDecision.action
6. `scripts/test-harness/scenario-runner.ts` — `characterPosition` assertion + interface type
