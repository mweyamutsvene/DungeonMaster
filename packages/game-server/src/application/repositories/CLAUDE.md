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

## API Docs Alignment

- Canonical client API docs live in `docs/api/` (README + reference + guides).
- When changing routes, payloads, errors, events, or client integration loops, update the matching files in `docs/api/reference/` and `docs/api/guides/` in the same change.
- For SME research, agent reviews, and implementation plans that affect client contracts, cite and update the impacted docs under `docs/api/`.
- Treat these docs as done criteria for contract changes: `docs/api/reference/endpoints.md`, `docs/api/reference/schemas.md`, `docs/api/reference/events.md`, and `docs/api/reference/errors.md`.
