---
type: challenge
flow: multi
feature: classabilities-row-staleness-2026-04-26
author: Challenger
status: IN_REVIEW
round: 1
created: 2026-04-26
updated: 2026-04-26
---

# Critical Issues

1. Status taxonomy is inconsistent and ambiguous.
The plan mixes SUP, SUPPORTED, PARTIAL, MISSING, cross-flow, and DEF-style wording, while the table legend in `plans/mechanics-and-coverage-report.md` only defines SUPPORTED, PARTIAL, MISSING, UNVERIFIED. This creates interpretation drift and overclaim risk.

2. Baseline assumptions are stale inside the plan itself.
The plan still lists Druid changes as pending (Wild Shape PARTIAL -> SUPPORTED, Primal Circle MISSING -> PARTIAL, L5 no universal -> Wild Resurgence MISSING), but those states are already present in `plans/mechanics-and-coverage-report.md`. This indicates source snapshot drift and raises execution-churn risk.

3. Contradictions across row audits are not reconciled before execution.
The plan applies selective conclusions but does not resolve competing interpretations for high-risk cells (notably Monk, Bard, Ranger, Warlock), so implementers can produce materially different row text from the same inputs. That defeats the documentation truth pass objective.

4. Several proposed upgrades are under-evidenced for strict SUP claims.
Examples from the research set: Bard caveat scope is attack-reaction constrained; Ranger subclass breadth vs feature-level support is unresolved; Warlock Magical Cunning SUP is called out with thin deterministic evidence; Monk Stunning Strike labeling is disputed. Promoting without normalized evidence standards risks overclaiming.

# Medium Issues

1. Change bullets are not executable enough.
Replace row X with caveat Y is too loose for a sensitive truth pass; no exact before/after row strings are provided per class.

2. Open questions in row audits are not dispositioned.
Multiple research files raise explicit unresolved questions, but the plan has no accept/reject decisions, owners, or defer tags per question.

3. Test gate is too soft for status upgrades.
The plan marks smoke checks optional even when rows move from MISSING to PARTIAL/SUPPORTED. That weakens confidence in claimed runtime truth.

4. Wording drift risk remains high.
Terms like shell, defs, cross-flow, inline, and PARTIAL are used inconsistently across classes and can hide materially different implementation states.

# Suggested Fixes

1. Lock a single status vocabulary before edits.
Use only SUPPORTED, PARTIAL, MISSING, UNVERIFIED in final row cells. Move qualifiers into parenthetical caveats, not alternate labels.

2. Add exact row replacements for all 12 classes.
For each class, include strict before/after markdown row text and mark explicit no-op rows where the table is already current.

3. Resolve disputed cells conservatively before merge.
If evidence is split, default to PARTIAL with a precise caveat. Do not promote to SUPPORTED unless runtime behavior plus coverage are both explicit in the audited evidence.

4. Add a minimal evidence bar for claim upgrades.
For every MISSING -> PARTIAL/SUPPORTED move, require at least one concrete runtime path citation and one test/scenario citation in the plan body.

5. Record disposition for each audit open question.
Add short decisions: ACCEPTED, DEFERRED, or OUT_OF_SCOPE, with rationale, so ambiguity does not propagate into the report text.

# Verdict (BLOCKED | PASS_WITH_FIXES)

BLOCKED

Reason: the current plan is directionally useful but not execution-safe yet. Taxonomy drift, stale baseline assumptions, and unresolved cross-audit contradictions can produce new overclaims during a truth pass.
