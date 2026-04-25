# SME Research — InventorySystem — Doc Accuracy Check

## Scope
- Files read:
  - `.github/instructions/inventory-system.instructions.md` (1-38)
  - `packages/game-server/src/domain/entities/items/CLAUDE.md` (1-15)
  - `packages/game-server/src/infrastructure/api/routes/sessions/session-inventory.ts` (1-404)
  - `packages/game-server/src/domain/entities/items/inventory.ts` (1-313)
  - `packages/game-server/src/domain/entities/items/equipped-items.ts` (1-34)
  - `packages/game-server/src/domain/entities/items/ground-item.ts` (1-47)
  - `packages/game-server/src/domain/entities/items/weapon-catalog.ts` (1-260)
  - `packages/game-server/src/domain/entities/items/armor-catalog.ts` (1-256)
  - `packages/game-server/src/domain/entities/items/magic-item.ts` (1-260)
  - `packages/game-server/src/domain/entities/items/magic-item-catalog.ts` (1-260)
  - `packages/game-server/src/application/services/entities/item-lookup-service.ts` (1-77)
  - `packages/game-server/src/application/services/entities/inventory-service.ts` (1-280)
  - `packages/game-server/src/content/rulebook/equipment-parser.ts` (1-260)
  - Adjacent behavior checks: `application/services/combat/tabletop/dispatch/interaction-handlers.ts` (1-360), `application/services/combat/tabletop/dispatch/attack-handlers.ts` (1-220), `application/services/combat/item-action-handler.test.ts` (1-220), `infrastructure/api/potion-effects.integration.test.ts` (1-220)
- Task context: verify whether the InventorySystem instruction doc and items CLAUDE doc still match current source and nearby runtime behavior.

## Current Truth
- Inventory is still stored as `CharacterItemInstance[]`, but the flow is broader than basic add/remove. `inventory.ts` now covers stacking, attunement counts, consumable use, charge use, expiry sweeps for runtime-created items, magic weapon bonus resolution, and standalone weight/encumbrance helpers.
- `session-inventory.ts` is no longer just GET/POST/DELETE/PATCH. It also supports out-of-combat consumable use, charge spending, and character-to-character transfer via `InventoryService.transferItem()`.
- `equipped-items.ts` is type-only. AC recomputation and magic armor/shield handling live in `armor-catalog.ts` via `recomputeArmorFromInventory()`.
- `ItemLookupService` has two distinct behaviors:
  - `lookupItem()` is magic-item-only: DB by id/name, then static magic catalog.
  - `lookupEquipment()` widens to magic items, then static weapon catalog, then static armor catalog, and returns a tagged union.
- Ground items do persist on the combat map, but that behavior is enforced through combat-map storage and tabletop handlers, not by the InventorySystem files alone.
- Object interaction tracking uses the `objectInteractionUsed` resource flag. I found no `freeObjectInteractionUsed` field in current code.
- Encumbrance support exists only as helper functions in `inventory.ts` (`getTotalWeight`, `getCarryingCapacity`, `getEncumbranceLevel`, `isEncumbered`). I found no current wiring from those helpers into route validation, hydration, or combat penalties.
- I found no proficiency validation in the inventory route or item entity layer that blocks equipping armor or shields based on training.
- Out-of-combat `POST .../inventory/:itemName/use` is narrower than the docs imply: it supports consumable use for potions and applies healing/temp HP there. Rich combat-time item effects and action-cost enforcement happen in the combat item handlers instead.

## Drift Findings
1. `.github/instructions/inventory-system.instructions.md` overstates the route surface in the file matrix.
   - The route file now owns `use-charge`, `use`, and `transfer` endpoints too.

2. The same instruction doc is inaccurate about key type names.
   - It says `WeaponCatalogEntry` is the parser/canonical definition and explicitly says “NOT `WeaponDefinition`”. Current code still exports `WeaponDefinition` and `ArmorDefinition` from `equipment-parser.ts`; those names are real and used for parsed rulebook import data.

3. The instruction doc understates the lookup-service contract.
   - “Item resolution: DB check → static catalog fallback” is only fully true for magic items. Equipment lookup is split between `lookupItem()` and `lookupEquipment()`.

4. The instruction doc is stale on object-interaction terminology.
   - It names `freeObjectInteractionUsed`; runtime code uses `objectInteractionUsed`.

5. The instruction doc risks misleading readers on encumbrance.
   - The file matrix says `inventory.ts` handles “weight/encumbrance tracking”, but current code only provides helper functions. No tracking/enforcement path was found in this flow.

