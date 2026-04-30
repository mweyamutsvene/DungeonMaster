# Plan: Multiplayer Tabletop Client — Theater Mode + Tactical Combat

## Status: DRAFT
## Priority: Future milestone — depends on game-server combat engine maturity
## Prerequisite: Existing game-server combat engine stable, adventure authoring API designed

---

## Objective

Build a responsive web client (mobile + desktop) that delivers a multiplayer D&D 5e experience in two modes: **Theater Mode** (narrative text, scene illustrations, free-form player actions with interrupt windows) and **Tactical Mode** (grid-based combat with touch/click UI). The server is the sole authority. The LLM serves as AI Dungeon Master — narrating, voicing NPCs, and adjudicating creative actions — while a human DM can optionally take the wheel at any time. Adventures are pre-authored (by human DM, AI, or both) before play begins.

---

## Design Decisions Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Target platforms | Mobile (phone) + desktop browser | "Living room" play — everyone on phones, or remote from home |
| Rendering: Theater | Standard web (HTML/CSS) | No game engine needed for text + images |
| Rendering: Tactical | HTML5 Canvas or CSS Grid | Lightweight, touch-friendly, no Phaser dependency |
| Server comms | HTTP + SSE (per-player channels) | Existing infrastructure, supports private messages |
| Exploration turns | Free-form with interrupt windows | Mirrors real tabletop feel, no rigid turn order |
| Combat turns | Initiative-ordered (existing engine) | D&D 5e RAW |
| Spatial model: exploration | Zone-based (backed by hidden grid) | Players interact with named zones, grid resolves on combat start |
| Spatial model: combat | Visible tactical grid | Full D&D tactical combat |
| DM mode | AI-only, AI-assisted human, or human with AI tools | Three tiers of DM involvement |
| Adventure model | Pre-authored before play | DM reviews/adjusts all content; AI fleshes out during play |
| Scene illustrations | AI-generated during adventure authoring | Pre-baked per location, not real-time |
| UI style: Theater | Polished — styled prose, parchment scroll, character avatars | Immersive reading experience |
| UI style: Tactical | Clean grid, token icons, mobile-friendly controls | Functional over pretty |
| Party chat | Always available, separate from action input | OOC banter doesn't trigger game actions |
| Dice rolling | Tap-to-roll button with animation | Quick, satisfying, visible to party (except secret rolls) |
| Character sheets | Modal overlay on button tap | Doesn't leave the main screen |

---

## Architecture Overview

### Package Structure

```
packages/
  shared/                              ← Isomorphic TypeScript (extracted from game-server)
    src/
      pathfinding.ts                   ← findPath, getReachableCells
      combat-map-types.ts             ← Grid types, terrain, positions
      movement.ts                      ← calculateDistance, snapToGrid
      ability-checks.ts               ← Ability/skill check math
      dice-roller.ts                   ← DiceRoller interface
      action-severity.ts              ← Action severity classification types

  game-server/                         ← EXISTS — imports from shared, gains new APIs
    src/
      application/
        services/
          exploration/                 ← NEW: exploration mode orchestration
            exploration-service.ts     ← Room state, zone tracking, player positions
            action-queue.ts            ← Free-form action intake + interrupt window
            scene-narrator.ts          ← LLM scene description orchestration
          adventure/                   ← NEW: adventure definition + authoring
            adventure-service.ts       ← Load/save/validate adventures
            adventure-types.ts         ← Adventure, Act, Scene, Encounter definitions
            room-template-service.ts   ← Template-based room/grid generation
      infrastructure/
        api/
          routes/
            adventures/                ← NEW: adventure CRUD + authoring API
            exploration/               ← NEW: exploration mode endpoints
            players/                   ← NEW: player auth, per-player SSE channels
          realtime/
            player-channels.ts         ← NEW: per-player SSE with private messages

  web-client/                          ← NEW: responsive web app
    src/
      core/                            ← App shell, routing, auth, SSE connection
      theater/                         ← Theater mode components
      tactical/                        ← Tactical combat grid + UI
      shared-ui/                       ← Shared: party chat, character sheet, dice roller
      dm-client/                       ← DM-specific views (adventure editor, override controls)
```

### Communication Architecture

