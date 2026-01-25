# DungeonMaster API Reference

Complete reference for all HTTP endpoints exposed by the game-server. The CLI uses these endpoints to interact with the deterministic D&D 5e rules engine.

**Base URL:** `http://localhost:3001` (configurable via `DM_SERVER_URL`)

---

## Session Management

### Create Session
`POST /sessions`

Creates a new game session with optional LLM-generated story framework.

**Request:**
```json
{
  "storyFramework"?: object,  // Optional; LLM generates if omitted
  "storySeed"?: number        // Optional seed for story generation
}
```

**Response:**
```json
{
  "id": "string",
  "storyFramework": object,
  "createdAt": "ISO date",
  "updatedAt": "ISO date"
}
```

**CLI Usage:**
```typescript
const session = await fetch(`${baseUrl}/sessions`, {
  method: "POST",
  body: JSON.stringify({})
});
```

---

### Get Session Info
`GET /sessions/:id`

Retrieves session details including all characters, monsters, and NPCs.

**Request:** None (sessionId in URL)

**Response:**
```json
{
  "session": {
    "id": "string",
    "storyFramework": object,
    "createdAt": "ISO date",
    "updatedAt": "ISO date"
  },
  "characters": [
    {
      "id": "string",
      "sessionId": "string",
      "name": "string",
      "level": number,
      "className": "string | null",
      "sheet": object,
      "createdAt": "ISO date",
      "updatedAt": "ISO date"
    }
  ],
  "monsters": [
    {
      "id": "string",
      "sessionId": "string",
      "name": "string",
      "monsterDefinitionId": "string | null",
      "statBlock": object,
      "createdAt": "ISO date",
      "updatedAt": "ISO date"
    }
  ]
}
```

**CLI Usage:**
```typescript
const info = await fetch(`${baseUrl}/sessions/${sessionId}`);
```

---

## Character Management

### Create Character
`POST /sessions/:id/characters`

Creates a character with a manually-provided character sheet.

**Request:**
```json
{
  "name": "string",
  "level": number,
  "className": "string | null",
  "sheet": object  // Full character sheet with HP, AC, abilities, etc.
}
```

**Response:** Character record (see GET /sessions/:id)

---

### Generate Character (LLM)
`POST /sessions/:id/characters/generate`

Creates an optimized character using LLM character generation.

**Request:**
```json
{
  "name": "string",
  "className": "string",  // e.g., "fighter", "monk", "wizard"
  "level"?: number,       // Default: 1
  "seed"?: number         // Optional seed for generation
}
```

**Response:** Character record with LLM-generated optimized sheet

**CLI Usage:**
```typescript
const character = await fetch(`${baseUrl}/sessions/${sessionId}/characters/generate`, {
  method: "POST",
  body: JSON.stringify({
    name: "Thorin Ironfist",
    className: "fighter",
    level: 5
  })
});
```

---

## Monster Management

### Create Monster
`POST /sessions/:id/monsters`

Spawns a monster in the session with the provided stat block.

**Request:**
```json
{
  "name": "string",
  "statBlock": {
    "armorClass": number,
    "hp": number,
    "maxHp": number,
    "abilityScores": {
      "strength": number,
      "dexterity": number,
      "constitution": number,
      "intelligence": number,
      "wisdom": number,
      "charisma": number
    },
    "actions": [
      {
        "name": "string",
        "type": "weapon" | "spell" | "ability",
        "attackType": "melee" | "ranged",
        "attackBonus": number,
        "damage": { 
          "diceCount": number, 
          "diceSides": number, 
          "modifier": number 
        },
        "damageType": "string",
        "text"?: "string (description)"
      }
    ],
    "bonusActions"?: [...],
    "reactions"?: [...]
  },
  "monsterDefinitionId"?: "string | null",
  "id"?: "string"  // Optional custom ID
}
```

**Response:** Monster record

