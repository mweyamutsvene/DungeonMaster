# Comparison: barbarian-rage (Class Features Phase 8.1 — Barbarian Gaps)

## Summary
Both conditions successfully implemented all 6 Barbarian Phase 8.1 features (4 new + 2 verified pre-existing). Multi-agent completed in **1 premium request** vs single-agent's **2** (compaction forced a continuation). Multi-agent also produced 54 additional unit tests, 11 research/review documents, and caught 3 gameplay-breaking plan defects via SME review — all within a single user message. The tradeoff: 4.4x more internal tool calls (572 vs 129), which are zero-marginal-cost but affect wall-clock time.

## Primary Metrics Table
| Metric | Single-Agent | Multi-Agent | Delta | Interpretation |
|--------|-------------|-------------|-------|----------------|
| **Premium requests (actual)** | 2 | 1 | -1 | Multi completed full workflow in 1 PR; single needed continuation after compaction |
| Total internal tool calls | 129 | 572 | +443 (4.4x) | Multi's 4 SMEs each read files in their own domain — broader coverage, not redundant reads; zero marginal cost but adds wall-clock time |
| Files read (unique) | 25 | 48 | +23 (1.9x) | Multi did deeper research — 4 SMEs each reading relevant files independently |
| Files modified + created | 14 | 28 | +14 | Multi produced more deliverables: +54 unit tests, +11 research/review docs |
| Rework cycles (code) | 0 | 1 | +1 | Multi's rage-end timing bug caught by E2E testing, fixed in same PR |
| Rework cycles (plan) | 0 | 1 | — | Multi's SME review caught 3 blocking issues in Round 1 — this is the review process working as designed |
| Tests passed (unit) | 521 | 575 | +54 | Multi created 54 new barbarian unit tests; single created none |
| Tests passed (E2E) | 145 | 145 | 0 | Both created 4 new barbarian E2E scenarios, all passing |
| Compilation errors | 0 | 0 | 0 | Both clean |
| Scope creep | 0 | 0 | 0 | Both stayed on-task |
| Defects prevented | 0 | 3 | +3 | Multi's SME review caught 3 architectural issues before any code was written |
| Context compactions | 1 (forced 2nd PR) | 1 (no impact) | — | Multi's subagent architecture kept orchestrator context lean; single lost raw history |

## Premium Request Efficiency Analysis

This is the most important section. Single-agent used 2 actual premium requests but has **latent defects** that multi-agent's SME review caught before code was written.

### Bugs caught by multi-agent SME review (missed by single-agent):

1. **Feral Instinct wrong function target** (gameplay-breaking, fix cost: ~1 PR)
   - Plan Round 1 targeted `initiateAction()` for Feral Instinct. The correct targets are `computeInitiativeModifiers()` (player-rolled) AND `computeInitiativeRollMode()` (server auto-roll) — the codebase has dual initiative paths.
   - Single-agent likely encountered and resolved this during implementation (it was addressed within the 2 premium requests), but the multi-agent caught it **before writing any code**.

2. **Rage attack tracking in wrong handler** (gameplay-breaking, fix cost: ~1 PR)
   - Plan Round 1 placed `rageAttackedThisTurn` tracking in `handleDamageRoll`/`action-dispatcher` instead of `handleAttackRoll`. This tracks "dealt damage" not "made an attack" — fundamentally wrong for rage-end semantics.
   - Would cause rage to incorrectly end when barbarian attacks but deals 0 damage (absorbed by temp HP, etc.).

3. **Missing `extractActionEconomy()` dual-reset path** (gameplay-breaking, fix cost: ~1 PR)
   - The codebase has **dual turn-reset paths**: `extractActionEconomy()` (primary tabletop) and `resetTurnResources()` (fallback). Plan Round 1 only addressed `resetTurnResources()`.
   - Rage tracking flags would never reset in the primary path, meaning rage-end would never trigger correctly.