```
                    ┌──────────────────────────┐
                    │       Game Server         │
                    │  (Fastify + Prisma + LLM) │
                    └──────┬───────┬───────┬───┘
                           │       │       │
                    SSE channels (per-player, private-capable)
                           │       │       │
              ┌────────────┤       │       ├────────────┐
              ▼            ▼       ▼       ▼            ▼
         ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌──────────────┐
         │Player A │ │Player B │ │Player C │ │  DM Client   │
         │(phone)  │ │(phone)  │ │(desktop)│ │  (desktop)   │
         └─────────┘ └─────────┘ └─────────┘ └──────────────┘
```

**SSE Event Types:**

| Event | Audience | Description |
|-------|----------|-------------|
| `narration` | All in scene | DM narration text (room descriptions, NPC dialogue) |
| `whisper` | Single player | Private DM message (perception result, secret info) |
| `action_broadcast` | All in scene | "Aldric is about to slap the bartender!" |
| `interrupt_window` | All except actor | React button + countdown timer |
| `action_resolved` | All in scene | Result narration |
| `roll_request` | Single player | "Roll Perception" with [🎲 Roll] button |
| `roll_result` | Public: all / Secret: player+DM | Dice result with modifier breakdown |
| `scene_change` | All in scene | New location, new scene image |
| `combat_start` | All in scene | Transition to tactical mode |
| `combat_end` | All in scene | Transition back to theater mode |
| `party_chat` | All players | OOC chat message |
| `player_joined` | All | Player connected notification |
| `player_disconnected` | All | Player dropped (auto-pause option) |
| `dm_override` | All or single | Human DM injects narration, takes over NPC, etc. |
| All existing combat SSE events | Per combat rules | turn_start, roll_request, attack_resolved, etc. |

---

## Part 1: Theater Mode (Exploration + Roleplay)

### Scene Model

```typescript
interface Scene {
  id: string;
  name: string;                        // "The Rusty Anchor Tavern"
  type: 'exploration' | 'dialogue' | 'rest' | 'transition';

  // Narration
  description: string;                 // LLM-generated prose for initial entry
  illustrationUrl: string;             // Pre-generated scene image

  // Spatial (hidden from players)
  gridTemplate: string;                // Reference to room template for combat conversion
  zones: Zone[];                       // Named zones within the room

  // Entities
  npcs: SceneNpc[];                    // NPCs present with dialogue seeds
  interactables: SceneInteractable[];  // Containers, doors, objects
  loot: SceneLoot[];                   // Items in room (hidden or visible)

  // Triggers
  triggers: SceneTrigger[];            // Events that fire on conditions

  // Navigation
  exits: SceneExit[];                  // Connections to other scenes
}

interface Zone {
  id: string;
  name: string;                        // "bar_area", "dining_area", "entrance"
  description: string;                 // "The long oak bar with stools"
  gridCells: { x: number; y: number }[];  // Which grid cells this zone covers
  defaultPosition: { x: number; y: number };  // Where to place a player entering this zone
}

interface SceneNpc {
  npcId: string;
  name: string;
  zone: string;                        // Which zone they're in
  disposition: 'hostile' | 'neutral' | 'friendly' | 'fearful';
  dialogueSeed: string;                // LLM context for generating this NPC's dialogue
  statBlockId?: string;                // For combat conversion
  combatTrigger?: string;              // What makes this NPC hostile
}

interface SceneTrigger {
  id: string;
  condition: TriggerCondition;         // "player_enters_zone:back_room" | "hostile_action:bartender"
  effect: TriggerEffect;               // "start_combat:bar_brawl" | "narrate:secret_passage"
  oneShot: boolean;
  requiresCheck?: {                    // D&D check to detect/interact
    skill: string;
    dc: number;
    passive: boolean;                  // Can be detected passively or requires active search
  };
}

interface SceneExit {
  direction: string;                   // "north", "upstairs", "back door"
  targetSceneId: string;
  description: string;                 // "A staircase leads up into darkness"
  locked?: { dc: number; keyItem?: string };
  hidden?: { skill: string; dc: number };
}
```

### Free-Form Action Queue

