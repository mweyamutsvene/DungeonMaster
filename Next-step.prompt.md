# Tabletop-Style Combat Flow Implementation Plan

## Overview

Transform the current server-rolls-everything combat system into an interactive tabletop simulator where players roll physical dice and report results. The server will orchestrate the flow by requesting specific rolls, validating player inputs, applying modifiers, and narrating outcomes.

## Implementation Steps

### 1. ✅ Create TDD Test File (DONE)
**File**: `packages/game-server/src/infrastructure/api/combat-flow-tabletop.integration.test.ts`

Tests covering:
- Player initiates combat → Server requests initiative roll
- Player submits initiative roll → Server starts combat with turn order
- Player attacks on turn → Server requests attack roll → then damage roll
- Player misses attack → No damage roll requested
- Server detects advantage → Requests 2d20 rolls
- Auto mode → Server rolls everything (existing behavior preserved)

### 2. Extend Intent Parser for Roll Results
**File**: `packages/game-server/src/application/commands/game-command.ts`

Add new command type:
```typescript
{
  kind: 'rollResult';
  rollType: 'initiative' | 'attack' | 'damage' | 'savingThrow' | 'abilityCheck';
  value: number;        // Single roll value
  values?: number[];    // For advantage/disadvantage (2d20)
  context?: string;     // Optional player description
}
```

Update `buildGameCommandSchemaHint()` to include examples:
- "I rolled a 15" → `{ kind: 'rollResult', rollType: 'initiative', value: 15 }`
- "I rolled 12 and 8" → `{ kind: 'rollResult', rollType: 'attack', values: [12, 8] }`

Add validation in `parseGameCommand()` for roll result commands.

### 3. Create Combat Orchestrator Service
**File**: `packages/game-server/src/application/services/combat-orchestrator.ts`

**State Machine**:
```typescript
type CombatPhase = 
  | 'AWAITING_INITIATIVE'
  | 'AWAITING_ATTACK_ROLL'
  | 'AWAITING_DAMAGE_ROLL'
  | 'AWAITING_SAVING_THROW'
  | 'PROCESSING_TURN'
  | 'TURN_COMPLETE';
```

**Key Methods**:
```typescript
class CombatOrchestrator {
  // Initiate combat from natural language
  async initiateCombat(sessionId: string, input: {
    text: string;
    actorId: string;
  }): Promise<CombatPrompt>;

  // Submit initiative roll
  async submitInitiativeRoll(sessionId: string, input: {
    actorId: string;
    rollValue: number;
  }): Promise<CombatStartResult>;

  // Submit attack roll
  async submitAttackRoll(sessionId: string, input: {
    actorId: string;
    rollValue: number | number[]; // Single or advantage/disadvantage
  }): Promise<AttackResult | DamagePrompt>;

  // Submit damage roll
  async submitDamageRoll(sessionId: string, input: {
    actorId: string;
    rollValue: number;
  }): Promise<DamageResult>;

  // Get current pending action
  async getPendingAction(sessionId: string): Promise<PendingAction | null>;
}
```

**Response Types**:
```typescript
type CombatPrompt = {
  requiresPlayerInput: true;
  type: 'REQUEST_ROLL';
  rollType: 'initiative' | 'attack' | 'damage' | 'savingThrow';
  message: string;              // "Roll for initiative!"
  diceNeeded: string;           // "d20", "2d20", "1d8+3"
  advantage?: boolean;
  disadvantage?: boolean;
  pendingAction: PendingAction;
};

type PendingAction = {
  type: 'INITIATIVE' | 'ATTACK' | 'DAMAGE';
  timestamp: Date;
  actorId: string;
  targetId?: string;
  initiator?: string;           // For INITIATIVE phase
  intendedTarget?: string;      // For INITIATIVE phase
  weaponSpec?: AttackSpec;      // For ATTACK/DAMAGE
  attackRollResult?: number;    // For DAMAGE phase
};
```

### 4. Extend Combat Repository
**File**: `packages/game-server/src/infrastructure/db/combat-repository.ts`

Add schema fields to encounter or create new table:
```typescript
interface PendingActionRecord {
  encounterId: string;
  type: 'INITIATIVE' | 'ATTACK' | 'DAMAGE' | 'SAVING_THROW';
  actorId: string;
  targetId?: string;
  context: string; // JSON blob
  createdAt: Date;
}
```

Methods:
```typescript
interface ICombatRepository {
  // Existing methods...
  
  setPendingAction(encounterId: string, action: PendingActionRecord): Promise<void>;
  getPendingAction(encounterId: string): Promise<PendingActionRecord | null>;
  clearPendingAction(encounterId: string): Promise<void>;
}
```

### 5. Create New API Endpoints
**File**: `packages/game-server/src/infrastructure/api/routes/sessions.ts`

**New Endpoints**:

