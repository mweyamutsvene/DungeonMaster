# Plan: OA Path Consolidation (ORCH-M3)

## Problem

There are two separate Opportunity Attack (OA) resolution paths:

1. **Programmatic path** — `ActionService.move()` in `src/application/services/combat/action-service.ts`
   - Used by AI/server-driven movement (e.g., monster moves, programmatic PC movement)
   - Detects OAs and resolves them immediately in a single synchronous pass
   - No two-phase pending action — attacks are executed and damage applied right away
   - Uses a simplified weapon stats lookup (equipped weapon → catalog → unarmed fallback)
   - No path-cell support — uses simple straight-line from→to check via `crossesThroughReach()`
   - No readied-action trigger detection

2. **Tabletop path** — `MoveReactionHandler` in `src/application/services/combat/two-phase/`
   - Used by player-facing tabletop flow (`TwoPhaseActionService.initiateMove()`)
   - Detects OAs, creates a `MOVEMENT_REACTION` pending action, and waits for player/AI response
   - Full grid path support (cell-by-cell OA detection along movement path)
   - Supports readied-action triggers and reaction responses

Both paths call the same domain-level eligibility functions:
- `crossesThroughReach()` for geometry
- `canMakeOpportunityAttack()` for D&D 5e rules

Both paths can **drift** independently over time (e.g., charm immunity was added to one but not both).

---

## Goals

- Eliminate the duplicated OA detection loop in `ActionService.move()`
- `ActionService.move()` should delegate to `TwoPhaseActionService` for OA detection
- Preserve existing behavior: programmatic moves resolve OA immediately without player interaction
- Fix AI-H1 (weapon lookup in programmatic path) FIRST before merging, since the consolidated path needs accurate weapon stats

---

## Prerequisites

- **AI-H1**: Weapon lookup in the programmatic OA path uses a simplified catalog lookup. Before consolidating, the weapon lookup should be unified with the tabletop path's attack spec resolution. This prevents silent behavior changes during consolidation.

---

## Proposed Approach

### Option A: Add a `synchronousMode` flag to TwoPhaseActionService
Add a `synchronousMode?: boolean` option to `TwoPhaseActionService.initiateMove()`. When true, it resolves OAs immediately (no pending action) instead of creating a `MOVEMENT_REACTION`. `ActionService.move()` would call with `synchronousMode: true`.

**Pros**: Single code path, consistent eligibility checks  
**Cons**: Adds complexity to TwoPhaseActionService interface; the two flows are different enough that merging them adds conditional branches  

### Option B: Extract shared OA detection into a helper
Extract OA detection eligibility logic into a standalone module (e.g., `combat/helpers/oa-detection.ts`) that both paths import. Each path keeps its own resolution strategy (immediate vs. two-phase pending).

**Pros**: Eliminates drift in detection logic without conflating resolution strategies  
**Cons**: Doesn't eliminate the duplicate resolution loop in action-service.ts  

### Recommended: Option B first, Option A later

1. Extract `detectOpportunityAttacks(combatants, actor, from, to): OACandidate[]` into `combat/helpers/oa-detection.ts`
2. Both `ActionService.move()` and `MoveReactionHandler` use this shared helper for detection
3. In a subsequent phase, evaluate whether the resolution paths can be merged (Option A)

---

## Files Affected

| File | Change |
|------|--------|
| `application/services/combat/action-service.ts` | Replace inline OA detection loop with call to shared helper |
| `application/services/combat/two-phase/move-reaction-handler.ts` | Replace inline OA detection loop with call to shared helper |
| `application/services/combat/helpers/oa-detection.ts` | New file: `detectOpportunityAttacks()` pure function |

---

## Risk Assessment

**Medium risk.** The two paths differ in:
- Path representation (simple line vs. grid cells)
- Resolution strategy (immediate vs. two-phase)
- Weapon stat source (simplified catalog vs. full tabletop flow)

Consolidate detection first (lower risk), defer resolution consolidation until AI-H1 is resolved.

---

## Test Scenarios to Verify

- `scenarios/core/opportunity-attacks.json` — tabletop path OA
- `scenarios/core/faction-test.json` — AI/programmatic movement with OA
- Any scenario where a monster moves through PC reach (programmatic path)
- Any scenario where a PC moves through monster reach (tabletop path)
