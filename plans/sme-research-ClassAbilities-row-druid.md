---
type: sme-research
flow: ClassAbilities
feature: classabilities-row-druid-staleness
author: DMDeveloper
status: DRAFT
round: 1
created: 2026-04-26
updated: 2026-04-26
---

## Scope
Audit ONLY the Druid row in section 2.2 ClassAbilities of plans/mechanics-and-coverage-report.md for stale/incorrect claims, using current code/tests/scenarios.

## Row Verdict (NO_ACTION_NEEDED | STALE | INCORRECT)
INCORRECT

## Evidence (file paths and brief why)
- plans/mechanics-and-coverage-report.md:175
  - Current row claims: L2 Wild Shape is temp-HP/metadata partial, L3 Primal Circle missing, L5 no universal.
- packages/game-server/src/domain/entities/classes/druid.ts
  - Druid features map includes spellcasting (L1) and wild-shape (L2); no Primal Order or Wild Resurgence entries.
  - Subclass shell exists (`CircleOfTheLandGrasslandSubclass`) with L3 feature keys (`CIRCLE_SPELLS`, `LANDS_AID`), so L3 is not fully MISSING.
- packages/game-server/src/application/services/combat/abilities/executors/druid/index.ts
  - Druid executors are only Wild Shape and Revert Wild Shape (no Circle mechanics executors yet), supporting PARTIAL-at-best for subclass support.
- packages/game-server/src/infrastructure/api/wild-shape-stat-swap.integration.test.ts
  - Integration test asserts structured `wildShapeForm` state is persisted and `tempHp` is not used in wild shape path.
- packages/game-server/scripts/test-harness/scenarios/druid/wild-shape-stat-swap.json
  - E2E scenario asserts Wild Shape spend and `characterTempHp` exact 0 after transforming.
- RuleBookDocs/markdown/classes/druid.md
  - Rulebook source lists Level 5 Wild Resurgence as a universal Druid feature, contradicting "no universal".
- packages/game-server/src/domain/rules/ability-score-improvement.ts
  - Standard ASI levels include level 4, confirming L4 ASI claim remains correct.

## Proposed row edits (exact markdown replacements if needed)
Replace this exact row:
| **Druid** | Spellcasting, Primal Order MISSING | Wild Shape PARTIAL (temp HP + metadata; full swap/hydration pending) | Primal Circle MISSING | ASI | no universal |

With:
| **Druid** | Spellcasting, Primal Order MISSING | Wild Shape SUPPORTED (form-state swap/hydration + damage routing; no temp HP overlay) | Primal Circle PARTIAL (Circle of the Land feature map present; mechanics/executors pending) | ASI | Wild Resurgence MISSING |

## Risks
- Row status language may overstate implementation completeness if "SUPPORTED" is interpreted as full RAW parity; current Wild Shape implementation is standardized-form based and may still differ from full rulebook behavior details.

## Open Questions
- Should L2 Wild Shape be tagged SUPPORTED or PARTIAL in this report taxonomy when the old temp-HP claim is wrong, but full RAW parity (known forms/CR progression nuances) may still be evolving?
- Should L5 column encode "feature exists in rules but unimplemented" consistently as `Wild Resurgence MISSING` across all class rows?