```typescript
// Server-side action processing pipeline

interface PlayerAction {
  playerId: string;
  rawText: string;                     // "I slap the bartender"
  timestamp: number;
}

interface ParsedAction {
  playerId: string;
  intent: ActionIntent;                // LLM-parsed intent
  severity: 'trivial' | 'notable' | 'consequential' | 'hostile';
  targetEntity?: string;               // NPC, object, player
  requiresCheck?: { skill: string; dc: number };
  interruptWindowMs: number;           // 0, 3000, 5000, 8000 based on severity
}

// Action processing flow:
// 1. Player submits action text
// 2. LLM intent parser → ParsedAction with severity
// 3. If severity requires interrupt window:
//    a. Broadcast "X is about to Y" to all players in scene
//    b. Start interrupt timer
//    c. Collect counter-actions during window
//    d. If counter-actions received: resolve as contested check
//    e. If no counter-actions: resolve original action
// 4. If trivial/notable: resolve immediately
// 5. LLM narrates the outcome
// 6. Check for trigger conditions (combat start, scene change, etc.)

// Simultaneous action handling:
// If 2+ players submit actions within the same interrupt window:
// → Contested initiative (DEX check) to determine order
// → Or simultaneous resolution if independent targets
```

### Interrupt Window UI (Mobile)

```
┌──────────────────────────────┐
│                              │
│  ⚠️ Aldric is about to      │
│  slap the bartender!         │
│                              │
│  ████████████░░░░ 4s         │
│                              │
│  ┌──────────┐ ┌────────────┐│
│  │ 🛑 React │ │ Let it     ││
│  │          │ │ happen     ││
│  └──────────┘ └────────────┘│
│                              │
│  [Or type a reaction...]     │
│                              │
└──────────────────────────────┘
```

Tapping "React" opens the action box pre-focused. Tapping "Let it happen" dismisses. Timer expiring = implicit "let it happen."

### Player Zone Tracking

```typescript
// During theater mode, server tracks which zone each player is in
interface PlayerExplorationState {
  playerId: string;
  sceneId: string;
  zoneId: string;                      // "bar_area", "entrance", etc.
  interactingWith?: string;            // NPC or object they're engaged with
}

// Natural language → zone resolution:
// "I walk to the bar"           → zone: "bar_area"
// "I sit in the corner"         → zone: "dining_area" (corner subsection)
// "I check the back door"       → zone: "back_room"
// "I stay near the entrance"    → zone: "entrance"

// On combat start:
// Each player's zone → specific grid cell within that zone
// Uses zone.defaultPosition or nearest unoccupied cell to their interactable
```

### Private Information (Whispers)

```typescript
// DM whispers are per-player SSE events
// Only the receiving player sees the text

// Triggers for whispers:
// 1. Passive Perception detects something only that character would notice
// 2. NPC whispers to a specific character
// 3. Class/race ability reveals hidden info (darkvision, detect magic)
// 4. Human DM sends a private note

// Example:
// Server checks: Branwen has passive Perception 17, trap DC 15
// SSE to Branwen only:
//   { type: "whisper", text: "You notice faint scratches on the floor near
//     the bookcase, as if it's been moved many times." }
// Other players see nothing.
```

---

## Part 2: Tactical Mode (Combat)
Use the CLI to as reference in what we can build for the web client. The CLI has a full combat loop implemented with the current game-server combat engine, so we can mirror that flow in the web client UI.

### Theater → Tactical Transition

```
1. Combat trigger fires (hostile action, ambush, encounter trigger)
2. Server:
   a. Resolves all player zone positions → grid cell positions
   b. Places NPCs at their grid positions (from scene NPC data)
   c. Creates encounter (existing combat engine)
   d. Emits SSE: combat_start { encounterId, gridState, combatantPositions }
3. Client:
   a. Scene illustration slides up / fades out
   b. Tactical grid renders (canvas) with:
      - Room layout (walls, furniture from template)
      - Terrain types (difficult terrain, cover objects)
      - All combatants at resolved positions
      - Fog of war if applicable
   c. Initiative tracker appears
   d. DM narration: "Roll initiative!"
4. SSE: roll_request { type: 'initiative' } per player character
5. Players tap [🎲 Roll Initiative] → results broadcast → turn order established
```

### Tactical Grid (Mobile-First)

