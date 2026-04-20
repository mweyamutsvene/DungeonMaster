# Plan: Multiplayer Backend Prerequisites (CLI-Testable)
## Round: 1
## Status: DRAFT
## Affected Flows: EntityManagement, CombatOrchestration, ReactionSystem

## Objective
Add player identity, per-player SSE channels, and CORS to the game-server so a web client can connect to multiplayer combat sessions. Every feature is testable via the existing CLI + Vitest + E2E harness before any web client is built.

---

## Current State
- **No player concept** — sessions have characters but no mapping of "which human controls which character."
- **SSE is broadcast** — all events go to all listeners on a session. No filtering.
- **No CORS** — browser clients at a different origin will be blocked.
- **No auth** — all endpoints are open. Fine for LAN/local play, but we need at minimum a player token to identify SSE streams.

---

## Design Decisions

### Player Identity (Lightweight)
- A **Player** is a session-scoped connection: `{ id, sessionId, displayName, characterId, token, isGM, connectedAt }`.
- Players join via `POST /sessions/:id/players/join` with `{ displayName, characterId? }`. Server returns a `playerToken` (nanoid).
- The token is passed as a query param on SSE: `GET /sessions/:id/events?playerToken=xxx`.
- **No passwords, no OAuth.** This is a living-room game — tokens are ephemeral session codes.
- A player with `isGM: true` is the DM. First player to join (or the session creator) can claim GM.
- **GM can reassign characters** via `PATCH /sessions/:id/players/:playerId`.
- The `aiControlled` flag on characters already exists — unassigned characters remain AI-controlled.

### Per-Player SSE
- Events gain an `audience` field: `'all'` | `'player:<id>'` | `'gm'` | `'faction:<name>'`.
- The SSE broker filters: each subscriber has a `playerId` and `isGM` flag. Events with `audience: 'all'` go to everyone. Events with `audience: 'player:X'` go only to player X. Events with `audience: 'gm'` go only to GM subscribers.
- **New event types**: `YourTurn` (tells a specific player it's their character's turn), `ReactionPrompt` (tells a specific player they have a reaction choice), `PlayerJoined` / `PlayerLeft` (broadcast to all).
- Existing events remain `audience: 'all'` — combat narration, attacks, damage, etc. are public.

### CORS
- `@fastify/cors` plugin with configurable origin (env var `DM_CORS_ORIGIN`, default `*` for local dev).
- Applied globally in `buildApp()`.

### CLI Integration
- The CLI can optionally call `POST /players/join` to get a token, then pass it to SSE. Without a token, SSE continues to work as today (backward compatible).
- A new `--player` CLI flag sets display name; `--gm` flag claims GM role.
- The CLI `--scenario` mode skips player join (backward compatible for E2E harness).

---

## Changes

### Phase 1: Player Identity Model + API

#### 1.1 Domain: Player Entity
- [ ] **`packages/game-server/src/domain/entities/player.ts`** (new)
  - `Player` type: `{ id, sessionId, displayName, characterId: string | null, token: string, isGM: boolean, connectedAt: Date }`
  - Pure type, no logic. This is a session-scoped identity, not a persistent user.

#### 1.2 Application: Player Repository Interface
- [ ] **`packages/game-server/src/application/repositories/player-repository.ts`** (new)
  - `IPlayerRepository` interface:
    - `create(input: CreatePlayerInput): Promise<Player>`
    - `findByToken(sessionId: string, token: string): Promise<Player | null>`
    - `findBySessionId(sessionId: string): Promise<Player[]>`
    - `findByCharacterId(sessionId: string, characterId: string): Promise<Player | null>`
    - `update(id: string, data: Partial<Pick<Player, 'displayName' | 'characterId' | 'isGM'>>): Promise<Player>`
    - `remove(id: string): Promise<void>`
  - Export from `repositories/index.ts` barrel.

