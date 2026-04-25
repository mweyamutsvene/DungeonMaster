# InventorySystem — Quick Constraints

Speak caveman. Keep short.

## Scope
`domain/entities/items/` data models and catalogs.

## Laws
1. This layer is entities/data only. No services, no HTTP.
2. Catalogs are static reference; DB lookup first, catalog fallback second.
3. Weapon properties drive mechanics. Use `weapon-properties.ts`, not weapon-name branching.
4. Equipped data is not inventory data. Keep transition explicit.
5. Magic bonuses are additive (attack and damage).
6. Ground item live on combat map. Inventory files define shape. Combat map + tabletop handler do drop and pickup work.
7. Encumbrance helper here. Not full runtime police yet. Object interaction spend tracked in combat resource as `objectInteractionUsed`.
8. `equipped-items.ts` only hold types. `armor-catalog.ts` recompute real AC from equipped inventory.
