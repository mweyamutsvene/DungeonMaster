---
description: "Architecture and conventions for the CombatMap flow: grid geometry, A* pathfinding, cover/sight calculations, zone effects, terrain types, area of effect templates, battlefield rendering."
applyTo: "packages/game-server/src/domain/rules/combat-map*.ts,packages/game-server/src/domain/rules/pathfinding.ts,packages/game-server/src/domain/rules/area-of-effect.ts,packages/game-server/src/domain/rules/battlefield-renderer.ts,packages/game-server/src/application/services/combat/helpers/pit-terrain-resolver.ts"
---

# CombatMap Flow

## Purpose
Spatial combat subsystem: grid geometry, A* pathfinding, line-of-sight, cover calculations, zone persistence, terrain effects, area-of-effect templates, and battlefield ASCII rendering. The highest-complexity domain subsystem with 35+ exports spread across the sub-modules.

## File Responsibility Matrix

| File | ~Lines | Responsibility |
|------|--------|----------------|
| `domain/rules/combat-map.ts` | ~25 | Re-export barrel: re-exports from all sub-modules (35+ total exports) |
| `domain/rules/combat-map-types.ts` | ~105 | Shared type definitions: `CombatMap`, `MapCell`, `TerrainType`, `CoverLevel`, `ObscuredLevel` |
| `domain/rules/combat-map-core.ts` | ~275 | Core map ops: cell access, neighbor calculation, grid creation |
| `domain/rules/combat-map-zones.ts` | ~50 | Zone CRUD: creation, persistence, damage application on entry/turn start |
| `domain/rules/combat-map-sight.ts` | ~280 | Line-of-sight, cover calculations (half/three-quarters/full), `getObscuredLevelAt()`, `getObscurationAttackModifiers()` |
| `domain/rules/combat-map-items.ts` | ~55 | Ground item placement and pickup on the map |
| `domain/rules/pathfinding.ts` | ~645 | A* pathfinding + Dijkstra reachability with terrain awareness |
| `domain/rules/area-of-effect.ts` | ~170 | AoE template computation: cone, sphere, line, cube, cylinder |
| `domain/rules/battlefield-renderer.ts` | ~250 | ASCII battlefield visualization for debug + CLI |
| `application/services/combat/helpers/pit-terrain-resolver.ts` | ~100 | Pit fall detection and DEX save resolution |

## Key Types/Interfaces

- `CombatMap` — the full map state (grid + zones + items + terrain), defined in `combat-map-types.ts`
- `MapCell` — individual cell with terrain type, occupant, elevation
- `TerrainType` — union type: normal, difficult, pit, wall, water, etc.
- `CombatZone` — persistent area effect (shape, damage type, damage dice, source); imported from `domain/entities/combat/zones.ts`, referenced via `CombatMap.zones?: CombatZone[]`
- `CoverLevel` — `"none" | "half" | "three-quarters" | "full"`
- `ObscuredLevel` — `"none" | "lightly" | "heavily"` — used for sight line calculations
- `Position` — `{x, y}` in 5ft grid coordinates (from `rules/movement.ts`)
- `AreaOfEffect` — shape definition in `area-of-effect.ts` (cone, sphere, cube, line, cylinder); NOT named `AoETemplate`
- `AreaShape` — `'cone' | 'sphere' | 'cube' | 'line' | 'cylinder'`

## Known Gotchas

- **Grid is 5ft squares** — all positions must be multiples of 5. Distance uses D&D grid math (diagonal = 5ft in standard mode, not Euclidean).
- **combat-map.ts is a ~25-line barrel** — it only re-exports from 5 sub-modules. The bulk of the logic lives in the sub-modules. When looking for an export, check the sub-modules, not the barrel.
- **A* pathfinding** must respect difficult terrain (double cost), occupied cells, walls, and creature size. Don't bypass these constraints. `pathfinding.ts` is large (~645 lines).
- **Zone damage applies BOTH on entry AND at start of turn** — not just one. Missing either is a bug.
- **Pit terrain** triggers DEX saving throws — but only hydrate creature stats when a pit cell is actually entered (guard with `isPitEntry` first to avoid validation errors on non-pit moves).
- **`CombatZone` not `Zone`** — the type for persistent area effects is `CombatZone` (from `domain/entities/combat/zones.ts`), not `Zone`. Similarly, AoE templates are `AreaOfEffect`, not `AoETemplate`.
