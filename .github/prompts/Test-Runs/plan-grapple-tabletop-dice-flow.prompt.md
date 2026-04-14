# Plan: Grapple/Shove Tabletop Dice Flow + Advantage Bug Fix
## Round: 2
## Status: APPROVED
## Affected Flows: CombatOrchestration, CombatRules, ActionEconomy (minor)

## Objective
Fix two bugs: (1) Grapple/shove/escape-grapple bypass the tabletop dice flow entirely — `GrappleHandlers` calls the programmatic `ActionService` path that auto-rolls with a seeded RNG, never prompting the player for d20 rolls. (2) Grapple/shove attack rolls don't consider target conditions for advantage (Stunned, Paralyzed, etc.) or auto-fail saves.

---

## Bug 1: Tabletop Dice Flow Bypass

### Current Flow (BROKEN)
```
Player types "grapple vex"
  → ActionDispatcher matches grapple parser
  → GrappleHandlers.handleGrappleAction()
  → calls this.deps.actions.grapple() [PROGRAMMATIC — auto-rolls everything]
  → returns SIMPLE_ACTION_COMPLETE (no player dice)
```

### Target Flow (CORRECT)
```
Player types "grapple vex"
  → ActionDispatcher matches grapple parser
  → GrappleHandlers.handleGrappleAction()
  → Validates target, computes roll mode (advantage/disadvantage)
  → Creates ATTACK pending action with contestType: "grapple"
  → Returns REQUEST_ROLL (player rolls d20 for unarmed strike)
  → Player submits attack roll
  → RollStateMachine.handleAttackRoll() detects contestType
  → If HIT: Creates SAVING_THROW pending action (target STR/DEX save vs DC)
  → Auto-calls handleSavingThrowAction() (server rolls target save)
  → If SAVE FAILS: Apply Grappled condition
  → If MISS: Consume attack, return miss result
```

### Design Decisions

**D1: Reuse ATTACK pending action with `contestType` field (not new type)**
Rationale: The attack roll mechanics (d20 + mod vs AC, nat 1/20 rules, advantage/disadvantage) are identical to regular attacks. Adding a `contestType` discriminator to `AttackPendingAction` lets us branch only on the HIT path (inline SAVING_THROW resolution instead of DAMAGE). This minimizes RollStateMachine changes and reuses all existing attack roll infrastructure (Lucky prompts, Hidden removal, Rage tracking, Loading, etc.).

**D2: Saving throw step is resolved INLINE in the contest hit branch (not delegated)**
Rationale: `handleSavingThrowAction()` hardcodes `actionComplete: true`, which breaks Extra Attack scenarios (grapple as attack 1 of 2). Instead, the contest branch calls `savingThrowResolver.resolve()` directly (same pattern as `HitRiderResolver` for Stunning Strike). This gives full control over the response shape and `actionComplete` flag. The result is a `ContestResult` (extends `AttackResult` with `contestSave?` field) — backward-compatible with existing clients.

**D3: Escape Grapple stays programmatic (auto-resolved)**
Rationale: Escape grapple is the active player's own ability check (Athletics or Acrobatics vs DC). There's no "attack vs AC" step. The player chose "escape grapple" as their action — making them roll a bare ability check adds friction without strategic value. This can be revisited later if ability check dice flow is desired broadly (per the existing `PendingAbilityCheckData` TODO: CO-L3).

**D4: Shove direction choice happens BEFORE the attack roll**
Rationale: The parser already handles this — `tryParseShoveText()` returns `{ pushOrProne: "push" | "prone" }`. The `contestType` will encode this: `"shove_push"` or `"shove_prone"`. If the player just says "shove goblin" without specifying, default to push (current behavior, configurable).

**D5: AI grapple/shove continues using the programmatic path**
Rationale: When AI executes a grapple/shove via `AiTurnOrchestrator` → `ActionService.grapple()`, it should remain programmatic (instant resolution). The tabletop dice flow is only for player-facing turns routed through `GrappleHandlers` → `REQUEST_ROLL`. The `actionService.grapple/shove/escapeGrapple` methods stay unchanged.

---

## Bug 2: Missing Advantage from Target Conditions

### Current Code (BROKEN)
In `grapple-action-handler.ts` (both `.grapple()` and `.shove()`):
```typescript
const grappleOptions = {
  attackerMode: hasOutgoingAttackDisadvantage(actorConditions) ? "disadvantage" : "normal",
  // ^^^ ONLY checks attacker disadvantage. Never checks:
  //   - hasIncomingAttackAdvantage(targetConditions) → Stunned, Paralyzed, etc.
  //   - hasSelfAttackAdvantage(actorConditions) → Invisible/Hidden
  //   - hasIncomingAttackDisadvantage(targetConditions) → Invisible target
  //   - getProneAttackModifier() → Prone target melee advantage
  targetSaveMode: hasAbilityCheckDisadvantage(targetConditions) ? "disadvantage" : "normal",
  // ^^^ NEVER checks:
  //   - autoFailStrDexSaves → Stunned/Paralyzed/Petrified/Unconscious auto-fail
  //   - savingThrowDisadvantage → Restrained DEX save disadvantage
};
```