```
Phone Portrait Layout:
┌──────────────────────────────┐
│ [Aldric ❤️18/22] [Branwen ❤️│  ← Compact party bar (tap for sheet)
│  ──────── Initiative ──────  │
│  ►Aldric → Goblin → Branwen │  ← Horizontal scroll initiative
├──────────────────────────────┤
│                              │
│   ┌──┬──┬──┬──┬──┬──┐       │
│   │  │▓▓│▓▓│▓▓│  │  │       │  ← Grid (pinch to zoom, pan)
│   ├──┼──┼──┼──┼──┼──┤       │     ▓▓ = furniture/cover
│   │  │  │🧑│  │  │  │       │     🧑 = player token
│   ├──┼──┼──┼──┼──┼──┤       │     👹 = enemy token
│   │  │  │  │  │👹│  │       │     🟦 = reachable cell
│   ├──┼──┼──┼──┼──┼──┤       │
│   │  │  │  │  │  │  │       │
│   └──┴──┴──┴──┴──┴──┘       │
│                              │
├──────────────────────────────┤
│  ● Action  ● Bonus  ◐ 15ft  │  ← Economy tracker
│ [⚔️Atk][🛡️Dodge][💨Dash]    │  ← Action buttons (horizontal scroll)
│ [🔥Ability1][📖Spell1]       │
│ [End Turn]                   │
├──────────────────────────────┤
│  DM: Aldric swings wide...   │  ← Compact narration log (expandable)
│  🎲 18 + 5 = 23 → HIT!      │
└──────────────────────────────┘

Phone Landscape Layout:
┌────────────────────────────────────────────────┐
│  ┌────────────────────┐ ┌────────────────────┐ │
│  │                    │ │ ►Aldric            │ │
│  │     GRID           │ │  Goblin            │ │
│  │   (larger view)    │ │  Branwen           │ │
│  │                    │ │ ──────────         │ │
│  │                    │ │ DM: The goblin...  │ │
│  │                    │ │ 🎲 14+3=17 → MISS │ │
│  └────────────────────┘ └────────────────────┘ │
│  [⚔️][🛡️][💨][🔥][📖] [● ● ◐ 30ft] [End Turn]│
└────────────────────────────────────────────────┘

Desktop Layout:
┌──────────────────────────────────────────────────────────────┐
│  [Party Portraits + HP]            [Initiative Tracker]      │
├────────────────────────────┬─────────────────────────────────┤
│                            │  DM Narration                   │
│                            │  "Aldric charges forward,       │
│      TACTICAL GRID         │   longsword gleaming—"          │
│      (large, centered)     │                                 │
│                            │  Combat Log                     │
│                            │  Aldric: Attack → 23 vs AC 15  │
│                            │  HIT: 9 slashing damage         │
│                            │  Goblin HP: 3/12               │
│                            ├─────────────────────────────────┤
│                            │  💬 Party Chat                  │
│                            │  Tommy: nice hit                │
│                            │  Sara: I'll heal next turn      │
├────────────────────────────┴─────────────────────────────────┤
│  [⚔️Attack][🛡️Dodge][💨Dash][🔥Ability][📖Spell]  [End Turn] │
│  ● Action  ● Bonus Action  ◐ Movement 15ft  ● Reaction      │
└──────────────────────────────────────────────────────────────┘
```

### Touch Interactions (Tactical)

| Gesture | Action |
|---------|--------|
| Tap empty reachable cell | Move there (path preview → confirm tap) |
| Tap enemy token | Target for attack/spell (if ability selected) |
| Tap ally token | Target for healing/buff |
| Long press token | Show stat summary tooltip |
| Pinch | Zoom grid in/out |
| Two-finger drag | Pan grid |
| Tap action button | Select ability, enter targeting mode |
| Swipe narration panel | Expand/collapse combat log |

### Combat Actions (UI-Based)

Primary actions are **button taps**, not typed text:

