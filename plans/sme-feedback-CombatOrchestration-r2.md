# SME Feedback — CombatOrchestration — Inventory v2 — Round 2
## Verdict: APPROVED

Round 1 blockers and suggestions are addressed. Two minor clarifications noted below, non-blocking.

## Round 1 Blocker Resolution

**B1 — `handleGiveItemAction` economy-vs-UoW atomicity:** ADDRESSED (implicitly).
D5 wraps `transferItem` in `unitOfWork.run(repos => ...)` with both sheet re-reads. D6 step 5 mandates "ONE atomic `updateCombatantState` + optional `updateSheet`" with events post-commit. Combined, giver economy + both sheet writes land in one UoW.

**B2 — `item-consume-helper` ordering:** ADDRESSED.
New pure helper `consumeItemFromInventory(sheet, itemName)` returns `{updatedSheet, consumedItem, healingApplied?, effectsApplied?}` — no I/O. Caller persists single patch. Unit test `item-consume-helper.test.ts` gates parity.

**B3 — `free-object-interaction` on `use` union:** ADDRESSED.
D1 tightens `use` to `'action' | 'bonus' | 'utilize' | 'none'`. `'free-object-interaction'` retained only on `equip` and `give`. Use-cost degradation ladder eliminated.

## Round 1 Suggestion Resolution

| # | Suggestion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Giver combatant-state inside UoW | ✓ implicit | D5 + D6 step 5 |
| 2 | `item-consume-helper` pure / patch-only | ✓ | item-consume-helper.ts (NEW — pure) |
| 3 | Tighten `use` union | ✓ | D1 |
| 4 | Extract `ItemActionHandler` service | ✓ | D6 + D7 |
| 5 | AI calls `ActionService.useItem` directly | ✓ | D6 ("no text synthesis"), D9 UseObjectHandler bullet |
| 6 | Parser verbs in dedicated slot | ✓ | Strict split regex; "Precede attack parsers" |

## Round 2 Orchestration-Relevant Validation

- **`ItemActionHandler` as service (not helper)** — Correct. Matches existing `AttackActionHandler` / `GrappleActionHandler` pattern. Single entry point for `InteractionHandlers` (text) and `ActionService` (programmatic + AI).
- **Split `give` vs `administer`** — RAW-correct. `give` = free-object-interaction on conscious ally; `administer` = bonus action, works on unconscious. Separate methods eliminate conditional-cost branching inside one handler.
- **Strict parser regexes** — Anchored + non-greedy: `/^(?:give|hand)\s+(.+?)\s+to\s+(\S+)\s*$/i` and `/^(?:feed|administer)\s+(.+?)\s+to\s+(\S+)\s*$/i`. No collision with attack verbs or registered `ClassCombatTextProfile` action mappings. Safe without `tryMatchClassAction` guard.
- **AI direct ActionService call** — `UseObjectHandler` → `ActionService.useItem({actorId, itemName})` eliminates text round-trip. Decision FIFO queue semantics preserved.
- **Ambiguous item name** — D6 step 1 throws `ValidationError` with candidates list. No silent first-match.
- **Parser precedence** — "Precede attack parsers" correctly ordered given the anchored verbs.

## Minor Clarifications (Non-Blocking)

1. D6 step 5 phrasing ("ONE atomic `updateCombatantState` + optional `updateSheet`") is written for self-use. For `giveItem`/`administerItem` the atomic set is `updateCombatantState` (giver) + two `updateSheet` calls inside the UoW. Implementer doc should spell this out to prevent drift.
2. Plan doesn't explicitly reaffirm "no `tryMatchClassAction` guard needed" for the new verbs. Worth a one-line note in the parser section to preempt future regression.

Neither blocks approval. Ship it.
