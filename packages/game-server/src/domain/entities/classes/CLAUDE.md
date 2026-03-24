# ClassAbilities — Architectural Constraints

## Scope
`domain/entities/classes/`, `domain/abilities/`, `application/services/combat/abilities/executors/`

## Three Patterns (all must be followed)

**Pattern 1 — ClassCombatTextProfile**: Domain class files declare regex→action mappings, attack enhancements, and attack reactions. Collected by `getAllCombatTextProfiles()` in `registry.ts`. Services consume via generic interface — never hardcode class-specific detection in application code.

**Pattern 2 — AbilityRegistry**: Executors implementing `AbilityExecutor` interface live in `executors/<class>/`. Registered in `app.ts` (BOTH main AND test). Bonus actions route through `handleBonusAbility()` (consumes bonus action economy). Free abilities route through `handleClassAbility()`.

**Pattern 3 — Feature Maps**: Boolean eligibility gates use `CharacterClassDefinition.features` (Record<string, number>) with constants from `feature-keys.ts`. Check via `classHasFeature(classId, feature, level)` which normalizes classId to lowercase. **NEVER add boolean has*() methods to ClassFeatureResolver** — it is for computed values only (attacks per action, unarmed stats).

## Laws
1. **Domain-first** — all class-specific detection, eligibility, and text matching MUST live in domain class files, NOT in application services.
2. **Subclass-gated features** — features map provides the level gate (necessary condition), executor's `canExecute()` guards the subclass (sufficient condition). Both are required.
3. **New executor registration** — must be added to BOTH the main app registry AND test registry in `app.ts`.
