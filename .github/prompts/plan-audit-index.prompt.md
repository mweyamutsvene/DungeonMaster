# D&D 5e 2024 Combat System Audit — Master Plan Index

## Summary
Comprehensive audit completed across all 5 flows. 10 phased implementation plans created, ordered by priority (critical rule fixes first, polish last).

## Phase Priority Order — ALL COMPLETE ✓

| Phase | Plan File | Severity | Status |
|-------|-----------|----------|--------|
| **1** | archive/plan-phase1-critical-combat-rules.prompt.md | **CRITICAL** | ✅ ARCHIVED |
| **2** | archive/plan-phase2-critical-spell-fixes.prompt.md | **CRITICAL** | ✅ ARCHIVED |
| **3** | archive/plan-phase3-condition-system-overhaul.prompt.md | **IMPORTANT** | ✅ ARCHIVED |
| **4** | archive/plan-phase4-class-feature-gaps.prompt.md | **IMPORTANT** | ✅ ARCHIVED |
| **5** | archive/plan-phase5-entity-foundation.prompt.md | **IMPORTANT** | ✅ ARCHIVED |
| **6** | archive/plan-phase6-movement-ready-action.prompt.md | **IMPORTANT** | ✅ ARCHIVED |
| **7** | archive/plan-phase7-ai-fallback-boss-monsters.prompt.md | **CRITICAL** | ✅ ARCHIVED |
| **8** | archive/plan-phase8-combat-end-conditions.prompt.md | **IMPORTANT** | ✅ ARCHIVED |
| **9** | archive/plan-phase9-subclass-framework.prompt.md | **IMPORTANT** | ✅ ARCHIVED |
| **10** | archive/plan-phase10-ai-tactical-intelligence.prompt.md | **NICE-TO-HAVE** | ✅ ARCHIVED |

## Audit Research Files
- ~~sme-research-CombatRules-audit.md~~ (deleted) — 4 critical, 11 important, 8 nice-to-have
- ~~sme-research-ClassAbilities-audit.md~~ (deleted) — 4 critical, many important per class
- ~~sme-research-SpellSystem-audit.md~~ (deleted) — 7 critical, 8 important
- ~~sme-research-CombatOrchestration-audit.md~~ (deleted) — 0 critical, 7 important
- ~~sme-research-EntityManagement-audit.md~~ (deleted) — 6 critical, 17 important
- ~~sme-research-AIBehavior-audit.md~~ (deleted) — 2 critical, 13 important

## Gap Counts by Severity
| Severity | Total Gaps Found |
|----------|-----------------|
| Critical | ~23 |
| Important | ~57 |
| Nice-to-have | ~25 |

## Implementation Notes
- Phases 1-2 should be done FIRST — they fix wrong combat results in every single encounter
- Phase 7 (AI fallback) is critical for LLM-free operation but doesn't affect rule correctness
- Phases 3-6 improve rule accuracy for specific situations
- Phases 8-10 add completeness and polish
- Each phase is independently implementable — no strict dependency between phases (except Phase 4 Evasion depends on Phase 2 AoE for full testing)
