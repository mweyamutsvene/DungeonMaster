# Copilot Instructions — DungeonMaster

> See [AGENTS.md](../AGENTS.md) for the shared project snapshot, DDD architecture, 13 domain flows, agent system, plans directory, and common commands. This file covers Copilot-specific behavior only.

Always start by reading this file fully. Greet with: "As you wish Papi...."

---

## Code Standards (Copilot defaults)
- Champion the **scalable** option over the quick fix.
- Champion the **modular** option over the quick fix.
- If a class grows too large or has too many responsibilities, break it up. Each class has a single responsibility and a clear interface.
- Refactor tightly-coupled code on sight. No public-API constraint here.
- Pick the best option even if it requires rewriting tests. Tests track the new code; if they break, that signals the new code is more accurate.
- Always use D&D 5e **2024** rules unless explicitly told otherwise.
- TODO comments → create a plan markdown file at `.github/prompts/<feature>.prompt.md`.
- Flag unexpected behavior outside scope — document TODOs / open issues for D&D rule gaps.

---

## Windows PowerShell syntax (NOT bash)

This project runs on Windows PowerShell. Common gotchas:

| Don't | Do |
|------|-----|
| `cmd1 && cmd2` | `cmd1; if ($?) { cmd2 }` |
| `\| head -N` | `\| Select-Object -First N` |
| `\| tail -N` | `\| Select-Object -Last N` |
| `\| grep "x"` | `\| Select-String "x"` |
| `command 2>&1 \| head -80` | `command 2>&1 \| Select-Object -First 80` |

---

## Run Commands
- `pnpm -C packages/game-server dev`
- `pnpm -C packages/player-cli dev`
- `pnpm -C packages/player-cli start -- --scenario solo-fighter`

User typically runs the game server in another terminal already. Prompt them to restart if needed.

---

## VS Code Tasks (auto-invocable)

With `github.copilot.chat.agent.runTasks: true` in user settings, the agent can invoke `.vscode/tasks.json` tasks directly. Add task definitions there for things you want auto-runnable from chat (typecheck-scope, scenario-runner, etc.).

---

## Agent System

- **Canonical agents:** [.claude/agents/](../.claude/agents/) — VS Code 1.109+ reads this directory natively. SMEs, implementers, test writers, Challenger live here.
- **Copilot-only orchestrator:** [.github/agents/developer.agent.md](agents/developer.agent.md) — uses Copilot-specific tools (`vscode`, `browser`, `mermaid`).
- **Per-glob auto-loaded context:** [.github/instructions/](instructions/) — `.instructions.md` files with `applyTo` globs inject scope-specific rules when editing matching paths.

---

## SME Domain Map (Copilot instruction-file paths)

| # | Flow | SME Agent | Instruction File |
|---|------|-----------|------------------|
| 1 | CombatRules | CombatRules-SME | [combat-rules.instructions.md](instructions/combat-rules.instructions.md) |
| 2 | ClassAbilities | ClassAbilities-SME | [class-abilities.instructions.md](instructions/class-abilities.instructions.md) |
| 3 | SpellSystem | SpellSystem-SME | [spell-system.instructions.md](instructions/spell-system.instructions.md) |
| 4 | CombatOrchestration | CombatOrchestration-SME | [combat-orchestration.instructions.md](instructions/combat-orchestration.instructions.md) |
| 5 | AIBehavior | AIBehavior-SME | [ai-behavior.instructions.md](instructions/ai-behavior.instructions.md) |
| 6 | EntityManagement | EntityManagement-SME | [entity-management.instructions.md](instructions/entity-management.instructions.md) |
| 7 | CombatMap | CombatMap-SME | [combat-map.instructions.md](instructions/combat-map.instructions.md) |
| 8 | SpellCatalog | SpellCatalog-SME | [spell-catalog.instructions.md](instructions/spell-catalog.instructions.md) |
| 9 | ReactionSystem | ReactionSystem-SME | [reaction-system.instructions.md](instructions/reaction-system.instructions.md) |
| 10 | ActionEconomy | ActionEconomy-SME | [action-economy.instructions.md](instructions/action-economy.instructions.md) |
| 11 | CreatureHydration | CreatureHydration-SME | [creature-hydration.instructions.md](instructions/creature-hydration.instructions.md) |
| 12 | AISpellEvaluation | AISpellEvaluation-SME | [ai-spell-evaluation.instructions.md](instructions/ai-spell-evaluation.instructions.md) |
| 13 | InventorySystem | InventorySystem-SME | [inventory-system.instructions.md](instructions/inventory-system.instructions.md) |

Architecture diagrams live in [.github/SME-Architecture-Flows/](SME-Architecture-Flows/) (Mermaid UML + data flow + user journey per flow).

---

## Combat Service Architecture (quick reference)

Three thin facades delegate to focused handlers (full diagram in [SME-Architecture-Flows/CombatOrchestration.md](SME-Architecture-Flows/CombatOrchestration.md)):

- **TabletopCombatService** → `ActionDispatcher` (6 handlers in `dispatch/`) + `RollStateMachine` (resolvers in `rolls/`)
- **ActionService** → `AttackActionHandler`, `GrappleActionHandler`, `SkillActionHandler`
- **TwoPhaseActionService** → `MoveReactionHandler`, `AttackReactionHandler`, `SpellReactionHandler`

`abilityRegistry` is REQUIRED in `TabletopCombatServiceDeps` — no optional guards.

## Class-Specific Code: Domain-First

All class-specific detection, eligibility, and combat-text matching MUST live in `domain/entities/classes/<class>.ts`. Three patterns (full reference in [packages/game-server/src/domain/entities/classes/CLAUDE.md](../packages/game-server/src/domain/entities/classes/CLAUDE.md)):

1. **ClassCombatTextProfile** — regex/enhancement/reaction declarations collected by `registry.ts`
2. **AbilityRegistry** — executors in `application/services/combat/abilities/executors/<class>/`, registered in `app.ts` (BOTH main + test)
3. **Feature Maps** — `classHasFeature(classId, feature, level)`. NEVER add boolean `has*()` to `ClassFeatureResolver`

---

## Rules Content Pipeline
- `pnpm -C packages/game-server import:rulebook` → loads equipment/feats from `RuleBookDocs/markdown`
- `pnpm -C packages/game-server import:monsters` → loads stat blocks

---

## Test Harness Reference

Full reference: [.github/instructions/testing.instructions.md](instructions/testing.instructions.md).

- Default `pnpm -C packages/game-server test` is deterministic; LLM tests skip unless `DM_RUN_LLM_TESTS=1|true|yes`.
- **CRITICAL: E2E mock combat must use `--all` flag**: `pnpm -C packages/game-server test:e2e:combat:mock -- --all`. Without `--all`, only the default `core/happy-path` scenario runs.
- LLM e2e variants: `test:e2e:combat:llm`, `test:llm`, `test:llm:e2e`, `test:llm:e2e:intent`, `test:llm:e2e:narration`, `test:llm:e2e:ai`, `test:llm:e2e:snapshot-update`.
- Interactive: `test:watch`, `test:ui`.
