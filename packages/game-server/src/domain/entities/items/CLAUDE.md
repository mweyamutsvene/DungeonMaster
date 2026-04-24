# InventorySystem — Architectural Constraints

## Scope
`domain/entities/items/` — item entity models, weapon/armor/magic catalogs, equipment/inventory types. Consumed by `infrastructure/api/routes/sessions/session-inventory.ts`, `application/services/entities/item-lookup-service.ts`, and combat resolvers (attack damage bonuses, AC computation).

## Laws
1. **Entities only, no services** — this directory holds pure item data and the functions that transform it. Repository access and HTTP routing live outside.
2. **Catalogs are static, DB is authoritative** — `weapon-catalog.ts`, `armor-catalog.ts`, `magic-item-catalog.ts` provide the reference definitions. `item-lookup-service.ts` queries the DB first and falls back to the catalog. Keep catalog entries in sync with content parsed out of `content/rulebook/equipment-parser.ts`.
3. **Weapon properties drive combat** — `weapon-properties.ts` defines finesse / heavy / light / two-handed / versatile / thrown / reach. Attack resolvers consume these flags; do not branch on weapon names.
4. **Equipped state is separate from inventory** — `equipped-items.ts` models currently worn/wielded items for AC and attack math; `inventory.ts` holds the full backpack. Equip/unequip is a transition between the two.
5. **Magic item bonuses are additive** — a +1 weapon contributes to both attack and damage rolls via the equipped-items layer; magic items must declare bonuses in the catalog rather than having consumers look them up by name.
6. **Ground items live on the combat map** — `ground-item.ts` is the domain type; persistence and pickup flow through `combat-map-items.ts` under `domain/rules/`. Changes to ground-item shape ripple there.
7. **D&D 5e 2024 rules** — encumbrance = STR × 15 lbs; object interactions are free once per turn (draw/sheathe) and cost an action beyond that.
