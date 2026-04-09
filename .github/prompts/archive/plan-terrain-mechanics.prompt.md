# Plan: Elevated and Pit Terrain Mechanics (RULES-L3)

## Background

The combat map already supports `TerrainType` values `"elevated"` and `"pit"`, but no
game mechanics are applied for them. This plan covers the design decisions and
implementation steps needed to make these terrain types mechanically meaningful.

---

## Design Decisions

### Cell Data Extensions
Both terrain types require additional numeric data per cell (beyond the existing
`TerrainType` string tag):

| Field | Type | Description |
|-------|------|-------------|
| `terrainElevation` | `number` (feet, default 0) | Feet above ground level for elevated cells. A creature standing on an elevated cell is at this height relative to ground-level cells. |
| `terrainDepth` | `number` (feet, default 0) | Depth of a pit in feet. Used to compute fall damage on entry. |

These should be **optional** fields on `MapCell` in `combat-map-types.ts` so existing
map definitions remain valid without change.

---

## Elevated Terrain Mechanics

### D&D 5e 2024 Rule
Creatures at higher elevation than their target have advantage on melee/ranged attack
rolls against that target (DM's discretion; many tables use this common-sense ruling).
The 2024 PHB treats this as a DM-adjudicated situational effect.

### Implementation Plan
1. **`MapCell` extension** (`combat-map-types.ts`):
   ```ts
   terrainElevation?: number; // feet above ground (default 0)
   ```
2. **`getElevationOf(map, position)`** (`combat-map-core.ts`):
   Returns the `terrainElevation` of a cell (or 0 if unset).
3. **Attack roll mode override** (`combat/attack-resolver.ts` or application layer):
   - If `attackerElevation > targetElevation` by at least `gridSize` (5 ft):
     grant `"advantage"` on the attack roll (or stack with existing advantage sources).
   - Pass `elevationAdvantage: boolean` via `AttackSpec.mode` or `AttackResolveOptions`.
4. **Application-layer wiring** (`action-handlers/attack-action-handler.ts`):
   - Compute attacker and target elevations from `CombatMap` cells.
   - Set advantage accordingly when calling `resolveAttack`.

---

## Pit Terrain Mechanics

### D&D 5e 2024 Rule
- Entering a pit cell (voluntarily or via forced movement/shove) requires a **DC 15 DEX save**.
- On failure: the creature falls into the pit; fall damage = 1d6 per 10 ft depth.
- On success: the creature catches the edge and does not fall (treat as prone, no damage).

### Implementation Plan
1. **`MapCell` extension** (`combat-map-types.ts`):
   ```ts
   terrainDepth?: number; // feet deep (default 0); only meaningful when terrain === "pit"
   ```
2. **`computePitFallDamage(depth, diceRoller)`** (`combat-map-core.ts` or `domain/rules/damage-defenses.ts`):
   ```ts
   export function computePitFallDamage(depthFeet: number, diceRoller: DiceRoller): number {
     const dice = Math.max(1, Math.floor(depthFeet / 10));
     return diceRoller.rollDie(6, dice).total;
   }
   ```
3. **Saving throw trigger** (`domain/rules/movement.ts` or application layer):
   - When `enterCell(map, position)` detects `terrain === "pit"`:
     - Trigger DC 15 DEX saving throw for the entering creature.
     - On failure: apply `computePitFallDamage(terrainDepth, diceRoller)`.
     - On success: creature is Prone at the pit edge, speed = 0 for remainder of turn.
4. **Forced movement** (`combat/tabletop/dispatch/movement-handlers.ts`):
   - When a Shove/Bull Rush/terrain effect pushes a creature into a pit cell,
     the same DC 15 DEX save applies.

---

## Affected Files
- `domain/rules/combat-map-types.ts` — add `terrainElevation?` and `terrainDepth?` to `MapCell`
- `domain/rules/combat-map-core.ts` — add `getElevationOf`, `computePitFallDamage`, update `setTerrainAt` docs
- `domain/combat/attack-resolver.ts` or `AttackResolveOptions` — accept elevation advantage flag
- `application/services/combat/action-handlers/attack-action-handler.ts` — set elevation advantage
- `application/services/combat/tabletop/dispatch/movement-handlers.ts` — pit entry save
- E2E scenarios in `scripts/test-harness/scenarios/` — elevation and pit test scenarios

---

## Out of Scope
- Multi-cell creatures (Large/Huge) occupying both elevated and ground cells simultaneously
- Underwater/ceiling elevation (only ground-to-elevated is modeled for now)
- Pit climbing rules (Athletics check to climb out, detailed movement cost)
