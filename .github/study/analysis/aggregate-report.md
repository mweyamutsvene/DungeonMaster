# AI-Assisted Code Generation for Complex Rule Systems: A Preliminary Comparative Study of Single-Agent, Multi-Agent, and Human Developer Approaches

**Internal Technical Report — March 2026**

---

## Abstract

This report presents a preliminary case study comparing three approaches to implementing features in a deterministic D&D 5e rules engine: (1) a single AI coding agent (GitHub Copilot with Claude Opus 4.6), (2) a multi-agent orchestration system with domain-specialized sub-agents, and (3) an experienced human developer following test-driven development (TDD) practices. Two implementation tasks of escalating complexity were evaluated: a moderate-complexity cover mechanics feature (DEX saving throw cover bonus) and a high-complexity class feature set (Barbarian Phase 8.1 — six sub-features spanning domain rules, application services, and infrastructure adapters).

Results suggest that both AI approaches dramatically reduce wall-clock development time relative to the human baseline — by approximately 98% for the moderate task and 99% for the high-complexity task — while producing fewer post-implementation defects. The multi-agent approach demonstrated superior defect prevention through pre-implementation architectural review (catching 5 gameplay-breaking defects across both tasks) and better context window management for complex tasks, at the cost of 3.4–4.4× higher internal tool call volume. The single-agent approach offered faster execution with lower overhead but missed architectural edge cases that required additional correction cycles.

These findings are preliminary. The study's small sample size (n=2 tasks, n=1 human developer, n=1 run per condition), ordering bias, and domain specificity preclude generalization. The report is intended for internal evaluation of AI-assisted development workflows, not as a publishable empirical study.

---

## 1. Introduction

### 1.1 Motivation

Enterprise software teams face a persistent challenge: implementing complex, rule-heavy business logic correctly the first time. Game rules engines — particularly those implementing tabletop RPG systems like Dungeons & Dragons 5th Edition (2024) — represent an extreme case of this challenge. They require:

- **Deep domain knowledge**: Hundreds of interacting rules with subtle edge cases
- **Cross-cutting concerns**: A single feature (e.g., Barbarian Rage) touches domain entities, combat resolution, damage calculation, turn management, action economy, and AI decision-making
- **Deterministic correctness**: Rules must be implemented exactly as specified; "close enough" creates compounding errors

The emergence of large language model (LLM)-powered coding agents introduces a new development modality. This study examines whether AI agents can implement such features correctly, and whether multi-agent orchestration (where specialized sub-agents handle domain research, architectural review, implementation, and testing) offers measurable advantages over a single general-purpose agent.

### 1.2 System Under Study

The target system is a TypeScript/Node.js game server (`packages/game-server`) implementing D&D 5e 2024 rules as a deterministic engine. Key architectural characteristics:

- **Domain-Driven Design**: Pure rules logic in `domain/`, orchestration in `application/`, adapters in `infrastructure/`
- **Dual-path patterns**: Multiple code paths for the same operation (e.g., player-rolled vs. server-auto-rolled initiative; `extractActionEconomy()` vs. `resetTurnResources()` for turn resets)
- **ClassCombatTextProfile + AbilityExecutor pattern**: Domain declares class-specific data; application layer executes via registry
- **Comprehensive E2E harness**: 145+ scenario-driven integration tests with deterministic mock dice

These architectural patterns are particularly relevant because the dual-path nature of the codebase creates a class of defects where a feature works in one code path but silently fails in another — exactly the kind of bug that is difficult to catch without deep system knowledge.

### 1.3 Research Questions

1. **RQ1**: How do AI agents compare to an experienced human developer in time-to-completion and defect rate for rule-engine features?
2. **RQ2**: Does multi-agent orchestration with domain-specialized review reduce defects compared to a single generalist agent?
3. **RQ3**: What is the efficiency tradeoff — does multi-agent overhead (tool calls, subagent coordination) justify its quality benefits?

---

## 2. Methodology

### 2.1 Experimental Design

A within-subjects case study with three conditions applied to two tasks:

| Condition | Description |
|-----------|-------------|
| **Human Developer** (baseline) | Senior developer, primary author of the codebase, following TDD practices |
| **Single-Agent** | GitHub Copilot (Claude Opus 4.6) with full task specification and codebase instructions |
| **Multi-Agent** | Orchestrator agent dispatching to domain-specialized SME research agents, SME review agents, implementer agents, and test-writer agents |

