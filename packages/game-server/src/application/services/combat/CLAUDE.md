# Combat — Quick Constraints

Speak caveman. Keep short.

## Scope
`application/services/combat/`

## Map
- `tabletop/`: text + dice flow.
- `tabletop/dispatch/`: private dispatch handlers.
- `tabletop/rolls/`: private roll resolvers.
- `tabletop/spell-delivery/`: spell delivery handlers.
- `action-handlers/`: programmatic actions.
- `two-phase/`: reactions.
- `helpers/`: shared stateless helpers.
- `ai/`: AI turn logic.
- `abilities/`: registry + class executors.

Main facades:
`tabletop-combat-service.ts`, `action-service.ts`, `two-phase-action-service.ts`, `combat-service.ts`, `tactical-view-service.ts`.

## Laws
1. `tabletop`, `action`, `two-phase` facades stay thin. `combat-service` own turn life. `tactical-view-service` build view/query data.
2. Handler folders are private to owner facade.
3. `helpers/` shared by combat modules, must stay stateless.
4. `combat-service.ts` owns combat lifecycle.
5. New handlers use constructor `(deps, eventEmitter, debugLogsEnabled)`.

## API Docs Alignment

- Canonical client API docs live in `docs/api/` (README + reference + guides).
- When changing routes, payloads, errors, events, or client integration loops, update the matching files in `docs/api/reference/` and `docs/api/guides/` in the same change.
- For SME research, agent reviews, and implementation plans that affect client contracts, cite and update the impacted docs under `docs/api/`.
- Treat these docs as done criteria for contract changes: `docs/api/reference/endpoints.md`, `docs/api/reference/schemas.md`, `docs/api/reference/events.md`, and `docs/api/reference/errors.md`.
