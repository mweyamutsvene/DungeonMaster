# AGENTS.md — Multi-Agent Development for DungeonMaster

Shared instructions for any agentic tool (Claude Code, GitHub Copilot, Gemini) working in this repository. Tool-specific notes live in [CLAUDE.md](CLAUDE.md) and [.github/copilot-instructions.md](.github/copilot-instructions.md) — both link back here.

---

## Project Snapshot

Deterministic D&D 5e 2024 rules engine + Fastify game server in [packages/game-server/](packages/game-server/). [packages/player-cli/](packages/player-cli/) is an interactive terminal harness. LLM is **optional** — used only for intent parsing and narration; mechanics are pure TypeScript.

**Test harness is the source of truth.** E2E scenarios in [packages/game-server/scripts/test-harness/scenarios/](packages/game-server/scripts/test-harness/scenarios/) gate "done." A feature is done when its scenario goes green.

---

## Architecture (DDD — respect dependency direction)

```
domain/        → Pure game logic (NO Fastify/Prisma/LLM imports)
application/   → Use-cases, services, repository interfaces (ports)
infrastructure/→ Adapters: Fastify API, Prisma repos, LLM providers
```

- ESM with explicit `.js` extensions in all TypeScript imports (NodeNext resolution).
- Backend is source of truth; frontend is a thin client.
- Bug fixing: write a failing test that reproduces the bug **before** implementing the fix.
- Flag unexpected behavior — document gaps as TODOs and create a plan markdown file in `plans/`.

---

## Domain Flows (13)

Each flow has a nested `CLAUDE.md` at its scope directory with stable architectural constraints. Both Claude Code and Copilot auto-load these on path match. Do not duplicate constraints elsewhere.

| Flow | Scope | Constraints File |
|------|-------|------------------|
| CombatRules | `domain/rules/`, `domain/combat/`, `domain/effects/` | [packages/game-server/src/domain/rules/CLAUDE.md](packages/game-server/src/domain/rules/CLAUDE.md) |
| ClassAbilities | `domain/entities/classes/`, `domain/abilities/`, `abilities/executors/` | [packages/game-server/src/domain/entities/classes/CLAUDE.md](packages/game-server/src/domain/entities/classes/CLAUDE.md) |
| SpellSystem | `domain/entities/spells/`, `tabletop/spell-action-handler.ts`, `spell-delivery/*`, `domain/rules/concentration.ts` | [packages/game-server/src/domain/entities/spells/CLAUDE.md](packages/game-server/src/domain/entities/spells/CLAUDE.md) |
| SpellCatalog | `domain/entities/spells/catalog/` | (covered by SpellSystem) |
| CombatOrchestration | `combat/tabletop/*`, `combat/action-handlers/*`, `tabletop-combat-service.ts`, `action-service.ts`, `combat-service.ts` | [packages/game-server/src/application/services/combat/tabletop/CLAUDE.md](packages/game-server/src/application/services/combat/tabletop/CLAUDE.md), [packages/game-server/src/application/services/combat/CLAUDE.md](packages/game-server/src/application/services/combat/CLAUDE.md) |
| ActionEconomy | action/bonus/reaction/movement tracking across combat services | (covered by CombatOrchestration) |
| ReactionSystem | `combat/two-phase/*`, `two-phase-action-service.ts`, OA detection, pending-action state machine | [packages/game-server/src/application/services/combat/two-phase/CLAUDE.md](packages/game-server/src/application/services/combat/two-phase/CLAUDE.md) |
| CombatMap | `domain/rules/combat-map.ts` + companions (`-core`, `-items`, `-sight`, `-types`, `-zones`), `pathfinding.ts`, `area-of-effect.ts`, `battlefield-renderer.ts` | (covered by CombatRules) |
| AIBehavior | `combat/ai/*` (+ `ai/handlers/`), `infrastructure/llm/*` | [packages/game-server/src/application/services/combat/ai/CLAUDE.md](packages/game-server/src/application/services/combat/ai/CLAUDE.md), [packages/game-server/src/infrastructure/llm/CLAUDE.md](packages/game-server/src/infrastructure/llm/CLAUDE.md) |
| AISpellEvaluation | AI spell selection logic in `combat/ai/` | (covered by AIBehavior) |
| EntityManagement | `services/entities/*`, `domain/entities/creatures/*`, repositories | [packages/game-server/src/application/services/entities/CLAUDE.md](packages/game-server/src/application/services/entities/CLAUDE.md) |
| CreatureHydration | stat-block load, combat prep | (covered by EntityManagement) |
| InventorySystem | `domain/entities/items/*`, inventory routes, `item-lookup-service.ts` | [packages/game-server/src/domain/entities/items/CLAUDE.md](packages/game-server/src/domain/entities/items/CLAUDE.md) |