#### 1.3 Application: Player Service
- [ ] **`packages/game-server/src/application/services/entities/player-service.ts`** (new)
  - `PlayerService` class with:
    - `joinSession(sessionId: string, input: { displayName: string; characterId?: string; isGM?: boolean }): Promise<{ player: Player; token: string }>`
      - Validates session exists via `IGameSessionRepository`.
      - If `characterId` provided, validates it exists and isn't already claimed by another player.
      - Generates token via `nanoid()`.
      - Emits `PlayerJoined` event.
    - `leaveSession(sessionId: string, playerId: string): Promise<void>`
      - Removes player. Emits `PlayerLeft` event.
    - `getSessionPlayers(sessionId: string): Promise<Player[]>`
    - `getPlayerByToken(sessionId: string, token: string): Promise<Player | null>`
    - `updatePlayer(sessionId: string, playerId: string, data: { displayName?: string; characterId?: string; isGM?: boolean }): Promise<Player>`
      - Only GM can reassign other players' characters.
    - `resolvePlayerForCombatant(sessionId: string, combatantId: string, combatants: CombatantStateRecord[]): Promise<Player | null>`
      - Given a combatant (the active turn holder), find the player who controls that character. Used to emit `YourTurn` to the right player.

#### 1.4 Infrastructure: In-Memory Player Repository
- [ ] **`packages/game-server/src/infrastructure/testing/memory-repos.ts`** (edit)
  - Add `MemoryPlayerRepository` implementing `IPlayerRepository`.
  - In-memory Map<id, Player> with `findByToken` doing a linear scan.

#### 1.5 Infrastructure: Prisma Player Repository
- [ ] **`packages/game-server/prisma/schema.prisma`** (edit)
  - Add `SessionPlayer` model:
    ```prisma
    model SessionPlayer {
      id          String  @id
      sessionId   String
      displayName String
      characterId String?
      token       String
      isGM        Boolean @default(false)
      connectedAt DateTime @default(now())

      session   GameSession       @relation(fields: [sessionId], references: [id], onDelete: Cascade)
      character SessionCharacter? @relation(fields: [characterId], references: [id], onDelete: SetNull)

      @@unique([sessionId, token])
      @@index([sessionId])
      @@index([characterId])
    }
    ```
  - Add `players SessionPlayer[]` to `GameSession` model.
  - Add `player SessionPlayer?` to `SessionCharacter` model (optional back-ref).
  - Run `npx prisma migrate dev --name add-session-player`.
- [ ] **`packages/game-server/src/infrastructure/db/player-repository.ts`** (new)
  - `PrismaPlayerRepository` implementing `IPlayerRepository`.

#### 1.6 API: Player Routes
- [ ] **`packages/game-server/src/infrastructure/api/routes/sessions/session-players.ts`** (new)
  - `POST /sessions/:id/players/join` — Join session, return `{ player, token }`.
  - `GET /sessions/:id/players` — List players in session.
  - `PATCH /sessions/:id/players/:playerId` — Update player (GM-only for character reassignment).
  - `DELETE /sessions/:id/players/:playerId` — Leave session (player self-remove or GM kick).
- [ ] **`packages/game-server/src/infrastructure/api/routes/sessions/index.ts`** (edit)
  - Register `registerSessionPlayerRoutes`.
- [ ] **`packages/game-server/src/infrastructure/api/routes/sessions/types.ts`** (edit)
  - Add `playerService: PlayerService` to `SessionRouteDeps`.

#### 1.7 App Wiring
- [ ] **`packages/game-server/src/infrastructure/api/app.ts`** (edit)
  - Add `playerRepo` to `AppDeps`.
  - Instantiate `PlayerService`.
  - Pass to route deps.
- [ ] **`packages/game-server/src/application/types.ts`** (edit)
  - Add `SessionPlayerRecord` type to match Prisma model.

---

### Phase 2: Per-Player SSE Channels

#### 2.1 SSE Broker: Audience Filtering
- [ ] **`packages/game-server/src/infrastructure/api/realtime/sse-broker.ts`** (edit)
  - Change `SSEEvent` to include optional `audience?: string` field.
  - Change `subscribe()` signature to accept `{ sessionId, playerId?, isGM? }`.
  - `publish()` logic:
    - If event has no `audience` or `audience === 'all'` → send to all subscribers.
    - If `audience === 'player:<id>'` → send only to subscriber with matching `playerId`.
    - If `audience === 'gm'` → send only to subscribers with `isGM === true`.
    - If `audience === 'faction:<name>'` → deferred (not needed for Phase 1).
  - **Backward compatible**: subscribers without a playerId receive all events (existing CLI behavior).