**CLI Usage:**
```typescript
const goblin = await fetch(`${baseUrl}/sessions/${sessionId}/monsters`, {
  method: "POST",
  body: JSON.stringify({
    name: "Goblin Warrior",
    statBlock: {
      armorClass: 15,
      hp: 7,
      maxHp: 7,
      abilityScores: {
        strength: 8,
        dexterity: 14,
        constitution: 10,
        intelligence: 10,
        wisdom: 8,
        charisma: 8
      },
      attacks: [
        {
          name: "Scimitar",
          kind: "melee",
          range: "melee",
          attackBonus: 4,
          damage: { diceCount: 1, diceSides: 6, modifier: 2 },
          damageType: "slashing"
        }
      ]
    }
  })
});
```

---

### Create NPC
`POST /sessions/:id/npcs`

Creates an NPC (can be ally or enemy, AI-controlled or player-controlled).

**Request:**
```json
{
  "name": "string",
  "statBlock": object,  // Same structure as monster
  "faction"?: "string",  // Default: "party"
  "aiControlled"?: boolean,  // Default: true
  "id"?: "string"
}
```

**Response:** NPC record

---

## Combat Flow (Tabletop 2-Phase System)

The combat system uses a **2-phase flow** where the CLI requests rolls from the player, and the server applies modifiers and resolves outcomes.

### Phase 1: Initiate Combat
`POST /sessions/:id/combat/initiate`

Starts combat with natural language action. Server requests initiative roll.

**Request:**
```json
{
  "text": "string",  // Natural language (e.g., "I attack the goblins")
  "actorId": "string"  // Character ID
}
```

**Response:**
```json
{
  "requiresPlayerInput": true,
  "type": "REQUEST_ROLL",
  "rollType": "initiative",
  "message": "Roll for initiative! (d20 + your DEX modifier)",
  "diceNeeded": "d20",
  "pendingAction": {
    "type": "INITIATIVE",
    "timestamp": "ISO date",
    "actorId": "string",
    "initiator": "string",
    "intendedTarget": "string",
    "intendedTargets": ["string"]
  }
}
```

**CLI Usage:**
```typescript
const initiateResp = await fetch(`${baseUrl}/sessions/${sessionId}/combat/initiate`, {
  method: "POST",
  body: JSON.stringify({
    text: "I attack the goblins",
    actorId: characterId
  })
});

if (initiateResp.requiresPlayerInput && initiateResp.rollType === "initiative") {
  const initRoll = await ask("Enter your d20 roll for initiative: ");
  // Submit roll to /combat/roll-result
}
```

---

### Phase 2: Submit Roll Result
`POST /sessions/:id/combat/roll-result`

Submits player's dice roll. Server applies modifiers and determines next step.

**Request:**
```json
{
  "text": "string",  // e.g., "I rolled 18"
  "actorId": "string"
}
```

**Response varies by pending action type:**

#### Initiative Roll Response
```json
{
  "rollType": "initiative",
  "rawRoll": number,
  "modifier": number,  // DEX modifier applied by server
  "total": number,
  "combatStarted": true,
  "encounterId": "string",
  "turnOrder": [
    { "actorId": "string", "actorName": "string", "initiative": number }
  ],
  "currentTurn": { "actorId": "string", "actorName": "string", "initiative": number },
  "message": "Combat started! Fighter's turn (Initiative: 18)."
}
```

#### Attack Roll Response (Miss)
```json
{
  "rollType": "attack",
  "rawRoll": number,
  "modifier": number,  // Attack bonus applied by server
  "total": number,
  "targetAC": number,
  "hit": false,
  "targetHpRemaining": number,
  "requiresPlayerInput": false,
  "actionComplete": true,
  "message": "15 + 6 = 21 vs AC 15. Miss!"
}
```

#### Attack Roll Response (Hit → Request Damage)
```json
{
  "rawRoll": number,
  "modifier": number,
  "total": number,
  "targetAC": number,
  "hit": true,
  "requiresPlayerInput": true,
  "type": "REQUEST_ROLL",
  "rollType": "damage",
  "diceNeeded": "1d8+3",
  "message": "18 + 6 = 24 vs AC 15. Hit! Roll 1d8+3 for damage."
}
```

