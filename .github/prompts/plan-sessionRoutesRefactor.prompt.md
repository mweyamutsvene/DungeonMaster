# Plan: Comprehensive Session Routes Refactoring

The 2,432-line `packages/game-server/src/infrastructure/api/routes/sessions.ts` will be decomposed into focused route modules backed by new application services, following the established DDD patterns. A new `SESSION_API_REFERENCE.md` will document each endpoint's responsibility.

---

## Steps

### 1. Create `TabletopCombatService` in `application/services/tabletop-combat-service.ts`
- Own the pending-action state machine (INITIATIVE → ATTACK_ROLL → DAMAGE_ROLL → complete)
- Methods: `initiateAction(sessionId, text)`, `processRollResult(sessionId, roll)`, `parseCombatAction(sessionId, text)`, `completeMove(sessionId, input)`
- Encapsulate the ~1,100 lines of roll processing + action parsing logic currently inline
- Inject `ICombatRepository`, `PendingActionRepository`, `ICombatantResolver`, `IIntentParser`, `IEventRepository`

### 2. Create `TacticalViewService` in `application/services/tactical-view-service.ts`
- Methods: `getTacticalView(encounterId)`, `buildCombatQueryContext(encounterId, question)`
- Move resource pool derivation, action economy parsing, distance calculations (~160 lines)
- Move LLM combat context assembly (attack options, opportunity attack flags, ~300 lines)
- Pure domain logic stays in domain; this service orchestrates assembly

### 3. Create `ClassFeatureResolver` in `domain/entities/classes/class-feature-resolver.ts`
- Methods: `getMartialArtsDie(level)`, `getKiPoints(level)`, `hasFlurryOfBlows(sheet)`, `getUnarmedStrikeDamage(sheet)`
- Consolidate Monk-specific logic scattered across routes
- Extend for other class features as needed (Action Surge, Rage, etc.)

### 4. Split Route File into Focused Modules in `infrastructure/api/routes/sessions/`

Create a folder with:

| File | Endpoints | ~Lines |
|------|-----------|--------|
| `index.ts` | Barrel re-export, `registerSessionRoutes()` composer | 30 |
| `session-crud.ts` | `POST /sessions`, `GET /sessions/:id` | 80 |
| `session-characters.ts` | `POST .../characters`, `POST .../characters/generate` | 100 |
| `session-creatures.ts` | `POST .../monsters`, `POST .../npcs` | 80 |
| `session-combat.ts` | `POST .../combat/start`, `POST .../combat/next`, `GET .../combat/encounter`, `GET .../combatants` | 150 |
| `session-tactical.ts` | `GET .../combat/tactical`, `POST .../combat/query` | 100 |
| `session-tabletop.ts` | `POST .../tabletop/initiate`, `POST .../tabletop/roll-result`, `POST .../tabletop/action`, `POST .../tabletop/move/complete` | 120 |
| `session-actions.ts` | `POST .../actions/execute` | 80 |
| `session-llm.ts` | `POST .../parse`, `POST .../act`, `POST .../narrate` | 120 |
| `session-events.ts` | `GET .../events/stream` (SSE), `GET .../events` | 60 |

### 5. Extract Inline Helpers to Domain/Application Utilities
- Move `extractResources()`, `parseActionEconomy()` → `domain/combat/resource-utils.ts`
- Move `resolveAttackDie()`, `calculateReach()` → `domain/combat/attack-utils.ts`
- Move `deriveCombatantData()` → `TacticalViewService` or shared helper

### 6. Update `buildApp()` Wiring in `app.ts`
- Instantiate new services (`TabletopCombatService`, `TacticalViewService`)
- Update deps passed to route registration
- Export new service interfaces from `application/services/index.ts`

### 7. Create `SESSION_API_REFERENCE.md` in `packages/game-server/`

Document each endpoint group with:
- HTTP method + path
- Purpose / when to use
- Request body schema
- Response schema
- Error codes
- Which service handles the logic

---

## Further Considerations

### 1. Tabletop vs. Programmatic Combat?
The `/tabletop/*` endpoints serve a dice-rolling tabletop flow while `/actions/execute` is programmatic. Should these be clearly separated domains, or unified with a mode flag?

### 2. LLM Fallback Behavior?
Currently routes throw if LLM not configured. Should `TacticalViewService.buildCombatQueryContext()` return a degraded response instead, or keep the hard requirement?

