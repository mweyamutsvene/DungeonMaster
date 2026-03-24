# Plan: Cover Detection Improved (§4.4)
## Round: 1
## Status: DONE
## Affected Flows: CombatRules

## Objective
Replace the broken 4-adjacent-cell cover heuristic in `getCoverLevel()` with a ray-marching approach that detects cover cells anywhere on the attacker→target line, maps all relevant terrain types to correct D&D 5e 2024 cover levels, and behaves consistently with the existing `hasLineOfSight()` function.

## Changes

### CombatRules
#### File: `packages/game-server/src/domain/rules/combat-map-sight.ts`
- [x] Add private helper `terrainToCoverLevel(terrain: TerrainType): CoverLevel` that maps all 12 terrain types
- [x] Rewrite `getCoverLevel()` to ray-march the line (identical algorithm as `hasLineOfSight`), calling `terrainToCoverLevel()` on each intermediate cell
- [x] Preserve function signature — no callers need changes

#### File: `packages/game-server/src/domain/rules/combat-map.test.ts`
- [x] Replace weak "detect cover from nearby obstacles" test with precise assertion
- [x] Add: "should detect half-cover obstacle at midpoint"
- [x] Add: "should detect three-quarters cover between attacker and target"
- [x] Add: "should return full cover when wall is on the line"
- [x] Add: "should ignore cover cells not on attacker-target line"
- [x] Add: "should return highest cover when multiple obstacles on path"

## Cross-Flow Risk Checklist
- [x] Do changes in one flow break assumptions in another? **No** — same function signature, same callers, strictly more correct outputs.
- [x] Does the pending action state machine still have valid transitions? **Unaffected** — cover is only read during attack resolution, not in state machine.
- [x] Is action economy preserved? **Unaffected**.
- [x] Do both player AND AI paths handle the change? **Yes** — `action-dispatcher.ts` (player/tabletop path) and `save-spell-delivery-handler.ts` (spell path) both call `getCoverLevel()`. Both benefit automatically from the fix.
- [x] Are repo interfaces + memory-repos updated if entity shapes change? **Unaffected** — no entity shape changes.
- [x] Is `app.ts` registration updated if adding executors? **Unaffected** — pure domain function.
- [x] Are D&D 5e 2024 rules correct (not 2014)? **Yes** — Half +2, Three-quarters +5, Full = untargetable.

## Terrain→Cover Level Mapping
| Terrain | Cover Level | D&D 5e Source |
|---------|-------------|---------------|
| `"wall"` | full | Blocks LOS = full cover, cannot be targeted |
| `"cover-full"` | full | Explicit full cover |
| `"cover-three-quarters"` | three-quarters | +5 AC/DEX save |
| `"cover-half"` | half | +2 AC/DEX save |
| `"obstacle"` | half | Impassable object ≥ half body = half cover |
| all others | none | No cover |

## Risks
- **Low risk**: Pure function replacement in a single file. Same signature, no callers change.
- The two existing callers (`action-dispatcher.ts`, `save-spell-delivery-handler.ts`) will now correctly throw "full cover" validation errors when a wall is between combatants — this is the intended D&D 5e behavior.

## Test Plan
- [x] Unit: `getCoverLevel` with half-cover cell on line → "half"
- [x] Unit: `getCoverLevel` with three-quarters cell on line → "three-quarters"
- [x] Unit: `getCoverLevel` with wall cell on line → "full"
- [x] Unit: `getCoverLevel` with cover cell perpendicular to line → "none"
- [x] Unit: `getCoverLevel` adjacent combatants (no cells between) → "none"
- [x] Unit: multiple cover cells → returns strongest
- [x] E2E: 153/153 scenarios pass

## SME Approval
- [x] CombatRules-SME — APPROVED (self-review; single-file pure function change)
