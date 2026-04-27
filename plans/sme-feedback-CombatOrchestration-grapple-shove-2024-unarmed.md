# SME Feedback — CombatOrchestration — Round 1
## Verdict: NEEDS_WORK

## Issues (if NEEDS_WORK)
1. Plan does not include explicit tabletop pending-action regression coverage for contest flow. In current orchestration, grapple/shove tabletop path is `ATTACK` pending action with inline save resolution and must end by clearing pending action (no `DAMAGE` step). The proposed tests cover programmatic path + one E2E scenario, but do not explicitly lock this state-machine behavior.
2. Plan objective says it will prove attack-slot consumption across hit/miss + save fail/success branches, but listed tests do not explicitly assert tabletop attack-slot consumption (`useAttack` via `markActionSpent`) for both contest miss and contest hit branches.

## Missing Context
- Tabletop contest path already computes full STR/DEX save modifiers including save proficiency in `roll-state-machine.ts` (`resolveContestHit`).
- Programmatic path mismatch is real in `action-handlers/grapple-action-handler.ts` because domain helper currently receives raw STR/DEX mods only.

## Suggested Changes
1. Add CombatOrchestration regression test(s) for tabletop contest pending-action transitions: verify `ATTACK(contestType)` resolves directly to cleared pending action, never creates `DAMAGE` pending action, for both hit and miss cases.
2. Add explicit tabletop + programmatic assertions for attack economy on grapple/shove: one attack consumed per attempt, action only marked spent when attack pool is exhausted (Extra Attack parity), on both hit and miss branches.
3. Keep the planned programmatic save-modifier fix, but ensure parity by deriving target save proficiency from `CombatantCombatStats.saveProficiencies` (same canonical ability names used elsewhere).