6. The instruction doc does not mention newer inventory lifecycle behavior.
   - Missing today: transfer flow, expiry sweeps for temporary items like Goodberry, and magic weapon bonus helpers on equipped inventory.

7. `packages/game-server/src/domain/entities/items/CLAUDE.md` is materially inaccurate on “no services, no HTTP” only if read too literally for the whole flow.
   - As written it is scoped to `domain/entities/items/`, so this is mostly fine. The bigger issue is omission: it does not warn that encumbrance helpers are utilities only, and it implies object-interaction consistency as if this domain folder enforces it.

8. The SME-mode “known constraint” about proficiency validation does not match current InventorySystem source.
   - I found `ArmorTraining` as a type only, but no equip-time validation in the inventory route/service layer. This is a code-vs-doc gap worth flagging, even though it is outside the two target docs.

## Recommended Doc Edits
- For `.github/instructions/inventory-system.instructions.md`, replace the Purpose paragraph with:
  - `Manages item lifecycle across all three DDD layers: static item definitions and inventory helpers in the domain layer, item lookup and transfer logic in the application layer, and session inventory routes for out-of-combat inventory mutation. Combat-time pickup/drop/use flows are adjacent and rely on these same item models plus combat-map state.`

- For `.github/instructions/inventory-system.instructions.md`, replace the file matrix rows for the core files with:
  - `session-inventory.ts — Session inventory REST endpoints for list/add/remove/equip, consumable use, charge spending, and character-to-character transfer.`
  - `inventory.ts — Pure helpers over CharacterItemInstance[]: stacking, removal, consumable/charge use, attunement counts, expiry sweeps, equipped-item queries, magic weapon bonuses, and standalone weight/encumbrance utilities.`
  - `equipped-items.ts — Shared item/equipment types only; AC recomputation happens elsewhere.`
  - `item-lookup-service.ts — Magic-item lookup (DB -> static magic catalog) plus wider equipment lookup (magic -> weapon catalog -> armor catalog).`
  - `equipment-parser.ts — Parses rulebook markdown into import-time WeaponDefinition and ArmorDefinition records.`

- For `.github/instructions/inventory-system.instructions.md`, replace the Key Types/Interfaces section with:
  - `CharacterItemInstance — runtime inventory state stored on character sheets and copied into combat resources.`
  - `GroundItem — combat-map item with position plus either weaponStats or inventoryItem payload.`
  - `WeaponCatalogEntry / ArmorCatalogEntry — canonical runtime catalog entries used by combat and hydration.`
  - `WeaponDefinition / ArmorDefinition — import-time parsed rulebook records produced by equipment-parser.ts.`
  - `MagicItemDefinition — static or DB-backed magic item definition.`
  - `ItemLookupService.lookupItem() — magic-item lookup only.`
  - `ItemLookupService.lookupEquipment() — tagged union lookup across magic items, weapons, and armor.`

- For `.github/instructions/inventory-system.instructions.md`, replace the Object Interaction bullet with:
  - `Object interaction tracking uses the combat resource flag objectInteractionUsed. Inventory docs should describe the rule, but combat-time enforcement lives in the tabletop item handlers rather than the inventory REST routes.`

- For `.github/instructions/inventory-system.instructions.md`, add this encumbrance note:
  - `inventory.ts includes 2024 carrying-capacity and encumbrance helper functions, but this flow does not currently enforce encumbrance automatically in routes or combat. Describe these as utilities unless/until they are wired into runtime state.`

- For `.github/instructions/inventory-system.instructions.md`, add this missing capability note:
  - `Current inventory lifecycle also includes temporary-item expiry (` + "`longRestsRemaining`" + `), atomic character-to-character transfer via InventoryService, and equipped magic-weapon bonus resolution from inventory data.`

- For `packages/game-server/src/domain/entities/items/CLAUDE.md`, keep the existing tone but replace Laws 6-7 with caveman wording:
  - `6. Ground item live on combat map. Inventory files define shape. Combat map + tabletop handler do drop and pickup work.`
  - `7. Encumbrance helper here. Not full runtime police yet. Object interaction spend tracked in combat resource as objectInteractionUsed.`

- Optional addition for `packages/game-server/src/domain/entities/items/CLAUDE.md`:
  - `8. Equipped-items file only hold types. Armor-catalog recompute actual AC from equipped inventory.`

- Mermaid value:
  - `Not materially needed right now. The main drift is wording drift, not control-flow confusion. A tiny diagram could help only if the instruction doc wants to show the split between out-of-combat inventory routes, application transfer/lookup services, and combat-time map/item handlers, but that is optional rather than necessary.`