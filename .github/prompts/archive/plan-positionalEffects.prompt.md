# Plan: Positional & Movement-Triggered Effects — Phase 11

## Overview

Three categories of combat mechanics require **positional awareness** beyond the per-combatant `ActiveEffect` system (Phase 10):

1. **Zone/aura effects** — creature-attached or placed areas that affect combatants within them
2. **Movement-triggered damage** — damage dealt per-5ft as a creature moves through an area
3. **Reaction-granted effects** — already handled by the `AttackReactionDef` / `DamageReactionDef` pipeline (documented here for completeness, no new work needed)

These mechanics need the existing grid/pathfinding infrastructure but add new concepts: persistent zones, per-square movement hooks, and aura proximity tracking.

## Current State

### What Already Exists

| Capability | Status | Location |
|---|---|---|
| **Position tracking (x,y)** | Implemented | `resources.position`, `getPosition()` in resource-utils.ts |
| **A\* pathfinding with terrain** | Implemented | `domain/rules/pathfinding.ts` (477 lines) |
| **Movement cost tracking** | Implemented | `resources.movementRemaining`, `movementSpent` |
| **OA detection on path (cell-by-cell)** | Implemented | `two-phase-action-service.ts` L232–395, walks `path[]` |
| **`getPositionsInRadius(center, radius)`** | Implemented but UNUSED | `domain/rules/movement.ts` L120–141 |
| **`getEntitiesInRadius(map, center, radius)`** | Implemented (faction only) | `domain/rules/combat-map.ts` L311–316 |
| **Terrain zones (static)** | Implemented | `PATCH .../combat/terrain` sets `difficult`, `wall`, `lava` on map cells |
| **Snap-to-grid** | Implemented | `snapToGrid()` in movement.ts |
| **Distance calculations** | Implemented | Euclidean (`calculateDistance`), Manhattan, Chebyshev |

### What Does NOT Exist

| Capability | Needed for |
|---|---|
| Creature-attached aura/zone concept | Spirit Guardians, Paladin Aura, Moonbeam |
| Per-square movement damage hooks | Spike Growth, Spirit Guardians (enter), Booming Blade (move) |
| Zone persistence (rounds, concentration) | All zone-based spells |
| "Enter area" / "start turn in area" triggers | Spirit Guardians, Cloudkill, Moonbeam |
| Zone interaction with A\* pathfinding (avoidance) | AI should path around dangerous zones |

### Movement Architecture (relevant details)

Movement is currently **atomic** — creature teleports from start to end position:
1. **Initiate move**: OA detection walks the path cell-by-cell via `crossesThroughReach()`
2. **Complete move**: Position updates from A→B in one step, single `"Move"` event emitted

The cell-by-cell walk in `initiateMove()` is the natural hook point for per-square zone damage.

### Reaction Pipeline (already complete — no new work)

The `AttackReactionDef` / `DamageReactionDef` / `SpellReactionDef` pipeline handles:
- **Shield** (+5 AC until next turn) — wizard.ts
- **Absorb Elements** (resistance + extra damage) — wizard.ts
- **Counterspell** — wizard.ts
- **Deflect Attacks** (reduce damage) — monk.ts
- **Hellish Rebuke** (retaliatory fire damage) — two-phase-action-service.ts

These use a prompt→response→complete flow via the reactions API endpoints. No changes needed.

## Implementation Plan

### Step 1 — Zone Entity Model

**File:** `domain/entities/combat/zones.ts` (new)

```typescript
interface CombatZone {
  id: string;
  type: 'aura' | 'placed' | 'stationary';
  attachedTo?: string;         // combatantId for auras (moves with creature)
  center: Position;            // current center position
  radiusFeet: number;          // radius in feet
  shape: 'circle' | 'line' | 'cone' | 'cube';  // future: line/cone/cube for walls/breath
  
  // What it does
  effects: ZoneEffect[];
  
  // Lifetime
  duration: EffectDuration;    // reuse from ActiveEffect: 'concentration', 'rounds', 'permanent'
  roundsRemaining?: number;
  source: string;              // spell name or feature name
  sourceCombatantId: string;   // who created it (for concentration tracking)
  
  createdAtRound?: number;
  createdAtTurnIndex?: number;
}

interface ZoneEffect {
  trigger: 'on_enter' | 'on_start_turn' | 'on_end_turn' | 'per_5ft_moved' | 'passive';
  
  // For damage zones
  damage?: { diceCount: number; diceSides: number; modifier?: number };
  damageType?: string;
  
  // For save-based zones
  saveAbility?: Ability;
  saveDC?: number;
  halfDamageOnSave?: boolean;
  
  // For condition zones
  conditions?: string[];       // conditions applied while in zone
  
  // For modifier zones (auras)
  activeEffect?: ActiveEffect; // effect applied to combatants in zone (reuse Phase 10 type)
  
  // Targeting
  affectsAllies?: boolean;
  affectsEnemies?: boolean;
  affectsSelf?: boolean;
}
```

