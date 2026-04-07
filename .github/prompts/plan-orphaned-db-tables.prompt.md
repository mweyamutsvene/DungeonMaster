# Plan: Prisma Tables Previously Flagged as Orphaned (ENT-L1)

## Problem
Older audit notes treated three Prisma tables as orphaned. Current codebase state is mixed:
- `ItemDefinition` is now implemented and active.
- `ClassFeatureDefinition` and `ConditionDefinition` remain intentionally unused placeholders.

This plan applies the practical path for today: keep the two placeholders explicitly marked for future use, and document `ItemDefinition` as active.

## Final Decisions (Current Codebase)

### 1. `ClassFeatureDefinition`
- **Current state**: Orphaned by design.
- **Live behavior**: Class features are sourced from in-code class definitions (`features?: Record<string, number>`) and queried via `classHasFeature()` / `hasFeature()`.
- **Final decision**: **KEEP-FOR-FUTURE**.
- **Why now**: Homebrew/custom class feature persistence is plausible later, but not needed for current deterministic rules flow.
- **Schema/doc requirement**: Keep explicit `KEEP-FOR-FUTURE (ORPHANED)` comment in Prisma schema so no one assumes it is wired.

### 2. `ItemDefinition`
- **Current state**: Implemented and active (not orphaned).
- **Live behavior**: Runtime/custom items are persisted via `IItemDefinitionRepository` and `PrismaItemDefinitionRepository`; `ItemLookupService` checks DB first, then falls back to `magic-item-catalog.ts`.
- **Final decision**: **IMPLEMENTED - KEEP ACTIVE**.
- **Why now**: This supports runtime custom item definitions while preserving static-catalog fallback.
- **Schema/doc requirement**: Prisma schema must describe this table as active and document DB-first lookup with static fallback.

### 3. `ConditionDefinition`
- **Current state**: Orphaned by design.
- **Live behavior**: Condition logic is deterministic TypeScript in `domain/entities/combat/conditions.ts`; no repository path reads/writes this table.
- **Final decision**: **KEEP-FOR-FUTURE**.
- **Why now**: Custom condition persistence is low priority; dropping now adds migration churn with little benefit.
- **Schema/doc requirement**: Keep explicit `KEEP-FOR-FUTURE (ORPHANED)` comment in Prisma schema.

## Practical Path Selected

1. Do not run drop migrations now.
2. Do not add new repositories or wiring for class features/conditions now.
3. Update schema comments and plan docs to match actual behavior exactly.
4. Add tests only if runtime behavior changes.

## Related
- Class features: `domain/entities/classes/feature-keys.ts`, `domain/entities/classes/registry.ts`
- Conditions: `domain/entities/combat/conditions.ts`
- Items: `application/services/entities/item-lookup-service.ts`, `infrastructure/db/item-definition-repository.ts`, `domain/entities/items/magic-item-catalog.ts`
