# SME Research — EntityManagement — EM-M1: Basic Multiclassing Support
**Scope**: Character entity, CharacterService, Prisma schema, CombatResourceBuilder, ClassFeatureResolver, hydration, and all className/classId consumers.
**Files investigated**: 15+ source files across domain, application, and infrastructure layers.

---

## Current State

### Character entity (`domain/entities/creatures/character.ts`)
- `CharacterData` interface: `level: number`, `characterClass: string`, `classId?: CharacterClassId`, `subclass?: string`, `subclassLevel?: number`
- `Character` class stores private fields with getters: `getLevel()`, `getClass()`, `getClassId()`, `getSubclass()`
- **No `classLevels` array exists** — strictly single-class
- Constructor infers `classId` from `characterClass` via `isCharacterClassId()`
- `levelUp()` assumes single class: increments level, recomputes HP via single `hitDie`, calls `defaultResourcePoolsForClass({ classId, level })`
- `takeRest()` delegates to `refreshClassResourcePools()` with single classId/level
- `getAC()` checks single `this.classId` for Unarmored Defense (barbarian/monk)
- `toJSON()` serializes single `class`/`classId`

### Prisma schema — `SessionCharacter` model
- `level Int`, `className String?` — single class, no multiclass columns or JSON

### SessionCharacterRecord (`application/types.ts`)
- `level: number`, `className: string | null` — mirrors Prisma, no multiclass fields

### ICharacterRepository (`application/repositories/character-repository.ts`)
- `createInSession()` input: `{ id, name, level, className, sheet }` — single class

### MemoryCharacterRepository (`infrastructure/testing/memory-repos.ts`)
- Mirrors `ICharacterRepository` — returns `SessionCharacterRecord` with single className/level

### CharacterService (`application/services/entities/character-service.ts`)
- `addCharacter()`: validates `className` against class registry, stores single class
- `takeSessionRest()` (line ~163): reads `char.className` for resource refresh

### CombatResourceBuilder (`domain/entities/classes/combat-resource-builder.ts`)
- Input: `{ className: string; level: number; sheet }` — single class
- `buildCombatResources()`: single `classId`, calls `getClassDefinition()` once, `resourcesAtLevel()` once
- Pact Magic detection hardcoded: `if (classId === "warlock" ...)`

### InitiativeHandler (`combat/tabletop/rolls/initiative-handler.ts`)
- `buildCombatantResources(className, level, sheet)` → single-class resources
- Danger Sense effect hardcoded: `className.toLowerCase() === "barbarian"`
- Called per-character at combat start

### Creature hydration (`combat/helpers/creature-hydration.ts`)
- `hydrateCharacter()`: sets `characterClass: record.className ?? 'Fighter'`, `classId: sheet.classId ?? record.className?.toLowerCase()`
- Single-class assumption throughout

### Registry's multi-class function (EXISTS but UNUSED)
- `hasFeature(classLevels: Array<{classId, level}>, feature)` in `registry.ts:127` — multi-class ready
- `classHasFeature(classId, feature, level)` — single-class, used in 40+ call sites

---

## Affected Files (with rationale)

| File | Change Needed |
|------|---------------|
| `domain/entities/creatures/character.ts` | Add `classLevels` to `CharacterData`, add `getClassLevels()` normalizer, update `levelUp()`, `takeRest()`, `getAC()`, `toJSON()` |
| `application/types.ts` | Decide: add field to `SessionCharacterRecord` OR rely on `sheet` JSON |
| `prisma/schema.prisma` | Either add `classLevels Json?` column or store in `sheet` |
| `application/repositories/character-repository.ts` | Update `createInSession` input if new column |
| `infrastructure/testing/memory-repos.ts` | Mirror repo interface changes |
| `infrastructure/db/character-repository.ts` | Mirror Prisma schema changes |
| `application/services/entities/character-service.ts` | Accept `classLevels` in `addCharacter()`, use in rest logic |
| `domain/entities/classes/combat-resource-builder.ts` | Accept class array, iterate ALL classes for resource pools |
| `combat/tabletop/rolls/initiative-handler.ts` | Pass multi-class info into `buildCombatantResources()` |
| `combat/helpers/creature-hydration.ts` | Read `classLevels` from sheet/record, construct `CharacterData` with it |
| `domain/entities/classes/class-feature-resolver.ts` | Add multi-class overloads or forward to `hasFeature(classLevels)` |
| `domain/rules/class-resources.ts` | `defaultResourcePoolsForClass` needs multi-class iteration |
| `domain/rules/rest.ts` | `refreshClassResourcePools` needs multi-class iteration |