**Key design decisions:**
- `aura` type zones move with their `attachedTo` combatant automatically
- `placed` zones stay at their `center` and don't move (Cloud of Daggers, Moonbeam)
- `stationary` for terrain-like areas (Spike Growth covers a fixed radius)
- Zone effects reuse `ActiveEffect` from Phase 10 for passive buffs (Paladin Aura)

### Step 2 — Zone Storage

**Option A (preferred):** New JSON column on encounter record — zones are per-encounter, not per-combatant.

**Option B:** Store in a dedicated `zones` key in a shared encounter resources bag.

Add to the combat repository interface:
- `getZones(encounterId): CombatZone[]`
- `addZone(encounterId, zone): CombatZone`
- `removeZone(encounterId, zoneId): void`
- `updateZone(encounterId, zoneId, patch): CombatZone`

### Step 3 — Zone Creation from Spells

**File:** `spell-action-handler.ts`

Extend prepared spell schema with zone declarations:
```json
{
  "name": "Spirit Guardians",
  "level": 3,
  "concentration": true,
  "zone": {
    "type": "aura",
    "radiusFeet": 15,
    "shape": "circle",
    "attachToSelf": true,
    "effects": [
      {
        "trigger": "on_enter",
        "damage": { "diceCount": 3, "diceSides": 8 },
        "damageType": "radiant",
        "saveAbility": "wisdom",
        "halfDamageOnSave": true,
        "affectsEnemies": true
      },
      {
        "trigger": "on_start_turn",
        "damage": { "diceCount": 3, "diceSides": 8 },
        "damageType": "radiant",
        "saveAbility": "wisdom",
        "halfDamageOnSave": true,
        "affectsEnemies": true
      },
      {
        "trigger": "passive",
        "activeEffect": { "type": "penalty", "target": "speed", "value": -10 },
        "affectsEnemies": true
      }
    ]
  }
}
```

When casting:
- Create `CombatZone` from spell declaration
- Set `sourceCombatantId` and `concentrationSpellName`
- Store via `addZone()`
- For `aura` type, set `attachedTo` to caster's combatantId

### Step 4 — Per-Square Movement Hook (Spike Growth / Spirit Guardians enter)

**File:** `two-phase-action-service.ts` `initiateMove()` (~line 232)

The existing OA detection already walks the path cell-by-cell. Extend this loop:

```
for each cell transition (prevCell → nextCell):
  1. [existing] Check OA triggers for each enemy
  2. [NEW] Check zone entry triggers:
     - For each active zone in the encounter:
       - Was prevCell outside the zone? Is nextCell inside?
       - If entering: queue 'on_enter' effect
     - For 'per_5ft_moved' zones (Spike Growth):
       - Is nextCell inside the zone?
       - If so: queue damage for this 5ft step
  3. Accumulate queued zone damage for the full path
```

**Resolution during `completeMove()`:**
- After OA resolution, apply queued zone damage in order
- For save-based zone damage, auto-roll saves (seeded dice roller)
- Apply damage through `applyDamageDefenses()` + KO handler
- If creature drops to 0 HP during movement, `finalPosition = last safe cell`

### Step 5 — Turn Start/End Zone Triggers

**File:** `combat-service.ts` turn transition hooks

At start-of-turn and end-of-turn:
- Load all zones for the encounter
- For each zone with `on_start_turn` / `on_end_turn` triggers:
  - Check if the active combatant's position is within the zone radius
  - If so, apply the zone effect (damage with save, condition application, etc.)
  - For aura zones, update `center` to match `attachedTo` combatant's current position first

### Step 6 — Aura Position Sync

**File:** `two-phase-action-service.ts` `completeMove()` (after position update)

When a creature with an attached aura moves:
- Update the zone's `center` to match the creature's new position
- Check if any enemy combatants are now within the aura that weren't before → queue `on_enter` effects
- Check if any ally combatants are now within the aura → apply passive `ActiveEffect` buffs

This enables Paladin Aura of Protection:
```json
{
  "type": "aura",
  "radiusFeet": 10,
  "attachToSelf": true,
  "effects": [{
    "trigger": "passive",
    "activeEffect": { "type": "bonus", "target": "saving_throws", "value": 3 },
    "affectsAllies": true,
    "affectsSelf": true
  }]
}
```

