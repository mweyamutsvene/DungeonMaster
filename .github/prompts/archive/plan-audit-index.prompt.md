# D&D 5e 2024 Combat System Audit — Master Plan Index

## Summary
Comprehensive audit completed across all 5 flows. 10 phased implementation plans created, ordered by priority (critical rule fixes first, polish last).

## Phase Priority Order

| Phase | Plan File | Severity | Flows | Est. Scope |
|-------|-----------|----------|-------|------------|
| **1** | [plan-phase1-critical-combat-rules.prompt.md](plan-phase1-critical-combat-rules.prompt.md) | **CRITICAL** | CombatRules | 4 bug fixes: nat 1 auto-miss, Restrained fix, Paralyzed/Unconscious auto-crit, temp HP |
| **2** | [plan-phase2-critical-spell-fixes.prompt.md](plan-phase2-critical-spell-fixes.prompt.md) | **CRITICAL** | SpellSystem, CombatOrchestration | 7 spell fixes: cantrip scaling, upcasting, Magic Missile, AoE, bonus action restriction, Counterspell, Pact Magic |
| **3** | [plan-phase3-condition-system-overhaul.prompt.md](plan-phase3-condition-system-overhaul.prompt.md) | **IMPORTANT** | CombatRules, CombatOrchestration | 5 condition fixes: Prone, Poisoned, Frightened, Exhaustion, Invisible |
| **4** | [plan-phase4-class-feature-gaps.prompt.md](plan-phase4-class-feature-gaps.prompt.md) | **IMPORTANT** | ClassAbilities, CombatRules, CombatOrchestration | Uncanny Dodge, Evasion, Fighting Style, Weapon Mastery keys, Paladin spellcasting |
| **5** | [plan-phase5-entity-foundation.prompt.md](plan-phase5-entity-foundation.prompt.md) | **IMPORTANT** | EntityManagement, CombatRules | Species traits, origin feats, Monk AC, weapon proficiency, spell progression |
| **6** | [plan-phase6-movement-ready-action.prompt.md](plan-phase6-movement-ready-action.prompt.md) | **IMPORTANT** | CombatRules, CombatOrchestration | Forced movement, grapple drag, ready action expiry/spell/triggers |
| **7** | [plan-phase7-ai-fallback-boss-monsters.prompt.md](plan-phase7-ai-fallback-boss-monsters.prompt.md) | **CRITICAL** | AIBehavior, CombatOrchestration | Deterministic fallback AI, legendary actions, lair actions |
| **8** | [plan-phase8-combat-end-conditions.prompt.md](plan-phase8-combat-end-conditions.prompt.md) | **IMPORTANT** | CombatOrchestration | Flee/surrender, manual combat end, Help action verification |
| **9** | [plan-phase9-subclass-framework.prompt.md](plan-phase9-subclass-framework.prompt.md) | **IMPORTANT** | ClassAbilities, EntityManagement | Generic subclass framework + Champion, Berserker, Thief, Life Domain, Devotion |
| **10** | [plan-phase10-ai-tactical-intelligence.prompt.md](plan-phase10-ai-tactical-intelligence.prompt.md) | **NICE-TO-HAVE** | AIBehavior | Cover context, range maintenance, AoE optimization, class feature usage, archetypes |

## Audit Research Files
- [sme-research-CombatRules-audit.md](../plans/sme-research-CombatRules-audit.md) — 4 critical, 11 important, 8 nice-to-have
- [sme-research-ClassAbilities-audit.md](../plans/sme-research-ClassAbilities-audit.md) — 4 critical, many important per class
- [sme-research-SpellSystem-audit.md](../plans/sme-research-SpellSystem-audit.md) — 7 critical, 8 important
- [sme-research-CombatOrchestration-audit.md](../plans/sme-research-CombatOrchestration-audit.md) — 0 critical, 7 important
- [sme-research-EntityManagement-audit.md](../plans/sme-research-EntityManagement-audit.md) — 6 critical, 17 important
- [sme-research-AIBehavior-audit.md](../plans/sme-research-AIBehavior-audit.md) — 2 critical, 13 important

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
