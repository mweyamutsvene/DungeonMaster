# Plan: Client API Documentation Set
## Round: 1
## Status: COMPLETE
## Affected Flows: CombatOrchestration, EntityManagement, SpellSystem, AIBehavior

## Objective
Produce a rigorous, client-consumable API documentation set based on implementation truth from backend route modules plus player-cli usage. Organize the docs in an industry-style structure with endpoint references, request/response contracts, event contracts, and integration flow guides for tabletop combat/reactions/AI turns.

## Changes
### Research Synthesis
#### File: plans/sme-research-CombatOrchestration-api-docs-2026-04-26.md
- [x] Capture combat orchestration endpoint contracts and state-machine semantics.
#### File: plans/sme-research-EntityManagement-api-docs-2026-04-26.md
- [x] Capture session/entity/rest/inventory lifecycle and request/response rules.
#### File: plans/sme-research-SpellSystem-api-docs-2026-04-26.md
- [x] Capture spell/reaction branch semantics and payload constraints.
#### File: plans/sme-research-AIBehavior-api-docs-2026-04-26.md
- [x] Capture AI turn timing semantics and SSE expectations.

### Documentation Implementation
#### File: docs/api/README.md
- [x] Create API doc entrypoint with navigation and contract boundaries.
#### File: docs/api/reference/endpoints.md
- [x] Document complete endpoint inventory grouped by domain and usage.
#### File: docs/api/reference/schemas.md
- [x] Document shared payload schemas, IDs, and polymorphic response patterns.
#### File: docs/api/reference/errors.md
- [x] Document error envelope and common validation failure patterns.
#### File: docs/api/reference/events.md
- [x] Document SSE and JSON event endpoints, event lifecycle, and payload conventions.
#### File: docs/api/guides/client-turn-loop.md
- [x] Document robust client control loop for tabletop + reactions + interrupts.
#### File: docs/api/guides/player-cli-mapping.md
- [x] Map player-cli GameClient methods to backend endpoints for implementation reference.
#### File: docs/api/guides/ai-turn-observability.md
- [x] Document AI turn sequencing, async behavior, and client synchronization strategy.

## Cross-Flow Risk Checklist
- [x] Do changes in one flow break assumptions in another?
- [x] Does the pending action state machine still have valid transitions?
- [x] Is action economy preserved (1 action, 1 bonus, 1 reaction, 1 movement)?
- [x] Do both player AND AI paths handle the change?
- [x] Are repo interfaces + memory-repos updated if entity shapes change?
- [x] Is `app.ts` registration updated if adding executors?
- [x] Are D&D 5e 2024 rules correct (not 2014)?

## Risks
- Route behavior can drift from docs if endpoint contracts change without docs updates.
- Some response payloads are polymorphic and conditionally populated; docs must clearly annotate conditional fields.
- A few inconsistencies exist in current implementation (e.g., `GET /sessions/:id` currently omits NPCs in response despite internal fetch).

## Test Plan
- [x] Validate endpoint inventory against route declarations in `packages/game-server/src/infrastructure/api/routes/**`.
- [x] Validate client mapping against `packages/player-cli/src/game-client.ts` and `packages/player-cli/src/combat-repl.ts`.
- [x] Validate that docs explicitly cover reaction and AI async sequencing edge cases.

## SME Approval (Complex only)
- [x] CombatOrchestration-SME
- [x] EntityManagement-SME
- [x] SpellSystem-SME
- [x] AIBehavior-SME