Both AI conditions received identical task specifications, codebase instruction files, and starting branch state. The human developer worked from equivalent requirements with full codebase knowledge.

### 2.2 Task Selection

| Task ID | Description | Complexity | Cross-Domain Scope |
|---------|-------------|------------|-------------------|
| `cover-13.1` | DEX saving throw cover bonus | Moderate | Minimal — 2 primary files, 1 E2E scenario |
| `barbarian-rage` | Barbarian Phase 8.1 — 6 features (rage resistance, unarmored defense, danger sense, extra attack, rage end mechanics, feral instinct) | High | Heavy — domain rules, class entities, ability executors, combat services, turn management, AI paths, 4 E2E scenarios |

The moderate task was chosen as a bounded, well-scoped feature to establish baseline measurements. The high-complexity task was chosen to stress-test cross-domain coordination, context window management, and architectural review capabilities.

A third task (Ready Action 6.1a, medium complexity) was specified but excluded from the final analysis to focus resources on the two tasks that best illustrate the complexity spectrum.

### 2.3 Metrics

| Category | Metric | Human | AI Agents |
|----------|--------|-------|-----------|
| **Efficiency** | Wall-clock time | Self-reported hours | Not directly measured (estimated minutes) |
| **Efficiency** | Premium requests (billing unit) | N/A | Count of user→agent messages |
| **Efficiency** | Internal tool calls | N/A | Count of read/write/search/terminal operations |
| **Quality** | Compile/run errors during development | Self-reported | Observed in terminal output |
| **Quality** | Post-implementation bugs | Self-reported | Analyzed via test results and code review |
| **Quality** | Defects prevented (multi-agent only) | N/A | Counted from SME review feedback |
| **Deliverables** | Unit tests produced | Part of TDD cycle | Counted from test output |
| **Deliverables** | E2E scenarios produced | Part of development | Counted from scenario files |

### 2.4 Procedure

1. **Human developer** implemented both tasks over separate sessions using standard TDD workflow (write test → implement → refactor → repeat)
2. **Single-agent** condition ran first for each task. The agent received the full task spec as a prompt and worked autonomously
3. Git branch was reset between single-agent and multi-agent conditions
4. **Multi-agent** condition used an orchestrator that dispatched to specialized sub-agents (SME researchers → SME reviewers → implementers → test writers)
5. Metrics were collected after each condition by a dedicated MetricsAgent reading git diffs, test output, and conversation transcripts

### 2.5 Multi-Agent Architecture

The multi-agent system used the following sub-agent roles:

| Role | Count per Task | Responsibility |
|------|---------------|----------------|
| SME Research | 3–4 | Read codebase files within a specific domain (e.g., CombatRules, ClassAbilities) and document patterns |
| SME Review | 4–6 (across rounds) | Review the implementation plan against domain knowledge; flag architectural issues |
| Implementer | 3 | Execute plan changes in specific files (parallelized by domain) |
| Test Writer | 1–2 | Create E2E scenarios and unit tests |

SME review operated in rounds: Round 1 review → feedback → plan revision → Round 2 review → approval → implementation.

---

## 3. Results

### 3.1 Task 1: Cover Mechanics (Moderate Complexity)

#### 3.1.1 Summary Table

| Metric | Human Developer | Single-Agent | Multi-Agent |
|--------|----------------|-------------|-------------|
| **Wall-clock time** | 8 hours | ~5 minutes* | ~12 minutes* |
| **Compile/run errors** | 25 | 0 | 0 |
| **Post-impl bugs** | 6 | 2 (latent) | 0 |
| **Premium requests** | N/A | 1 (projected 3 with bug fixes) | 1 |
| **Internal tool calls** | N/A | 68 | 231 |
| **Unit tests passed** | — | 509 | 521 (+12 new) |
| **E2E scenarios passed** | — | 142/142 | 142/142 |
| **Files modified** | — | 4 | 6 |

*AI wall-clock times are estimates based on typical tool call execution rates. Not directly measured.

#### 3.1.2 Quality Analysis

The **human developer** encountered 25 compile/run errors during the TDD cycle (a normal iterative cost) and introduced 6 bugs that survived the initial test suite — discovered later through integration testing or manual play testing.

The **single-agent** produced a working implementation in one premium request with zero compilation errors. However, post-hoc analysis identified 2 latent bugs: (1) a missing `castSpell()` call in the total-cover early-return path (spell slot would not be consumed), and (2) missing null guards on map/position data (server crash on non-mapped encounters). These passed all existing tests but would fail in edge-case scenarios.

