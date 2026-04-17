# Plan: Angular Tactical UI — DungeonMaster Visual Client

## Overview

Build a web-based tactical combat UI for DungeonMaster using Angular + Phaser 3, backed by the
existing game-server API. The client is a **pure display + input layer** — the backend remains the
authoritative rules engine, pathfinder, and physics system. Pixel art assets are sourced from the
Pixellab v2 REST API and cached in the backend for reuse.

---

## Guiding Principles

1. **Backend is source of truth** — the client never enforces rules, pathfinding, or collision.
   All decisions go to the server; the client renders the result.
2. **Display layer only** — Angular owns animation, visual interpolation, and user input. Never
   duplicate rules logic in the client.
3. **Engine-agnostic contract** — the backend API (TacticalView, SSE events, move/action endpoints)
   must remain engine-agnostic so a Unity client could replace Angular later without backend changes.
4. **Web-first, Unity-optional** — Angular + Phaser 3 handles everything in scope. Re-evaluate
   Unity only if cinematic rendering, advanced VFX, or native distribution becomes a priority.
5. **Asset pipeline is additive** — the UI works with placeholder PNG files first; Pixellab
   integration is layered in after the core renderer is proven.

---

## Architecture

```
packages/ui/                            ← Angular 17+ standalone app (new monorepo package)
  src/
    app/
      core/
        game-server/
          game-server.service.ts        ← HTTP client for game-server Fastify API
          sse.service.ts                ← SSE subscriber (wraps /sessions/:id/events)
          tactical-view.models.ts       ← TypeScript mirrors of TacticalView, MapCell, etc.
        pixellab/
          pixellab-proxy.service.ts     ← Calls game-server proxy routes (never Pixellab direct)
          asset-library.service.ts      ← Local cache of combatant_id → sprite URL mappings
          job-poller.service.ts         ← Polls background job status with interval + takeUntil
      features/
        tactical-map/
          tactical-map.component.ts     ← Phaser 3 host component
          phaser-scene.ts               ← Main Phaser Scene: tile layer, token layer, overlay layer
          tile-registry.ts              ← TerrainType → spritesheet frame mapping
          token-manager.ts              ← Combatant sprites, Y-sort depth, animation state machine
          movement-animator.ts          ← Walks sprite along lastMovePath.cells[] waypoints
          zone-renderer.ts              ← Spell AoE zones as flattened ellipses
          input-handler.ts              ← Click → grid coord → POST action; hover → cell highlight
        asset-studio/
          character-studio.component.ts ← Generate PC/NPC sprites via Pixellab
          tileset-workshop.component.ts ← Generate Wang/oblique tilesets
          asset-library.component.ts    ← Browse + assign assets to session combatants
        session-setup/
          game-setup.component.ts       ← LLM scene description → auto asset manifest
      shared/
        job-status/                     ← Reusable async job progress indicators
        sprite-preview/                 ← Renders base64 PNG with pixel-art CSS scaling
```

---

## Phase 1 — Proof of Concept (~1 week, no Pixellab account needed)

**Goal:** Prove the full rendering + input loop works with static placeholder assets.

### Deliverables

