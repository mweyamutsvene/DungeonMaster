# Plan: SPELL-H2 â€” Canonical Spell Catalog

## Round: 1
## Status: COMPLETE (commit 22142aa)
## Affected Flows: SpellSystem, CombatOrchestration, AIBehavior, EntityManagement, Testing

## Objective

Create a canonical spell catalog so spell mechanics (damage, saves, healing, zones, effects) have a single source of truth instead of being copy-pasted inline in every character sheet and E2E scenario. This eliminates inconsistencies (e.g., Burning Hands sometimes missing AoE data), enables API-boundary validation, powers MockCharacterGenerator with real spells, and lets AI know what spells are available.

## Spell Inventory (25 spells currently used in E2E scenarios)

### Cantrips (Level 0)
- Eldritch Blast, Fire Bolt, Produce Flame, Sacred Flame

### Level 1
- Absorb Elements, Bless, Burning Hands, Cause Fear, Cure Wounds, Healing Word, Hellish Rebuke, Heroism, Longstrider, Magic Missile, Shield, Shield of Faith, Thunderous Ward

### Level 2
- Cloud of Daggers, Hold Person, Moonbeam, Scorching Ray, Spike Growth, Spirit Guardians

### Level 3
- Counterspell

### Additional spells for catalog completeness (heavily used in D&D)
- Fireball, Guiding Bolt, Inflict Wounds, Ray of Frost, Toll the Dead, Chill Touch, Mage Armor, Mage Hand (utility, no combat), Thunderwave, Shatter, Misty Step, Spiritual Weapon, Mass Cure Wounds, Revivify, Dispel Magic

## Changes

### Phase 1: Build Canonical Catalog (domain layer â€” no consumer changes)

#### [File: domain/entities/spells/catalog/types.ts] â€” NEW
- [x] Define `CanonicalSpell` interface extending `PreparedSpellDefinition` with:
  - `school`: `"abjuration" | "conjuration" | "divination" | "enchantment" | "evocation" | "illusion" | "necromancy" | "transmutation"`
  - `ritual`: `boolean`
  - `castingTime`: `"action" | "bonus_action" | "reaction"`
  - `range`: `number | "self" | "touch"`
  - `components`: `{ v?: boolean; s?: boolean; m?: string }`
  - `classLists`: `string[]` â€” which classes can learn this spell
  - `description`: `string` â€” one-line description for display/narration

#### [File: domain/entities/spells/catalog/cantrips.ts] â€” NEW
- [x] Define canonical cantrip entries: Eldritch Blast, Fire Bolt, Produce Flame, Sacred Flame, Ray of Frost, Toll the Dead, Chill Touch
- [x] Each entry is a `const satisfies CanonicalSpell`

#### [File: domain/entities/spells/catalog/level-1.ts] â€” NEW
- [x] Define canonical level 1 spell entries: Absorb Elements, Bless, Burning Hands, Cause Fear, Cure Wounds, Healing Word, Hellish Rebuke, Heroism, Longstrider, Magic Missile, Shield, Shield of Faith, Thunderous Ward, Guiding Bolt, Inflict Wounds, Mage Armor, Thunderwave

#### [File: domain/entities/spells/catalog/level-2.ts] â€” NEW
- [x] Define canonical level 2 spell entries: Cloud of Daggers, Hold Person, Moonbeam, Scorching Ray, Spike Growth, Spirit Guardians, Shatter, Misty Step, Spiritual Weapon

#### [File: domain/entities/spells/catalog/level-3.ts] â€” NEW
- [x] Define canonical level 3 spell entries: Counterspell, Fireball, Dispel Magic, Revivify, Mass Cure Wounds, Spirit Guardians (actually L3)

#### [File: domain/entities/spells/catalog/index.ts] â€” NEW
- [x] Build `SPELL_CATALOG: ReadonlyMap<string, CanonicalSpell>` keyed by normalized lowercase name
- [x] Export `getCanonicalSpell(name: string): CanonicalSpell | null`
- [x] Export `listSpellsByLevel(level: number): CanonicalSpell[]`
- [x] Export `listSpellsByClass(classId: string): CanonicalSpell[]`
- [x] Export `listSpellsBySchool(school: string): CanonicalSpell[]`
- [x] Export `SPELL_CATALOG` for iteration

#### [File: domain/entities/spells/index.ts] â€” MODIFY
- [x] Add `export * from './catalog/index.js'`

### Phase 2: Lookup Indirection (wire catalog into combat paths)

