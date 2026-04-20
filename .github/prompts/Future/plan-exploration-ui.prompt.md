# Plan: CRPG Exploration Mode + UI Client

## Status: DRAFT
## Affected Flows: New (Client), EntityManagement, CombatMap, CombatRules (shared code extraction)
## Priority: Future milestone — depends on game-server combat engine maturity

---

## Objective

Build a browser-based 2D CRPG client with BG2/Planescape Torment click-to-move mechanics, Ultima 7 visual density (oblique projection pixel art via PixelLab), and full D&D 5e 2024 exploration mechanics. The client handles all exploration logic locally (pathfinding, passive checks, trigger detection, stealth, lighting) and syncs outcomes to the server. Combat mode is a separate plan.

---

## Design Decisions

### Visual Style
- **Oblique projection** (U7-style) — not isometric, not top-down
- **Pixel art** generated via PixelLab AI tool ($12-50/mo)
- **No visible grid** during exploration — grid revealed only in combat mode
- **Dense, interactive environments** — tables with objects, readable books, NPC schedules

### Architecture Philosophy
- **Client owns exploration feel** — pathfinding, movement interpolation, passive checks all run locally for zero-latency responsiveness
- **Server owns persistence + consequences** — HP changes, quest flags, item creation, encounter creation
- **Shared isomorphic TypeScript** — same pathfinding, ability check math, dice roller used on both client and server
- **All map data (including hidden triggers) shipped to client** — visibility controlled by D&D mechanics (Perception, Investigation), not network hiding. This is a single-player/co-op PvE game, not adversarial multiplayer.

### Tech Stack
| Layer | Choice | Rationale |
|-------|--------|-----------|
| Renderer | **Phaser 3** | TypeScript-native, tilemap support, sprite animation, WebGL + canvas fallback |
| Map Editor | **Tiled** | Industry standard, JSON export, oblique projection support, object layers for triggers |
| Asset Pipeline | **PixelLab** → **TexturePacker** → Phaser sprite sheets | AI pixel art → packed atlases |
| Server Comms | **HTTP + SSE** (existing) | Same Fastify server, same SSE event broker |
| State Management | **Client-side ECS** (Entity-Component-System) | Clean separation of rendering/logic/data |
| Shared Code | `packages/shared/` | Pathfinding, grid types, movement, D&D ability check math |
| Rules Engine | Shared from `domain/rules/` | Ability checks, saving throws, skill checks — same deterministic code |

---

## Package Structure

```
packages/
  shared/                              ← NEW: isomorphic code extracted from game-server
    src/
      pathfinding.ts                   ← findPath, getReachableCells, findAdjacentPosition
      combat-map-types.ts              ← CombatMap, MapCell, MapEntity, TerrainType, Position
      movement.ts                      ← calculateDistance, snapToGrid
      ability-checks.ts               ← abilityCheck, skillCheck, contestedCheck (D&D 5e)
      dice-roller.ts                   ← DiceRoller interface + SeededDiceRoller
      conditions.ts                    ← Condition types (for status effect checks)
      skills.ts                        ← skill → ability mapping, proficiency resolution
      exploration-triggers.ts          ← trigger types, reveal check logic, DC tables

  game-server/                         ← EXISTS: imports from shared instead of local copies

  web-client/                          ← NEW
    src/
      core/                            ← Phaser boot, game loop, scene management
      ecs/
        components/                    ← data-only components (see below)
        systems/                       ← logic systems (see below)
        entities/                      ← entity factories (player, NPC, object, trigger)
      rendering/                       ← Phaser scene wrappers, tilemap loading, sprite mgmt
      input/                           ← mouse/keyboard handlers, click-to-move, cursor context
      networking/                      ← server HTTP client, SSE listener, position sync
      exploration/                     ← exploration mode orchestration
      ui/                              ← HUD, dialogue, skill check popups, character sheets
      scripting/                       ← NPC behavior trees, schedule engine
      checks/                          ← D&D 5e check resolution for exploration
      assets/                          ← Phaser loader configs, atlas references
```

---

## ECS Components

### Position & Movement

