# EntityManagement — Quick Constraints

Speak caveman. Keep short.

## Scope
`services/entities/*`, `domain/entities/creatures/*`, `application/repositories/*`, `application/types.ts`, `infrastructure/db/*`, `infrastructure/testing/memory-repos.ts`.

## Laws
1. All persistence goes through `application/repositories/` interfaces.
2. Interface change means update both Prisma and in-memory repos.
3. Hydration depends on entity shape; shape changes ripple.
4. Session events must fire with payloads SSE clients expect.
5. Character and session use services. Monster and NPC often go route -> repo -> UoW. No fake service story.
6. Item lookup and inventory live here as app services. Static item catalogs live in InventorySystem docs.
7. If record shape changes, fix `application/types.ts`, Prisma repos, and memory repos together.
