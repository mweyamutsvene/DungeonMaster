# Plan: New `packages/player-cli/` Text Client

**TL;DR**: Build a new `packages/player-cli/` package that implements an interactive text-based combat client by following the scenario-runner's proven API protocol. It connects to an external game-server, loads scenario JSONs from its own `scenarios/` folder, and replaces user input for scripted values. All LLM interaction goes through existing server endpoints (`/llm/intent`, `/combat/query`). No assertions or test harness logic — pure player-facing REPL. The old `packages/cli/` is left untouched.

## Decisions

- **External server only** — CLI always connects to a separately-running game-server (default `http://127.0.0.1:3001`)
- **Own scenarios folder** — `packages/player-cli/scenarios/` with setup-only JSONs (no scripted actions)
- **New package** — `packages/player-cli/`, old `packages/cli/` left untouched
- **Questions via server API** — local sheet lookups for hp/ac/stats, server's `/llm/intent` + `/combat/query` for tactical. CLI never touches LLM directly
- **`GameClient` abstraction** — reusable protocol layer that could later be shared with test harness
- **Event-driven AI turns** — SSE stream instead of polling for real-time combat experience

## 1. Package Scaffolding

- Create `packages/player-cli/package.json` — ESM, zero runtime deps, `tsx` for dev, same pattern as old CLI
- Create `packages/player-cli/tsconfig.json` — extends `../../tsconfig.base.json`
- Add to `pnpm-workspace.yaml` (already has `packages/*` glob, so should auto-discover)
- Add `start`, `dev`, `build`, `typecheck` scripts

## 2. Source Modules (8 files)

| File | Responsibility |
|------|---------------|
| `src/main.ts` | Entry point, arg parsing (`--server`, `--scenario`, `--verbose`, `--no-narration`), main menu (scenario select / quick encounter / exit) |
| `src/http-client.ts` | Thin `fetch` wrapper with timeout, verbose logging, error handling |
| `src/game-client.ts` | **Core API protocol layer** — encapsulates ALL server HTTP calls (session lifecycle, combat flow, reactions, state queries, LLM endpoints). Reusable "SDK". |
| `src/event-stream.ts` | **SSE client** — connects to `/sessions/:id/events`, parses text/event-stream protocol, provides `on(type, handler)` / `once(type)` / `waitFor(type, predicate, timeout)` |
| `src/combat-repl.ts` | Interactive combat REPL — event-driven state machine for player turns, dice rolls, reactions, AI turn display, question answering, victory/defeat |
| `src/display.ts` | Terminal formatting — ANSI colors, banners, tactical state, roll requests, narration, event rendering |
| `src/scenario-loader.ts` | Load scenario JSON from `scenarios/` (with subfolder support). `setupFromScenario()` orchestrates session/character/monster/NPC creation via `GameClient` |
| `src/types.ts` | Response types, scenario types (setup-only, no `actions[]`), CLI options |

## 3. `GameClient` — The Protocol Layer

Single class with typed methods for every server endpoint:

```
GameClient
  constructor(baseUrl, options)

  // Session lifecycle
  createSession(storyFramework?) → { id }
  addCharacter(sessionId, { name, level, className, sheet }) → { id, name, ... }
  addMonster(sessionId, { name, statBlock }) → { id, name, ... }
  addNpc(sessionId, { name, statBlock, faction, aiControlled }) → { id, name, ... }

  // Tabletop combat flow
  initiateCombat(sessionId, { text, actorId }) → ActionResponse
  submitRoll(sessionId, { text, actorId }) → ActionResponse
  submitAction(sessionId, { text, actorId, encounterId }) → ActionResponse
  completeMove(sessionId, { pendingActionId, roll?, rollType? }) → ActionResponse
  endTurn(sessionId, { encounterId, characterId }) → void
  rest(sessionId, { type }) → RestResponse

  // State queries
  getCombatState(sessionId, encounterId?) → EncounterState
  getTacticalView(sessionId, encounterId) → TacticalState
  getEvents(sessionId, { limit? }) → GameEvent[]

  // Reactions
  getReactions(encounterId) → PendingAction[]
  respondToReaction(encounterId, pendingActionId, { combatantId, opportunityId, choice }) → ReactionResponse

  // LLM (routed through server)
  parseIntent(sessionId, { text }) → IntentResult
  queryTactical(sessionId, { query, actorId, encounterId }) → QueryResponse

  // SSE
  connectEventStream(sessionId) → EventStream
```

