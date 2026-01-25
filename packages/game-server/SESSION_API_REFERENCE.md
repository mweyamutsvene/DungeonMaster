# Session API Reference

This document provides a comprehensive reference for all session-related API endpoints in the DungeonMaster game server. These endpoints manage game sessions, characters, combat encounters, and LLM-powered features.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Endpoints](#endpoints)
  - [Session Management](#session-management)
  - [Character Management](#character-management)
  - [Creature Management](#creature-management)
  - [Combat Core](#combat-core)
  - [Tactical View](#tactical-view)
  - [Tabletop Combat](#tabletop-combat)
  - [Programmatic Actions](#programmatic-actions)
  - [LLM Integration](#llm-integration)
  - [Event Streaming](#event-streaming)

---

## Overview

The session API is organized into focused route modules, each handling a specific domain of functionality:

| Module | Responsibility |
|--------|----------------|
| `session-crud` | Session creation and retrieval |
| `session-characters` | Character management (add, generate) |
| `session-creatures` | Monster and NPC management |
| `session-combat` | Core combat flow (start, next turn, state) |
| `session-tactical` | Tactical view and LLM-powered queries |
| `session-tabletop` | Tabletop combat with manual dice rolling |
| `session-actions` | Programmatic action execution |
| `session-llm` | LLM intent parsing and narrative |
| `session-events` | Real-time event streaming (SSE) |

---

## Architecture

### Services

The route modules delegate to these application services:

- **GameSessionService** - Session CRUD operations
- **CharacterService** - Character management
- **CombatService** - Core combat state machine
- **ActionService** - Programmatic action resolution
- **TacticalViewService** - Tactical combat views and LLM context
- **TabletopCombatService** - Tabletop combat flow with pending actions
- **AiTurnOrchestrator** - AI-controlled creature behavior

### LLM Services (Optional)

- **IIntentParser** - Natural language to structured commands
- **INarrativeGenerator** - Event-to-narrative text generation
- **ICharacterGenerator** - LLM-powered character sheet generation
- **IStoryGenerator** - Story framework generation

---

## Endpoints

### Session Management

#### POST /sessions

Create a new game session.

**Request Body:**
```json
{
  "storyFramework": { ... },  // Optional: pre-defined story framework
  "storySeed": 42             // Optional: seed for LLM story generation
}
```

**Response:**
```json
{
  "id": "session_abc123",
  "storyFramework": { ... },
  "createdAt": "2024-01-15T10:30:00Z"
}
```

**Behavior:**
- If `storyFramework` is not provided and a story generator is configured, generates one via LLM.
- Falls back to empty story framework if LLM generation fails.

---

#### GET /sessions/:id

Retrieve a session with all its participants.

**Response:**
```json
{
  "session": {
    "id": "session_abc123",
    "storyFramework": { ... }
  },
  "characters": [...],
  "monsters": [...]
}
```

---

### Character Management

#### POST /sessions/:id/characters

Add a character with a provided sheet.

**Request Body:**
```json
{
  "name": "Aragorn",
  "level": 5,
  "className": "Fighter",
  "sheet": {
    "abilityScores": { "str": 16, "dex": 14, "con": 15, "int": 10, "wis": 12, "cha": 13 },
    "armorClass": 18,
    "hitPoints": { "current": 45, "max": 45 },
    ...
  }
}
```

**Response:**
```json
{
  "id": "char_xyz789",
  "name": "Aragorn",
  "level": 5,
  "className": "Fighter",
  "sheet": { ... }
}
```

---

#### POST /sessions/:id/characters/generate

Generate a character sheet via LLM or use a provided sheet.

**Request Body:**
```json
{
  "name": "Gandalf",
  "className": "Wizard",
  "level": 10,      // Optional, defaults to 1
  "sheet": { ... }, // Optional: if provided, skips LLM generation
  "seed": 42        // Optional: for deterministic generation
}
```

**Response:** Same as POST /sessions/:id/characters

**Errors:**
- 400: No character sheet provided and no generator available

---

### Creature Management

#### POST /sessions/:id/monsters

Add a monster with a stat block.

**Request Body:**
```json
{
  "name": "Goblin",
  "id": "goblin_1",                    // Optional, auto-generated if omitted
  "monsterDefinitionId": "goblin",     // Optional, reference to definition
  "statBlock": {
    "armorClass": 15,
    "hitPoints": { "current": 7, "max": 7 },
    "speed": 30,
    "abilities": { ... },
    "actions": [ ... ]
  }
}
```

---

#### POST /sessions/:id/npcs

Add an NPC with a stat block.

**Request Body:**
```json
{
  "name": "Bartender Bob",
  "id": "npc_bob",           // Optional, auto-generated if omitted
  "faction": "party",        // Optional, defaults to "party"
  "aiControlled": true,      // Optional, defaults to true
  "statBlock": { ... }
}
```

---

### Combat Core

#### POST /sessions/:id/combat/start

Start a new combat encounter.

**Request Body:**
```json
{
  "combatants": [
    {
      "combatantType": "Character",
      "characterId": "char_xyz789",
      "hpCurrent": 45,
      "hpMax": 45,
      "initiative": null,       // Optional, rolled if null
      "conditions": [],         // Optional
      "resources": { ... }      // Optional
    },
    {
      "combatantType": "Monster",
      "monsterId": "goblin_1",
      "hpCurrent": 7,
      "hpMax": 7
    }
  ]
}
```

**Response:**
```json
{
  "encounterId": "enc_123",
  "combatants": [...],
  "round": 1,
  "turn": 1,
  "activeCombatantId": "combatant_abc"
}
```

---

#### POST /sessions/:id/combat/next

Advance to the next turn in the current encounter.

**Request Body:**
```json
{
  "encounterId": "enc_123"  // Optional if only one active encounter
}
```

**Response:**
```json
{
  "round": 1,
  "turn": 2,
  "activeCombatantId": "combatant_def",
  "previousCombatantId": "combatant_abc"
}
```

---

#### GET /sessions/:id/combat

Get the current encounter state.

**Query Parameters:**
- `encounterId` (optional): Specific encounter ID

**Response:**
```json
{
  "encounter": {
    "id": "enc_123",
    "round": 1,
    "turn": 1,
    "status": "active"
  },
  "combatants": [...],
  "activeCombatant": { ... }
}
```

---

#### GET /sessions/:id/combat/:encounterId/combatants

List all combatants in an encounter.

**Response:**
```json
[
  {
    "id": "combatant_abc",
    "combatantType": "Character",
    "characterId": "char_xyz789",
    "initiative": 18,
    "hpCurrent": 45,
    "hpMax": 45
  }
]
```

---

### Tactical View

#### GET /sessions/:id/combat/:encounterId/tactical

Get a rich tactical view of the combat.

**Response:**
```json
{
  "encounterId": "enc_123",
  "activeCombatantId": "combatant_abc",
  "combatants": [
    {
      "id": "combatant_abc",
      "name": "Aragorn",
      "combatantType": "Character",
      "hp": { "current": 45, "max": 45 },
      "position": { "x": 10, "y": 15 },
      "distanceFromActive": 0,
      "actionEconomy": {
        "actionAvailable": true,
        "bonusActionAvailable": true,
        "reactionAvailable": true,
        "movementRemainingFeet": 30
      },
      "resourcePools": [
        { "name": "Ki Points", "current": 5, "max": 5 }
      ],
      "movement": { "speed": 30, "dashed": false, "movementSpent": false },
      "turnFlags": {
        "actionSpent": false,
        "bonusActionUsed": false,
        "reactionUsed": false,
        "disengaged": false
      }
    }
  ],
  "map": null
}
```

---

#### POST /sessions/:id/combat/query

Ask the LLM tactical questions about combat.

**Request Body:**
```json
{
  "query": "How far is the goblin from me?",
  "actorId": "char_xyz789",
  "encounterId": "enc_123",
  "seed": 42  // Optional
}
```

**Response:**
```json
{
  "answer": "The goblin is 25 feet away from you.",
  "context": {
    "distances": [
      { "targetId": "goblin_1", "name": "Goblin", "distance": 25 }
    ]
  }
}
```

**Requires:** LLM intent parser

---

### Tabletop Combat

These endpoints implement tabletop-style combat with manual dice rolling. The flow is:
1. `initiate` → Returns roll request for initiative
2. `roll-result` → Process initiative roll, returns attack roll request
3. `roll-result` → Process attack roll, returns damage roll request (if hit)
4. `roll-result` → Process damage roll, complete action

#### POST /sessions/:id/combat/initiate

Start a tabletop combat flow.

**Request Body:**
```json
{
  "text": "I attack the goblin with my sword",
  "actorId": "char_xyz789"
}
```

**Response:**
```json
{
  "requiresPlayerInput": true,
  "type": "REQUEST_ROLL",
  "rollType": "initiative",
  "message": "Roll initiative: 1d20 + DEX modifier",
  "diceNeeded": "1d20"
}
```

**Requires:** LLM intent parser

---

#### POST /sessions/:id/combat/roll-result

Process a dice roll result.

**Request Body:**
```json
{
  "text": "15",  // The roll value
  "actorId": "char_xyz789"
}
```

**Response (varies by roll type):**

*Initiative Result:*
```json
{
  "rollType": "initiative",
  "rawRoll": 15,
  "modifier": 2,
  "total": 17,
  "combatStarted": true,
  "encounterId": "enc_123",
  "turnOrder": [...],
  "message": "Combat started. Roll order determined."
}
```

*Attack Result:*
```json
{
  "rollType": "attack",
  "rawRoll": 15,
  "modifier": 5,
  "total": 20,
  "targetAC": 15,
  "hit": true,
  "requiresPlayerInput": true,
  "type": "REQUEST_ROLL",
  "rollType": "damage",
  "diceNeeded": "1d8",
  "message": "Hit! Roll damage: 1d8 + 3"
}
```

*Damage Result:*
```json
{
  "rollType": "damage",
  "rawRoll": 6,
  "modifier": 3,
  "total": 9,
  "targetName": "Goblin",
  "hpBefore": 7,
  "hpAfter": 0,
  "actionComplete": true,
  "message": "Dealt 9 damage to Goblin (0 HP remaining)"
}
```

---

#### POST /sessions/:id/combat/action

Parse and execute a combat action.

**Request Body:**
```json
{
  "text": "I move to (15, 20)",
  "actorId": "char_xyz789",
  "encounterId": "enc_123"
}
```

**Response:**
```json
{
  "requiresPlayerInput": false,
  "actionComplete": true,
  "type": "MOVE",
  "movedTo": { "x": 15, "y": 20 },
  "movedFeet": 15,
  "opportunityAttacks": [],
  "message": "Moved 15 feet to (15, 20)"
}
```

---

#### POST /sessions/:id/combat/move/complete

Complete a move after reaction resolution.

**Request Body:**
```json
{
  "pendingActionId": "pending_abc123"
}
```

**Response:**
```json
{
  "completed": true,
  "finalPosition": { "x": 15, "y": 20 }
}
```

---

### Programmatic Actions

#### POST /sessions/:id/actions

Execute structured actions (non-tabletop interface).

**End Turn:**
```json
{
  "kind": "endTurn",
  "encounterId": "enc_123",
  "actor": { "type": "Character", "characterId": "char_xyz789" }
}
```

**Attack:**
```json
{
  "kind": "attack",
  "encounterId": "enc_123",
  "attacker": { "type": "Character", "characterId": "char_xyz789" },
  "target": { "type": "Monster", "monsterId": "goblin_1" },
  "seed": 42,
  "spec": { ... },
  "monsterAttackName": "Scimitar"
}
```

**Response:** Action result with damage dealt, HP changes, etc.

---

### LLM Integration

#### POST /sessions/:id/llm/intent

Parse natural language to a structured game command.

**Request Body:**
```json
{
  "text": "Aragorn attacks the goblin",
  "seed": 42,           // Optional
  "schemaHint": "..."   // Optional, override default schema
}
```

**Response:**
```json
{
  "command": {
    "kind": "attack",
    "attacker": { "type": "Character", "characterId": "char_xyz789" },
    "target": { "type": "Monster", "monsterId": "goblin_1" }
  }
}
```

**Requires:** LLM intent parser

---

#### POST /sessions/:id/llm/act

Parse intent and immediately execute the action.

**Request Body:** Same as `/llm/intent`

**Response:**
```json
{
  "command": { ... },
  "outcome": {
    "hit": true,
    "damage": 12,
    "targetHpBefore": 7,
    "targetHpAfter": 0
  }
}
```

**Requires:** LLM intent parser

---

#### POST /sessions/:id/llm/narrate

Generate narrative text from game events.

**Request Body:**
```json
{
  "events": [
    { "type": "ATTACK_HIT", "payload": { ... } },
    { "type": "DAMAGE_DEALT", "payload": { ... } }
  ],
  "seed": 42  // Optional
}
```

**Response:**
```json
{
  "narrative": "With a swift strike, Aragorn's blade found its mark, felling the goblin in a single blow."
}
```

**Requires:** LLM narrative generator

---

### Event Streaming

#### GET /sessions/:id/events

Server-Sent Events (SSE) stream for real-time game events.

**Query Parameters:**
- `limit` (optional): Number of backlog events to send (default: 50)

**Response:** SSE stream

```
: connected

event: COMBAT_STARTED
data: {"type":"COMBAT_STARTED","payload":{"encounterId":"enc_123"},"createdAt":"..."}

event: TURN_STARTED
data: {"type":"TURN_STARTED","payload":{"combatantId":"combatant_abc"},"createdAt":"..."}
```

**Event Types:**
- `COMBAT_STARTED` - Combat encounter began
- `TURN_STARTED` - New turn started
- `ATTACK_MADE` - Attack roll occurred
- `DAMAGE_DEALT` - Damage was applied
- `COMBATANT_DEFEATED` - Combatant reduced to 0 HP
- `COMBAT_ENDED` - Combat encounter completed

---

#### GET /sessions/:id/events-json

JSON endpoint for retrieving events (useful for testing).

**Query Parameters:**
- `limit` (optional): Maximum events to return (default: 50)

**Response:**
```json
[
  {
    "id": "event_123",
    "sessionId": "session_abc",
    "type": "COMBAT_STARTED",
    "payload": { ... },
    "createdAt": "2024-01-15T10:30:00Z"
  }
]
```

---

## Error Handling

All endpoints may return these error responses:

**404 Not Found:**
```json
{
  "error": "NotFoundError",
  "message": "Session not found"
}
```

**400 Validation Error:**
```json
{
  "error": "ValidationError",
  "message": "name is required"
}
```

**500 Internal Server Error:**
```json
{
  "error": "InternalServerError",
  "message": "Internal Server Error"
}
```

---

## Route Module Files

| File | Endpoints |
|------|-----------|
| [session-crud.ts](src/infrastructure/api/routes/sessions/session-crud.ts) | POST /sessions, GET /sessions/:id |
| [session-characters.ts](src/infrastructure/api/routes/sessions/session-characters.ts) | POST /sessions/:id/characters, POST /sessions/:id/characters/generate |
| [session-creatures.ts](src/infrastructure/api/routes/sessions/session-creatures.ts) | POST /sessions/:id/monsters, POST /sessions/:id/npcs |
| [session-combat.ts](src/infrastructure/api/routes/sessions/session-combat.ts) | POST /sessions/:id/combat/start, POST /sessions/:id/combat/next, GET /sessions/:id/combat, GET /sessions/:id/combat/:encounterId/combatants |
| [session-tactical.ts](src/infrastructure/api/routes/sessions/session-tactical.ts) | GET /sessions/:id/combat/:encounterId/tactical, POST /sessions/:id/combat/query |
| [session-tabletop.ts](src/infrastructure/api/routes/sessions/session-tabletop.ts) | POST /sessions/:id/combat/initiate, POST /sessions/:id/combat/roll-result, POST /sessions/:id/combat/action, POST /sessions/:id/combat/move/complete |
| [session-actions.ts](src/infrastructure/api/routes/sessions/session-actions.ts) | POST /sessions/:id/actions |
| [session-llm.ts](src/infrastructure/api/routes/sessions/session-llm.ts) | POST /sessions/:id/llm/intent, POST /sessions/:id/llm/act, POST /sessions/:id/llm/narrate |
| [session-events.ts](src/infrastructure/api/routes/sessions/session-events.ts) | GET /sessions/:id/events, GET /sessions/:id/events-json |
