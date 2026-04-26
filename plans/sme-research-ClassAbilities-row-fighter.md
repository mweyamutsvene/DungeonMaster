---
type: sme-research
flow: ClassAbilities
feature: classabilities-row-fighter-staleness
author: DMDeveloper
status: DRAFT
round: 1
created: 2026-04-26
updated: 2026-04-26
---

## Scope
Audit only the Fighter row in section 2.2 ClassAbilities of plans/mechanics-and-coverage-report.md for staleness/incorrect claims.

## Row Verdict (NO_ACTION_NEEDED | STALE | INCORRECT)
INCORRECT

## Evidence (file paths and brief why)
- plans/mechanics-and-coverage-report.md
  - Current Fighter row states: L3 "Martial Archetype MISSING" and leaves L1 Fighting Style / L5 Extra Attack unlabeled.
- packages/game-server/src/domain/entities/classes/fighter.ts
  - Champion subclass is defined with implemented combat-relevant feature keys (improved-critical, superior-critical).
  - Fighter capabilities include Extra Attack at L5/L11/L20.
  - Fighting Style reactions (Protection/Interception) are declared in class combat text profile and wired for ally-scan reactions.
- packages/game-server/src/domain/entities/classes/registry.ts
  - getCriticalHitThreshold returns 19/18 when Improved/Superior Critical class features are present.
- packages/game-server/src/application/services/combat/tabletop/roll-state-machine.ts
  - Attack roll resolution uses getCriticalHitThreshold for Champion critical range behavior.
- packages/game-server/src/application/services/combat/tabletop/roll-state-machine.improved-crit.test.ts
  - Unit tests verify Champion L3 critical on 19 and non-Champion behavior.
- packages/game-server/src/application/services/combat/two-phase/attack-reaction-handler.ts
  - Protection/Interception ally-scan reactions are detected and applied in reaction resolution pipeline.
- packages/game-server/src/application/services/combat/abilities/executors/fighter/second-wind-executor.ts
  - Tactical Shift is implemented as a speed bonus side effect on Second Wind, with explicit note that OA-free movement is approximated (supports PARTIAL label).
- packages/game-server/scripts/test-harness/scenarios/class-combat/fighter/martial-extra-attack-l5.json
  - Scenario explicitly validates L5 Extra Attack + Action Surge + Second Wind resource flow.

## Proposed row edits (exact markdown replacements if needed)
Replace this line:
| **Fighter** | Fighting Style, Second Wind SUP, Weapon Mastery 3 (cross-flow) | Action Surge SUP, Tactical Mind SUP | Martial Archetype MISSING | ASI | Extra Attack, Tactical Shift PARTIAL |

With this line:
| **Fighter** | Fighting Style SUP, Second Wind SUP, Weapon Mastery 3 (cross-flow) | Action Surge SUP, Tactical Mind SUP | Champion PARTIAL (Improved/Superior Critical SUP; other subclass features not fully mechanized) | ASI | Extra Attack SUP, Tactical Shift PARTIAL |

## Risks
- If report policy requires strict per-feature granularity, "Champion PARTIAL" may need a fuller breakdown (e.g., Remarkable Athlete/Heroic Warrior/Survivor status called out explicitly).
- Fighting Style reactions include an OA-path TODO comment in fighter.ts; if OA parity is required for SUP, label may need to be PARTIAL instead.

## Open Questions
- Should report rows prefer compact subclass labels (e.g., "Champion PARTIAL") or explicit feature-level status at L3?
- Should Fighting Style be scored by currently wired choices only (Protection/Interception + feat-modifier styles) or by full 2024 Fighting Style catalog completeness?
