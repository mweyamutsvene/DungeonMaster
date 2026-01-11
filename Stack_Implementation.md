# LLM Tabletop DM – Tech Stack, Prisma DB Schema, and Angular Implementation Notes

> **New Canvas** focused on concrete engineering choices: stack, DB, APIs, module boundaries, and phase-based implementation.

---

## 1) Stack Overview (Phased, Single-Dev Friendly)

### Core Platform

* **Language:** TypeScript end-to-end
* **Runtime:** Node.js (backend)
* **Package Manager:** pnpm
* **Monorepo:** Turborepo (recommended) or Nx

### Backend

* **Framework:** Fastify (lean + fast) *(alt: Express if preferred)*
* **API:** REST for Phase 1; add WebSockets/SSE for real-time updates
* **Validation:** AJV (JSON schema validation)
* **Auth:** None for MVP (local/LAN); Phase 2+: optional session codes
* **Observability:** pino logs + simple request tracing

### Frontend (Angular)

* **Framework:** Angular (Standalone APIs)
* **Reactivity:** Signals + RxJS
* **UI:** Tailwind + (optional) Angular Material or Headless UI patterns
* **State:** Signals store pattern (or NgRx later if needed)
* **Data fetching:** Angular HttpClient + typed API client
* **Real-time:** RxJS wrappers for SSE/WS

### Database (Phase 1–3)

* **SQLite** for MVP (local dev + single machine)
* **ORM:** **Prisma**
* **Migrations:** Prisma migrate

### LLM / Media Providers (Swappable)

* **Interfaces:** LLMProvider, STTProvider, TTSProvider, ImageProvider
* **Local MVP:**

  * LLM: Ollama / llama.cpp server
  * STT: whisper.cpp
  * TTS: Piper
  * Images: local SDXL/Flux via ComfyUI or Automatic1111 API
* **OpenAI swap later:**

  * LLM: OpenAI Responses API
  * STT/TTS: OpenAI audio endpoints
  * Image: OpenAI image generation

---

## 2) High-Level Modules

### Backend Modules (packages/server)

* `orchestrator/` – propose → validate → revise → resolve state machine
* `prompts/` – prompt templates A/B/C + prompt builder utilities
* `schemas/` – AJV JSON schema (DMEnvelopeV3 etc)
* `state/` – world state store + patch application + diffing
* `validation/` – cost/action/resource validators
* `providers/` – LLM/STT/TTS/Image provider interfaces + implementations
* `routes/` – HTTP endpoints
* `realtime/` – WS/SSE event broadcasting

### Frontend Modules (packages/web)

* `src/app/` – routes + shells
* `src/app/pages/session/` – main play screen
* `src/app/components/` – input, DM output, session HUD, combat HUD
* `src/app/state/` – signals stores (session, ui, audio)
* `src/app/api/` – typed client for backend endpoints
* `src/app/realtime/` – SSE/WS services + RxJS streams

---

## 3) Phase-Based Feature Breakdown

### Phase 1 (Text-only, Theater-of-Mind)

* UI: single text input for actions/rolls + DM output pane
* Backend: LLM propose/validate/revise/resolve loop
* State: general `location_tag` only (no grid)
* Realtime: SSE first (simple) for multi-player sync

### Phase 2 (STT/TTS)

* UI: push-to-talk button + audio playback
* Backend: STT/TTS providers + streaming narration events
* No change to orchestrator; voice input becomes text

### Phase 3 (Map + Grid)

* UI: map viewer + projector mode
* Backend: ImageProvider + scene spec storage
* State: `pos {x,y}` on grid + object/trap coordinates
* Prompt snapshot: includes positions and terrain

---

## 4) Backend API Design

### REST Endpoints (Phase 1)

* `POST /sessions` → create session
* `GET /sessions/:id` → get full session snapshot
* `POST /sessions/:id/join` → join session (player)
* `POST /sessions/:id/input` → submit player text (action or roll)
* `POST /sessions/:id/choose` → choose an alternative option
* `POST /sessions/:id/roll` → submit roll(s) explicitly (optional)

### Realtime (SSE first; WS later)

* `GET /sessions/:id/events` (SSE)
* Events:

  * `dm_narration`
  * `roll_request`
  * `validation_reject`
  * `state_update`
  * `turn_advance`

---

## 5) Database Schema (SQLite + Prisma)

> **Principle:** Store canonical state as JSON for flexibility, plus relational columns for navigation.

### Prisma models (conceptual)

#### `Session`

* id (string)
* phase (string)
* rulesetMode (string)
* rulesetNotes (string?)
* storyOutline (Json)
* storySummary (string)
* sceneState (Json)
* combatState (Json?)
* createdAt / updatedAt

#### `Player`

* id
* sessionId (fk)
* displayName
* createdAt

#### `Character`