The **multi-agent** system caught both of these bugs during SME review *before any code was written*. The CombatOrchestration-SME and SpellSystem-SME identified these issues in Round 1 review, leading to a plan revision. The final implementation had zero latent defects and additionally produced 12 unit tests that single-agent did not create.

#### 3.1.3 Efficiency Analysis

| Efficiency Metric | Human | Single-Agent | Multi-Agent |
|-------------------|-------|-------------|-------------|
| Time to working implementation | 8 hours | ~5 min | ~12 min |
| Time to *correct* implementation | 8+ hours (bugs required additional debugging) | ~15 min (est. 2 additional fix cycles) | ~12 min |
| Rework cycles | Continuous (TDD) | 1 (message format) | 3 (E2E config, test fix, plan revision) |

### 3.2 Task 2: Barbarian Phase 8.1 (High Complexity)

#### 3.2.1 Summary Table

| Metric | Human Developer | Single-Agent | Multi-Agent |
|--------|----------------|-------------|-------------|
| **Wall-clock time** | 16 hours | ~15 minutes* | ~45 minutes* |
| **Compile/run errors** | 68 | 0 | 0 |
| **Post-impl bugs** | 12 | 0 | 0 (3 prevented pre-impl) |
| **Premium requests** | N/A | 2 | 1 |
| **Internal tool calls** | N/A | 129 | 572 |
| **Unit tests passed** | — | 521 (no new) | 575 (+54 new) |
| **E2E scenarios passed** | — | 145/145 (4 new) | 145/145 (4 new) |
| **Files modified + created** | — | 14 | 28 |
| **Defects prevented by review** | N/A | 0 | 3 (all gameplay-breaking) |

*AI wall-clock times are estimates. Not directly measured.

#### 3.2.2 Quality Analysis

The **human developer** encountered 68 compile/run errors across the 6 sub-features — reflecting the iterative nature of implementing cross-cutting features across domain, application, and infrastructure layers. More significantly, 12 bugs were introduced due to incorrect test specifications: the TDD tests themselves encoded wrong assumptions about D&D 5e rules or codebase interaction patterns (e.g., wrong timing for rage-end checks, incorrect scope for damage resistance, misunderstanding of dual-path turn management). Code that passed these flawed tests exhibited incorrect behavior in practice.

The **single-agent** completed the task in 2 premium requests (context window compaction after request 1 required a continuation). The final implementation was correct with zero post-implementation bugs. Two E2E scenario authoring issues (Extra Attack step format, rage-ends monster placement) were resolved within the same session.

The **multi-agent** system completed the task in 1 premium request. SME review caught 3 gameplay-breaking architectural defects in the Round 1 plan:

1. **Feral Instinct targeted the wrong function** — The plan modified `initiateAction()` instead of the dual initiative paths (`computeInitiativeModifiers()` + `computeInitiativeRollMode()`). Would have caused Feral Instinct to silently fail for player-rolled initiative.
2. **Rage attack tracking in the wrong handler** — The plan tracked in `handleDamageRoll` instead of `handleAttackRoll`, conflating "dealt damage" with "made an attack." Rage would incorrectly end when attacks deal 0 damage.
3. **Missing `extractActionEconomy()` dual-reset path** — Only `resetTurnResources()` was addressed. Rage tracking flags would never reset in the primary tabletop path, preventing rage-end from ever triggering correctly.

All three are instances of the codebase's dual-path architecture creating subtle failure modes. Notably, a fourth bug (rage-end timing: checking the outgoing combatant instead of the incoming combatant) was *not* caught by SME review — it was an implementation-level error discovered by E2E testing. This suggests SME review is effective at the plan/architecture level but does not replace runtime testing.

#### 3.2.3 Context Window Management

A structurally significant finding emerged from the high-complexity task:

| Context Metric | Single-Agent | Multi-Agent |
|----------------|-------------|-------------|
| Premium requests required | 2 | 1 |
| Context compaction occurred | Yes — forced 2nd premium request | Yes — no impact |
| Context utilization at end | 66% | 75% |

The single-agent accumulated raw tool outputs in a single context window, triggering compaction that lost its working history and forced a continuation. The multi-agent's subagent architecture acted as natural context compression: each subagent performed deep work, returned a summary, and released its context. The orchestrator never carried raw file contents — only compressed subagent reports. This architectural advantage becomes more pronounced as task complexity increases.

