# Repository Interfaces — Quick Constraints

Speak caveman. Keep short.

## Scope
`application/repositories/*`

## Laws
1. Repos are app-layer ports only. No Prisma details in interfaces.
2. Interface changes must update Prisma adapters and memory repos together.
3. Keep return/input shapes aligned with `application/types.ts`.
4. Keep transaction behavior compatible with UnitOfWork usage.
5. Follow `.github/instructions/entity-management.instructions.md` as primary law.
