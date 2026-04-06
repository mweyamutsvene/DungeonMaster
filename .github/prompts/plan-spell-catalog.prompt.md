# Plan: SPELL-H2 — Canonical Spell Catalog

## Round: 1
## Status: APPROVED
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

### Phase 1: Build Canonical Catalog (domain layer — no consumer changes)

#### [File: domain/entities/spells/catalog/types.ts] — NEW
- [ ] Define `CanonicalSpell` interface extending `PreparedSpellDefinition` with:
  - `school`: `"abjuration" | "conjuration" | "divination" | "enchantment" | "evocation" | "illusion" | "necromancy" | "transmutation"`
  - `ritual`: `boolean`
  - `castingTime`: `"action" | "bonus_action" | "reaction"`
  - `range`: `number | "self" | "touch"`
  - `components`: `{ v?: boolean; s?: boolean; m?: string }`
  - `classLists`: `string[]` — which classes can learn this spell
  - `description`: `string` — one-line description for display/narration

#### [File: domain/entities/spells/catalog/cantrips.ts] — NEW
- [ ] Define canonical cantrip entries: Eldritch Blast, Fire Bolt, Produce Flame, Sacred Flame, Ray of Frost, Toll the Dead, Chill Touch
- [ ] Each entry is a `const satisfies CanonicalSpell`

#### [File: domain/entities/spells/catalog/level-1.ts] — NEW
- [ ] Define canonical level 1 spell entries: Absorb Elements, Bless, Burning Hands, Cause Fear, Cure Wounds, Healing Word, Hellish Rebuke, Heroism, Longstrider, Magic Missile, Shield, Shield of Faith, Thunderous Ward, Guiding Bolt, Inflict Wounds, Mage Armor, Thunderwave

#### [File: domain/entities/spells/catalog/level-2.ts] — NEW
- [ ] Define canonical level 2 spell entries: Cloud of Daggers, Hold Person, Moonbeam, Scorching Ray, Spike Growth, Spirit Guardians, Shatter, Misty Step, Spiritual Weapon

#### [File: domain/entities/spells/catalog/level-3.ts] — NEW
- [ ] Define canonical level 3 spell entries: Counterspell, Fireball, Dispel Magic, Revivify, Mass Cure Wounds, Spirit Guardians (actually L3)

#### [File: domain/entities/spells/catalog/index.ts] — NEW
- [ ] Build `SPELL_CATALOG: ReadonlyMap<string, CanonicalSpell>` keyed by normalized lowercase name
- [ ] Export `getCanonicalSpell(name: string): CanonicalSpell | null`
- [ ] Export `listSpellsByLevel(level: number): CanonicalSpell[]`
- [ ] Export `listSpellsByClass(classId: string): CanonicalSpell[]`
- [ ] Export `listSpellsBySchool(school: string): CanonicalSpell[]`
- [ ] Export `SPELL_CATALOG` for iteration

#### [File: domain/entities/spells/index.ts] — MODIFY
- [ ] Add `export * from './catalog/index.js'`

### Phase 2: Lookup Indirection (wire catalog into combat paths)

#### [File: application/services/combat/helpers/spell-slot-manager.ts] — MODIFY
- [ ] Create `resolveSpell(spellName: string, sheet: unknown): PreparedSpellDefinition | null`
  - First: check canonical catalog via `getCanonicalSpell(name)`
  - Fallback: `findPreparedSpellInSheet(sheet, name)` for backward compat
  - If both exist: merge (catalog is base, sheet overrides for character-specific tweaks)
- [ ] Keep `findPreparedSpellInSheet()` as-is for backward compat

#### [File: application/services/combat/tabletop/spell-action-handler.ts] — MODIFY
- [ ] Replace `findPreparedSpellInSheet()` calls with `resolveSpell()`
- [ ] When spell found in catalog but not sheet, still allow casting (catalog IS the definition)

