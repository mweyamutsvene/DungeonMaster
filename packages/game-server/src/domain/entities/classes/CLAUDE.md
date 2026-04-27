# ClassAbilities — Quick Constraints

Speak caveman. Keep short.

## Scope
`domain/entities/classes/`, `domain/abilities/`, `application/services/combat/abilities/executors/`

## Three Required Patterns
1. `ClassCombatTextProfile`: regex/action + enhancements + reactions in domain class files. Collected by `registry.ts`.
2. `AbilityRegistry`: executors in `executors/<class>/`. Main app register in `buildApp`. Some tests build small registry by hand too.
3. Feature maps: use `features` + `feature-keys.ts` + `classHasFeature(...)`.

Subclass can bring own feature map and own combat text profile. Registry grab class stuff and subclass stuff both.

## Laws
1. Domain-first always. No class-specific detection logic in app layer.
2. Subclass feature gating needs both level gate and subclass check.
3. Combat-start pools and flags live in `combat-resource-builder.ts`. If reaction need prep flag, style flag, or gear flag, wire builder or reaction sleep forever.
4. Do not add boolean `has*()` methods to `ClassFeatureResolver`.

## API Docs Alignment

- Canonical client API docs live in `docs/api/` (README + reference + guides).
- When changing routes, payloads, errors, events, or client integration loops, update the matching files in `docs/api/reference/` and `docs/api/guides/` in the same change.
- For SME research, agent reviews, and implementation plans that affect client contracts, cite and update the impacted docs under `docs/api/`.
- Treat these docs as done criteria for contract changes: `docs/api/reference/endpoints.md`, `docs/api/reference/schemas.md`, `docs/api/reference/events.md`, and `docs/api/reference/errors.md`.