#### 2.2 SSE Route: Player Token Authentication
- [ ] **`packages/game-server/src/infrastructure/api/routes/sessions/session-events.ts`** (edit)
  - Accept `playerToken` query param: `GET /sessions/:id/events?playerToken=xxx`.
  - If token provided, resolve player via `PlayerService.getPlayerByToken()`.
  - Pass `{ playerId, isGM }` to `sseBroker.subscribe()`.
  - If token not provided (backward compat), subscribe with no filtering (gets all events).

#### 2.3 Targeted Event Emission
- [ ] **`packages/game-server/src/application/services/combat/combat-service.ts`** (edit)
  - After advancing turn, emit `YourTurn` event with `audience: 'player:<id>'` using `PlayerService.resolvePlayerForCombatant()`.
  - If no player found (AI combatant), skip `YourTurn` emission.
- [ ] **`packages/game-server/src/infrastructure/api/routes/sessions/session-tabletop.ts`** (edit — future phase)
  - When a reaction prompt is created, emit `ReactionPrompt` with `audience: 'player:<id>'`.
  - Deferred: this requires knowing which player controls the reacting combatant.
- [ ] **`packages/game-server/src/infrastructure/db/publishing-event-repository.ts`** (edit)
  - Pass `audience` from event input through to SSE broker publish call.
  - Stored events don't need audience (it's a transient routing concern).

#### 2.4 New Event Types
- [ ] **`packages/game-server/src/application/repositories/event-repository.ts`** (edit)
  - Add `YourTurnPayload`, `ReactionPromptPayload`, `PlayerJoinedPayload`, `PlayerLeftPayload`.

---

### Phase 3: CORS

#### 3.1 Fastify CORS Plugin
- [ ] **`packages/game-server/package.json`** (edit)
  - Add `@fastify/cors` dependency.
- [ ] **`packages/game-server/src/infrastructure/api/app.ts`** (edit)
  - Register `@fastify/cors` with origin from `process.env.DM_CORS_ORIGIN ?? '*'`.
  - Apply before route registration.

---

### Phase 4: CLI Integration (Optional, Validates Everything)

#### 4.1 CLI Player Join
- [ ] **`packages/player-cli/src/game-client.ts`** (edit)
  - Add `joinSession(sessionId, input)` and `leaveSession(sessionId, playerId)` methods.
- [ ] **`packages/player-cli/src/event-stream.ts`** (edit)
  - Accept optional `playerToken` in constructor/connect, append to SSE URL.
- [ ] **`packages/player-cli/src/index.ts`** or REPL entry (edit)
  - Add `--player <name>` and `--gm` CLI flags.
  - If `--player` given, join session after creation, pass token to event stream.
  - Show "It's your turn!" banner when `YourTurn` event received.

---

### Phase 5: E2E Scenario Harness + Agent Test Player Multiplayer Support

The E2E test harness (`combat-e2e.ts` + `scenario-runner.ts`) and agent test player (`agent-setup.ts`) both need multiplayer-aware extensions so we can write deterministic test scenarios that exercise player join, per-player SSE, and turn ownership.

