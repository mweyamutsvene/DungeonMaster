# AIBehavior — Quick Constraints

Speak caveman. Keep short.

## Scope
`combat/ai/*`, `infrastructure/llm/*`

## Laws
1. LLM optional always. If missing or null, deterministic AI take over.
2. AI decision is suggestion only. Rules engine is judge.
3. Battle plans are faction-scoped; replan on big state change.
4. Support Ollama, OpenAI, GitHub Models, Copilot. Pick by env + factory.
5. Prompt format change needs snapshot update: `test:llm:e2e:snapshot-update`.

## API Docs Alignment

- Canonical client API docs live in `docs/api/` (README + reference + guides).
- When changing routes, payloads, errors, events, or client integration loops, update the matching files in `docs/api/reference/` and `docs/api/guides/` in the same change.
- For SME research, agent reviews, and implementation plans that affect client contracts, cite and update the impacted docs under `docs/api/`.
- Treat these docs as done criteria for contract changes: `docs/api/reference/endpoints.md`, `docs/api/reference/schemas.md`, `docs/api/reference/events.md`, and `docs/api/reference/errors.md`.
