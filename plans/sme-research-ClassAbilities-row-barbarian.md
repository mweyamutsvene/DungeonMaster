---
type: sme-research
flow: ClassAbilities
feature: classabilities-row-barbarian-staleness
author: DMDeveloper
status: DRAFT
round: 1
created: 2026-04-26
updated: 2026-04-26
---

## Scope
Audit ONLY the Barbarian row in section `2.2 ClassAbilities` of `plans/mechanics-and-coverage-report.md` for staleness/incorrect claims, verified against current code/tests/scenarios.

## Row Verdict (NO_ACTION_NEEDED | STALE | INCORRECT)
INCORRECT

## Evidence (file paths and brief why)
- `plans/mechanics-and-coverage-report.md`
  - Current row claims: `L3 (subclass): Primal Path mechanical features MISSING`.
- `packages/game-server/src/domain/entities/classes/barbarian.ts`
  - Defines Berserker subclass with `frenzy` at level 3 and exposes Frenzy in `capabilitiesForLevel` with `abilityId: class:barbarian:frenzy`.
- `packages/game-server/src/application/services/combat/abilities/executors/barbarian/frenzy-executor.ts`
  - Concrete executor exists; enforces Berserker subclass + rage + bonus-action and attack-action prerequisites.
- `packages/game-server/src/infrastructure/api/app.ts`
  - `FrenzyExecutor` is registered in the live ability registry.
- `packages/game-server/src/domain/entities/classes/subclass-framework.test.ts`
  - Test asserts Frenzy is available at Barbarian level 3 with Berserker subclass.
- `packages/game-server/scripts/test-harness/scenarios/class-combat/barbarian/frenzy-extra-attack.json`
  - E2E scenario explicitly exercises Frenzy in combat flow.
- `packages/game-server/src/domain/rules/class-startup-effects.test.ts`
  - Confirms L2 Danger Sense and L5 Fast Movement startup effects (supports non-L3 row claims).

## Proposed row edits (exact markdown replacements if needed)
Replace this row:

| **Barbarian** | Rage (SUP), Unarmored Def (cross-flow), Weapon Mastery (cross-flow) | Reckless Attack, Danger Sense (SUP) | Primal Path mechanical features MISSING | ASI (cross-flow) | Extra Attack (cross-flow), Fast Movement SUP |

With:

| **Barbarian** | Rage (SUP), Unarmored Def (cross-flow), Weapon Mastery (cross-flow) | Reckless Attack, Danger Sense (SUP) | Primal Path mechanical features PARTIAL (Berserker Frenzy SUP) | ASI (cross-flow) | Extra Attack (cross-flow), Fast Movement SUP |

## Risks
- “PARTIAL” remains appropriate unless all Primal Path subclasses/features are implemented; this audit only confirms Berserker Frenzy is implemented and tested.

## Open Questions
- Should the table standardize subclass-cell wording to always distinguish “at least one subclass feature implemented” vs “full subclass breadth complete” across all classes?
