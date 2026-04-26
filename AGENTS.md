# AGENTS.md — DungeonMaster Agent Rules

Use for Claude Code, Copilot, Gemini.
Tool-specific rules live in [CLAUDE.md](CLAUDE.md) and [.github/copilot-instructions.md](.github/copilot-instructions.md).

Speak caveman. Keep short. Keep meaning.

***THERE IS NO SUCH THING AS LEGACY CODE. DONT ATTEMPT TO BE BACKWARDS COMPATIBLE WITH ANYTHING. IF IT DOESNT WORK, FIX IT.***

## Project Snapshot
- Engine: deterministic D&D 5e 2024 in [packages/game-server/](packages/game-server/).
- CLI harness: [packages/player-cli/](packages/player-cli/).
- LLM optional. LLM only parse/narrate/AI help. Mechanics stay TypeScript.
- Done means E2E scenario green in [packages/game-server/scripts/test-harness/scenarios/](packages/game-server/scripts/test-harness/scenarios/).

## Architecture (DDD)
```
domain/         pure rules, no Fastify/Prisma/LLM
application/    services + use-cases + repo ports
infrastructure/ adapters (API, DB, LLM)
```

Hard rules:
- Use explicit `.js` imports in TS (NodeNext).
- Backend is truth. Frontend thin.
- Bug fix: write failing test first.
- If weird behavior found, make TODO and make plan file. Use `plans/`.

## Domain Flows
Flow law lives first in `.github/instructions/*.instructions.md`.
Scoped `CLAUDE.md` gives short local guardrails.
AGENTS.md is map and routing guide.

Precedence:
- `.github/instructions/*.instructions.md` is primary flow law.
- Scoped `CLAUDE.md` is quick local constraints.
- `AGENTS.md` is high-level map.

| Flow | Scope | Constraint File |
|---|---|---|
| ActionEconomy | action economy + resource flags + legendary/lair counters | [packages/game-server/src/domain/entities/combat/CLAUDE.md](packages/game-server/src/domain/entities/combat/CLAUDE.md), [packages/game-server/src/application/services/combat/CLAUDE.md](packages/game-server/src/application/services/combat/CLAUDE.md) |
| CombatMap | map, path, cover, AoE geometry | [packages/game-server/src/domain/rules/CLAUDE.md](packages/game-server/src/domain/rules/CLAUDE.md), [packages/game-server/src/application/services/combat/CLAUDE.md](packages/game-server/src/application/services/combat/CLAUDE.md) |
| CombatRules | `domain/rules/`, `domain/combat/`, `domain/effects/` | [packages/game-server/src/domain/rules/CLAUDE.md](packages/game-server/src/domain/rules/CLAUDE.md), [packages/game-server/src/domain/combat/CLAUDE.md](packages/game-server/src/domain/combat/CLAUDE.md), [packages/game-server/src/domain/effects/CLAUDE.md](packages/game-server/src/domain/effects/CLAUDE.md) |
| ClassAbilities | `domain/entities/classes/`, `domain/abilities/`, `abilities/executors/` | [packages/game-server/src/domain/entities/classes/CLAUDE.md](packages/game-server/src/domain/entities/classes/CLAUDE.md), [packages/game-server/src/domain/abilities/CLAUDE.md](packages/game-server/src/domain/abilities/CLAUDE.md), [packages/game-server/src/application/services/combat/abilities/CLAUDE.md](packages/game-server/src/application/services/combat/abilities/CLAUDE.md) |
| SpellCatalog | spell entities + catalog + progression | [packages/game-server/src/domain/entities/spells/CLAUDE.md](packages/game-server/src/domain/entities/spells/CLAUDE.md) |
| SpellSystem | spell handlers + slot/concentration helpers | [packages/game-server/src/domain/entities/spells/CLAUDE.md](packages/game-server/src/domain/entities/spells/CLAUDE.md), [packages/game-server/src/application/services/combat/CLAUDE.md](packages/game-server/src/application/services/combat/CLAUDE.md) |
| CombatOrchestration | tabletop + action services | [packages/game-server/src/application/services/combat/tabletop/CLAUDE.md](packages/game-server/src/application/services/combat/tabletop/CLAUDE.md), [packages/game-server/src/application/services/combat/CLAUDE.md](packages/game-server/src/application/services/combat/CLAUDE.md) |
| ReactionSystem | `combat/two-phase/*` + pending-action + reaction routes/helpers | [packages/game-server/src/application/services/combat/two-phase/CLAUDE.md](packages/game-server/src/application/services/combat/two-phase/CLAUDE.md), [packages/game-server/src/domain/entities/combat/CLAUDE.md](packages/game-server/src/domain/entities/combat/CLAUDE.md) |
| AIBehavior | `combat/ai/*`, `infrastructure/llm/*` | [packages/game-server/src/application/services/combat/ai/CLAUDE.md](packages/game-server/src/application/services/combat/ai/CLAUDE.md), [packages/game-server/src/infrastructure/llm/CLAUDE.md](packages/game-server/src/infrastructure/llm/CLAUDE.md) |
| AISpellEvaluation | AI spell evaluation + cast handler + AI delivery | [packages/game-server/src/application/services/combat/ai/CLAUDE.md](packages/game-server/src/application/services/combat/ai/CLAUDE.md) |
| CreatureHydration | hydration adapters + resolver + creature shape | [packages/game-server/src/application/services/combat/CLAUDE.md](packages/game-server/src/application/services/combat/CLAUDE.md) |
| EntityManagement | entity services + creatures + repos | [packages/game-server/src/application/services/entities/CLAUDE.md](packages/game-server/src/application/services/entities/CLAUDE.md), [packages/game-server/src/domain/entities/creatures/CLAUDE.md](packages/game-server/src/domain/entities/creatures/CLAUDE.md), [packages/game-server/src/application/repositories/CLAUDE.md](packages/game-server/src/application/repositories/CLAUDE.md) |
| InventorySystem | items + inventory routes | [packages/game-server/src/domain/entities/items/CLAUDE.md](packages/game-server/src/domain/entities/items/CLAUDE.md), [packages/game-server/src/application/services/entities/CLAUDE.md](packages/game-server/src/application/services/entities/CLAUDE.md) |