#### 5.1 Scenario Runner: New Action Types for Player Management
- [ ] **`packages/game-server/scripts/test-harness/scenario-runner.ts`** (edit)
  - Add new `ScenarioAction` union members:
    - **`JoinPlayerAction`**: `{ type: "joinPlayer", input: { displayName: string, characterName?: string, isGM?: boolean }, expect?: { token?: boolean, playerId?: boolean } }`
      - Calls `POST /sessions/:id/players/join`. Stores returned `playerId` and `token` in a `playerMap: Map<displayName, { id, token }>`.
      - If `characterName` provided, resolves it to a `characterId` from the existing `characterMap`.
    - **`LeavePlayerAction`**: `{ type: "leavePlayer", input: { displayName: string } }`
      - Calls `DELETE /sessions/:id/players/:playerId` using stored player info.
    - **`AssertPlayersAction`**: `{ type: "assertPlayers", expect: { count?: number, players?: Array<{ displayName: string, characterName?: string, isGM?: boolean }> } }`
      - Calls `GET /sessions/:id/players` and validates the player list.
    - **`UpdatePlayerAction`**: `{ type: "updatePlayer", input: { displayName: string, characterName?: string, isGM?: boolean }, expect?: { error?: boolean } }`
      - Calls `PATCH /sessions/:id/players/:playerId`.
    - **`AssertSSEEventAction`**: `{ type: "assertSSEEvent", input: { playerName: string, eventType: string, timeout?: number }, expect: { received: boolean } }`
      - Opens an SSE connection with the player's token, waits for a specific event type, asserts whether it was received.
      - Used to verify `YourTurn` routing: Player A gets `YourTurn`, Player B does not.
  - Add `playerMap` tracking alongside existing `characterMap` / `monsterIds`.

#### 5.2 Scenario Runner: Player-Scoped SSE Verification Helpers
- [ ] **`packages/game-server/scripts/test-harness/scenario-runner.ts`** (edit)
  - Add helper: `connectPlayerSSE(baseUrl, sessionId, playerToken): EventSource` — opens an SSE stream with the player's token and collects events into a buffer.
  - Add helper: `waitForPlayerEvent(buffer, eventType, timeoutMs): Promise<SSEEvent | null>` — waits for a targeted event or returns null on timeout.
  - Add helper: `assertNoEvent(buffer, eventType, waitMs): Promise<void>` — asserts a specific event does NOT arrive within a timeout (negative assertion for "Player B should not get YourTurn").

#### 5.3 Scenario Setup: Player Definitions
- [ ] **`packages/game-server/scripts/test-harness/scenario-runner.ts`** (edit)
  - Extend `ScenarioSetup` with optional `players` field:
    ```ts
    players?: Array<{
      displayName: string;
      /** Character name to claim (must match a character in `characters` or `character`) */
      characterName?: string;
      isGM?: boolean;
    }>;
    ```
  - During setup phase, after characters/monsters are created, auto-join players defined in `setup.players[]`. Store tokens in `playerMap`.
  - This allows scenarios to declare players declaratively without needing explicit `joinPlayer` actions.

