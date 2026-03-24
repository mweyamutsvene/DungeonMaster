# Plan: Equipment & Inventory System — Phase 11

## Overview

The equipment system is currently minimal — combat resolves weapons via a pre-computed `attacks`
array on character sheets, and AC uses an `EquippedItems` interface. There is no runtime inventory
tracking, equip/unequip actions, or item management.

## Current State

| Component | Status | Notes |
|-----------|--------|-------|
| `Item`, `Weapon`, `Armor`, `Equipment` classes | Stub | name + weightLb only |
| `EquippedItems` interface | Works | Used for AC calculation |
| Character `attacks[]` array | Works | Pre-computed attack bonus + damage dice |
| LLM character `equipment[]` | Flavor only | `{ name, type, quantity }` — not mechanically tracked |
| Weapon properties | Partial | `properties: string[]` on some attacks (e.g., "finesse", "heavy", "thrown") |
| Runtime inventory | **Missing** | No equip/unequip, no item slots |
| API endpoints | **Missing** | No inventory management endpoints |

## Assessment

**The current system works well for combat.** The `attacks[]` array is deterministic and avoids
complex weapon-to-stat derivation at runtime. Enriching the equipment system is primarily needed for:

1. **Weapon property validation** — TWF light check, Heavy+Small, Loading, Thrown all read `properties`
2. **Magic items** — bonus damage, extra effects, attunement
3. **Out-of-combat play** — item use, loot, shopping
4. **Multi-weapon scenarios** — equipping/switching weapons mid-combat

## Items (ordered by combat relevance)

### Tier 1 — Enrich Attack Properties (Small)

| # | Feature | Description |
|---|---------|-------------|
| 1 | Ensure `properties[]` on all attacks | Standardize finesse, light, heavy, thrown, loading, versatile, reach, two-handed on character sheet attacks |
| 2 | Weapon lookup table | Map weapon name → canonical properties (domain helper) |
| 3 | Consistent property checking | All property-dependent code (TWF, Heavy, Loading, Thrown, Versatile) reads from a single source |

### Tier 2 — Weapon Switching (Medium)

| # | Feature | Description |
|---|---------|-------------|
| 4 | Draw/sheathe weapons | Action economy cost for switching weapons (free object interaction: draw OR sheathe) |
| 5 | Multiple weapon sets | Character tracks current "equipped weapons" vs "stowed weapons" |
| 6 | `equip` command parser | "equip longsword", "draw shortbow" text parsing |

### Tier 3 — Full Inventory (Large)

| # | Feature | Description |
|---|---------|-------------|
| 7 | Inventory entity | `InventoryItem { name, type, quantity, equipped, attuned }` |
| 8 | API endpoints | `GET/POST /sessions/:id/characters/:charId/inventory` |
| 9 | Item use action | "use potion of healing" → consume item, apply effect |
| 10 | Loot system | Items from defeated monsters added to inventory |
| 11 | Magic item properties | +1/+2/+3 weapons, bonus effects, attunement slots (max 3) |

## Recommendation

**Tier 1** should be done alongside class features (Phase 8) since many features depend on weapon
properties being consistently available. **Tier 2-3** are lower priority and mainly serve
out-of-combat play.

## Complexity

Small for Tier 1, Medium for Tier 2, Large for Tier 3.

---

## Implementation Notes (Completed)

### Tier 1 — COMPLETE

All three Tier 1 items implemented:

1. **Weapon lookup table** (`domain/entities/items/weapon-catalog.ts`)
   - 38 standard D&D 5e weapons with full properties, damage dice, ranges, mastery, ammunition types
   - `lookupWeapon(name)`, `getAllWeapons()`, `hasWeaponProperty()`, `getWeaponProperties()`
   - Thrown range utilities: `parseThrownRange()`, `getWeaponThrownRange()`

2. **Consistent property checking** (`domain/entities/items/weapon-properties.ts`)
   - Centralized `hasProperty()` + 9 convenience functions (isFinesse, isLight, isHeavy, isThrown, isLoading, isReach, isVersatile, isTwoHanded, usesAmmunition)
   - Case-insensitive, handles embedded data in property strings (e.g., "Thrown (20/60)")
   - Migrated 4 existing files from ad-hoc patterns: `attack-resolver.ts`, `rogue.ts`, `combatant-resolver.ts`, `roll-state-machine.ts`

3. **Armor catalog** (`domain/entities/items/armor-catalog.ts`)
   - 12 standard armor types with AC formulas, strength requirements, stealth penalties
   - Reuses existing `EquippedArmorClassFormula` type

### Bonus: Magic Item Foundation

Implemented ahead of Tier 3 since the type system was needed to design Tier 1 correctly:

