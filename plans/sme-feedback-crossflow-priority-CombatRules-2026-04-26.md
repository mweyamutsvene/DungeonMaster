# SME Feedback — Cross-Flow Priority Table (CombatRules scope) — 2026-04-26

## Scope
- Target: plans/mechanics-and-coverage-report.md, section 4 Cross-Flow Priority Table
- Requested rows audited:
  - Tier 1: #4, #5
  - Tier 2: #1, #2, #11, #12, #13, #14, #15, #24
- Validation method: code + unit/integration test + scenario evidence review (no live task execution in this pass)

## Row State Audit

| Tier | Row | Current row state in report | Verdict | Why |
|---|---:|---|---|---|
| 1 | 4 | DONE | ACCURATE | 2024 exhaustion model is implemented in domain conditions (10-level lethal threshold, -2/level d20 penalty, speed reduction) and scenario coverage exists. Report note that full lethal wiring is still incomplete is consistent with current scenario commentary. |
| 1 | 5 | DONE | ACCURATE | Fall damage core rule exists (computeFallDamage in combat-map-core), pit entry pipeline is wired and covered by scenario. Generic off-ledge handling is still not represented as a dedicated path, matching the row note. |
| 2 | 1 | MISSING | STALE | Forced movement mechanics exist (domain applyForcedMovement, OA suppression for involuntary movement, shove push + pit/fall integration in grapple handler). This is not fully complete end-to-end, but no longer "MISSING". |
| 2 | 2 | REWORK | STALE | Critical damage dice-vs-flat behavior is implemented in both domain and tabletop paths, and scenario core/critical-hit asserts that flat modifier is not doubled on crit. |
| 2 | 11 | PARTIAL | ACCURATE | Reaction lifecycle reset/consumption is present, but per-trigger/OA lifecycle remains distributed across handlers and pending-action flow; status remains partial. |
| 2 | 12 | MISSING | ACCURATE | Movement constants include flying speed, but A* pathfinding remains 2D terrain/path cost logic without movement-mode aware routing. |
| 2 | 13 | MISSING | ACCURATE | LOS/cover checks are terrain/cell based; zones are managed separately and are not enforcing LOS blocking behavior as a zone rule. |
| 2 | 14 | MISSING | STALE | Adjacency helper functionality exists (findAdjacentPosition with desiredRange and reach-aware callers in some flows), but it is not consistently reach-aware across all move/AI callers. |
| 2 | 15 | MISSING | STALE | Hidden/invisible combat conditions and hide/search flows exist, but map-level hidden/invisibility state modeling is not complete. This is partial, not fully missing. |
| 2 | 24 | MISSING | ACCURATE | AI spell picker selects lowest available slot and lacks explicit upcast-value scoring/optimization logic. |

## Exact Replacement Text (for stale rows)

Replace the following rows in section 4 Tier 2 table.

| # | Item | Flow | Current state |
|---|---|---|---|
| 1 | Forced movement tracking + OA/fall interaction | CombatRules | PARTIAL |
| 2 | Critical damage dice-vs-flat (2024) | CombatRules | SUPPORTED |
| 14 | Reach-aware adjacency helper | CombatMap | PARTIAL |
| 15 | Invisibility/hidden map state | CombatMap | PARTIAL |

## Evidence Pointers
- Exhaustion model + lethal threshold helpers: packages/game-server/src/domain/entities/combat/conditions.ts
- Exhaustion lethal application path (PATCH route): packages/game-server/src/infrastructure/api/routes/sessions/session-combat.ts
- Exhaustion scenario: packages/game-server/scripts/test-harness/scenarios/core/exhaustion-accumulation.json
- Fall damage core function: packages/game-server/src/domain/rules/combat-map-core.ts
- Fall damage scenario: packages/game-server/scripts/test-harness/scenarios/core/fall-damage-sequence.json
- Forced movement domain helper: packages/game-server/src/domain/rules/movement.ts
- OA involuntary movement rule: packages/game-server/src/domain/rules/opportunity-attack.ts
- Shove push + pit/fall integration: packages/game-server/src/application/services/combat/action-handlers/grapple-action-handler.ts
- Critical dice-vs-flat domain behavior: packages/game-server/src/domain/combat/attack-resolver.ts
- Critical dice-vs-flat tabletop behavior: packages/game-server/src/application/services/combat/tabletop/roll-state-machine.ts
- Critical scenario assertion: packages/game-server/scripts/test-harness/scenarios/core/critical-hit.json
- A* pathfinding (no movement mode): packages/game-server/src/domain/rules/pathfinding.ts
- LOS/Cover implementation scope: packages/game-server/src/domain/rules/combat-map-sight.ts
- Adjacency helper: packages/game-server/src/domain/rules/pathfinding.ts
- Hidden/invisible condition/action flow: packages/game-server/src/domain/rules/hide.ts
- AI spell evaluator slot selection behavior: packages/game-server/src/application/services/combat/ai/ai-spell-evaluator.ts