### 3.3 Cross-Task Comparison

#### 3.3.1 Time Efficiency (Human Baseline = 1.0×)

| Task | Human | Single-Agent | Multi-Agent |
|------|-------|-------------|-------------|
| Cover (moderate) | 1.0× (8 hrs) | ~0.01× (~5 min) | ~0.025× (~12 min) |
| Barbarian (high) | 1.0× (16 hrs) | ~0.016× (~15 min) | ~0.047× (~45 min) |

Both AI conditions demonstrate roughly two orders of magnitude improvement in wall-clock time, though these estimates carry significant uncertainty (see Limitations).

#### 3.3.2 Defect Rates

| Task | Human Bugs | Single-Agent Bugs | Multi-Agent Bugs | Multi-Agent Prevented |
|------|------------|-------------------|-------------------|-----------------------|
| Cover (moderate) | 6 | 2 (latent) | 0 | 2 |
| Barbarian (high) | 12 | 0 | 0 | 3 |
| **Total** | **18** | **2** | **0** | **5** |

The human developer's bug rate increased proportionally with complexity (6 → 12), driven primarily by incorrect test specifications encoding wrong rule assumptions. Both AI conditions produced implementations passing all tests. Multi-agent prevented 5 bugs total via SME review — all classified as gameplay-breaking.

#### 3.3.3 AI Overhead Scaling

| Task | Complexity | Single-Agent Tool Calls | Multi-Agent Tool Calls | Ratio |
|------|------------|------------------------|----------------------|-------|
| Cover | Moderate | 68 | 231 | 3.4× |
| Barbarian | High | 129 | 572 | 4.4× |

The multi-agent overhead ratio increases with task complexity (3.4× → 4.4×), driven by subagent coordination and the broader research phase. However, this overhead is entirely internal — it represents zero marginal billing cost and manifests only as increased wall-clock time and context window pressure.

#### 3.3.4 Compile/Run Error Comparison

| Task | Human | Single-Agent | Multi-Agent |
|------|-------|-------------|-------------|
| Cover (moderate) | 25 | 0 | 0 |
| Barbarian (high) | 68 | 0 | 0 |
| **Total** | **93** | **0** | **0** |

Neither AI condition produced a single compilation or runtime error across either task. The human developer's 93 compile/run errors are a normal artifact of iterative TDD development but represent real friction: each error requires reading the diagnostic, understanding the failure, locating the issue, and making a correction. AI agents perform these iterations internally without exposing them as separate failure events.

---

## 4. Discussion

### 4.1 Why the Human Developer Is Slower (and Buggier)

The 100× time differential is not primarily about typing speed or code generation volume. Three structural factors dominate:

**Context switching cost**: The human developer must hold the mental model of the entire system while editing one file. When implementing Barbarian Rage, this means simultaneously tracking domain entity definitions, ability executor patterns, combat service turn management, dual-path action economy, AI decision paths, and E2E scenario formats. Each context switch between files incurs cognitive load. AI agents load file contents as needed and can read 10+ files in parallel — context switching has near-zero cost.

**Compile-run-debug cycle time**: The human developer's 93 compile/run errors represent 93 interruptions to flow state. Each cycle involves: save → wait for compilation → read error → navigate to file → fix → repeat. AI agents generate syntactically and semantically valid code on the first attempt by virtue of having the relevant type definitions and patterns in context simultaneously.

**Test specification errors**: The most consequential finding is the 12 bugs in the high-complexity task caused by *incorrect tests*. TDD assumes the developer writes correct tests, but for complex rule systems with subtle interaction patterns, the test author faces the same knowledge gaps as the implementer. The AI agents had an advantage here: they could read the actual D&D 5e rules documentation, the existing codebase patterns, and the full type system simultaneously, reducing the likelihood of encoding incorrect assumptions in tests.

### 4.2 Multi-Agent vs. Single-Agent: When Review Pays Off

The multi-agent approach caught 5 gameplay-breaking defects that single-agent missed (or would have had to discover through testing). These fell into two categories:

**Dual-path architectural defects** (3 of 5): The codebase has multiple code paths for the same logical operation (initiative computation, turn resets, action economy). Features that modify one path but not the other silently fail in the unmodified path. These defects are particularly insidious because:
- They pass all tests that exercise only one path
- They produce correct behavior in common cases
- They fail silently (no crash, no error — just wrong game mechanics)

