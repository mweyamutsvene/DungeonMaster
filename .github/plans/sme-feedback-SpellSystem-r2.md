# SME Feedback — SpellSystem — Round 2
## Verdict: APPROVED

As you wish Papi....

All three Round 1 blockers are resolved. Round 2 is clean to proceed.

## Round 1 Blocker Resolution

### ✅ Blocker 1 — Invocation order vs Counterspell branch
R2 D2 pipeline: *"delivery handler dispatch → processSpellCastSideEffects"*, and the change list explicitly states *"Invoke processor AFTER delivery dispatch in both normal AND post-counterspell paths."* This means:
- Counterspell **succeeds** (spell nullified) → `execute()` returns before delivery → processor never runs. Correct.
- Counterspell **fails / no reaction** → resumed path dispatches delivery → processor runs. Correct.
- Normal non-reaction path → delivery then processor. Correct.
No orphan items on counter.

### ✅ Blocker 2 — Slot-refund semantics on side-effect throw
R2 D2 makes the policy explicit: *"If step 4 throws after step 3 succeeded: slot is gone, effect was applied, item creation failed — surfaced as data-integrity error visible in logs (matches how counterspelled/fizzle state is handled today)."* This matches option (b) from R1 — acceptable and now documented. Reinforced by `spell-cast-side-effect-processor.test.ts` covering unknown-magicItemId throws.

### ✅ Blocker 3 — Out-of-combat cast path
D11 introduces `OutOfCombatSpellCastService.castSideEffectOnlySpell` + `POST /sessions/:id/characters/:charId/cast-spell-out-of-combat`. Scope is correctly narrowed: rejects spells with non-empty `effects`, non-self targets, or non-instantaneous duration. Full OoC pipeline (concentration, targeting, rituals, long casts) deferred. Tight, defensible scope for Goodberry-class primitives.

## Validation of New R2 Details

- **Dual-write to `sheet.inventory` AND `combatant.resources.inventory`** — correct. In-combat creature state reads inventory from combatant resources; sheet-only writes would be invisible until next hydration. Dual-write is the right call.
- **`ValidationError` on unresolved `magicItemId`** — good. Fail-fast at cast time surfaces catalog typos during scenario auth instead of silently producing empty stacks.
- **Goodberry `duration:'instantaneous'`** — ✅ RAW-correct for 5e 2024 (the cast itself is instantaneous; berry potency is carried on the item instance via `longRestsRemaining`, not spell duration). This is actually **more accurate** than my R1 suggestion of "24 hours" — I was wrong in R1. Decoupling spell-duration from item-expiry is the right model and generalizes to Heroes' Feast.
- **`itemRef: { magicItemId: string }`** — `displayName` correctly dropped.
- **`OutOfCombatSpellCastService` rejects non-instantaneous + non-self + non-empty-effects** — prevents the service from becoming a back-door combat-bypass for buffs (Bless, Mage Armor) that need full pipeline. Correct narrow scope.

## Non-Blocking Notes (for Implementer)

1. **Implementation ordering inside `spell-action-handler.ts`**: The Magic Missile inline path at L361-410 (flagged in plan's Risk #4) shares the post-delivery hook point. Verify the processor is invoked on the unified completion path (after all missile damage resolves), not per-missile. One call per successful cast.
2. **Post-counterspell resume site**: Confirm the `continueAfterReaction` / resume path in `spell-action-handler.ts` routes through the same `processSpellCastSideEffects` call as the normal path — single invocation site preferred over duplicating the call.
3. **`OutOfCombatSpellCastService` rejection messages**: Include the reason (`"spell has non-self target"`, `"spell has delivery effects"`) so route 400s are diagnosable.
4. **Test coverage reminder**: `spell-cast-side-effect-processor.test.ts` should include an explicit *"Counterspelled creates_item spell produces zero items"* case — regression guard for R1 Blocker 1.

Approved to advance to implementation.
