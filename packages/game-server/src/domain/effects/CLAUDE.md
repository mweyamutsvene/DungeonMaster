# Domain Effects — Quick Constraints

Speak caveman. Keep short.

## Scope
`domain/effects/*`

## Laws
1. Effect model and behavior stay deterministic and pure.
2. No infra imports. No DB/API/LLM coupling.
3. Keep effect semantics aligned with combat cleanup timing.
4. If effect contract changes, update domain users and tests together.
5. Follow `.github/instructions/combat-rules.instructions.md` as primary law.

## API Docs Alignment

- Canonical client API docs live in `docs/api/` (README + reference + guides).
- When changing routes, payloads, errors, events, or client integration loops, update the matching files in `docs/api/reference/` and `docs/api/guides/` in the same change.
- For SME research, agent reviews, and implementation plans that affect client contracts, cite and update the impacted docs under `docs/api/`.
- Treat these docs as done criteria for contract changes: `docs/api/reference/endpoints.md`, `docs/api/reference/schemas.md`, `docs/api/reference/events.md`, and `docs/api/reference/errors.md`.