## 4. `EventStream` — SSE Client

Persistent SSE connection to `GET /sessions/:id/events`:

- Connects once after session creation, stays open for session lifetime
- Parses `event: <type>\ndata: <json>\n\n` frames via `fetch` + `ReadableStream`
- Handles reconnection on disconnect (with backoff)
- Provides:
  - `on(type, handler)` — register persistent listener
  - `once(type)` → `Promise<event>` — wait for one event
  - `waitFor(type | type[], predicate?, timeoutMs?)` → `Promise<event>` — wait for matching event
  - `close()` — disconnect

### SSE Event Types (server emits 25 types)

| Category | Events |
|----------|--------|
| **Combat lifecycle** | `CombatStarted`, `CombatEnded`, `TurnAdvanced` |
| **Attack flow** | `AttackResolved`, `DamageApplied`, `OpportunityAttack` |
| **Movement** | `Move` |
| **Non-attack actions** | `ActionResolved` (Dodge/Dash/Disengage/Hide/Help/Shove/Grapple) |
| **Healing** | `HealingApplied` |
| **Death saves** | `DeathSave` |
| **Reactions** | `ReactionPrompt`, `ReactionResolved` |
| **Specific reactions** | `ShieldCast`, `DeflectAttacks`, `DeflectAttacksRedirect`, `Counterspell`, `AbsorbElements`, `HellishRebuke` |
| **Concentration** | `ConcentrationBroken`, `ConcentrationMaintained` |
| **AI** | `AiDecision` |
| **Narration** | `NarrativeText` |
| **Session** | `SessionCreated`, `CharacterAdded`, `RestCompleted` |

### Event-Driven vs. Polling Comparison

| Instead of... | Listen for... |
|---|---|
| Polling `GET /tactical` every 500ms to detect turn change | `TurnAdvanced` event → check if player's character |
| Polling `GET /reactions` to detect OA/Shield prompts | `ReactionPrompt` event → immediately prompt player |
| Polling for combat end | `CombatEnded` event → display victory/defeat |
| Fetching events-json to display AI actions | `AiDecision`, `AttackResolved`, `DamageApplied`, `Move`, `NarrativeText` stream in real-time |

## 5. `CombatREPL` — Event-Driven State Machine

```
IDLE ──(initiateCombat)──→ INITIATIVE_ROLL
  └─(submitRoll)──→ WAITING_FOR_TURN

WAITING_FOR_TURN:
  on TurnAdvanced:
    if player's turn → transition to PLAYER_TURN
    else → stay, display event stream
  on ReactionPrompt:
    if player's combatant → transition to REACTION_PROMPT
  on CombatEnded → transition to COMBAT_OVER
  on AttackResolved/DamageApplied/Move/NarrativeText/etc → display immediately

PLAYER_TURN:
  fetch tactical view once (for display)
  prompt for input → submitAction / endTurn
  on roll request → transition to ROLL_PROMPT
  on REACTION_CHECK → transition to MOVE_REACTION
  on actionComplete → stay in PLAYER_TURN (prompt again)
  on endTurn → transition to WAITING_FOR_TURN

ROLL_PROMPT:
  prompt for dice value → submitRoll
  loop until actionComplete/no more rolls → back to PLAYER_TURN

MOVE_REACTION (monster OA on player move):
  prompt use/decline for each opportunity
  respondToReaction → completeMove → back to PLAYER_TURN

REACTION_PROMPT (player reaction on monster action, e.g. Shield/OA):
  prompt use/decline
  respondToReaction
  if OA → enter roll sequence
  → back to WAITING_FOR_TURN

COMBAT_OVER:
  display result, close SSE stream
```

### How the REPL Uses SSE During AI Turns

