# Plan: Multi-Agent Infrastructure & Effectiveness Study for DungeonMaster

## TL;DR
Adapt the portable flow bootstrapper to DungeonMaster's DDD architecture, create 6 domain-aligned flow agents + a metrics-capture agent, then run a controlled A/B study comparing orchestrator+sub-agents vs single-agent on real upcoming features (Class Features Phase 8, Ready Action, Cover Mechanics). The study captures tool-call counts, error rates, rework cycles, correctness scores, and context-window utilization via a dedicated MetricsAgent.

---

## Part 1: Flow Decomposition for DungeonMaster

### Recommended Flows (6 domain-aligned)

| Flow Name | Domain Boundary | Source Scope | Test Scope |
|-----------|----------------|-------------|------------|
| **CombatRules** | `domain/rules/*` (27 modules), `domain/combat/*` (4 modules), `domain/effects/*` (6 modules) | Pure game mechanics: movement, pathfinding, damage, grapple, concentration, death saves | `domain/rules/*.test.ts` (25 test files, 93% coverage) + scenarios touching rules |
| **ClassAbilities** | `domain/entities/classes/*` (19 files) + `domain/abilities/*` (3 files) + `application/services/combat/abilities/executors/*` | ClassCombatTextProfiles, AbilityExecutors, ability-registry, resource pool factories | Class-specific scenarios in `scenarios/monk/`, `scenarios/fighter/`, etc. (17 test files, 89% coverage) |
| **SpellSystem** | `application/services/combat/tabletop/spell-action-handler.ts` + `domain/entities/spells/*` + concentration helpers | Spell casting pipeline, zone effects, concentration | Wizard scenarios, concentration scenarios |
| **CombatOrchestration** | `application/services/combat/tabletop/*` + `combat-service.ts` | TabletopCombatService facade, ActionDispatcher, RollStateMachine, CombatTextParser | `combat-flow-tabletop.integration.test.ts`, core scenarios |
| **AIBehavior** | `application/services/combat/ai/*` + `infrastructure/llm/*` | AI turn orchestration, battle plans, LLM providers | `ai-actions.llm.test.ts`, LLM E2E scenarios |
| **EntityManagement** | `application/services/entities/*` + `domain/entities/creatures/*` + hydration helpers | Character/Monster/NPC lifecycle, session management, inventory | Character generator tests, session CRUD scenarios |

### Why 2 Domain SMEs (Not 1 or 3+)

**Data-driven rationale from domain analysis:**

| Area | Files | Est. LOC | Test Coverage | Expertise |
|------|-------|----------|--------------|-----------|
| Rules Engine (rules/ + combat/ + effects/) | 37 source | ~4,000-5,000 | 93% | Grid math, pathfinding, D&D mechanics, DC/AC formulas |
| Class System (classes/ + abilities/) | 22 source | ~2,500-3,000 | 89% | Profile+executor pattern, resource factories, per-class features |
| Foundation Types (creatures/ items/ core/ combat/ spells/) | 38 source | ~2,500-3,000 | 0-20% | Structural types, rarely change — shared knowledge for both SMEs |

**Split at 2 because:**
- Rules and Classes require genuinely different expertise (coordinate geometry vs regex action mappings)
- Clean one-way coupling (`rules/ → entities/`) means they rarely need to negotiate
- Foundation types are stable and shared — don't need a dedicated agent
- 3+ domain SMEs would add coordination overhead that exceeds specialization benefit (extra review rounds in debate loop)

**Future split candidate:** SpellSystem could warrant its own domain SME if/when `spell-action-handler.ts` (540 lines) + concentration state machine + zone effects grow further.

### Why NOT Many Narrow Domain SMEs (Empirical Task Analysis)

Four realistic tasks were traced through the codebase to measure minimum file sets:

| Task | Min Files to Reason About | Domain Files | App Files | Cross-Boundary? |
|------|--------------------------|-------------|-----------|----------------|
| Barbarian Rage resistance | 4+ domain + 7 app callers | barbarian.ts, damage-defenses.ts, attack-resolver.ts | resource-utils.ts + 7 damage paths | **YES — HIGH** |
| Rogue Evasion | 2 domain + 3 app | rogue.ts, ability-checks.ts | saving-throw-resolver.ts, spell-action-handler.ts, tabletop-types.ts | **YES — requires type extension** |
| Grapple movement bug | 3 domain + 2 app | conditions.ts, movement.ts, grapple-shove.ts | two-phase-action-service.ts, resource-utils.ts | **YES — design gap** |
| Monk Deflect Energy | 3 domain + 2 app | monk.ts, combat-text-profile.ts, registry.ts | two-phase-action-service.ts, new executor | **NO — clean split** |

