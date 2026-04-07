# Plan: Orphaned Prisma Tables (ENT-L1)

## Problem
Three tables in `prisma/schema.prisma` have no read/write path in application code. They were created with future intent but are currently orphaned. Their status needs to be documented and a decision made.

## The Three Tables

### 1. `ClassFeatureDefinition`
- **Current state**: Orphaned. Class features are declared as static TypeScript data in `domain/entities/classes/*.ts` files with the `features?: Record<string, number>` map and queried via `classHasFeature()` / `hasFeature()` from `registry.ts`.
- **Prisma comment**: `/// ORPHANED: No application code reads or writes this table. All class feature checks use the in-code features map on CharacterClassDefinition + feature-keys.ts.`
- **Options**:
  - **DROP** — Remove entirely. All class features live in code; DB adds no value.
  - **IMPLEMENT** — Store class features in DB so DMs can add/override features without recompiling.
  - **KEEP-FOR-FUTURE** — Leave as schema placeholder with no code until a homebrew/custom class need arises.
- **Recommended**: KEEP-FOR-FUTURE. Low risk, and enables homebrew class feature storage without a migration.

### 2. `ItemDefinition`
- **Current state**: Orphaned. All magic items served from `domain/entities/items/magic-item-catalog.ts` static catalog.
- **Prisma comment**: `/// ORPHANED: No application code reads or writes this table. All items are served from the static in-memory catalog in magic-item-catalog.ts.`
- **Full implementation plan**: `.github/prompts/plan-custom-item-catalog.prompt.md`
- **Options**:
  - **DROP** — Remove the table; items will always be code-defined.
  - **IMPLEMENT** — Wire up for DM-custom item definitions. See plan above.
  - **KEEP-FOR-FUTURE** — Leave as placeholder.
- **Recommended**: KEEP-FOR-FUTURE. See linked plan for full implementation details.

### 3. `ConditionDefinition`
- **Current state**: Orphaned. All conditions are pure TypeScript in `domain/entities/combat/conditions.ts`.
- **Prisma comment**: `/// ORPHANED: No application code reads or writes this table. All condition logic lives in domain/entities/combat/conditions.ts as pure functions.`
- **Options**:
  - **DROP** — Remove entirely. Conditions are rules data, not user data — DB storage adds complexity with no benefit.
  - **IMPLEMENT** — Store condition definitions in DB for rules-reference lookup or custom conditions.
  - **KEEP-FOR-FUTURE** — Leave as placeholder for homebrew condition storage.
- **Recommended**: DROP or KEEP-FOR-FUTURE. Unlike items, conditions are rarely customized.

## Decision Summary

| Table | Recommended | Rationale |
|-------|-------------|-----------|
| `ClassFeatureDefinition` | KEEP-FOR-FUTURE | Enables homebrew class features without migration |
| `ItemDefinition` | KEEP-FOR-FUTURE | Custom DM items are a plausible near-term need |
| `ConditionDefinition` | KEEP-FOR-FUTURE or DROP | Low value; pure rules data |

## If Deciding to DROP

1. Remove the model blocks from `prisma/schema.prisma`
2. Run `pnpm -C packages/game-server prisma migrate dev --name drop-orphaned-tables`
3. Verify no code references the table names

## If Deciding to IMPLEMENT

For each table, follow the Repository Pattern:
1. Create `IXxxRepository` interface in `application/repositories/`
2. Create `PrismaXxxRepository` in `infrastructure/db/`
3. Add in-memory implementation in `infrastructure/testing/memory-repos.ts`
4. Wire into `app.ts`
5. Add tests

## Related
- Class features: `domain/entities/classes/feature-keys.ts`, `domain/entities/classes/registry.ts`
- Conditions: `domain/entities/combat/conditions.ts`
- Items: `domain/entities/items/magic-item-catalog.ts`, `.github/prompts/plan-custom-item-catalog.prompt.md`
