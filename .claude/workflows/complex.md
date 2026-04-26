# Complex Workflow (Short)

Use when task is big: 4+ files, 2+ flows, or new core mechanic.

Speak caveman. Keep short.

## Core Ideas
1. Agents gather. Orchestrator decides.
2. Read real code, not stale notes.
3. `plans/` is message bus.
4. Reuse running agents/context when possible.

## Steps

### 1) Triage
Run Explore to find impacted flows/files.
If only one flow, maybe implement direct.

### 2) SME Research (Parallel)
Spawn all affected SMEs in one shot.
Each writes `plans/sme-research-{Flow}.md`.
No SME-to-SME dependency.

### 3) Synthesize Plan
Read all SME research.
Resolve conflicts yourself.
Write `plans/plan-{feature}.md` with:
- affected flows
- dependency order
- change checklist
- risks
- test plan

### 4) Review + Challenge (Parallel)
Spawn all affected SMEs as reviewers + Challenger.
Outputs:
- `plans/sme-feedback-{Flow}.md`
- `plans/challenge-{feature}.md`

If any `NEEDS_WORK`, revise plan and rerun review.
Max 3 rounds, then escalate.

### 5) Implement
Dispatch implementers per flow.
Parallel only when independent.
Sequential when dependencies exist.
Use worktree isolation for parallel safety.

### 6) Test While Implementing
Start typecheck early:
```bash
pnpm -C packages/game-server typecheck
```
Run VitestWriter and E2EScenarioWriter in background.

### 7) Verify
Run:
1. `pnpm -C packages/game-server test`
2. `pnpm -C packages/game-server test:e2e:combat:mock`

Trivial fail: fix directly.
Non-trivial fail: continue same implementer with focused instructions.

### 8) Cleanup
1. Check off plan items.
2. Delete `sme-research-*`, `sme-feedback-*`, `challenge-*`.
3. Keep `plan-{feature}.md` as history.
4. Create follow-up plan files for new TODOs.

## Quick Reference
- SME template: `.github/agents/{Flow}-sme.md`
- Challenger template: `.github/agents/Challenger.md`
- Implementer template: `.github/agents/{Flow}-implementer.md`
- Vitest writer: `.github/agents/VitestWriter.md`
- E2E writer: `.github/agents/E2EScenarioWriter.md`

Flows: `combat-rules`, `class-abilities`, `spell-system`, `combat-orchestration`, `ai-behavior`, `entity-management`
