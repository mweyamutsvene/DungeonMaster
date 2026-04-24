# DungeonMaster — Claude Code Notes

> See [AGENTS.md](AGENTS.md) for the shared project snapshot, DDD architecture, 13 domain flows, agent system, plans directory, and common commands. This file covers Claude Code-specific behavior only.

---

## Orchestration Playbook (Claude Code)

When you receive a task, assess complexity first:

- **Simple** (1–3 files, 1 flow, 1 DDD layer): implement directly. Read the relevant nested `CLAUDE.md`, the code, the tests. Implement → typecheck → test → done.
- **Complex** (4+ files, 2+ flows, or new class/feature): use the orchestrated workflow below.

### Step 1: Triage with Explore
Spawn one Explore subagent. Ask which files and flows the task touches. Reference the flow table in [AGENTS.md](AGENTS.md).

### Step 2: Parallel SME Research
Spawn each affected SME in a single message (parallel dispatch via multiple Agent tool calls). Each writes `plans/sme-research-{Flow}.md`.

### Step 3: Synthesize Plan
Read all `sme-research-*.md`. Use Opus reasoning for cross-cutting synthesis — this is YOUR job, not the SMEs'. Write plan to `plans/plan-{feature}.md` with the frontmatter schema in AGENTS.md (`status: DRAFT`, `author: claude-orchestrator`).

### Step 4: Parallel Review + Challenge
In one message, spawn each affected SME as a reviewer + the Challenger. Each writes to `plans/`. Iterate up to 3 rounds. Resolve SME conflicts with YOUR judgment.

### Step 5: Parallel Implementation
For each affected flow, spawn its implementer in a worktree. Independent flows in parallel; cross-dependent flows sequential.

### Step 6: Test Writing (background)
Dispatch VitestWriter + E2EScenarioWriter with `run_in_background: true`. Run typecheck on the implementer output while they work.

### Step 7: Verify
`typecheck` → `test` → `test:e2e:combat:mock`. Fix trivial failures directly; re-dispatch the implementer for non-trivial failures.

### Step 8: Cleanup
Mark plan items complete, set `status: COMPLETE`. Keep `plan-{feature}.md` as the record. Stale `sme-research-*` and `sme-feedback-*` may be removed after closure.

---

## Key Principles

- **Agents for parallelism and isolation. Orchestrator (you) for judgment.** Don't outsource cross-cutting reasoning — that's where Opus earns its keep.
- **Agents READ code for current state.** Nested `CLAUDE.md` files capture architectural laws; the source is authoritative for what exists today (line counts, function lists, etc.).
- **Plan-on-disk is the message bus.** All inter-agent communication through `plans/` at repo root. No context bleed.
- **Hooks enforce what instructions only suggest.** [.claude/settings.json](.claude/settings.json) hooks (PostToolUse typecheck, domain-purity check, scenario-gate nudge) run on every edit and inject results back into context. Don't fight them — fix the underlying issue.

---

## Auto-Memory

Claude Code maintains auto-memory at `C:\Users\tommy\.claude\projects\c--Users-tommy-Development-DungeonMaster\memory\`. The `MEMORY.md` index there persists user/feedback/project/reference notes across sessions. Read or write it directly via the Write/Read tools — it's outside the project tree.
