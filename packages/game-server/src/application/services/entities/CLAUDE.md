# EntityManagement — Architectural Constraints

## Scope
`services/entities/*`, `domain/entities/creatures/*`, `application/repositories/*`, `infrastructure/db/*`

## Laws
1. **Repository pattern** — all persistence through interfaces in `application/repositories/`. Prisma for prod, in-memory for tests.
2. **Repo interface changes** require updating BOTH Prisma implementations in `infrastructure/db/` AND in-memory repos in `infrastructure/testing/memory-repos.ts`.
3. **Hydration helpers** enrich raw DB entities with computed fields. Entity shape changes ripple through hydration.
4. **Session events** fire on entity changes — event payloads must match SSE subscriber expectations.
