# EntityManagement — Quick Constraints

Speak caveman. Keep short.

## Scope
`services/entities/*`, `domain/entities/creatures/*`, `application/repositories/*`, `application/types.ts`, `infrastructure/db/*`, `infrastructure/testing/memory-repos.ts`.

## Laws
1. All persistence goes through `application/repositories/` interfaces.
2. Interface change means update both Prisma and in-memory repos.
3. Hydration depends on entity shape; shape changes ripple.
4. If session event fire, payload must match SSE client expectation. Keep route path and service path explicit.
5. Character and session use services. Monster and NPC often go route -> repo -> UoW. No fake service story.
6. Item lookup and inventory wiring live here as app services. Inventory mechanics/semantics are owned by InventorySystem docs.
7. If record shape changes, fix `application/types.ts`, Prisma repos, and memory repos together.
