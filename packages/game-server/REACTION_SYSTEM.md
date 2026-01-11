# Two-Phase Reaction System Architecture

## Overview

The reaction system allows player-controlled combatants to decide whether to use reactions (Opportunity Attacks, Counterspell, Shield, etc.) when triggered by enemy actions. This provides tabletop-like agency while supporting async gameplay.

## Core Pattern

Actions that can trigger reactions are split into **two phases**:

### Phase 1: Initiate
- **Purpose:** Detect reaction opportunities, create pending action
- **Returns:** Immediately to client with list of opportunities
- **Side effects:** Emits `ReactionPrompt` events via SSE

### Phase 2: Complete
- **Purpose:** Execute action after all reactions are resolved
- **Requires:** All reaction prompts answered (or expired)
- **Side effects:** Executes reactions, applies action, emits result events

## Domain Model

### `PendingAction`
Tracks an action awaiting reaction resolution:
```typescript
interface PendingAction {
  id: string;                          // Unique ID for this pending action
  encounterId: string;                 // Which encounter
  actor: CombatantRef;                 // Who is performing the action
  type: "move" | "spell_cast" | "attack";
  data: PendingMoveData | PendingSpellCastData | PendingAttackData;
  reactionOpportunities: ReactionOpportunity[];
  resolvedReactions: ReactionResponse[];
  createdAt: Date;
  expiresAt: Date;                     // Auto-decline after 60s
}
```

### `ReactionOpportunity`
A chance for a combatant to use a reaction:
```typescript
interface ReactionOpportunity {
  id: string;                          // Unique ID for this opportunity
  combatantId: string;                 // Who can react
  reactionType: "opportunity_attack" | "counterspell" | "shield" | ...;
  canUse: boolean;                     // Legal to use?
  reason?: string;                     // Why not (if canUse = false)
  context: Record<string, unknown>;    // Reaction-specific data
}
```

### `ReactionResponse`
A combatant's decision:
```typescript
interface ReactionResponse {
  opportunityId: string;               // Which opportunity
  combatantId: string;                 // Who responded
  choice: "use" | "decline";           // Their decision
  respondedAt: Date;
  result?: unknown;                    // Execution result (if used)
}
```

## Implementation

### Services

#### `TwoPhaseActionService`
Located: `packages/game-server/src/application/services/combat/two-phase-action-service.ts`

**Methods:**
- `initiateMove(sessionId, { actor, destination })` → Returns OA opportunities
- `completeMove(sessionId, { pendingActionId })` → Executes movement + OAs
- `initiateSpellCast(sessionId, { actor, spellName, ... })` → Returns counterspell opportunities
- `completeSpellCast(sessionId, { pendingActionId })` → Executes spell (if not countered)

#### `PendingActionRepository`
Located: `packages/game-server/src/application/repositories/pending-action-repository.ts`

**In-memory implementation** for now (could move to DB if needed):
- `create(action)` - Store new pending action
- `getById(id)` - Retrieve pending action
- `addReactionResponse(id, response)` - Add player's reaction decision
- `getStatus(id)` - Check if ready to complete
- `markCompleted(id)` - Mark as done
- `cleanupExpired()` - Remove timed-out actions

### API Routes

#### `POST /encounters/:encounterId/reactions/:pendingActionId/respond`
Player responds to a reaction prompt:
```json
{
  "combatantId": "fighter_123",
  "opportunityId": "opp_abc",
  "choice": "use"
}
```

Returns:
```json
{
  "success": true,
  "pendingActionId": "move_xyz",
  "status": "ready_to_complete",
  "message": "Reaction will be executed"
}
```

#### `GET /encounters/:encounterId/reactions/:pendingActionId`
Get status of a pending action (for polling/debugging).

#### `GET /encounters/:encounterId/reactions`
List all pending actions for an encounter.

### Events

#### `ReactionPrompt`
Emitted when a reaction opportunity is detected:
```typescript
{
  type: "ReactionPrompt",
  payload: {
    encounterId: string;
    pendingActionId: string;
    combatantId: string;               // Who can react
    reactionOpportunity: ReactionOpportunity;
    actor: CombatantRef;               // Who triggered it
    actorName: string;                 // "Goblin Scout"
    expiresAt: string;                 // ISO timestamp
  }
}
```