### Step 7 — Concentration Break Removes Zones

**File:** Same as Phase 10 Step 7 (roll-state-machine.ts concentration break)

When concentration breaks:
- Also check for zones with `duration: 'concentration'` and matching `sourceCombatantId`
- Remove the zone
- Remove any passive `ActiveEffect` buffs the zone was providing to combatants within it

### Step 8 — Zone Cleanup on Turn Transitions

**File:** `combat-service.ts` turn transition hooks (alongside Phase 10 effect cleanup)

- Decrement `roundsRemaining` for `duration: 'rounds'` zones
- Remove expired zones
- For removed zones, clean up any passive `ActiveEffect` buffs applied to combatants

### Step 9 — Booming Blade: Movement-Triggered Conditional Damage

**Special case:** Booming Blade doesn't create a zone — it marks a creature with a conditional effect: "if this creature moves voluntarily before your next turn, it takes Xd8 thunder damage."

This fits better as an `ActiveEffect` with `duration: 'until_start_of_next_turn'` and a new trigger type:

```typescript
// In ActiveEffect (Phase 10)
triggerAt?: 'start_of_turn' | 'end_of_turn' | 'on_voluntary_move';
```

**Hook point:** In `two-phase-action-service.ts` `initiateMove()`, before OA detection:
- Check moving creature for effects with `triggerAt: 'on_voluntary_move'`
- Apply the damage immediately
- Remove the triggered effect

### Step 10 — AI Zone Awareness

**File:** `ai-action-executor.ts` or `ai/` decision-making

AI should factor zones into decisions:
- **Pathfinding avoidance**: Mark zone cells as hazards in A* options so AI paths around dangerous zones
- **Target prioritization**: Prefer attacking concentration casters to break zone spells
- **Movement decisions**: Don't move through Spike Growth if a safer path exists

### Step 11 — Tactical View Zone Display

**File:** `tactical-view-service.ts`

Include active zones in `GET .../tactical` response:
```typescript
zones: Array<{
  id: string;
  center: Position;
  radiusFeet: number;
  shape: string;
  source: string;
  sourceCombatantName: string;
  affectsEnemies: boolean;
  affectsAllies: boolean;
}>
```

This lets the CLI/frontend visualize auras and zones on the tactical map.

### Step 12 — E2E Scenarios

| Scenario | What it tests |
|----------|--------------|
| `core/spirit-guardians.json` | Cleric casts Spirit Guardians → enemies entering take damage (WIS save), enemies starting turn in area take damage. Assert aura moves with caster. Assert ends on concentration break |
| `core/spike-growth.json` | Druid casts Spike Growth → creature moving through takes 2d4 per 5ft. Assert cumulative damage on long path. Assert creature KO'd mid-path stops at last safe cell |
| `core/moonbeam-zone.json` | Druid places Moonbeam → enemy starts turn in area, takes 2d10 radiant (CON save). Assert placed zone doesn't move. Assert half damage on save |
| `paladin/aura-of-protection.json` | Paladin aura → allies within 10ft get +CHA save bonus. Assert passive ActiveEffect applied. Assert removed when ally moves out of range. Assert aura moves with paladin |
| `core/booming-blade.json` | Booming Blade hit → target takes thunder damage if it moves. Assert conditional damage on movement. Assert no damage if target doesn't move |
| `core/cloud-of-daggers.json` | Placed zone → 5d4 slashing on start of turn. Assert damage to creature in zone. Assert no damage to creature outside zone |

## What This Unlocks

| Spell/Feature | Zone Type | Trigger | Details |
|---|---|---|---|
| **Spirit Guardians** | Aura (15ft) | on_enter + on_start_turn | 3d8 radiant, WIS save, half on save, enemies only |
| **Spike Growth** | Stationary (20ft) | per_5ft_moved | 2d4 piercing per 5ft, no save, enemies only |
| **Moonbeam** | Placed (5ft) | on_start_turn | 2d10 radiant, CON save, half on save |
| **Cloud of Daggers** | Placed (5ft) | on_start_turn | 5d4 slashing, no save |
| **Wall of Fire** | Placed (line) | on_enter + on_end_turn | 5d8 fire, DEX save, half on save |
| **Paladin Aura** | Aura (10ft) | passive | +CHA mod to saving throws for allies |
| **Twilight Sanctuary** | Aura (30ft) | on_end_turn | 1d6+cleric level temp HP to allies |
| **Booming Blade** | Per-combatant effect | on_voluntary_move | 1d8 thunder on move |
| **Web** | Stationary (20ft) | passive + on_enter | Restrained condition, STR save to escape |
| **Entangle** | Stationary (20ft) | passive | Difficult terrain + Restrained, STR save |
| **Silence** | Stationary (20ft) | passive | Can't cast spells with verbal components |