```typescript
interface PositionComponent {
  gridX: number;            // server-authoritative grid cell
  gridY: number;
  visualX: number;          // current render position (interpolated)
  visualY: number;
  targetVisualX: number;    // lerp target
  targetVisualY: number;
  facing: Direction;        // N, NE, E, SE, S, SW, W, NW
}

interface MovementComponent {
  speed: number;            // pixels/sec for visual interpolation
  path: GridCell[];         // remaining grid cells to traverse
  pathIndex: number;
  isMoving: boolean;
  movementType: 'walk' | 'run' | 'sneak';
}
```

### D&D Character Stats

```typescript
interface CreatureStatsComponent {
  // Ability scores
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;

  // Derived
  proficiencyBonus: number;
  level: number;
  classId: string;

  // Skill proficiencies
  skillProficiencies: string[];       // ['perception', 'stealth', 'investigation']
  skillExpertise: string[];           // double proficiency

  // Tool proficiencies
  toolProficiencies: string[];        // ['thieves-tools', 'herbalism-kit']

  // Passive scores (precomputed on load)
  passivePerception: number;
  passiveInvestigation: number;
  passiveInsight: number;

  // Feats relevant to exploration
  feats: string[];                    // ['observant', 'alert', 'dungeon-delver']

  // Senses
  darkvision: number;                 // range in feet, 0 = none
  blindsight: number;
  tremorsense: number;

  // Conditions affecting checks
  conditions: string[];               // ['blinded', 'deafened', 'poisoned']
}
```

### Triggers & Interactables

```typescript
interface TriggerComponent {
  triggerId: string;
  type: TriggerType;
  radius: number;                     // detection radius in grid cells

  // Reveal state
  revealed: boolean;
  revealedBy: string | null;

  // D&D check to detect
  detection: DetectionRequirement;

  // D&D check to interact (disarm, unlock, etc.)
  interaction: InteractionRequirement | null;

  // What happens when triggered
  effect: TriggerEffect;

  // State
  disarmed: boolean;
  activated: boolean;
  oneShot: boolean;
}

type TriggerType =
  | 'trap'              // damage/effect on enter
  | 'secret_door'       // hidden passage
  | 'hidden_container'  // concealed loot
  | 'ambush'            // enemies appear
  | 'conversation'      // NPC dialogue
  | 'area_transition'   // map change
  | 'lore_trigger'      // knowledge check reveals info
  | 'environmental'     // collapsing floor, falling rocks
  | 'magical_ward'      // arcana-detectable magic barrier
  | 'pressure_plate'    // weight-based mechanical trap

interface DetectionRequirement {
  method: 'passive_perception'
         | 'passive_investigation'
         | 'active_perception'
         | 'active_investigation'
         | 'arcana_check'
         | 'nature_check'
         | 'survival_check'
         | 'proximity'
         | 'class_feature'
         | 'spell'
         | 'darkvision'
         | 'none';
  dc: number;
  requiresLight?: boolean;
  requiresTool?: string;
  magicSchool?: string;
}

interface InteractionRequirement {
  skill: string;                       // 'thieves-tools', 'athletics', 'arcana'
  dc: number;
  failureConsequence?: TriggerEffect;
  alternateMethod?: {
    skill: string;
    dc: number;
  };
}

interface TriggerEffect {
  type: 'damage' | 'condition' | 'spawn_enemies' | 'open_passage'
      | 'dialogue' | 'transition' | 'lore_text' | 'alarm' | 'custom';
  damageType?: string;
  damageDice?: string;
  saveAbility?: string;
  saveDC?: number;
  halfDamageOnSave?: boolean;
  condition?: string;
  conditionDuration?: number;
  monsterIds?: string[];
  description?: string;
  revealDescription?: string;
}
```

### NPC AI

```typescript
interface AIComponent {
  scriptId: string;
  schedule: ScheduleEntry[];
  currentGoal: AIGoal | null;
  state: Record<string, any>;

  // D&D NPC stats for contested checks
  stealthModifier: number;
  perceptionModifier: number;
  passivePerception: number;
  insightModifier: number;

  // Faction/disposition
  faction: string;
  disposition: 'hostile' | 'neutral' | 'friendly' | 'fearful';
  alertState: 'unaware' | 'suspicious' | 'alerted' | 'searching';
}

interface ScheduleEntry {
  startHour: number;
  endHour: number;
  waypointId: string;
  behavior: 'idle' | 'wander' | 'patrol' | 'work' | 'sleep';
  wanderRadius?: number;
}
```