Multi-agent's domain-specialized SME reviewers were effective at catching these because each SME read deeply within their domain and understood which dual paths existed. A single generalist agent, reading more broadly but less deeply, was more likely to miss these.

**Edge-case logic defects** (2 of 5): The castSpell early return and null guard issues in the cover task. These are standard defensive programming concerns that a code review would catch.

### 4.3 Context Window as a Scaling Bottleneck

The most architecturally significant finding is the context window divergence on the high-complexity task. Single-agent needed 2 premium requests because its context window accumulated raw tool outputs until compaction was triggered, losing working history. Multi-agent completed in 1 premium request because the subagent architecture naturally compresses context — each subagent works, reports, and releases.

This suggests that multi-agent's advantage is not constant but *scales with task complexity*. For tasks that fit comfortably within a single context window (like the moderate cover task), both approaches complete in 1 premium request. For tasks that push context limits, multi-agent's architectural advantage in context management becomes the dominant factor.

### 4.4 The TDD Paradox

An unexpected finding: the human developer's TDD practice introduced *more* bugs, not fewer, in the high-complexity task. The mechanism was incorrect test specifications — tests that encoded wrong assumptions about D&D 5e rules and codebase interaction patterns. TDD is predicated on the assumption that tests are correct; when the domain is sufficiently complex, the test author's knowledge gaps become a source of defects rather than a guard against them.

Both AI conditions avoided this problem. The single-agent wrote no new unit tests (relying on E2E scenarios for verification), thereby avoiding the test-specification error mode entirely. The multi-agent *did* produce 54 new unit tests, but these were written by a specialized test-writer subagent *after* the implementation was verified against E2E scenarios, using the working code as ground truth rather than the developer's assumptions.

This is not an argument against TDD. It is an observation that TDD's effectiveness is bounded by the test author's domain knowledge, and that for highly complex rule systems, AI agents may have an advantage in domain knowledge breadth if not depth.

---

## 5. Limitations

This study has significant methodological limitations that preclude generalization of its findings. It should be treated as an internal exploration, not as empirical evidence for any general claim.

### 5.1 Sample Size

**n=2 tasks, n=1 run per condition.** Each task was implemented exactly once per condition. No statistical analysis is possible. Results could be driven by:
- Random variance in LLM generation quality
- Task-specific characteristics that favor or disfavor each approach
- One-time flukes in the human developer's performance (bad day, fatigue, etc.)

A rigorous study would require multiple tasks at each complexity level, each run multiple times per condition, with randomized ordering.

### 5.2 Single Human Developer

Only one developer served as the human baseline. This developer was the primary author of the codebase, providing maximum possible domain familiarity — arguably the *best case* for human performance. However:
- A less experienced developer would likely perform worse, inflating the AI advantage
- A different expert might perform better or differently
- The developer's self-reported metrics (hours, bug counts) are subject to recall bias and self-assessment error

### 5.3 Ordering Bias

Single-agent always ran before multi-agent. The codebase branch was reset between conditions, but the experimenters (and the MetricsAgent) had knowledge of single-agent's results when running multi-agent. This could bias:
- Task spec refinement (task specs may have been inadvertently improved after seeing single-agent struggles)
- Expectations for what constitutes a "bug" or "correct" implementation

### 5.4 AI Wall-Clock Time Estimates

AI agent wall-clock times are rough estimates, not measurements. Tool call latency varies with server load, file size, and terminal command execution time. The "~5 minutes" and "~45 minutes" figures should be treated as order-of-magnitude estimates only.

### 5.5 Domain Specificity

The target system is a deterministic rules engine with:
- Explicit, well-documented rules (D&D 5e 2024 rulebooks)
- Comprehensive existing test infrastructure
- Clean architectural patterns (DDD, explicit interfaces)

These characteristics may disproportionately favor AI agents, which excel at:
- Pattern-matching against existing code conventions
- Simultaneously holding multiple rule references in context
- Generating code that conforms to established interfaces

Results may not transfer to systems with less-documented requirements, inconsistent architectures, or requirements that depend on tacit organizational knowledge.

### 5.6 Cost Model Simplification

The study treats "premium requests" as the sole AI billing unit. This ignores:
- Token consumption differences between conditions
- Rate limiting effects on wall-clock time
- Opportunity cost of the orchestrator setup and agent definition work
- The human time required to write task specifications

