# SME Feedback — SpellSystem — Round 1
## Verdict: NEEDS_WORK

As you wish Papi....

The core architectural decision (D2 — parallel `onCastSideEffects` array, separate from `SpellEffectDeclaration`) is **correct and well-reasoned**. Keeping `creates_item` out of the closed `EffectType` union preserves the `BuffDebuffSpellDeliveryHandler` / `createEffect()` invariant cleanly. However, the invocation-order claim and cast-failure handling have real gaps.

## Issues (blocking)

### 1. Invocation order contradicts Counterspell branch (spell-action-handler.ts ~L209-297)
The plan states: *"invoked … after slot spend, before delivery dispatch."* But `SpellActionHandler.execute()` has **two slot-spend sites**:
- **L209-230** — inside the `awaiting_reactions` Counterspell branch, slot is spent, then the method **returns early** with `REACTION_CHECK`. Delivery happens later when the reaction resolves.
- **L299-327** — the normal path, slot spend immediately followed by delivery dispatch at L330.

If the processor runs after the first slot spend, items are created even when the spell is subsequently counterspelled. If it runs only in the second block, it never fires for spells that went through the reaction gate. Plan must specify: **run side effects only on successful resolution**, i.e. either (a) defer to post-counterspell-resolution, or (b) explicitly document that `creates_item` spells must set `counterspellable: false` / are non-targeted self-range (Goodberry qualifies; Heroes' Feast does not).

### 2. Slot-refund semantics on side-effect throw (not addressed)
`prepareSpellCast()` persists the slot decrement via `combatRepo.updateCombatantState` — **no transaction wraps the cast pipeline**. If `SpellCastSideEffectProcessor` → `inventoryService.createItemsForCharacter` throws (e.g. sheet write fails, UoW rollback), the slot is already gone. Plan needs one of:
- Wrap slot-spend + side-effects + delivery-dispatch in a single UoW (big change; flag for Round 2), OR
- Document that side-effect failures are **non-recoverable** and slot stays consumed (matches existing AI-path and Bless-bug behavior — acceptable but must be explicit), OR
- Run side-effects **before** `prepareSpellCast` with a compensating rollback step. Current plan is silent — pick one.

### 3. Out-of-combat cast path is missing
Goodberry's realistic usage is pre-combat (1-action cast, 24h duration per 2024 RAW). `SpellActionHandler.execute()` is wired through `TabletopCombatService` — it only runs **during combat**. Grep confirms no out-of-combat spell-cast service exists. The E2E scenario `druid/goodberry-create-and-eat.json` says "Druid casts Goodberry out of combat" — that code path doesn't exist. Plan must either:
- Add an out-of-combat spell-cast use case (significant new scope), OR
- Restrict Goodberry E2E to an in-combat cast (wastes an action but proves the plumbing), OR
- Pre-seed the inventory for the scenario and defer real out-of-combat casting.

## Shape-level issues (fix before implementation)

### 4. Goodberry duration is wrong (2024 RAW)
Plan specifies "1 min duration" — that's 2014. **D&D 5e 2024 Goodberry duration is 24 hours** (berry loses potency 24h after casting). `longRestsUntilExpiry: 1` remains a fine pragmatic proxy (D3), but the spell's declared `duration` field should match RAW ("24 hours" or equivalent), not "1 min".

### 5. `SpellSideEffectDeclaration.itemRef.magicItemId`
Good that it's a ref, not inlined. But `displayName?: string` is dead weight — the item definition already has a name. Drop it unless there's a use case (e.g. "Druid's Goodberry" vs generic).

## Approved aspects

- ✅ **Parallel array, not `SpellEffectDeclaration` union member** — correct. `EffectType` is consumed by `createEffect()` in the buff/debuff handler; polluting it would regress.
- ✅ **Self-scoped writes on caster only** via `deps.characters.updateSheet` — consistent with how concentration/slot state is managed.
- ✅ **No delivery-handler changes** — good separation, processor is orthogonal to the 5 strategies.
- ✅ **Goodberry has no concentration, no target, no save** — simplest possible first consumer, isolates the new primitive.

## Suggested Changes for Round 2

1. **Move invocation to post-resolution**: Run `SpellCastSideEffectProcessor` only on the final successful delivery path, not inside the Counterspell reaction branch. Add explicit test: "Counterspelled `creates_item` spell does NOT create items."
2. **Document slot-spend-on-throw policy**: Add an "Error Handling" subsection to D2 stating side-effect failures do not refund slots (match existing behavior) and log via debug. Add a unit test asserting this.
3. **Descope OoC casting from this plan**: Change E2E scenario(s) to either (a) in-combat Goodberry cast on turn 1 (waste action, prove plumbing), or (b) pre-seed inventory + test only the eat/give/expire flows. Add out-of-combat spell-cast service to Deferred.
4. **Fix Goodberry duration to "24 hours"** in the spell definition.
5. **Drop `displayName` from `SpellSideEffectDeclaration.itemRef`** unless justified.