```
Available actions (shown as buttons, greyed when unavailable):

ACTIONS (consume action):
  ⚔️ Attack        → tap enemy in range
  🛡️ Dodge         → immediate (no target)
  💨 Dash          → doubles movement
  🤝 Help          → tap ally in range
  🔍 Search        → immediate (Perception check)
  👊 Grapple       → tap adjacent enemy
  💪 Shove         → tap adjacent enemy

BONUS ACTIONS (consume bonus action):
  🔥 [Class abilities — dynamic per class]
  🗡️ Offhand Attack

SPELLS (separate expandable panel):
  📖 [Prepared spell list with slot costs]

FREE:
  🗣️ [Chat to party during combat — doesn't consume anything]
```

### Reaction Prompts

When a reaction opportunity arises, the affected player gets a popup:

```
┌──────────────────────────────┐
│                              │
│  ⚡ Reaction Available!      │
│                              │
│  Goblin attacks you (18 vs  │
│  your AC 15 — would HIT)    │
│                              │
│  🛡️ Cast Shield?            │
│  AC becomes 20 → MISS       │
│  (costs 1st-level slot,     │
│   2 remaining)              │
│                              │
│  ┌──────────┐ ┌────────────┐│
│  │ Cast     │ │ No         ││
│  │ Shield   │ │ Thanks     ││
│  └──────────┘ └────────────┘│
│                              │
│  ████████████░░ 10s          │
│  (auto-decline on timeout)   │
│                              │
└──────────────────────────────┘
```

---

## Part 3: Adventure Authoring

### Adventure Definition Format

```typescript
interface Adventure {
  id: string;
  title: string;                       // "The Curse of Thornwood Manor"
  synopsis: string;                    // Brief summary for DM/players
  partySize: { min: number; max: number };
  levelRange: { min: number; max: number };
  estimatedDuration: string;           // "3-4 hours"

  acts: Act[];
  globalNpcs: NpcDefinition[];         // Recurring NPCs across scenes
  lootTables: LootTable[];
}

interface Act {
  id: string;
  title: string;                       // "Act 1: The Missing Merchant"
  scenes: Scene[];                     // Linear or branching
  startSceneId: string;
}

interface Scene {
  // (as defined above in Theater Mode section)
  // Plus:
  branchesTo: SceneBranch[];           // Conditional scene transitions
}

interface SceneBranch {
  condition: string;                   // "quest_flag:found_key" | "npc_dead:bartender"
  targetSceneId: string;
  description: string;                 // "If the party found the key..."
}

interface CombatEncounterDef {
  id: string;
  name: string;                        // "bar_brawl"
  enemies: { statBlockId: string; count: number; zone: string }[];
  reinforcements?: { round: number; enemies: { statBlockId: string; count: number }[] }[];
  terrain: TerrainOverride[];          // Furniture, cover, hazards
  victoryCondition: 'all_defeated' | 'boss_defeated' | 'rounds_survived' | 'objective';
  onVictory: { narration: string; nextSceneId?: string; loot?: string[] };
  onDefeat: { narration: string; nextSceneId?: string; consequence: string };
}
```

### Authoring Phases

```
1. Human DM writes adventure skeleton:
   - Acts, scenes, branching logic, key NPCs, encounters
   - Can be as sparse as "Tavern scene → dungeon level 1 → boss fight"

2. AI expands skeleton:
   - Generates room descriptions for each scene
   - Generates NPC dialogue seeds
   - Generates scene illustrations (PixelLab / DALL-E / Stable Diffusion)
   - Generates grid layouts from templates for each location
   - Populates loot tables based on party level

3. Human DM reviews + adjusts:
   - Edit narration text
   - Adjust enemy compositions
   - Set guardrails: "players cannot skip Act 2"
   - Flag key NPCs as unkillable / essential
   - Adjust DCs and encounter difficulty

4. Adventure published → ready for play sessions
```

### DM Client (Desktop-Focused)