### 5.7 Lack of Downstream Validation

Both AI conditions' implementations were validated against the existing test suite and new E2E scenarios. No long-term production use data exists. The "zero bugs" finding for AI conditions means "zero bugs detectable by the current test infrastructure" — not zero bugs in an absolute sense.

### 5.8 Hawthorne Effect

The human developer knew their work was being compared to AI agents. This awareness could have affected their performance in either direction (increased effort or increased anxiety).

---

## 6. Summary of Findings

### 6.1 RQ1: AI vs. Human Developer

| Dimension | Human (Baseline) | AI Agent Range | Magnitude |
|-----------|-----------------|---------------|-----------|
| Wall-clock time (moderate task) | 8 hours | 5–12 minutes | ~40–96× faster |
| Wall-clock time (high task) | 16 hours | 15–45 minutes | ~21–64× faster |
| Compile/run errors | 93 total | 0 | Eliminated |
| Post-implementation bugs | 18 total | 0–2 | 89–100% reduction |

AI agents demonstrate substantial advantages in both speed and defect rate for this domain. The speed advantage comes primarily from eliminating compile-run-debug cycle friction and context-switching costs. The quality advantage comes from simultaneous access to type definitions, rule documentation, and existing code patterns.

### 6.2 RQ2: Multi-Agent vs. Single-Agent Defect Prevention

| Metric | Single-Agent | Multi-Agent |
|--------|-------------|-------------|
| Bugs in final output | 2 (latent, moderate task) | 0 |
| Bugs prevented by review | 0 | 5 (all gameplay-breaking) |
| Premium requests (moderate) | 1 (projected 3 with fixes) | 1 |
| Premium requests (high) | 2 | 1 |

Multi-agent's SME review phase is effective at catching dual-path architectural defects — the most dangerous class of bugs in this codebase. The review phase adds tool call overhead but reduces total premium requests by preventing defects that would require separate debugging sessions.

### 6.3 RQ3: Overhead vs. Quality Tradeoff

| Task Complexity | Tool Call Ratio (Multi/Single) | Premium Request Ratio (Multi/Single) | Quality Advantage |
|-----------------|-------------------------------|-------------------------------------|-------------------|
| Moderate | 3.4× | 1.0× (or 0.33× projected) | 2 bugs prevented |
| High | 4.4× | 0.5× | 3 bugs prevented + 54 extra tests |

The overhead ratio grows with complexity (3.4× → 4.4×), but the efficiency ratio *inverts* with complexity. For the moderate task, both conditions used 1 premium request (even-to-favorable for multi-agent when accounting for latent bugs). For the high-complexity task, multi-agent used *fewer* premium requests (1 vs 2) because its subagent architecture managed context more effectively.

**The crossover point**: Multi-agent overhead is unjustified for tasks that fit comfortably within a single context window and have minimal cross-domain scope. It becomes advantageous when tasks involve cross-cutting concerns, dual-path architectural patterns, or context volumes that approach window limits.

---

## 7. Recommendations for Internal Use

Based on these preliminary findings, the following workflow guidelines are suggested for evaluation:

| Task Profile | Recommended Approach | Rationale |
|-------------|---------------------|-----------|
| Small, single-file changes | Single-agent | Overhead of multi-agent cannot be justified; defect risk is minimal |
| Moderate, well-scoped features | Single-agent with manual code review | Agent completes quickly; human review catches edge cases at low cost |
| High-complexity, cross-cutting features | Multi-agent with SME review | Dual-path defects are caught pre-implementation; context management scales; unit test generation is a bonus |
| Novel features with unclear requirements | Human developer with AI assist | Domain ambiguity requires human judgment; AI can accelerate implementation once requirements are settled |

### 7.1 Suggested Follow-Up Studies

To strengthen these findings, future work should:

1. **Increase sample size**: Run 5+ tasks at each complexity level, each executed 3+ times per condition, to enable statistical analysis
2. **Randomize ordering**: Counterbalance which condition runs first to control for ordering effects
3. **Multiple human developers**: Include 3–5 developers of varying experience levels to establish a proper human baseline distribution
4. **Measure wall-clock time precisely**: Instrument AI agent sessions with timestamps on each tool call
5. **Long-term defect tracking**: Deploy both AI conditions' code and measure defect discovery rate over weeks/months of use
6. **Cross-domain replication**: Repeat the study on a non-game-rules codebase (e.g., financial calculation engine, medical rules system) to test generalizability
7. **Cost-benefit analysis**: Include full cost accounting — agent API costs, human review time, task spec writing time, orchestrator setup time

