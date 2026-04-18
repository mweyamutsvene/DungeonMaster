---
description: "Architecture and conventions for the InventorySystem flow: item entity models, equip/unequip flow, ground items, potion usage, magic item bonuses, weapon/armor catalogs, inventory API."
applyTo: "packages/game-server/src/infrastructure/api/routes/sessions/session-inventory.ts,packages/game-server/src/domain/entities/items/**,packages/game-server/src/application/services/entities/item-lookup-service.ts,packages/game-server/src/content/rulebook/equipment-parser.ts"
---

# InventorySystem Flow

## Purpose
Manages item lifecycle across all three DDD layers: domain entities for item data (weapons, armor, magic items, ground items), application service for item lookup with DB + catalog fallback, and infrastructure routes for the inventory REST API.

## File Responsibility Matrix

| File | ~Lines | Responsibility |
|------|--------|----------------|
| `infrastructure/api/routes/sessions/session-inventory.ts` | ~200 | GET/POST/DELETE/PATCH inventory REST endpoints |
| `domain/entities/items/inventory.ts` | ~100 | Inventory entity: item slots, weight/encumbrance tracking |
| `domain/entities/items/equipped-items.ts` | ~120 | EquippedItems: weapon/armor/shield with AC formulas |
| `domain/entities/items/ground-item.ts` | ~60 | Ground item: position on map, pickup/drop |
| `domain/entities/items/weapon-catalog.ts` | ~200 | Weapon definitions: all PHB weapons with properties |
| `domain/entities/items/armor-catalog.ts` | ~100 | Armor definitions: all PHB armor with AC formulas |
| `domain/entities/items/magic-item.ts` | ~80 | Magic item type: bonus, rarity, attunement |
| `domain/entities/items/magic-item-catalog.ts` | ~100 | Magic item catalog entries |
| `application/services/entities/item-lookup-service.ts` | ~100 | Item resolution: DB check → static catalog fallback |
| `content/rulebook/equipment-parser.ts` | ~150 | Parses equipment from rulebook markdown for DB import |

## Key Types/Interfaces

- `CharacterItemInstance` — runtime inventory item state: `equipped`, `attuned`, `currentCharges`, `quantity`, `slot` (the inventory IS `CharacterItemInstance[]`, there is no `Inventory` class)
- `EquippedItems` — currently equipped weapon/armor/shield, computes final AC
- `GroundItem` — item at a map position (dropped/found)
- `WeaponCatalogEntry` — weapon definition with properties (NOT `WeaponDefinition`)
- `ArmorCatalogEntry` — armor definition with AC formula (NOT `ArmorDefinition`)
- `MagicItemDefinition` — magic item definition with bonus (+1/+2/+3), rarity, attunement requirement (NOT `MagicItem`)
- `ItemLookupService` — resolves items by ID (DB → catalog fallback chain)

## Known Gotchas

- **Weapon properties directly affect combat mechanics** — finesse allows DEX for attack/damage, heavy gives Small creatures disadvantage, light enables dual-wielding, reach extends melee range to 10ft. These aren't just flavor text.
- **Magic item bonuses are additive** — a +1 longsword adds +1 to BOTH attack rolls and damage rolls. Don't apply it to only one.
- **Ground items persist on the combat map** — they have a position and remain at that position until picked up. Dropping an item creates a ground item at the creature's position.
- **Object Interaction economy** — drawing/sheathing one weapon is free per turn (uses `freeObjectInteractionUsed` flag). A second draw/sheathe in the same turn costs an action.
- **Item lookup service has a fallback chain** — checks the database first (for imported/custom items), then falls back to the static hardcoded catalog. Don't bypass the DB check.