```
┌─────────────────────────────────────────────────────────────────┐
│  DM VIEW — "The Curse of Thornwood Manor"    [Pause] [Save]    │
├───────────────────┬─────────────────────────┬───────────────────┤
│  ADVENTURE MAP    │    CURRENT SCENE        │  PLAYER STATUS    │
│  ┌─────────────┐  │                         │                   │
│  │ [Tavern] ◄──│──│  The Rusty Anchor       │  Aldric (Tommy)   │
│  │   ↓         │  │  ┌─────────────────┐    │  HP: 18/22 ✓     │
│  │ [Dungeon L1]│  │  │  Hidden grid    │    │  Zone: bar_area   │
│  │   ↓         │  │  │  + all NPCs    │    │                   │
│  │ [Boss Room] │  │  │  + all players  │    │  Branwen (Sara)   │
│  │             │  │  │  + all triggers │    │  HP: 15/15 ✓     │
│  └─────────────┘  │  └─────────────────┘    │  Zone: entrance   │
│                   │                         │                   │
│  CONTROLS:        │  Pending Action:        │  Quest Flags:     │
│  [Override NPC]   │  Aldric → slap barkeep  │  ☐ found_key     │
│  [Inject Text]    │  [Allow] [Block] [Mod]  │  ☑ met_hooded_fig│
│  [Spawn Enemy]    │  Interrupt: 5s remain   │  ☐ boss_defeated  │
│  [Award XP]       │                         │                   │
│  [Set Flag]       │  Action Log:            │  Party Loot:      │
│  [Whisper Player] │  (full action history)  │  12 gp            │
│  [Take Over NPC]  │                         │  Rusty Sword      │
│  [Force Scene]    │                         │  Health Potion x2  │
└───────────────────┴─────────────────────────┴───────────────────┘
```

DM can:
- See ALL hidden information (traps, NPC stats, player rolls)
- Override any AI decision before it's sent to players
- Take direct control of any NPC (type as them)
- Inject narration text
- Block or modify player actions ("Actually, the bartender ducks")
- Spawn enemies, award XP, set quest flags
- Whisper to individual players
- Force scene transitions
- Pause the game

---

## Part 4: Multiplayer Infrastructure

### Player Authentication & Sessions

```typescript
interface PlaySession {
  id: string;
  adventureId: string;
  dmMode: 'ai_only' | 'ai_assisted' | 'human_with_tools';
  dmPlayerId?: string;                 // If human DM
  state: 'lobby' | 'playing' | 'paused' | 'completed';
  currentSceneId: string;
  currentEncounterId?: string;         // If in combat

  players: PlayerConnection[];
  questFlags: Record<string, boolean>;
  gameHour: number;                    // In-game time
}

interface PlayerConnection {
  playerId: string;
  displayName: string;
  characterId: string;
  connected: boolean;
  lastSeen: Date;
  sseChannelId: string;               // Per-player SSE stream
}
```

### Per-Player SSE Channels

Current SSE broadcasts to all listeners on a session. New model:

```
Session SSE Bus
  ├── broadcast channel  → all players + DM
  ├── player-A channel   → only player A (whispers, private rolls, reaction prompts)
  ├── player-B channel   → only player B
  ├── player-C channel   → only player C
  └── dm channel         → only DM (sees everything + override prompts)
```

Implementation: each player connects to `GET /sessions/:id/events?playerId=X`. Server filters events by audience before sending.

### Reconnection & State Sync

```typescript
// When a player reconnects after disconnect:
// 1. Server sends full state snapshot:
interface StateSnapshot {
  mode: 'theater' | 'tactical';
  scene: {
    description: string;
    illustrationUrl: string;
    // Current narration backlog (last N messages)
    recentNarration: NarrationEntry[];
  };
  combat?: {
    encounterId: string;
    gridState: GridSnapshot;
    combatants: CombatantState[];
    turnOrder: string[];
    currentTurn: string;
    pendingAction?: PendingAction;
  };
  party: PartyMemberSummary[];
  questFlags: Record<string, boolean>;
}
// 2. Player renders from snapshot
// 3. SSE stream resumes from current state
```

### Pause / AFK Handling

- If a player disconnects during combat on their turn: **auto-pause after 30s** (configurable)
- If a player disconnects during exploration: game continues (their character is "standing around")
- DM can manually pause/unpause at any time
- In AI-only mode: disconnected player's combat turns are handled by AI (same as current NPC AI) until they return
- "AFK kick" timer: configurable (15 min default), warns party, then AI takes over character

---

## Part 5: DM Modes

### Mode 1: Full AI DM