#### [File: application/services/combat/ai/handlers/cast-spell-handler.ts] — MODIFY
- [ ] Replace `findSpellDefinition()` / `findPreparedSpellInSheet()` with `resolveSpell()`

#### [File: application/services/combat/ai/handlers/ai-spell-delivery.ts] — MODIFY
- [ ] Replace `findSpellDefinition()` with `resolveSpell()` for spell lookup

#### [File: domain/entities/classes/combat-resource-builder.ts] — MODIFY
- [ ] Replace sheet.preparedSpells scan for Shield/Counterspell/etc with catalog lookup
  - Still check sheet list (character must have it prepared), but use catalog for ability data

### Phase 3: Simplify E2E Scenarios + Character Sheets

#### [File: All 25+ E2E scenario JSON files] — MODIFY
- [ ] Replace full inline `PreparedSpellDefinition` objects in `preparedSpells` arrays with name-only references: `{ "name": "Fire Bolt" }` (level still required for disambiguation)
- [ ] Actually: keep `{ "name": "Fire Bolt", "level": 0 }` minimal form — catalog provides all mechanics
- [ ] Verify each simplified scenario still passes E2E

#### [File: infrastructure/llm/mocks/index.ts] — MODIFY
- [ ] Update MockCharacterGenerator to populate `preparedSpells` from catalog based on class/level
- [ ] Use `listSpellsByClass()` to pick appropriate spells

#### [File: application/services/combat/ai/ai-context-builder.ts] — MODIFY
- [ ] Expose available spells list to AI decision context using catalog data

### Phase 4: Cleanup

#### [File: application/services/combat/tabletop/spell-action-handler.ts] — MODIFY
- [ ] Move Magic Missile hardcoded handler (~60 lines) to use catalog definition + generic delivery
  - Catalog entry can have `deliveryMode: "auto_hit_multi_dart"` or similar special tag

#### [File: application/services/combat/helpers/spell-slot-manager.ts] — MODIFY
- [ ] Add validation: warn if sheet spell definition conflicts with catalog definition

#### [File: application/services/entities/spell-lookup-service.ts] — MODIFY
- [ ] Wire `SpellLookupService` to use canonical catalog as primary data source
- [ ] Keep Prisma path as optional secondary

## Cross-Flow Risk Checklist
- [x] Do changes in one flow break assumptions in another? — No, Phase 2 is additive (catalog-first, sheet-fallback)
- [x] Does the pending action state machine still have valid transitions? — Not affected
- [x] Is action economy preserved? — Not affected
- [x] Do both player AND AI paths handle the change? — Yes, `resolveSpell()` serves both
- [x] Are repo interfaces + memory-repos updated if entity shapes change? — Not affected (catalog is static)
- [x] Is `app.ts` registration updated? — Not needed (static catalog, no DI)
- [x] Are D&D 5e 2024 rules correct? — Yes, sourced from RuleBookDocs/markdown/spell-descriptions.md

## Risks
- **Scenario JSON blast radius**: 25+ files changing format in Phase 3. Mitigated by running E2E after each file group.
- **Spell mechanics accuracy**: Manual curation of 40+ spell definitions. Mitigated by cross-referencing RuleBookDocs.
- **Backward compat**: Existing Prisma-stored characters have inline spell data. Mitigated by `resolveSpell()` fallback chain.
- **Magic Missile special case**: Currently hardcoded; needs careful extraction in Phase 4.

## Test Plan
- [ ] Unit tests for `getCanonicalSpell()`, `listSpellsByLevel()`, `listSpellsByClass()` 
- [ ] Unit tests for `resolveSpell()` — catalog hit, sheet fallback, merge behavior
- [ ] Unit tests verifying catalog entries match expected D&D 5e 2024 rules (spot-check ~10 spells)
- [ ] All existing E2E scenarios pass after Phase 3 simplification
- [ ] Integration test: MockCharacterGenerator produces casters with real spells
