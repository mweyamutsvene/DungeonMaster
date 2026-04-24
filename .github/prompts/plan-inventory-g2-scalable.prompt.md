# Plan: Scalable Inventory v2 — Item Creation, Transfer, Action-Economy Costs
## Round: 2
## Status: DRAFT
## Affected Flows: InventorySystem, SpellSystem, CombatOrchestration, ActionEconomy, EntityManagement, CombatRules, AIBehavior

## Round 2 Changes from Round 1
- **C1:** `onCastSideEffects` runs **AFTER** delivery dispatch; dual-writes to `combatant.resources.inventory`.
- **C-R2-1:** Single wrapper call site for `processSpellCastSideEffects` — never invoked by delivery handlers.
- **C-R2-2:** Processor `actorCombatant?` optional; combat-start hydrates `resources.inventory` from `sheet.inventory`.
- **C2:** `sheetVersion` optimistic-concurrency field; transfer re-reads inside UoW callback.
- **C3:** Strict parser regex; explicit ambiguous-name handling.
- **C4:** Hard-fail `ValidationError` on unresolved `magicItemId`.
- **C5:** Audit all callers of `resetTurnResources` before applying the fix.
- **C6:** `UseObjectHandler` gets EV-based selection; loses to better BA heal spells via `bestBonusHealSpellEV` from context builder.
- **I1:** `InventoryService.equipItem` rejects `out-of-combat-only` when active encounter exists.
- **I-R2-1:** Potion `administer` default = `utilize` (2024 RAW); Goodberry overrides to `bonus`.
- **I3:** Split `give` (free-obj-int, transfer only) vs `feed`/`administer` (bonus/utilize per item, transfer + immediate activate).
- **I-R2-5:** `canUseItems: true` sheet override noted for future Wild Shape / polymorph integration (TODO).
- **Goodberry RAW fix:** duration = Instantaneous; 10 berries each with `longRestsRemaining:1`; document 1-long-rest ≈ 24h approximation.
- **Scroll `use`:** deferred — no scroll items ship in this plan.
- **Armor:** `{donMinutes, doffMinutes}` per type (Light 1/1, Medium 5/1, Heavy 10/5).
- **`use` union tightened:** `'action' | 'bonus' | 'utilize' | 'none'`.
- **New `ItemActionHandler` service:** called by both `InteractionHandlers` and `ActionService`; AI calls `ActionService.useItem` directly.
- **Out-of-combat Goodberry cast** via new `OutOfCombatSpellCastService.castSideEffectOnlySpell` (scoped narrowly).
- **Unified event:** reuse `InventoryChanged` with extended `action` union.
- **`canUseItems` default**: `true`; blocklist `creatureType` ∈ `{beast, undead, construct, ooze, plant}` unless sheet override.
- **Test-fixture + LLM-snapshot migration** included in change list.
- **UoW re-entrancy:** `InventoryService` methods accept optional `repos` to batch into caller UoW.

## Objective
Make inventory a first-class combat citizen. Ship three capabilities:
1. **Spells can create items at runtime** (Goodberry → 10 berries). Reusable primitive.
2. **Atomic party-member item transfer** (hand potion to ally, feed goodberry to unconscious friend).
3. **Every item declares its own action cost** per D&D 5e 2024 RAW.

First concrete beneficiary: **Goodberry** (full RAW G2).

---

## Architectural Decisions (Round 2)

### D1. Item action-cost metadata
```ts
interface ItemActionCosts {
  /** Self-use cost. */
  use?: 'action' | 'bonus' | 'utilize' | 'none';
  /** Hand to willing, conscious ally. */
  give?: 'free-object-interaction' | 'utilize' | 'none';
  /** Force-feed/administer to ally (works on unconscious). RAW potion/berry = Bonus. */
  administer?: 'action' | 'bonus' | 'utilize' | 'none';
  /** Equip in combat. */
  equip?: 'free-object-interaction' | 'utilize' | 'out-of-combat-only';
  donMinutes?: number;
  doffMinutes?: number;
}
```
Value → action-economy mapping:
- `'action'` / `'utilize'` → `consumeAction()`
- `'bonus'` → `hasBonusActionAvailable(r)` guard + `useBonusAction(r)`
- `'free-object-interaction'` → `hasFreeObjectInteractionAvailable(r)` + `useFreeObjectInteraction(r)`; if used → throw `FreeObjectInteractionExhausted`, no auto-upgrade
- `'none'` → reject
- `'out-of-combat-only'` → rejected by dispatcher + by `InventoryService.equipItem` during active encounter

