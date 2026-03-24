# Plan: Multi-PC Scenario Support — Phase 9

## Overview

The E2E scenario runner currently supports only single-PC scenarios. This limits testing of:
- Healing spells cast on unconscious allies
- Buff spells targeting party members (Bless, Shield of Faith)
- Aura-based class features (Paladin Aura of Protection)
- Party coordination tactics (flanking, formation)
- Multi-character combat encounters

## Current State

### Scenario Runner (`scripts/test-harness/scenario-runner.ts`)
- Single `character` field in setup → creates one PC
- All `action`/`rollResult` steps target that PC
- `assertState` checks `characterHp`, `conditions` on the single PC
- Monster AI targets "the player" (first character)

### Player CLI (`packages/player-cli/`)
- `combat-repl.ts` tracks a single `playerCharacterId`
- SSE events filter for the single player's turn
- No concept of switching between party members

## Implementation Plan

### Phase 9.1 — Multi-PC Scenario Runner (Medium)

#### Step 1: Schema Extension
Add `characters` array (alongside existing `character` for backward compatibility):

```json
{
  "setup": {
    "characters": [
      { "name": "Fighter", "className": "Fighter", ... },
      { "name": "Cleric", "className": "Cleric", ... }
    ],
    "character": { ... }  // Legacy single-PC — still supported
  }
}
```

#### Step 2: Action Targeting
New `actor` field on action steps to specify which PC acts:

```json
{
  "type": "action",
  "actor": "Cleric",
  "input": { "text": "cast cure wounds on Fighter" },
  "expect": { "actionComplete": true }
}
```

Default: first character (backward-compatible with existing 102 scenarios).

#### Step 3: Assert Extension
Multi-PC assertions:

```json
{
  "type": "assertState",
  "actor": "Fighter",
  "expect": {
    "characterHp": { "min": 1, "max": 10 },
    "conditions": ["Prone"]
  }
}
```

#### Step 4: Turn Management
- Track each character's turn separately
- `waitForTurn` accepts optional `actor` parameter
- AI processes all monster turns between player character turns

### Phase 9.2 — Multi-PC E2E Scenarios

| Scenario | Tests | Status |
|----------|-------|--------|
| `core/heal-unconscious-ally.json` | Cleric heals unconscious Fighter → revival | ✅ 10/10 |
| `core/multi-pc-coordinated-attack.json` | Two Fighters attack same goblin in sequence | ✅ 14/14 |
| `core/bless-party.json` | Cleric casts Bless on party → attack bonus | ⏳ Blocked — Bless buff not implemented |
| `core/flanking.json` | Two PCs adjacent to enemy → advantage | ⏳ Blocked — Flanking not implemented |
| `paladin/aura-of-protection.json` | Ally within 10ft gets CHA save bonus | ⏳ Blocked — Paladin not implemented |

### Phase 9.3 — Multi-PC Player CLI (Optional)

- Add party member selection ("Which character acts?")
- Show all party members in tactical display
- Allow switching active character mid-combat

## Dependencies

- Existing `POST /sessions/:id/characters` endpoint supports adding multiple characters
- Combat system already handles multi-combatant initiative ordering
- AI already ignores player characters in its attack targeting

## Complexity

Medium — mostly scenario runner changes (schema + action routing). Server should already handle multi-PC via existing API.

---

## Implementation Notes (Phase 9.1 + 9.2 Partial — Completed)

**Date**: Phase 9.1 complete, Phase 9.2 partially complete  
**Final test results**: 105 E2E passed (was 102), typecheck clean

### Phase 9.1 — Multi-PC Scenario Runner (COMPLETE)

#### Changes to `scenario-runner.ts`:
1. `CharacterSetup` interface: `name`, `className`, `level`, `position`, `sheet`
2. `characters[]` array on `ScenarioSetup` (backward-compat: falls back to legacy `character`)
3. `actor?: string` field on 7 action types
4. `characterMap` (name→id) and `characterIdToName` (id→name) tracking
5. `resolveActorId(actorName?)` helper
6. Setup creates all characters; all action/assert handlers use `resolveActorId`
7. `waitForTurn` matches on `activeCombatant.name` (tactical view doesn't expose characterId)

#### Server changes (`roll-state-machine.ts`):
- Multi-PC initiative: loops over all other session characters after adding initiator
- Each gets DEX mod, Alert feat bonus, auto-rolled d20, `buildCombatResources()`

### Bug Fix — KO Handler (`ko-handler.ts`)
- AI damage paths were NOT applying Unconscious+Prone when KO'ing characters
- Created shared helper applied to 7+ damage paths across the codebase

### Multi-PC Scenarios Created
- `core/heal-unconscious-ally.json` — Fighter KO'd → Cleric Cure Wounds → revived (10/10)
- `core/multi-pc-coordinated-attack.json` — Two Fighters attack same goblin (14/14)
