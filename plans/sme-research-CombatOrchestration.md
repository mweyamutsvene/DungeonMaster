# SME Research — CombatOrchestration — useItem / giveItem / equipItem in combat

## Scope
- Files read:
  - [interaction-handlers.ts](packages/game-server/src/application/services/combat/tabletop/dispatch/interaction-handlers.ts) (~690 lines; pickup/drop/draw/sheathe/useItem)
  - [action-dispatcher.ts](packages/game-server/src/application/services/combat/tabletop/action-dispatcher.ts) L250–620 (command-kind switch + parser chain #14–18)
  - [combat-text-parser.ts](packages/game-server/src/application/services/combat/tabletop/combat-text-parser.ts) L455–525 (5 item parsers)
  - [game-command.ts](packages/game-server/src/application/commands/game-command.ts) L30–120 (command-type union)
  - [action-service.ts](packages/game-server/src/application/services/combat/action-service.ts) L1–400 (programmatic facade)
  - [action-handlers/](packages/game-server/src/application/services/combat/action-handlers) (attack, grapple, skill — no item handler)
  - [session-actions.ts](packages/game-server/src/infrastructure/api/routes/sessions/session-actions.ts) (programmatic route)
  - [session-inventory.ts](packages/game-server/src/infrastructure/api/routes/sessions/session-inventory.ts) L285–360 (out-of-combat `POST …/use`)
  - [event-repository.ts](packages/game-server/src/application/repositories/event-repository.ts) L51–60 (`InventoryChanged`)
  - [use-object-handler.ts](packages/game-server/src/application/services/combat/ai/handlers/use-object-handler.ts) (AI parallel)

## Current State

### 1. Item-interaction handlers already exist in `InteractionHandlers`
`InteractionHandlers` owns five verbs, all wired through the tabletop pipeline:

| Method | Line | Cost enforced | Notes |
|---|---|---|---|
| `handlePickupAction` | L59 | Free Object Interaction; errors if `objectInteractionUsed`; sets `objectInteractionUsed: true` | Weapons → `resources.pickedUpWeapons` + `drawnWeapons`; other items → `resources.inventory` via `addInventoryItem` |
| `handleDropAction` | L170 | No cost (2024 RAW) | Removes from `pickedUpWeapons` or sheet attacks; writes `GroundItem` to map |
| `handleDrawWeaponAction` | L267 | Free interaction → upgrades to **Utilize action** (`actionSpent`) if free already spent (L323–342) | Two-tier cost pattern |
| `handleSheatheWeaponAction` | L367 | Same two-tier (L400–418) | |
| `handleUseItemAction` | L447 | **Action only** (L468 check, L613 write) — no branching | Uses `lookupMagicItem` + `potionEffects`; applies healing/damage/tempHp/effects/conditions |

**`handleGiveItemAction` does not exist.** No references to `giveItem`, `handOff`, `transferItem`, or "give … to ally" anywhere in `application/services/combat/**`. Mid-combat armor equip/swap also absent — `equip` only exists out-of-combat via `PATCH …/inventory/:item` in [session-inventory.ts](packages/game-server/src/infrastructure/api/routes/sessions/session-inventory.ts) L232.

### 2. Parser + dispatcher wiring (two entry paths → one switch)

Both LLM-intent and text-parser paths converge on `ActionDispatcher.dispatch()`:

**Command-kind union** ([game-command.ts](packages/game-server/src/application/commands/game-command.ts) L118–120):
```ts
export type PickupCommand      = { kind: "pickup"; itemName: string };
export type DropCommand        = { kind: "drop"; itemName: string };
export type DrawWeaponCommand  = { kind: "drawWeapon"; weaponName: string };
// + SheatheWeaponCommand, UseItemCommand
```

**Command-kind switch** ([action-dispatcher.ts#L271-L287](packages/game-server/src/application/services/combat/tabletop/action-dispatcher.ts#L271-L287)):
```ts
if (command.kind === "pickup")        return this.interactionHandlers.handlePickupAction(...)
if (command.kind === "drop")          return this.interactionHandlers.handleDropAction(...)
if (command.kind === "drawWeapon")    return this.interactionHandlers.handleDrawWeaponAction(...)
if (command.kind === "sheatheWeapon") return this.interactionHandlers.handleSheatheWeaponAction(...)
if (command.kind === "useItem")       return this.interactionHandlers.handleUseItemAction(...)
```

**Parser chain** ([action-dispatcher.ts#L556-L599](packages/game-server/src/application/services/combat/tabletop/action-dispatcher.ts#L556-L599)) — entries #14–18. Entry #18 (`useItem`) has a class-ability guard:
```ts
tryParse: (text) => {
  const stripped = text.replace(/^(?:use|try)\s+/i, "");
  if (stripped !== text && tryMatchClassAction(stripped, profiles)) return null;
  return tryParseUseItemText(text);
},
```
so "use flurry of blows" routes to classAction, not item use.

**Parsers** ([combat-text-parser.ts](packages/game-server/src/application/services/combat/tabletop/combat-text-parser.ts) L455–523):
- `tryParsePickupText`: `/pick\s*up|grab|take|collect|retrieve/` → `{ itemName }`
- `tryParseDropText`: `/drop|put\s*down|discard|release|let\s*go|toss\s*aside/`
- `tryParseDrawWeaponText`: `/draw|unsheathe?|pull\s*out|ready/` → `{ weaponName }`
- `tryParseSheatheWeaponText`: `/sheathe?|stow|put\s*away|holster/`
- `tryParseUseItemText`: `/use|drink|consume|quaff|take/` → `{ itemName }` ("take" ambiguous with pickup — pickup is earlier in chain so wins)

### 3. Action-economy signaling is ad-hoc, handler-internal
There is **no parser-level or dispatcher-level flag** saying "this consumes X". Each handler writes directly to `combatant.resources`:

- **Action cost** — read `resources.actionSpent` via `readBoolean` → throw if set → persist `actionSpent: true` (useItem L468/L613)
- **Free Object Interaction** — read `objectInteractionUsed` → throw or upgrade → persist `objectInteractionUsed: true` (pickup L99–104/L129)
- **Two-tier upgrade** — if free used but action free, charge action (draw/sheathe L323–342)
- **Bonus actions** — only `ClassAbilityHandlers.handleBonusAbility` (L573) and its executors write bonus-action flags. It pre-checks via `hasBonusActionAvailable(resources)` (L589–594) from `helpers/resource-utils.ts` and defers consumption to the class executor. **No `InteractionHandlers` method currently consumes a bonus action** — goodberry-as-bonus-action would be the first.

### 4. Programmatic path has NO item surface
[action-service.ts](packages/game-server/src/application/services/combat/action-service.ts) (L59–75) is a thin facade delegating to 3 handlers. Public methods: `attack`, `dodge`, `dash`, `disengage`, `hide`, `search`, `help`, `castSpell`, `shove`, `grapple`, `move`. **No `useItem` / `pickup` / `drawWeapon` / `giveItem`.** No fourth "item-action-handler" file exists.

[session-actions.ts](packages/game-server/src/infrastructure/api/routes/sessions/session-actions.ts) `POST /sessions/:id/actions` accepts body kinds `endTurn | attack | classAbility | help` only. For `classAbility` it **funnels text through `deps.tabletopCombat.parseCombatAction()`** (L122–128) rather than calling ActionService — so programmatic ability use reuses the tabletop handler path. A programmatic `useItem`/`giveItem` today could piggyback on the same pattern without a new ActionService method.

### 5. Out-of-combat `POST …/inventory/:itemName/use` ([session-inventory.ts](packages/game-server/src/infrastructure/api/routes/sessions/session-inventory.ts) L295–360)
- Reads from `char.sheet.inventory`
- Looks up def via `deps.itemLookup.lookupItem(...)` (async, DB-backed) — **contrast** with in-combat handler which uses sync `lookupMagicItem` from `magic-item-catalog.ts`
- Gates on `potionEffects || category === "potion"`
- Calls `useConsumableItem(inventory, itemName)` → writes `sheet.currentHp`, `sheet.tempHp`, `sheet.inventory`
- Emits `InventoryChanged` via `emitInventoryChanged` (L355–360)

**Reuse verdict**: the mechanics are ~80% duplicated between this route and `handleUseItemAction()`. Both call `useConsumableItem`, apply healing + tempHp. They differ in:
- Storage (`char.sheet.*` vs `combatant.resources.*` + `combatant.hpCurrent`)
- Action-economy (in-combat only)
- Effect scope (in-combat also handles `ActiveEffects`, `applyConditions`, `removeConditions`; out-of-combat only healing + tempHp)
- Event emission (in-combat: none; out-of-combat: `InventoryChanged`)
- Lookup API (async DB vs sync catalog)

**No shared domain helper exists.** To dedupe cleanly, extraction into e.g. `domain/entities/items/potion-application.ts` or `application/services/entities/item-usage-service.ts` is required. AI parallel path in [use-object-handler.ts](packages/game-server/src/application/services/combat/ai/handlers/use-object-handler.ts) is a **third copy** of the same apply-potion logic (L56–103).

### 6. Events for inventory changes
Single event type: `InventoryChanged` ([event-repository.ts#L51-L57](packages/game-server/src/application/repositories/event-repository.ts#L51-L57)):
```ts
export interface InventoryChangedPayload {
  characterId: string;
  characterName: string;
  action: "add" | "remove" | "equip" | "use-charge" | "use";
  itemName: string;
}
```
- Emitted **only** by out-of-combat `session-inventory.ts` routes (via `emitInventoryChanged`).
- **NOT emitted** by any `InteractionHandlers` method or `UseObjectHandler` — in-combat item use/pickup/drop is invisible to the event stream. Results carry text only in `SIMPLE_ACTION_COMPLETE.message`.
- No `"give" | "transfer"` action value; payload has no `recipientId` field. Adding both is a one-line union extension plus one optional field, but requires touching the out-of-combat call sites for type consistency.

## Integration Points for new actions

| New verb | Command kind | Parser | Handler | Action-economy write |
|---|---|---|---|---|
| **useItem** (potion drink) | `useItem` **(exists)** | `tryParseUseItemText` **(exists)** | `handleUseItemAction` **(exists, Action)** | `actionSpent = true` |
| **useItem bonus (goodberry)** | `useItem` currently always charges Action | No parser change | **Extend** `handleUseItemAction` to branch on `itemDef.actionCost` (`"action" \| "bonus"`) before economy check | conditional `actionSpent` vs bonus-action resource key |
| **giveItem** | **Missing** — add `GiveItemCommand = { kind: "giveItem"; itemName; recipient: CombatantRef }` | **Missing** — add `tryParseGiveItemText` (matches `/give\|hand\|toss/` + "to <name>"); must sit BEFORE `tryParseUseItemText` in chain | **Missing** — new `handleGiveItemAction` in `InteractionHandlers`; needs ally lookup via roster, 5 ft range check, inventory transfer between two combatants | `actionSpent` (Utilize action for unready recipient) |
| **equipItem** (mid-combat swap) | **Missing** | **Missing** | **Missing** — needs `recomputeArmorFromInventory` + AC propagation to `combatant.resources.ac` | `actionSpent` (Utilize) |
| **Free draw** (part of Attack) | `drawWeapon` **(exists)** | `tryParseDrawWeaponText` **(exists)** | `handleDrawWeaponAction` **(exists, free→Utilize cascade)** | `objectInteractionUsed` then `actionSpent` |

## Constraints & Invariants
1. Tabletop actions return `ActionParseResult`; non-roll actions use `SIMPLE_ACTION_COMPLETE` shape.
2. Handlers persist via `deps.combatRepo.updateCombatantState(id, { resources, ... })`. Only drop-from-sheet-attacks (L222) mutates `sheet` — in-combat state otherwise lives on combatant resources.
3. Action-economy keys MUST be read via `readBoolean(resources, ...)` / `hasBonusActionAvailable()` from `helpers/resource-utils.ts`, never raw property access.
4. Parser chain order is load-bearing — pickup before useItem (both match "take"); a new `giveItem` parser MUST precede `tryParseUseItemText` so "give X to Y" doesn't misparse as useItem.
5. Any new `use*`/`utilize*` verb must apply the entry-#18 `tryMatchClassAction` guard or class abilities using "use" will route to item use.
6. `handleUseItemAction` and AI `UseObjectHandler` and out-of-combat `POST …/use` are three parallel implementations of the same potion-apply logic — any semantic change (e.g., goodberry bonus-action) must propagate to all three OR be refactored first.
7. `InventoryChanged` payload is flat — no recipient slot today.

## Risks
1. **Action-economy key drift** — pickup uses `objectInteractionUsed`, draw/sheathe cascade to `actionSpent`, useItem only `actionSpent`. **No `InteractionHandlers` method writes a bonus-action key today.** Before adding bonus-action goodberry, confirm the exact key name (`bonusActionUsed` vs `bonusActionSpent`) used by `handleBonusAbility` and `hasBonusActionAvailable` — drift will silently break action-economy checks.
2. **Triplicate potion logic** — without a shared helper, goodberry ships to 3 places.
3. **`giveItem` range/reach** — no combatant-to-combatant reach helper exists in `InteractionHandlers`. Pickup uses `getGroundItemsNearPosition(map, pos, 5)`; give would need similar distance logic via `getPosition()` on both combatants.
4. **Event-stream fidelity** — if mid-combat use/give must be visible on SSE, either start emitting `InventoryChanged` from `InteractionHandlers` (and AI `UseObjectHandler`), or accept message-only visibility. Today it's message-only.
5. **No programmatic surface** — `POST /sessions/:id/actions` has no item-interaction body-kind. Programmatic item use must either (a) add a new body-kind + new ActionService method, or (b) piggyback on the `classAbility`-over-`parseCombatAction` pattern (L122–128). Pattern (b) requires no new surface.

## Recommendations (document-only — no design)
1. **useItem exists** — no new handler needed for the basic drink-potion verb. A bonus-action variant (goodberry) is a one-branch extension of `handleUseItemAction`, keyed off an item-definition flag, not a new parser or new command kind.
2. **giveItem is net-new** — requires a new `GiveItemCommand`, a new parser (inserted before `tryParseUseItemText`), and a new `handleGiveItemAction` in `InteractionHandlers`. Shape symmetric to `handlePickupAction` (range check + dual-combatant resource write).
3. **equipItem in combat** is the highest-risk — touches `recomputeArmorFromInventory` and combatant AC. Defer unless explicitly required.
4. **Shared potion helper** should be extracted before goodberry to avoid a third copy across in-combat / out-of-combat / AI.
5. **Do NOT add methods to `ActionService`** for item interactions unless non-text programmatic use is required — the `classAbility` pattern demonstrates how programmatic routes reuse tabletop handlers via `parseCombatAction`.
6. **`InventoryChanged` extension** — if in-combat visibility is wanted, extend the payload action union with `"give"` and add optional `recipientId`/`recipientName`, then emit from `InteractionHandlers` and `UseObjectHandler` at the same time.

