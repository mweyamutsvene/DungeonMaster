---
type: sme-research
flow: ClassAbilities
feature: classabilities-row-cleric-staleness
author: DMDeveloper
status: DRAFT
round: 1
created: 2026-04-26
updated: 2026-04-26
---

## Scope
Audit ONLY the Cleric row in section 2.2 ClassAbilities of [plans/mechanics-and-coverage-report.md](plans/mechanics-and-coverage-report.md#L174) for staleness/incorrect claims, using SME review plus current code/tests/scenarios.

## Row Verdict (NO_ACTION_NEEDED | STALE | INCORRECT)
INCORRECT

## Evidence (file paths and brief why)
- [plans/mechanics-and-coverage-report.md](plans/mechanics-and-coverage-report.md#L174): Current row claims `Channel Divinity (Turn Undead + Divine Spark) SUP` and `Divine Domain MISSING`.
- [packages/game-server/src/domain/entities/classes/cleric.ts](packages/game-server/src/domain/entities/classes/cleric.ts): Cleric features include spellcasting/channel-divinity/turn-undead/divine-spark/destroy-undead; includes Life Domain subclass shell (`life-domain`) with subclass feature gates, so `Divine Domain MISSING` is stale.
- [packages/game-server/src/application/services/combat/abilities/executors/cleric/turn-undead-executor.ts](packages/game-server/src/application/services/combat/abilities/executors/cleric/turn-undead-executor.ts): Turn Undead is implemented and returns AoE save payload.
- [packages/game-server/src/application/services/combat/tabletop/dispatch/class-ability-handlers.ts](packages/game-server/src/application/services/combat/tabletop/dispatch/class-ability-handlers.ts): Dispatcher has explicit AoE post-processing for Turn Undead and applies Destroy Undead threshold logic; no comparable post-processing path for Divine Spark outcomes.
- [packages/game-server/src/application/services/combat/abilities/executors/cleric/divine-spark-executor.ts](packages/game-server/src/application/services/combat/abilities/executors/cleric/divine-spark-executor.ts): Executor comment states caller must apply damage/heal/save resolution; this confirms Divine Spark is not fully end-to-end in this flow as currently wired.
- [packages/game-server/src/infrastructure/api/app.ts](packages/game-server/src/infrastructure/api/app.ts#L296): TurnUndeadExecutor and DivineSparkExecutor are registered (feature exists), but registration alone does not prove full dispatch resolution.
- [packages/game-server/src/domain/entities/classes/cleric.test.ts](packages/game-server/src/domain/entities/classes/cleric.test.ts): Unit tests pass for channel divinity + destroy undead thresholds.
- [packages/game-server/src/domain/entities/classes/subclass-framework.test.ts](packages/game-server/src/domain/entities/classes/subclass-framework.test.ts): Unit tests pass for Life Domain subclass resolution and feature gates.
- [packages/game-server/scripts/test-harness/scenarios/cleric/turn-undead.json](packages/game-server/scripts/test-harness/scenarios/cleric/turn-undead.json): Scenario explicitly validates Turn Undead + Destroy Undead behavior.
- [packages/game-server/scripts/test-harness/scenarios/class-combat/cleric/turn-undead-horde.json](packages/game-server/scripts/test-harness/scenarios/class-combat/cleric/turn-undead-horde.json): Additional Turn Undead/Destroy Undead scenario coverage.

Runtime verification performed:
- `pnpm -C packages/game-server exec vitest run src/domain/entities/classes/cleric.test.ts src/domain/entities/classes/subclass-framework.test.ts --reporter=verbose --no-color` (passed)
- `pnpm -C packages/game-server test:e2e:combat:mock -- --scenario=cleric/turn-undead --no-color` (passed)
- `pnpm -C packages/game-server test:e2e:combat:mock -- --scenario=class-combat/cleric/divine-support-multiround --no-color` (passed)

## Proposed row edits (exact markdown replacements if needed)
Replace this row:

| **Cleric** | Spellcasting, Divine Order MISSING | Channel Divinity (Turn Undead + Divine Spark) SUP | Divine Domain MISSING | ASI | Sear/Destroy Undead SUP |

With this row:

| **Cleric** | Spellcasting SUP, Divine Order MISSING | Channel Divinity (Turn Undead SUP, Divine Spark PARTIAL) | Divine Domain PARTIAL | ASI | Destroy Undead SUP |

## Risks
- If Divine Spark dispatch integration is completed later (or already handled in another path not reached by current class-action flow), this row may become stale again quickly.
- `Destroy Undead SUP` is verified; explicit `Sear Undead` naming/semantics should be kept aligned with current implementation language to avoid over-claiming.

## Open Questions
- Should Divine Spark be resolved in [packages/game-server/src/application/services/combat/tabletop/dispatch/class-ability-handlers.ts](packages/game-server/src/application/services/combat/tabletop/dispatch/class-ability-handlers.ts) with the same completeness level as Turn Undead (targeting + save/heal application), then upgraded back to SUP?
- For this report table, should subclass shells with partial mechanics always be labeled `PARTIAL` rather than `MISSING` for consistency across classes?