# Comparison: cover-13.1 (DEX Saving Throw Cover Bonus)

## Summary
Both conditions successfully implemented the full task spec with zero compilation errors and all tests passing. The multi-agent approach used 3.4x more internal tool calls but caught 2 bugs during pre-implementation review that the single-agent missed — making it more efficient when measured by **premium requests** (the actual billing unit).

## Primary Metrics Table

| Metric | Single-Agent | Multi-Agent | Delta | Winner |
|--------|-------------|-------------|-------|--------|
| **Premium requests (actual)** | **1** | **1** | 0 | **Tie** |
| **Premium requests (projected, incl. bug fixes)** | **~3** | **1** | -2 | **Multi-Agent** |
| Total internal tool calls | 68 | 231 | +163 (+240%) | Single-Agent |
| Files read (unique) | 12 | 28 | +16 (+133%) | Single-Agent |
| Files modified | 4 | 6 | +2 | Tie* |
| Rework cycles | 1 | 3 | +2 | Single-Agent |
| Tests passed (unit) | 509 | 521 | +12 | Multi-Agent |
| Tests passed (E2E) | 142 | 142 | 0 | Tie |
| Compilation errors | 0 | 0 | 0 | Tie |
| Off-scope mods | 0 | 0 | 0 | Tie |
| Conversation turns | 2 | 2 | 0 | Tie |
| Subagent invocations (internal) | 0 | 14 | +14 | N/A (no billing impact) |
| Plan adherence | full | full | - | Tie |
| Missing requirements | 0 | 0 | 0 | Tie |

\* Multi-agent created 2 additional files (saving-throw-resolver.test.ts + cover-dex-save-bonus.json) while single-agent also created a test file and scenario. The +2 reflects multi-agent creating a dedicated resolver test file.

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

### Coordination Overhead
- **Multi-agent** dispatched 14 subagent invocations across 5 phases: 3 SME research, 4 SME review (R1), 2 SME review (R2), 3 implementers, 2 test writers. Each subagent independently re-read many of the same files, accounting for the 3.8x read_file ratio.
- **Single-agent** had zero coordination overhead — one agent read each file once and implemented sequentially.

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
- The multi-agent's 3.4x higher tool call count reflects coordination overhead (redundant file reads across subagents, plan/feedback file I/O, multiple review rounds), but this overhead is invisible to the user's billing.
- The **meaningful efficiency metric is premium requests to reach a correct implementation**. By that measure, multi-agent is ~3x more efficient because it catches bugs during review rather than after deployment.
- Caveat: The 2 bugs caught may or may not have been noticed immediately. If the single-agent's bugs only surfaced weeks later, the debugging cost per premium request could be even higher (lost context, more files to re-read). If they were caught on the next test run, it might be a single quick fix request.

### When Tool Call Count Does Matter
- Tool calls correlate with **wall-clock time** — more calls = longer wait for the user. Single-agent completed faster.
- Tool calls correlate with **context window pressure** — more reads = more tokens in context = higher risk of context overflow on complex tasks.
- For tasks where the agent hits rate limits or context windows, fewer tool calls is genuinely better. But for billing purposes, it's irrelevant.

### Conclusion
The winner depends entirely on **which efficiency metric you prioritize**:

| Metric | Winner | Margin |
|--------|--------|--------|
| Premium requests (billing cost) | **Multi-Agent** | ~3x fewer requests to bug-free |
| Wall-clock time | **Single-Agent** | Fewer tool calls = faster completion |
| Internal tool calls | **Single-Agent** | 3.4x fewer |
| Code quality (bugs caught pre-implementation) | **Multi-Agent** | 2 bugs caught vs 0 |
| Test coverage | **Multi-Agent** | +12 unit tests |

For a **cost-conscious user** on a limited premium request quota, multi-agent is the better choice — it front-loads review work into a single request rather than spreading bug fixes across multiple future requests. For a **time-conscious user** who wants the fastest possible implementation, single-agent wins. The multi-agent approach's value proposition scales with task complexity and bug severity: easier bugs cost less to fix later, harder bugs cost more.
