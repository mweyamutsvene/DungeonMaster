# Plan: NPC Entity Info Missing Fields for AI Context

## Round: 1
## Status: COMPLETE
## Affected Flows: AIBehavior, EntityManagement

## Objective

Normalize entity info in `AiContextBuilder.buildEntityInfo()` so all three entity types (Monster, NPC, Character) expose a consistent set of action/ability fields (`attacks`, `actions`, `bonusActions`, `reactions`, `traits`, `abilities`, `features`). Currently NPCs are missing `attacks`, `bonusActions`, `reactions`, `traits` that Monsters expose. Characters are missing `actions`, `bonusActions`, `reactions` (though typically empty arrays for character sheets).

## Analysis

### Current state of `buildEntityInfo()` — field coverage:

| Field          | Monster       | NPC              | Character         |
|----------------|---------------|------------------|-------------------|
| `traits`       | ✅ statBlock  | ❌ MISSING       | ❌ MISSING (N/A)  |
| `attacks`      | ✅ statBlock  | ❌ MISSING       | ✅ sheet          |
| `actions`      | ✅ statBlock  | ✅ statBlock     | ❌ MISSING (N/A)  |
| `bonusActions`  | ✅ statBlock  | ❌ MISSING       | ❌ MISSING (N/A)  |
| `reactions`     | ✅ statBlock  | ❌ MISSING       | ❌ MISSING (N/A)  |
| `spells`       | ✅ statBlock  | ✅ statBlock     | ✅ sheet          |
| `abilities`    | ❌ N/A        | ✅ statBlock     | ✅ sheet          |
| `features`     | ❌ N/A        | ❌ MISSING       | ✅ sheet          |
| `classAbilities`| ✅           | ✅               | ✅                |

### Root cause:
NPC branch was written with a minimal subset of fields. Since NPC stat blocks follow the same format as monster stat blocks, they can and should expose the same fields.

## Changes

### AIBehavior
#### [File: application/services/combat/ai/ai-context-builder.ts]
- [x] NPC branch in `buildEntityInfo()`: add `attacks`, `bonusActions`, `reactions`, `traits` extraction from stat block (matching Monster pattern)
- [x] NPC branch: add `features` extraction from stat block (for parity with Character)
- [x] Character branch: add `actions`, `bonusActions`, `reactions` extraction from sheet (fall back to `[]`)
- [x] Monster branch: add `abilities`, `features` extraction from stat block (fall back to `[]`)

#### [File: application/services/combat/ai/ai-context-builder.test.ts]
- [x] Add test: NPC combatant exposes attacks, bonusActions, reactions, traits from stat block
- [x] Add test: Character combatant includes empty arrays for actions/bonusActions/reactions
- [x] Update existing NPC test to verify complete field set

## Cross-Flow Risk Checklist
- [x] Do changes in one flow break assumptions in another? **No** — purely additive; fields are all optional `unknown[]`
- [x] Does the pending action state machine still have valid transitions? **N/A** — no state machine changes
- [x] Is action economy preserved? **N/A** — read-only context building
- [x] Do both player AND AI paths handle the change? **Yes** — this is AI-only context; player path unaffected
- [x] Are repo interfaces + memory-repos updated if entity shapes change? **No entity shape changes** — data already exists in stat blocks, just not being extracted
- [x] Is `app.ts` registration updated if adding executors? **N/A**
- [x] Are D&D 5e 2024 rules correct? **N/A** — context normalization, not rules

## Risks
- **None significant** — purely additive extraction of already-available data. All new fields default to `[]` which is explicitly "no entries" vs `undefined` ("unknown").

## Test Plan
- [x] Unit tests for NPC field normalization
- [x] Unit tests for Character field normalization  
- [x] Verify existing Monster tests still pass
- [x] Run typecheck, unit tests, E2E
