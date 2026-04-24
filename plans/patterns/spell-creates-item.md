---
type: pattern
flow: SpellSystem
feature: pattern-spell-creates-item
author: claude-orchestrator
status: COMPLETE
created: 2026-04-24
updated: 2026-04-24
---

# Pattern — Spell Creates Inventory Items

Shape for spells that create physical items on cast (Goodberry, Heroes' Feast, Create Food and Water, Leomund's Tiny Hut trinkets, etc.). Distinct from `spell-buff-debuff.md` — these spells don't apply ActiveEffects to creatures; they mutate the caster's inventory via a declarative side-effect.

First concrete implementation: **Goodberry (L1 transmutation, Druid/Ranger)** — creates 10 goodberry-berry items with 1-long-rest expiry.

## Core Primitive

`SpellSideEffectDeclaration` with `type: 'creates_item'` on [prepared-spell-definition.ts](../../packages/game-server/src/domain/entities/spells/prepared-spell-definition.ts):

```ts
{
  type: 'creates_item',
  itemRef: { magicItemId: 'goodberry-berry' },
  quantity: 10,
  longRestsRemaining?: 1,  // optional — omit for permanent items
}
```

Placed on `PreparedSpellDefinition.onCastSideEffects` (array — multiple side-effects per cast are supported).

## Single Processor, Single Call Site

All side-effect processing goes through `processSpellCastSideEffects` in [spell-cast-side-effect-processor.ts](../../packages/game-server/src/application/services/combat/tabletop/spell-cast-side-effect-processor.ts). Invoked from exactly **one** wrapper (`SpellActionHandler.finalizeSpellCast`) — never from individual delivery handlers (C-R2-1 in the inventory-G2 plan).

Processor responsibilities:
1. Look up `magicItemId` in [magic-item-catalog.ts](../../packages/game-server/src/domain/entities/items/magic-item-catalog.ts). **Throws `ValidationError` on unresolved id** — fails loud so catalog typos don't silently create phantom items.
2. Dual-write: persistent `sheet.inventory` (always), plus the live combatant's `resources.inventory` (only when `actorCombatant` present).
3. Fire `InventoryChanged` event with `action: "create"`.

## Files Touched (always 4–5)

| # | File | Action |
|---|------|--------|
| 1 | `domain/entities/spells/prepared-spell-definition.ts` | only touched once when adding the `SpellSideEffectDeclaration` discriminant — subsequent spells reuse the existing union |
| 2 | `domain/entities/items/magic-item-catalog.ts` | add the created item (`GOODBERRY_BERRY` etc.) with `potionEffects`, `actionCosts`, and catalog-array registration |
| 3 | `domain/entities/spells/catalog/level-N.ts` | add spell entry with `onCastSideEffects: [{ type: 'creates_item', itemRef, quantity, longRestsRemaining? }]` + bump `catalog.test.ts` count |
| 4 | `scripts/test-harness/scenarios/<class>/<spell>-create-and-<verb>.json` | E2E scenario driving the cast + downstream consumption (eat, give, administer) |
| 5 | `domain/entities/spells/catalog/<spell>.test.ts` | unit test for catalog shape + side-effect declaration + magicItemId resolves |

## Action Economy Handling

Self-consume of a created item uses `actionCosts.use` on the `MagicItemDefinition`:
- `'bonus'` → eating costs a Bonus Action (Goodberry)
- `'action'` / `'utilize'` → costs an Action (most potions)
- `'none'` → rejected with ValidationError (non-consumable)

`InteractionHandlers.handleUseItemAction` reads `itemDef.actionCosts?.use` and routes to `bonusActionUsed` vs `actionSpent` on `resources`. Existing potion scenarios without explicit `actionCosts` fall through to the original action-cost behavior (no regression).

The text parser (`tryParseUseItemText`) accepts `use|drink|consume|quaff|eat|take` as verbs — `eat` is the Goodberry-specific affordance.

## Expiry: `longRestsRemaining`

Runtime items can expire. On `CharacterItemInstance`:

```ts
longRestsRemaining?: number;
```

Decremented by `InventoryService.applyLongRestToInventory` on long rest. Stacks reaching 0 are pruned. `sweepExpiredItems` runs at combat start as a safety net. Goodberry approximates the 24-hour RAW duration via `longRestsRemaining: 1` until an in-world clock exists.

## Stack Merge Rule

`addInventoryItem` merges stacks keyed on `(name, magicItemId, longRestsRemaining)` with `undefined === undefined` semantics. Multiple Goodberry casts on the same day produce one stack (10 + 10 = 20 berries). Multiple casts across days (different `longRestsRemaining`) split cleanly — fresh berries don't mingle with 1-long-rest-from-expiry berries.

## Counterspell Edge Case (known gap)

The REACTION_CHECK path (spell paused for counterspell resolution) returns BEFORE `finalizeSpellCast` fires — the slot is spent but side-effects are not processed. If the counterspell succeeds, items should not be created (correct). If the counterspell fails, the post-counterspell resume path currently does NOT re-invoke the processor — items are lost. Wire this in a follow-up commit (the two-phase-action-service needs to call `processSpellCastSideEffects` on spell-cast completion). Goodberry specifically is low-priority because it's a self-cast Druid spell rarely counterspelled in practice.

## Reference Implementation

- **Goodberry (Druid/Ranger L1)** — commit `<pending>`. Scenario: [scenarios/druid/goodberry-create-and-eat.json](../../packages/game-server/scripts/test-harness/scenarios/druid/goodberry-create-and-eat.json). Catalog: [level-1.ts](../../packages/game-server/src/domain/entities/spells/catalog/level-1.ts) `GOODBERRY`. Berry item: [magic-item-catalog.ts](../../packages/game-server/src/domain/entities/items/magic-item-catalog.ts) `GOODBERRY_BERRY`.

## Future Spells Using This Pattern

- **Heroes' Feast (L6 Cleric/Druid)** — creates 1 feast item per caster; eating grants advantage on wisdom saves + fear immunity + HP boost for 24h. Would need `onCastSideEffects: [{ creates_item: heroes-feast-plate × 12 }]` plus an item with `potionEffects.effects` for the buff.
- **Create Food and Water (L3 Cleric/Paladin)** — creates mundane food for 24h. `creates_item` with a consumable-rations item.
- **Leomund's Secret Chest (L4 Wizard)** — creates a permanent trinket the first time; subsequent casts summon/dismiss it. Needs a `summons_object` variant of `SpellSideEffectDeclaration` (not yet built).

## Verification Checklist

- [ ] `pnpm -C packages/game-server typecheck` clean
- [ ] `pnpm -C packages/game-server test` — catalog test + processor test pass
- [ ] `pnpm -C packages/game-server test:e2e:combat:mock -- --all` — new scenario passes (was failing before implementation)
- [ ] MCP `lookup_spell <name>` returns the new catalog entry
- [ ] Inventory assertion (`characterInventory.has`) works in the scenario
- [ ] No regression in pre-existing potion scenarios (their `actionCosts.use` is undefined so action-cost path kicks in)
