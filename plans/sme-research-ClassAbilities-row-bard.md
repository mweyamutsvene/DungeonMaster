---
type: sme-research
flow: ClassAbilities
feature: classabilities-row-bard-staleness
author: DMDeveloper
status: DRAFT
round: 1
created: 2026-04-26
updated: 2026-04-26
---

## Scope
Audit ONLY the Bard row in section 2.2 ClassAbilities of plans/mechanics-and-coverage-report.md for staleness/incorrect claims, verified against current code/tests/scenarios.

## Row Verdict (NO_ACTION_NEEDED | STALE | INCORRECT)
INCORRECT

## Evidence (file paths and brief why)
- plans/mechanics-and-coverage-report.md
  - Bard L3 cell says: Bard College MISSING (Cutting Words require ally-scan - deferred).
- packages/game-server/src/domain/entities/classes/bard.ts
  - College of Lore subclass exists and gates Cutting Words at L3.
  - Bard profile includes a live cutting_words attack reaction detector.
- packages/game-server/src/domain/entities/classes/combat-resource-builder.ts
  - hasCuttingWords runtime flag is built for bard subclass=college-of-lore at L3+.
- packages/game-server/src/application/services/combat/two-phase/attack-reaction-handler.ts
  - detectAttackReactions is called during attack initiation.
  - cutting_words is applied in completion: subtracts BI die from attack roll, spends bardicInspiration, consumes reaction.
- packages/game-server/src/domain/entities/combat/pending-action.ts
  - cutting_words is a supported ReactionType.
- packages/game-server/src/infrastructure/api/routes/reactions.ts
  - reactions route recognizes/labels Cutting Words resolution.
- packages/game-server/src/application/services/combat/tabletop/dispatch/class-ability-handlers.ts
  - Bardic Inspiration grant places effect on ally for roll-interrupt use.
- packages/game-server/src/application/services/combat/tabletop/rolls/roll-interrupt-resolver.ts
  - Attack/save interrupts include Bardic Inspiration; ability-check interrupts do not include BI.
- packages/game-server/src/domain/rules/rest.test.ts
  - Font of Inspiration short-rest refresh at level 5+ is directly tested.
- packages/game-server/src/domain/entities/classes/bard.test.ts
  - BI die scaling (d8 at L5), JoAT capability presence, subclass feature gating are tested.
- packages/game-server/scripts/test-harness/scenarios/class-combat/bard/bardic-inspiration-roll-interrupt.json
  - E2E scenario validates BI attack roll-interrupt consumption.
- packages/game-server/scripts/test-harness/scenarios/bard/cutting-words-control.json
  - Scenario description still says EXPECTED FAILURE/not implemented, which is stale relative to current wiring.

## Proposed row edits (exact markdown replacements if needed)
Replace this row in plans/mechanics-and-coverage-report.md:

| **Bard** | Spellcasting, Bardic Inspiration grant/refresh (SUP; attack + save consumption wired via roll-interrupt hook) | Expertise, Jack of All Trades SUP | Bard College MISSING (Cutting Words require ally-scan - deferred) | ASI | Font of Inspiration + BI d8 SUP |

With:

| **Bard** | Spellcasting, Bardic Inspiration grant/refresh (SUP; attack + save consumption wired via roll-interrupt hook) | Expertise, Jack of All Trades SUP | Bard College PARTIAL (College of Lore/Cutting Words implemented for attack-reaction flow; ability-check/damage-roll variants and broader ally-scan parity still deferred) | ASI | Font of Inspiration + BI d8 SUP |

## Risks
- If the row is updated to PARTIAL without a companion scenario metadata cleanup, stale "EXPECTED FAILURE" text in bard/cutting-words-control may continue to mislead future audits.
- Cutting Words currently executes in attack reaction flow; full RAW trigger breadth (ability check + damage roll) is still incomplete and may be over-assumed by readers.

## Open Questions
- Should the stale scenario description in packages/game-server/scripts/test-harness/scenarios/bard/cutting-words-control.json be updated now to match current implementation status?
- Do we want the Bard L3 row note to explicitly call out that Cutting Words is not yet wired through roll-interrupt/ally-scan paths for non-attack trigger variants?
