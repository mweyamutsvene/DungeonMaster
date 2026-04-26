---
type: sme-research
flow: ClassAbilities
feature: classabilities-row-sorcerer-staleness
author: DMDeveloper
status: DRAFT
round: 1
created: 2026-04-26
updated: 2026-04-26
---

## Scope

Audit only the Sorcerer row in section `2.2 ClassAbilities` of `plans/mechanics-and-coverage-report.md` against current code, checked-in tests, and Sorcerer deterministic scenarios. Consulted `ClassAbilities-SME` and `SpellSystem-SME` because the row crosses class and spell delivery flows.

## Row Verdict

INCORRECT

## Evidence

- `plans/mechanics-and-coverage-report.md` — current row says `Innate Sorcery SUP`, `Metamagic SUP (Quickened/Twinned baseline)`, and `Sorcerous Restoration SUP`.
- `packages/game-server/src/domain/entities/classes/sorcerer.ts` — Sorcerer declares `Innate Sorcery`, `sorcery-points`, `metamagic`, `sorcerous-restoration`, one subclass (`draconic-sorcery-red`), and short-rest SP refresh at level 5+.
- `packages/game-server/src/application/services/combat/abilities/executors/sorcerer/innate-sorcery-executor.ts` — Innate Sorcery is wired, but current effect is broader than RAW (`attack_rolls` rather than Sorcerer-spell-only) and no 2/long-rest use pool is enforced.
- `packages/game-server/src/application/services/combat/abilities/executors/sorcerer/flexible-casting-executor.test.ts` — direct unit coverage for Font of Magic conversion paths.
- `packages/game-server/scripts/test-harness/scenarios/sorcerer/slot-sp-conversion.json` — deterministic scenario proves Font of Magic/Flexible Casting end to end; rerun passed on 2026-04-26.
- `packages/game-server/src/application/services/combat/tabletop/action-dispatcher.ts` — Quickened Spell has a dedicated `metamagicCast` path that chains directly into spell casting.
- `packages/game-server/src/application/services/combat/abilities/executors/sorcerer/twinned-spell-executor.ts` — Twinned Spell only spends SP and sets `twinnedSpellActive`.
- `packages/game-server/scripts/test-harness/scenarios/sorcerer/metamagic-burst.json` — scenario explicitly documents that full Twinned cast chaining is not wired; rerun passed on 2026-04-26 because it only asserts activation/SP spend.
- `packages/game-server/src/domain/entities/classes/class-feature-enrichment.ts` — Draconic Resilience runtime sheet enrichment exists for the only current Sorcerer subclass definition.
- `packages/game-server/scripts/test-harness/scenarios/sorcerer/draconic-resilience.json` — deterministic scenario proves Draconic Resilience/Elemental Affinity behavior for `draconic-sorcery-red`; rerun passed on 2026-04-26.
- `packages/game-server/src/domain/rules/ability-score-improvement.ts` — L4 ASI is standard cross-flow behavior, so the row's ASI cell is fine.
- `packages/game-server/src/domain/rules/rest.ts` — Sorcerous Restoration currently rides generic rest refresh policy; no Sorcerer-specific test or scenario was found proving the L5 short-rest claim at report `SUP` strength.

## Proposed row edits

Replace:

```md
| **Sorcerer** | Spellcasting, Innate Sorcery SUP, L1 subclass defs PARTIAL | Font of Magic SUP | Metamagic SUP (Quickened/Twinned baseline) | ASI | Sorcerous Restoration SUP |
```

With:

```md
| **Sorcerer** | Spellcasting, Innate Sorcery PARTIAL, L1 subclass defs PARTIAL | Font of Magic SUP | Metamagic PARTIAL (Quickened chained cast SUP; Twinned activation/SP spend only) | ASI | Sorcerous Restoration PARTIAL |
```

## Risks

- `Sorcerous Restoration PARTIAL` is conservative: the short-rest SP refresh is implemented indirectly through `restRefreshPolicy`, but it is not directly covered by a Sorcerer-specific test or scenario.
- `Innate Sorcery PARTIAL` could be promoted later if use-count enforcement and Sorcerer-spell-only attack scoping are added and covered.

## Open Questions

- Should the report treat generic rest-policy wiring with no feature-specific coverage as `SUP`, or reserve `SUP` for explicitly verified feature behavior?
- Should `L1 subclass defs PARTIAL` stay as-is, or be tightened to reflect that Sorcerer currently has one concrete subclass path (`draconic-sorcery-red`) rather than broad L1 subclass coverage?