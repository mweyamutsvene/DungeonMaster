# Domain Combat Entities — Quick Constraints

Speak caveman. Keep short.

## Scope
`domain/entities/combat/*`

## Laws
1. Keep pure data + helpers. No app/infra import.
2. Action economy shape here is source for action/bonus/reaction/move budget.
3. Pending action types here are source for reaction/tabletop pending unions.
4. If enum/union change, update all consumers same pass (tabletop, two-phase, API, tests).
5. Do not hide ownership. Flow instructions stay primary law.
## API Docs Alignment

- Canonical client API docs live in `docs/api/` (README + reference + guides).
- When changing routes, payloads, errors, events, or client integration loops, update the matching files in `docs/api/reference/` and `docs/api/guides/` in the same change.
- For SME research, agent reviews, and implementation plans that affect client contracts, cite and update the impacted docs under `docs/api/`.
- Treat these docs as done criteria for contract changes: `docs/api/reference/endpoints.md`, `docs/api/reference/schemas.md`, `docs/api/reference/events.md`, and `docs/api/reference/errors.md`.
