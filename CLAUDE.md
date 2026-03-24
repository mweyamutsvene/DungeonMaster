# DungeonMaster — Claude Code Project Rules

## Project
Deterministic D&D 5e 2024 rules engine + Fastify game server in `packages/game-server`. `packages/player-cli` is an interactive terminal harness. LLM is optional — intent parsing + narration only; rules/mechanics are pure TypeScript.

## Core Principles
1. **Test harness is source of truth** — check E2E scenarios in `packages/game-server/scripts/test-harness/scenarios/` before implementing. New features need test scenarios first.
2. **Deterministic rules** — LLM never decides game mechanics.
3. **D&D 5e 2024 rules** unless explicitly told otherwise.
4. **No breaking changes concern** — not a public API. Refactor freely.
5. **ESM with explicit `.js` extensions** in all TypeScript imports (NodeNext resolution).
6. **Bug fixing** — write a failing test that reproduces the bug before implementing the fix.
7. **Backend is source of truth** — frontend is a thin client that renders state and sends user input.
8. **Flag unexpected behavior** — document TODOs and open issues for D&D rule gaps outside current scope.
9. **TODO comments** → create a plan markdown file in `.claude/plans/` describing the work.

## Architecture (DDD — respect dependency direction)
```
domain/        → Pure game logic (NO Fastify/Prisma/LLM imports)
application/   → Use-cases, services, repository interfaces (ports)
infrastructure/→ Adapters: Fastify API, Prisma repos, LLM providers
```

## Stack
- TypeScript + Node.js ESM, pnpm + Turborepo
- Fastify API: `packages/game-server/src/infrastructure/api/app.ts`
- Prisma + SQLite, Vitest for tests, `tsx` for dev
- Optional LLM (Ollama/OpenAI/GitHub Models)

## Commands
```bash
pnpm -C packages/game-server typecheck            # TS compilation check
pnpm -C packages/game-server test                  # All unit/integration tests (fast, no LLM)
pnpm -C packages/game-server test:e2e:combat:mock  # E2E combat scenarios with mock LLM
pnpm -C packages/game-server test:watch            # Watch mode
pnpm -C packages/game-server dev                   # Run server in watch mode
```

## Six Domain Flows
| Flow | Primary Directories |
|------|-------------------|
| **CombatRules** | `domain/rules/`, `domain/combat/`, `domain/effects/` |
| **ClassAbilities** | `domain/entities/classes/`, `domain/abilities/`, `abilities/executors/` |
| **SpellSystem** | `tabletop/spell-action-handler.ts`, `domain/entities/spells/`, `domain/rules/concentration.ts` |
| **CombatOrchestration** | `combat/tabletop/*`, `tabletop-combat-service.ts`, `combat-service.ts` |
| **AIBehavior** | `combat/ai/*`, `infrastructure/llm/*` |
| **EntityManagement** | `services/entities/*`, `domain/entities/creatures/*`, repositories |

Each flow directory has a `CLAUDE.md` with stable architectural constraints. These auto-load when agents work in that directory — do not duplicate their content elsewhere.

## Testing Patterns
- **Unit tests**: in-memory repos from `infrastructure/testing/memory-repos.ts` + stubs
- **Integration**: `buildApp(deps)` + `app.inject()` for API-level testing
- **Deterministic dice**: mock `DiceRoller` for combat tests — never real randomness
- **E2E scenarios**: JSON files in `scripts/test-harness/scenarios/`
- Default tests are deterministic (no LLM). Only run LLM tests when explicitly asked.

## Assumptions
- User is running the game server in another terminal. Prompt them to restart if needed.
- Copilot agent definitions live in `.github/agents/` — do not modify those.
- Claude agent setup lives in `.claude/` — do not modify `.github/` agent files.

---

## Orchestration Playbook

### When you receive a task, assess complexity first:

**Simple** (1-3 files, 1 flow, 1 DDD layer): Implement directly. Read the relevant CLAUDE.md, code, and tests. Implement → typecheck → test → done.

**Complex** (4+ files, 2+ flows, or new class/feature): Follow the orchestrated workflow below.

### Step 1: Triage with Explore
Spawn an `Explore` subagent to determine which flows are affected:
```
Agent(subagent_type: Explore): "Which files and flows would be affected by {task}? Check the Six Domain Flows table in CLAUDE.md and map affected files to flows."
```

### Step 2: Parallel SME Research
For each affected flow, read `.claude/agents/sme-{flow}.md` and spawn an SME agent:
```
Agent: "{paste role from template}. Research: {task}. Read the actual source files in your scope. Write findings to .claude/plans/sme-research-{Flow}.md."
```
Spawn ALL affected SMEs in a single message (parallel dispatch).

### Step 3: Synthesize Plan
Read all `sme-research-*.md` files. Use YOUR reasoning (Opus) for cross-cutting synthesis — this is where deep reasoning matters most. Write plan to `.claude/plans/plan-{feature}.md`.

### Step 4: Parallel Review + Challenge (the debate)
In ONE message, spawn:
- Each affected SME as a reviewer → writes `sme-feedback-{Flow}.md`
- The Challenger agent (`.claude/agents/challenger.md`) → writes `challenge-{feature}.md`

All run in parallel. Read all feedback. If NEEDS_WORK or critical issues: revise plan, re-send (max 3 rounds). Use YOUR judgment to resolve conflicts between SMEs.

### Step 5: Parallel Implementation (worktree isolated)
For each affected flow:
```
Agent(isolation: worktree): "{paste role from impl template}. Execute plan at .claude/plans/plan-{feature}.md. Only modify files in your scope."
```
Independent flows in parallel. Cross-dependent flows sequential.

### Step 6: Test Writing (background)
Dispatch test writers with `run_in_background: true`:
```
Agent(run_in_background: true): "{vitest writer role}. Read plan, write tests."
Agent(run_in_background: true): "{e2e writer role}. Read plan, write scenarios."
```
Meanwhile, start running `typecheck` on the implementation output.

### Step 7: Verify
After all agents return: `typecheck` → `test` → `test:e2e:combat:mock`. Fix failures directly if trivial, re-dispatch to implementer if not.

### Step 8: Cleanup
Check off plan items. Delete `sme-research-*` and `sme-feedback-*` files. Keep `plan-{feature}.md` as a record.

---

### Key principles for orchestration:
- **Agents for parallelism and isolation. Orchestrator (you) for judgment.** Don't outsource cross-cutting reasoning to agents — that's YOUR job.
- **Never duplicate domain knowledge.** Nested CLAUDE.md files have constraints. Agent templates have role behavior. Don't repeat one in the other.
- **Agents should READ CODE, not rely on cached descriptions.** CLAUDE.md files contain architectural laws. For current state (what functions exist, how many lines), agents grep the actual source.
- **Plan-on-disk is the message bus.** All inter-agent communication through `.claude/plans/`. No context bleed.
