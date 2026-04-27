# Domain Abilities — Quick Constraints

Speak caveman. Keep short.

## Scope
`domain/abilities/*`

## Laws
1. Keep ability contracts and constants domain-first and pure.
2. No app/infra imports from here.
3. Ability IDs and feature keys must match executor registry and profile mappings.
4. If contract changes, update executors/tests in same change.
5. Follow `.github/instructions/class-abilities.instructions.md` as primary law.

## API Docs Alignment

- Canonical client API docs live in `docs/api/` (README + reference + guides).
- When changing routes, payloads, errors, events, or client integration loops, update the matching files in `docs/api/reference/` and `docs/api/guides/` in the same change.
- For SME research, agent reviews, and implementation plans that affect client contracts, cite and update the impacted docs under `docs/api/`.
- Treat these docs as done criteria for contract changes: `docs/api/reference/endpoints.md`, `docs/api/reference/schemas.md`, `docs/api/reference/events.md`, and `docs/api/reference/errors.md`.
