# Multi-Agent Effectiveness Study

## Hypothesis

> Multi-agent orchestration with domain-specialized sub-agents produces higher-quality implementations with fewer rework cycles for cross-domain features, at the cost of higher total tool-call volume for single-domain features.

## Methodology

### Variables
- **Independent**: Agent configuration (single-agent vs multi-agent orchestrator)
- **Dependent**: Correctness, rework cycles, tool calls, errors encountered, context utilization
- **Controlled**: Same task specification, same codebase state (git branch), same LLM model

### Task Pairs (3, escalating complexity)

| Pair | Task | Complexity | Cross-Domain? |
|------|------|------------|---------------|
| **1** | Cover Mechanics 13.1 (DEX save cover bonus) | Low | Minimal |
| **2** | Ready Action 6.1a (non-spell) | Medium | Yes (domain→app→infra) |
| **3** | Barbarian rage + extras (Phase 8.1) | High | Heavy (domain+executors+scenarios+dispatch) |

### Protocol
1. Each task runs on an identical git branch
2. Single-agent condition runs first (Developer agent + full plan prompt)
3. Branch reset between conditions
4. Multi-agent condition uses orchestrator → SME review → implementer execution
5. MetricsAgent captures metrics after each condition
6. Standardized: same plan prompt for both, intervene only on blocking errors

### Metrics (11)

| Metric | Category | How Captured |
|--------|----------|-------------|
| Total tool calls | Efficiency | Count all tool invocations |
| Unique files read | Context gathering | Deduplicated file paths |
| Unique files modified | Scope discipline | Count edited files |
| Error encounters | Quality | Count get_errors problems |
| Rework cycles | Iteration | Files edited more than once |
| Test pass rate | Correctness | Parse test runner output |
| E2E scenario results | Correctness | Parse scenario runner output |
| Context window tokens | Resource usage | Estimate from conversation length |
| Off-scope modifications | Discipline | Files outside plan scope |
| Conversation turns | Efficiency | User↔assistant exchanges |
| Compilation errors | Quality | Typecheck failures |

### Known Limitations
- Single run per task (case study, not statistical proof)
- Can't auto-count tool calls — MetricsAgent uses proxies
- Ordering bias (single-agent always first)
- LLM non-determinism mitigated by deterministic test suite

## Directory Structure
```
study/
├── README.md                    # This file
├── task-specs/                  # Identical task prompts for both conditions
│   ├── cover-13.1.md
│   ├── ready-action-6.1a.md
│   └── barbarian-rage.md
├── metrics/                     # MetricsAgent output
│   ├── single-agent/
│   └── multi-agent/
└── analysis/                    # Comparison reports
```

## Phases

1. **Infrastructure Setup** — Create agents, instructions, study scaffold (this phase)
2. **Baseline Calibration** — Cover 13.1 (low complexity, minimal cross-domain)
3. **Medium Complexity** — Ready Action 6.1a (medium, cross-domain)
4. **High Complexity** — Barbarian Rage (high, heavy cross-domain)
5. **Analysis** — MetricsAgent generates comparison + aggregate report