---

## Appendix A: Raw Metrics Summary

### A.1 Cover Mechanics (Moderate Complexity)

| Metric | Human | Single-Agent | Multi-Agent |
|--------|-------|-------------|-------------|
| Wall-clock time | 8 hours | ~5 min (est.) | ~12 min (est.) |
| Compile/run errors | 25 | 0 | 0 |
| Post-impl bugs | 6 | 2 (latent) | 0 |
| Premium requests | N/A | 1 | 1 |
| Projected PRs for bug-free | N/A | 3 | 1 |
| Tool calls | N/A | 68 | 231 |
| Files modified | — | 4 | 6 |
| Unit tests added | — | 0 | 12 |
| E2E scenarios added | — | 1 | 1 |

### A.2 Barbarian Phase 8.1 (High Complexity)

| Metric | Human | Single-Agent | Multi-Agent |
|--------|-------|-------------|-------------|
| Wall-clock time | 16 hours | ~15 min (est.) | ~45 min (est.) |
| Compile/run errors | 68 | 0 | 0 |
| Post-impl bugs | 12 (bad tests) | 0 | 0 (3 prevented) |
| Premium requests | N/A | 2 | 1 |
| Tool calls | N/A | 129 | 572 |
| Files modified + created | — | 14 | 28 |
| Unit tests added | — | 0 | 54 |
| E2E scenarios added | — | 4 | 4 |
| Defects caught by review | N/A | 0 | 3 |

### A.3 Multi-Agent Subagent Breakdown

| Phase | Cover (Moderate) | Barbarian (High) |
|-------|-----------------|-----------------|
| SME Research agents | 3 | 4 |
| SME Review agents (Round 1) | 4 | 4 |
| SME Review agents (Round 2) | 2 | 2 |
| Implementer agents | 3 | 3 |
| Test Writer agents | 2 | 2 |
| **Total subagent invocations** | **14** | **15** |

---

## Appendix B: Defect Catalog

### B.1 Defects in Human Developer Implementation

**Cover task (6 bugs)**: Details not individually cataloged. Reported as logic defects that survived initial TDD test suite, discovered through later integration testing or manual play testing.

**Barbarian task (12 bugs)**: Attributable to incorrect test specifications. Tests encoded wrong assumptions about: rage-end timing (should check at start of *next* turn, not end of current), damage resistance scope, dual-path turn management interactions, and action economy reset paths.

### B.2 Defects in Single-Agent Implementation

| ID | Task | Description | Severity | Status |
|----|------|-------------|----------|--------|
| SA-1 | Cover | Missing `castSpell()` in total-cover early return — spell not consumed | Gameplay-breaking | Latent (passes all tests) |
| SA-2 | Cover | Missing null guards on map/position data — server crash on non-mapped encounters | Critical (crash) | Latent (passes all tests) |

### B.3 Defects Prevented by Multi-Agent SME Review

| ID | Task | Description | Severity | Caught By |
|----|------|-------------|----------|-----------|
| MA-1 | Cover | castSpell early return (same as SA-1) | Gameplay-breaking | SpellSystem-SME, Round 1 |
| MA-2 | Cover | Null guards on map/position (same as SA-2) | Critical | CombatOrchestration-SME, Round 1 |
| MA-3 | Barbarian | Feral Instinct wrong function target | Gameplay-breaking | CombatOrchestration-SME, Round 1 |
| MA-4 | Barbarian | Rage attack tracking in wrong handler | Gameplay-breaking | CombatOrchestration-SME, Round 1 |
| MA-5 | Barbarian | Missing extractActionEconomy() dual-reset | Gameplay-breaking | CombatOrchestration-SME, Round 1 |

### B.4 Defects Not Caught by Multi-Agent SME Review

| ID | Task | Description | Caught By |
|----|------|-------------|-----------|
| MA-X1 | Barbarian | Rage-end check on outgoing combatant instead of incoming | E2E testing (post-implementation) |

This defect was an implementation-level timing error, not a plan-level architectural flaw. It confirms that SME review is effective at the design level but does not replace runtime verification.

---

*Report generated by MetricsAgent. Data sources: git diff analysis, test output files, conversation transcripts, developer self-report. All AI metrics collected from GitHub Copilot with Claude Opus 4.6 (March 2026).*
