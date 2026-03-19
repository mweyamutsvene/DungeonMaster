# Comparison: cover-13.1 (DEX Saving Throw Cover Bonus)

## Summary
Both conditions successfully implemented the full task spec with zero compilation errors and all tests passing. Both completed in **1 premium request**. Multi-agent used 3.4x more internal tool calls (coordination overhead, zero marginal cost) but produced 12 additional unit tests, 7 research/review documents, and caught 2 latent bugs via SME review that remain unfixed in single-agent's code.

## Primary Metrics Table

| Metric | Single-Agent | Multi-Agent | Delta | Interpretation |
|--------|-------------|-------------|-------|----------------|
| **Premium requests (actual)** | 1 | 1 | 0 | Both completed full workflow in 1 PR |
| Total internal tool calls | 68 | 231 | +163 (3.4x) | Multi's 3 SMEs each read files in their own domain — broader coverage, not redundant reads; zero marginal cost but adds wall-clock time |
| Files read (unique) | 12 | 28 | +16 (2.3x) | Multi did deeper research — 3 SMEs each independently exploring relevant files |
| Files modified + created | 4 | 6 | +2 | Multi created dedicated resolver test file + E2E scenario file |
| Rework cycles (code) | 1 | 2 | +1 | Single: message format edit. Multi: E2E scenario config fix + test fix — normal authoring iteration |
| Rework cycles (plan) | 0 | 1 | — | Multi's SME review caught 2 blocking issues in Round 1 — this is the review process working as designed |
| Tests passed (unit) | 509 | 521 | +12 | Multi created 8 dedicated saving-throw-resolver tests; single created none |
| Tests passed (E2E) | 142 | 142 | 0 | Both created cover E2E scenarios, all passing |
| Compilation errors | 0 | 0 | 0 | Both clean |
| Scope creep | 0 | 0 | 0 | Both stayed on-task |
| Defects prevented | 0 | 2 | +2 | Multi's SME review caught 2 latent bugs before code was written |
| Conversation turns | 2 | 2 | 0 | Both completed in same number of user messages |

## Premium Request Efficiency Analysis

**Key insight**: Tool calls and subagent invocations are internal operations within a single premium request. The user sends 1 message ("implement this plan"), and regardless of whether the agent uses 68 or 231 internal tool calls, it costs **1 premium request**.

The critical efficiency question is: **how many total premium requests does each approach need to reach a bug-free implementation?**

### Bugs caught by multi-agent SME review (missed by single-agent):
1. **Missing `castSpell()` in total-cover early return** — Without this, casting a spell at a target with total cover would auto-succeed the save but NOT consume the spell slot or action. This is a gameplay-breaking bug that would surface during testing or play, requiring ≥1 premium request to diagnose and fix.
2. **Missing null guards on map/position data** — Without these, `handleSaveSpell()` would throw a runtime error when encounter has no map configured. This would crash the server on any non-mapped save spell, requiring ≥1 premium request to fix.

### Projected premium request cost to reach parity:

| Phase | Single-Agent | Multi-Agent |
|-------|-------------|-------------|
| Initial implementation | 1 request | 1 request |
| Fix bug #1 (castSpell slot consumption) | ~1 request | 0 (caught in review) |
| Fix bug #2 (null guard crash) | ~1 request | 0 (caught in review) |
| **Total to bug-free** | **~3 requests** | **1 request** |

This represents a **~3x premium request efficiency advantage** for multi-agent on this task, completely inverting the conclusion drawn from raw tool call counts.

## Tool Call Breakdown

| Tool Type | Single-Agent | Multi-Agent | Ratio |
|-----------|-------------|-------------|-------|
| read_file | 28 | 106 | 3.8x |
| grep_search | 19 | 56 | 2.9x |
| file_search | 3 | 10 | 3.3x |
| edit_file | 4 | 12 | 3.0x |
| run_terminal | 14 | 22 | 1.6x |
| create_file | 0 | 4 | N/A |
| other | 0 | 21 | N/A |

## Qualitative Notes

### Research and Review Investment
- **Multi-agent** dispatched 14 subagent invocations across 5 phases: 3 SME research, 4 SME review (R1), 2 SME review (R2), 3 implementers, 2 test writers. Each SME reads files within its own domain of expertise (CombatRules, CombatOrchestration, SpellSystem), so the 3.8x read_file ratio reflects broader domain coverage rather than redundant reads of the same files.
- **Single-agent** skipped the research/review phase — one agent read each file once and implemented sequentially.

