---
description: "Architecture and conventions for the SpellCatalog flow: spell entity definitions, prepared spell types, catalog entries by level, spell progression tables, cantrip scaling."
applyTo: "packages/game-server/src/domain/entities/spells/**"
---

# SpellCatalog Flow

## Purpose
Pure spell data definitions: entity types, per-level catalog entries (cantrips through level 9), spell progression tables, cantrip scaling formulas, and multi-attack spell patterns. This is a data-only domain layer — no combat resolution or orchestration logic.

## File Responsibility Matrix

| File | ~Lines | Responsibility |
|------|--------|----------------|
| `domain/entities/spells/prepared-spell-definition.ts` | ~200 | Core PreparedSpellDefinition type, `getCantripDamageDice()`, `getSpellAttackCount()` |
| `domain/entities/spells/spell-progression.ts` | ~100 | Slot tables per class/level, spells known/prepared counts |
| `domain/entities/spells/spell-slots.ts` | ~80 | SpellSlot type, slot level validation |
| `domain/entities/spells/catalog/index.ts` | ~50 | `ALL_SPELLS` unified catalog barrel |
| `domain/entities/spells/catalog/cantrips.ts` | ~150 | Cantrip definitions (Fire Bolt, Sacred Flame, Eldritch Blast, etc.) |
| `domain/entities/spells/catalog/level-1.ts` | ~200 | Level 1 spells (Shield, Healing Word, Magic Missile, etc.) |
| `domain/entities/spells/catalog/level-2.ts` | ~150 | Level 2 spells (Scorching Ray, Hold Person, etc.) |
| `domain/entities/spells/catalog/level-3.ts` | ~150 | Level 3 spells (Fireball, Counterspell, etc.) |
| `domain/entities/spells/catalog/level-4-9.ts` | ~50 | Stub entries for higher-level spells (to be expanded) |

## Key Types/Interfaces

- `PreparedSpellDefinition` — complete mechanical description of a spell (damage, save, range, components, duration, school, concentration, etc.)
- `SpellSlotTable` — slots available per caster level
- `multiAttack` — `{ baseCount, scaling: 'cantrip' | 'perLevel' }` for multi-beam/ray spells
- `getCantripDamageDice(level)` — returns dice count based on caster level tiers (1/5/11/17)
- `getSpellAttackCount(spell, casterLevel)` — computes total attacks for multi-attack spells

## Known Gotchas

- **Multi-attack cantrips skip `getCantripDamageDice()`** — Eldritch Blast scales via extra beams, not extra dice per beam. Using both would double-scale.
- **Every spell must have all required fields** — school, level, castingTime, range, components, duration, description. Missing fields break the spell delivery handlers downstream.
- **Concentration must be flagged explicitly** — the concentration lifecycle system relies on this flag. Missing it means the spell won't be tracked and won't be broken by damage.
- **D&D 5e 2024 spells differ from 2014** — check schools, ranges, and mechanics against the 2024 rules. Some spells changed significantly (e.g., Healing Word range, Sacred Flame save type).
- **Levels 4-9 are stubs** — the engine currently supports through level 3 spells fully. Higher levels need expansion as the game supports higher-level play.