RAW defaults per category (in `resolveItemActionCosts`):
- `potion`: `{use:'bonus', give:'free-object-interaction', administer:'utilize'}` (2024 RAW: administering to another creature is Utilize action; self-drink is Bonus). Goodberry overrides `administer:'bonus'` to preserve spell text ("a creature can eat one berry" as a Bonus Action).
- `weapon`: `{equip:'free-object-interaction'}`
- `armor`: `{equip:'out-of-combat-only', donMinutes, doffMinutes}` per type
- `wondrous-item`: `{use:'utilize'}`

### D2. `creates_item` spell side-effect
```ts
interface SpellSideEffectDeclaration {
  type: 'creates_item';
  itemRef: { magicItemId: string };
  quantity: number;
  longRestsRemaining?: number;
}
readonly onCastSideEffects?: SpellSideEffectDeclaration[];
```

**Cast pipeline order (REVISED):**
1. validate → 2. spend slot + concentration → 3. **delivery handler dispatch** → 4. `processSpellCastSideEffects` → 5. emit events

Step 4 throws `ValidationError` on unresolved `magicItemId` (C4). Dual-writes to `sheet.inventory` AND (when `actorCombatant` present) `combatant.resources.inventory` (C1). If step 4 throws after step 3 succeeded: slot is gone, effect was applied, item creation failed — surfaced as data-integrity error visible in logs.

**Call-site policy for `processSpellCastSideEffects` (C-R2-1):**
Processor is invoked by a single **wrapper** inside `SpellActionHandler.execute()` that awaits whatever path ran (handler.handle / Magic Missile inline / post-counterspell resume / no-handler fallthrough) and then runs side-effects. Every return from delivery dispatch flows through that wrapper; NO delivery handler invokes the processor itself. Concretely:
```ts
async execute(ctx): Promise<Result> {
  // 1. validate, 2. slot + concentration
  const result = await this.dispatchDelivery(ctx);   // handler.handle / mm inline / fallthrough
  await processSpellCastSideEffects(spell, caster, ctx, this.deps);
  // 5. emit events
  return result;
}
```
Post-counterspell resume path (when `awaiting_reactions` resolves) re-enters `execute` at the slot-already-spent branch and hits the same wrapper. One call site, never more.

**OoC dual-write (C-R2-2):**
`processSpellCastSideEffects(spell, caster, ctx, deps)` — `ctx.actorCombatant?` is optional. When absent (OoC cast), processor writes sheet only; combatant.resources.inventory is re-hydrated on next `combat/start` via a new `hydrateInventoryFromSheet` step added to the encounter-start flow alongside the combat-start `sweepExpiredItems` call (D3).

### D3. Expiry — `longRestsRemaining` + sweep on rest AND combat-start
- `CharacterItemInstance.longRestsRemaining?: number`.
- `InventoryService.sweepExpiredItems(sessionId, charIds, repos?)` called from:
  - `rest-service.ts` long-rest branch, batched into rest UoW.
  - `combat-service.ts` at encounter start (I5).
- Emits `InventoryChanged { action: 'expire' }` per pruned stack via deferred event repo inside caller UoW.

### D4. Stack-split on distinct expiry
Stack-merge key: `(name, magicItemId, longRestsRemaining)` with `undefined === undefined` semantics on both.

### D5. Transfer via UoW + optimistic concurrency
- `InventoryService.transferItem` uses `unitOfWork.run(repos => {...})`, re-reads both sheets INSIDE callback.
- `SessionCharacter.sheetVersion: number` bumped on every `updateSheet`. `updateSheetWithVersion(id, sheet, expectedVersion)` throws `ConflictError` on mismatch.
- Single retry on conflict, then surface.
- Events emitted via deferred event repo inside UoW.
- Graceful when `unitOfWork` absent (memory tests): mutation runs without transactional guarantees, logs WARN.

