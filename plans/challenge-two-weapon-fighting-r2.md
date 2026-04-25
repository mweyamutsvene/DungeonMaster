# Plan Challenge — Two-Weapon Fighting Rework (Round 2)

## Overall Assessment: APPROVED_WITH_WATCHLIST

## Critical Issues (must address before implementation)
None.

## Watchlist (non-blocking, verify during implementation)
1. Attack prerequisite semantics must use real attack usage (`attacksUsedThisTurn > 0`), not generic `actionSpent`, to avoid multi-attack false negatives.
2. Offhand must not consume Attack-action usage in either roll path: miss handling in `roll-state-machine` and hit/damage completion in `damage-resolver`.
3. Parser-chain offhand and fallback `command.kind === "offhand"` must share one prevalidation helper and produce identical legality + bonus/Nick behavior.
4. Dual Wielder feat wiring must be end-to-end for all offhand entry routes (not parser-only).
5. Keep offhand classification contract stable (typed/shared discriminator) so TWF style add-back remains correct and Dueling exclusion does not regress.

## Edge Cases to Confirm in Test Evidence
1. `attack -> offhand -> second attack` keeps Attack-action economy correct.
2. Offhand-before-Attack fails identically via parser and fallback phrases.
3. Nick waives bonus action once per turn, then resets next turn.
4. Dual Wielder permits non-Light pair; no-feat equivalent fails.
5. Offhand damage modifier behavior: no style = no ability mod, TWF style = ability mod added.
