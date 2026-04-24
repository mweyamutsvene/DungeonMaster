---
type: sme-research
flow: CombatMap
feature: mechanics-audit-l1-5
author: claude-sme-combat-map
status: DRAFT
created: 2026-04-24
updated: 2026-04-24
---

## Scope

Files audited:
- `packages/game-server/src/domain/rules/combat-map.ts` (barrel, 35+ exports)
- `packages/game-server/src/domain/rules/combat-map-types.ts`
- `packages/game-server/src/domain/rules/combat-map-core.ts`
- `packages/game-server/src/domain/rules/combat-map-zones.ts`
- `packages/game-server/src/domain/rules/combat-map-sight.ts`
- `packages/game-server/src/domain/rules/combat-map-items.ts`
- `packages/game-server/src/domain/rules/pathfinding.ts` (404 lines)
- `packages/game-server/src/domain/rules/area-of-effect.ts` (395 lines)
- `packages/game-server/src/domain/rules/battlefield-renderer.ts`
- `packages/game-server/src/application/services/combat/helpers/pit-terrain-resolver.ts`

## Currently Supported

**Grid & Movement**
- 5ft squares, 2D grid. Chebyshev distance (diagonals cost 5ft — 2024 standard).
- Movement cost: base 5, +5 difficult terrain, +10 to stand from prone, +5 per zone with `difficultTerrain: true`.
- Out-of-bounds, wall check, 8-way neighbor generation.

**A\* Pathfinding**
- Priority queue (binary heap). Supports `ignoredOccupants`, `occupantPositions`. Chebyshev heuristic.
- Zone-aware weighting: adds `dangerousZoneWeight` for damage zones, `zonePenalty` per non-ignored zone, respects `avoidZoneIds`. `findPathAvoidingZones` wrapper. Line path via Bresenham.

**Terrain Types**: enumerated (normal, difficult, hazardous, water, lava, ice, forest, mountain, swamp, desert, underground) — but only `difficultTerrain` boolean is used; enum is vestigial.

**Cover**
- `CoverType`: none, half (+2 AC/DEX), three_quarters (+5), full (untargetable).
- `calculateCover`: walls→full, **creatures→three_quarters (WRONG — RAW: creatures give half cover)**, features (trees, pillars)→half.
- `hasLineOfSight`: Bresenham through tiles, blocks on walls.

**Zones**: shape (circle/square/line/cone), damage, duration, `difficultTerrain`, `concentration` source, `blocksLineOfSight`, `blocksMovement`. CRUD + `getZoneDamageForPosition`, `checkZoneTriggers` on movement, `decrementZoneDurations` end-of-turn cleanup.

**AoE Shapes**: sphere, cube, cylinder, line (with thickness), cone (53° half-angle approximation).

**Battlefield Rendering**: ASCII render for debugging/LLM context.
**Items on Ground**: drop / pickup / query at position.
**Flanking**: `isFlanking` detects allies on opposite sides.
**Pits**: `pit-terrain-resolver.ts` detects entry, DEX save, fall damage + prone on fail.

## Needs Rework

1. **Creature-as-cover = three-quarters (BUG)**. RAW (PHB 2024 p.24): a creature in the line provides **half cover**. Inflates AC/DEX saves by +3 across every ranged attack. HIGH priority.
2. **`TerrainType` enum is vestigial**. Wire into `getMovementCost` or delete.
3. **Diagonal variant missing**. Some tables use "every other diagonal costs 10ft" (DMG variant). Note choice.
4. **Crawling cost not modeled**. RAW: crawling costs 1 extra foot per foot (doubles like difficult terrain). Currently only standing-from-prone has extra cost.
5. **Pathfinder ignores creature size**. Large creature (2×2) treated as 1×1. HIGH priority for L3-5 monster variety.
6. **Occupancy rules incomplete**. All occupied tiles blocked except `ignoredOccupants`. RAW: move through ally's space (difficult when occupied), through incapacitated creature, cannot END in occupied. Not modeled.
7. **Zone damage trigger semantics**. One-size-fits-all. RAW: spike growth = damage per 5 feet moved, moonbeam = first entry OR start of turn, cloud of daggers = entry OR start of turn. Need per-zone trigger policy.
8. **AoE cone angle approximation**. 53° hardcode creates off-by-one at corners. MEDIUM priority.
9. **Line AoE thickness**. Verify callers pass correct (lightning bolt 5ft=1 tile, wall of fire 10ft=2 tiles).
10. **No elevation/3D**. `GridPosition` is `{x,y}` only. Flying creatures treated as ground. HIGH priority for L5 aerial combat.
11. **No "blocks movement" zone enforcement in A\***. Flag exists but pathfinder ignores it.
12. **No "blocks line of sight" zone enforcement in LOS**. Fog cloud, darkness, stinking cloud should block LOS. HIGH priority — these are L1-3 spells.