### D6. Combat item-use via new `ItemActionHandler`
Shared service called by `InteractionHandlers` (parsed-text) and `ActionService` (programmatic + AI). AI `UseObjectHandler` calls `ActionService.useItem` directly — no text synthesis.
```ts
class ItemActionHandler {
  useItem(actorId, itemName, ctx): Result
  giveItem(actorId, targetId, itemName, ctx): Result          // transfer only
  administerItem(actorId, targetId, itemName, ctx): Result    // transfer + activate on target
}
```
Method contract:
1. Resolve item (ambiguity → `ValidationError` with candidates list).
2. Resolve cost via `resolveItemActionCosts(item)`.
3. Validate economy slot.
4. Compute patch in-memory (pure).
5. ONE atomic `updateCombatantState` + optional `updateSheet`.
6. Emit `InventoryChanged` post-commit.

### D7. `ActionService` methods
`useItem`, `giveItem`, `administerItem` → `ItemActionHandler`.

### D8. `resetTurnResources` — audit first, fix second
**STEP 1:** grep all callers; document in plan comment.
**STEP 2:** If all are turn-boundary → add `objectInteractionUsed: false`. Else narrow.

### D9. AI — EV selection + canUseItems gate
- `AiCombatContext.usableItems: AiItemSummary[]` (replaces `hasPotions`).
- `AiItemSummary = { name, useCost, effectKind, estimatedHeal?, requiresBonus }`.
- `AiCombatContext.canUseItems: boolean` — `false` for `creatureType` ∈ `{beast, undead, construct, ooze, plant}` unless sheet override (TODO for Wild Shape integration).
- `AiCombatContext.bestBonusHealSpellEV?: number` — populated by `ai-context-builder` alongside `usableItems`; avg heal of best available BA healing spell (Healing Word ≈ 1d4+mod) or `undefined` if none.
- `UseObjectHandler.findBestUsableItem`:
  - Requires `canUseItems`.
  - Picks max `estimatedHeal`.
  - If `bestBonusHealSpellEV > bestPotion.estimatedHeal`, skip potion branch (falls through to BA spell picker).
- Updates at: `deterministic-ai.ts:~375` + `infrastructure/llm/ai-decision-maker.ts:~79` + test fixtures `deterministic-ai.test.ts` (2 sites) + `context-budget.test.ts`.
- LLM snapshot regen step included.

### D10. Events unified on `InventoryChanged`
Extend `action`: `'add' | 'remove' | 'use' | 'transfer' | 'create' | 'expire' | 'equip' | 'unequip'`.

### D11. Minimal out-of-combat spell cast (Goodberry-only)
New `OutOfCombatSpellCastService.castSideEffectOnlySpell({casterId, spellName, slotLevel})`:
- Verifies spell in spellbook + slot available.
- Rejects spells with non-empty `effects`, non-self targets, or non-instantaneous delivery.
- Spends slot → runs `processSpellCastSideEffects`.
- New route: `POST /sessions/:id/characters/:charId/cast-spell-out-of-combat`.

Full OoC spell cast pipeline (targeting, concentration, rituals, long casts) = **deferred**.

---

## Changes by Flow

### InventorySystem

`packages/game-server/src/domain/entities/items/magic-item.ts`
- [ ] Add `ItemActionCosts` interface.
- [ ] Add optional `actionCosts?: ItemActionCosts` to `MagicItemDefinition`.
- [ ] Add `longRestsRemaining?: number` to `CharacterItemInstance`.
- [ ] JSDoc RAW citations.

`packages/game-server/src/domain/entities/items/inventory.ts`
- [ ] Update `addInventoryItem` stack-merge key: `(name, magicItemId, longRestsRemaining)` with `undefined === undefined` on both.
- [ ] Add `decrementItemExpiries(inventory)` returning `{updated, expired}`.

`packages/game-server/src/domain/entities/items/item-action-defaults.ts` (NEW)
- [ ] `getCategoryActionCostDefaults(category, itemTags?)`.
- [ ] `resolveItemActionCosts(item)`.

`packages/game-server/src/application/services/entities/item-consume-helper.ts` (NEW — pure)
- [ ] `consumeItemFromInventory(sheet, itemName)` returning `{updatedSheet, consumedItem, healingApplied?, effectsApplied?}`.

