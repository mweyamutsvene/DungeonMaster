# Domain Combat — Quick Constraints

Speak caveman. Keep short.

## Scope
`domain/combat/*`

## Laws
1. Keep domain pure. No Fastify, Prisma, LLM, repo imports.
2. Combat state machine lives here. Turn/round/order rules stay deterministic.
3. Attack resolution here is full domain pipeline. Keep helper rules in `domain/rules/*` pure and reusable.
4. If combat state shape changes, update hydration and tests same pass.
5. Follow `.github/instructions/combat-rules.instructions.md` as primary law.

## API Docs Alignment

- Canonical client API docs live in `docs/api/` (README + reference + guides).
- When changing routes, payloads, errors, events, or client integration loops, update the matching files in `docs/api/reference/` and `docs/api/guides/` in the same change.
- For SME research, agent reviews, and implementation plans that affect client contracts, cite and update the impacted docs under `docs/api/`.
- Treat these docs as done criteria for contract changes: `docs/api/reference/endpoints.md`, `docs/api/reference/schemas.md`, `docs/api/reference/events.md`, and `docs/api/reference/errors.md`.