4. **Magic item type system** (`domain/entities/items/magic-item.ts`)
   - `MagicItemDefinition` with stat modifiers, granted abilities, granted spells, on-hit effects, charges, attunement, damage modifiers
   - `CharacterItemInstance` for runtime state tracking (charges remaining, attuned, equipped slot)
   - 13 equipment slots, rarity tiers, item categories

5. **Magic item catalog** (`domain/entities/items/magic-item-catalog.ts`)
   - 9 built-in items: Flame Tongue, Frost Brand, Cloak of Protection, Amulet of Health, Staff of Fire, Adamantine Armor, +1 Shield, Boots of Speed, +1 Ammunition
   - Factory functions: `bonusWeapon(bonus, baseWeapon)`, `bonusArmor(bonus, baseArmor)` for generic +N items

### Test Coverage

- 45 unit tests in `domain/entities/items/equipment.test.ts` covering all catalogs, property helpers, and magic items
- Full unit test suite: 503 passed, 0 regressions

### E2E Test Harness Scenarios

3 new E2E scenarios added to validate the weapon property migration at the integration level:

1. **`core/finesse-dex-resolution.json`** — DEX-focused Rogue with rapier (finesse): validates attack resolver uses DEX modifier when DEX > STR
2. **`mastery/topple-finesse-dc.json`** — DEX-focused Fighter with finesse trident + topple mastery: validates save DC uses max(STR, DEX) = DEX (DC 15 vs DC 11 if STR was used). Fills the gap where push/topple mastery DC code path had zero E2E coverage for finesse weapons.
3. **`rogue/sneak-attack-non-finesse-blocked.json`** — Rogue with mace (non-finesse melee) + ally adjacent: validates sneak attack damage is NOT applied (damage = 1d6+1 weapon only, not 1d6+3d6+1). Negative test for `isFinesse()` gate in rogue sneak attack eligibility.

- Full E2E suite: 131 scenarios passed, 0 failed

### What's Left

~~**Tier 2** (weapon switching): Draw/sheathe action economy, multiple weapon sets, equip command parser~~ ✅ COMPLETE
~~**Tier 3** (full inventory): Inventory entity, API endpoints, item use, loot, magic item runtime integration~~ ✅ COMPLETE
~~Integration with combat: wire `lookupWeapon()` into character generation so `attacks[]` always has canonical properties~~ ✅ COMPLETE
~~Integration with AC calculation: wire `lookupArmor()` into equipped item AC derivation~~ ✅ COMPLETE

**Phase 11 fully complete.**

---

### Tier 2 — COMPLETE

All three Tier 2 items implemented:

4. **Draw/sheathe weapons** — D&D 5e 2024 Object Interaction action economy
   - `drawnWeapons: string[]` tracked in combatant resources
   - At combat start, all character weapons auto-drawn (from `sheet.attacks`)
   - Drawing a weapon costs the Free Object Interaction (one per turn)
   - Sheathing a weapon costs the Free Object Interaction (one per turn)
   - Second interaction same turn costs the Utilize action (standard action)
   - If both interaction and action are spent, draw/sheathe is blocked until next turn

5. **Multiple weapon sets** — `drawnWeapons` tracked across turns

6. **Equip command parser** — `tryParseDrawWeaponText()` / `tryParseSheatheWeaponText()` in combat-text-parser.ts

- Unit tests: 503 passed, 0 regressions
- E2E scenarios: 134 passed (131 existing + 3 new), 0 failed

---

### Final Integration — COMPLETE

Both remaining integration items implemented:

#### Wire `lookupWeapon()` into character generation ✅
- `enrichAttackProperties(attack)` in `weapon-catalog.ts`: looks up weapon name in catalog, adds `properties`, `mastery`, `versatileDamage` if missing on the attack
- `enrichSheetAttacks(sheet)` in `weapon-catalog.ts`: maps over `sheet.attacks[]` applying `enrichAttackProperties`
- Wired into `CharacterService.addCharacter()` — enrichment happens at persist time so the stored sheet always has canonical properties regardless of what the client sends
- Player-CLI: Added canonical properties to Fighter (Longsword: versatile/sap) and Rogue (Shortsword: finesse+light/vex) hardcoded attacks

#### Wire `lookupArmor()` into AC derivation ✅
- `deriveACFromArmor(armorName, dexMod, hasShield)` in `armor-catalog.ts`: computes AC from catalog formula (base + capped DEX modifier + optional shield +2)
- `enrichSheetArmor(sheet)` in `armor-catalog.ts`: finds armor/shield in `sheet.equipment[]`, adds `equippedArmor` field with catalog data
- Wired into `CharacterService.addCharacter()` alongside weapon enrichment