## Agent System
Locations:
- Canonical: `.github/agents/*.md`
- Legacy mirror only: `.claude/agents/*.md`

Roles:
- `{Flow}-SME`: research/review only, writes `plans/sme-research-*` and `plans/sme-feedback-*`.
- `{Flow}-Implementer`: executes approved plan in scope.
- `Challenger`: stress-test plan.
- `VitestWriter`, `E2EScenarioWriter`, `TestingAgent`: tests.
- `DMDeveloper`: Copilot orchestrator.

Tool names:
- Claude: `Read, Edit, Grep, Glob, Bash, Write, WebFetch, WebSearch, Agent, TodoWrite`
- Copilot auto-map: `read, edit, search, runCommand, editFiles, ...`

## Plans Bus (`plans/`)
Single message bus for all tools. Do not write to `.claude/plans/` or `.github/plans/`.

Common files:
- `plans/sme-research-{Flow}.md`
- `plans/sme-feedback-{Flow}.md`
- `plans/challenge-{feature}.md`
- `plans/plan-{feature}.md`
- `plans/patterns/*.md`

Required frontmatter for new artifacts:
```yaml
---
type: sme-research | sme-feedback | plan | challenge | pattern
flow: CombatRules | ClassAbilities | SpellSystem | ... | multi
feature: <short-kebab-id>
author: <agent-id>
status: DRAFT | IN_REVIEW | APPROVED | COMPLETE
round: 1 | 2 | 3
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

Recommended sections: `Scope`, `Touched Files`, `Findings`, `Issues`, `Risks`, `Open Questions`, `Verdict`.

Parallel SME rule:
- Same input to all SMEs.
- SMEs work independent.
- Orchestrator does synthesis.

Status flow:
`DRAFT -> IN_REVIEW -> APPROVED -> COMPLETE`

Max 3 feedback rounds, then merge/split/escalate.

## Handoff
- Orchestrator is whoever writes `plans/plan-{feature}.md` first with `status: DRAFT`.
- To handoff: add `## Handoff` in plan + change `author`.
- No automatic handoff.

Heuristic:
- Use Claude Code for complex multi-flow synthesis.
- Use Copilot for single-flow IDE work.

## Test Gate
Feature not done until E2E scenario green.

New feature:
1. Write failing E2E scenario.
2. Implement to green.
3. Add unit tests.

Bug fix:
1. Repro failing test first.
2. Fix to green.

## Commands
```bash
pnpm -C packages/game-server typecheck
pnpm -C packages/game-server test
pnpm -C packages/game-server test:e2e:combat:mock
pnpm -C packages/game-server test:watch
pnpm -C packages/game-server dev
pnpm scaffold class-feature <class> <feature>
pnpm scaffold spell <name> <level>
pnpm test:golden
```

`pnpm test:golden` = typecheck + unit/integration + all E2E.

## MCP
[mcp.json](mcp.json) exposes `dnd-rules-query` tools.
Current tools:
- `lookup_spell <name>`
- `lookup_class_feature <class> <level>`
- `simulate_attack <attacker> <target> <weapon>`

## Pointers
- Claude behavior: [CLAUDE.md](CLAUDE.md)
- Copilot behavior: [.github/copilot-instructions.md](.github/copilot-instructions.md)
- Hooks: [.claude/settings.json](.claude/settings.json)
- MCP config: [mcp.json](mcp.json)
- Active plans: `plans/`
