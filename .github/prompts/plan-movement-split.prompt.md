# Plan: §4.1 `movement.ts` — Movement + Jump Split Assessment
## Round: 1
## Status: DEFERRED (no implementation)
## Affected Flows: CombatRules

---

## Objective

Assess whether `domain/rules/movement.ts` should be split into separate basic-movement and jump-mechanics modules, as flagged in `plan-remaining-tech-debt.prompt.md` §4.1. The split is only worthwhile if new movement features (swimming, climbing, flying) are being added.

---

## Assessment

### File Metrics

| Metric | Value |
|--------|-------|
| Total lines | 324 |
| Basic movement section (lines 1–154) | ~154 lines |
| Jump mechanics section (lines 155–324) | ~170 lines |
| Exports in basic section | 10 (Position, MovementAttempt, MovementResult, calculateDistance, calculateManhattanDistance, attemptMovement, isWithinRange, isWithinMeleeReach, crossesThroughReach, getPositionsInRadius, snapToGrid) |
| Exports in jump section | 7 (JumpParams, JumpResult, calculateLongJumpDistance, calculateHighJumpDistance, computeJumpLandingPosition, MOVEMENT_MODIFIERS, STANDARD_SPEEDS) |

### Usage Analysis

**Basic movement primitives** — actively used across 10+ files:
- `Position` (type): `combat-map-types.ts`, `combat-map-core.ts`, `combat-map-sight.ts`, `combat-map-items.ts`, `combat.ts`, `battlefield-renderer.ts`, `zones.ts`, `two-phase-action-service.ts`, `pending-action.ts`, `ground-item.ts`
- `calculateDistance`: `combat-map-core.ts`, `combat-map-sight.ts`, `combat-map-items.ts`, `attack-handler.ts`, `move-handler.ts`, `move-toward-handler.ts`, `move-away-from-handler.ts`, `tactical-view-service.ts`
- `attemptMovement`, `crossesThroughReach`, `MovementAttempt`: `two-phase-action-service.ts`
- `isWithinRange`: `combat-map-sight.ts`

**Jump mechanics** — **zero usages** across the entire codebase:
- `calculateLongJumpDistance` — not imported anywhere
- `calculateHighJumpDistance` — not imported anywhere
- `computeJumpLandingPosition` — not imported anywhere
- `JumpParams`, `JumpResult` — not imported anywhere
- `MOVEMENT_MODIFIERS` — not imported anywhere
- `STANDARD_SPEEDS` — not imported anywhere

**Note on Step of the Wind**: `StepOfTheWindExecutor` calls `combat.setJumpMultiplier(actorId, 2)` to double jump distance. This sets a runtime state value but never calls `calculateLongJumpDistance` or `calculateHighJumpDistance`. The jump distance calculation functions are stub implementations that have never been wired into the actual movement resolution path.

---

## Decision: DEFER (No Split)

### Rationale

1. **Jump functions are dead code.** Moving dead code to a new file provides zero benefit — it just relocates unused exports. The fundamental issue is that the jump calculation functions have never been wired into the two-phase movement resolution path.

2. **MOVEMENT_MODIFIERS and STANDARD_SPEEDS are also dead code.** Neither constant is imported anywhere; they're reference values sitting in the file.

3. **No new movement features in progress.** The tech debt item's own condition ("only worthwhile if adding new movement features") does not apply to the current backlog state.

4. **File size is manageable.** 324 lines is not a maintainability problem. Compare to `combat-map.ts` which was 540 lines with 35+ exports actively used — the prior split was justified by active consumption and complexity across its exports.

5. **The real action is wiring, not splitting.** When jump mechanics get used (e.g., implementing "jump" as a player move action), the correct moment to split is then — alongside the wiring work — not preemptively on dead code.

---

## What Should Actually Happen (Future Work)

When jump mechanics are eventually wired up, the correct sequence is:
1. Wire `calculateLongJumpDistance` / `calculateHighJumpDistance` into the movement resolution path in `two-phase-action-service.ts` (reading `jumpMultiplier` from combatant resources, set by Step of the Wind)
2. Add `jump` as a valid move sub-type in the action dispatcher
3. At that point, if movement.ts exceeds ~500 lines or the jump section has grown substantially with new types (swim, climb), split into `movement-jump.ts` with barrel re-export

Until then, the split is pure overhead.

---

## Cross-Flow Risk Checklist

- [x] Do changes in one flow break assumptions in another? → N/A (no changes)
- [x] Does the pending action state machine still have valid transitions? → N/A
- [x] Is action economy preserved? → N/A
- [x] Do both player AND AI paths handle the change? → N/A
- [x] Are repo interfaces + memory-repos updated if entity shapes change? → N/A
- [x] Is `app.ts` registration updated if adding executors? → N/A
- [x] Are D&D 5e 2024 rules correct? → Jump mechanics in file match 2024 rules glossary

---

## Test Plan

No implementation → no tests needed. Existing test suite validates movement functions in use.

---

## Files Changed

None.