### Sub-bugs
1. **Attack roll missing target-condition advantage**: Stunned/Paralyzed/Unconscious/Petrified/Restrained/Blinded targets should grant advantage
2. **Attack roll missing attacker self-advantage**: Invisible/Hidden attackers should get advantage
3. **Attack roll missing target incoming disadvantage**: Invisible targets should impose disadvantage
4. **Attack roll missing Prone distance-aware modifier**: Melee within 5ft → advantage
5. **Save missing auto-fail**: Stunned/Paralyzed/Petrified/Unconscious targets auto-fail STR/DEX saves
6. **Save missing Restrained disadvantage**: Restrained targets have disadvantage on DEX saves

### Fix Location
These bugs exist in the **programmatic path** (`grapple-action-handler.ts`), which affects BOTH:
- AI grapple/shove (via `ActionService`)
- Current tabletop grapple/shove (via `GrappleHandlers` calling `ActionService`)

After Bug 1 is fixed, the tabletop path will compute roll mode via `deriveRollModeFromConditions()` from `combat-text-parser.ts` (same function used by `AttackHandlers` and `AiAttackResolver`) and pass it to the `AttackPendingAction`. The programmatic path (AI) also needs the fix — use the same `deriveRollModeFromConditions()` function.

**Important: Save proficiency divergence (known bug, deferred)**
The domain function `resolveUnarmedStrike()` in `grapple-shove.ts` uses `abilityCheck()` for the target's save, which does NOT include save proficiency. D&D 5e 2024 grapple/shove step 2 is a **Saving Throw** (includes save proficiency + nat 1/20 auto-fail/success rules). The tabletop path (via `SavingThrowResolver`) correctly includes proficiency. The programmatic path does not. This is a pre-existing divergence — document as TODO and fix in a follow-up PR to avoid scope creep. Similarly, the domain picks save ability by raw mod (`useDex = targetDexMod > targetStrMod`) instead of full save modifier (ability + proficiency).

---

## Changes

### CombatOrchestration Flow

#### File: `packages/game-server/src/application/services/combat/tabletop/tabletop-types.ts`
- [ ] Add `contestType?: "grapple" | "shove_push" | "shove_prone"` to `AttackPendingAction`
- [ ] Add `contestDC?: number` to `AttackPendingAction` (pre-computed DC for the saving throw step)
- [ ] Define `ContestResult` interface extending `AttackResult` with optional `contestSave?` field:
  ```typescript
  export interface ContestSaveDetail {
    ability: string;
    dc: number;
    rawRoll: number;
    modifier: number;
    total: number;
    success: boolean;
    outcomeSummary: string;
    conditionsApplied?: string[];
  }
  export interface ContestResult extends AttackResult {
    contestSave?: ContestSaveDetail;
  }
  ```
  This extends `AttackResult` so it's backward-compatible — existing clients that don't know about `contestSave` still see a valid `AttackResult`.

#### File: `packages/game-server/src/application/services/combat/tabletop/dispatch/grapple-handlers.ts`
- [ ] **Major rewrite of `handleGrappleAction()`**: Stop calling `this.deps.actions.grapple()`. Instead:
  1. Validate target (exists, in range [5ft melee], not too large [max one size larger], attacker has free hand)
  2. Initialize `attacksAllowedThisTurn` from `ClassFeatureResolver.getAttacksPerAction()` if needed, **persist to DB immediately** via `combatRepo.updateCombatantState()` (matching AttackHandlers pattern)
  3. Check `canMakeAttack()` from resource-utils (uses one attack from multi-attack pool)
  4. Compute roll mode using `deriveRollModeFromConditions(attackerConds, targetConds, "melee", 0, 0, distance)` imported from `combat-text-parser.ts` — handles ALL advantage/disadvantage sources correctly
  5. Build unarmed strike weapon spec: `{name: "Unarmed Strike", kind: "melee", attackBonus: STR mod + prof, ...}`
  6. Pre-compute the contest DC: `8 + attacker STR mod + attacker proficiency bonus`
  7. Create `AttackPendingAction` with `contestType: "grapple"`, `contestDC`
  8. Store via `combatRepo.setPendingAction()`
  9. Return `{ requiresPlayerInput: true, type: "REQUEST_ROLL", rollType: "attack", diceNeeded: "d20", ... }`

