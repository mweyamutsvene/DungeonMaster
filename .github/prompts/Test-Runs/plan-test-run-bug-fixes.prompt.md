# Plan: Test Run Bug Fixes (Non-Grapple)
## Round: 1
## Status: DRAFT
## Affected Flows: CombatOrchestration, AIBehavior, CombatRules, ActionEconomy (minor)

## Objective
Fix 8 bugs identified across 5 test runs (boss-fight, solo-fighter, solo-monk, monk-vs-monk, wounded-fighter). Grapple bugs are handled separately in `plan-grapple-tabletop-dice-flow.prompt.md`.

---

## Bug Inventory (consolidated, deduplicated)

| ID | Bug | Severity | Reported In | Affected Flow |
|----|-----|----------|-------------|---------------|
| **EA** | Extra Attack doesn't auto-chain | High | ALL 5 runs | CombatOrchestration |
| **AI-ATK** | AI doesn't attack after moving | High | solo-fighter, solo-monk | AIBehavior |
| **AI-BA** | AI bonus action never executed | High | monk-vs-monk | AIBehavior |
| **WPN** | Second attack uses wrong weapon + disadvantage | High | wounded-fighter | CombatOrchestration |
| **RANGE** | Melee range shows 20ft (connected to WPN) | Medium | boss-fight, solo-fighter | CombatOrchestration |
| **COND** | Conditions not shown in combatant display | Medium | monk-vs-monk | EntityManagement / CLI |
| **SURGE** | Action Surge counter message off by 1 | Low | boss-fight, wounded-fighter | ActionEconomy |
| **DUPE** | Attack roll result printed twice | Low | boss-fight | CLI |