```typescript
// After player ends turn:
this.eventStream.on("AttackResolved", (e) => displayAttack(e));
this.eventStream.on("DamageApplied", (e) => displayDamage(e));
this.eventStream.on("Move",          (e) => displayMove(e));
this.eventStream.on("NarrativeText", (e) => displayNarration(e));
this.eventStream.on("AiDecision",    (e) => displayAiDecision(e));
this.eventStream.on("DeathSave",     (e) => displayDeathSave(e));

// Wait for either player's turn or a reaction prompt
const event = await this.eventStream.waitFor(
  ["TurnAdvanced", "ReactionPrompt", "CombatEnded"],
  (e) => isPlayerTurn(e) || isPlayerReaction(e) || isCombatEnd(e)
);

if (event.type === "ReactionPrompt") → handleReactionPrompt(event)
if (event.type === "TurnAdvanced" && isPlayerTurn) → playerTurn()
if (event.type === "CombatEnded") → displayResult()
```

### Fallback

`GameClient` still provides `getTacticalView()` and `getEvents()` for pull-based state queries (e.g., displaying tactical view at turn start). SSE handles the push side; HTTP GETs handle the pull side. They complement each other.

## 6. Scenarios Folder

`packages/player-cli/scenarios/` with setup-only JSONs (no `actions[]`):

| Scenario | Description |
|----------|-------------|
| `solo-fighter.json` | Level 5 Fighter vs 2 Goblins |
| `solo-monk.json` | Level 5 Monk vs 2 Bandits |
| `party-dungeon.json` | Fighter + 2 NPC allies vs Hobgoblin + Goblins |
| `boss-fight.json` | Fighter vs Ogre |

Schema: `{ name, description, setup: { character, monsters[], npcs?[], aiConfig? } }` — same `ScenarioSetup` shape as test harness but without `actions[]`.

## 7. Display Module

Combines the best of both sources:

- From old CLI's `display.ts`: `printTacticalState()` (rich combat state rendering), `printRollRequest()`, `printPlayerTurnPrompt()`, victory/defeat banners
- From scenario-runner's `displayCombatEvents()`: event rendering for AI turns (AiDecision, AttackResolved, DamageApplied, Move, TurnAdvanced, NarrativeText)
- Consistent ANSI color scheme

## 8. Verification

1. `pnpm -C packages/player-cli typecheck` — compiles without errors
2. Start game server with mock LLM: `DM_MOCK_LLM=1 pnpm -C packages/game-server dev`
3. Run CLI: `pnpm -C packages/player-cli start --scenario solo-fighter`
4. Verify: initiative prompt → roll → player turn → action → roll sequence → AI turn events → victory
5. Test reaction flow: use opportunity-attack-style scenario to verify OA prompts work

## API Endpoint Reference (used by GameClient)

| Endpoint | Method | GameClient Method |
|----------|--------|-------------------|
| `/sessions` | POST | `createSession()` |
| `/sessions/:id/characters` | POST | `addCharacter()` |
| `/sessions/:id/monsters` | POST | `addMonster()` |
| `/sessions/:id/npcs` | POST | `addNpc()` |
| `/sessions/:id/combat/initiate` | POST | `initiateCombat()` |
| `/sessions/:id/combat/roll-result` | POST | `submitRoll()` |
| `/sessions/:id/combat/action` | POST | `submitAction()` |
| `/sessions/:id/combat/move/complete` | POST | `completeMove()` |
| `/sessions/:id/actions` | POST | `endTurn()` |
| `/sessions/:id/rest` | POST | `rest()` |
| `/sessions/:id/combat` | GET | `getCombatState()` |
| `/sessions/:id/combat/:eid/tactical` | GET | `getTacticalView()` |
| `/sessions/:id/events-json` | GET | `getEvents()` |
| `/sessions/:id/events` | GET (SSE) | `connectEventStream()` |
| `/encounters/:eid/reactions` | GET | `getReactions()` |
| `/encounters/:eid/reactions/:pid/respond` | POST | `respondToReaction()` |
| `/sessions/:id/llm/intent` | POST | `parseIntent()` |
| `/sessions/:id/combat/query` | POST | `queryTactical()` |
