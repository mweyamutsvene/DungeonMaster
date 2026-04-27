# `.github/agents/` — Canonical Agent Directory

Canonical agent definitions now live in this directory for both tools. **One source of truth, both tools.**

Use this folder for:

- SME agents
- Implementer agents
- Test writer agents
- Challenger
- Copilot orchestrator (`developer.agent.md`)

If a local setup still has `.claude/agents/`, treat it as a compatibility mirror only.

See [AGENTS.md](../../AGENTS.md) for the full agent system overview.

## API Docs Alignment

- Canonical client API docs live in `docs/api/` (README + reference + guides).
- When changing routes, payloads, errors, events, or client integration loops, update the matching files in `docs/api/reference/` and `docs/api/guides/` in the same change.
- For SME research, agent reviews, and implementation plans that affect client contracts, cite and update the impacted docs under `docs/api/`.
- Treat these docs as done criteria for contract changes: `docs/api/reference/endpoints.md`, `docs/api/reference/schemas.md`, `docs/api/reference/events.md`, and `docs/api/reference/errors.md`.
