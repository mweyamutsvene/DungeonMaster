---
description: "Architecture and conventions for the InventorySystem flow: item entity models, equip/unequip flow, ground items, potion usage, magic item bonuses, weapon/armor catalogs, inventory API."
applyTo: "packages/game-server/src/infrastructure/api/routes/sessions/session-inventory.ts,packages/game-server/src/domain/entities/items/**,packages/game-server/src/application/services/entities/item-lookup-service.ts,packages/game-server/src/application/services/entities/inventory-service.ts,packages/game-server/src/application/services/combat/item-action-handler.ts,packages/game-server/src/application/services/combat/tabletop/dispatch/interaction-handlers.ts,packages/game-server/src/application/services/combat/tabletop/dispatch/attack-handlers.ts,packages/game-server/src/domain/rules/combat-map-items.ts,packages/game-server/src/content/rulebook/equipment-parser.ts"
---

# InventorySystem Flow

## Purpose
Manages item lifecycle across all three DDD layers: static item definitions and inventory helpers in the domain layer, item lookup and transfer logic in the application layer, and session inventory routes for out-of-combat inventory mutation. Combat-time pickup, drop, and use flows are adjacent and rely on these same item models plus combat-map state.

## File Responsibility Matrix

| File | ~Lines | Responsibility |
|------|--------|----------------|
| `infrastructure/api/routes/sessions/session-inventory.ts` | ~400 | Session inventory REST endpoints for list/add/remove/equip, consumable use, charge spending, and character-to-character transfer |
| `domain/entities/items/inventory.ts` | ~300 | Pure helpers over `CharacterItemInstance[]`: stacking, removal, consumable and charge use, attunement counts, expiry sweeps, magic weapon bonuses, and standalone weight/encumbrance utilities |
| `domain/entities/items/equipped-items.ts` | ~34 | Shared item/equipment types only; AC recomputation happens elsewhere |
| `domain/entities/items/ground-item.ts` | ~60 | Ground item data shape (position + item payload); pickup/drop behavior lives in combat handlers + combat-map item helpers |
| `domain/entities/items/weapon-catalog.ts` | ~200 | Weapon definitions: all PHB weapons with properties |
| `domain/entities/items/armor-catalog.ts` | ~100 | Armor definitions: all PHB armor with AC formulas |
| `domain/entities/items/magic-item.ts` | ~80 | Magic item type: bonus, rarity, attunement |
| `domain/entities/items/magic-item-catalog.ts` | ~100 | Magic item catalog entries |
| `application/services/entities/item-lookup-service.ts` | ~100 | Magic-item lookup plus wider equipment lookup across magic items, weapon catalog, and armor catalog |
| `content/rulebook/equipment-parser.ts` | ~150 | Parses rulebook markdown into import-time `WeaponDefinition` and `ArmorDefinition` records |

## Key Types/Interfaces

- `CharacterItemInstance` — runtime inventory item state: `equipped`, `attuned`, `currentCharges`, `quantity`, `slot` (the inventory IS `CharacterItemInstance[]`, there is no `Inventory` class)
- `EquippedItems` — armor and shield type definitions; AC recomputation happens in armor helpers, not here
- `GroundItem` — item at a map position (dropped/found)
- `WeaponCatalogEntry` / `ArmorCatalogEntry` — canonical runtime catalog entries used by combat and hydration
- `WeaponDefinition` / `ArmorDefinition` — import-time parsed rulebook records produced by `equipment-parser.ts`
- `MagicItemDefinition` — magic item definition with bonus (+1/+2/+3), rarity, attunement requirement (NOT `MagicItem`)
- `ItemLookupService.lookupItem()` — magic-item lookup only
- `ItemLookupService.lookupEquipment()` — tagged-union lookup across magic items, weapons, and armor

## Known Gotchas

- **Weapon properties directly affect combat mechanics** — finesse allows DEX for attack/damage, heavy gives Small creatures disadvantage, light enables dual-wielding, reach extends melee range to 10ft. These aren't just flavor text.
- **Magic item bonuses are additive** — a +1 longsword adds +1 to BOTH attack rolls and damage rolls. Don't apply it to only one.
- **Ground items persist on the combat map** — they have a position and remain at that position until picked up. Dropping an item creates a ground item at the creature's position.
- **Object Interaction economy** — drawing or sheathing one weapon is free per turn through the `objectInteractionUsed` combat resource flag. Combat-time enforcement lives in the tabletop item handlers, not the inventory REST routes.
- **Item lookup is split by intent** — `lookupItem()` is magic-item-first lookup, while `lookupEquipment()` widens to magic items, then static weapon and armor catalogs. Don't flatten those paths mentally.
- **Encumbrance helpers are utilities, not full runtime enforcement** — `inventory.ts` exposes 2024 carrying-capacity and encumbrance helpers, but routes and combat do not automatically enforce them today.
- **Inventory lifecycle includes more than add/remove** — the current flow also handles temporary-item expiry (`longRestsRemaining`), atomic character-to-character transfer, and equipped magic-weapon bonus resolution from inventory data.
- **Equip/unequip routes currently do not enforce proficiency gates** — equipment state changes and AC recomputation proceed without class proficiency validation in route handlers today.

## API Docs Alignment

- Canonical client API docs live in `docs/api/` (README + reference + guides).
- When changing routes, payloads, errors, events, or client integration loops, update the matching files in `docs/api/reference/` and `docs/api/guides/` in the same change.
- For SME research, agent reviews, and implementation plans that affect client contracts, cite and update the impacted docs under `docs/api/`.
- Treat these docs as done criteria for contract changes: `docs/api/reference/endpoints.md`, `docs/api/reference/schemas.md`, `docs/api/reference/events.md`, and `docs/api/reference/errors.md`.
