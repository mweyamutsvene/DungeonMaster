# Creature Entities — Quick Constraints

Speak caveman. Keep short.

## Scope
`domain/entities/creatures/*`

## Laws
1. Creature shape is shared contract for hydration and combat.
2. Keep entity logic deterministic and domain-only.
3. AC, conditions, defenses, and status behavior stay in entity/rule layer, not API layer.
4. Shape change means update hydration/repos/tests together.
5. Follow `.github/instructions/entity-management.instructions.md` and `.github/instructions/creature-hydration.instructions.md`.

## API Docs Alignment

- Canonical client API docs live in `docs/api/` (README + reference + guides).
- When changing routes, payloads, errors, events, or client integration loops, update the matching files in `docs/api/reference/` and `docs/api/guides/` in the same change.
- For SME research, agent reviews, and implementation plans that affect client contracts, cite and update the impacted docs under `docs/api/`.
- Treat these docs as done criteria for contract changes: `docs/api/reference/endpoints.md`, `docs/api/reference/schemas.md`, `docs/api/reference/events.md`, and `docs/api/reference/errors.md`.