---

## Agent System

### Agent Locations

- **`.claude/agents/*.md`** — canonical for both tools. VS Code Copilot reads this directory natively (1.109+); Claude Code reads it natively. Add new SMEs, implementers, test writers, and challengers here.
- **`.github/agents/*.agent.md`** — Copilot-only orchestrator + utility agents that reference Copilot-specific tools (`vscode`, `browser`, `mermaid`). Don't add new agents here unless they truly need Copilot-only tools.

### Agent Roles (per flow)

- **SME-{Flow}** — read-only research + plan review. Writes `plans/sme-research-{Flow}.md` and `plans/sme-feedback-{Flow}.md`. Never modifies source code.
- **{Flow}-Implementer** — executes APPROVED plans within scope. Reads the plan, makes edits, runs tests.
- **Challenger** — adversarial reviewer. Pressure-tests synthesized plans. Writes `plans/challenge-{feature}.md`.
- **VitestWriter / E2EScenarioWriter / TestingAgent** — test authorship + execution.
- **DMDeveloper** (Copilot only) — full-stack orchestrator. Dispatches SMEs and implementers.

### Tool Naming

VS Code's compatibility layer reads Claude-format frontmatter directly. Standard tool names:
- Claude: `Read, Edit, Grep, Glob, Bash, Write, WebFetch, WebSearch, Agent, TodoWrite`
- Copilot equivalents (auto-mapped): `read, edit, search, runCommand, editFiles, ...`

Per-agent frontmatter uses Claude naming. Copilot-only agents in `.github/agents/` use Copilot naming.

---

## Plans Directory: `plans/` at repo root

All inter-agent artifacts live here. **One shared message bus** for both ecosystems. No agent writes to `.claude/plans/` or `.github/plans/` anymore — both redirect to `plans/`.

### Artifact Types

| File | Purpose |
|------|---------|
| `plans/sme-research-{Flow}.md` | SME's investigation of a task before planning |
| `plans/sme-feedback-{Flow}.md` | SME's review verdict on a synthesized plan (round 1) |
| `plans/sme-feedback-{Flow}-r2.md` | Round-2 feedback after revision |
| `plans/challenge-{feature}.md` | Challenger's pressure test |
| `plans/plan-{feature}.md` | Synthesized implementation blueprint |
| `plans/patterns/*.md` | Reusable feature shapes (class-feature-l1-5, spell-concentration, etc.) |

### Frontmatter Schema (required on new artifacts)

```yaml
---
type: sme-research | sme-feedback | plan | challenge | pattern
flow: CombatRules | ClassAbilities | SpellSystem | ... | multi
feature: <short-kebab-id>          # matches plan-{feature}.md cross-ref
author: copilot-sme-CombatRules | claude-sme-combat-rules | claude-orchestrator | copilot-developer | ...
status: DRAFT | IN_REVIEW | APPROVED | COMPLETE
round: 1 | 2 | 3                   # feedback files only
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

Historical files retrofit on first touch; new files require this from the start.

### Body Sections (recommended structure)

Use these section headers so the next agent can locate information without reading prose end-to-end:

```markdown
## Scope            # what this artifact covers (and what it does not)
## Touched Files    # absolute or repo-relative paths the work affects
## Findings         # for sme-research: investigation results
## Issues           # for sme-feedback / challenge: specific problems with location refs
## Risks            # cross-flow concerns, edge cases, regressions
## Open Questions   # unresolved decisions, defer to specific person
## Verdict          # for sme-feedback / challenge: APPROVED / NEEDS_WORK / STRONG / WEAK
```

Patterns under `plans/patterns/` use a different shape — see existing patterns for the template.

### Parallel SME Dispatch Rule

When the orchestrator spawns multiple SMEs for one task, **SMEs must be independent**:
- All SMEs receive the **same input** (the task statement + relevant code references).
- SMEs produce **independent outputs** — no SME-to-SME references in research files.
- The orchestrator (you, or the Copilot developer agent) synthesizes findings into the plan.

This makes the parallel dispatch genuinely parallel (no hidden gating between SMEs) and makes the synthesis step the single integration point. If an SME needs another SME's output, the orchestrator should serialize them — never let SMEs serialize themselves.

### Status Lifecycle

```
DRAFT → IN_REVIEW → APPROVED → COMPLETE
```

- Max **3 feedback rounds** before the orchestrator must merge or split the plan.
- A plan with `status: APPROVED` triggers implementation; one with `status: COMPLETE` triggers post-impl Challenger pass.

---

## Orchestrator Handoff Protocol

Both tools can orchestrate. Neither defers to the other automatically.

- **Claim ownership:** the tool that writes `plans/plan-{feature}.md` with `status: DRAFT` is orchestrator. The `author:` field names them.
- **Handoff:** to hand off, append a `## Handoff` section to the plan with the next orchestrator named, and update `author:`. The picking-up tool reads this on resume.
- **No automatic handoff.** Humans (or rate-limit events) decide. Both tools can read the same plan history.