```typescript
// Initiate combat with natural language
POST /sessions/:id/combat/initiate
Body: { text: string; actorId: string }
Response: CombatPrompt (requests initiative roll)

// Submit any roll result
POST /sessions/:id/combat/roll-result
Body: { text: string; actorId: string } // Natural language: "I rolled a 15"
Response: CombatPrompt | CombatResult (may request next roll or complete action)

// Declare action during turn
POST /sessions/:id/combat/action
Body: { text: string; actorId: string; encounterId: string }
Response: CombatPrompt (requests attack roll)
```

**Update Existing**:
- `POST /sessions` - Add `config.combatMode: 'tabletop' | 'auto'` to session creation
- `POST /sessions/:id/actions` - Check combat mode, delegate to orchestrator if tabletop

### 6. Implement Modifier Application
**File**: `packages/game-server/src/domain/combat/modifiers.ts` (new file)

Pure functions for calculating modifiers:
```typescript
export function applyInitiativeModifiers(input: {
  rawRoll: number;
  dexterityModifier: number;
  otherBonuses?: number;
}): ModifierResult;

export function applyAttackModifiers(input: {
  rawRoll: number | number[]; // Single or advantage/disadvantage
  attackBonus: number;
  proficiencyBonus: number;
  abilityModifier: number;
  situationalBonuses?: number[];
  advantage?: boolean;
  disadvantage?: boolean;
}): AttackModifierResult;

export function applyDamageModifiers(input: {
  rawRoll: number;
  weaponDamage: DamageSpec;
  abilityModifier: number;
  criticalHit?: boolean;
  feats?: string[];
}): DamageModifierResult;

type ModifierResult = {
  rawRoll: number | number[];
  chosenRoll?: number;        // For advantage/disadvantage
  modifiers: Modifier[];
  total: number;
};

type Modifier = {
  source: string;             // "Dexterity", "Proficiency", "Magic Weapon"
  value: number;
};
```

### 7. Update Session Model
**File**: `packages/game-server/src/domain/entities/game-session.ts`

Add configuration:
```typescript
interface SessionConfig {
  combatMode: 'auto' | 'tabletop';
  // Future: allowCheating, autoNarration, etc.
}
```

## Design Decisions (Answered)

### 1. State Persistence
**Decision**: Pending actions stored in database with 15-minute timeout
- After timeout, action is auto-cancelled and turn advances
- Player receives warning at 2 minutes remaining
- Timeout configurable per session

### 2. Error Handling
**Decision**: Re-prompt with clear error message
```json
{
  "error": "INVALID_ROLL_TYPE",
  "message": "Expected initiative roll, but received attack roll. Please roll d20 for initiative.",
  "expectedRollType": "initiative",
  "diceNeeded": "d20",
  "pendingAction": { ... }
}
```

### 3. Combat Modes
**Decision**: Support both via session config
- `combatMode: 'tabletop'` - Players roll dice
- `combatMode: 'auto'` - Server rolls (existing behavior)
- Default: `'auto'` for backward compatibility

### 4. Multi-target Attacks
**Decision**: Request rolls sequentially
- Fireball on 3 enemies → Request 3 saving throws one at a time
- Server tracks which targets have rolled
- Alternative: Allow batch submission `"Enemy 1 rolled 8, Enemy 2 rolled 15, Enemy 3 rolled 12"`

### 5. Saving Throws
**Decision**: Same flow as attacks
```
Player: "I cast Fireball on the goblins"
Server: "Goblin 1, roll DEX save DC 14"
Player: "Goblin 1 rolled 10"
Server: "10+2=12, fail! Take full damage. Roll 8d6 for damage."
```

### 6. Advantage/Disadvantage
**Decision**: Server tells player to roll multiple dice
```
Server: "You have advantage! Roll 2d20 and tell me both results."
Player: "I rolled 12 and 8"
Server: "Taking higher: 12+5=17, you hit!"
```

## Testing Strategy

1. **Integration Tests** (TDD - write first):
   - Full player flow scenarios
   - Error cases (wrong roll type, out of turn)
   - Advantage/disadvantage handling
   - Auto mode verification

2. **Unit Tests**:
   - Modifier calculations
   - State machine transitions
   - Roll validation

3. **E2E Tests**:
   - Complete combat encounter with multiple players
   - Mix of tabletop and auto-controlled combatants

## Migration Path

1. Add session config with default `'auto'` mode
2. Implement tabletop endpoints as new routes
3. Existing endpoints continue to work unchanged
4. Gradually enable tabletop mode for testing
5. Eventually make tabletop default for player-controlled characters

## Future Enhancements

- **Reactions**: "Do you want to use your reaction for Shield? (+5 AC)"
- **Movement**: "How many feet do you move?"
- **Bonus Actions**: Track separately from main action
- **Legendary Actions**: Special handling for legendary creatures
- **Conditions**: Apply advantage/disadvantage automatically
- **Batch Rolls**: "Roll 4d6 drop lowest for ability scores"
- **Voice Integration**: "Alexa, I rolled a 15"