**UI should:**
1. Receive via SSE
2. Show modal: "Goblin Scout is moving through your reach. Use reaction for Opportunity Attack? [Yes/No]"
3. POST to `/reactions/:id/respond` with choice

#### `ReactionResolved`
Emitted when a player responds:
```typescript
{
  type: "ReactionResolved",
  payload: {
    encounterId: string;
    pendingActionId: string;
    combatantId: string;
    combatantName: string;
    reactionType: string;
    choice: "use" | "decline";
    result?: JsonValue;                // Attack result (if executed)
  }
}
```

## Example Flows

### Movement with Opportunity Attacks

**1. AI decides to move:**
```typescript
// LLM returns: { action: "move", destination: {x: 20, y: 10} }
const result = await twoPhaseActions.initiateMove(sessionId, {
  actor: { type: "Monster", monsterId: "goblin_1" },
  destination: {x: 20, y: 10}
});

// Returns:
{
  status: "awaiting_reactions",
  pendingActionId: "move_abc123",
  opportunityAttacks: [
    { combatantId: "fighter_1", canAttack: true, hasReaction: true }
  ]
}
```

**2. SSE events emitted:**
```typescript
// Fighter player receives:
{
  type: "ReactionPrompt",
  payload: {
    combatantId: "fighter_1",
    reactionType: "opportunity_attack",
    actorName: "Goblin Scout",
    expiresAt: "2026-01-10T12:35:00Z"
  }
}
```

**3. Player responds:**
```http
POST /encounters/enc_1/reactions/move_abc123/respond
{
  "combatantId": "fighter_1",
  "opportunityId": "opp_xyz",
  "choice": "use"
}
```

**4. Server completes move:**
```typescript
const result = await twoPhaseActions.completeMove(sessionId, {
  pendingActionId: "move_abc123"
});

// Internally:
// - Executes OA from fighter → goblin
// - Applies damage
// - Updates goblin's position
// - Emits Move + OpportunityAttack events
```

**5. AI decides to continue or stop:**
```typescript
// If goblin took significant damage, AI can decide:
if (damageTaken > 15) {
  // Stop here, don't complete remaining movement
} else {
  // Continue moving
}
```

### Spell Casting with Counterspell

**1. AI casts spell:**
```typescript
const result = await twoPhaseActions.initiateSpellCast(sessionId, {
  actor: { type: "Monster", monsterId: "wizard_1" },
  spellName: "Fireball",
  spellLevel: 3,
  targetPosition: {x: 10, y: 5}
});

// Returns:
{
  status: "awaiting_reactions",
  pendingActionId: "cast_xyz",
  counterspellOpportunities: [
    { combatantId: "wizard_pc", canUse: true, hasReaction: true, hasSpellSlot: true }
  ]
}
```

**2. Player wizard responds:**
```http
POST /encounters/enc_1/reactions/cast_xyz/respond
{
  "combatantId": "wizard_pc",
  "opportunityId": "cs_abc",
  "choice": "use"
}
```

**3. Server resolves:**
```typescript
const result = await twoPhaseActions.completeSpellCast(sessionId, {
  pendingActionId: "cast_xyz"
});

// Returns:
{
  wasCountered: true,
  counterspells: [
    { casterId: "wizard_pc", success: true }
  ]
}

// If wasCountered, Fireball doesn't execute
```

## Future Enhancements

### 1. AI Mid-Action Decisions
After reactions resolve, AI can decide to abort/modify:
```typescript
async function completeMove(pendingActionId) {
  const pendingAction = await getPending(pendingActionId);
  const oaResults = await executeOpportunityAttacks(pendingAction);
  
  // AI decision point
  if (actor.isAI && totalDamageTaken > threshold) {
    const shouldContinue = await aiDecidesContinue(oaResults);
    if (!shouldContinue) {
      // Stop at current position, don't move further
      return;
    }
  }
  
  // Complete movement
  await updatePosition(pendingAction.data.to);
}
```