**Key findings:**
1. **3 of 4 tasks cross SME boundaries** — narrow SMEs create "dead zones" at boundaries where bugs actually live
2. **Average domain file = 70-100 lines** — context savings from narrower scope is negligible (~500 tokens per excluded file)
3. **The bottleneck is REASONING about cross-file interactions, not fitting files in context** — a Movement-SME wouldn't know grapple conditions affect speed
4. **The one clean split (domain vs application) already matches the 2-SME model** — Task 4 shows this perfectly
5. **class-resources.ts intentionally imports 10 class files** — a narrow "utilities" SME would be blind to class semantics when reasoning about resource initialization

### Why These Boundaries Work
- Follow existing DDD layer separation (domain → application → infrastructure)
- Match the two established patterns: ClassCombatTextProfile (domain, text matching) and AbilityRegistry (application, execution)
- Each flow has its own test artifacts (scenarios grouped by class/feature)
- Minimal overlap — cross-cutting only at well-defined contracts (AbilityExecutor interface, CombatContext, CombatMap)
- No circular dependencies detected in the domain layer

---

## Part 2: Adapted Agent Architecture

### Agent Graph
```
Orchestrator
├── CombatRules-SME          (reviewer: domain/rules/*)
├── ClassAbilities-SME        (reviewer: class profiles + executors)
├── SpellSystem-SME           (reviewer: spell pipeline + concentration)
├── CombatOrchestration-SME   (reviewer: tabletop facade + dispatch)
├── AIBehavior-SME            (reviewer: AI turn + LLM integration)
├── EntityManagement-SME      (reviewer: character/monster lifecycle)
├── CombatRules-Implementer
├── ClassAbilities-Implementer
├── SpellSystem-Implementer
├── CombatOrchestration-Implementer
├── AIBehavior-Implementer
├── EntityManagement-Implementer
├── E2EScenarioWriter         (replaces uitest-writer — writes JSON test scenarios)
├── VitestWriter              (replaces unit-test-writer — writes vitest .test.ts files)
└── MetricsAgent              (NEW — captures study metrics)
```

### Key Adaptations from Template
1. **No XCTest/XCUITest** → Replace with Vitest unit tests + JSON E2E scenario writer
2. **No Swift Page Objects** → E2E scenarios use the test-harness scenario runner format
3. **No Coordinator/Router pattern** → D&D combat state machine replaces navigation patterns
4. **Mermaid diagrams** → Show combat state machines and ability dispatch flow instead of UI flows
5. **applyTo globs** → Use `packages/game-server/src/domain/rules/**` style paths instead of iOS folder structure

---

## Part 3: Effectiveness Study Design

### Hypothesis
> Multi-agent orchestration with domain-specialized sub-agents produces higher-quality implementations with fewer rework cycles for cross-domain features, at the cost of higher total tool-call volume for single-domain features.

### Study Methodology

#### Variables
- **Independent**: Agent configuration (single-agent vs multi-agent orchestrator)
- **Dependent**: Correctness, rework cycles, tool calls, errors encountered, context utilization
- **Controlled**: Same task specification, same codebase state (git branch), same LLM model

#### Task Selection (3 pairs, escalating complexity)

| Pair | Task A (Single Agent) | Task B (Multi-Agent) | Complexity | Cross-Domain? |
|------|----------------------|---------------------|------------|---------------|
| **1** | Cover Mechanics 13.1 (DEX save cover) | Cover Mechanics 13.1 (DEX save cover) | Low | Minimal |
| **2** | Ready Action 6.1a (non-spell) | Ready Action 6.1a (non-spell) | Medium | Yes (domain→app→infra) |
| **3** | Class Features P1: Barbarian rage+extras | Class Features P1: Barbarian rage+extras | High | Heavy (domain+executors+scenarios+dispatch) |

Each task pair runs on identical git branches. The single-agent gets the full plan prompt. The multi-agent gets the orchestrator which delegates to SMEs then implementers.

#### Metrics to Capture (MetricsAgent responsibility)

| Metric | How Captured | Category |
|--------|-------------|----------|
| **Total tool calls** | Count all tool invocations in the conversation | Efficiency |
| **Unique files read** | Deduplicated file paths from read_file/grep_search | Context gathering |
| **Unique files modified** | Count edited files | Scope discipline |
| **Error encounters** | Count get_errors calls that return problems | Quality |
| **Rework cycles** | Count times a file is edited more than once | Iteration |
| **Test pass rate** | Parse test runner output for pass/fail/skip | Correctness |
| **E2E scenario results** | Parse scenario runner output | Correctness |
| **Context window tokens used** | Estimate from conversation length | Resource usage |
| **Off-scope modifications** | Files touched outside the plan's scope | Discipline |
| **Total conversation turns** | Count user↔assistant exchanges | Efficiency |
| **Compilation errors introduced** | Count typecheck failures from get_errors | Quality |

