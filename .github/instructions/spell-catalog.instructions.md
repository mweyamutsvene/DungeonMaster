---
description: "Architecture and conventions for the SpellCatalog flow: spell entity definitions, prepared spell types, catalog entries by level, spell progression tables, cantrip scaling."
applyTo: "packages/game-server/src/domain/entities/spells/**"
---

# SpellCatalog Flow

## Purpose
Pure spell data definitions and helper APIs for the spell domain: prepared-spell mechanics, canonical catalog entries, spell progression tables, cantrip scaling, multi-attack spell patterns, and material component metadata/parsing. This is a data-only domain layer — no combat resolution or orchestration logic.

## File Responsibility Matrix

| File | ~Lines | Responsibility |
|------|--------|----------------|
| `domain/entities/spells/prepared-spell-definition.ts` | ~290 | Core PreparedSpellDefinition type, `getCantripDamageDice()`, `getSpellAttackCount()`, `getUpcastBonusDice()` |
| `domain/entities/spells/spell-progression.ts` | ~100 | Class spell-slot progression, cantrips known, Warlock pact slot level, and caster-type helpers |
| `domain/rules/spell-slots.ts` | ~58 | `SpellSlotLevel`, `SPELL_SLOT_LEVELS`, `SpellSlotsState`, `createSpellSlotsState`, `canSpendSpellSlot`, `spendSpellSlot`, `restoreAllSpellSlots` |
| `domain/entities/spells/catalog/types.ts` | ~57 | `CanonicalSpell` (extends PreparedSpellDefinition with school, ritual, castingTime, range, components, classLists, description), `SpellSchool`, `SpellCastingMode` |
| `domain/entities/spells/index.ts` | ~20 | Public barrel for the spell-domain surface |
| `domain/entities/spells/catalog/index.ts` | ~50 | `ALL_SPELLS` unified catalog barrel |
| `domain/entities/spells/catalog/material-component.ts` | ~50 | `parseMaterialComponent()` helper for costed and consumed material component metadata |
| `domain/entities/spells/catalog/cantrips.ts` | ~150 | Cantrip definitions (Fire Bolt, Sacred Flame, Eldritch Blast, etc.) |
| `domain/entities/spells/catalog/level-1.ts` | ~200 | Level 1 spells (Shield, Healing Word, Magic Missile, etc.) |
| `domain/entities/spells/catalog/level-2.ts` | ~150 | Level 2 spells (Scorching Ray, Hold Person, etc.) |
| `domain/entities/spells/catalog/level-3.ts` | ~150 | Level 3 spells (Fireball, Counterspell, etc.) |
| `domain/entities/spells/catalog/level-4.ts` | ~100 | Level 4 spells (Wall of Fire, Banishment, etc.) — full mechanical definitions |
| `domain/entities/spells/catalog/level-5.ts` | ~100 | Level 5 spells (Cone of Cold, Hold Monster, Wall of Force, etc.) — full mechanical definitions |

## Key Types/Interfaces

- `PreparedSpellDefinition` — mechanical spell shape used on prepared spell lists and by spell execution code; metadata like school, casting time, components, class lists, and description are added by `CanonicalSpell`, not stored here
- `CanonicalSpell` — extends `PreparedSpellDefinition` with catalog-specific fields (`school`, `ritual`, `castingTime`, `range`, `components`, `classLists`, `description`)
- `SpellSchool` — union type of all D&D spell schools (`'abjuration' | 'conjuration' | 'divination' | ...`)
- `SpellCastingMode` — `'normal' | 'ritual'`
- `MaterialComponent` — spell material component declaration, either a legacy string or a structured object
- `StructuredMaterialComponent` — normalized material component metadata including description, optional item keyword, optional GP cost, optional consumed flag, and optional `componentPouchSatisfies`
- `SpellSlotTable` — slots available per caster level (lives in `domain/rules/spell-slots.ts`, NOT `domain/entities/spells/`)
- `multiAttack` — `{ baseCount, scaling: 'cantrip' | 'perLevel' }` for multi-beam/ray spells
- `getCantripDamageDice(baseDiceCount, characterLevel)` — returns `baseDiceCount × tier` based on caster level tiers (1/5/11/17); takes TWO parameters (NOT one)
- `getSpellAttackCount(spell, characterLevel, castAtLevel?)` — computes total attacks for multi-attack spells; optional `castAtLevel` for `perLevel` scaling
- `getUpcastBonusDice(spell, castAtLevel)` — computes extra dice from upcasting

## Known Gotchas

- **Multi-attack cantrips skip `getCantripDamageDice()`** — Eldritch Blast scales via extra beams, not extra dice per beam. Using both would double-scale.
- **`getCantripDamageDice` takes TWO parameters** — `(baseDiceCount, characterLevel)`. Do NOT call it with a single `(level)` — this is a silent wrong-result bug.
- **`spell-slots.ts` lives in `domain/rules/`** — NOT in `domain/entities/spells/`. Do not move or re-export it from the spells barrel.
- **Every spell must have all required fields** — school, level, castingTime, range, components, duration, description. Missing fields break the spell delivery handlers downstream.
- **Concentration must be flagged explicitly** — the concentration lifecycle system relies on this flag. Missing it means the spell won't be tracked and won't be broken by damage.
- **D&D 5e 2024 spells differ from 2014** — check schools, ranges, and mechanics against the 2024 rules. Some spells changed significantly (e.g., Healing Word range, Sacred Flame save type).
- **Current implemented catalog coverage is cantrips plus levels 1 through 5** — do not claim level 6 through 9 support unless new catalog files and tests are added.
- **Prefer structured material component data for cost-sensitive spells** — `parseMaterialComponent()` exists because older catalog entries may still use legacy strings.

## API Docs Alignment

- Canonical client API docs live in `docs/api/` (README + reference + guides).
- When changing routes, payloads, errors, events, or client integration loops, update the matching files in `docs/api/reference/` and `docs/api/guides/` in the same change.
- For SME research, agent reviews, and implementation plans that affect client contracts, cite and update the impacted docs under `docs/api/`.
- Treat these docs as done criteria for contract changes: `docs/api/reference/endpoints.md`, `docs/api/reference/schemas.md`, `docs/api/reference/events.md`, and `docs/api/reference/errors.md`.