#### Damage Roll Response
```json
{
  "rollType": "damage",
  "rawRoll": number,
  "modifier": number,  // Damage modifier applied by server
  "total": number,
  "totalDamage": number,
  "targetName": "string",
  "hpBefore": number,
  "hpAfter": number,
  "targetHpRemaining": number,
  "actionComplete": true,
  "requiresPlayerInput": false,
  "message": "7 + 3 = 10 damage to Goblin! HP: 12 → 2"
}
```

#### Flurry of Blows (Multi-Strike) Response
After first strike damage:
```json
{
  "rawRoll": number,
  "modifier": number,
  "total": number,
  "totalDamage": number,
  "targetName": "string",
  "hpBefore": number,
  "hpAfter": number,
  "targetHpRemaining": number,
  "actionComplete": false,  // More strikes pending
  "requiresPlayerInput": true,
  "type": "REQUEST_ROLL",
  "rollType": "attack",
  "diceNeeded": "d20",
  "message": "5 + 3 = 8 damage! Second strike: Roll a d20 for attack."
}
```

**CLI Usage:**
```typescript
let currentResp = initiateResp;

// Loop through roll sequence
while (currentResp.requiresPlayerInput && currentResp.type === "REQUEST_ROLL") {
  const roll = await ask(`Enter your ${currentResp.rollType} roll: `);
  
  currentResp = await fetch(`${baseUrl}/sessions/${sessionId}/combat/roll-result`, {
    method: "POST",
    body: JSON.stringify({
      text: `I rolled ${roll}`,
      actorId: characterId
    })
  });
}

console.log(currentResp.message); // Final result
```

---

### Mid-Combat Actions
`POST /sessions/:id/combat/action`

Declares a combat action (attack, move, bonus action, etc.) during active combat.

**Request:**
```json
{
  "text": "string",  // Natural language or coordinates
  "actorId": "string",
  "encounterId": "string"
}
```

**Response varies by action type:**

#### Attack Action → Requests Roll
```json
{
  "requiresPlayerInput": true,
  "type": "REQUEST_ROLL",
  "rollType": "attack",
  "message": "Roll a d20 for attack against Goblin Warrior",
  "diceNeeded": "d20",
  "advantage"?: boolean,
  "disadvantage"?: boolean,
  "pendingAction": object
}
```

#### Move Action → No Reactions
```json
{
  "requiresPlayerInput": false,
  "actionComplete": true,
  "type": "MOVE_COMPLETE",
  "movedTo": { "x": number, "y": number },
  "movedFeet": number,
  "opportunityAttacks": [],
  "message": "Moved to (20, 10) (15ft)."
}
```

#### Move Action → Reaction Check Required
```json
{
  "requiresPlayerInput": false,
  "actionComplete": false,
  "type": "REACTION_CHECK",
  "pendingActionId": "string",
  "opportunityAttacks": [
    {
      "combatantId": "string",
      "combatantName": "string",
      "canAttack": boolean,
      "opportunityId": "string"
    }
  ],
  "message": "Opportunity attacks possible. Resolve reactions, then complete the move."
}
```

#### Simple Actions (Dash/Dodge/Disengage)
```json
{
  "requiresPlayerInput": false,
  "actionComplete": true,
  "type": "SIMPLE_ACTION_COMPLETE",
  "action": "Dash" | "Dodge" | "Disengage",
  "message": "Dashed."
}
```

**Supported Text Patterns:**
- **Attacks:** "I attack the Goblin Warrior with my sword"
- **Movement:** "move to (20, 10)" or "move to 20, 10"
- **Simple Actions:** "I dash", "I dodge", "I disengage"
- **Bonus Actions:** "flurry of blows", "patient defense", "step of the wind"
- **Questions:** "which goblin is nearest?" (routes to tactical query)

**CLI Usage:**
```typescript
const action = await ask("Your action: ");

const actionResp = await fetch(`${baseUrl}/sessions/${sessionId}/combat/action`, {
  method: "POST",
  body: JSON.stringify({
    text: action,
    actorId: characterId,
    encounterId: encounterId
  })
});

if (actionResp.type === "REACTION_CHECK") {
  // Handle opportunity attacks
  await handleReactionCheck(actionResp);
} else if (actionResp.requiresPlayerInput) {
  // Handle roll sequence
  await handleRollSequence(actionResp);
}
```