## Missing — Required for L1-5

### P0 (high priority)

1. **Fix creature-as-cover → half, not three-quarters** (1-line bug; every ranged attack affected).
2. **Flying/movement-mode to A\* signature** (fly ignores ground difficult terrain, zones like spike growth/web/grease, pit falls; still affected by cloud of daggers, moonbeam).
3. **Zone LOS blocking enforcement** (fog cloud L1, darkness L2 break without it).
4. **Creature size / multi-tile footprint** (Large monsters common L3-5 — ogre, owlbear, etc.).
5. **Reach-aware adjacency helper** (`isWithinReach(a, b, reach)`). Glaive Fighter at L1.
6. **Diagonal corner-clipping check** (cannot move diagonally through a corner touching a wall).
7. **Invisibility/hidden map state** (no `isHidden`/`isInvisible` fields; wizard L2 Invisibility + many monsters need this).
8. **Line of effect enforcement at AoE origin + spell target** (prevents fireball-through-walls).

### P1 (medium priority)

9. **Per-zone trigger policy enum** (spike-growth-per-5ft vs moonbeam-on-entry distinction).
10. **Delete or wire `TerrainType` enum** (vestigial code = false confidence).
11. **Swimming / climbing speeds**. Water tiles cost 2× unless swim speed; vertical climb 2× unless climb speed.
12. **Reach weapons**. `isAdjacent` is hardcoded 5ft; need reach-aware.
13. **Opportunity attack triggers on map** — expose `getCreaturesThreatening(position, reach)`.
14. **Grease/ice → falls prone on failed save**. Zones can trigger saves; confirm grease wiring. Need general "zone-save" resolver.

### P2 (edge case)

15. **Dead body / corpse tiles** (difficult terrain variant).
16. **Squeezing into smaller spaces** (Large in 5ft square = half speed, disadvantage).
17. **Cylinder vs sphere disambiguation** for zone spells (spike growth 20ft radius — sphere or cylinder?).

## Cross-Flow Dependencies

- **CombatRules**: prone advantage/disadvantage, cover AC/DEX bonus application, flanking advantage.
- **SpellSystem**: spell range validation, line-of-effect enforcement, AoE origin LOS filtering, cylinder vs sphere disambiguation.
- **ActionEconomy**: movement cost deduction, interruption by zone damage.
- **ReactionSystem**: OA triggers on leaving reach — map must expose `getThreateningCreatures(position, reach)`.
- **AIBehavior**: pathfinding with threat avoidance, cover-aware target selection, cone/line AoE positioning.
- **EntityManagement**: creature size → footprint tiles, flying/swim/climb speeds, invisibility/hidden flags.
- **CombatOrchestration**: zone duration decrements at end-of-turn.
- **ClassAbilities**: Cunning Action Dash/Disengage/Hide, Step of the Wind, Reckless Attack interacts with flanking/cover.

## Top Priorities (ordered)

1. Fix creature-as-cover (1-line bug, RAW violation).
2. Add flying/movement-mode to A\*.
3. Enforce `blocksLineOfSight` zones in LOS.
4. Creature size / multi-tile footprint.
5. Reach-aware adjacency helper.
6. Diagonal corner-clipping check.
7. Invisibility/hidden map state.
8. Per-zone trigger policy.
9. Delete or wire `TerrainType` enum.
10. Line of effect enforcement at AoE origin + spell target.
