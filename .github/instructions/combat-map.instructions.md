---
description: "Architecture and conventions for the CombatMap flow: grid geometry, A* pathfinding, cover/sight calculations, zone effects, terrain types, area of effect templates, battlefield rendering."
applyTo: "packages/game-server/src/domain/rules/combat-map*.ts,packages/game-server/src/domain/rules/pathfinding.ts,packages/game-server/src/domain/rules/area-of-effect.ts,packages/game-server/src/domain/rules/battlefield-renderer.ts,packages/game-server/src/application/services/combat/helpers/pit-terrain-resolver.ts"
---

# CombatMap Flow

## Purpose
Spatial combat subsystem: grid geometry, pathfinding, line-of-sight, cover calculations, zone persistence, terrain effects, area-of-effect templates, and text-grid battlefield rendering. The combat-map barrel is a thin re-export layer over the real sub-modules and currently exposes roughly fifty public symbols.

## File Responsibility Matrix

| File | ~Lines | Responsibility |
|------|--------|----------------|
| `domain/rules/combat-map.ts` | ~25 | Re-export barrel: re-exports from all sub-modules (roughly 50 public exports) |
| `domain/rules/combat-map-types.ts` | ~105 | Shared type definitions: `CombatMap`, `MapCell`, `TerrainType`, `CoverLevel`, `ObscuredLevel` |
| `domain/rules/combat-map-core.ts` | ~275 | Core map ops: cell access, neighbor calculation, grid creation |
| `domain/rules/combat-map-zones.ts` | ~50 | Zone map accessors only: `getMapZones`, `addZone`, `removeZone`, `updateZone`, `setMapZones` |
| `domain/rules/combat-map-sight.ts` | ~280 | Line-of-sight, cover calculations (half/three-quarters/full), `getObscuredLevelAt()`, `getObscurationAttackModifiers()` |
| `domain/rules/combat-map-items.ts` | ~55 | Ground item placement and pickup on the map |
| `domain/rules/pathfinding.ts` | ~645 | A* routes plus Dijkstra reachability helpers such as `getReachableCells()`, `findAdjacentPosition()`, and `findRetreatPosition()` |
| `domain/rules/area-of-effect.ts` | ~170 | AoE template computation: cone, sphere, line, cube, cylinder |
| `domain/rules/battlefield-renderer.ts` | ~250 | Text-grid battlefield visualization for debug, CLI, and AI context |
| `application/services/combat/helpers/pit-terrain-resolver.ts` | ~100 | Pit fall detection, DEX save resolution, and Slow Fall-aware fall damage handling |

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

Zone trigger semantics such as `on_enter`, `on_start_turn`, and `per_5ft_moved` are defined in `domain/entities/combat/zones.ts` and enforced in combat services, not in `combat-map-zones.ts`.

## Known Gotchas

- **Stored map cells use a 5-foot grid** — many helpers snap incoming positions to the grid, but not every caller must pre-snap coordinates. Area-of-effect geometry also accepts raw foot coordinates and applies a 2.5-foot half-grid tolerance at boundaries.
- **combat-map.ts is a ~25-line barrel** — it only re-exports from 5 sub-modules. The bulk of the logic lives in the sub-modules. When looking for an export, check the sub-modules, not the barrel.
- **Pathfinding is more than A*** — it applies alternating 5/10 diagonal cost, difficult terrain and water multipliers, occupied-cell blocking, anti-corner-cutting checks, Large+ footprints, optional hazard avoidance, and optional zone penalties. Use the reachability helpers when you need true movement-budget answers.
- **Zone effects are trigger-driven** — apply behavior based on configured trigger modes (`on_enter`, `on_start_turn`, `on_end_turn`, `per_5ft_moved`, etc.), not a single hardcoded rule for all zones.
- **Renderer output is text-grid, not guaranteed ASCII** — default mappings are mostly ASCII-style, but terrain output may include Unicode glyphs such as the water symbol.
- **Pit terrain** triggers DEX saving throws — but only hydrate creature stats when a pit cell is actually entered (guard with `isPitEntry` first to avoid validation errors on non-pit moves). A successful save can still add `Prone`, and monk Slow Fall can reduce fall damage.
- **`CombatZone` not `Zone`** — the type for persistent area effects is `CombatZone` (from `domain/entities/combat/zones.ts`), not `Zone`. Similarly, AoE templates are `AreaOfEffect`, not `AoETemplate`.