### Phases

#### Phase 1: Infrastructure Setup (agents + metrics capture)
1. Create `.github/agents/orchestrator.agent.md` adapted for DungeonMaster (debate-loop pattern)
2. Create 2 SME agents for the first study tasks: `CombatRules-sme.agent.md`, `ClassAbilities-sme.agent.md`
3. Create 2 implementer agents: `CombatRules-implementer.agent.md`, `ClassAbilities-implementer.agent.md`
4. Create `MetricsAgent.agent.md` — specialized agent that:
   - Reads conversation transcripts/summaries
   - Tallies tool calls by type
   - Counts file operations
   - Parses test output for pass/fail
   - Writes structured JSON metrics to `.github/study/metrics/`
5. Create `.github/instructions/` directory with flow-level instruction files for CombatRules and ClassAbilities
6. Create `.github/study/` directory structure:
   ```
   .github/study/
   ├── README.md                    # Study methodology + hypothesis
   ├── task-specs/                  # Identical task prompts for both conditions
   │   ├── cover-13.1.md
   │   ├── ready-action-6.1a.md
   │   └── barbarian-rage.md
   ├── metrics/                     # MetricsAgent output
   │   ├── single-agent/
   │   └── multi-agent/
   └── analysis/                    # Final comparison reports
   ```

#### Phase 2: Baseline Calibration (1 easy task)
1. Run Cover Mechanics 13.1 with single-agent (Developer agent + full plan prompt)
2. After completion, invoke MetricsAgent to capture metrics → `.github/study/metrics/single-agent/cover-13.1.json`
3. Reset branch
4. Run Cover Mechanics 13.1 with orchestrator → SME review → implementer execution
5. After completion, invoke MetricsAgent → `.github/study/metrics/multi-agent/cover-13.1.json`
6. Compare. Calibrate MetricsAgent if metrics seem wrong or incomplete.

#### Phase 3: Medium Complexity Trial (Ready Action)
1. Single-agent: Ready Action 6.1a on clean branch
2. MetricsAgent captures → single-agent/ready-action-6.1a.json
3. Reset branch
4. Multi-agent: orchestrator → CombatRules-SME + CombatOrchestration-SME research → plan → review loop → implementers
5. MetricsAgent captures → multi-agent/ready-action-6.1a.json

#### Phase 4: High Complexity Trial (Barbarian Rage)
1. Single-agent: Barbarian rage + Unarmored Defense + Danger Sense on clean branch
2. MetricsAgent captures → single-agent/barbarian-rage.json
3. Reset branch
4. Multi-agent: orchestrator → ClassAbilities-SME + CombatRules-SME research → plan → review → ClassAbilities-Implementer + E2EScenarioWriter
5. MetricsAgent captures → multi-agent/barbarian-rage.json

#### Phase 5: Analysis
1. MetricsAgent generates comparison report across all 3 task pairs
2. Compute deltas: multi-agent vs single-agent for each metric
3. Identify crossover point: at what complexity level does multi-agent outperform?
4. Document qualitative observations (coordination overhead, SME accuracy, plan quality)

---

## Part 4: MetricsAgent Design

### `.github/agents/MetricsAgent.agent.md` Key Features

**Inputs it needs:**
- Task identifier (e.g., "cover-13.1")
- Condition identifier ("single-agent" or "multi-agent")
- Access to git diff (files changed)
- Access to test output (pass/fail counts)
- Conversation summary or transcript

**Metrics it produces (JSON):**
```json
{
  "taskId": "cover-13.1",
  "condition": "single-agent",
  "timestamp": "2026-03-17T...",
  "toolCalls": {
    "total": 47,
    "byType": { "read_file": 18, "grep_search": 12, "edit_file": 8, "run_terminal": 6, "semantic_search": 3 }
  },
  "fileOperations": {
    "uniqueFilesRead": 14,
    "uniqueFilesModified": 5,
    "offScopeModifications": 0,
    "reworkCycles": 1
  },
  "quality": {
    "compilationErrors": 0,
    "testsPassed": 12,
    "testsFailed": 0,
    "testsSkipped": 2,
    "e2eScenariosPass": 2,
    "e2eScenariosFail": 0
  },
  "efficiency": {
    "conversationTurns": 8,
    "totalAgentInvocations": 1,
    "estimatedTokens": 45000
  },
  "correctness": {
    "planAdherence": "full",
    "missingRequirements": [],
    "extraChanges": []
  }
}
```