- [ ] **Major rewrite of `handleShoveAction()`**: Same pattern as grapple, with `contestType: "shove_push"` or `"shove_prone"` based on parser output. No free hand check needed for shove.

- [ ] **Keep `handleEscapeGrappleAction()` as-is** (programmatic auto-resolve per D3). Only fix: apply the advantage bug fix from Bug 2 if conditions affect the ability check.

#### File: `packages/game-server/src/application/services/combat/tabletop/roll-state-machine.ts`
- [ ] **Add contest branch in `handleAttackRoll()` HIT path**: After determining `hit = true`, check `if (action.contestType)`:
  1. **Consume the attack**: Call `this.eventEmitter.markActionSpent(encounter.id, actorId)` — this happens BEFORE the save (the attack hit, the slot is consumed regardless of save outcome)
  2. **Determine target save ability**: Compute full save modifier (ability mod + proficiency if proficient) for both STR and DEX. Pick the higher one. (D&D 5e 2024: target chooses, rational choice is the higher save modifier)
  3. **Check auto-fail**: Load target conditions, check `hasAutoFailStrDexSaves(targetConditions)`. If true, skip the save entirely — apply `onFailure` outcomes directly
  4. **Build SavingThrowPendingAction structure** (NOT stored — used for inline resolution):
     ```
     {
       type: "SAVING_THROW",
       actorId: targetId,           // TARGET makes the save
       sourceId: action.actorId,    // ATTACKER forced it (entity ID — used for condition source)
       ability: bestAbility,        // "strength" or "dexterity"
       dc: action.contestDC,
       reason: contestType === "grapple" ? "Grapple" : "Shove",
       onSuccess: { summary: "Resists the grapple/shove" },
       onFailure: { ... per contest type ... },
       context: { grapplerId: action.actorId },
     }
     ```
  5. **Resolve inline**: Call `this.savingThrowResolver!.resolve(savingThrowAction, encounter.id, characters, monsters, npcs)` directly (NOT `handleSavingThrowAction()` which hardcodes `actionComplete: true`)
  6. **Clear pending action**: `this.deps.combatRepo.clearPendingAction(encounter.id)`
  7. **Build ContestResult**: Set `hit: true`, `actionComplete: true` (matches existing attack miss pattern — player re-initiates attacks, `canMakeAttack()` gates), `requiresPlayerInput: false`, and `contestSave` with resolution details
  8. Return combined message: "14 + 7 = 21 vs AC 15. Hit! Target rolls STR save: d20(8) + 2 = 10 vs DC 16. Failed! Grappled!"

- [ ] **Handle contest MISS path**: On miss with `contestType`, the grapple/shove fails entirely — no saving throw step. The attack slot is consumed via existing `markActionSpent()` (already called in miss path). Return normal miss `AttackResult` with message "Grapple attempt missed!". `actionComplete: true` (standard).

- [ ] **onFailure outcomes per contest type**:
  - `"grapple"`: `{ conditions: { add: ["Grappled"] }, summary: "Grappled!" }`
  - `"shove_push"`: `{ movement: { push: 5, direction: computeDirection(attackerPos, targetPos) }, summary: "Pushed 5ft" }`
  - `"shove_prone"`: `{ conditions: { add: ["Prone"] }, summary: "Knocked Prone!" }`

- [ ] **Push direction computation for shove_push**: Need attacker and target positions. Load from combatant records (same as movement handlers do). Direction = normalize(targetPos - attackerPos).

- [ ] **Condition source ID format**: `SavingThrowResolver` uses `action.sourceId` as the condition source (line ~393). Verify it accepts entity IDs (characterId/monsterId/npcId) — escape grapple looks up the grappler by this ID to compute DC. If the resolver expects combatant record IDs, use `findCombatantByEntityId()` to resolve. **TODO**: Verify in source during implementation.

### CombatRules Flow

#### File: `packages/game-server/src/domain/entities/combat/conditions.ts`
- [ ] **Add `hasAutoFailStrDexSaves()` helper function**:
  ```typescript
  export function hasAutoFailStrDexSaves(conditions: readonly ActiveCondition[]): boolean {
    return conditions.some(c => {
      const effects = getConditionEffects(c.condition);
      return effects.autoFailStrDexSaves === true;
    });
  }
  ```
  Covers: Paralyzed, Petrified, Stunned, Unconscious.

