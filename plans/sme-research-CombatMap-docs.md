# SME Research — CombatMap Docs Accuracy

## Scope
- Docs read: `.github/instructions/combat-map.instructions.md`, `packages/game-server/src/domain/rules/CLAUDE.md`
- Code read: `packages/game-server/src/domain/rules/combat-map.ts`, `combat-map-types.ts`, `combat-map-core.ts`, `combat-map-sight.ts`, `combat-map-zones.ts`, `combat-map-items.ts`, `pathfinding.ts`, `area-of-effect.ts`, `battlefield-renderer.ts`, `packages/game-server/src/application/services/combat/helpers/pit-terrain-resolver.ts`
- Adjacent confirmation reads: `packages/game-server/src/domain/entities/combat/zones.ts`, targeted unit tests for combat-map, pathfinding, AoE, renderer, and pit resolution

## Current Truth
- `combat-map.ts` is a small barrel over five submodules. The barrel currently re-exports 48 symbols, so the flow is larger than the doc’s `35+` framing implies.
- `pathfinding.ts` does more than A*: it owns `findPath()`, `findAdjacentPosition()`, `getReachableCells()` (Dijkstra flood-fill), and `findRetreatPosition()`. It snaps inputs to grid, uses alternating 5/10 diagonal movement cost, blocks corner-cutting, supports Large+ footprints, optionally avoids hazards, and can penalize zone cells.
- `combat-map-zones.ts` is storage/accessor code only. Zone trigger semantics such as `on_enter`, `on_start_turn`, and `per_5ft_moved` live in `domain/entities/combat/zones.ts`, not in the map-zone module itself.
- `area-of-effect.ts` computes cone, sphere, cube, line, and cylinder targeting with a `2.5ft` half-grid tolerance. It accepts raw foot coordinates; callers are not required to pre-snap every point.
- `battlefield-renderer.ts` renders a text grid with axes and legend. It is not strictly ASCII in practice because default mappings include Unicode like `≈` for water.
- `pit-terrain-resolver.ts` first guards with `isPitEntry()`, then resolves a DEX save, adds `Prone` on a successful save, applies fall damage on a failed save, and can reduce damage via Slow Fall when monk context is supplied.
- Obscuration support is currently cell-based (`MapCell.obscured`). `getObscuredLevelAt()` does not actually inspect zones despite the nearby comment claiming that it does.

## Drift Findings
1. The instruction doc says diagonal distance is `5ft in standard mode`. Current pathfinding uses alternating `5/10` diagonal movement cost, so that statement is wrong for the implemented movement rules.
2. The instruction doc says all positions must be multiples of 5. That is too strong. Stored map cells are grid-aligned, but several public helpers snap inputs (`getCellAt`, `findPath`) and AoE geometry accepts arbitrary foot coordinates.
3. The responsibility row for `combat-map-zones.ts` is misleading. That file does not apply damage on entry or turn start; it only reads/writes `map.zones`.
4. The phrase `battlefield ASCII rendering` is slightly misleading. The renderer is a character-grid renderer, but the default output is not guaranteed ASCII-only.
5. The `35+ exports` note is stale. The combat-map barrel alone currently re-exports 48 symbols.
6. The instruction doc undersells `pathfinding.ts` by describing only A* + Dijkstra in general terms and not naming the concrete helper surface (`getReachableCells`, `findRetreatPosition`, `findAdjacentPosition`).
7. The instruction doc understates the pit helper. It does more than pit detection + DEX save resolution; it also handles prone-on-save and optional Slow Fall reduction.
8. The shared `packages/game-server/src/domain/rules/CLAUDE.md` is not inaccurate for this flow, but it is missing one high-value ownership warning: the barrel is thin, and zone trigger rules live outside `combat-map-zones.ts`.

## Recommended Doc Edits

Instruction doc replacements/additions in regular English:

- Replace the `combat-map-zones.ts` responsibility row with:
  `Zone map accessors only: getMapZones, addZone, removeZone, updateZone, setMapZones. Zone shape and trigger semantics live in domain/entities/combat/zones.ts, and runtime trigger handling happens in combat services.`

- Replace the `Grid is 5ft squares` gotcha with:
  `Stored map cells use a 5-foot grid. Many helpers snap incoming positions to the grid, but not every caller must pre-snap coordinates. Area-of-effect geometry also accepts raw foot coordinates and applies a 2.5-foot half-grid tolerance at boundaries.`

- Replace the pathfinding gotcha with:
  `Pathfinding uses A* for point-to-point routes and Dijkstra flood-fill for reachability. It applies alternating 5/10 diagonal movement cost, difficult terrain and water multipliers, optional hazard avoidance, occupied-cell blocking, Large+ creature footprints, anti-corner-cutting checks, movement budgets, and optional zone penalties.`

- Add one sentence to the pathfinding section:
  `The public helper surface also includes findAdjacentPosition(), getReachableCells(), and findRetreatPosition().`

- Replace `battlefield ASCII rendering` / `ASCII battlefield visualization` wording with:
  `text-grid battlefield rendering for AI/debug/CLI output`.

- Add one note to the renderer section:
  `Default character mappings are mostly ASCII-style, but the renderer may emit Unicode terrain glyphs such as the water symbol.`

- Add one note to the pit helper row:
  `resolvePitEntry() also applies Prone on a successful save and can reduce fall damage via Slow Fall when monk context is provided.`

- Add one note to the sight section:
  `Current obscuration lookup is cell-based only through MapCell.obscured; this module does not currently derive obscuration from zones.`

- Replace the `35+ exports` wording with:
  `The combat-map barrel is a thin re-export layer over five submodules and currently exposes roughly fifty public symbols, so behavior changes here have high fanout.`

Optional CLAUDE.md addition in caveman style:

- Add after current law 5:
  `6. Map barrel small. Real map brain live in sub-files.`

- Optional second line if you want the zone split called out explicitly:
  `7. Map zone file store zone only. Zone trigger law live in combat zones code.`

Mermaid note:

- Mermaid would not materially help this instruction file unless you want to teach ownership boundaries to new contributors. A short table plus two warning bullets is enough here.
- If a diagram is added anyway, keep it tiny: `combat-map.ts -> core/sight/zones/items/types`, plus a side edge from `combat-map-zones.ts` to `domain/entities/combat/zones.ts` and `pit-terrain-resolver.ts`.