`packages/game-server/src/application/services/entities/inventory-service.ts` (NEW)
- [x] `transferItem(input, repos?)` — UoW + re-read inside callback + sheetVersion guard + 1 retry. *(Commit 3)*
- [x] `createItemsForCharacter(input, repos?)`. *(Commit 3)*
- [x] `sweepExpiredItems(sessionId, charIds, repos?)` + `applyLongRestToInventory`. *(Commit 3)*
- [ ] `equipItem(input, repos?)` — rejects `out-of-combat-only` during active encounter. **DEFERRED** — no E2E scenario in this plan requires it; move to Commit 4 alongside ItemActionHandler.

`packages/game-server/src/application/services/entities/rest-service.ts`
- [ ] Call `applyLongRestToInventory(..., repos)` on long-rest branch. **BLOCKED** — no `rest-service.ts` exists yet (only `domain/rules/rest.ts` pure helpers). Defer to whenever long-rest application service lands.

`packages/game-server/src/application/services/combat/combat-service.ts` (or start-encounter site)
- [x] Call `sweepExpiredItems` at combat start. *(Commit 3: hooked in `session-combat.ts` and `session-tabletop.ts` routes before delegating to combat service.)*
- [x] Call `hydrateInventoryFromSheet` for each combatant at combat start so OoC-created items (Goodberry) populate `combatant.resources.inventory` (C-R2-2). *(Already present in `initiative-handler.ts` `buildCombatantResources` — `resources.inventory = sheet.inventory`.)*

`packages/game-server/src/infrastructure/api/routes/sessions/session-inventory.ts`
- [ ] Route POST/DELETE/PATCH/use/use-charge through `inventoryService`. **DEFERRED** — existing routes work; service-routing refactor is a cosmetic improvement. Moved to Commit 4 alongside ItemActionHandler refactor.
- [x] Add `POST /inventory/:itemName/transfer` body `{toCharId, quantity}`. *(Commit 3)*
- [x] Update `app.test.ts` (already done in Commit 2; new service reuses existing deps).

`packages/game-server/prisma/schema.prisma`
- [ ] Add `sheetVersion Int @default(0)` to `SessionCharacter`.
- [ ] `prisma migrate dev` in impl.

`packages/game-server/src/infrastructure/db/characters-repository.ts`
- [ ] Bump `sheetVersion` on every `updateSheet`.
- [ ] Add `updateSheetWithVersion`.

`packages/game-server/src/infrastructure/testing/memory-repos.ts`
- [ ] Mirror `sheetVersion` semantics.
- [ ] Minimal `MemoryUnitOfWork` (snapshot + restore on throw).

### SpellSystem

`packages/game-server/src/domain/entities/spells/prepared-spell-definition.ts`
- [ ] Add `SpellSideEffectDeclaration` + optional `onCastSideEffects`.

`packages/game-server/src/application/services/combat/tabletop/spell-cast-side-effect-processor.ts` (NEW)
- [ ] `processSpellCastSideEffects(spell, caster, ctx, deps)` — magicItemId lookup throws on miss; dual-writes sheet + combatant.resources.inventory.

`packages/game-server/src/application/services/combat/tabletop/spell-action-handler.ts`
- [ ] Invoke processor AFTER delivery dispatch in both normal AND post-counterspell paths.

`packages/game-server/src/application/services/entities/out-of-combat-spell-cast-service.ts` (NEW)
- [ ] `castSideEffectOnlySpell` — rejects non-side-effect-only spells.

`packages/game-server/src/infrastructure/api/routes/sessions/session-out-of-combat-spells.ts` (NEW)
- [ ] POST route.

`packages/game-server/src/domain/entities/spells/catalog/level-1.ts`
- [ ] Add `GOODBERRY`: L1 transmutation, `castingTime:'action'`, VSM (mistletoe), range self, `duration:'instantaneous'`, no concentration, Druid + Ranger.
- [ ] `onCastSideEffects: [{type:'creates_item', itemRef:{magicItemId:'goodberry-berry'}, quantity:10, longRestsRemaining:1}]`.
- [ ] JSDoc: "RAW 24h; approximated via 1 long rest until in-world clock exists."
- [ ] Bump `catalog.test.ts` L1 count.

### CombatOrchestration

`packages/game-server/src/application/services/combat/item-action-handler.ts` (NEW)
- [ ] Per D6.