- [ ] `packages/ui` Angular app scaffolded in monorepo (`pnpm` workspace)
- [ ] `GameServerService` calls `GET /sessions/:id/combat/:encounterId/tactical`
- [ ] `SseService` subscribes to `GET /sessions/:id/events` and pushes `TacticalView` updates
- [ ] Phaser 3 scene renders the map grid in **low top-down oblique** projection:
  - Two static PNG tiles: `floor.png` (normal terrain) and `wall.png` (wall terrain)
  - Cells drawn in **Y-order** (painter's algorithm) for correct occlusion
  - Grid coordinate formula: `screenX = gridX * TILE_W`, `screenY = gridY * (TILE_H / 2)`
- [ ] One static sprite PNG placed at combatant position matching backend `combatants[].position`
- [ ] Movement animation: when SSE delivers `lastMovePath`, sprite walks cell-by-cell (~100ms/step)
- [ ] Click handler: user clicks cell → angular converts screen → grid coords → sends move action
- [ ] Move range preview: flood-fill highlight of reachable cells based on `movementRemainingFeet`

### Asset Sources for PoC (no Pixellab required)

- Free dungeon tiles: `0x72` dungeon tileset on itch.io (CC0 licensed)
- Or: generate one tileset + one character manually via pixellab.ai web UI, export PNG

---

## Phase 2 — Pixellab Asset Integration (~1 week)

**Goal:** Replace static PNGs with dynamically generated Pixellab assets.

### Architecture Decision: Proxy Through Game-Server

The Angular app **never calls Pixellab directly**. Reasons:
- API key must not be exposed to the browser
- Assets need to be stored in the DB and reused across sessions
- Polling for background jobs belongs server-side

```
Angular → POST /sessions/:id/assets/generate
               └── game-server calls Pixellab v2
               └── stores job_id + asset record in DB
               └── returns { assetId, jobId }
Angular polls GET /sessions/:id/assets/:assetId/status
               └── returns { status: "processing"|"completed", downloadUrl? }
```

### New game-server routes needed

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/sessions/:id/assets/generate` | Trigger Pixellab generation job |
| `GET`  | `/sessions/:id/assets/:assetId/status` | Poll job completion |
| `GET`  | `/sessions/:id/assets` | List all assets for session |
| `POST` | `/sessions/:id/assets/:assetId/assign` | Assign sprite to combatant |

### New DB tables needed

- `AssetJob` — `{ id, sessionId, pixellabJobId, type, status, downloadUrl, createdAt }`
- `CharacterSprite` — `{ id, characterId, assetJobId, directions, spriteSheetUrl }`
- `TilesetAsset` — `{ id, sessionId, terrainType, assetJobId, tileSheetUrl }`

### Tile → TerrainType mapping table

```typescript
const TERRAIN_TILE_MAP: Record<TerrainType, string> = {
  normal:                  'dungeon-floor',
  wall:                    'stone-wall',
  difficult:               'rubble-floor',
  elevated:                'raised-platform',
  pit:                     'pit-chasm',
  hazard:                  'lava-cracks',
  'cover-half':            'low-barrier',
  'cover-three-quarters':  'heavy-cover',
  'cover-full':            'full-cover',
  water:                   'water-floor',
  lava:                    'lava-floor',
  obstacle:                'obstacle',
};
```

### Pixellab parameters for oblique dungeon assets

All tileset generation uses `view: "low top-down"` (oblique RPG perspective).
All character sprites use `view: "low top-down"`, `n_directions: 8`.
All assets in a session use a shared `color_image` reference for palette consistency.

---

## Phase 3 — LLM Game Setup Pipeline (~1 week)

**Goal:** DM describes a scene in plain English; the system auto-generates a full asset manifest.

### Flow

```
DM: "Dark goblin dungeon with ancient tomb and torchlit corridors"
        ↓
POST /sessions/:id/setup  { description: "..." }
        ↓
LLM (existing infrastructure/llm/) uses new prompt template:
  → Outputs structured JSON asset manifest:
    {
      "tilesets": [
        { "lower": "stone dungeon floor", "upper": "stone wall", "view": "low top-down" },
        { "lower": "dirt floor", "upper": "crumbling brick wall" }
      ],
      "characters": [
        { "description": "goblin warrior with rusty sword", "directions": 8 },
        { "description": "goblin shaman with wooden staff", "directions": 8 }
      ],
      "objects": [
        { "description": "iron wall torch flickering" },
        { "description": "stone sarcophagus with carved runes" }
      ],
      "palette": "dark, muted dungeon tones — browns, greys, dim orange torchlight"
    }
        ↓
game-server fires all Pixellab jobs in parallel, returns setup_id
        ↓
Angular polls /sessions/:id/setup/:setupId/status
  → Assets trickle in as they complete (2–5 min each)
  → Session starts immediately with placeholder art
  → Assets hot-swap in when ready
```

### UX Strategy for Long Generation Times

- Session starts immediately with placeholder tokens (colored circles with initials)
- Asset loading panel shows each item's status with progress ring
- Assets swap in silently as they arrive — no page reload
- Pre-generation: DM can trigger setup during session prep (day before), assets fully ready by game time
- Asset caching: "goblin warrior" generated once, reused across all future sessions

---

## Phase 4 — Interruptible Movement Protocol (~1 week)

**Goal:** NPC movement can collide with a planned player path mid-animation; client sends interruption signal.

### Protocol Change

Current (atomic):
```
POST move → backend resolves full path → SSE final position
```

New (interruptible):
```
POST /sessions/:id/combat/move/start { targetX, targetY }
  → Returns { movementId, plannedPath: cells[] }

[Client animates cell by cell]

[SSE: NPC moves into cell on player's planned path]

Client detects collision: planned path cell is now occupied
POST /sessions/:id/combat/move/interrupt { movementId, stoppedAtCell: {x, y}, reason: "path_blocked" }
  → Backend: truncates movement, spends only movement already used
  → Backend: optional follow-up action window (opportunity attack, etc.)
  → SSE: updated TacticalView with new authoritative position
```

### Backend Authority Rules

- Client sends interruption as a **request**, not a command
- Backend validates: is `stoppedAtCell` actually reachable from last confirmed position?
- Backend confirms collision: is the alleged blocking combatant actually in that cell?
- Backend rejects invalid interrupts (anti-cheat)
- Only movement budget already spent is charged — no refunds, no over-charges

### Client Collision Detection (visual only)

```typescript
// On each SSE update during animation
onTacticalUpdate(view: TacticalView) {
  const nextCell = this.movementAnimator.peekNextCell();
  if (nextCell && this.isCellOccupied(nextCell, view)) {
    this.gameServer.interruptMove(movementId, currentCell);
    this.movementAnimator.stop();
  }
}
```

The client never decides rules — it only notices the visual collision and asks the server.

---

## Technology Decisions

| Concern | Decision | Rationale |
|---------|----------|-----------|
| Framework | Angular 17+ standalone | Already in monorepo mindset; signals + HttpClient fit well |
| Renderer | Phaser 3 (WebGL/Canvas) | Required for Y-sort painter's algorithm; sprite animation; tweens |
| Tile projection | Low top-down oblique | Matches Pixellab default; classic JRPG feel; simple 2:1 ratio tiles |
| Asset pipeline | Pixellab v2 REST API | Background jobs; character + tileset + object generation |
| Backend integration | Proxy through game-server | Key security; asset persistence; job polling server-side |
| Physics/collision | Backend only | Server enforces all rules; client is display layer |
| LLM integration | Existing Ollama/OpenAI | New prompt template; structured JSON output; same provider factory |
| State sync | SSE `/events` stream | Already implemented; pushes TacticalView on every state change |
| Unity? | Deferred | Re-evaluate after Phase 2 if cinematic needs exceed web capabilities |

---

## What the Backend Already Has (No Changes Needed for Phase 1)

| Needed by UI | Backend status |
|---|---|
| Grid dimensions + cell terrain types | ✅ `map.cells[]` in TacticalView |
| Combatant positions | ✅ `combatants[].position` |
| Movement path (cell by cell) | ✅ `lastMovePath.cells[]` |
| Spell zone overlays | ✅ `zones[]` with center + radius |
| Ground items | ✅ `groundItems[]` with position |
| Live state push | ✅ SSE `/events` stream |
| Movement budget | ✅ `combatants[].actionEconomy.movementRemainingFeet` |
| Combatant facing (for sprite direction) | ⚠️ Derivable from lastMovePath; add `facing` field later |

---

## Milestone Summary

| Phase | Duration | Key Output |
|-------|----------|-----------|
| **1 — PoC Renderer** | ~1 week | Working oblique grid + sprite + click-to-move with static PNGs |
| **2 — Pixellab Assets** | ~1 week | Dynamic asset generation proxied through game-server |
| **3 — LLM Setup** | ~1 week | Plain-English scene description → auto asset manifest |
| **4 — Interruptible Move** | ~1 week | Mid-animation path collision + server-side interruption protocol |
| **Total** | ~4 weeks | Full tactical client with AI-generated art and live D&D rules |

---

## Multi-Agent Analysis

### Why the Existing Agent Structure Doesn't Fit

The current 13 SME/Implementer agents are all scoped to **game-server backend domain flows** (`domain/`, `application/`, `infrastructure/`). This project introduces three entirely new concern areas:

1. **Frontend Angular + Phaser** — no existing agent has frontend knowledge
2. **External API integration** (Pixellab) — no existing agent handles third-party HTTP APIs
3. **New backend routes + DB tables** for asset management — partially overlaps EntityManagement but is distinct enough to warrant its own scope

Re-using backend SMEs for frontend work would dilute their focus and pollute their instruction context.

---

### New Flows Needed (3)

| # | Flow | Scope | Layer |
|---|------|-------|-------|
| 14 | **TacticalRenderer** | Angular app, Phaser 3 scene, tile rendering, sprite animation, input handling, SSE consumption | Frontend |
| 15 | **AssetPipeline** | Pixellab proxy routes, asset DB tables, job polling, asset assignment to combatants | Backend (infra + app) |
| 16 | **GameSetup** | LLM scene-to-manifest prompt, setup orchestration route, interruptible movement protocol | Backend (app + infra) |

### Existing Flows Touched (light changes only)

| Flow | What changes |
|------|-------------|
| **EntityManagement** | New `AssetJob`, `CharacterSprite`, `TilesetAsset` Prisma models + repositories |
| **CombatOrchestration** | `facing` field on combatant; interruptible movement state machine (Phase 4) |

---

### Full Stack Requirements

```
packages/ui/                    NEW Angular 17+ standalone app
├── Angular 17+                 Framework (standalone components, signals, HttpClient)
├── Phaser 3                    Game renderer (WebGL, tile maps, sprite animation, tweens)
├── RxJS                        SSE stream handling, polling, reactive state
├── TypeScript 5.x              Strict, same tsconfig conventions as game-server
└── Karma/Jest/Vitest           Unit tests for services (renderer tests via Phaser headless)

packages/game-server/           EXISTING — additions only
├── Prisma                      3 new tables: AssetJob, CharacterSprite, TilesetAsset
├── Fastify routes              New /sessions/:id/assets/* and /sessions/:id/setup routes
├── Pixellab HTTP client        New infrastructure adapter (node-fetch to Pixellab v2)
└── LLM prompt template         New scene-to-manifest prompt in infrastructure/llm/
```

### Dev tooling additions to monorepo

```jsonc
// pnpm-workspace.yaml — add "packages/ui"
// turbo.json — add "ui#dev", "ui#build", "ui#test" tasks
// package.json scripts:
//   "pnpm -C packages/ui dev"        → ng serve with proxy to game-server
//   "pnpm -C packages/ui build"      → ng build --configuration production
//   "pnpm -C packages/ui test"       → ng test / vitest
```

---

### Agent Files to Create

#### 14a. `TacticalRenderer-sme.agent.md`

```yaml
---
name: TacticalRenderer-SME
description: >
  Use when researching or reviewing the Angular tactical combat UI: Phaser 3 scene
  architecture, tile rendering pipeline, sprite animation, oblique projection math,
  SSE state consumption, input handling, movement range preview. Subject matter expert
  for the frontend rendering system.
tools: [read, search, edit]
user-invocable: false
agents: []
---
```

**Domain scope:**
- `packages/ui/src/app/features/tactical-map/**`
- `packages/ui/src/app/core/game-server/**`
- `packages/ui/src/app/shared/**`

**Key contracts this SME owns:**
- Phaser Scene lifecycle (tile layer, token layer, overlay layer)
- Grid ↔ screen coordinate transform (oblique 2:1 projection)
- Y-sort painter's algorithm depth management
- `lastMovePath` → sprite animation pipeline
- SSE → TacticalView reactive state bridge
- Click → grid → POST action input pipeline
- Movement range flood-fill overlay

#### 14b. `TacticalRenderer-implementer.agent.md`

```yaml
---
name: TacticalRenderer-Implementer
description: >
  Use when implementing approved changes to the Angular tactical combat UI: Phaser 3 scene,
  tile rendering, sprite animation, oblique projection, SSE consumption, input handling.
  Executes plans validated by TacticalRenderer-SME.
tools: [read, edit, search, execute]
user-invocable: false
agents: []
---
```

**Scope:** same files as SME. Must not modify `packages/game-server/` files.

#### 15a. `AssetPipeline-sme.agent.md`

```yaml
---
name: AssetPipeline-SME
description: >
  Use when researching or reviewing the asset pipeline: Pixellab v2 proxy routes,
  asset DB tables (AssetJob, CharacterSprite, TilesetAsset), background job polling,
  asset-to-combatant assignment, terrain-to-tile mapping. Subject matter expert for
  generated art asset management.
tools: [read, search, edit]
user-invocable: false
agents: []
---
```

**Domain scope:**
- `packages/game-server/src/infrastructure/api/routes/sessions/session-assets.ts` (new)
- `packages/game-server/src/infrastructure/pixellab/` (new)
- `packages/game-server/src/application/services/entities/asset-service.ts` (new)
- `packages/game-server/src/application/repositories/asset-repository.ts` (new)
- `packages/game-server/prisma/schema.prisma` (AssetJob, CharacterSprite, TilesetAsset)
- `packages/ui/src/app/core/pixellab/**`
- `packages/ui/src/app/features/asset-studio/**`

#### 15b. `AssetPipeline-implementer.agent.md`

Same pattern — executes approved plans for asset pipeline changes.

#### 16a. `GameSetup-sme.agent.md`

```yaml
---
name: GameSetup-SME
description: >
  Use when researching or reviewing game setup orchestration: LLM scene-to-manifest
  prompt templates, setup API route, interruptible movement protocol, asset manifest
  schema, placeholder-to-real asset hot-swap. Subject matter expert for the session
  initialization pipeline.
tools: [read, search, edit]
user-invocable: false
agents: []
---
```

**Domain scope:**
- `packages/game-server/src/infrastructure/api/routes/sessions/session-setup.ts` (new)
- `packages/game-server/src/infrastructure/llm/scene-manifest-generator.ts` (new)
- `packages/game-server/src/application/services/entities/setup-service.ts` (new)
- `packages/ui/src/app/features/session-setup/**`
- Interruptible movement additions to `combat-service.ts` + tabletop routes

#### 16b. `GameSetup-implementer.agent.md`

Same pattern.

---

### Instruction Files to Create

#### `tactical-renderer.instructions.md`

```yaml
---
description: >
  Architecture and conventions for the TacticalRenderer flow: Angular + Phaser 3 scene,
  oblique tile rendering, sprite animation, Y-sort depth, SSE state bridge, input handling,
  movement range preview.
applyTo: "packages/ui/src/**"
---
```

**Key constraints to document:**
- Phaser 3 runs inside Angular via a host component — never modify Angular state from Phaser directly (use subjects/signals)
- All coordinate transforms go through a single `GridProjection` utility
- Client NEVER enforces rules — only renders backend state and sends user input
- Tiles render in Y-order for oblique occlusion
- SSE updates are the single source of truth for all visual state

#### `asset-pipeline.instructions.md`

```yaml
---
description: >
  Architecture and conventions for the AssetPipeline flow: Pixellab v2 proxy, asset DB tables,
  job polling, terrain-to-tile mapping, asset assignment to combatants, download URL management.
applyTo: >
  packages/game-server/src/infrastructure/pixellab/**,
  packages/game-server/src/infrastructure/api/routes/sessions/session-assets.ts,
  packages/game-server/src/application/services/entities/asset-service.ts,
  packages/game-server/src/application/repositories/asset-repository.ts,
  packages/ui/src/app/core/pixellab/**,
  packages/ui/src/app/features/asset-studio/**
---
```

**Key constraints:**
- Angular NEVER calls Pixellab directly — always proxy through game-server
- API key stored server-side only (env var `PIXELLAB_API_TOKEN`)
- All Pixellab calls are async (background jobs) — must poll for completion
- Assets are session-scoped but reusable via content-based dedup

#### `game-setup.instructions.md`

```yaml
---
description: >
  Architecture and conventions for the GameSetup flow: LLM scene decomposition, asset manifest
  schema, setup orchestration, interruptible movement protocol, placeholder hot-swap.
applyTo: >
  packages/game-server/src/infrastructure/api/routes/sessions/session-setup.ts,
  packages/game-server/src/infrastructure/llm/scene-manifest-generator.ts,
  packages/game-server/src/application/services/entities/setup-service.ts,
  packages/ui/src/app/features/session-setup/**
---
```

---

### Architecture Flow Docs to Create

One `.md` per new flow in `.github/SME-Architecture-Flows/`:

| File | Contents |
|------|----------|
| `TacticalRenderer.md` | Phaser scene lifecycle UML, SSE → render data flow, click → action user journey |
| `AssetPipeline.md` | Pixellab proxy sequence diagram, asset DB schema, job state machine |
| `GameSetup.md` | LLM → manifest → Pixellab jobs data flow, interruptible movement state machine |

---

### Updated Developer Agent (`developer.agent.md`)

**No changes needed.** DMDeveloper keeps its existing agent list — it does not get frontend agents. It stays scoped to `packages/game-server/` and `packages/player-cli/`.

When cross-cutting backend work is needed for the UI, UIArchitect dispatches directly to the backend SME/Implementer agents it has in its own `agents:` list.

---

### Updated `copilot-instructions.md` Additions

Add to the SME Domain Map table:

```
| 14 | TacticalRenderer | TacticalRenderer-SME | tactical-renderer.instructions.md | TacticalRenderer.md |
| 15 | AssetPipeline    | AssetPipeline-SME    | asset-pipeline.instructions.md    | AssetPipeline.md    |
| 16 | GameSetup        | GameSetup-SME        | game-setup.instructions.md        | GameSetup.md        |
```

Add to Repo Map:

```
packages/ui/                              # Angular 17+ tactical combat UI
  src/
    app/
      core/                               # Angular services (game-server HTTP, SSE, Pixellab proxy)
      features/
        tactical-map/                     # Phaser 3 oblique tile renderer + sprite animation
        asset-studio/                     # Pixellab asset generation UI
        session-setup/                    # LLM scene-to-manifest wizard
      shared/                             # Reusable UI components (job status, sprite preview)
```

---

### Testing Strategy per Flow

| Flow | Unit Tests | Integration | E2E |
|------|-----------|-------------|-----|
| **TacticalRenderer** | Vitest for services (coordinate transforms, SSE parsing); Phaser headless for renderer logic | Angular TestBed + mock GameServerService | Manual visual verification + Playwright screenshot tests |
| **AssetPipeline** | Vitest for Pixellab adapter (mock HTTP); in-memory repo for asset tables | `app.inject()` for asset routes with mock Pixellab responses | E2E scenario: create session → generate asset → poll → verify download URL |
| **GameSetup** | Vitest for manifest schema validation; mock LLM for prompt testing | `app.inject()` for setup route with mock LLM + mock Pixellab | E2E: full setup flow with mock LLM → verify assets queued |

---

### Files to Create Summary

| Type | Path | Count |
|------|------|-------|
| **Orchestrator** | `.github/agents/UIArchitect.agent.md` | **1** |
| Agent | `.github/agents/TacticalRenderer-{sme,implementer}.agent.md` | 2 |
| Agent | `.github/agents/AssetPipeline-{sme,implementer}.agent.md` | 2 |
| Agent | `.github/agents/GameSetup-{sme,implementer}.agent.md` | 2 |
| Instruction | `.github/instructions/tactical-renderer.instructions.md` | 1 |
| Instruction | `.github/instructions/asset-pipeline.instructions.md` | 1 |
| Instruction | `.github/instructions/game-setup.instructions.md` | 1 |
| Arch Flow | `.github/SME-Architecture-Flows/TacticalRenderer.md` | 1 |
| Arch Flow | `.github/SME-Architecture-Flows/AssetPipeline.md` | 1 |
| Arch Flow | `.github/SME-Architecture-Flows/GameSetup.md` | 1 |
| **Total new files** | | **13** |

Plus edits to:
- `.github/copilot-instructions.md` (add 3 rows to SME Domain Map + repo map + UIArchitect in agent list)
- DMDeveloper agent: **no changes** (stays backend-only)

---

### Two Orchestrators — Separated by Concern

#### Why Split

| Concern | DMDeveloper | UIArchitect (new) |
|---------|-------------|-------------------|
| Primary scope | game-server domain/app/infra + CLI | Angular app + Phaser + asset UI |
| Language focus | TypeScript backend (Fastify, Prisma, ESM) | TypeScript frontend (Angular, Phaser, RxJS) |
| Test commands | `pnpm -C packages/game-server test` | `pnpm -C packages/ui test` |
| Context window | D&D rules, DDD layers, combat state machines | Rendering, animation, UX, coordinate transforms |
| Cross-cutting | Owns backend API contracts | Consumes backend API contracts |

Keeping them separate means:
- DMDeveloper's context stays clean of Angular/Phaser concerns
- UIArchitect doesn't get polluted with domain rules it shouldn't know
- Cross-flow work (new API routes, DB tables) is dispatched by UIArchitect to backend agents — same pattern DMDeveloper uses for its own sub-agents

#### `UIArchitect.agent.md` — New Frontend Orchestrator

```yaml
---
name: UIArchitect
description: >
  Frontend orchestrator for the DungeonMaster Angular tactical combat UI.
  Owns Phaser 3 rendering, tile/sprite pipeline, SSE consumption, input handling,
  and Pixellab asset integration. Dispatches to TacticalRenderer, AssetPipeline,
  and GameSetup agents for domain work. Delegates backend changes to DMDeveloper
  backend agents (EntityManagement, CombatOrchestration, AIBehavior) when cross-cutting
  work is needed.
argument-hint: >
  A UI feature, rendering bug, or asset pipeline task — e.g., "add movement range
  preview overlay" or "integrate Pixellab character sprites"
tools: [vscode, execute, read, agent, edit, search, web, browser, todo]
user-invocable: true
agents:
  # Frontend agents (direct reports)
  - TacticalRenderer-SME
  - TacticalRenderer-Implementer
  - AssetPipeline-SME
  - AssetPipeline-Implementer
  - GameSetup-SME
  - GameSetup-Implementer
  # Backend agents (for cross-cutting work only)
  - EntityManagement-SME
  - EntityManagement-Implementer
  - CombatOrchestration-SME
  - CombatOrchestration-Implementer
  - AIBehavior-SME
  - AIBehavior-Implementer
  # Review
  - Challenger
  - VitestWriter
  - TestingAgent
---
```

**Core principles for UIArchitect:**
1. **Backend is source of truth** — never implement rules logic in the frontend
2. **Consume, don't duplicate** — TacticalView is the API contract; if the UI needs data the backend doesn't provide, raise it as a backend change and dispatch to the relevant backend agent
3. **Asset pipeline proxies through game-server** — never expose API keys to the browser
4. **Phaser owns rendering, Angular owns state** — bridge via RxJS subjects/signals, not direct Phaser calls from Angular components

#### DMDeveloper Changes

DMDeveloper does **NOT** get the frontend agents added. It stays focused:

```yaml
# DMDeveloper agents: list stays the same
# No TacticalRenderer/AssetPipeline/GameSetup agents added
# DMDeveloper only touches packages/game-server/ and packages/player-cli/
```

When UIArchitect needs backend work (new route, DB migration, API contract change), it dispatches to backend SME/Implementer agents it has access to — exactly the same pattern DMDeveloper uses internally.

---

### Agent Orchestration Per Phase

**Phase 1 (PoC):** UIArchitect only — no backend changes needed
```
UIArchitect → TacticalRenderer-SME (research Phaser + Angular setup)
            → TacticalRenderer-Implementer (scaffold app, render grid, wire SSE)
```

**Phase 2 (Pixellab):** UIArchitect orchestrates both frontend + backend agents
```
UIArchitect → AssetPipeline-SME (research Pixellab v2 API, DB schema design)
            → EntityManagement-SME (review Prisma model additions)     ← backend agent
            → TacticalRenderer-SME (review asset hot-swap in renderer)
            → Challenger (cross-flow review)
Implement:
            → AssetPipeline-Implementer (Pixellab adapter + proxy routes)
            → EntityManagement-Implementer (Prisma migration)          ← backend agent
            → TacticalRenderer-Implementer (asset loading in Phaser scene)
```

**Phase 3 (LLM Setup):** UIArchitect orchestrates, dispatches LLM work to backend
```
UIArchitect → GameSetup-SME (scene manifest schema + setup UX flow)
            → AIBehavior-SME (review LLM prompt template)              ← backend agent
            → AssetPipeline-SME (review batch job orchestration)
Implement:
            → GameSetup-Implementer (setup route + manifest frontend)
            → AIBehavior-Implementer (LLM scene prompt template)       ← backend agent
            → AssetPipeline-Implementer (batch Pixellab job firing)
```

**Phase 4 (Interruptible Movement):** Both orchestrators coordinate
```
UIArchitect → GameSetup-SME (interrupt protocol client-side design)
            → TacticalRenderer-SME (animation interrupt on SSE UX)
            → CombatOrchestration-SME (movement state machine)         ← backend agent
            → Challenger
Implement:
            → CombatOrchestration-Implementer (move/start, move/interrupt) ← backend agent
            → TacticalRenderer-Implementer (animation interrupt + collision detection)
```

**Cross-orchestrator protocol for Phase 4:**
UIArchitect defines the API contract (request/response shapes for `move/start` and `move/interrupt`).
DMDeveloper implements the backend state machine changes per that contract.
Neither orchestrator modifies the other's files directly.
