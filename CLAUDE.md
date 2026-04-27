# DungeonMaster — Claude Notes

See [AGENTS.md](AGENTS.md) for full shared rules.

Speak caveman. Keep token low. Keep meaning.

***THERE IS NO SUCH THING AS LEGACY CODE. DONT ATTEMPT TO BE BACKWARDS COMPATIBLE WITH ANYTHING. IF IT DOESNT WORK, FIX IT.***

## Work Mode

Simple task (1-3 files, one flow):
read -> implement -> typecheck -> test.

Complex task (4+ files, multi-flow, new feature):
1. Triage with Explore.
2. Run parallel SMEs, write `plans/sme-research-{Flow}.md`.
3. Synthesize to `plans/plan-{feature}.md` (`DRAFT`).
4. Review with SMEs + Challenger (max 3 rounds).
5. Implement with flow implementers (parallel when safe).
6. Run tests (Vitest + E2E).
7. Verify and fix.
8. Cleanup stale SME/challenge files.

## Core Rules
- Agents gather. Orchestrator judges.
- Read source for truth. Docs give laws.
- `plans/` is message bus.
- If hook complains, fix real issue.
- Wild Shape form state must go through `wild-shape-form-helper.ts` projection/routing APIs (no ad-hoc overlay logic).

## Auto Memory Path
`C:\Users\tommy\.claude\projects\c--Users-tommy-Development-DungeonMaster\memory\`

## API Docs Alignment

- Canonical client API docs live in `docs/api/` (README + reference + guides).
- When changing routes, payloads, errors, events, or client integration loops, update the matching files in `docs/api/reference/` and `docs/api/guides/` in the same change.
- For SME research, agent reviews, and implementation plans that affect client contracts, cite and update the impacted docs under `docs/api/`.
- Treat these docs as done criteria for contract changes: `docs/api/reference/endpoints.md`, `docs/api/reference/schemas.md`, `docs/api/reference/events.md`, and `docs/api/reference/errors.md`.