#### File: `packages/game-server/src/application/services/combat/action-handlers/grapple-action-handler.ts`
- [ ] **Fix `.grapple()` advantage computation** (Bug 2 fix for programmatic/AI path):
  Import `deriveRollModeFromConditions` from `combat-text-parser.ts` and use it:
  ```typescript
  import { deriveRollModeFromConditions } from "../tabletop/combat-text-parser.js";
  
  const attackerMode = deriveRollModeFromConditions(
    actorConditions, targetConditions, "melee",
    0, 0, distance  // distance between actor and target
  );
  ```
  This correctly combines ALL sources: attacker self-advantage (Invisible/Hidden), attacker outgoing-disadvantage (Blinded/Frightened/Poisoned/Restrained/Prone), target incoming-advantage (Stunned/Paralyzed/Unconscious/Petrified/Restrained/Blinded), target incoming-disadvantage (Invisible), and Prone distance-aware modifiers.

- [ ] **Fix `.grapple()` save auto-fail**: Check `hasAutoFailStrDexSaves(targetConditions)` — if true, skip the save roll entirely and treat as auto-success for the grapple. Add `targetAutoFail?: boolean` to `GrappleShoveOptions` and handle in domain `resolveUnarmedStrike()`.

- [ ] **Fix `.shove()` advantage computation**: Same `deriveRollModeFromConditions()` call as grapple.

- [ ] **Fix `.shove()` save auto-fail**: Same as grapple.

- [ ] **Add TODO**: Document save proficiency divergence in programmatic path:
  ```typescript
  // TODO: Domain resolveUnarmedStrike() uses abilityCheck() which omits save proficiency
  // and nat 1/20 auto-fail/success rules. The tabletop path (SavingThrowResolver) handles
  // these correctly. Fix in follow-up PR to align both paths.
  ```

#### File: `packages/game-server/src/application/services/combat/tabletop/rolls/saving-throw-resolver.ts`
- [ ] **Add `autoFail` support**: If `action.autoFail === true` (or check target conditions inline), skip the d20 roll and immediately apply `onFailure` outcome. Return resolution with `rawRoll: 0, total: 0, success: false`.
- [ ] **Add condition-based saving throw disadvantage** (general fix, not just grapple):
  After the existing ActiveEffect disadvantage check, also check the target's conditions: if target has a condition with `savingThrowDisadvantage` including the save ability (e.g., Restrained → `savingThrowDisadvantage: ['dexterity']`), apply disadvantage. This fixes Restrained DEX save disadvantage for ALL saves, not just grapple.

#### File: `packages/game-server/src/domain/rules/grapple-shove.ts`
- [ ] **Add `targetAutoFail?: boolean` to `GrappleShoveOptions`**: When true, skip the save step entirely (return `success: true` with `saveRoll: 0, total: 0`).
- [ ] **Add TODO**: Document that `abilityCheck()` should be replaced with proper saving throw logic (proficiency + nat 1/20 rules) in a follow-up PR.

### ActionEconomy Flow (Minor)

#### File: `packages/game-server/src/application/services/combat/tabletop/dispatch/grapple-handlers.ts`
- [ ] **Action economy at initiation**: At the point of creating the `AttackPendingAction`, do NOT consume the attack yet (deferred pattern, matching AttackHandlers).
- [ ] **Multi-attack pool initialization**: Initialize `attacksAllowedThisTurn` from `ClassFeatureResolver.getAttacksPerAction()`, check `canMakeAttack()`, and **persist to DB immediately** via `combatRepo.updateCombatantState()` — this is critical because the attack consumption happens in a later `handleAttackRoll()` call which reads the DB.

#### Notes on action economy (from reviewer feedback):
- Attack is consumed on BOTH hit and miss, BEFORE save resolution (R4 option b confirmed correct)
- `actionComplete: true` always (matches existing attack miss pattern — player re-initiates, `canMakeAttack()` gates)
- `markActionSpent()` correctly uses `useAttack()` which increments by 1, only sets `actionSpent=true` when all slots used
- Escape grapple stays programmatic with `spendAction()` (full action cost)
- No double-consumption risk: attack is consumed once in `handleAttackRoll()` or miss path

---

## Cross-Flow Risk Checklist
- [x] Do changes in one flow break assumptions in another? — **Mitigated**: Programmatic path (`GrappleActionHandler`) stays for AI with advantage fix applied. Tabletop path (`GrappleHandlers`) changes to use pending actions. Two parallel paths, no cross-contamination.
- [x] Does the pending action state machine still have valid transitions? — **Yes**: ATTACK → inline SAVING_THROW resolution (no intermediate stored state — save is resolved within the same `handleAttackRoll()` call). No new stored pending action types.
- [x] Is action economy preserved (1 action, 1 bonus, 1 reaction, 1 movement)? — **Yes**: Grapple/shove consume one attack from the multi-attack pool (consumed via `markActionSpent()` in contest hit branch BEFORE save). `actionComplete: true` always. Escape grapple consumes full action (unchanged, stays programmatic).
- [x] Do both player AND AI paths handle the change? — **Yes**: Player gets tabletop dice flow (new). AI keeps programmatic path (advantage bug fixed, structural flow unchanged).
- [x] Are repo interfaces + memory-repos updated if entity shapes change? — **No entity shape changes**. Only `AttackPendingAction` type gets new optional fields (additive, no breaking changes).
- [x] Is `app.ts` registration updated if adding executors? — **No new executors needed**.
- [x] Are D&D 5e 2024 rules correct (not 2014)? — **Yes**: Unarmed Strike vs AC → STR/DEX save vs DC. Replaces one attack. Size limit one larger. Free hand for grapple. Full save modifier (ability + proficiency) used for ability selection in tabletop path.
- [x] Return type compatibility? — **Yes**: `ContestResult extends AttackResult` — backward-compatible. Existing clients see valid `AttackResult` with optional `contestSave` field.