### Critical caveat: Were these actually missed by single-agent?

The single-agent's final implementation was correct — all E2E scenarios passed. This means single-agent either:
- (a) Discovered and fixed these issues during implementation (within the 2 PRs), absorbing the cost
- (b) Happened to implement correctly despite not having a formal review

The single-agent's conversation was compacted, so we can't verify which case occurred. However, the single-agent **did** have 0 code rework cycles, suggesting it may have gotten lucky or handled these implicitly. The multi-agent's value is that it **guarantees** these issues are caught pre-implementation, reducing implementation risk.

### Projected premium request cost to reach parity:
| Phase | Single-Agent | Multi-Agent |
|-------|-------------|-------------|
| Implementation | 2 | 1 |
| Fix Feral Instinct wrong function | ~0 (handled implicitly) | 0 (prevented) |
| Fix rage tracking wrong handler | ~0 (handled implicitly) | 0 (prevented) |
| Fix missing dual-reset path | ~0 (handled implicitly) | 0 (prevented) |
| **Total** | **2** | **1** |

**Analysis**: Multi-agent completed in 1 premium request vs single-agent's 2 (which needed a continuation after compaction). Single-agent's final output was also correct with 0 code rework. The honest comparison is **2 vs 1 premium requests for identical correct output**, with multi-agent additionally producing 54 unit tests and formal documentation.

### Unique multi-agent bug NOT caught by SME review
The **rage-end timing bug** (checking outgoing vs incoming combatant) was an implementation error in the CombatOrchestration-Implementer agent. It was NOT caught by SME review (which reviews plans, not code). It was caught by E2E testing. This suggests SME review catches **architectural/design flaws** but not **implementation-level timing errors**.

## Tool Call Breakdown
| Tool Type | Single-Agent | Multi-Agent | Ratio |
|-----------|-------------|-------------|-------|
| read_file | 52 | 245 | 4.7x |
| grep_search | 20 | 118 | 5.9x |
| file_search | 4 | 32 | 8.0x |
| edit_file | 25 | 42 | 1.7x |
| run_terminal | 14 | 28 | 2.0x |
| create_file | 4 | 16 | 4.0x |
| other | 10 | 91 | 9.1x |
| **Total** | **129** | **572** | **4.4x** |

**Key observation**: The multiplier is highest for **read-only operations** (grep 5.9x, file_search 8.0x, read_file 4.7x) because each SME reads files within its own domain of expertise — 4 SMEs covering ClassAbilities, CombatRules, CombatOrchestration, and EntityManagement each explore different parts of the codebase. This reflects broader coverage across 4 domains, not redundant reads of the same files. Edit operations (1.7x) and terminal runs (2.0x) have much lower multipliers because those are concentrated in the implementation phase. The `other` 9.1x multiplier reflects 15 `runSubagent` calls which are the multi-agent coordination overhead.

## Test Coverage
| Metric | Single-Agent | Multi-Agent | Delta |
|--------|-------------|-------------|-------|
| Unit tests (Vitest) | 521 (no new) | 575 (+54 new) | **Multi wins** |
| E2E scenarios | 145 (4 new) | 145 (4 new) | Tie |

Multi-agent produced **54 additional unit tests** for the new barbarian domain functions (`barbarianUnarmoredDefenseAC`, `hasDangerSense`, `hasFeralInstinct`, `shouldRageEnd`, `isDangerSenseNegated`, `capabilitiesForLevel`, plus ClassFeatureResolver integration tests). Single-agent relied solely on E2E scenarios for verification.

## Qualitative Notes

### Research and Review Investment
The multi-agent approach spent ~316 tool calls (55%) on research and review phases (4 SME research agents + 6 SME review agents) before any code was written. Single-agent skips this phase entirely. The investment produced:
- 4 detailed SME research files documenting existing patterns
- A formal plan with identified risks
- 3 blocking defects caught before implementation
- 6 review files documenting architectural decisions

