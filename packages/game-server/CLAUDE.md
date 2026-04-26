# Game Server — Quick Laws

Speak caveman. Keep short.

## DDD
- `src/domain/`: pure rules. No Fastify/Prisma/LLM imports.
- `src/application/`: use-cases, services, repo ports.
- `src/infrastructure/`: API, Prisma, LLM, in-memory repos.

## Combat Flow (2-Phase)
State machine asks player for dice:
initiative -> start -> move (OA check) -> attack roll -> hit/miss -> damage roll -> apply.

Per turn economy: 1 action, 1 bonus, 1 reaction, and a movement budget in feet.

## Important
- Session routes split under `infrastructure/api/routes/sessions/` (see `SESSION_API_REFERENCE.md`).
- LLM optional. Missing provider must not break.
- Domain errors map to HTTP in `app.ts`.
- Test files: `*.test.ts`, `*.integration.test.ts`, `*.llm.test.ts`.
- Keep in-memory repos synced with repo interfaces.
- Wild Shape runtime state lives in `resources.wildShapeForm`; use `wild-shape-form-helper.ts` for projection/routing.