Note: "Stunning Strike ki cost on lethal hit" (solo-monk BUG-1) is deferred — behavior is arguably correct (dead creatures don't save), and ki cost transparency is a display concern.

---

## BUG-EA: Extra Attack Doesn't Auto-Chain

### Current Flow (BROKEN)
```
Player attacks → d20 roll → damage roll
  → DamageResolver returns actionComplete: true, requiresPlayerInput: false
  → CLI exits roll loop → back to ">" prompt
  → Player must manually type another attack command for Extra Attack #2
```

### Target Flow (CORRECT)
```
Player attacks → d20 roll → damage roll
  → DamageResolver checks canMakeAttack(actorResources)
  → If attacks remain: creates new AttackPendingAction, returns requiresPlayerInput: true
  → CLI stays in roll loop → prompts for next attack d20
  → When all attacks exhausted: returns actionComplete: true
```

### Root Cause
`DamageResolver.resolve()` (line ~557 in `damage-resolver.ts`) returns `actionComplete: true` unconditionally after damage. FoB and spell-strikes have explicit chaining code (lines 384-415 and 426-460 respectively) that check `flurryStrike` / `spellStrike` fields and create follow-up pending actions. **No equivalent check exists for Extra Attack.**

### Design Decisions

**D-EA1: Chain Extra Attacks in DamageResolver (same pattern as FoB/spell-strikes)**
Rationale: FoB and spell-strikes already demonstrate the working pattern — check remaining attacks, create new `AttackPendingAction`, return `requiresPlayerInput: true`. Extra Attack should use the same pattern. The `canMakeAttack()` check from `resource-utils.ts` already exists and works.

**D-EA2: Allow target re-selection between Extra Attacks**
Rationale: D&D 5e 2024 says "you can make two attacks instead of one whenever you take the Attack action." The attacks can target different creatures. When the first attack kills the target, the next attack should prompt "Extra Attack: Roll a d20 for [weapon] vs [???]" — the CLI should let the player type a target name, OR the server can prompt for a new attack without a pre-specified target. 

Implementation: When chaining, if the original target is dead (HP ≤ 0), return a response that prompts the player to re-enter a full attack command rather than auto-targeting. This means returning back to the `>` prompt with a message "You have 1 attack remaining" — NOT staying in the roll loop. When the target is alive, stay in the roll loop (auto-chain to same target).

**D-EA3: Weapon affinity — use the same weapon for chained Extra Attacks**
Rationale: Each attack in the Extra Attack sequence should use the same weapon the player originally chose, unless they explicitly specify a different one. The `AttackPendingAction.weaponSpec` from the first attack should be preserved on the chained attack.

### Changes

#### File: `packages/game-server/src/application/services/combat/tabletop/rolls/damage-resolver.ts`
- [ ] After the FoB chaining check (line ~415) and spell-strike chaining check (line ~460), add Extra Attack chaining:
  ```
  After damage resolves:
  1. Skip if this is a bonus action attack (FoB, offhand) — those have their own chaining
  2. Skip if this is a spell-strike — already handled
  3. Load actor resources, check canMakeAttack(resources)
  4. If attacks remain AND target is alive:
     → Create new AttackPendingAction with same weaponSpec, same target
     → Return { actionComplete: false, requiresPlayerInput: true, type: "REQUEST_ROLL" }
     → Message: "Extra Attack: Roll a d20 for [weapon] vs [target]"
  5. If attacks remain AND target is dead:
     → Return { actionComplete: false, requiresPlayerInput: false }
     → Message: "Target defeated! You have N attack(s) remaining."
     → CLI exits roll loop back to ">" prompt where player can type new attack
  6. If no attacks remain:
     → Existing behavior: actionComplete: true
  ```

#### File: `packages/game-server/src/application/services/combat/tabletop/rolls/damage-resolver.ts` (miss path)
- [x] Also chain Extra Attacks on MISS in `roll-state-machine.ts`. Currently, `handleAttackRoll()` on miss returns `actionComplete: true`. If `canMakeAttack()` returns true, it should chain:
  - Miss + target alive → chain to same target
  - Miss + target dead (shouldn't happen) → back to prompt with remaining attacks message

#### Note on `actionComplete` semantics
Currently `actionComplete: true` always. After this fix:
- `actionComplete: false` + `requiresPlayerInput: true` = roll loop continues (same target)
- `actionComplete: false` + `requiresPlayerInput: false` = back to `>` prompt but attacks remain (target dead, pick new target)
- `actionComplete: true` = all attacks exhausted OR turn management

---

## BUG-AI-ATK: AI Doesn't Attack After Moving

### Current Flow (BROKEN)
```
AI turn → deterministic-ai decides "moveToward" with endTurn: false
  → AiTurnOrchestrator executes moveToward, position updated
  → Loop continues → decide() called again
  → ??? Attack decision not reached or not triggered
  → Turn ends prematurely
```

### Root Cause (Investigation Needed)
Multiple possible failure modes identified in the AI turn loop (`ai-turn-orchestrator.ts` line ~440):

1. **`endTurn` not explicitly `false`**: If `moveToward` decision has `endTurn: undefined` (missing field), `decision.endTurn !== false` evaluates to `true`, ending the turn
2. **Distance recalculation**: After movement, if the AI still believes it's out of range due to grid rounding, the attack phase is skipped
3. **`hasMoved` flag not set**: If the movement handler doesn't set `hasMoved`, the next `decide()` call might re-enter the movement branch instead of progressing to attack
4. **Attack name lookup fails**: `pickBestAttack()` returns undefined for the creature, so attack phase is skipped entirely

### Design Decision

**D-AI1: Add defensive logging + explicit endTurn enforcement**
Rather than guessing, add structured debug logging to the AI turn loop and investigate in a running scenario. However, the MOST LIKELY fix is:

1. Ensure all `moveToward` decisions explicitly set `endTurn: false`
2. Verify `hasMoved` flag is set by the movement handler
3. Verify `actionSpent` is NOT set by moveToward (movement is free, not action-consuming)
4. After movement, verify distance recalculation uses updated positions

### Changes

#### File: `packages/game-server/src/application/services/combat/ai/deterministic-ai.ts`
- [x] Add defensive `endTurn: false` to ALL moveToward returns (search for every `action: "moveToward"` return statement) — verified both already had `endTurn: false`, added structured debug logging
- [x] After movement phase, verify `hasMoved` context is correctly passed to next `decide()` call — verified via orchestrator combatant refresh + `continue` on moveToward
- [x] Add structured logging: `aiLog(`[AI] moveToward → endTurn=${decision.endTurn}, nextDecision will see hasMoved=${hasMoved}`)` — added module-level aiLog + per-moveToward logging

#### File: `packages/game-server/src/application/services/combat/ai/ai-turn-orchestrator.ts`
- [x] In the main loop after executing moveToward, verify the combatant refresh loads updated position
- [x] Add defensive check: if `decision.action === "moveToward"` and result was successful, force `turnComplete = false` regardless of `decision.endTurn` — added `continue` after moveToward success
- [x] Add logging: `aiLog(`[AI] Decision: action=${decision.action}, endTurn=${decision.endTurn}, loop continues: ${decision.endTurn === false}`)` — added before execute()

---

## BUG-AI-BA: AI Bonus Action Never Executed

### Current Flow (BROKEN)
```
AI turn → decision = { action: "attack", bonusAction: "Flurry of Blows", endTurn: true }
  → AiTurnOrchestrator executes main action (attack)
  → Records decision.bonusAction in event data
  → endTurn: true → turnComplete = true → loop exits
  → Bonus action NEVER EXECUTED
```

### Target Flow (CORRECT)
```
AI turn → decision = { action: "attack", bonusAction: "Flurry of Blows", endTurn: ... }
  → AiTurnOrchestrator executes main action (attack)
  → If decision.bonusAction exists AND result.ok AND !bonusActionSpent:
     → Execute bonus action via executeBonusAction()
  → Then check endTurn for loop termination
```

### Root Cause
`ai-turn-orchestrator.ts` main loop (line ~530) executes `decision.action` but never calls `executeBonusAction()` for `decision.bonusAction`. The `executeBonusAction()` method exists in `ai-action-executor.ts` (line ~251) and works — it's just never called in the main turn loop.

### Design Decision

**D-AIBA1: Execute bonus action after main action in the loop**
Rationale: The infrastructure exists (`executeBonusAction()`). The decision already includes `bonusAction`. The bonus action should execute immediately after the main action succeeds. The loop then checks `endTurn` to determine if more actions follow.

**D-AIBA2: Don't set endTurn: true when bonusAction is present**
Rationale: If the AI declares both an attack and a bonus action, `endTurn` should be set AFTER both execute. The attack decision should use `endTurn: false` when `bonusAction` is present, so the loop processes the bonus action.

However, this is harder to enforce — the LLM/deterministic AI might set `endTurn: true` regardless. Safer approach: always execute the bonus action after the main action regardless of `endTurn`, then check `endTurn`.

### Changes

#### File: `packages/game-server/src/application/services/combat/ai/ai-turn-orchestrator.ts`
- [x] After executing main action (line ~530), add:
  ```
  if (result.ok && decision.bonusAction && !bonusActionSpent) {
    const bonusResult = await this.actionExecutor.executeBonusAction(
      sessionId, encounter.id, currentAiCombatant, decision, actorRef
    );
    // Record bonus result in turnResults
    // Update bonusActionSpent flag
  }
  ```
  — implemented with `bonusActionUsed` economy check to avoid double execution when handler already calls executeBonusAction
- [ ] This goes BEFORE the `endTurn` check so the bonus action always fires when declared

---

## BUG-WPN + BUG-RANGE: Wrong Weapon Selection + 20ft Range

### These bugs are connected: wrong weapon selection (Handaxe instead of Longsword) causes the incorrect range display.

### Current Flow (BROKEN)
```
Player: "I attack the goblin with my longsword"
  → tryParseAttackText() extracts weaponHint: "longsword" BUT IT'S NEVER USED
  → handleAttackAction() weapon selection:
     → Looks for weapon matching inferredKind from attacks[]
     → Falls through to first weapon or wrong weapon
  → Handaxe selected (thrown, range: { normal: 20, long: 60 })
  → At 30ft: "out of range (30ft > 20ft)" — using Handaxe's range, not Longsword's
  → At 5ft: Handaxe used with possible disadvantage (ranged weapon in melee)
```

### Root Cause
1. `tryParseAttackText()` extracts `weaponHint` from "with my longsword" but it's **never passed to `handleAttackAction()`** and **never used in weapon selection**
2. Weapon selection in `attack-handlers.ts` (line ~366) uses `inferredKind` and `equippedWeapon` matching from the attacks array, but doesn't filter by name
3. When attacks[0] doesn't match or inferredKind leads to attacks[1] (Handaxe), the wrong weapon is selected
4. The "20ft" range comes from Handaxe's `range.normal: 20` property

### Design Decision

**D-WPN1: Pass weaponHint through the dispatcher to handleAttackAction**
Rationale: The parser already extracts the weapon name — it just needs to be used. The `ParsedAttackText.weaponHint` field should be passed to `handleAttackAction()`, which uses it to filter the weapon selection.

**D-WPN2: Weapon selection should prefer name match over inferredKind match**
When `weaponHint` is provided:
1. Try exact name match first (case-insensitive)
2. Try partial name match (e.g., "longsword" matches "Longsword +1")
3. Fall back to current inferredKind logic

When `weaponHint` is NOT provided (user just says "I attack"):
1. Use the same weapon as the previous attack in this Extra Attack sequence (stored on pending action)
2. Fall back to first equipped weapon matching `inferredKind`
3. Fall back to `attacks[0]`

### Changes

#### File: `packages/game-server/src/application/services/combat/tabletop/dispatch/attack-handlers.ts`
- [ ] Modify `handleAttackAction()` to accept `weaponHint?: string` parameter
- [ ] Add name-based weapon lookup before the existing inferredKind fallback:
  ```
  if (weaponHint) {
    const hint = weaponHint.toLowerCase();
    equippedWeapon = weapons.find(w => w.name.toLowerCase() === hint)
      ?? weapons.find(w => w.name.toLowerCase().includes(hint))
      ?? null;
    if (equippedWeapon) {
      inferredKind = equippedWeapon.kind;  // Override inferredKind from matched weapon
    }
  }
  ```
- [ ] When no weaponHint and this is a chained Extra Attack (from BUG-EA fix), use the `weaponSpec` from the previous pending action

#### File: `packages/game-server/src/application/services/combat/tabletop/action-dispatcher.ts`
- [ ] Pass `parsed.weaponHint` from the attack parser to `handleAttackAction()`:
  ```
  // In the attack parser chain entry's handle() function:
  return this.attackHandlers.handleAttackAction(parsed, ctx, parsed.weaponHint);
  ```

---

## BUG-COND: Conditions Not Shown in Combatant Display ✅ FIXED

### Root Cause (RESOLVED)
**Not a persistence bug — it's a display timing issue.** Full pipeline investigation confirmed:
- ✅ `TacticalViewService.getTacticalView()` correctly reads conditions via `readConditionNames(c.conditions)` from the Prisma `conditions` Json column
- ✅ `SavingThrowResolver` correctly persists conditions via `updateCombatantState(combatantId, { conditions })` 
- ✅ `readConditionNames()` handles both `ActiveCondition[]` and legacy `string[]` formats
- ✅ Prisma `CombatantState.conditions` column stores and retrieves correctly
- ✅ CLI `printCombatantLine()` renders `[Stunned]` in magenta when `c.conditions.length > 0`

**The actual issue:** Transient conditions (e.g., Stunning Strike's "Stunned" with `expiresAt: { event: "start_of_turn", combatantId: monkId }`) expire at the start of the monk's next turn. The CLI only fetches the tactical view at the start of the player's turn, but `processStartOfTurnEffects` iterates ALL combatants and removes expired conditions BEFORE the tactical view is fetched. So:
1. Monk hits → damage → Stunning Strike save → enemy Stunned (persisted correctly)
2. Enemy's turn → still Stunned → "cannot act" message → turn skipped (no tactical view shown during AI turn)
3. Monk's next turn → `processStartOfTurnEffects(activeEntity=monkId)` → expires Stunned on enemy → tactical view fetched → no conditions

### Fix Applied
**Refresh tactical view after roll prompt loop completes** in `combat-repl.ts` `handleAction()`. After `rollPromptLoop` returns, the CLI now fetches and displays the updated tactical view. This shows the player:
- Updated HP values after damage
- Newly applied conditions (Stunned, Prone, etc.) before they expire
- Resource pool changes (ki, spell slots)

### Changes
- [x] `packages/player-cli/src/combat-repl.ts` — Added `fetchTactical()` + `printTacticalState()` after `rollPromptLoop()` returns in `handleAction()`

---

## BUG-SURGE: Action Surge Counter Message Off By 1

### Root Cause
`action-surge-executor.ts` (line ~75) displays:
```typescript
`Action Surge! Gained ${extraAttacks} additional attacks (${attacksAllowed} total attacks remaining).`
```
Where `attacksAllowed = getAttacksAllowedThisTurn(updatedResources)` — this is the TOTAL quota, not remaining. It doesn't subtract `attacksUsedThisTurn`.

### Fix
Display: `attacksAllowed - attacksUsed` as "remaining":
```typescript
const remaining = getAttacksAllowedThisTurn(updatedResources) - getAttacksUsedThisTurn(updatedResources);
`Action Surge! Gained ${extraAttacks} additional attacks (${remaining} attacks remaining).`
```

### Changes

#### File: `packages/game-server/src/application/services/combat/abilities/executors/fighter/action-surge-executor.ts`
- [ ] Fix the summary message to show `attacksAllowed - attacksUsed` instead of just `attacksAllowed`

---

## BUG-DUPE: Attack Roll Result Printed Twice ✅ FIXED

### Root Cause (RESOLVED)
**Not an SSE event issue — it's within the `rollPromptLoop` itself.** When `submitRoll()` returns a response that is both an attack result AND a damage roll prompt (e.g., `hit: true, requiresPlayerInput: true, rollType: "damage"`):
1. `printActionResult(resp)` at the end of the loop iteration prints the hit message
2. The while loop continues, `printRollRequest(resp)` at the top of the next iteration prints the SAME `resp.message` again

SSE event handlers are NOT the cause — they're properly cleaned up in `waitForPlayerTurn()`'s finally block.

### Fix Applied
Added a guard to skip `printActionResult` when the roll loop will continue (i.e., `resp.requiresPlayerInput && resp.rollType`). The message will be printed once by `printRollRequest` at the next loop iteration instead.

### Changes

#### File: `packages/player-cli/src/combat-repl.ts`
- [x] Added guard `!(resp.requiresPlayerInput && resp.rollType)` to skip `printActionResult` when the loop continues

---

## Implementation Sequence

### Phase 1: Core Combat Flow (BUG-EA + BUG-WPN + BUG-RANGE)
These are interconnected — weapon selection and Extra Attack chaining affect the same code paths.
1. Pass `weaponHint` through dispatcher to `handleAttackAction()` (BUG-WPN)
2. Add name-based weapon selection in `attack-handlers.ts` (BUG-WPN, fixes BUG-RANGE)
3. Add Extra Attack chaining in `DamageResolver` after damage (BUG-EA)
4. Add Extra Attack chaining on miss in `RollStateMachine` (BUG-EA)
5. Preserve `weaponSpec` on chained attacks (BUG-WPN + BUG-EA)

### Phase 2: AI Behavior (BUG-AI-ATK + BUG-AI-BA)
Independent from Phase 1.
1. Add defensive `endTurn: false` enforcement for moveToward (BUG-AI-ATK)
2. Add logging to AI turn loop for diagnosis (BUG-AI-ATK)
3. Add bonus action execution after main action in AI turn loop (BUG-AI-BA)
4. Verify AI Flurry of Blows works with dedicated test (BUG-AI-BA)

### Phase 3: Polish (BUG-SURGE + BUG-DUPE + BUG-COND)
Independent fixes.
1. Fix Action Surge counter message (BUG-SURGE)
2. Fix duplicate output suppression (BUG-DUPE)
3. Investigate and fix condition display (BUG-COND)

---

## Cross-Flow Risk Checklist

- [ ] **BUG-EA changes affect AI path?** — No. AI uses programmatic `ActionService.attack()`, not the tabletop `DamageResolver`. Extra Attack chaining only affects the player-facing tabletop path.
- [ ] **BUG-WPN changes affect existing weapon selection?** — Low risk. The `weaponHint` parameter is optional. When not provided, existing behavior is preserved. Name-based lookup is additive.
- [ ] **BUG-AI-ATK/BUG-AI-BA changes affect player turns?** — No. AI turn orchestrator only runs for AI-controlled combatants.
- [ ] **BUG-EA + BUG-WPN interaction with FoB/spell-strike chaining?** — Guarded with `bonusAction` and `spellStrike` checks. Extra Attack chaining only triggers when those are absent.
- [ ] **E2E scenario impact?** — All E2E scenarios that test attack flows may need seed adjustments if Extra Attack chaining changes the number of dice consumed. AI-attack scenarios may behave differently.

---

## Risks

### R1: Extra Attack chaining changes dice seed consumption
**Impact**: Medium. Every E2E scenario with multi-attack fighters now chains automatically, consuming different dice in different order.
**Mitigation**: Update affected E2E scenarios with new seeds or expected results.

### R2: Weapon hint matching false positives
**Impact**: Low. A weapon name like "Great" could match "Greataxe" and "Greatsword". Use exact match first, partial only as fallback.
**Mitigation**: Prefer exact match, partial match as fallback.

### R3: AI bonus action execution ordering
**Impact**: Low. Executing bonus action after main action is correct per D&D rules. But the bonus action (e.g., Flurry of Blows) may require the main action to have been an Attack action — ensure `hasUsedAction()` check passes.
**Mitigation**: Execute bonus after main and verify prerequisites are met.

### R4: Target-died mid-Extra-Attack UX
**Impact**: Medium. When first attack kills the target, returning to `>` prompt with "1 attack remaining" is functional but not as smooth as auto-chaining. The player might accidentally end turn without using remaining attacks.
**Mitigation**: Clear messaging: "Target defeated! You have 1 attack remaining. Type an attack command to use it." Also ensure `canMakeAttack()` gate prevents accidental turn-ending.