#### 5.4 Combat E2E: Wire Player Infrastructure
- [ ] **`packages/game-server/scripts/test-harness/combat-e2e.ts`** (edit)
  - Pass `MemoryPlayerRepository` to `buildApp()` in the `repos` bundle (since it's a new AppDeps field).
  - Add `RunScenarioCallbacks.playerMap?` for scenarios that need to inspect player state after run.
  - Ensure `clearAllRepos()` also clears the player repo between scenarios.

#### 5.5 E2E Scenarios: Multiplayer Test Suite
- [ ] **`packages/game-server/scripts/test-harness/scenarios/multiplayer/player-join-basic.json`** (new)
  - **Setup**: 2 characters (Fighter, Rogue), 1 goblin.
  - **Players in setup**: `[{ displayName: "Tommy", characterName: "Thorin" }, { displayName: "Alex", characterName: "Shadow" }]`
  - **Actions**:
    1. `assertPlayers` — verify 2 players exist with correct character assignments.
    2. `initiate` (actor: "Thorin") — "I attack the goblin" → initiative roll.
    3. `rollResult` — submit initiative.
    4. `assertSSEEvent` — verify "Tommy" receives `YourTurn` (if Thorin goes first) OR "Alex" receives it (if Shadow goes first).
    5. Basic attack/damage flow.
  - Tests: player join during setup, character→player mapping, `YourTurn` event routing.

- [ ] **`packages/game-server/scripts/test-harness/scenarios/multiplayer/player-join-mid-session.json`** (new)
  - **Setup**: 1 character, 1 goblin, no players in setup (single-player start).
  - **Actions**:
    1. `initiate` → initiative (works without player, backward compat).
    2. `joinPlayer` — `{ displayName: "Tommy", characterName: "Thorin" }`.
    3. `assertPlayers` — 1 player.
    4. Continue combat flow, verify `YourTurn` now goes to Tommy.
  - Tests: late-join mid-combat, backward compatibility.

- [ ] **`packages/game-server/scripts/test-harness/scenarios/multiplayer/gm-reassign.json`** (new)
  - **Setup**: 2 characters, 1 goblin.
  - **Actions**:
    1. `joinPlayer` — `{ displayName: "DM Dave", isGM: true }` (no character).
    2. `joinPlayer` — `{ displayName: "Tommy", characterName: "Thorin" }`.
    3. `joinPlayer` — `{ displayName: "Alex" }` (no character yet).
    4. `updatePlayer` — GM reassigns Alex to "Shadow" (the second character).
    5. `assertPlayers` — verify assignments.
  - Tests: GM player, character reassignment, unclaimed characters.

- [ ] **`packages/game-server/scripts/test-harness/scenarios/multiplayer/player-leave.json`** (new)
  - **Setup**: 2 characters, 2 players, 1 goblin.
  - **Actions**:
    1. Start combat, submit initiative.
    2. `leavePlayer` — `{ displayName: "Alex" }`.
    3. `assertPlayers` — 1 player remaining.
    4. Continue combat — Alex's character becomes AI-controlled (no `YourTurn` emission).
  - Tests: player disconnect, graceful fallback to AI control.

#### 5.6 Agent Test Player: Multiplayer Scenario Support
- [ ] **`packages/player-cli/src/agent-setup.ts`** (edit)
  - Extend `ScenarioFile` type to support optional `players` array.
  - After session creation + character/monster creation, if `setup.players` exists:
    - Join each player via `POST /sessions/:id/players/join`.
    - Print `PLAYER_<NAME>=<id>` and `PLAYER_TOKEN_<NAME>=<token>` to stdout for each player.
  - This allows the Copilot agent test player to drive multiplayer scenarios by using the printed tokens.

- [ ] **`packages/player-cli/scenarios/party-multiplayer.json`** (new)
  - New agent scenario: 2-player party (Fighter + Rogue) vs 2 Goblins.
  - Includes `setup.players` array mapping each character to a player name.
  - The agent can test: player join, per-player SSE streams, turn notification routing, reaction prompt delivery.

- [ ] **`packages/player-cli/src/agent-control.ts`** (edit — if needed)
  - If the control port is used by agents, add `joinPlayer` / `leavePlayer` commands to the control interface so an agent can simulate player connection/disconnection during a test.

#### 5.7 Memory Repos: Player Support for E2E
- [ ] **`packages/game-server/src/infrastructure/testing/memory-repos.ts`** (edit)
  - Add `MemoryPlayerRepository` to `createInMemoryRepos()` return bundle.
  - Add `clearAllRepos()` support for player repo.
  - This is the same code from Phase 1.4 but wired into the E2E harness creation path.

---

## Cross-Flow Risk Checklist
- [x] Do changes in one flow break assumptions in another? — No. Player identity is additive. All existing flows work without a player token.
- [x] Does the pending action state machine still have valid transitions? — Yes, unchanged.
- [x] Is action economy preserved? — Yes, unchanged.
- [x] Do both player AND AI paths handle the change? — Yes. AI combatants simply have no player. `YourTurn` only emits for player-controlled combatants.
- [x] Are repo interfaces + memory-repos updated if entity shapes change? — Yes, Phase 1.4 adds `MemoryPlayerRepository`.
- [x] Is `app.ts` registration updated if adding executors? — N/A (no new executors).
- [x] Are D&D 5e 2024 rules correct? — N/A (infrastructure change, no rules impact).

## Risks
- **Token in query string** — SSE doesn't support custom headers from `EventSource`. Query param is standard practice. Tokens are ephemeral and session-scoped, not secrets.
- **Backward compatibility** — All changes are additive. Existing CLI/E2E harness works without player join. SSE without a token delivers all events (current behavior).
- **Prisma migration** — Adding a table is a safe migration. No data loss risk.

## Test Plan
<!-- Each item is a TEST CODE AUTHORSHIP task. A passing `pnpm test` does NOT check these off. -->

### Unit Tests (Vitest)
- [ ] `player-service.test.ts` — join session (happy path), join with invalid session (404), join with claimed character (400), leave session, list players, update player (GM reassign), resolve player for combatant
- [ ] `sse-broker.test.ts` — broadcast event reaches all subscribers, targeted event reaches only matching player, GM-only event reaches only GM subscriber, no-audience event reaches all (backward compat)
- [ ] `memory-player-repository.test.ts` — CRUD operations, findByToken, findByCharacterId

### Integration Tests (app.inject)
- [ ] `app.test.ts` additions — POST /players/join returns token, GET /players lists members, PATCH /players/:id reassigns character, DELETE /players/:id removes player
- [ ] SSE integration — connect with playerToken, verify targeted events arrive, verify broadcast events arrive

### E2E Scenarios (test-harness JSON)
- [ ] `scenarios/multiplayer/player-join-basic.json` — declarative 2-player setup, character claim, `YourTurn` event routing verification
- [ ] `scenarios/multiplayer/player-join-mid-session.json` — late join during combat, backward compat without players, then join + verify `YourTurn`
- [ ] `scenarios/multiplayer/gm-reassign.json` — GM joins without character, assigns another player to a character mid-session
- [ ] `scenarios/multiplayer/player-leave.json` — player disconnects mid-combat, character falls back to AI control

### Agent Test Player Scenarios (player-cli)
- [ ] `scenarios/party-multiplayer.json` — 2-player party scenario with `setup.players` array, agent can test per-player SSE and turn routing
- [ ] `agent-setup.ts` multiplayer support — prints `PLAYER_<NAME>` and `PLAYER_TOKEN_<NAME>` for each setup player, enabling agent HTTP-driven multiplayer testing

## SME Approval
- [ ] EntityManagement-SME (player model, repository, service)
- [ ] CombatOrchestration-SME (YourTurn emission on turn advance)
- [ ] ReactionSystem-SME (ReactionPrompt targeting — Phase 2 only)

---

## Implementation Order
```
Phase 1  →  Phase 3  →  Phase 2  →  Phase 5  →  Phase 4
(Player)    (CORS)      (SSE)       (E2E+Agent)  (CLI)
```

Phase 1 is foundational. Phase 3 (CORS) is trivial and can go immediately after. Phase 2 (SSE filtering) depends on Phase 1 for player tokens. Phase 5 (E2E + Agent) validates the backend multiplayer features deterministically and is a prerequisite for confidence in Phase 4. Phase 4 (CLI) validates the interactive experience end-to-end.

**Phase 5 dependency detail:**
- Phase 5.1–5.4 (scenario runner types + combat-e2e wiring) depends on Phase 1 being complete (player API exists).
- Phase 5.5 (E2E scenarios that test `YourTurn` routing) depends on Phase 2 being complete (per-player SSE).
- Phase 5.6 (agent-setup multiplayer) depends on Phase 1 only (just calls POST /players/join).
- Phase 5.7 (memory-repos) is done as part of Phase 1.4 and just wired into E2E in 5.4.

So the actual execution is:
```
Phase 1 → Phase 3 → Phase 5.6 (agent-setup) → Phase 2 → Phase 5.1-5.5 (scenario infra + scenarios) → Phase 4
```

## Deferred Items
- **Persistent user accounts** — not needed for LAN play. Add later if hosting online.
- **Faction-scoped SSE** (`audience: 'faction:party'`) — useful for party-only chat. Deferred to web client plan.
- **Reconnection / session resume** — player can re-join with same token. State is server-authoritative so reconnect just means a new SSE stream. No special handling needed now.
- **ReactionPrompt targeting** — listed in Phase 2.3 but marked as future. The reaction system already works via polling; targeted SSE is a UX improvement for the web client.
