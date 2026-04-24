# SME Feedback — CombatOrchestration — Inventory v2 — Round 1
## Verdict: NEEDS_WORK

The orchestration surface is well-scoped and the refactor targets are correctly identified. Approval blocked on three concrete ordering/atomicity gaps that will bite at implementation time if not pinned down in the plan now.

## Issues

### 1. `handleGiveItemAction`: economy-vs-UoW ordering is undefined (atomicity hole)
The giver's action-economy lives on `combatantState.resources` (combatRepo), NOT on the character sheet (charactersRepo). D5 wraps both sheet writes in `unitOfWork.run(...)` — good — but does not say whether the giver's economy slot (`actionSpent` / `hasBonusActionAvailable` / `objectInteractionUsed`) is written inside or outside that UoW. Failure modes: UoW commits the item transfer, then the `combatRepo.updateCombatantState` write fails → free give; or the reverse: economy consumed, transfer throws, sheets rollback → slot paid but no transfer.

**Required:** Plan must either (a) extend the UoW to include `combatRepo.updateCombatantState` for the giver, or (b) explicitly define reversal semantics on `combatRepo` write failure. D10's "events fire post-commit" discipline must apply to state writes too.

### 2. `handleUseItemAction` / `item-consume-helper`: consume-before-apply ordering not pinned
Current impl (interaction-handlers.ts:466-618) follows: (i) validate economy, (ii) `useConsumableItem` in-memory, (iii) roll dice / compute healing / effects, (iv) single `updateCombatantState` persisting inventory + `actionSpent` + hp + conditions together. This is "validate-first, apply-and-commit-together" and is correct.

D6 extracts this into a helper across three call sites (in-combat, out-of-combat route, AI `UseObjectHandler`). Plan must explicitly state: **helper returns `{ updatedSheetPatch, economyPatch, diagnostics }` for the caller to persist in a single write; helper performs no I/O itself.** A helper that mutates inventory in one call and returns effects in another re-introduces the partial-state bugs the extraction is supposed to eliminate.

### 3. `free-object-interaction` on `use` cost is dead code surface
D1 lists `'free-object-interaction'` as a valid value for `actionCosts.use`. Per RAW, nothing uses-as-a-free-interaction (potions = bonus, scrolls = utilize, mundane = action). Keeping that value in the `use` union means `handleUseItemAction` must implement the full "already used? → degrade to Utilize → degrade-fails-if-action-spent" ladder that currently lives only in draw/sheathe (interaction-handlers.ts:293-311, 405-413).

**Required:** Either (a) restrict `use` to `'action' | 'bonus' | 'utilize' | 'none'` and keep `'free-object-interaction'` exclusive to `equip`/`give`; or (b) name one concrete item that legitimately uses `use:'free-object-interaction'` so the degradation logic is justified. Option (a) preferred.

## Missing Context

- **Parser ordering / class-action guard:** the existing useItem parser at dispatcher slot #18 strips `"use|try"` verbs and re-checks `tryMatchClassAction` to avoid collision with class abilities (action-dispatcher.ts:590-595). The new `give/feed/hand` parser verbs do not collide with known class abilities, so no guard is needed — but plan should explicitly commit to the verb set (suggest: `give | feed | hand | pass`; avoid `throw` which collides with attack verbs) and place it in a dedicated dispatcher slot, not fold it into slot #18.
- **`ActionService` dispatch strategy mismatch:** D7 says "delegate to the same dispatcher path via `parseCombatAction`." Existing ActionService methods (`attack`, `grapple`, `castSpell`) delegate to dedicated handler classes (`AttackActionHandler`, `GrappleActionHandler`), NOT to `parseCombatAction`. Re-parsing a synthesized string works but is architecturally inconsistent and adds a text round-trip.
- **AI path:** D9 doesn't say whether `UseObjectHandler` calls `ActionService.useItem` directly or continues synthesizing a "drink potion" text for the text parser. Pick one and state it.

## Suggested Changes

1. **D5/D6:** add "Giver's combatant-state resource write is included in the same UoW as the sheet transfers. On UoW failure, no economy is consumed and no inventory moves."
2. **D6:** add "`item-consume-helper` is pure — returns a single patch object. The caller performs one `updateCombatantState` persisting inventory + economy + hp + conditions atomically. No I/O in the helper."
3. **D1:** tighten `use` to `'action' | 'bonus' | 'utilize' | 'none'`. Keep `'free-object-interaction'` on `equip` and `give` only. Drop the use-cost degradation ladder from `handleUseItemAction`.
4. **D7:** replace "delegate via `parseCombatAction`" with "extract `ItemActionHandler` service; `InteractionHandlers.handleUseItemAction` / `handleGiveItemAction` and `ActionService.useItem/giveItem` both call it." Matches existing action-handler pattern.
5. **D9:** specify "AI `UseObjectHandler` calls `ActionService.useItem({actorId, itemName})` directly — no text synthesis."
6. **Parser:** commit to verb set `give | feed | hand | pass` in its own dispatcher slot; no class-action guard needed (verbs don't collide).

Once these six items are addressed, the CombatOrchestration surface is good to ship.
