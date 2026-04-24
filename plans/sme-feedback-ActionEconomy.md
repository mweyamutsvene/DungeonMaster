# SME Feedback — ActionEconomy — Inventory G2 Plan — Round 1
## Verdict: APPROVED (with minor observations)

## Double-Reset Risk Check (primary ask)

**No double-trouble.** Verified against actual source:

- `extractActionEconomy()` (combat-hydration.ts:162) **conditionally** zeros `objectInteractionUsed` — only when `isFreshEconomy === true` (all three of action/bonus/reaction available). Otherwise it **preserves** the prior value.
- `resetTurnResources()` (resource-utils.ts:185–218) **unconditionally** zeros ~20 turn-scoped flags. Currently does NOT touch `objectInteractionUsed`.

Adding `objectInteractionUsed: false` to `resetTurnResources()` is safe:
1. **Idempotent** — setting a boolean to `false` twice has no observable side-effect.
2. **Consistent with existing pattern** — `bonusActionUsed`, `dashed`, `movementSpent`, `sneakAttackUsedThisTurn`, `rageAttackedThisTurn`, `bonusActionSpellCastThisTurn`, and others already appear in BOTH reset paths. `objectInteractionUsed` is the odd one out; this fix brings it into parity.
3. **Not redundant in practice** — the two functions have different call sites. `extractActionEconomy` runs during `processIncomingCombatantEffects` turn advance. `resetTurnResources` is called from other paths (e.g. special action-grant flows, tests, fallback). Leaving the flag out of `resetTurnResources` is the same class of latent bug as the historical Barbarian rage-flag miss (see `.github/study/analysis/barbarian-rage-comparison.md`), inverted.

**Conclusion:** adding it is correct. No double-reset risk.

## `hasFreeObjectInteractionAvailable` Helper

APPROVED. Should mirror `hasBonusActionAvailable` (resource-utils.ts:222–225):
```ts
const normalized = normalizeResources(resources);
return readBoolean(normalized, "objectInteractionUsed") !== true;
```

## Consumption Helpers for Item Use

APPROVED with one drift watch:

Mapping in D1 is correct:
- `'action'` / `'utilize'` → `markActionSpent()` / `actionSpent: true` ✓
- `'bonus'` → MUST call `useBonusAction()` (writes `bonusActionUsed: true`), NOT set `bonusActionSpent`. `hasBonusActionAvailable` reads `bonusActionUsed` only. `bonusActionSpent` is a separate flag written only by `extractActionEconomy`. Calling `useBonusAction()` is the canonical path — see Bardic Inspiration / Rage executors. **Flag this explicitly in the D6 handler spec so implementer doesn't invent a new flag.**
- `'free-object-interaction'` → read `objectInteractionUsed`, degrade to Utilize (action) if already used, write `{ objectInteractionUsed: true }`. Matches existing `handlePickupAction` / `handleDrawWeaponAction` cascade (interaction-handlers.ts:99,129,143).
- `'free'` / `'none'` → no-op / reject ✓

## Minor Suggestions (non-blocking)

1. **Pair with a consume helper.** Plan D8 only adds `hasFreeObjectInteractionAvailable`. The five existing inline writes of `{ ...r, objectInteractionUsed: true }` (interaction-handlers.ts:99,129,143,323,342) would benefit from a sibling `useFreeObjectInteraction(resources)` helper to mirror `useBonusAction`. Cuts future drift, trivial to add now.

2. **Test both reset paths.** The plan's test item only covers `resetTurnResources`. Add a `combat-hydration.test.ts` case asserting `extractActionEconomy` zeros `objectInteractionUsed` when `isFreshEconomy === true` AND preserves it when any economy slot is already spent. Guards against the *inverse* drift (primary path regressing while fallback stays green — symmetric to the Barbarian rage incident).

3. **Clarify D1 prose vs. type.** The bullet list treats `'free-object-interaction'` as a value, but the `ItemActionCosts.use` union is `'action' | 'bonus' | 'utilize' | 'free' | 'none'` — `'free-object-interaction'` only appears in `equip`. This is intentional (object interaction is an equip concept). Note it explicitly so implementer doesn't widen the `use` union.

## Missing Context
None. Plan cites reset sites, flag names, and cascade logic accurately.