### 2. Path-Based Movement
Break movement into 5ft increments, check OAs at each square:
```typescript
const path = calculatePath(from, to); // [{x:10,y:5}, {x:10,y:10}, ...]

for (const square of path) {
  const oaOpps = detectOAs(currentPos, square);
  if (oaOpps.length > 0) {
    await resolveReactions(oaOpps);
    // Decide whether to continue
  }
  currentPos = square;
}
```

### 3. More Reaction Types

- **Shield:** Trigger on attack hit, boost AC by +5
- **Absorb Elements:** Trigger on elemental damage, gain resistance
- **Hellish Rebuke:** Trigger on damage taken, deal damage back
- **Parry:** Monster reaction, reduce incoming damage
- **Uncanny Dodge:** Rogue reaction, halve damage

### 4. Auto-Decline Timeout
Currently 60s expiration. Could:
- Make configurable per session
- Auto-decline for specific players who are AFK
- Show countdown timer in UI

### 5. Simultaneous Reactions
Currently sequential (first player, then second). Could:
- Show all prompts simultaneously
- Complete action when all responses received
- Handle edge cases (multiple Counterspells on same spell)

## Integration Points

### MonsterAIService
Needs update to use two-phase flow:
```typescript
// OLD:
const result = await actionService.move(sessionId, { actor, destination });

// NEW:
const initResult = await twoPhaseActions.initiateMove(sessionId, { actor, destination });

if (initResult.status === "awaiting_reactions") {
  // Wait for reactions to resolve (handled by RealtimeBroker + SSE)
  // This turn is paused until reactions complete
  return { 
    action: "move", 
    pendingActionId: initResult.pendingActionId,
    awaitingReactions: true 
  };
}

// If no reactions, complete immediately
await twoPhaseActions.completeMove(sessionId, { pendingActionId: initResult.pendingActionId });
```

### RealtimeBroker
SSE broker should:
- Emit `ReactionPrompt` events to specific combatant owners
- Wait for responses via `/reactions/:id/respond`
- Trigger `completeMove`/`completeSpellCast` when ready

### ActionService
Keep existing `move()` method for backward compatibility (AI-only, auto-execute OAs). Add helpers:
```typescript
// Wrapper for AI that auto-executes reactions
async moveWithAutoReactions(sessionId, input) {
  const result = await this.twoPhase.initiateMove(sessionId, input);
  
  if (result.status === "awaiting_reactions") {
    // Auto-decline all reactions for AI
    for (const opp of result.opportunityAttacks) {
      await this.pendingActions.addReactionResponse(result.pendingActionId, {
        opportunityId: opp.id,
        combatantId: opp.combatantId,
        choice: "decline",
        respondedAt: new Date()
      });
    }
  }
  
  return await this.twoPhase.completeMove(sessionId, { 
    pendingActionId: result.pendingActionId 
  });
}
```

## Testing Strategy

### Unit Tests
- `PendingActionRepository` CRUD operations
- `TwoPhaseActionService.initiateMove()` detects correct OAs
- `TwoPhaseActionService.completeMove()` executes reactions

### Integration Tests
- Full flow: initiate → respond → complete
- Multiple reactions on same action
- Timeout/expiration handling
- Counterspell resolution

### E2E Tests
- Player vs AI with OA prompts
- Spell casting with counterspell
- Concurrent reactions from multiple players

## Files Created

1. **Domain Types:** `src/domain/entities/combat/pending-action.ts`
2. **Repository:** `src/application/repositories/pending-action-repository.ts`
3. **Event Types:** `src/application/repositories/event-repository.ts` (extended)
4. **Service:** `src/application/services/combat/two-phase-action-service.ts`
5. **API Routes:** `src/infrastructure/api/routes/reactions.ts`
6. **Documentation:** This file

## Next Steps

1. ✅ Create domain types
2. ✅ Add pending action repository
3. ✅ Create reaction event types
4. ✅ Implement initiateMove/completeMove
5. ✅ Add initiateSpellCast/completeSpellCast
6. ✅ Create reaction response endpoint
7. 🔄 Update MonsterAIService to use new flow
8. ⏳ Add tests for reaction system
9. ⏳ Wire up services in app.ts
10. ⏳ Update CLI to handle reaction prompts
11. ⏳ Add Shield/Absorb Elements/Hellish Rebuke reactions
12. ⏳ Implement path-based movement with incremental OA checks
