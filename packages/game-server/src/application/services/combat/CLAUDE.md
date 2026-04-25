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
