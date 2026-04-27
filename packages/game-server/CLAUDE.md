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

## API Docs Alignment

- Canonical client API docs live in `docs/api/` (README + reference + guides).
- When changing routes, payloads, errors, events, or client integration loops, update the matching files in `docs/api/reference/` and `docs/api/guides/` in the same change.
- For SME research, agent reviews, and implementation plans that affect client contracts, cite and update the impacted docs under `docs/api/`.
- Treat these docs as done criteria for contract changes: `docs/api/reference/endpoints.md`, `docs/api/reference/schemas.md`, `docs/api/reference/events.md`, and `docs/api/reference/errors.md`.