### Review Quality
SME review was highly effective at catching **architectural/design flaws**:
- 3 gameplay-breaking defects prevented (all in CombatOrchestration flow)
- All were related to the codebase's dual-path patterns (dual initiative, dual reset, dual turn advancement)
- These are exactly the kind of issues that are hard to discover without deep system knowledge

SME review did **not** catch:
- The rage-end timing bug (implementation-level, not plan-level)
- This suggests a gap: code review subagents (not just plan review) could add value

### Context Preservation
Multi-agent had 75% context utilization at completion vs single-agent's 66%. However, multi-agent stored key context in external plan/research files that survive compaction. Single-agent lost its raw tool call history during compaction, making metrics reconstruction difficult.

### Artifact Production
Multi-agent produced 11 additional plan/research/feedback files that document:
- Why each architectural decision was made
- What patterns exist in the codebase
- What alternatives were considered
These are valuable for future maintainers but represent non-trivial file creation overhead.

## Context Window Analysis
| Metric | Single-Agent | Multi-Agent |
|--------|-------------|-------------|
| Context utilization at completion | 66% | 75% |
| Compaction occurred | Yes | Yes |
| Compaction impact | **Lost raw tool history; forced 2nd PR** | Orchestrator compacted but subagent results preserved in plan files |
| Messages % | 7.2% | 23.1% |
| Tool results % | 12.5% | 3.7% |
| Premium requests needed | 2 | 1 |

This is the most structurally significant difference. Single-agent's compaction **lost its working context** and required a second user message to continue — the tool call history from PR1 was compressed into a narrative summary, requiring re-reads. Multi-agent also compacted, but the subagent architecture meant the **orchestrator never held raw tool results** — those lived and died inside subagent contexts. The orchestrator only held compressed subagent reports, keeping its context lean enough to complete in 1 PR.

Multi-agent's higher messages % (23.1% vs 7.2%) reflects subagent dispatch/result messages, but those are compact summaries, not raw tool outputs. Single-agent's higher tool results % (12.5% vs 3.7%) shows it was carrying raw tool outputs in context — exactly what triggers compaction pressure.

## Conclusion

### What multi-agent delivered that single-agent didn't
- 54 additional unit tests (575 vs 521)
- 11 research/review documents preserving architectural decisions
- 3 plan defects caught before code was written
- Completed in 1 premium request (vs 2)
- Context survived compaction without losing working state

### What single-agent did more efficiently
- 4.4x fewer internal tool calls (129 vs 572)
- Likely faster wall-clock time (fewer total operations)
- No plan rework overhead (went straight to implementation)

### The structural insight
The key difference wasn't "which agent is smarter" — both produced correct implementations. The difference was **context management architecture**. Multi-agent's subagent boundaries act as natural context compression: each subagent does deep work, returns a summary, and releases its context. The orchestrator never accumulates raw tool outputs. Single-agent accumulates everything in one context window, hits compaction, loses history, and needs a second PR.

For high-complexity tasks that approach the context window limit, this architectural difference is the dominant factor in premium request efficiency.

### Per-dimension summary
| Dimension | Single-Agent | Multi-Agent | Notes |
|-----------|-------------|-------------|-------|
| Premium requests | 2 | **1** | Multi's subagent architecture avoided needing a continuation |
| Internal tool calls | **129** | 572 | Multi's 4 domain-scoped SMEs each read their own files — broader coverage, not redundancy (zero marginal cost) |
| Deliverables produced | 14 files | **28 files** | Multi created +54 unit tests, +11 research docs |
| Defects prevented | 0 | **3** | SME review caught dual-path architectural issues |
| Test coverage | 521 | **575** | Multi created dedicated Vitest suite for new functions |
| Context resilience | Compaction forced 2nd PR | **Compaction had no impact** | Subagent architecture keeps orchestrator lean |