### Lighting & Vision

```typescript
interface LightSourceComponent {
  type: 'bright' | 'dim' | 'darkness';
  radiusBright: number;
  radiusDim: number;
  color?: string;
  flicker?: boolean;
}
```

### Rendering

```typescript
interface SpriteComponent {
  atlasKey: string;
  currentAnim: string;
  frameRate: number;
}

interface ColliderComponent {
  blocking: boolean;
  size: { w: number; h: number };
}

interface InteractableComponent {
  cursor: 'talk' | 'examine' | 'open' | 'pickup' | 'disarm' | 'lockpick' | 'use';
  label: string;
  interactionType: string;
  requiredCheck?: { skill: string; dc: number };
}
```

---

## ECS Systems (Execution Order)

```
Frame Loop (60fps):

 1. InputSystem             ← mouse/keyboard → intents (move, search, interact, sneak toggle)
 2. TimeSystem              ← advances game clock, triggers schedule changes
 3. LightingSystem          ← computes visibility per cell (light sources + darkvision)
 4. AIScriptSystem          ← ticks NPC behavior trees, schedule waypoints
 5. PathfindingSystem       ← converts move intents to A* paths (shared findPath)
 6. MovementSystem          ← advances entities along paths, smooth lerp
 7. PassiveCheckSystem      ← continuous passive Perception/Investigation/Insight checks
 8. TriggerDetectionSystem  ← checks entity positions against trigger radii
 9. TriggerActivationSystem ← fires triggered effects (damage, spawn, dialogue, etc.)
10. StealthSystem           ← party stealth vs NPC passive perception
11. CollisionSystem         ← validates moves, repath if blocked
12. AnimationSystem         ← updates sprites from movement/action state
13. CameraSystem            ← follows party leader, smooth scroll
14. FogOfWarSystem          ← reveals/hides map based on party vision + light
15. RenderSystem            ← draws tilemaps + sorted entities + lighting + fog
16. UISystem                ← HUD updates, skill check popups, floating text
17. NetworkSyncSystem       ← sends position + check outcomes, receives server state
```

---

## Key System Details

### PassiveCheckSystem
- Runs when party position changes (not every frame — caches last-checked cell per entity+trigger pair)
- Checks `passivePerception >= trap_dc` for each unrevealed trigger within radius
- Applies feat bonuses: Observant (+5), Dungeon Delver (advantage = +5 for traps), Alert
- Applies condition penalties: blinded (auto-fail sight), deafened (-5 perception), poisoned
- Checks light level: darkness = auto-fail sight-based passive Perception (unless darkvision)
- On success: `trigger.revealed = true`, floating text "Aldric notices something...", trap icon fades in

### Active Search
- Player presses "S" or clicks Search button → AoE search in radius around party
- Rolls d20 + skill modifier for best party member per check type
- Applies advantage (Dungeon Delver for traps) / disadvantage (poisoned)
- Shows dice roll UI feedback (BG2-style combat log entry)
- Unrevealed triggers with `active_perception` / `active_investigation` / `arcana_check` methods

### Stealth Mode
- Toggle via hotkey — all party members switch to `movementType: 'sneak'` (half speed, sneak animation)
- Each party member rolls Stealth independently
- NPCs check with `passivePerception >= stealthTotal`
- NPC alert states: unaware → suspicious → alerted → searching (increasing detection range)
- Heavy armor = disadvantage on Stealth (check `hasStealthDisadvantage`)
- Detection triggers: hostile NPC → combat, neutral → investigate, friendly → ignore

