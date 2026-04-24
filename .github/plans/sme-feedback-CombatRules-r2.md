# SME Feedback — CombatRules — Round 2
## Verdict: APPROVED

## Round 1 RAW Issues — Confirmed Addressed
1. **Goodberry duration** — ✅ Plan declares `duration:'instantaneous'`, no concentration (level-1.ts entry + JSDoc). Berries carry their own expiry via `longRestsRemaining:1`; spell itself is instantaneous per 2024 PHB. The 24h → 1-long-rest approximation is explicitly documented and flagged as deferred drift.
2. **Give vs administer split** — ✅ `give:'free-object-interaction'` (hand to willing/conscious ally, transfer only) vs `administer:'bonus'` (force-feed, transfer+activate, works on unconscious). Matches 2024 RAW: handing an item = object interaction; forcing a potion into another creature = Bonus Action (Magic Items rules).
3. **Armor don/doff table** — ✅ Light 1/1, Medium 5/1, Heavy 10/5 matches 2024 PHB armor table. Shield `{equip:'utilize'}` correctly maps to Action per 2024 ("Don/Doff Shield" is a utilize/action, not free object interaction). `equip:'out-of-combat-only'` for body armor correctly prevents mid-combat donning.
4. **Potion defaults** — ✅ `{use:'bonus', give:'free-object-interaction', administer:'bonus'}` matches 2024 RAW (drinking a potion on self = BA; administering = BA). Goodberry-berry inherits the same costs, which is consistent with the "pop a berry" RAW treatment.
5. **`use` union without free-object-interaction** — ✅ `'action' | 'bonus' | 'utilize' | 'none'` correctly excludes FOI. Drawing/stowing/handing uses FOI; activation/consumption never does. Good separation of concerns.

## Additional RAW Checks (all pass)
- Goodberry healing `{diceCount:0, diceSides:0, modifier:1}` = flat 1 HP per berry ✓ (2024: "you gain 1 Hit Point").
- Goodberry berry category `potion` is a reasonable reuse — no RAW conflict; keeps action-economy routing consistent (BA to eat, FOI to hand off, BA to administer).
- Weapon default `{equip:'free-object-interaction'}` ✓ (drawing/stowing one weapon = one FOI per turn).
- `FreeObjectInteractionExhausted` with no auto-upgrade to Action ✓ — 2024 keeps a hard one-per-turn cap; no RAW allows converting Action → extra FOI.
- `'out-of-combat-only'` blocked by `InventoryService.equipItem` during active encounter ✓ (armor don time > 6 sec round).

## Minor Observations (non-blocking)
- D3 combat-start sweep: confirm `sweepExpiredItems` runs BEFORE initiative roll so expired berries can't be eaten on round 1 of a post-rest encounter. Plan lists it at encounter start — fine, just verify ordering in impl.
- Shield `equip:'utilize'` currently maps to `consumeAction()`. 2024 also permits Don/Doff Shield as part of Attack action in some readings; current strict-Action mapping is the safe default — flag if future shield-swap abilities need to override.
- Audit note on existing potions (magic-item-catalog.ts) is important — any legacy potion without explicit `actionCosts` must fall through `resolveItemActionCosts` defaults cleanly. Worth a unit test asserting every shipped potion resolves to `{use:'bonus', give:'foi', administer:'bonus'}` unless overridden.

## No blocking issues for CombatRules flow.
