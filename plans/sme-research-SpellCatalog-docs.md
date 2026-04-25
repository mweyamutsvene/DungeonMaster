# SME Research — SpellCatalog — Doc Accuracy

## Scope
- Docs read: `.github/instructions/spell-catalog.instructions.md`, `packages/game-server/src/domain/entities/spells/CLAUDE.md`
- In-scope code read: `packages/game-server/src/domain/entities/spells/prepared-spell-definition.ts`, `packages/game-server/src/domain/entities/spells/spell-progression.ts`, `packages/game-server/src/domain/entities/spells/index.ts`, `packages/game-server/src/domain/entities/spells/catalog/index.ts`, `packages/game-server/src/domain/entities/spells/catalog/types.ts`
- Adjacent confirmation reads: `packages/game-server/src/domain/entities/spells/catalog/material-component.ts`, `packages/game-server/src/domain/entities/spells/catalog/level-4.ts`, `packages/game-server/src/domain/entities/spells/catalog/level-5.ts`, `packages/game-server/src/domain/entities/spells/cantrip-scaling.test.ts`, `packages/game-server/src/domain/entities/spells/spell-progression.test.ts`, `packages/game-server/src/domain/entities/spells/catalog/catalog.test.ts`, `packages/game-server/src/domain/entities/spells/catalog/material-component.test.ts`

## Current Truth
- SpellCatalog is a pure data and helper domain rooted in `domain/entities/spells/`.
- `PreparedSpellDefinition` is the mechanics-facing shape for prepared spells. It does not contain catalog metadata like school, casting time, components, class lists, or description.
- `CanonicalSpell` extends `PreparedSpellDefinition` with the catalog metadata fields and is the type used by the canonical catalog files.
- The exported spell-domain surface is `prepared-spell-definition.ts`, `spell-progression.ts`, and `catalog/index.ts` via `domain/entities/spells/index.ts`.
- The canonical catalog currently exists for cantrips and levels 1 through 5. There are dedicated `level-4.ts` and `level-5.ts` files. Levels 6 through 9 are not implemented.
- `spell-progression.ts` currently exposes `getSpellSlots`, `getCantripsKnown`, `getPactSlotLevel`, and `getCasterType`. It does not expose spells-known counts or prepared-count formulas.
- `catalog/types.ts` now includes `MaterialComponent`, `StructuredMaterialComponent`, and `SpellCastingMode` in addition to `CanonicalSpell` and `SpellSchool`.
- `catalog/material-component.ts` is an active adjacent helper that parses loose or structured material component declarations for inventory enforcement. It is consumed by the spell action handler.
- Tests exist for cantrip scaling, spell progression, material component parsing, and catalog lookups/counts. Catalog count assertions are explicit for levels 0 through 3.

## Drift Findings
1. `.github/instructions/spell-catalog.instructions.md` overstates what `PreparedSpellDefinition` contains. The current type does not own school, casting time, components, class lists, or description; those live on `CanonicalSpell` in `catalog/types.ts`.
2. The same instruction file says `spell-progression.ts` covers “spells known/prepared counts”. Current source only provides slot tables, cantrips known, pact slot level, and caster type.
3. The instruction file does not mention the material component model even though `MaterialComponent`, `StructuredMaterialComponent`, and `parseMaterialComponent()` are now part of the real spell catalog surface and materially affect spell-data authoring.
4. The instruction file’s purpose sentence says “catalog entries by level (cantrips through level 9)”. That reads like implemented coverage. Current implemented catalog stops at level 5.
5. `packages/game-server/src/domain/entities/spells/CLAUDE.md` is not a SpellCatalog doc. It is a SpellSystem/handler doc: it talks about `spell action handler`, `spell delivery`, `concentration.ts`, handler ownership, and slot spending. That is flow drift, not just wording drift.

## Recommended Doc Edits
### `.github/instructions/spell-catalog.instructions.md`

Replace the `## Purpose` paragraph with:

> Pure spell data definitions and helper APIs for the spell domain: prepared-spell mechanics, canonical catalog entries, spell progression tables, cantrip scaling, multi-attack spell patterns, and material component metadata/parsing. This flow is data-oriented; combat execution belongs outside this package.

Replace the `prepared-spell-definition.ts` row in `## File Responsibility Matrix` with:

> `domain/entities/spells/prepared-spell-definition.ts` | Core `PreparedSpellDefinition` mechanics shape plus `getCantripDamageDice()`, `getSpellAttackCount()`, and `getUpcastBonusDice()`

Replace the `spell-progression.ts` row with:

> `domain/entities/spells/spell-progression.ts` | Class spell-slot progression, cantrips known, Warlock pact slot level, and caster-type helpers

Add these rows to the matrix:

> `domain/entities/spells/index.ts` | Public barrel for the spell-domain surface

> `domain/entities/spells/catalog/material-component.ts` | `parseMaterialComponent()` helper for costed and consumed material component metadata

Replace the `PreparedSpellDefinition` bullet in `## Key Types/Interfaces` with:

> `PreparedSpellDefinition` — mechanical spell shape used on prepared spell lists and by spell execution code; metadata like school, casting time, components, class lists, and description are added by `CanonicalSpell`, not stored here

Add these bullets under `## Key Types/Interfaces`:

> `MaterialComponent` — spell material component declaration, either a legacy string or a structured object

> `StructuredMaterialComponent` — normalized material component metadata including description, optional item keyword, optional GP cost, optional consumed flag, and optional `componentPouchSatisfies`

Replace the first sentence of `## Purpose` or add a note near the catalog rows with:

> Current implemented catalog coverage is cantrips plus spell levels 1 through 5. Do not claim level 6 through 9 support unless new catalog files and tests are added.

Add a `Known Gotchas` bullet:

> `parseMaterialComponent()` exists because catalog entries may still use legacy string material components. New cost-sensitive entries should prefer structured material components so inventory enforcement stays explicit.

### `packages/game-server/src/domain/entities/spells/CLAUDE.md`

Current file should be replaced wholesale. Suggested caveman-style replacement:

> # SpellCatalog — Quick Constraints
>
> Speak caveman. Keep short.
>
> ## Scope
> Spell data only. Prepared spell shapes. Catalog files. Spell progression tables. Material component metadata. No handler logic here.
>
> ## Laws
> 1. Catalog says what spell is. Other layers say what spell does in combat.
> 2. `PreparedSpellDefinition` is mechanics shape only. `CanonicalSpell` adds school, casting time, components, class lists, and description.
> 3. Keep spell data declarative. No service calls. No side effects.
> 4. If spell has costly or consumed material, prefer structured material component data.
> 5. Eldritch Blast scales by more beams, not more damage dice per beam.
> 6. Catalog is real only through level 5 today. No pretend level 6 to 9 support.
> 7. New spell needs catalog tests. New helper needs unit tests.

### Mermaid
- Mermaid would not materially help this flow doc right now. The flow is mostly data ownership and helper boundaries, so a short responsibility table is clearer than a diagram.
- Mermaid only becomes useful if the doc is widened to show how catalog data feeds spell lookup, cast preparation, and material-component enforcement across layers.