- No human DM connected
- AI handles all narration, NPC dialogue, action adjudication
- Pre-authored adventure provides guardrails
- Actions classified by severity → interrupt windows fire automatically
- AI resolves creative actions via LLM: "Can I swing from the chandelier?" → LLM judges feasibility, assigns DC, narrates result
- Combat AI for all enemies (existing `DeterministicAiDecisionMaker`)

### Mode 2: AI-Assisted Human DM

- Human DM connected via DM client
- AI generates narration drafts → DM can edit before sending or auto-approve
- AI voices NPCs → DM can take over any NPC at any time
- AI handles combat mechanics → DM can override any roll or decision
- DM sees pending player actions → can block/modify/allow
- AI suggests DCs for creative actions → DM confirms or adjusts

### Mode 3: Human DM with AI Tools

- Human DM drives everything manually
- AI available on-demand: "Generate a description for this room", "What would this NPC say?"
- No auto-narration — DM types or speaks all narration
- AI handles rules calculations only (damage math, condition tracking, etc.)
- Closest to traditional VTT (Roll20, Foundry) but with AI helper buttons

---

## Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| **Web framework** | React (Next.js or Vite SPA) | Component model, responsive, huge ecosystem |
| **Styling** | Tailwind CSS + custom theme | Rapid responsive design, parchment/fantasy theme |
| **Tactical grid** | HTML5 Canvas (vanilla or Konva.js) | Touch-friendly, performant, no game engine bloat |
| **State management** | Zustand or Jotai | Lightweight, SSE event → state sync |
| **Server comms** | Fetch (HTTP) + EventSource (SSE) | Existing server infrastructure |
| **Mobile** | PWA (Progressive Web App) | No app store, installable, push notifications |
| **Desktop DM client** | Same web app, route-gated | `/dm` route with DM auth |
| **Image generation** | PixelLab / DALL-E / Stable Diffusion API | Pre-generate during adventure authoring |
| **Responsive** | Mobile-first CSS, breakpoints at 640/1024px | Phone portrait → phone landscape → desktop |

### Why PWA over native app:
- Single codebase for all platforms
- No app store review process
- Instant updates (no version fragmentation)
- Installable with home screen icon
- Push notifications via service worker
- Offline: not needed (multiplayer requires connection)

---

## Build Phases

| Phase | What | Deliverable |
|-------|------|-------------|
| **M1: Foundation** | | |
| M1.1 | `packages/shared/` — extract isomorphic code from game-server | Shared package, game-server still works |
| M1.2 | Per-player SSE channels on game-server | `GET /sessions/:id/events?playerId=X` with audience filtering |
| M1.3 | Player auth model (simple: display name + session code) | Join session by code, get player ID |
| M1.4 | Web client scaffold (Vite + React + Tailwind + PWA) | Empty app renders, connects to server |
| **M2: Theater Mode** | | |
| M2.1 | Narration display (styled prose, parchment theme, DM avatar) | Text renders beautifully on mobile + desktop |
| M2.2 | Party chat (OOC text channel) | Players can chat alongside narration |
| M2.3 | Action input box + LLM intent parsing | Player types "look around" → server processes |
| M2.4 | Scene illustrations (static images per scene) | Image displays above narration |
| M2.5 | Interrupt window UI (broadcast + react button + timer) | Consequential actions have interrupt countdown |
| M2.6 | Whisper system (private DM messages per player) | Passive Perception results only seen by that player |
| M2.7 | Character sheet modal | Tap button → full sheet overlay |
| M2.8 | Dice roll UI (tap-to-roll with animation, result broadcast) | Satisfying roll experience |
| **M3: Tactical Mode** | | |
| M3.1 | Canvas grid renderer (room layout, terrain, tokens) | Grid displays on mobile + desktop |
| M3.2 | Touch controls (tap to move, pinch zoom, pan) | Mobile-friendly grid interaction |
| M3.3 | Movement: reachable cells + path preview + tap-to-confirm | Move action works on grid |
| M3.4 | Attack: target selection + roll UI + damage numbers | Full attack flow on grid |
| M3.5 | Action bar (abilities, spells, end turn) | All standard actions as buttons |
| M3.6 | Initiative tracker | Turn order display |
| M3.7 | Reaction prompts (Shield, OA, Counterspell popups) | Reactions work in multiplayer |
| M3.8 | AI enemy turns (animate on all clients) | Watch enemies act with narration |
| M3.9 | Theater ↔ Tactical transitions (zone → grid resolution) | Smooth mode switch |
| **M4: Adventure System** | | |
| M4.1 | Adventure definition format + server API | CRUD for adventures |
| M4.2 | Room templates (tavern, dungeon, forest, etc.) | Template → grid conversion |
| M4.3 | Scene navigation (exits, transitions, branching) | Party moves between scenes |
| M4.4 | NPC dialogue (LLM-generated from seeds) | Talk to NPCs in theater mode |
| M4.5 | Triggers (combat start, loot discovery, scene change) | Events fire on conditions |
| M4.6 | Quest flags + state tracking | Adventure progress persists |
| **M5: DM Client** | | |
| M5.1 | DM view: full state visibility (all players, hidden info) | DM sees everything |
| M5.2 | DM controls: override actions, inject narration, whisper | DM can intervene |
| M5.3 | DM NPC takeover (type as any NPC) | DM voices NPCs directly |
| M5.4 | DM adventure editor (arrange scenes, set encounters) | Author adventures in-browser |
| M5.5 | AI assist buttons (generate description, suggest DC, etc.) | AI tools for human DM |
| **M6: Polish** | | |
| M6.1 | Reconnection + state sync | Dropped players rejoin seamlessly |
| M6.2 | AFK handling + auto-pause | Graceful disconnect handling |
| M6.3 | Push notifications (PWA) | "It's your turn!" notifications |
| M6.4 | Responsive polish pass | Test on real phones |
| M6.5 | Scene illustration generation pipeline | Batch-generate art for adventures |
| M6.6 | Sound effects (optional: dice rolls, combat hits, ambient) | Audio layer |

