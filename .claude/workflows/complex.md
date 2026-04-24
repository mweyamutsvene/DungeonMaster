# Complex Orchestrated Workflow

For tasks touching 4+ files across 2+ flows, or introducing new class features/combat mechanics.

## Design Principles
1. **Agents for parallelism and isolation. Orchestrator for judgment.** Sub-agents gather information and execute scoped changes. The orchestrator (Opus, 1M context) does cross-cutting reasoning, conflict resolution, and final decisions.
2. **Agents read code, not cached descriptions.** CLAUDE.md files contain architectural laws. For current state, agents grep the source.
3. **Plan-on-disk is the message bus.** All agent communication through `plans/`. No context bleed.
4. **Minimize orchestrator I/O.** Read agent templates once. Use SendMessage to continue agents rather than re-spawning with full context.

---

## Step 1: Triage (Explore agent)

Spawn an Explore agent to map the blast radius:
```
Agent(subagent_type: Explore, thoroughness: medium):
  "Which files and flows are affected by: {task}?
   Map to the Six Domain Flows table in CLAUDE.md.
   Return: list of affected flows + key files in each."
```

If triage shows only 1 flow → consider skipping to direct implementation.

## Step 2: Research (parallel SMEs)

Read the agent templates for each affected flow ONCE. Then spawn all SMEs in a SINGLE message:

```
Agent: "You are the {Flow} SME. [paste from .claude/agents/sme-{flow}.md]
  Research: {task description}.
  Read the actual source files in your scope.
  Write findings to plans/sme-research-{Flow}.md"
```

**All SMEs dispatch in parallel.** Each operates in isolation — no shared context.

## Step 3: Synthesize (orchestrator reasoning — the most important step)

Read all `sme-research-*.md` files. This is where Opus earns its keep:

- **Cross-reference** findings across flows. Where do the SMEs disagree or have blind spots?
- **Identify coupling points** where a change in one flow affects another.
- **Resolve conflicts** — if CombatRules SME says one thing and SpellSystem SME says another, YOU decide.
- **Design the dependency order** — which implementer must go first?

Write the plan to `plans/plan-{feature}.md`:
```markdown
# Plan: {Title}
## Round: 1
## Status: IN_REVIEW
## Affected Flows: [list]
## Dependency Order: [which flows must go before others]

## Objective
[What and why — the reasoning behind the approach]

## Changes
### {Flow Name}
- [ ] Change description, rationale, and file path

## Cross-Flow Coupling Points
- [What connects flow A to flow B, and why the plan handles it correctly]

## Risks
- [Risk and mitigation]

## Test Plan
- [ ] Unit tests
- [ ] E2E scenarios
```

## Step 4: Review + Challenge (parallel debate)

In ONE message, spawn all of these in parallel:

**Each affected SME as reviewer:**
```
Agent: "You are the {Flow} SME. [role].
  Read the plan at plans/plan-{feature}.md.
  Read your research at plans/sme-research-{Flow}.md.
  Write verdict to plans/sme-feedback-{Flow}.md (APPROVED or NEEDS_WORK)."
```

**The Challenger:**
```
Agent: "[paste .claude/agents/challenger.md role].
  Read plan at plans/plan-{feature}.md.
  Read ALL sme-research-*.md files.
  Write challenge to plans/challenge-{feature}.md."
```

### Evaluate results
Read all feedback + challenge. Use YOUR judgment:
- **NEEDS_WORK from any SME** → revise plan, increment round, re-send to ALL (a fix for one flow may break another)
- **Challenger critical issues** → address before proceeding
- **Challenger concerns (non-blocking)** → note in plan, address in implementation
- **SMEs disagree with each other** → YOU resolve using cross-cutting knowledge
- **Max 3 rounds** → if still not converging, escalate to user

## Step 5: Implement (parallel, worktree isolated)

For each affected flow:
```
Agent(isolation: worktree): "You are the {Flow} Implementer. [role].
  Read and execute plans/plan-{feature}.md.
  Only modify files in your scope."
```

**Rules:**
- Independent flows → parallel dispatch in one message
- Cross-dependent flows → sequential (dependency first, dependent second)
- Use `isolation: "worktree"` so parallel agents can't conflict

## Step 6: Test (background, non-blocking)

While implementation completes, start typecheck immediately:
```bash
pnpm -C packages/game-server typecheck
```

Dispatch test writers in background:
```
Agent(run_in_background: true): "[vitest role]. Read plan, write tests for changed code."
Agent(run_in_background: true): "[e2e role]. Read plan, write scenarios for new behavior."
```

You'll be notified when they complete. Don't poll.

## Step 7: Verify

After all agents return:
1. `pnpm -C packages/game-server test`
2. `pnpm -C packages/game-server test:e2e:combat:mock`

Failures:
- Trivial (1-2 lines) → fix directly
- Non-trivial → use `SendMessage` to continue the relevant implementer agent with specific fix instructions (preserves their context, avoids re-spawning)

## Step 8: Cleanup

1. Check off plan items
2. Delete: `sme-research-*.md`, `sme-feedback-*.md`, `challenge-*.md`
3. Keep: `plan-{feature}.md` as historical record
4. Create `plans/plan-*.md` for any new TODOs discovered

---

## Agent Template Reference

| Role | Template | Output Path |
|------|----------|-------------|
| SME (any flow) | `.claude/agents/sme-{flow}.md` | `sme-research-{Flow}.md` / `sme-feedback-{Flow}.md` |
| Challenger | `.claude/agents/challenger.md` | `challenge-{feature}.md` |
| Implementer (any flow) | `.claude/agents/impl-{flow}.md` | Source files in scope |
| Vitest Writer | `.claude/agents/test-vitest.md` | `*.test.ts` files |
| E2E Writer | `.claude/agents/test-e2e.md` | `scenarios/*.json` |

Flow names: `combat-rules`, `class-abilities`, `spell-system`, `combat-orchestration`, `ai-behavior`, `entity-management`