### Trap Interaction
- Click revealed trap → context menu: Disarm (Thieves' Tools DC), Force (Athletics DC)
- Tool proficiency required for Thieves' Tools
- Failed by 5+ = trap fires (D&D 5e convention)
- Trap fires: saving throw (DEX/CON/WIS) → damage + possible condition
- Evasion (Monk 7 / Rogue 7): 0 on save, half on fail

### Lighting & Fog of War
- D&D 5e light levels: Bright (normal), Dim (lightly obscured, -5 passive Perception for sight), Darkness (heavily obscured, auto-fail sight Perception)
- Darkvision: treat darkness as dim, dim as bright within range
- Fog states per cell: UNEXPLORED (black) → EXPLORED (greyed, no entities) → VISIBLE (full)
- Light sources: torches, lanterns, Light cantrip, fireplaces — defined as entities with LightSourceComponent
- Day/night cycle affects ambient light (server sends `game_hour_change` SSE events)

### NPC Schedule Engine
- NPCs have daily schedules: waypoint + behavior per time block
- Behaviors: idle (stand), wander (random walk within radius), patrol (waypoint loop), work (animation), sleep (lying down)
- Schedule resolution: server sends `game_hour` → client checks each NPC's schedule → pathfinds to correct waypoint
- NPC collision avoidance: if next cell blocked → wait 1-2s → repath → if still blocked → idle + retry

### NPC Behavior Trees
- Composable nodes: sequence (all must succeed), selector (first success wins), condition, action, wait
- Priority-based: check hostile reactions first, then friendly reactions, then schedule
- Barks: floating text above NPC heads ("Hail, traveler." / "Stay out of trouble." / "Huh? Must've been the wind.")
- Server defines behavior tree JSON per NPC type; client executes locally

---

## Movement System Core

Grid-based logic, smooth visual interpolation — the BG2 feel:

```
Player clicks (screenX, screenY)
  → InputSystem converts to grid coords via oblique projection transform
  → PathfindingSystem runs shared A* (occupiedPositions = all blocking entities)
  → MovementComponent.path = result, isMoving = true

Each frame:
  → MovementSystem checks: arrived at current path cell?
    → Yes: advance pathIndex, update grid position, update facing
    → If pathIndex >= path.length: arrived at destination, isMoving = false
  → Smooth lerp: visualX += (targetX - visualX) * LERP_FACTOR * dt
  → AnimationSystem: isMoving ? 'walk-{facing}' : 'idle-{facing}'
  → NetworkSyncSystem: queue position update to server every N cells

Tuning:
  WALK_SPEED = 120 pixels/sec
  RUN_SPEED  = 200 pixels/sec
  SNEAK_SPEED = 60 pixels/sec
  LERP_FACTOR = 8.0
```

### Party Formation Movement
- Party members follow leader with offset positions (triangle, line, circle formations)
- Each member pathfinds independently to their formation offset position
- When leader moves, followers repath to new offset positions
- Door/narrow passage: party collapses to single-file, re-expands after

---

## Server Interaction

```
Client                                  Server
  │  GET /sessions/:id/explore            │  ← Full map: cells, triggers, NPCs, lights, hour
  │──────────────────────────────────────→│     (all triggers included, even hidden)
  │←──────────────────────────────────────│
  │                                       │
  │  Client runs all checks locally       │
  │                                       │
  │  POST /explore/check-result           │  ← Sync discoveries
  │  { type, triggerId, finderId }        │     Server validates + persists
  │──────────────────────────────────────→│
  │                                       │
  │  POST /explore/trap-activated         │  ← Damage/conditions
  │  { triggerId, victimId, damage }      │     Server applies HP changes
  │──────────────────────────────────────→│
  │                                       │
  │  POST /explore/combat-trigger         │  ← Ambush / hostile detected
  │  { reason, combatants, surprise }     │     Server creates encounter
  │──────────────────────────────────────→│     → switch to combat mode (see combat plan)
  │                                       │
  │  SSE: npc_state_update                │  ← NPC positions/schedules (every 500ms-1s)
  │←──────────────────────────────────────│
  │  SSE: game_hour_change                │  ← Day/night cycle
  │←──────────────────────────────────────│
  │  POST /explore/dialogue-check         │  ← Persuasion/Deception in dialogue
  │  { npcId, skill, roll, total }        │     Server branches conversation
  │──────────────────────────────────────→│
```

---

## Render Order (Oblique Projection)

```
Layer 0: Ground (floor tiles, grass, paths)
Layer 1: Ground decor (rugs, blood stains, cracks)
    ↓
Entity sort by Y (ascending) — creates depth illusion
    ↓
Layer 2: Above-entity (rooftops, tree canopies, arches)
Layer 3: Weather/lighting overlay
Layer 4: Fog of war overlay
Layer 5: UI overlay (cursor, selection circles, floating text)
```

---

## Asset Pipeline

```
1. PixelLab: generate tileset in oblique style (use U7 screenshots as style reference)
2. PixelLab: generate character sprites → 8-directional rotation tool
3. PixelLab: generate walk/idle/sneak/attack animations via skeleton tool
4. PixelLab: generate decorative objects (furniture, food, books, candles)
5. PixelLab: generate UI elements (health bars, buttons, panels)
6. TexturePacker: pack sprites into atlases for Phaser
7. Tiled: compose maps using tilesets, place object layers for triggers/NPCs/lights
8. Export Tiled JSON → web-client/assets/maps/
```

---

## Build Phases

| Phase | What | D&D Integration | Deliverable |
|-------|------|-----------------|-------------|
| 1 | `packages/shared/` — extract pathfinding, ability checks, dice from game-server | Ability check math shared | Shared package, game-server imports from it |
| 2 | Phaser scaffold + tilemap loader + camera | — | Empty map renders in browser |
| 3 | Grid ↔ oblique screen transforms + tile rendering | — | Tiled map displays correctly |
| 4 | ECS framework + PositionComponent + MovementSystem + lerp | — | Rectangle moves smoothly on grid |
| 5 | Click-to-move with A* (single character) | — | Click destination, character walks there |
| 6 | Sprite + AnimationSystem (8-dir walk/idle/sneak) | Sneak animation | Character sprite walks with animation |
| 7 | **CreatureStatsComponent + PassiveCheckSystem** | Passive Perception detects traps | Walk near trap → auto-reveal |
| 8 | **TriggerComponent + TriggerDetection/Activation** | Full trap/secret/ambush with DCs | Traps fire, secrets reveal, saving throws |
| 9 | **Active Search ("S" key)** | Rolled Perception/Investigation | Manual search with dice UI |
| 10 | **Stealth mode toggle** | Stealth vs Passive Perception | Party sneaks, NPCs react |
| 11 | **Lighting + FogOfWar** | Darkvision, dim light penalties | Vision cones, fog, darkness |
| 12 | **Trap interaction (disarm/lockpick)** | Thieves' tools, saving throws | Click trap → skill check UI |
| 13 | NPC schedules + behavior trees | NPC D&D stats | NPCs wander, react to player |
| 14 | Server sync + SSE integration | Persist outcomes | State saved, multiplayer-ready |
| 15 | Party formation movement | — | Multiple characters follow leader |
| 16 | Dialogue system with skill checks | Persuasion/Deception/Intimidation | Branching dialogue with rolls |
| 17 | Art pass with PixelLab | — | Replace placeholders with pixel art |

**Vertical slice = Phases 1-7**: Character walks through a dungeon, auto-detects traps via passive Perception. Proves the core loop.

---

## Risks

| Risk | Mitigation |
|------|------------|
| Oblique projection angle consistency in PixelLab | Test early with free trial — generate one tavern tileset + character and compose in Tiled |
| Shared package extraction breaks game-server | Incremental: re-export from original location, move code file by file |
| Party pathfinding performance (5 A* calls per click) | Cache paths, only repath followers when leader moves N cells. A* on small maps is fast. |
| NPC behavior trees complex to author | Start simple (schedule-only), add trees incrementally. JSON-authored, not code. |
| Tile seam artifacts in AI-generated tiles | PixelLab has tileset tool specifically for seamless tiles — verify early |
| Movement lerp feels floaty or robotic | Tunable constants. Prototype with colored rectangles before art pass. |

---

## Deferred (Not in This Plan)

- [ ] Multiplayer co-op (requires server-authoritative position sync + per-player fog)
- [ ] World map / overland travel
- [ ] Weather effects (rain, snow, fog)
- [ ] Sound / music system
- [ ] Save/load game state
- [ ] Character creation UI
- [ ] Inventory management UI (exists on server, needs client rendering)
- [ ] Minimap
