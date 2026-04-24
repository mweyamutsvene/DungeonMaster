# Game Server — Architectural Context

## DDD Layers
- `src/domain/` — pure game logic. NO Fastify, Prisma, or LLM imports.
- `src/application/` — use-cases, services, repository interfaces (ports). Errors in `application/errors.ts`.
- `src/infrastructure/` — adapters: Fastify API, Prisma repos, LLM providers, test in-memory repos.

## Combat System (2-Phase Tabletop Flow)
Pending-action state machine where the server requests dice rolls from the player:
1. Initiate → server requests initiative roll
2. Submit initiative → combat starts, first turn
3. Action (move) → may trigger REACTION_CHECK for opportunity attacks
4. Action (attack) → server requests attack roll
5. Submit attack roll → hit/miss; if hit, requests damage roll
6. Submit damage roll → damage applied

### Action economy per turn
1 Action, 1 Bonus Action, 1 Movement, 1 Reaction. Free abilities (Action Surge) don't consume action economy.

## Key Architectural Rules
- Session routes live under `infrastructure/api/routes/sessions/` split by concern (actions, characters, combat, creatures, crud, events, inventory, llm, tabletop, tactical) — see `SESSION_API_REFERENCE.md`
- LLM adapters must tolerate "LLM not configured" gracefully — LLM is always optional
- Domain errors (`NotFoundError`, `ValidationError`) map to HTTP status codes via Fastify error handler in `app.ts`
- Test files: `*.test.ts` (unit), `*.integration.test.ts`, `*.llm.test.ts`
- In-memory repos in `infrastructure/testing/memory-repos.ts` must stay in sync with repository interfaces