## Dependencies

- **Phase 10 (ActiveEffect system)** — REQUIRED. Passive aura buffs use `ActiveEffect` applied to combatants in zone. Concentration break cleanup shares infrastructure.
- Existing A\* pathfinding — provides cell-by-cell path for per-square damage hooks
- Existing OA detection loop — provides the hook point for zone entry detection
- Existing `getPositionsInRadius()` / `getEntitiesInRadius()` — already implemented, currently unused

## Decisions

- **Zones are per-encounter, not per-combatant** — stored separately from combatant resources
- **Aura zones auto-sync position** — `attachedTo` combatant's position updates the zone center on movement
- **Per-square hooks extend existing OA loop** — no new movement system, just additional checks in `initiateMove()`
- **Booming Blade uses ActiveEffect, not a zone** — it's a per-combatant conditional, not a positional area
- **Shape is circle initially** — line/cone/cube shapes deferred until needed (Wall of Fire, Cone of Cold)
- **AI zone avoidance is a stretch goal** — can be deferred, AI currently ignores positional hazards

## Complexity

High — introduces a new entity type (`CombatZone`), new storage, new hooks in movement and turn transitions, and aura position sync. However, each integration point reuses existing infrastructure (A\* paths, damage resolution, KO handler, saving throw resolver). The most complex part is per-square movement damage with mid-path KO handling.

## Implementation Notes (completed)

### Steps 1–11: FULLY IMPLEMENTED (prior work)
All core infrastructure was already in place: zone entity model, CombatMap integration, zone damage resolver, aura sync, A* zone cost penalties, spell-action-handler zone routing, start-of-turn zone damage, per-5ft movement damage, OA + zone + aura combined path, tactical view zone display.

### Step 12: E2E Scenarios — COMPLETED

| Scenario | Status | Notes |
|----------|--------|-------|
| `core/spirit-guardians.json` | ✅ PASSES | Pre-existing — aura zone, WIS save, on_enter + on_start_turn |
| `core/cloud-of-daggers.json` | ✅ PASSES | Pre-existing — placed zone, on_start_turn, 5d4 slashing |
| `core/moonbeam-zone.json` | ✅ PASSES | NEW — placed zone, CON save DC 14, 2d10 radiant, half on save |
| `core/spike-growth.json` | ✅ PASSES | NEW — stationary zone, per_5ft_moved, 2d4 piercing, no save |
| `core/booming-blade.json` | ✅ PASSES | NEW — on_voluntary_move trigger via buff/debuff spell, 2d8 thunder |
| `paladin/aura-of-protection.json` | ⏭ DEFERRED | Passive zone effects (`getPassiveZoneEffects`) defined but not consumed by any resolution point |

### Generalization: Movement-Triggered Effect System

Extended the ActiveEffect system for fully generic on_voluntary_move effects:

1. **Type system extensions** (`effects.ts`): Added `triggerSave` (ability, DC, halfDamageOnSave) and `triggerConditions` to `ActiveEffect` interface and `createEffect()` factory.
2. **Spell input schema** (`spell-action-handler.ts`): Added `on_voluntary_move` to `triggerAt` union, plus `triggerSave` and `triggerConditions` fields in both input schema and internal buff/debuff type.
3. **Movement Trigger Resolver** (`movement-trigger-resolver.ts`): NEW generic resolver following `zone-damage-resolver.ts` pattern — handles seeded dice, saving throws, damage defenses, condition application, and KO.
4. **Two-Phase Service delegation**: `applyVoluntaryMoveTriggers()` now delegates to `resolveMovementTriggers()` instead of inline implementation.

### Bugs Fixed During Implementation

1. **AI `executeMoveToward()` missing zone damage** — The "no_reactions" path in `executeMoveToward()` did not call `resolveZoneDamageForPath` or `syncAuraZones`, unlike `executeMove()`. Fixed by adding zone damage resolution using full A* `pathCells`.
2. **AI zone damage only checked final cell** — Both `executeMove()` and `executeMoveToward()` passed `[finalDestination]` (single point) to the zone damage resolver, missing intermediate cells. Fixed `executeMove()` with `generateLinearPath()` helper and `executeMoveToward()` with `pathCells ?? [finalDestination]`.
3. **Mock AI "approach" behavior infinite retry** — `endTurn: false` caused the orchestrator to keep requesting moveToward actions after movement was spent. Fixed by changing to `endTurn: true`.