---

## Combat State Queries

### Get Combat State
`GET /sessions/:id/combat?encounterId={encounterId}`

Returns current encounter state with all combatants.

**Query Params:** 
- `encounterId` (optional): Specific encounter ID

**Response:**
```json
{
  "encounter": {
    "id": "string",
    "status": "Pending" | "Active" | "Complete",
    "round": number,
    "turn": number
  },
  "combatants": [
    {
      "id": "string",
      "combatantType": "Character" | "Monster" | "NPC",
      "characterId"?: "string",
      "monsterId"?: "string",
      "npcId"?: "string",
      "initiative": number,
      "hpCurrent": number,
      "hpMax": number,
      "conditions": array,
      "resources": object
    }
  ],
  "activeCombatant": object  // Current turn combatant
}
```

**CLI Usage:**
```typescript
const state = await fetch(
  `${baseUrl}/sessions/${sessionId}/combat?encounterId=${encounterId}`
);

// Check victory/defeat
const allMonstersDead = state.combatants
  .filter(c => c.combatantType === "Monster")
  .every(c => c.hpCurrent <= 0);
```

---

### Get Tactical State
`GET /sessions/:id/combat/:encounterId/tactical`

Returns detailed tactical information including positions, action economy, and resources.

**Response:**
```json
{
  "encounterId": "string",
  "activeCombatantId": "string",
  "combatants": [
    {
      "id": "string",
      "name": "string",
      "combatantType": "Character" | "Monster" | "NPC",
      "hp": { "current": number, "max": number },
      "position": { "x": number, "y": number } | null,
      "distanceFromActive": number | null,
      "actionEconomy": {
        "actionAvailable": boolean,
        "bonusActionAvailable": boolean,
        "reactionAvailable": boolean,
        "movementRemainingFeet": number
      },
      "resourcePools": [
        { "name": "string", "current": number, "max": number }
      ],
      "movement": {
        "speed": number,
        "dashed": boolean,
        "movementSpent": boolean
      },
      "turnFlags": {
        "actionSpent": boolean,
        "bonusActionUsed": boolean,
        "reactionUsed": boolean,
        "disengaged": boolean
      }
    }
  ],
  "map": object | null
}
```

**CLI Usage:**
```typescript
const tactical = await fetch(
  `${baseUrl}/sessions/${sessionId}/combat/${encounterId}/tactical`
);

// Display combatants with positions and distances
for (const c of tactical.combatants) {
  console.log(`${c.name}: HP ${c.hp.current}/${c.hp.max} | ${c.position.x}, ${c.position.y} | ${c.distanceFromActive}ft`);
}
```

---

### Tactical Query (LLM)
`POST /sessions/:id/combat/query`

Asks a tactical question using LLM with combat context.

**Request:**
```json
{
  "query": "string",  // e.g., "which goblin is nearest?"
  "actorId": "string",
  "encounterId": "string",
  "seed"?: number
}
```

**Response:**
```json
{
  "answer": "string",  // LLM-generated tactical analysis
  "context": {
    "distances": [
      { "targetId": "string", "distance": number }
    ],
    "oaPrediction": {
      "destination": { "x": number, "y": number } | null,
      "movementRequiredFeet": number | null,
      "movementRemainingFeet": number,
      "oaRisks": [
        {
          "combatantId": "string",
          "combatantName": "string",
          "reach": number,
          "hasReaction": boolean
        }
      ]
    }
  }
}
```

**CLI Usage:**
```typescript
const query = await fetch(`${baseUrl}/sessions/${sessionId}/combat/query`, {
  method: "POST",
  body: JSON.stringify({
    query: "which goblin is nearest?",
    actorId: characterId,
    encounterId: encounterId
  })
});

console.log(query.answer);
// "The Goblin Warrior is closest at 10ft. The Goblin Archer is 25ft away."
```

---

## Opportunity Attacks (Reactions)

