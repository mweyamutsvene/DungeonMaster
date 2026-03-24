# Plan: Split `combat-map.ts` Monolith (§3.3)
## Round: 1
## Status: DONE
## Affected Flows: CombatRules

## Objective
Split `domain/rules/combat-map.ts` (540 lines, 35+ exports) into 5 focused modules. Original path becomes a barrel re-export to maintain full backward compatibility. No logic changes — pure reorganization.

## Changes

### CombatRules Flow

#### [File: domain/rules/combat-map-types.ts] — NEW
- [ ] Define all types/interfaces: `TerrainType`, `CoverLevel`, `MapCell`, `MapEntity`, `CombatMap`
- [ ] Imports from movement, zones, ground-item

#### [File: domain/rules/combat-map-core.ts] — NEW
- [ ] Core map operations: `createCombatMap`, `getCellAt`, `setTerrainAt`
- [ ] Entity CRUD: `addEntity`, `moveEntity`, `removeEntity`, `getEntity`, `getEntitiesAt`, `getCreatures`, `getItems`
- [ ] Passability + terrain: `isOnMap`, `isPositionPassable`, `getTerrainSpeedModifier`
- [ ] Imports types from `combat-map-types.ts`

#### [File: domain/rules/combat-map-sight.ts] — NEW
- [ ] LOS + cover: `hasLineOfSight`, `getCoverLevel`, `getCoverACBonus`, `getCoverSaveBonus`
- [ ] Range/faction queries: `getEntitiesInRadius`, `getFactionsInRange`
- [ ] Imports types from `combat-map-types.ts`, core helpers from `combat-map-core.ts`

#### [File: domain/rules/combat-map-zones.ts] — NEW
- [ ] Zone management: `getMapZones`, `addZone`, `removeZone`, `updateZone`, `setMapZones`
- [ ] Imports types from `combat-map-types.ts`, `CombatZone` from entities

#### [File: domain/rules/combat-map-items.ts] — NEW
- [ ] Ground item management: `getGroundItems`, `addGroundItem`, `removeGroundItem`, `getGroundItemsAtPosition`, `getGroundItemsNearPosition`
- [ ] Imports types from `combat-map-types.ts`, `GroundItem` from entities

#### [File: domain/rules/combat-map.ts] — CONVERTED TO BARREL
- [ ] Remove all implementations
- [ ] Re-export everything from the 5 new modules
- [ ] Add header comment explaining the barrel structure
- [ ] All existing imports (`import {...} from "./combat-map.js"`) continue to work unchanged

## Cross-Flow Risk Checklist
- [x] Do changes in one flow break assumptions in another? **No — barrel re-export preserves all external contracts**
- [x] Does the pending action state machine still have valid transitions? **N/A — no logic changes**
- [x] Is action economy preserved? **N/A — no logic changes**
- [x] Do both player AND AI paths handle the change? **Yes — all imports untouched via barrel**
- [x] Are repo interfaces + memory-repos updated if entity shapes change? **N/A — no shape changes**
- [x] Is `app.ts` registration updated if adding executors? **N/A — not an executor**
- [x] Are D&D 5e 2024 rules correct? **N/A — no logic changes**

## Risks
- **Import circularity**: `combat-map-sight.ts` imports from `combat-map-core.ts` (getCellAt, getEntity). These are in the same domain layer and same directory — no circular risk.
- **Index.ts barrel**: `domain/rules/index.ts` already re-exports `combat-map.js` — no change needed there.

## Test Plan
- [x] Existing `combat-map.test.ts` imports from `./combat-map.js` — continues working via barrel
- [x] `pathfinding.test.ts` imports from `./combat-map.js` — continues working
- [x] `typecheck` must pass clean
- [x] `test` suite must pass (all combat-map unit tests pass unchanged)
- [x] `test:e2e:combat:mock` must pass all 151 scenarios

## Implementation Steps
- [x] Create `combat-map-types.ts`
- [x] Create `combat-map-core.ts`
- [x] Create `combat-map-sight.ts`
- [x] Create `combat-map-zones.ts`
- [x] Create `combat-map-items.ts`
- [x] Convert `combat-map.ts` to barrel
- [x] Run typecheck — clean (pre-existing SeededDiceRoller error in test-seed.ts unrelated)
- [x] Run unit tests — 616 passed, 0 failed
- [x] Run E2E tests — 153/153 passed, 0 failed
- [x] Update `plan-remaining-tech-debt.prompt.md` §3.3 → DONE
