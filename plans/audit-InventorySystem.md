---
type: sme-research
flow: InventorySystem
feature: mechanics-audit-l1-5
author: claude-explore-inventory-system
status: DRAFT
created: 2026-04-24
updated: 2026-04-24
---

## Scope

Inventory flow: domain entity models (pure rules) + application services (transactional workflows) + REST routes (character sheet I/O). Out-of-combat (persistent sheet) and in-combat (transient combatant resources) storage paradigms.

## Currently Supported

### Item Entity Model
- `CharacterItemInstance`: name, magicItemId, equipped, attuned, quantity, slot, currentCharges, longRestsRemaining.
- `MagicItemDefinition`: modifiers (attack/damage/AC/saves/speed/HP), granted spells/abilities, on-hit effects, charges with recharge timing, damage modifiers, potion effects, attunement requirements, action costs, baseWeapon/baseArmor references.

### Weapon Catalog (PHB 2024)
- 28 weapons complete (10 simple melee, 4 simple ranged, 14 martial melee, 6 martial ranged).
- All properties: ammunition, finesse, heavy, light, loading, reach, thrown, two-handed, versatile.
- **Mastery fields on all entries.**
- Versatile toggle via `versatileDiceSides`.
- Thrown range parsing + `getThrownRange()` helper.
- Case-insensitive `lookupWeapon()`.

### Armor Catalog (PHB 2024)
- 12 pieces: 3 light, 5 medium, 4 heavy.
- AC base + DEX-cap formulas.
- Shields +2 bonus, don/doff as Utilize mid-combat.
- Don/doff times: light 1/1, medium 5/1, heavy 10/5 min (out-of-combat only).
- STR requirements on heavy.
- Stealth disadvantage marked.

### Equip/Unequip
- REST PATCH `/inventory/:itemName` updates equipped/attuned/slot.
- Armor equip triggers `recomputeArmorFromInventory()` for AC sync.
- Magic lookup strips "+N " prefix or resolves baseArmor.
- Attunement capped at 3 with validation.

### Consumables
- **Potions of Healing** (4 tiers), **Resistance** (13 types), **Heroism**, **Invulnerability**, **Poison**, **Vitality**, **Climbing**, **Water Breathing**, **Speed**, **Invisibility**, **Growth**, **Diminution**, **Gaseous Form**, **Giant Strength** (6 variants).
- **Goodberry** (1 HP, bonus action, `longRestsRemaining=1` for 24-hour decay).
- Action costs: use (bonus), give (free-obj-int), administer (utilize/bonus override).
- Healing via dice roll + cap; temp HP set to max. Damage/condition effects defined but **not applied**.

### Magic Items
- +X weapons/armor via dynamic IDs (uncommon/rare/very-rare).
- Wondrous: Cloak of Protection, Amulet of Health, Boots of Speed, Adamantine, Shield +1.
- Spell-casting staves: Staff of Fire (Burning Hands 1 charge, Fireball 3, Wall of Fire 4; 1d6+4 dawn recharge).
- On-hit effects: Flame Tongue 2d6 fire, Frost Brand 1d6 cold + fire resistance.
- Charges: max, recharge amount/roll, timing, destroy-on-empty.
- Attunement: required flag, class restriction, spellcasting requirement, minimum level.

### Ground Items
- `GroundItem` type: position, source (dropped/thrown/preplaced/loot), droppedBy ID, round.
- Dual payload: weaponStats (for attacks) or inventoryItem (for inventory).
- **No loot scaling or death drops.**

### API Routes
- GET inventory (list + attuned count).
- POST add (attunement validation + armor AC recompute).
- DELETE remove (quantity).
- PATCH equip (state + armor sync).
- POST use-charge.
- POST use (potion healing + tempHP).
- POST transfer (atomic cross-character with optimistic concurrency).

## Needs Rework

### Potion ActiveEffect Application
- Potion of Speed, Resistance effects defined but routes only apply healing + tempHP.
- Damage/save/condition integration stubbed (Potion of Poison).
- Persistence to `combatant.effects[]` missing.

### Charge Recharge
- Definition exists but no reset on long rest.
- Staff of Fire recharge roll not implemented.
- `applyLongRestToInventory()` handles expiry but not charge reset.

### Item Action Costs
- Helpers `getCategoryActionCostDefaults()` / `resolveItemActionCosts()` exist.
- ItemActionHandler (give/administer) for tabletop verbs only.
- Routes don't validate action-economy; missing combat integration.

### Magic Item Bonus Enforcement
- `getWeaponMagicBonuses()` exists but attack resolver doesn't call it.
- On-hit effects (Flame Tongue) undefined in attack flow.
- Armor AC magic bonus recomputed at equip but combat hydration may lag.

### Ground Item Pickup
- Type defined but no movement interaction endpoint.
- No auto-loot on defeat.

### Cursed Items
- Flag defined; no remove-curse logic or attunement-breaking mechanics.

### Encumbrance
- Helpers pure but never called.
- No rejection or speed penalty enforcement.

### Ammunition Consumption
- Not tracked; only manual DELETE removal works.

### Two-Handed Enforcement
- No dual-wield prevention; attack resolver must check properties.

## Missing — Required for L1-5

### P0
1. **ActiveEffect potion mapping** — Potion of Speed → effect[] for combatant.
2. **Charge recharge scheduling** — reset on long rest; call recharge roll if defined.
3. **Magic bonus in attacks** — `getWeaponMagicBonuses()` called in attack roll; on-hit damage added.

### P1
4. **Ground item pickup endpoint** — `/combat/:encounterId/ground-item/:id/pickup`.
5. **Spell-item creation** — Goodberry spell hooks `InventoryService.createItemsForCharacter()`.
6. **Cursed item handling** — attunement-breaking + Remove Curse integration.

### P2
7. **Ammunition tracking** — decrement per ranged hit.
8. **Encumbrance enforcement** — reject overloaded; apply speed penalty.

## Cross-Flow Dependencies

- **SpellSystem** — `InventoryService.createItemsForCharacter()` for spell side-effects. Potion ActiveEffect → target. Staff of Fire grants → spell catalog lookup.
- **Combat Hydration** — equipped armor/shield → `equippedArmor`/`equippedShield`. Magic weapon bonuses → attack roll. Item grants (Boots of Speed) → combatant speed (not yet).
- **Action Economy** — ItemActionHandler validates give/administer costs. Routes assume out-of-combat; in-combat integration missing.
- **Long Rest** — `applyLongRestToInventory()` for expiry + charge reset.
- **Two-Phase Reactions** — reaction items (Shield +1) not yet modeled as usable reactions.

## Summary

Core inventory entity model and catalogs solid. **Potion effects, charge recharge, ground-item pickup, and magic-bonus enforcement in combat are the critical gaps for L1-5 playability.** Encumbrance, ammo consumption, cursed-item mechanics out of scope.
