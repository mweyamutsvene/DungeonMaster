# Plans Directory

Working directory for the orchestrator's debate loop. Files here are ephemeral.

- `current-plan.md` — the active plan being reviewed/executed
- `sme-feedback-{flowName}.md` — SME review feedback per round
- `sme-research-{flowName}.md` — SME research output
- `flow-analysis-{flowName}.md` — deep analysis output from bootstrapping

These files are gitignored by default (except `flow-analysis-*.md` which are valuable reference documentation).