`packages/game-server/src/application/services/combat/tabletop/dispatch/interaction-handlers.ts`
- [ ] `handleUseItemAction` → `ItemActionHandler.useItem`.
- [ ] `handleGiveItemAction` → `ItemActionHandler.giveItem`.
- [ ] `handleAdministerItemAction` → `ItemActionHandler.administerItem`.

`packages/game-server/src/application/services/combat/tabletop/combat-text-parser.ts`
- [ ] Regex: `/^(?:give|hand)\s+(.+?)\s+to\s+(\S+)\s*$/i` → give.
- [ ] Regex: `/^(?:feed|administer)\s+(.+?)\s+to\s+(\S+)\s*$/i` → administer.
- [ ] Retain `use|drink|eat`.
- [ ] Ambiguous `use potion` → `ValidationError` listing candidates.
- [ ] Precede attack parsers.

`packages/game-server/src/application/services/combat/action-service.ts`
- [ ] `useItem`, `giveItem`, `administerItem` → delegate to `ItemActionHandler`.

### ActionEconomy

`packages/game-server/src/domain/entities/combat/action-economy.ts`
- [ ] JSDoc `objectInteractionUsed`.
- [ ] Add `hasFreeObjectInteractionAvailable(r)` + `useFreeObjectInteraction(r)` helpers.

`packages/game-server/src/application/services/combat/helpers/resource-utils.ts`
- [ ] **STEP 1:** grep + document all callers of `resetTurnResources`.
- [ ] **STEP 2:** Add `objectInteractionUsed: false` only if all callers are turn-boundary.

### EntityManagement
- [ ] `sheetVersion` schema + migration + repo + memory-repo.
- [ ] Minimal `MemoryUnitOfWork`.
- [ ] `charactersRepo.updateSheetWithVersion`.

### CombatRules (item catalog)

`packages/game-server/src/domain/entities/items/magic-item-catalog.ts`
- [ ] Add `goodberry-berry`: category `potion`, common, no attunement, `actionCosts:{use:'bonus', give:'free-object-interaction', administer:'bonus'}` (overrides default potion `administer:'utilize'` per spell text: "a creature can eat one berry" = Bonus Action), `potionEffects.healing:{diceCount:0, diceSides:0, modifier:1}`.
- [ ] Audit existing potions — verify actionCosts correct; default `administer:'utilize'` applies to all unless overridden.

`packages/game-server/src/domain/entities/items/armor-catalog.ts`
- [ ] Thread `actionCosts:{equip:'out-of-combat-only', donMinutes, doffMinutes}` per 2024 RAW: Light 1/1, Medium 5/1, Heavy 10/5; Shield `{equip:'utilize'}`.

`packages/game-server/src/domain/entities/items/weapon-catalog.ts`
- [ ] Default `actionCosts:{equip:'free-object-interaction'}`.

### AIBehavior

`packages/game-server/src/application/services/combat/ai/ai-types.ts`
- [ ] `hasPotions` → `usableItems: AiItemSummary[]` + `canUseItems: boolean`.

`packages/game-server/src/application/services/combat/ai/ai-context-builder.ts` (~line 718)
- [ ] Populate `usableItems` (filter: has `potionEffects` OR explicit allowlist).
- [ ] Compute `canUseItems` from creatureType.

`packages/game-server/src/application/services/combat/ai/deterministic-ai.ts` (~line 375)
- [ ] Replace `hasPotions`; gate on `canUseItems && usableItems.length > 0`.
- [ ] EV comparison vs BA heal spells.

`packages/game-server/src/application/services/combat/ai/handlers/use-object-handler.ts`
- [ ] Use `usableItems`; EV-based `findBestUsableItem`.
- [ ] Call `ActionService.useItem` directly.

`packages/game-server/src/infrastructure/llm/ai-decision-maker.ts` (~line 79)
- [ ] Replace `hasPotions` in prompt.

Test fixture updates:
- [ ] `deterministic-ai.test.ts` (2 sites).
- [ ] `context-budget.test.ts`.
- [ ] `scripts/test-harness/scenarios/**/ai-use-potion*.json` — add `creatureType`.
- [ ] `pnpm -C packages/game-server test:llm:e2e:snapshot-update` to regen.

---

