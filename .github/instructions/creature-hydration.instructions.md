---
description: "Architecture and conventions for the CreatureHydration flow: character sheet parsing, stat block mapping, species traits, armor class computation, creature adapter construction, combat stat resolution."
applyTo: "packages/game-server/src/application/services/combat/helpers/creature-hydration.ts,packages/game-server/src/application/services/combat/helpers/combat-utils.ts,packages/game-server/src/application/services/combat/helpers/combatant-resolver.ts,packages/game-server/src/domain/entities/creatures/species*.ts,packages/game-server/src/domain/entities/creatures/creature.ts,packages/game-server/src/domain/entities/creatures/character.ts,packages/game-server/src/domain/entities/creatures/monster.ts,packages/game-server/src/domain/entities/creatures/npc.ts,packages/game-server/src/domain/entities/items/equipped-items.ts,packages/game-server/src/domain/entities/items/armor-catalog.ts"
---

# CreatureHydration Flow

## Purpose
Bridge persisted creature data into combat-facing domain objects and combat-stat read models. `creature-hydration.ts` defensively hydrates `Character`, `Monster`, and `NPC` entities from schemaless JSON plus optional combat-state overrides. `combatant-resolver.ts` is a separate, stricter path that extracts the minimum combat stats needed by action handlers and throws when required combat fields are missing. `combat-utils.ts` provides lightweight adapters for attack resolution; it does not construct full domain entities.

## File Responsibility Matrix

| File | ~Lines | Responsibility |
|------|--------|----------------|
| `combat/helpers/creature-hydration.ts` | ~400 | `hydrateCharacter()`, `hydrateMonster()`, `hydrateNPC()`, and `extractCombatantState()`; defensive field reads from schemaless JSON |
| `combat/helpers/combat-utils.ts` | ~200 | `buildCreatureAdapter(params)` returns `{ creature, getHpCurrent }` for attack resolution and owns shared parsing helpers |
| `combat/helpers/combatant-resolver.ts` | ~150 | Strict combat-stat resolution from persisted records; throws when required combat fields are missing |
| `domain/entities/creatures/species.ts` | ~100 | Species trait definitions (darkvision, speed, resistances) |
| `domain/entities/creatures/species-registry.ts` | ~80 | Species lookup by name |
| `domain/entities/creatures/creature.ts` | ~120 | Base Creature interface/class |
| `domain/entities/creatures/character.ts` | ~150 | Character entity (sheet-based, player controlled) |
| `domain/entities/creatures/monster.ts` | ~100 | Monster entity (stat block, DM controlled) |
| `domain/entities/creatures/npc.ts` | ~80 | NPC entity (hybrid, DM controlled) |
| `domain/entities/items/equipped-items.ts` | ~120 | Equipped armor, shield, and armor-training type definitions |
| `domain/entities/items/armor-catalog.ts` | ~100 | Armor definitions with AC formulas |

## Key Types/Interfaces

- `Creature` — abstract base class with safe defaults for `getFeatIds()`, `getClassId()`, `getSubclass()`, and `getLevel()`, plus HP, AC, conditions, and damage-defense behavior
- `buildCreatureAdapter(params)` — builds a lightweight adapter for attack resolution and returns `{ creature, getHpCurrent }`
- Three hydration entry points: `hydrateCharacter(dbRow)`, `hydrateMonster(dbRow)`, `hydrateNPC(dbRow)` — one per creature type (NOT a single `hydrateCreature()`)
- `parseCharacterSheet(json)` — in `hydration-types.ts`, a shallow typed boundary used by resolver code
- `CombatantCombatStats` — resolved combat stats such as AC, ability scores, feat IDs, equipment summary, size, skills, level, proficiency bonus, damage defenses, and save proficiencies
- `EquippedItems` — models armor and shield only; AC math happens in `Creature.getAC()`, `Character.getAC()`, and armor-catalog helpers

## Known Gotchas

- **`buildCreatureAdapter` MUST define ALL Creature interface methods** — `getFeatIds()`, `getClassId()`, `getSubclass()`, `getLevel()` even for monsters/NPCs (return `[]`/`undefined`). `resolveAttack()` calls these unconditionally.
- **Character.sheet is schemaless JSON** — every field access must have a fallback. No field is guaranteed to exist.
- **Character and resolver paths have different tolerance levels** — hydration falls back aggressively for partial schemaless data, while resolver code fails fast when required combat stats are absent.
- **Monster and NPC hydration both follow the stat-block pattern today** — character hydration is the distinct path.
- **AC logic is split** — `Creature.getAC()` uses stored `armorClass` unless equipped armor/shield metadata exists, then computes from armor formula + DEX + shield. `Character.getAC()` can override that for class-specific Unarmored Defense and then add armored feat bonuses. Natural armor is not modeled here today.
- **Species hydration applies speed, darkvision, save advantages, and merged damage resistances** — do not document species ability-score bonuses in this flow unless the code starts applying them.