### Open Items / Future Work

- ~~**Passive zone effects** (`getPassiveZoneEffects` in `zones.ts`): Defined but never consumed~~ — **DONE** (see Implementation Notes below)
- ~~**Line/cone/cube zone shapes**: Currently only circle supported~~ — **DONE** (see Implementation Notes below)
- ~~**AI zone avoidance intelligence**: AI routes around zones via A* cost penalty but doesn't strategically reason about zone damage vs tactical positioning~~ — **DONE** (see Implementation Notes below)
- **E2E scenario coverage for new shapes/passive zones**: No dedicated E2E scenarios yet for line/cone/cube shapes or passive save bonuses. These will be validated when Paladin or Wall of Fire spells are integrated.

### Test Results
- 118/118 E2E combat scenarios PASSED
- 458/458 unit/integration tests PASSED (36 LLM tests skipped)

---

## Implementation Notes — Open Items (Session 2)

### 1. Line/Cone/Cube Zone Shapes

**Files modified**: `zones.ts`, `spell-action-handler.ts`

**Approach**: Extended `CombatZone` interface with `direction?: Position` and `width?: number`. Added 4 shape-specific position detectors, all using feet-based coordinates:

- **Circle** (default): Euclidean distance ≤ radius — unchanged
- **Cube**: Axis-aligned bounding box centered on `zone.centerPosition`. `radiusFeet` = half the cube's side length (e.g., 10ft radius = 20ft cube)
- **Line**: Point-to-segment perpendicular distance. Segment runs from `zone.centerPosition` (origin) to `zone.direction` (endpoint). Width defaults to 5ft, configurable via `zone.width`
- **Cone**: D&D 5e 2024 rules — width at distance d from origin equals d. Implemented as half-angle ≈ 26.6° (arctan(0.5)). Requires `zone.direction` for aiming

`isPositionInZone()` now switches on `zone.shape` and dispatches to the appropriate detector. All existing callers (pathfinding, zone-damage-resolver, combat-service, AI context) automatically benefit.

`spell-action-handler.ts` updated to accept `direction` and `width` in both the zone schema (LLM input) and `handleZoneSpell()` signature, passing both through to `createZone()`.

### 2. Passive Zone Effects Consumption

**Files modified**: `zones.ts`, `combat-service.ts` (2 locations), `zone-damage-resolver.ts`

**Approach**: Query-time integration — compute passive save bonus at save resolution time rather than syncing ActiveEffects on/off creatures as they enter/leave zones. This avoids sync complexity while correctly applying bonuses at all save points.

**New helper**: `getPassiveZoneSaveBonus(zones, position, creatureId, isSameFaction)` in `zones.ts` — filters for passive zones containing the position, checks faction alignment (friendly auras only), and sums all `saving_throws` effect bonuses.

**Integration points**:
1. **Save-to-end resolution** (`processActiveEffectsAtTurnEvent`): When a creature makes a save to end a condition at turn start/end, the passive zone bonus is added alongside existing effect bonuses
2. **Zone turn triggers** (`processZoneTurnTriggers`): When a zone forces a save on turn start/end, the passive aura bonus is added to the creature's save total
3. **Movement zone damage** (`resolveZoneDamageForPath`): Auto-computes passive bonus from start position if not pre-supplied, applies to all zone saves during movement

### 3. AI Zone Avoidance Intelligence

**Files modified**: `ai-types.ts`, `ai-context-builder.ts`, `ai-decision-maker.ts`, `mocks/index.ts`

**Approach**: Expose zone data to AI decision-making at three levels:

1. **Structured context** (`AiCombatContext.zones[]`): Zone metadata including center, radius, shape, source creature, and simplified effects (trigger, damage type, dice, save ability/DC)
2. **LLM strategic guidance**: New "ZONES" section in the system prompt explaining trigger types (`on_enter`, `on_start_turn`, `per_5ft_moved`), avoidance strategies, aura movement with casters, and concentration caster targeting to remove zones
3. **Mock AI targeting**: Updated to prefer concentration casters — if an enemy has `concentrationSpell`, they become the priority target. This enables mock AI tests to validate zone removal via concentration breaking

### Assumptions
- Passive zone bonuses apply based on the creature's position at the time of the save (start-of-move position for movement saves)
- Cone shape uses D&D 5e 2024 rules where width = distance from origin (not the older "53-degree" interpretation)
- Cube zones are axis-aligned (not rotated) — sufficient for grid-based combat
- AI zone context is built from `encounter.mapData` which may be undefined for encounters without maps