### Respond to Reaction
`POST /encounters/:encounterId/reactions/:pendingActionId/respond`

Player responds to an opportunity attack prompt.

**Request:**
```json
{
  "combatantId": "string",
  "opportunityId": "string",
  "choice": "use" | "decline"
}
```

**Response:**
```json
{
  "success": true,
  "pendingActionId": "string",
  "status": object,
  "message": "Reaction will be executed" | "Reaction declined"
}
```

**CLI Usage:**
```typescript
for (const opp of actionResp.opportunityAttacks) {
  const ans = await ask(`Allow ${opp.combatantName} Opportunity Attack? (y/n): `);
  const choice = ans === "y" ? "use" : "decline";
  
  await fetch(`${baseUrl}/encounters/${encounterId}/reactions/${pendingActionId}/respond`, {
    method: "POST",
    body: JSON.stringify({
      combatantId: opp.combatantId,
      opportunityId: opp.opportunityId,
      choice: choice
    })
  });
}
```

---

### Complete Move
`POST /sessions/:id/combat/move/complete`

Finalizes movement after all reactions are resolved.

**Request:**
```json
{
  "pendingActionId": "string"
}
```

**Response:**
```json
{
  "success": true,
  "actionComplete": true,
  "to": { "x": number, "y": number },
  "opportunityAttacks": [
    {
      "attackerId": "string",
      "attackerName": "string",
      "damage": number
    }
  ],
  "message": "Movement complete. Now at (20, 10)."
}
```

**CLI Usage:**
```typescript
const completed = await fetch(`${baseUrl}/sessions/${sessionId}/combat/move/complete`, {
  method: "POST",
  body: JSON.stringify({ pendingActionId: actionResp.pendingActionId })
});

console.log(completed.message);
if (completed.opportunityAttacks.length > 0) {
  for (const oa of completed.opportunityAttacks) {
    console.log(`  - ${oa.attackerName} hits for ${oa.damage} damage`);
  }
}
```

---

## Direct Action Execution (Deterministic)

Bypasses LLM for deterministic command execution.

### End Turn
`POST /sessions/:id/actions`

**Request:**
```json
{
  "kind": "endTurn",
  "encounterId"?: "string",
  "actor": {
    "type": "Character" | "Monster",
    "characterId"?: "string",
    "monsterId"?: "string"
  }
}
```

**Response:** Updated encounter state

**CLI Usage:**
```typescript
await fetch(`${baseUrl}/sessions/${sessionId}/actions`, {
  method: "POST",
  body: JSON.stringify({
    kind: "endTurn",
    encounterId: encounterId,
    actor: { type: "Character", characterId: characterId }
  })
});
```

---

### Execute Attack (Deterministic)
`POST /sessions/:id/actions`

**Request:**
```json
{
  "kind": "attack",
  "encounterId"?: "string",
  "attacker": { "type": "Character", "characterId": "string" },
  "target": { "type": "Monster", "monsterId": "string" },
  "seed"?: number,
  "spec"?: {
    "attackBonus": number,
    "damage": { "diceCount": number, "diceSides": number, "modifier": number }
  },
  "monsterAttackName"?: "string"
}
```

**Response:** Attack resolution with damage applied

---

## LLM Integration (Optional)

### Parse Intent
`POST /sessions/:id/llm/intent`

Parses natural language into structured command.

**Request:**
```json
{
  "text": "string",
  "seed"?: number,
  "schemaHint"?: "string"
}
```

**Response:**
```json
{
  "command": {
    "kind": "attack" | "move" | "endTurn" | ...,
    // ... command-specific fields
  }
}
```

---

### Parse and Execute
`POST /sessions/:id/llm/act`

Parses natural language and executes the action immediately.

**Request:**
```json
{
  "text": "string",
  "seed"?: number,
  "schemaHint"?: "string"
}
```

**Response:**
```json
{
  "command": object,
  "outcome": object  // Execution result
}
```

---

### Generate Narrative
`POST /sessions/:id/llm/narrate`

Generates narrative text from combat events.

