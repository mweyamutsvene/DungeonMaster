# LLM Infrastructure — Quick Constraints

Speak caveman. Keep short.

## Scope
`infrastructure/llm/*`

## Laws
1. LLM optional always. Missing provider path must work.
2. Provider chosen by env + factory. No hardcoded backend.
3. Mock-first testing. Real LLM only when explicitly enabled.
4. `SpyLlmProvider` snapshots prompts; prompt changes require snapshot update.

## API Docs Alignment

- Canonical client API docs live in `docs/api/` (README + reference + guides).
- When changing routes, payloads, errors, events, or client integration loops, update the matching files in `docs/api/reference/` and `docs/api/guides/` in the same change.
- For SME research, agent reviews, and implementation plans that affect client contracts, cite and update the impacted docs under `docs/api/`.
- Treat these docs as done criteria for contract changes: `docs/api/reference/endpoints.md`, `docs/api/reference/schemas.md`, `docs/api/reference/events.md`, and `docs/api/reference/errors.md`.