### Review Quality
- **Multi-agent** caught 2 potential issues during SME review that led to plan improvements:
  1. Missing `castSpell()` in total-cover early return (action economy would not be consumed)
  2. Missing null guards for map/position data in `handleSaveSpell()`
  These were caught *before* implementation, preventing code-level rework.
- **Single-agent** did not have a formal review phase but still produced a working implementation. The single rework cycle was a message format edit, not a logic bug.

### SME Accuracy
- The multi-agent SME feedback was accurate and actionable. CombatOrchestration-SME identified 3 issues, SpellSystem-SME identified 2. CombatRules-SME approved immediately.
- However, the resolver cover bonus code (added per plan) is currently **dead code** — no callers pass DEX saves through `SavingThrowResolver.resolve()`. Both conditions implemented this for future-proofing, but the multi-agent SMEs explicitly validated this design choice.

### Test Coverage
- Multi-agent produced 12 more unit tests (521 vs 509), specifically a dedicated `saving-throw-resolver.test.ts` with 8 tests for the cover bonus path.
- Both conditions achieved identical E2E coverage (142 scenarios passing).

### Efficiency Analysis
- Raw tool call count **is a misleading efficiency proxy**. Internal tool calls (read_file, grep_search, etc.) and subagent invocations all happen within the same premium request — they have zero marginal billing cost.
- The multi-agent's 3.4x higher tool call count reflects broader research across domain-scoped SMEs (each reading different files in their expertise area), plan/feedback file I/O, and multiple review rounds — but this overhead is invisible to the user's billing.
- The **meaningful efficiency metric is premium requests to reach a correct implementation**. By that measure, multi-agent is ~3x more efficient because it catches bugs during review rather than after deployment.
- Caveat: The 2 bugs caught may or may not have been noticed immediately. If the single-agent's bugs only surfaced weeks later, the debugging cost per premium request could be even higher (lost context, more files to re-read). If they were caught on the next test run, it might be a single quick fix request.

### When Tool Call Count Does Matter
- Tool calls correlate with **wall-clock time** — more calls = longer wait for the user. Single-agent completed faster.
- Tool calls correlate with **context window pressure** — more reads = more tokens in context = higher risk of context overflow on complex tasks.
- For tasks where the agent hits rate limits or context windows, fewer tool calls is genuinely better. But for billing purposes, it's irrelevant.

## Conclusion

### What multi-agent delivered that single-agent didn't
- 2 latent bugs caught before code was written (castSpell slot consumption + null guard crash)
- 12 additional unit tests (521 vs 509) with dedicated resolver test file
- 7 research/review documents preserving architectural context and review decisions
- Formal plan with SME validation across 3 domain areas

### What single-agent did more efficiently
- 3.4x fewer internal tool calls (68 vs 231)
- Likely faster wall-clock time (fewer total operations)
- No plan rework overhead (went straight to implementation)
- Produced correct implementation without formal review phase

### The structural insight
This was a **low-complexity task** (4 code changes, well-scoped). Both completed in 1 premium request. The key difference is **latent defect detection**: single-agent's code passes all existing tests but contains 2 bugs that would surface in edge cases (no-map encounters, total cover spell targeting). Multi-agent's SME review caught these before implementation.

The open question: are these bugs worth the 3.4x tool call overhead to prevent? For a low-complexity task where the bugs may never surface in practice — perhaps not. For a production system where server crashes (null guard) and action economy leaks (castSpell) matter — absolutely. The value of defect prevention scales with the cost of the defect, not the cost of the review.

### Per-dimension summary
| Dimension | Single-Agent | Multi-Agent | Notes |
|-----------|-------------|-------------|-------|
| Premium requests | 1 | 1 | Identical for this low-complexity task |
| Internal tool calls | **68** | 231 | Multi's 3 domain-scoped SMEs each read their own files — broader coverage, not redundancy (zero marginal cost) |
| Deliverables produced | 4 files | **6 files** | Multi created +12 unit tests, +7 research docs |
| Defects prevented | 0 | **2** | SME review caught castSpell early return + null guard issues |
| Test coverage | 509 | **521** | Multi created dedicated saving-throw-resolver test suite |
| Latent bugs in output | **2 unfixed** | **0** | Single-agent's bugs pass E2E but are real edge-case failures |