* id
* sessionId (fk)
* playerId (fk?)
* name
* classLevel
* sheet (Json)
* ledger (Json)
* location (Json)
* createdAt / updatedAt

#### `Entity` (NPC/Monster/Companion)

* id
* sessionId (fk)
* type
* name?
* ledger (Json)
* location (Json)
* createdAt / updatedAt

#### `Turn`

* id
* sessionId (fk)
* turnIndex (int)
* actorId (string)
* inputText (string)
* llmProposal (Json)
* validation (Json)
* llmRevision (Json?)
* rolls (Json?)
* llmResolution (Json?)
* appliedPatches (Json?)
* createdAt

#### `Precedent`

* id
* sessionId (fk)
* title
* summary
* tags (Json)
* createdAt

#### `DiceRoll`

* id
* sessionId (fk)
* turnId (fk)
* rollId (string)
* who (string)
* actorId?
* resultTotal (int)
* detail (Json)
* provenance (string) // physical_typed | digital
* createdAt

#### `MediaAsset` (Phase 2–3)

* id
* sessionId (fk)
* kind (string) // tts_audio | map_image
* uri (string)
* meta (Json)
* createdAt

---

## 6) World State JSON (Canonical Structure)

### SessionState (stored in `sceneState` + `combatState`)

* `world`

  * `objectives[]`
  * `facts[]` (traps/hazards/interactables)
* `scene`

  * Phase 1: `locations: ["campfire", "treeline", "wagon"]`
  * Phase 3: `grid { cell_ft, width, height }`, `terrain[]`
* `combat` (when active)

  * `round`
  * `initiative[]`
  * `active_actor_id`
  * per-actor `turn_flags` (action/bonus/reaction/movement)

---

## 7) Frontend Implementation Stack (Angular)

### UI Pages

* `/` landing
* `/session/new`
* `/session/:id` main play screen

### Main Play Screen Layout (Phase 1)

* Left: DM Output Pane (scrolling)
* Right: Session HUD

  * active actor
  * HP/resources summary
  * last roll request
  * player list
* Bottom: Single text input + Send

### Angular Patterns

* **Services**

  * `SessionApiService` – REST calls
  * `SessionEventsService` – SSE connection, exposes RxJS observables
  * `AudioService` – Phase 2 hook for TTS playback
* **State (Signals)**

  * `sessionSignal` + derived signals for HUD
  * `dmLogSignal` for narration stream
* **Components**

  * `DmOutputComponent`
  * `PlayerInputComponent`
  * `SessionHudComponent`
  * `RollRequestComponent`

---

## 8) Orchestrator & Prompting (Backend)

### Orchestrator States

* `AWAITING_INPUT`
* `PROPOSING_PLAN` (Template A)
* `VALIDATING_PLAN`
* `PLAN_REJECTED` (Template B)
* `AWAITING_ROLLS`
* `RESOLVING_OUTCOME` (Template C)
* `APPLYING_PATCHES`
* `ADVANCING_TURN`

### Prompt Templates (Files)

* `prompts/templateA_proposePlan.ts`
* `prompts/templateB_validationFailed.ts`
* `prompts/templateC_resolveOutcome.ts`

---

## 9) Provider Interfaces (Swappable)

### LLMProvider

* `proposePlan(ctx) -> DMEnvelopeV3`
* `reviseAfterValidation(ctx) -> DMEnvelopeV3`
* `resolveOutcome(ctx) -> DMEnvelopeV3`

### STTProvider (Phase 2)

* `transcribe(audio) -> text`

### TTSProvider (Phase 2)

* `speak(text) -> audioUri | stream`

### ImageProvider (Phase 3)

* `generateMap(sceneSpec) -> imageUri`

---

## 10) Deployment & Local Network Setup

### Local Dev

* Backend on desktop “brain”
* Angular frontend served locally (or packaged)

### Raspberry Pi target

* Pi runs Chromium in kiosk mode
* Loads `http://<desktop-ip>:<port>/session/<id>`
* Uses SSE/WS for real-time updates
* Phase 2+: Pi can act as PTT mic + speaker if desired

---

## 11) Next Build Tasks (Phase 1)

1. Repo scaffold (turborepo) with `web/` (Angular) and `server/` (Fastify)
2. Implement SQLite + Prisma migrations
3. Implement DMEnvelopeV3 AJV schema validation
4. Build prompt templates A/B/C
5. Implement orchestrator loop and REST endpoints
6. Build main play screen UI + SSE updates
7. Add multi-player join flow

---

## 12) Decisions to Lock (MVP Defaults)

* Realtime: **SSE first** (simpler) → WS later
* DB: **SQLite + Prisma + JSON blobs**
* Rules strictness: **RAI default**
* Rolls: typed totals only in Phase 1
* Locations: general tags only in Phase 1
