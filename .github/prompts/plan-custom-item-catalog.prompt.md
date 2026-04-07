# Plan: Custom / Runtime Item Definitions via Prisma (ENT-M8)

## Problem
All magic items are currently served from a static in-memory catalog (`domain/entities/items/magic-item-catalog.ts`). The `ItemDefinition` Prisma table exists in the schema but has no read/write path. There is no way for a DM to add custom items at runtime without editing TypeScript source.

## Goal
Allow a DM (or future admin UI) to define custom magic items stored in the database, while keeping the static catalog for standard items.

## Decision: Current State
**Static catalog is the right default.** No DB overhead for items that never change. Implement Prisma-backed items only when runtime customization is explicitly needed.

## When to Implement
Implement if any of these become true:
- A DM admin endpoint is needed to add/modify items during a session
- Items need per-campaign variant data (different bonuses, custom lore)
- The number of catalog items grows beyond ~200 and compile-time overhead matters

## Implementation Plan (when the time comes)

### 1. Repository Layer
- Add `IItemDefinitionRepository` interface in `application/repositories/`
- Methods: `findById(id)`, `findByName(name)`, `listAll()`, `upsert(item)`
- Implement `PrismaItemDefinitionRepository` in `infrastructure/db/`
- Add in-memory implementation in `infrastructure/testing/memory-repos.ts`

### 2. Lookup Service
- Extend `magic-item-catalog.ts` (or create `item-lookup-service.ts`) to check DB first, fall back to static catalog
- Signature: `async lookupItem(nameOrId: string): Promise<MagicItemDefinition | null>`

### 3. Prisma Schema (already exists)
```prisma
model ItemDefinition {
  id       String @id
  name     String @unique
  category String
  data     Json   // MagicItemDefinition shape
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```
- The `data` column stores the full `MagicItemDefinition` JSON
- Add a migration only when implementation begins

### 4. Admin Endpoint (optional)
- `POST /admin/items` — create a custom item
- `PATCH /admin/items/:id` — update a custom item
- Only accessible with DM credentials (session owner)

### 5. Session Inventory Integration
- `session-inventory.ts` currently calls `lookupMagicItem(name)` (static)
- Replace with async `itemLookupService.lookupItem(name)` that checks DB first

## Files to Modify
| File | Change |
|------|--------|
| `application/repositories/item-definition-repository.ts` | New interface |
| `infrastructure/db/item-definition-repo.ts` | New Prisma implementation |
| `infrastructure/testing/memory-repos.ts` | Add in-memory implementation |
| `domain/entities/items/magic-item-catalog.ts` | Extract to `ItemLookupService` or add DB fallback |
| `infrastructure/api/routes/sessions/session-inventory.ts` | Use async lookup |
| `infrastructure/api/app.ts` | Wire up new repo + service |

## Tests Needed
- Unit: `IItemDefinitionRepository` in-memory CRUD
- Integration: Custom item created via Prisma is found by inventory lookup
- E2E scenario: DM creates a custom item, character equips it, combat uses it
