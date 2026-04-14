---
description: "Architecture and conventions for the CombatMap flow: grid geometry, A* pathfinding, cover/sight calculations, zone effects, terrain types, area of effect templates, battlefield rendering."
applyTo: "packages/game-server/src/domain/rules/combat-map*.ts,packages/game-server/src/domain/rules/pathfinding.ts,packages/game-server/src/domain/rules/area-of-effect.ts,packages/game-server/src/domain/rules/battlefield-renderer.ts,packages/game-server/src/application/services/combat/helpers/pit-terrain-resolver.ts"
---

# CombatMap Flow

## Purpose
Spatial combat subsystem: grid geometry, A* pathfinding, line-of-sight, cover calculations, zone persistence, terrain effects, area-of-effect templates, and battlefield ASCII rendering. The highest-complexity domain subsystem with 35+ exports from combat-map.ts alone.

## File Responsibility Matrix

| File | ~Lines | Responsibility |
|------|--------|----------------|
| `domain/rules/combat-map.ts` | ~480 | Main barrel: grid manipulation, cover detection, terrain queries (35+ exports) |
| `domain/rules/combat-map-types.ts` | ~120 | Shared type definitions: map cells, terrain enum, zone types |
| `domain/rules/combat-map-core.ts` | ~200 | Core map ops: cell access, neighbor calculation, grid creation |
| `domain/rules/combat-map-zones.ts` | ~180 | Zone CRUD: creation, persistence, damage application on entry/turn start |
| `domain/rules/combat-map-sight.ts` | ~150 | Line-of-sight and cover calculations (half/three-quarters/full) |
| `domain/rules/combat-map-items.ts` | ~80 | Ground item placement and pickup on the map |
| `domain/rules/pathfinding.ts` | ~200 | A* pathfinding + Dijkstra reachability with terrain awareness |
| `domain/rules/area-of-effect.ts` | ~150 | AoE template computation: cone, sphere, line, cube |
| `domain/rules/battlefield-renderer.ts` | ~120 | ASCII battlefield visualization for debug + CLI |
| `application/services/combat/helpers/pit-terrain-resolver.ts` | ~100 | Pit fall detection and DEX save resolution |

## Key Types/Interfaces

- `CombatMap` — the full map state (grid + zones + items + terrain)
- `MapCell` — individual cell with terrain type, occupant, elevation
- `TerrainType` — enum: normal, difficult, pit, wall, water, etc.
- `Zone` — persistent area effect (shape, damage type, damage dice, source)
- `CoverLevel` — none, half (+2 AC), three-quarters (+5 AC), full (untargetable)
- `Position` — `{x, y}` in 5ft grid coordinates
- `AoETemplate` — shape definition (cone, sphere, line, cube) with origin + direction

## Known Gotchas

- **Grid is 5ft squares** — all positions must be multiples of 5. Distance uses D&D grid math (diagonal = 5ft in standard mode, not Euclidean).
- **combat-map.ts is the largest domain barrel** — changes cascade to pathfinding, cover, zones, and movement. Always check downstream imports.
- **A* pathfinding** must respect difficult terrain (double cost), occupied cells, walls, and creature size. Don't bypass these constraints.
- **Zone damage applies BOTH on entry AND at start of turn** — not just one. Missing either is a bug.
- **Pit terrain** triggers DEX saving throws — but only hydrate creature stats when a pit cell is actually entered (guard with `isPitEntry` first to avoid validation errors on non-pit moves).