---

## Risks

### R1: Dice seed sensitivity in E2E scenarios
**Impact**: Medium. All grapple/shove E2E scenarios use seeded dice and expect `SIMPLE_ACTION_COMPLETE` responses. They will break because:
- The response type changes from `SIMPLE_ACTION_COMPLETE` to `REQUEST_ROLL` → roll-result flow
- The advantage fix changes which dice are consumed (advantage rolls 2d20, shifting all subsequent rolls)
**Mitigation**: All affected scenarios must be rewritten to use the new two-step flow. This is expected and necessary.

### R2: AI grapple behavior
**Impact**: Low. AI grapple via `AiTurnOrchestrator` calls `ActionService.grapple()` directly (programmatic). This path is unchanged structurally. However, the Bug 2 advantage fix in `GrappleActionHandler` will change AI grapple outcomes when targets have conditions.
**Mitigation**: AI grapple E2E scenarios (`ai-grapple.json`, `ai-grapple-condition.json`) may need seed adjustments if advantage/auto-fail changes affect their target conditions.

### R3: RollStateMachine complexity
**Impact**: Low-Medium. Adding a contest branch to the already large `handleAttackRoll()` method (~300 lines).
**Mitigation**: The branch should be an early return (~30-50 lines) right after the `hit` determination. It calls `savingThrowResolver.resolve()` inline, computes the result, and returns a `ContestResult`. Clean separation from the regular damage path.

### R4: Action economy consumption timing (RESOLVED)
**Decision**: Consume attack BEFORE save resolution (option b). The attack hit — the slot is consumed. The saving throw is a consequence. `handleSavingThrowAction()` has zero resource mutations (verified). `markActionSpent()` is called in the contest hit branch before `savingThrowResolver.resolve()`.

