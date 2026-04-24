# `.github/plans/` — MOVED

This directory has been consolidated into [plans/](../../plans/) at the repo root. Both Claude Code and GitHub Copilot now read and write inter-agent artifacts there as the single shared message bus.

If you arrived here via a cached agent reference, please re-target to:

- `plans/sme-research-{Flow}.md`
- `plans/sme-feedback-{Flow}.md` (with optional `-r2`, `-r3` round suffixes)
- `plans/challenge-{feature}.md`
- `plans/plan-{feature}.md`
- `plans/patterns/*.md`

See [AGENTS.md](../../AGENTS.md) for the full artifact frontmatter schema, status lifecycle, and orchestrator handoff protocol.

This stub will be removed after a transition window.