## Cross-Flow Risk Checklist
- [x] Delivery handler runs before side effects → no orphan items on delivery failure.
- [x] Pending action state machine: no new kinds.
- [x] Action economy: each use consumes one slot; `resetTurnResources` audited.
- [x] Player AND AI converge on `ItemActionHandler`.
- [x] Repo + memory-repo updated (sheetVersion, MemoryUoW).
- [x] `app.ts` wires new services.
- [x] 2024 RAW verified.

---

## Risks
1. `sheetVersion` migration: default 0, safe.
2. Stack-key change: `undefined === undefined` preserves stacks.
3. `MemoryUnitOfWork` may miss edge cases — pair with one SQLite integration test.
4. Reordering side-effects AFTER delivery: verify Magic Missile inline at `spell-action-handler.ts:361-410` still compatible.
5. LLM snapshot churn — mitigated by regen step.
6. Parser precedence tested in integration.

---

## Test Plan

### Unit tests
- [ ] `inventory.test.ts` — stack-key `longRestsRemaining` semantics + `decrementItemExpiries`.
- [ ] `item-action-defaults.test.ts` — category defaults + override.
- [ ] `item-consume-helper.test.ts` — parity with 3 prev sites.
- [ ] `item-action-handler.test.ts` — all 3 methods + ambiguity + canUseItems.
- [ ] `inventory-service.test.ts` — transfer atomicity (MemoryUoW rollback) + sheetVersion conflict retry + sweepExpiredItems + equip rejection.
- [ ] `spell-cast-side-effect-processor.test.ts` — dual-write success, unknown magicItemId throws, delivery-failure does-not-create.
- [ ] `out-of-combat-spell-cast-service.test.ts` — Goodberry happy path + reject non-side-effect-only.
- [ ] `resource-utils.test.ts` — `resetTurnResources` zeroes `objectInteractionUsed`.
- [ ] `action-service.test.ts` — useItem/giveItem/administerItem programmatic.
- [ ] `goodberry.test.ts` — spell shape + duration=instantaneous.
- [ ] `ai-context-builder.test.ts` — `usableItems` + `canUseItems` blocklist.
- [ ] `use-object-handler.test.ts` — EV comparison loses to better heal spell.

### Integration tests
- [ ] `inventory-transfer.integration.test.ts` — API atomicity + rollback + concurrent transfer (1 winner).
- [ ] `out-of-combat-cast.integration.test.ts` — Goodberry creates 10 berries.
- [ ] `app.test.ts` — existing inventory CRUD tests updated for UoW.

### E2E scenarios
- [ ] `druid/goodberry-create-and-eat.json`.
- [ ] `druid/goodberry-administer-unconscious.json`.
- [ ] `druid/goodberry-give-conscious.json`.
- [ ] `druid/goodberry-expires-long-rest.json`.
- [ ] `cleric/potion-administer-to-ally.json`.
- [ ] `fighter/draw-weapon-free-interaction.json`.
- [ ] `fighter/armor-equip-rejected-in-combat.json`.
- [ ] `monster/beast-companion-cannot-drink-potion.json`.
- [ ] `ai/ai-prefers-healing-word-over-goodberry.json`.

---

## Deferred
- Heroes' Feast / Create Food and Water (reuse `creates_item`).
- Spell scrolls (need spell's casting time as use cost).
- Poison weapon-coat (weapon-enhancement subsystem).
- Armor don/doff partial-turn accumulation.
- True in-world clock.
- Full out-of-combat spell cast pipeline (targeting, concentration, rituals, long casts).
- Goodberry RAW drift: 1 long rest ≈ 24h (documented).
- Give from/to hostile creatures.
- **Wild Shape / polymorph `canUseItems` override** (I-R2-5): when implemented, Wild Shape / polymorph must auto-set `sheet.flags.canUseItems = true` for beast-form druids. Added as a TODO comment in the AI context builder.

---

## SME Approval
- [x] EntityManagement-SME (Round 2 APPROVED)
- [x] SpellSystem-SME (Round 2 APPROVED)
- [x] CombatOrchestration-SME (Round 2 APPROVED)
- [x] ClassAbilities-SME / ActionEconomy (Round 1 APPROVED)
- [x] CombatRules-SME (Round 2 APPROVED)
- [x] AIBehavior-SME (Round 2 APPROVED)
- [x] Challenger (Round 2 STRONG — C-R2-1 + C-R2-2 + I-R2-1 incorporated)

## Status: APPROVED — READY TO IMPLEMENT