**Request:**
```json
{
  "events": [
    {
      "id": "string",
      "type": "string",
      "payload": object,
      "createdAt": "ISO date"
    }
  ],
  "seed"?: number
}
```

**Response:**
```json
{
  "narrative": "string"
}
```

**CLI Usage:**
```typescript
const events = [
  {
    id: "evt123",
    type: "CliNarrationRequest",
    payload: {
      phase: "prompt_attack_roll",
      actorName: "Thorin",
      targetName: "Goblin",
      weapon: "sword"
    },
    createdAt: new Date().toISOString()
  }
];

const narResp = await fetch(`${baseUrl}/sessions/${sessionId}/llm/narrate`, {
  method: "POST",
  body: JSON.stringify({ events })
});

console.log(narResp.narrative); // "Thorin raises his blade..."
```

---

## Event Streaming

### Server-Sent Events (SSE)
`GET /sessions/:id/events?limit={limit}`

Real-time event stream for combat updates.

**Query Params:**
- `limit` (optional): Number of backlog events to send (default: 50)

**Response:** SSE stream
```
: connected

event: AttackResolved
data: {"type":"AttackResolved","payload":{...},"createdAt":"..."}

event: DamageApplied
data: {"type":"DamageApplied","payload":{...},"createdAt":"..."}

: ping
```

**CLI Note:** CLI currently polls combat state instead of using SSE.

---

### Events as JSON
`GET /sessions/:id/events-json?limit={limit}`

Returns recent events as JSON array (for testing/narrative).

**Query Params:**
- `limit` (optional): Number of events to return (default: 50)

**Response:**
```json
[
  {
    "id": "string",
    "type": "AttackResolved" | "DamageApplied" | "NarrativeText" | ...,
    "payload": object,
    "createdAt": "ISO date"
  }
]
```

**CLI Usage:**
```typescript
const events = await fetch(
  `${baseUrl}/sessions/${sessionId}/events-json?limit=10`
);

// Use events for narrative generation
const narResp = await fetch(`${baseUrl}/sessions/${sessionId}/llm/narrate`, {
  method: "POST",
  body: JSON.stringify({ events })
});
```

---

## Error Responses

All endpoints follow consistent error response format.

### 400 - Validation Error
```json
{
  "error": "ValidationError",
  "message": "text is required"
}
```

Common validation errors:
- Missing required fields
- Invalid field types
- LLM not configured (when required)

---

### 404 - Not Found
```json
{
  "error": "NotFoundError",
  "message": "Session not found: abc123"
}
```

Common causes:
- Invalid session/encounter/character ID
- Pending action not found
- Reaction opportunity not found

---

### 500 - Internal Server Error
```json
{
  "error": "InternalServerError",
  "message": "Internal Server Error"
}
```

Check server logs for details.

---

## Legacy Endpoints (Not Used by CLI)

These endpoints exist but are not used by the current CLI implementation.

### `POST /sessions/:id/combat/start`
Creates encounter with pre-rolled initiatives. CLI uses `/combat/initiate` instead.

### `POST /sessions/:id/combat/next`
Advances turn manually. CLI uses `/actions` with `kind: "endTurn"` and relies on server-side monster AI.

### `GET /encounters/:encounterId/reactions/:pendingActionId`
Gets pending action status. CLI tracks state locally.

### `GET /encounters/:encounterId/reactions`
Lists all pending reactions for an encounter. CLI handles reactions during move flow.

---

## Common Workflows

### Complete Attack Sequence
```typescript
// 1. Declare attack
const actionResp = await fetch(`${baseUrl}/sessions/${sessionId}/combat/action`, {
  method: "POST",
  body: JSON.stringify({
    text: "I attack the Goblin Warrior with my sword",
    actorId: characterId,
    encounterId: encounterId
  })
});

// 2. Roll attack
const attackRoll = await ask("Roll d20 for attack: ");
const attackResp = await fetch(`${baseUrl}/sessions/${sessionId}/combat/roll-result`, {
  method: "POST",
  body: JSON.stringify({
    text: `I rolled ${attackRoll}`,
    actorId: characterId
  })
});

// 3. If hit, roll damage
if (attackResp.hit) {
  const damageRoll = await ask(`Roll ${attackResp.diceNeeded} for damage: `);
  const damageResp = await fetch(`${baseUrl}/sessions/${sessionId}/combat/roll-result`, {
    method: "POST",
    body: JSON.stringify({
      text: `I rolled ${damageRoll}`,
      actorId: characterId
    })
  });
  
  console.log(damageResp.message); // "7 + 3 = 10 damage to Goblin! HP: 12 → 2"
}
```