### 3. Test Strategy?
Extract services first (unit-testable with mocks), then refactor routes (integration-testable with `app.inject()`). Want a phased approach or all-at-once?

---

## Current State Analysis (Reference)

### File Overview
- **File:** `packages/game-server/src/infrastructure/api/routes/sessions.ts`
- **Total lines:** 2,432 lines
- **Function:** `registerSessionRoutes()` – a single large function registering all session-related HTTP routes

### All Route Handlers (21 endpoints)

| HTTP Method | Route | Purpose |
|-------------|-------|---------|
| POST | `/sessions` | Create new game session (optionally with LLM story framework) |
| GET | `/sessions/:id` | Get session with characters, monsters, NPCs |
| POST | `/sessions/:id/parse` | Parse natural language → game command via LLM |
| POST | `/sessions/:id/act` | Parse intent + execute action via LLM |
| POST | `/sessions/:id/narrate` | Generate narrative from events via LLM |
| POST | `/sessions/:id/characters` | Add character to session |
| POST | `/sessions/:id/characters/generate` | Generate character via LLM |
| POST | `/sessions/:id/monsters` | Add monster to session |
| POST | `/sessions/:id/npcs` | Add NPC to session |
| POST | `/sessions/:id/combat/start` | Start combat encounter |
| POST | `/sessions/:id/combat/next` | Advance to next turn |
| GET | `/sessions/:id/combat/encounter` | Get current encounter state |
| GET | `/sessions/:id/combat/tactical` | Get tactical combat view with distances, action economy |
| POST | `/sessions/:id/combat/query` | LLM-powered tactical Q&A |
| GET | `/sessions/:id/combatants` | List combatants |
| POST | `/sessions/:id/tabletop/initiate` | Tabletop flow: initiate attack, request initiative roll |
| POST | `/sessions/:id/tabletop/roll-result` | Tabletop flow: process dice roll result |
| POST | `/sessions/:id/tabletop/action` | Tabletop flow: parse combat action (move, attack, bonus action) |
| POST | `/sessions/:id/tabletop/move/complete` | Complete move after reaction resolution |
| POST | `/sessions/:id/actions/execute` | Execute structured actions (endTurn, attack) |
| GET | `/sessions/:id/events/stream` | SSE stream for real-time events |
| GET | `/sessions/:id/events` | JSON endpoint for events (testing) |

### Concerns Currently Mixed Together

| Concern | Examples |
|---------|----------|
| **HTTP handling** | Request/response shaping, validation errors |
| **Input validation** | Inline type checks, ValidationError throws |
| **Entity lookup** | Direct repository calls scattered throughout |
| **Domain logic** | Monk martial arts die, ability modifiers, AC checks, reach calculation |
| **Game rules** | Attack resolution, damage application, action economy |
| **LLM orchestration** | Intent parsing, schema hint building, context assembly |
| **Event emission** | `sseBroker.emit()` calls inline |
| **State machine** | Pending action type transitions (INITIATIVE→ATTACK→DAMAGE) |
| **AI orchestration** | `monsterAI.takeTurn()` calls |

### Dependencies Currently Injected (18 items)

| Dependency | Type | Purpose |
|------------|------|---------|
| `sessions` | `GameSessionService` | Session CRUD |
| `characters` | `CharacterService` | Character management |
| `combat` | `CombatService` | Combat lifecycle |
| `actions` | `ActionService` | Action resolution |
| `twoPhaseActions` | `TwoPhaseActionService` | Movement with reactions |
| `pendingActions` | `PendingActionRepository` | Pending action storage |
| `monsterAI` | `MonsterAIService` | AI-controlled monster turns |
| `events` | `IEventRepository` | Event persistence |
| `combatRepo` | `ICombatRepository` | Combat persistence |
| `monsters` | `IMonsterRepository` | Monster storage |
| `npcs` | `INPCRepository` | NPC storage |
| `unitOfWork` | `PrismaUnitOfWork` | Transaction support |
| `storyGenerator` | `IStoryGenerator` | LLM story generation |
| `intentParser` | `IIntentParser` | LLM intent parsing |
| `narrativeGenerator` | `INarrativeGenerator` | LLM narrative generation |
| `characterGenerator` | `ICharacterGenerator` | LLM character generation |
| `createServicesForRepos` | function | Factory for transactional services |
