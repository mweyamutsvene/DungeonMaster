# SME Research — CombatOrchestration — CO-M2: Legendary Actions Between Turns

## TL;DR: This is already implemented. The feature works end-to-end.

The original ticket ("no trigger point for AI to spend legendary actions between turns") is **outdated**. The full legendary action pipeline is wired and has an E2E scenario.

---

## Current State of Legendary Actions

### 1. Domain Layer (fully implemented)
- **`domain/entities/creatures/legendary-actions.ts`**: `LegendaryActionDef`, `LairActionDef`, `LegendaryTraits` types + `parseLegendaryTraits()` parser. Unit-tested.

### 2. Resource Tracking (fully implemented)
- **`combat/helpers/resource-utils.ts`** (lines 507-580): Full charge lifecycle:
  - `getLegendaryActionsRemaining()` / `getLegendaryActionCharges()` — read charges
  - `spendLegendaryAction(resources, cost)` — deduct, throws on insufficient
  - `resetLegendaryActions(resources)` — reset to max
  - `isLegendaryCreature(resources)` — boolean gate
  - `getLegendaryActionDefs(resources)` — retrieve stored action definitions

### 3. Initialization (two paths, both implemented)
- **CombatService.startEncounter()** (lines 247-260): `parseLegendaryTraits(statBlock)` → stores charges, remaining, actions, lairActions, isInLair on combatant resources.
- **InitiativeHandler** (`tabletop/rolls/initiative-handler.ts`, lines 124-128): Same init for tabletop flow.

### 4. Charge Reset at Start of Turn (implemented)
- **CombatService.processIncomingCombatantEffects()** (line 685): Calls `resetLegendaryActions()` when legendary creature's turn starts.

### 5. AI Decision Logic (fully implemented)
- **`ai/legendary-action-handler.ts`**: Pure function `chooseLegendaryAction(boss, combatants, turnNumber)`:
  - Checks incapacitated/stunned/paralyzed/unconscious/dead
  - Spreading heuristic: ~1 action every `ceil(nonBossCount / maxCharges)` turns
  - Priority: attack adjacent enemy > move > special
  - Returns `LegendaryActionDecision | null`

### 6. Combat Loop Integration (fully implemented)
- **`ai/ai-turn-orchestrator.ts` → `processAllMonsterTurns()`** (lines 703-741):
  1. Before AI loop: determines `justEndedCombatant` → calls `processLegendaryActionsAfterTurn()`
  2. Processes lair actions
  3. Loops AI turns; **after each AI turn**, calls `processLegendaryActionsAfterTurn()` again
- **`processLegendaryActionsAfterTurn()`** (lines 757-840):
  1. Finds all alive legendary bosses (excluding creature whose turn just ended)
  2. For each: `chooseLegendaryAction()` → spend charges → emit events → execute
  3. Attack-type actions fully resolved via `executeLegendaryAttack()` (lines 845-1100): d20 roll with advantage/disadvantage from conditions+effects, damage, AC with effect bonuses, KO handling

### 7. Call Sites for `processAllMonsterTurns()` (3 entry points)
| Caller | File | Trigger |
|--------|------|---------|
| `session-actions.ts` endTurn | routes/sessions/session-actions.ts:61,72 | Player ends turn via `POST /sessions/:id/actions` |
| `roll-state-machine.ts` death save | tabletop/roll-state-machine.ts:968 | After death save auto-advances turn |
| ActionDispatcher "end turn" text | tabletop/action-dispatcher.ts:478 | Player types "end turn" → `combat.endTurn()` → route fires `processAllMonsterTurns` separately |

### 8. E2E Scenario (exists)
- **`scripts/test-harness/scenarios/core/legendary-actions.json`**: Fighter vs Skeletal Champion (3 charges, Bone Lash cost-1 attack + Advance cost-1 move). Tests legendary action between turns, normal AI turn, multi-round combat to Victory.

---

## CombatOrchestration Impact: None

The three facade services (TabletopCombatService, ActionService, TwoPhaseActionService) are **not involved** in legendary action processing. Legendary actions bypass the pending-action state machine entirely — they're resolved directly by `executeLegendaryAttack()` in the AI orchestrator using raw d20 + damage rolls. No changes to orchestration files needed.

---

## Minor Gaps (not blocking CO-M2 closure)
1. **Move-type legendary actions**: Narrative-only, no grid movement. Comment: "full move resolution can be added later".
2. **Special-type legendary actions**: Same — narrative-only, no mechanical effect.
3. **Multiple legendary creatures**: Logic supports it (iterates `legendaryBosses`), but no E2E test.
4. **Legendary Resistance**: Different feature (auto-succeed saves), not implemented, separate ticket.

---

## Verdict

**CO-M2 can be closed.** If a specific failure is observed, likely causes:
- Spreading heuristic in `chooseLegendaryAction()` may skip opportunities (first turn after boss acts)
- Position-based target finding requires enemies ≤10ft for attack actions
- E2E scenario depends on deterministic dice outcomes