**Rule of thumb:**
- **Claude Code** for complex multi-flow synthesis (4+ files, 2+ flows) — leverages parallel Agent dispatch and Opus reasoning.
- **Copilot** for single-flow IDE-integrated work — leverages in-editor `runTasks` and declarative `handoffs` in `developer.agent.md`.

---

## Test Harness as Gate

A feature is **not done** until its E2E scenario in [packages/game-server/scripts/test-harness/scenarios/](packages/game-server/scripts/test-harness/scenarios/) goes green.

For new features:
1. Write the failing scenario first (E2EScenarioWriter agent).
2. Implement until green.
3. Add unit tests for the pure functions touched (VitestWriter agent).

For bug fixes:
1. Write a failing test that reproduces the bug.
2. Fix until green.

Hooks at `.claude/settings.json` enforce this — PostToolUse on `domain/**` edits nudges if no scenario exists for the active feature.

---

## Common Commands

```bash
pnpm -C packages/game-server typecheck            # TS compilation check
pnpm -C packages/game-server test                 # Unit + integration tests (fast, no LLM)
pnpm -C packages/game-server test:e2e:combat:mock # E2E combat scenarios with mock LLM
pnpm -C packages/game-server test:watch           # Watch mode
pnpm -C packages/game-server dev                  # Run server (assume user already has one open)
pnpm scaffold class-feature <class> <feature>     # Skeleton generator
pnpm scaffold spell <name> <level>                # Skeleton generator
pnpm test:golden                                  # Full gate (typecheck + unit + E2E --all). CI runs this on PR.
```

Default tests are deterministic (no LLM). Only run LLM tests when explicitly asked.

### Optional: pre-push gate

`pnpm test:golden` runs typecheck + unit/integration tests + all 259 E2E scenarios in one shot. To enforce it before every push, set up a manual git hook (no husky dependency):

```bash
# .git/hooks/pre-push (chmod +x after creating)
#!/bin/sh
pnpm test:golden || { echo "Golden scenarios failed. Use --no-verify only when intentional."; exit 1; }
```

A CI workflow YAML is staged at `.github/workflows/golden-scenarios.yml` (untracked) but pushing it requires a GitHub token with `workflow` scope. Add it via the GitHub web UI or push from a local machine with a properly-scoped token.

---

## MCP Rules Query Server

[mcp.json](mcp.json) at repo root registers `dnd-rules-query` — a deterministic-engine query interface both tools consume. SMEs use it to look up spell data, class features, simulate attacks, and check concentration interactions instead of grep'ing source.

Tools exposed (v1):
- `lookup_spell <name>` — full spell data
- `lookup_class_feature <class> <level>` — feature list with executor names
- `simulate_attack <attacker> <target> <weapon>` — resolved roll + damage

More tools added iteratively as research patterns emerge.

---

## Pointers

- **Tool-specific behavior:** [CLAUDE.md](CLAUDE.md) (Claude Code), [.github/copilot-instructions.md](.github/copilot-instructions.md) (Copilot)
- **Hooks config:** [.claude/settings.json](.claude/settings.json) (read by both tools)
- **MCP servers:** [mcp.json](mcp.json) (read by both tools)
- **Per-flow constraints:** nested `CLAUDE.md` files at flow scope directories (auto-loaded on path match)
- **Active plans:** `plans/` at repo root