### Downstream consumers reading single className/classId (13+ call sites):
- `combat-service.ts:1295` — `creatureHasEvasion(char.className)`
- `hit-rider-resolver.ts:77,87` — profiles filter by single `actorClassName`
- `saving-throw-resolver.ts:235,265` — Paladin aura check
- `attack-reaction-handler.ts:153,733` — target class for reaction detection
- `spell-reaction-handler.ts:107` — other caster class check
- `session-tabletop.ts:106,125` — class for roll-result flow
- `tactical-view-service.ts:422,435` — actor class for tactical display
- `combatant-resolver.ts:207` — className for combat stats
- `executor-helpers.ts:83` — `actorRef.getClassId()` returns single ID
- `creature-abilities.ts:16` — `creature.getClassId()` for ability lookup
- `ai-context-builder.ts:513` — `getClassAbilities(className, level)`
- `tabletop-utils.ts:74` — Feral Instinct check on single className

---

## Key Design Decision: Where to store classLevels

| Option | Pros | Cons |
|--------|------|------|
| **A: New Prisma column `classLevels Json?`** | Explicit, visible at DB level | Migration needed, dual-source with className+level |
| **B: Store in `sheet` JSON** | No schema change, no migration | Less visible, requires hydration extraction |

**Recommendation: Option B** (store in `sheet.classLevels`). The `sheet` JSON already carries arbitrary class data (`className`, `subclass`, `classId`, etc.), and hydration already reads from it. No migration needed. The record-level `className` and `level` remain as the "primary" class for backward compat.

---

## D&D 5e Multiclass Rules That Affect Implementation

1. **Total character level** = sum of all class levels. Used for: proficiency bonus, cantrip scaling, HP total, XP thresholds.
2. **Individual class level** = per-class. Used for: feature eligibility, resource pool sizes, Extra Attack, hit die type for HP.
3. **Proficiency bonus** comes from TOTAL level: `Math.floor((totalLevel-1)/4) + 2`.
4. **Extra Attack doesn't stack**: Fighter 5 / Monk 5 gets it from either, not both. Highest tier wins.
5. **Spell slots**: Multiclass spellcasters have a SHARED slot table based on combined caster levels (with half-caster/third-caster weighting). Current sheet-based `spellSlots` field can express this — the complex calculation is a future concern.
6. **HP**: Each level-up adds hit die from the class being leveled. A Fighter 3 / Wizard 2 has 3d10 + 2d6 hit dice.
7. **Resource pools per class**: Ki from Monk levels only, Rage from Barbarian levels only, etc. No collisions expected since pool names are class-prefixed.

---

## Dependencies That Could Break

1. **HitRiderResolver** (line 87): `profiles.filter(p => p.classId === actorClassName)` — only matches ONE class. Multi-class needs to match ANY class.
2. **CombatTextProfile matching**: `matchAttackEnhancements()` / `detectAttackReactions()` filter profiles by classId — need to check all classes.
3. **AI context builder**: `getClassAbilities(className, level)` returns abilities for ONE class. Multi-class character's AI behavior would be incomplete.
4. **Feral Instinct check** in `tabletop-utils.ts`: hardcoded `className === "barbarian"`. Would miss a multi-class barbarian.
5. **All 13+ `char.className` call sites** above need a strategy: check all classes or just "primary" class.

---

## Risks

1. **Blast radius**: 13+ call sites read `className` as a single string. Changing all at once is risky. A phased approach (add `getClassLevels()` first, migrate consumers incrementally) is safer.
2. **E2E test scenarios**: All 43+ scenarios assume single-class. Multi-class must be opt-in and backward-compatible — when `classLevels` is absent/empty, behavior must be unchanged.
3. **Resource pool name conflicts**: Unlikely since pools are class-prefixed (e.g., `ki`, `rage`, `actionSurge`), but should be validated.
4. **Hit points computation**: `levelUp()` currently uses single hitDie. Multi-class levelUp needs to know WHICH class is being leveled to pick the right hit die. The `levelUp()` API needs a `targetClassId` parameter.

---

## Recommendations

1. **Phase 1 (safe, backward-compat)**: Add `classLevels?: Array<{classId, level, subclass?}>` to `CharacterData`. Implement `getClassLevels()` that returns `[{classId: this.classId, level: this.level, subclass: this.subclass}]` when classLevels is absent. All new code uses `getClassLevels()` — existing single-class getters remain for backward compat.
2. **Phase 2**: Update `CombatResourceBuilder` to accept `classLevels` array and iterate all classes. Update `buildCombatantResources()` in initiative handler.
3. **Phase 3**: Migrate feature-check consumers from `classHasFeature(singleClass, feature, level)` to `hasFeature(getClassLevels(), feature)` — one call site at a time.
4. **Phase 4**: Update hydration to read `sheet.classLevels` and populate `CharacterData.classLevels`.
5. **Don't change Prisma schema** — store in sheet JSON. Keep `className`/`level` as the primary class.
6. **Total level**: `getLevel()` should return sum of classLevels when present. Keep existing `level` field as-is for backward compat; `getLevel()` prioritizes classLevels sum.