### R5: Grappled condition source tracking
**Impact**: Low. `SavingThrowResolver` already uses `action.sourceId` as condition source (`const condSource = action.sourceId ?? action.reason`). When `sourceId = actorId` (the attacker's entity ID), this should work. **Verify during implementation**: confirm escape grapple looks up grappler by entity ID (not combatant record ID). If mismatch, use `findCombatantByEntityId()` to resolve.

### R6: Shield reaction against grapple unarmed strike
**Impact**: Deferred. The new tabletop flow creates an ATTACK pending action on the encounter (tabletop flow), not through the two-phase PendingActionRepository. Shield reactions are not triggered. This is a known rules gap — document as future TODO.

### R7: Save proficiency divergence between paths (PRE-EXISTING, DEFERRED)
**Impact**: Medium. The tabletop path (SavingThrowResolver) includes save proficiency + nat 1/20 rules. The programmatic path (domain `resolveUnarmedStrike()`) does not.
**Mitigation**: Document as TODO in code. Fix in follow-up PR. The tabletop path (player-facing) will be correct; the programmatic path (AI) will be slightly off but is a pre-existing issue.

### R8: Save ability selection divergence (PRE-EXISTING, PARTIALLY FIXED)
**Impact**: Low-Medium. Domain picks save ability by raw ability modifier. Tabletop path should pick by full save modifier (ability + proficiency). A target proficient in DEX saves but with lower DEX mod could pick differently.
**Mitigation**: In the contest branch, compute full save modifiers for both STR and DEX (ability + proficiency if proficient) and pick the higher one. Document domain divergence as TODO.

---

## Implementation Sequence

### Phase 1: Bug 2 Fix (Advantage — Programmatic Path)
1. Add `hasAutoFailStrDexSaves()` helper to `conditions.ts`
2. Fix advantage computation in `GrappleActionHandler.grapple()` and `.shove()` using `deriveRollModeFromConditions()`
3. Fix auto-fail saves for Stunned/Paralyzed targets (add `targetAutoFail` to `GrappleShoveOptions`)
4. Add condition-based saving throw disadvantage to `SavingThrowResolver` (general fix)
5. Update AI grapple E2E scenarios if seeds changed

### Phase 2: Bug 1 Fix (Tabletop Dice Flow)
1. Add `contestType`, `contestDC` to `AttackPendingAction` in `tabletop-types.ts`
2. Define `ContestResult` type extending `AttackResult` in `tabletop-types.ts`
3. Add optional `autoFail?: boolean` to `SavingThrowPendingAction` in `tabletop-types.ts`
4. Rewrite `GrappleHandlers.handleGrappleAction()` → create ATTACK pending action + REQUEST_ROLL
5. Rewrite `GrappleHandlers.handleShoveAction()` → create ATTACK pending action + REQUEST_ROLL
6. Add contest branch in `RollStateMachine.handleAttackRoll()` hit path → inline save resolution
7. Handle `autoFail` in `SavingThrowResolver.resolve()`
8. Ensure `markActionSpent()` is called in contest hit branch BEFORE save resolution

### Phase 3: E2E Scenarios
1. Rewrite `fighter/grapple-extra-attack.json` for two-step flow
2. Rewrite `fighter/shove.json` for two-step flow
3. Rewrite `core/prone-effects.json` shove steps for two-step flow
4. Rewrite `core/prone-melee-vs-ranged.json` shove steps for two-step flow
5. Rewrite `core/prone-movement.json` shove steps for two-step flow
6. Add new scenario: `core/grapple-stunned-advantage.json` — grapple vs Stunned target (advantage + auto-fail save)
7. Add new scenario: `core/grapple-tabletop-miss.json` — grapple attack misses, no save step
8. Verify `core/grapple-escape.json` still works (escape grapple is unchanged)
9. Verify `core/ai-grapple.json` and `core/ai-grapple-condition.json` still work (AI path)

---

## Detailed: New Tabletop Grapple Flow Step-by-Step

### Step 1: Player types "grapple goblin"
- `ActionDispatcher` matches grapple parser → `GrappleHandlers.handleGrappleAction()`

### Step 2: GrappleHandlers validates and creates pending action
- Loads encounter, combatants, verifies active turn
- Validates: target exists, within 5ft melee range, target not too large (max 1 size larger), attacker has free hand
- Initializes `attacksAllowedThisTurn` from `ClassFeatureResolver.getAttacksPerAction()` if needed
- Checks `canMakeAttack()` — rejects if all attack slots used
- Computes roll mode (advantage/disadvantage from all condition sources)
- Computes unarmed strike attack bonus: `STR mod + proficiency bonus`
- Pre-computes contest DC: `8 + STR mod + proficiency bonus`
- Creates `AttackPendingAction`:
  ```
  {
    type: "ATTACK",
    actorId, attacker: actorId,
    target: targetName, targetId,
    weaponSpec: { name: "Unarmed Strike", kind: "melee", attackBonus: strMod + prof, ... },
    rollMode,
    contestType: "grapple",
    contestDC: 8 + strMod + prof,
  }
  ```
- Stores via `combatRepo.setPendingAction(encounter.id, pendingAction)`
- Returns `{ requiresPlayerInput: true, type: "REQUEST_ROLL", rollType: "attack", diceNeeded: "d20", message: "Roll a d20 for Unarmed Strike (Grapple) vs AC ..." }`

### Step 3: Player submits attack roll (e.g., "14")
- Route handler: `POST /sessions/:id/combat/roll-result`
- Delegates to `RollStateMachine.processRollResult()`
- Matches `ATTACK` handler → `handleAttackRoll()`
- Computes: `total = 14 + attackBonus`, checks vs `targetAC`
- Standard attack roll processing: Hidden removal, Rage tracking, etc.

### Step 4a: MISS
- Standard miss handling: consume attack via `markActionSpent()`, clear pending action
- Return: `{ hit: false, message: "14 + 7 = 21 vs AC 15. Miss! Grapple attempt failed.", actionComplete: true/false based on Extra Attack }`

### Step 4b: HIT → Inline Contest Resolution
- **Contest branch**: `if (action.contestType)`:
  - DO NOT create DAMAGE pending action
  - **Consume the attack FIRST**: Call `this.eventEmitter.markActionSpent(encounter.id, actorId)` — the attack hit, the slot is consumed regardless of save outcome
  - Determine best save ability for target: compute full save modifier (ability mod + proficiency if proficient) for both STR and DEX. Pick the higher one. (D&D 5e 2024: target chooses, rational choice is the higher save modifier)
  - Check `hasAutoFailStrDexSaves(targetConditions)` → set `autoFail: true` if applicable
  - Build `SavingThrowPendingAction` structure (NOT stored to DB — used for inline resolution):
    ```
    {
      type: "SAVING_THROW",
      actorId: targetId,
      sourceId: action.actorId,
      ability: bestAbility,
      dc: action.contestDC,
      reason: "Grapple" / "Shove",
      autoFail: hasAutoFailStrDexSaves(targetConditions),
      onSuccess: { summary: "Resists the grapple/shove" },
      onFailure: { ... per contest type ... },
      context: { grapplerId: action.actorId },
    }
    ```
  - **Resolve INLINE**: Call `this.savingThrowResolver!.resolve(savingThrowAction, encounter.id, characters, monsters, npcs)` — NOT `handleSavingThrowAction()` (which hardcodes `actionComplete: true`)
  - **Clear pending action**: `this.deps.combatRepo.clearPendingAction(encounter.id)`
  - **Build ContestResult** (extends AttackResult with `contestSave?`):
    - `hit: true`, `actionComplete: true` (standard — player re-initiates attacks, `canMakeAttack()` gates)
    - `requiresPlayerInput: false` (no more dice needed)
    - `contestSave: { ability, dc, rawRoll, modifier, total, success, outcomeSummary, conditionsApplied }`
    - Combined message: "14 + 7 = 21 vs AC 15. Hit! Target rolls STR save: d20(8) + 2 = 10 vs DC 16. Failed! Grappled!"

### Step 5: Client receives combined attack+save result
- Single `ContestResult` response (extends `AttackResult`) containing:
  - Attack roll details (rawRoll, modifier, total, targetAC, hit: true)
  - `contestSave` field with save details (ability, dc, rawRoll, modifier, total, success, outcomeSummary, conditionsApplied)
  - `actionComplete: true` (standard — player can re-initiate attacks if `canMakeAttack()` permits)
  - `requiresPlayerInput: false` (no more dice needed for this contest)
  - Combined message string with both attack and save details

### Shove Flow
Identical to grapple except:
- `contestType: "shove_push"` or `"shove_prone"`
- `onFailure` for push: `{ movement: { push: 5, direction: computed }, summary: "Pushed 5ft" }`
- `onFailure` for prone: `{ conditions: { add: ["Prone"] }, summary: "Knocked Prone!" }`
- No free hand check

### Escape Grapple Flow (UNCHANGED)
- Stays programmatic via `this.deps.actions.escapeGrapple()`
- Returns `SIMPLE_ACTION_COMPLETE`
- Bug 2 advantage fix applies to the `escapeGrapple()` method in `GrappleActionHandler`

---

## Edge Cases

### EC1: Grapple vs Stunned target
- Attack roll: advantage (Stunned grants `incomingAttacksHaveAdvantage`)
- Save: auto-fail (Stunned has `autoFailStrDexSaves`)
- Result: If attack hits, grapple automatically succeeds

### EC2: Grapple vs Paralyzed target
- Attack roll: advantage (`incomingAttacksHaveAdvantage`)
- Within 5ft: critical hit (D&D 5e 2024: attacks within 5ft of Paralyzed → auto-crit)
- Save: auto-fail (`autoFailStrDexSaves`)
- NOTE: Auto-crit doesn't matter mechanically for grapple (no damage), but the "hit" is guaranteed. ❓ Should we track the crit for narrative purposes?

### EC3: Fighter Extra Attack: Grapple + Attack same turn
- Grapple uses 1 of 2 attacks. After grapple resolves (hit or miss), `attacksUsedThisTurn` increments.
- Player can then attack with 2nd attack normally.
- `canMakeAttack()` correctly gates each attempt.

### EC4: Shove push direction
- Need to compute push direction from attacker position relative to target position.
- `SavingThrowResolver` already supports `onFailure.movement.push` with direction vector.
- Direction = normalize(targetPos - attackerPos) → push target away from attacker.

### EC5: Grapple target size limit
- Current `GrappleActionHandler` validates `targetTooLarge` from domain `grappleTarget()`.
- `GrappleHandlers` needs to replicate this validation BEFORE creating the pending action.
- Size comparison: attacker size vs target size. Target must be at most 1 size larger.
- Size data comes from `statBlock.size` (monster) or species size (character).

### EC6: Free hand requirement (grapple only)
- D&D 5e 2024: Grapple requires a free hand. Shove does not.
- Currently validated in `grappleTarget()` domain function via `hasFreeHand` parameter.
- `GrappleHandlers` needs to check this. Look at how the current code determines free hand (equipped weapons: two-handed weapon = no free hand, dual-wield = no free hand, sword-and-shield = no free hand, one-handed + shield = no free hand, one-handed only = one free hand).

### EC7: Multiple pending actions race condition
- If a grapple ATTACK pending action is in progress and the player tries another action, the pending action system should reject it (existing behavior — only one encounter-level pending action at a time).

### EC8: AI turn with tabletop grapple pending
- AI doesn't go through `GrappleHandlers` — it uses `ActionService.grapple()` directly. No conflict.

---

## Test Plan
<!-- IMPORTANT: Each item below is a TEST CODE AUTHORSHIP task, not a verification step. -->

### Unit Tests
- [ ] `conditions.test.ts`: Test `hasAutoFailStrDexSaves()` returns true for Stunned, Paralyzed, Petrified, Unconscious; false for Frightened, Restrained, etc.
- [ ] `grapple-action-handler.test.ts`: Test that `.grapple()` grants advantage when target is Stunned
- [ ] `grapple-action-handler.test.ts`: Test that `.grapple()` auto-fails save when target has `autoFailStrDexSaves`
- [ ] `grapple-action-handler.test.ts`: Test that `.shove()` grants advantage when target is Paralyzed
- [ ] `grapple-action-handler.test.ts`: Test Restrained target DEX save has disadvantage

### Integration Tests
- [ ] Tabletop grapple flow: action → REQUEST_ROLL → roll-result → SAVING_THROW → result
- [ ] Tabletop shove flow: action → REQUEST_ROLL → roll-result (hit → save → prone/push)
- [ ] Tabletop grapple miss: action → REQUEST_ROLL → roll-result (miss → no save)
- [ ] Extra Attack: grapple (1 of 2) → attack (2 of 2) in same turn

### E2E Scenarios
- [ ] Rewrite `fighter/grapple-extra-attack.json` for two-step tabletop flow
- [ ] Rewrite `fighter/shove.json` for two-step tabletop flow
- [ ] Rewrite `core/prone-effects.json` shove steps
- [ ] Rewrite `core/prone-melee-vs-ranged.json` shove steps
- [ ] Rewrite `core/prone-movement.json` shove steps
- [ ] New: `core/grapple-stunned-advantage.json` — advantage + auto-fail save
- [ ] New: `core/grapple-tabletop-miss.json` — grapple attack misses
- [ ] Verify: `core/grapple-escape.json` unchanged
- [ ] Verify: `core/ai-grapple.json` unchanged (or update seeds)
- [ ] Verify: `core/ai-grapple-condition.json` unchanged (or update seeds)

---

## SME Approval
- [x] CombatOrchestration-SME — Round 1: NEEDS_WORK (3 blocking), all resolved in Round 2
- [x] CombatRules-SME — Round 1: NEEDS_WORK (5 issues), all resolved in Round 2
- [x] ActionEconomy-SME — Round 1: NEEDS_WORK (3 issues), all resolved in Round 2
- [x] ReactionSystem-SME — Round 1: APPROVED (no changes needed)
- [x] Challenger — Round 1: 2 CRITICAL + 4 MAJOR, all addressed in Round 2

---

## Round 2 Changes (Reviewer Feedback Incorporated)

### From CombatOrchestration-SME:
- **B1 (Return type)**: Defined `ContestResult extends AttackResult` with `contestSave?` field — backward-compatible
- **B2 (actionComplete)**: Inline `savingThrowResolver.resolve()` instead of `handleSavingThrowAction()` — gives full control over `actionComplete`
- **B3 (contestSourceId)**: Removed — redundant with `actorId`

### From CombatRules-SME:
- **I1 (getProneAttackModifier args)**: Fixed — but replaced with `deriveRollModeFromConditions()` call per I2
- **I2 (use deriveRollModeFromConditions)**: Adopted — single function call replaces inline computation in both paths
- **I3 (save proficiency divergence)**: Documented as R7 TODO for follow-up PR
- **I4 (save ability selection)**: Tabletop path uses full save modifier (ability + proficiency); domain divergence documented as R8 TODO  
- **I5 (SavingThrowResolver condition disadvantage)**: Added as general fix in Phase 1 — affects ALL saves, not just grapple

### From ActionEconomy-SME:
- **I1 (contradiction)**: Resolved — consume attack BEFORE save (R4 option b confirmed)
- **I2 (actionComplete)**: Always `true` — matches existing attack miss pattern
- **I3 (DB persist)**: Added explicit persist requirement for `attacksAllowedThisTurn` in GrappleHandlers rewrite spec

### From Challenger:
- **C1 (condition source ID)**: Added verification TODO in R5 — check entity ID vs combatant record ID during implementation
- **C2 (return type)**: Resolved via `ContestResult extends AttackResult` (backward-compatible)
- **M1 (actionComplete)**: Resolved — inline resolution, `actionComplete: true` always
- **M2 (clearPendingAction)**: Added explicit call in contest branch
- **M3 (push direction)**: Specified position loading from combatant records
- **M4 (autoFailStrDexSaves)**: Added as general `SavingThrowResolver` fix + `autoFail` field
