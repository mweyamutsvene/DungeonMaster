---
description: "Architecture and conventions for the CreatureHydration flow: character sheet parsing, stat block mapping, species traits, armor class computation, creature adapter construction, combat stat resolution."
applyTo: "packages/game-server/src/application/services/combat/helpers/creature-hydration.ts,packages/game-server/src/application/services/combat/helpers/combat-utils.ts,packages/game-server/src/application/services/combat/helpers/combatant-resolver.ts,packages/game-server/src/domain/entities/creatures/species*.ts,packages/game-server/src/domain/entities/creatures/creature.ts,packages/game-server/src/domain/entities/creatures/character.ts,packages/game-server/src/domain/entities/creatures/monster.ts,packages/game-server/src/domain/entities/creatures/npc.ts,packages/game-server/src/domain/entities/items/equipped-items.ts,packages/game-server/src/domain/entities/items/armor-catalog.ts"
---

# CreatureHydration Flow

## Purpose
Bridge between persistence (Prisma DB rows, schemaless JSON sheets) and combat models. Parses character sheets, maps monster stat blocks, applies species traits, computes armor class, and builds creature adapters that satisfy the `Creature` interface for combat resolution.

## File Responsibility Matrix

| File | ~Lines | Responsibility |
|------|--------|----------------|
| `combat/helpers/creature-hydration.ts` | ~400 | `hydrateCreature()`, `parseCharacterSheet()` — main bridge layer |
| `combat/helpers/combat-hydration.ts` | ~300 | `extractActionEconomy()`, `resetTurnResources()`, full combatant hydration |
| `combat/helpers/combat-utils.ts` | ~200 | `buildCreatureAdapter()` — Creature-interface adapter for monsters/NPCs |
| `combat/helpers/combatant-resolver.ts` | ~150 | `CombatantCombatStats`, `ICombatantResolver` for stat queries |
| `domain/entities/creatures/species.ts` | ~100 | Species trait definitions (darkvision, speed, resistances) |
| `domain/entities/creatures/species-registry.ts` | ~80 | Species lookup by name |
| `domain/entities/creatures/creature.ts` | ~120 | Base Creature interface/class |
| `domain/entities/creatures/character.ts` | ~150 | Character entity (sheet-based, player controlled) |
| `domain/entities/creatures/monster.ts` | ~100 | Monster entity (stat block, DM controlled) |
| `domain/entities/creatures/npc.ts` | ~80 | NPC entity (hybrid, DM controlled) |
| `domain/entities/items/equipped-items.ts` | ~120 | EquippedItems, AC formula computation |
| `domain/entities/items/armor-catalog.ts` | ~100 | Armor definitions with AC formulas |

## Key Types/Interfaces

- `Creature` — interface with `getFeatIds()`, `getClassId()`, `getSubclass()`, `getLevel()`, `takeDamage()`, `heal()`
- `buildCreatureAdapter(stats, options?)` — builds a Creature-compliant adapter from combat stats
- `hydrateCreature(dbRow)` — converts persistence row to domain entity
- `CombatantCombatStats` — resolved stats ready for combat (AC, HP, abilities, weapons, spells)
- `EquippedItems` — tracks equipped weapon/armor/shield with AC computation

## Known Gotchas

- **`buildCreatureAdapter` MUST define ALL Creature interface methods** — `getFeatIds()`, `getClassId()`, `getSubclass()`, `getLevel()` even for monsters/NPCs (return `[]`/`undefined`). `resolveAttack()` calls these unconditionally.
- **Character.sheet is schemaless JSON** — every field access must have a fallback. No field is guaranteed to exist.
- **Three distinct hydration paths** — characters (parse sheet JSON), monsters (map stat block), NPCs (hybrid). Don't assume one path works for all.
- **AC formula hierarchy** — natural armor > equipped armor > unarmored defense (10 + DEX). Monks and Barbarians have special unarmored defense formulas that override the default.
- **Species traits are additive** — they add bonuses to base stats, never replace them. A dwarf's +2 CON is added to the rolled/assigned score.