#### [File: application/services/combat/helpers/spell-slot-manager.ts] â€” MODIFY
- [x] Create `resolveSpell(spellName: string, sheet: unknown): PreparedSpellDefinition | null`
  - First: check canonical catalog via `getCanonicalSpell(name)`
  - Fallback: `findPreparedSpellInSheet(sheet, name)` for backward compat
  - If both exist: merge (catalog is base, sheet overrides for character-specific tweaks)
- [x] Keep `findPreparedSpellInSheet()` as-is for backward compat

#### [File: application/services/combat/tabletop/spell-action-handler.ts] â€” MODIFY
- [x] Replace `findPreparedSpellInSheet()` calls with `resolveSpell()`
- [x] When spell found in catalog but not sheet, still allow casting (catalog IS the definition)

#### [File: application/services/combat/ai/handlers/cast-spell-handler.ts] â€” MODIFY
- [x] Replace `findSpellDefinition()` / `findPreparedSpellInSheet()` with `resolveSpell()`

#### [File: application/services/combat/ai/handlers/ai-spell-delivery.ts] â€” MODIFY
- [x] Replace `findSpellDefinition()` with `resolveSpell()` for spell lookup

#### [File: domain/entities/classes/combat-resource-builder.ts] â€” MODIFY
- [x] Replace sheet.preparedSpells scan for Shield/Counterspell/etc with catalog lookup
  - Still check sheet list (character must have it prepared), but use catalog for ability data

### Phase 3: Simplify E2E Scenarios + Character Sheets

#### [File: All 25+ E2E scenario JSON files] â€” MODIFY
- [x] Replace full inline `PreparedSpellDefinition` objects in `preparedSpells` arrays with name-only references: `{ "name": "Fire Bolt" }` (level still required for disambiguation)
- [x] Actually: keep `{ "name": "Fire Bolt", "level": 0 }` minimal form â€” catalog provides all mechanics
- [x] Verify each simplified scenario still passes E2E

#### [File: infrastructure/llm/mocks/index.ts] â€” MODIFY
- [x] Update MockCharacterGenerator to populate `preparedSpells` from catalog based on class/level
- [x] Use `listSpellsByClass()` to pick appropriate spells

#### [File: application/services/combat/ai/ai-context-builder.ts] â€” MODIFY
- [x] Expose available spells list to AI decision context using catalog data

### Phase 4: Cleanup

#### [File: application/services/combat/tabletop/spell-action-handler.ts] â€” MODIFY
- [x] Move Magic Missile hardcoded handler (~60 lines) to use catalog definition + generic delivery
  - Catalog entry can have `deliveryMode: "auto_hit_multi_dart"` or similar special tag

#### [File: application/services/combat/helpers/spell-slot-manager.ts] â€” MODIFY
- [x] Add validation: warn if sheet spell definition conflicts with catalog definition

#### [File: application/services/entities/spell-lookup-service.ts] â€” MODIFY
- [x] Wire `SpellLookupService` to use canonical catalog as primary data source
- [x] Keep Prisma path as optional secondary

## Cross-Flow Risk Checklist
- [x] Do changes in one flow break assumptions in another? â€” No, Phase 2 is additive (catalog-first, sheet-fallback)
- [x] Does the pending action state machine still have valid transitions? â€” Not affected
- [x] Is action economy preserved? â€” Not affected
- [x] Do both player AND AI paths handle the change? â€” Yes, `resolveSpell()` serves both
- [x] Are repo interfaces + memory-repos updated if entity shapes change? â€” Not affected (catalog is static)
- [x] Is `app.ts` registration updated? â€” Not needed (static catalog, no DI)
- [x] Are D&D 5e 2024 rules correct? â€” Yes, sourced from RuleBookDocs/markdown/spell-descriptions.md

## Risks
- **Scenario JSON blast radius**: 25+ files changing format in Phase 3. Mitigated by running E2E after each file group.
- **Spell mechanics accuracy**: Manual curation of 40+ spell definitions. Mitigated by cross-referencing RuleBookDocs.
- **Backward compat**: Existing Prisma-stored characters have inline spell data. Mitigated by `resolveSpell()` fallback chain.
- **Magic Missile special case**: Currently hardcoded; needs careful extraction in Phase 4.

## Test Plan
- [x] Unit tests for `getCanonicalSpell()`, `listSpellsByLevel()`, `listSpellsByClass()` 
- [x] Unit tests for `resolveSpell()` â€” catalog hit, sheet fallback, merge behavior
- [x] Unit tests verifying catalog entries match expected D&D 5e 2024 rules (spot-check ~10 spells)
- [x] All existing E2E scenarios pass after Phase 3 simplification
- [x] Integration test: MockCharacterGenerator produces casters with real spells