**Analysis it performs:**
- Per-task comparison tables (single vs multi)
- Aggregate efficiency ratios
- Crossover complexity analysis
- Radar chart data for multi-dimensional comparison

### Practical Limitations & Mitigations

| Limitation | Mitigation |
|-----------|-----------|
| Can't auto-count tool calls from within a chat | MetricsAgent reads git diff + test output as proxies; user manually notes conversation turn count |
| Single run per task isn't statistically significant | Document as case study, not statistical proof; note trends across 3 complexity levels |
| Multi-agent overhead is itself a cost | Track agent invocation count as explicit metric |
| LLM non-determinism | Use deterministic test suite (mock E2E, no LLM tests); fix random seeds where possible |
| Human involvement varies | Standardize: give each condition the same plan prompt, intervene only on blocking errors |

---

## Relevant Files

### Existing (to reuse or reference)
- `.github/agents/developer.agent.md` — Current single-agent baseline, adapt tools list for sub-agents
- `.github/agents/TestingAgent.agent.md` — Test execution patterns to replicate in E2EScenarioWriter
- `.github/copilot-instructions.md` — Architecture knowledge to embed in SME instruction files
- `.github/prompts/plan-class-features-phase8.prompt.md` — Barbarian task spec source
- `.github/prompts/plan-ready-action.prompt.md` — Ready Action task spec source
- `.github/prompts/plan-cover-mechanics.prompt.md` — Cover task spec source

### To Create
- `.github/agents/orchestrator.agent.md`
- `.github/agents/CombatRules-sme.agent.md`
- `.github/agents/ClassAbilities-sme.agent.md`
- `.github/agents/CombatRules-implementer.agent.md`
- `.github/agents/ClassAbilities-implementer.agent.md`
- `.github/agents/MetricsAgent.agent.md`
- `.github/agents/E2EScenarioWriter.agent.md`
- `.github/agents/VitestWriter.agent.md`
- `.github/instructions/combat-rules.instructions.md` (applyTo: `packages/game-server/src/domain/rules/**`)
- `.github/instructions/class-abilities.instructions.md` (applyTo: `packages/game-server/src/domain/entities/classes/**`)
- `.github/study/README.md`
- `.github/study/task-specs/cover-13.1.md`
- `.github/study/task-specs/ready-action-6.1a.md`
- `.github/study/task-specs/barbarian-rage.md`

---

## Verification

1. **Agent invocability**: Each agent can be invoked via `@agentName` in VS Code and responds correctly with its domain scope
2. **Instruction loading**: Instruction files trigger automatically when editing files matching their `applyTo` globs
3. **Orchestrator debate loop**: Orchestrator can invoke SME → receive plan feedback → iterate → dispatch to implementer
4. **MetricsAgent output**: Produces valid JSON with all metric fields after a sample task-pair completion
5. **Study reproducibility**: Task specs are identical between conditions; git branch reset verified between runs
6. **E2E scenarios pass**: `pnpm -C packages/game-server test:e2e:combat:mock` passes after each implementation condition

---

## Decisions

- **Flow count**: 6 flows (not 8+) to avoid agent explosion; each maps to a clear domain subdirectory
- **No iOS patterns**: Replaced XCTest/XCUITest with Vitest + E2E scenario runner; no Page Objects needed
- **MetricsAgent is manual-invoke**: Not auto-running; user invokes after each task completion because tool-call introspection isn't automatic
- **3 task pairs, not more**: Pragmatic scope — statistical rigor would need 20+ runs; this is a case study yielding directional insights
- **Start with 2 flows**: Only CombatRules + ClassAbilities for Phase 1; add more flows if the study shows multi-agent value
- **Shared test writers**: E2EScenarioWriter and VitestWriter are flow-agnostic; flow-specific knowledge comes from instruction files

---

## Further Considerations

1. **Context window pressure in orchestrator**: The debate-loop pattern (SME research → plan → feedback → revision) may consume significant context. Consider whether the orchestrator should use file-based communication exclusively (plan-on-disk) or if inline summaries are acceptable. **Recommendation**: Plan-on-disk for SME artifacts, inline summaries for orchestrator decisions.

2. **Agent tool restrictions**: The bootstrapper template includes `execute` for implementers. In this project, `run_in_terminal` equivalent is needed for test execution. Ensure implementer agents have terminal access while SMEs do not. **Recommendation**: SMEs get `[read, search]` only; implementers get `[read, edit, search, execute]`; MetricsAgent gets `[read, search]`.

3. **Study timing and order effects**: Running single-agent first means the codebase state is "cleaner" (no partial implementations). Running multi-agent first could bias results if agents leave artifacts. **Recommendation**: Always single-agent first, reset branch, then multi-agent. Document this as a known ordering bias.