### Vertical Slices

**Vertical Slice 1 (M1 + M2.1-M2.3)**: 2+ players connect via phone browser, see DM narration, type actions, see each other's actions. Proves: multiplayer theater mode works.

**Vertical Slice 2 (+ M2.5 + M2.8)**: Players can interrupt each other's actions, roll dice. Proves: free-form action queue with interrupts.

**Vertical Slice 3 (+ M3.1-M3.4 + M3.9)**: A hostile action triggers combat, grid appears, players take turns attacking on a tactical grid, combat ends, back to theater. Proves: the full theater ↔ tactical loop.

---

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| LLM latency for intent parsing (action → response delay) | High | Cache common intents, use fast model for classification, stream narration |
| Interrupt window feels sluggish for trivial actions | Medium | Smart severity classification, instant resolution for trivial/notable |
| Mobile grid too small for complex encounters | Medium | Pinch-to-zoom, auto-focus on active area, limit encounter map size |
| Per-player SSE channels scaling (many concurrent connections) | Medium | SSE is lightweight; consider WebSocket upgrade if 50+ concurrent |
| Adventure authoring is too complex for casual DMs | Medium | Provide pre-built adventures, AI generates most content from sparse skeleton |
| Party splitting creates parallel narrative complexity | High | Defer to later phase; V1 keeps party together with "the party decides" |
| Creative actions (chandelier swinging) are hard to adjudicate | Medium | LLM judges + human DM override; "the DM decides" is always the fallback |
| Scene illustration generation cost/quality | Low | Pre-generate during authoring (not real-time), use cheapest adequate model |
| PWA limitations on iOS (no persistent push without app) | Low | In-app notification sounds; accept iOS limitation for V1 |

---

## Deferred (Not in This Plan)

- [ ] Voice chat integration (WebRTC)
- [ ] Voice-to-text input (speak your action instead of type)
- [ ] AI DM voice narration (TTS for DM text)
- [ ] Party splitting (parallel narrative streams)
- [ ] PvP actions (player attacks another player — contested checks)
- [ ] Spectator mode (watch a game without playing)
- [ ] Adventure marketplace (share/sell authored adventures)
- [ ] Campaign persistence (multi-session adventures with XP/leveling between sessions)
- [ ] Character builder UI (in-browser character creation)
- [ ] Fog of war in tactical mode (per-player visibility)
- [ ] Environmental combat interactions ("I throw the table at the goblin")
- [ ] Native mobile apps (if PWA proves insufficient)
- [ ] Localization / i18n