#### Design decision
Enrichment at **persist time** (in `addCharacter`) rather than runtime. This means the DB-stored sheet always has canonical properties, which is cleaner than scattered runtime fallbacks. All 137 E2E scenarios pass without modification since the enrichment only fills in missing data.

#### Test results
- Typecheck: clean
- Unit tests: 509 passed, 0 regressions
- E2E scenarios: 137 passed, 0 failed

---

## Phase 11 Summary

**Status: FULLY COMPLETE**

All 11 items across 3 tiers + 2 final integration items implemented:
- Tier 1: Weapon catalog (38 weapons), armor catalog (12 armors), property helpers, magic item foundation
- Tier 2: Draw/sheathe action economy, multiple weapon sets, equip command parser
- Tier 3: Inventory entity, API endpoints (4), item use, loot system, magic item combat integration
- Integration: Server-side attack property enrichment, armor AC derivation

Final test counts: 509 unit tests, 137 E2E scenarios — all passing.

---

### Tier 3 — COMPLETE

All five Tier 3 items implemented:

#### 7. Inventory entity ✅
- `CharacterItemInstance` type in `domain/entities/items/magic-item.ts` (name, magicItemId, equipped, attuned, quantity, slot)
- Pure domain helpers in `domain/entities/items/inventory.ts`: `findInventoryItem`, `addInventoryItem`, `removeInventoryItem`, `useConsumableItem`, `getAttunedCount`, `canAttune`, `getEquippedItems`, `getAttunedItems`, `getWeaponMagicBonuses`
- Resource helpers in `resource-utils.ts`: `getInventory()`, `setInventory()`
- Inventory initialized from `sheet.inventory` at combat start (roll-state-machine.ts)

#### 8. API endpoints ✅
- New route module: `session-inventory.ts` in `infrastructure/api/routes/sessions/`
- `GET /sessions/:id/characters/:charId/inventory` — list inventory with attunement info
- `POST /sessions/:id/characters/:charId/inventory` — add item (stacks by name+magicItemId)
- `DELETE /sessions/:id/characters/:charId/inventory/:itemName` — remove by amount
- `PATCH /sessions/:id/characters/:charId/inventory/:itemName` — equip/attune/slot updates
- Max 3 attunement slots enforced on add and patch
- 6 unit tests added to `app.test.ts`
- Documented in `SESSION_API_REFERENCE.md`

#### 9. Item use action ✅
- `tryParseUseItemText()` parser in combat-text-parser.ts: "use/drink/consume/quaff <item>"
- `handleUseItemAction()` in action-dispatcher.ts: consume from inventory, resolve effect
- `POTION_HEALING_FORMULAS` in `domain/entities/items/inventory.ts`: healing by rarity
- Costs a standard Action per D&D 5e 2024 rules
- E2E scenario: `core/use-potion-healing.json`

#### 10. Loot system ✅
- Monster stat blocks can have `loot[]` array with weapon and/or inventory items
- `dropMonsterLoot()` in roll-state-machine.ts: on monster defeat (HP→0), drops loot as `GroundItem`s at monster position
- `GroundItemSource` extended with `"loot"` value
- `GroundItem` extended with `inventoryItem?: CharacterItemInstance` for non-weapon loot
- Pickup action extended: non-weapon items with `inventoryItem` data → added to character inventory
- E2E scenario: `core/monster-loot-drop.json` (8 steps: kill goblin, assert ground items, pickup potion into inventory)

#### 11. Magic item combat integration ✅
- `getWeaponMagicBonuses()` in `inventory.ts`: computes attack/damage bonuses from equipped magic items
- Wired into `handleAttackAction()` in action-dispatcher.ts: applied after base bonus computation
- `lookupMagicItemById()` enhanced with dynamic generation for `weapon-plus-{1|2|3}-<weapon>` and `armor-plus-{1|2|3}-<armor>` patterns
- Matches by item name, baseWeapon, or partial name containment
- Attunement-gated: only applies if item doesn't require attunement or character is attuned
- E2E scenario: `core/magic-weapon-bonus.json` (attack 15+7=22 vs AC, damage 1d8+4)

#### Test results
- Unit tests: 509 passed, 0 regressions
- E2E scenarios: 137 passed, 0 failed (3 new: magic-weapon-bonus, monster-loot-drop, use-potion-healing)

### What's Left

~~Integration with combat: wire `lookupWeapon()` into character generation so `attacks[]` always has canonical properties~~
~~Integration with AC calculation: wire `lookupArmor()` into equipped item AC derivation~~

**All items complete. See Final Integration Notes below.**
