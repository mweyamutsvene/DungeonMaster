# DungeonMaster Client API Docs

This documentation describes the client-facing HTTP and SSE contracts for DungeonMaster.
It is implementation-faithful to:

- `packages/game-server/src/infrastructure/api/routes/**`
- `packages/player-cli/src/game-client.ts`
- `packages/player-cli/src/combat-repl.ts`

## Audience

- Web/mobile client developers
- CLI/integration developers
- QA automation authors

## Structure

- `reference/endpoints.md`: endpoint catalog (method/path, purpose, request, response)
- `reference/schemas.md`: shared payloads, IDs, and polymorphic response contracts
- `reference/errors.md`: error envelope and common failures
- `reference/events.md`: SSE and events-json contracts, event lifecycle
- `guides/client-turn-loop.md`: robust tabletop client loop (rolls, reactions, interrupts)
- `guides/player-cli-mapping.md`: player-cli method to endpoint mapping
- `guides/ai-turn-observability.md`: AI turn timing and synchronization patterns

## Contract Notes

- Backend is source of truth. If docs and code diverge, follow route implementation.
- Many combat responses are conditional and polymorphic. Branch on `type`, `requiresPlayerInput`, and `rollType`.
- Two pending action systems exist: encounter-level `pendingAction` and repository-backed reaction pending actions.