---

### Complete Movement with OA
```typescript
// 1. Declare movement
const moveResp = await fetch(`${baseUrl}/sessions/${sessionId}/combat/action`, {
  method: "POST",
  body: JSON.stringify({
    text: "move to (25, 15)",
    actorId: characterId,
    encounterId: encounterId
  })
});

// 2. Handle reactions if needed
if (moveResp.type === "REACTION_CHECK") {
  for (const opp of moveResp.opportunityAttacks) {
    if (opp.canAttack) {
      const choice = await ask(`Allow ${opp.combatantName} OA? (y/n): `);
      await fetch(`${baseUrl}/encounters/${encounterId}/reactions/${moveResp.pendingActionId}/respond`, {
        method: "POST",
        body: JSON.stringify({
          combatantId: opp.combatantId,
          opportunityId: opp.opportunityId,
          choice: choice === "y" ? "use" : "decline"
        })
      });
    }
  }
  
  // 3. Complete movement
  const completed = await fetch(`${baseUrl}/sessions/${sessionId}/combat/move/complete`, {
    method: "POST",
    body: JSON.stringify({ pendingActionId: moveResp.pendingActionId })
  });
  
  console.log(completed.message);
}
```

---

### Quick Encounter Setup
```typescript
// 1. Create session
const session = await fetch(`${baseUrl}/sessions`, { method: "POST" });

// 2. Generate character
const character = await fetch(`${baseUrl}/sessions/${session.id}/characters/generate`, {
  method: "POST",
  body: JSON.stringify({ name: "Thorin", className: "fighter", level: 5 })
});

// 3. Spawn monsters
const goblin1 = await fetch(`${baseUrl}/sessions/${session.id}/monsters`, {
  method: "POST",
  body: JSON.stringify({ name: "Goblin 1", statBlock: goblinStatBlock })
});

const goblin2 = await fetch(`${baseUrl}/sessions/${session.id}/monsters`, {
  method: "POST",
  body: JSON.stringify({ name: "Goblin 2", statBlock: goblinStatBlock })
});

// 4. Start combat
const initiate = await fetch(`${baseUrl}/sessions/${session.id}/combat/initiate`, {
  method: "POST",
  body: JSON.stringify({ text: "I attack", actorId: character.id })
});

// Combat ready!
```

---

## Configuration

### Environment Variables

Server reads these environment variables (set in `.env` or shell):

- `DM_OLLAMA_MODEL`: LLM model name (e.g., `llama3.1:8b`)
- `DM_OLLAMA_BASE_URL`: Ollama API URL (default: `http://localhost:11434`)
- `DATABASE_URL`: SQLite database path (default: `file:./dev.db`)
- `DM_DEBUG_LOGS`: Enable debug logging (`1`, `true`, or `yes`)

### LLM Configuration

LLM features are **optional**. If `DM_OLLAMA_MODEL` is not set:
- `/llm/*` endpoints return 400 with "LLM not configured"
- Character generation requires manual sheet
- Combat actions require deterministic commands or coordinates
- Tactical queries fail gracefully

---

## Notes

1. **Polling vs Streaming**: CLI polls `/combat` state; SSE is available but unused.
2. **Monster AI**: Runs automatically after player ends turn (async, no feedback).
3. **Session Persistence**: Sessions persist in SQLite; no resumption endpoints yet.
4. **Position Auto-Assignment**: Combat encounters auto-create 100x100ft grid with starting positions.
5. **Resource Tracking**: Stored as JSON blob in `CombatantState.resources`; no schema validation.
6. **Pending Actions**: Stored in encounter during tabletop flow; lost on server crash.
