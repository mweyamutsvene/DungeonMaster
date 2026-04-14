# SME Feedback — ActionEconomy — Round 1
## Verdict: NEEDS_WORK

The plan is **mostly correct** on action economy. The core patterns (`useAttack()` for one-attack consumption, `spendAction()` for full-action, `canMakeAttack()` gating, lazy `attacksAllowedThisTurn` init) are all correctly understood and applied. However, there are **two contradictions** and **one missing implementation detail** that must be fixed before this plan can be implemented safely.

---

## Issues

### Issue 1 (HIGH): Plan is self-contradictory on when to consume the attack on contest HIT path

The "ActionEconomy Flow (Minor)" section says:
> On HIT: **after** the SAVING_THROW resolves (need to add `useAttack()` call in the contest resolution path)

But Risk R4 recommends option (b):
> Have the contest branch in `handleAttackRoll()` consume the attack **BEFORE** creating the SAVING_THROW

These are contradictory. **R4 option (b) is correct.** Per D&D 5e 2024, the attack is made (hit or miss), and it's consumed. The saving throw is a consequence of the hit, not part of the attack economy. `handleSavingThrowAction()` has no action economy logic and should NOT be coupled to it.

**Verified via source:** `handleSavingThrowAction()` (`roll-state-machine.ts:1026-1066`) calls `SavingThrowResolver.resolve()`, `clearPendingAction()`, `generateNarration()`, and `buildResult()` — no `useAttack()`, no `markActionSpent()`, no resource mutations. Adding attack consumption there would violate separation of concerns.

**Fix:** Update the ActionEconomy section to read:
> - On HIT: in `RollStateMachine.handleAttackRoll()` contest hit branch, call `markActionSpent()` **before** creating the SAVING_THROW (option b from R4). The save is a consequence, not a separate action.

### Issue 2 (MEDIUM): Step 4a/4b claim dynamic `actionComplete` but existing pattern is always `true`

Step 4a says:
> `actionComplete: true/false based on Extra Attack`

Step 5 says:
> `actionComplete: true/false (based on remaining attacks in multi-attack pool)`

But the existing regular attack miss path (`roll-state-machine.ts:682-693`) **always returns `actionComplete: true`** after calling `markActionSpent()`. This is by design — `actionComplete` means "this pending-action flow is resolved," not "all attacks are exhausted." The player re-initiates another attack, and `canMakeAttack()` gates it.

If the contest path returns dynamic `actionComplete`, it would be inconsistent with regular attacks. And making `handleSavingThrowAction()` compute dynamic `actionComplete` would require it to know about attack pools, which breaks its current clean abstraction.

**Fix:** Both contest miss and contest hit→save should return `actionComplete: true` (matching existing attack miss behavior). Remove the "true/false based on Extra Attack" language from Steps 4a, 4b, and 5. The player can issue another attack if `canMakeAttack()` permits — that's the gate.

### Issue 3 (LOW): `attacksAllowedThisTurn` lazy init must persist to DB

The plan says GrappleHandlers must "initialize `attacksAllowedThisTurn`" but doesn't explicitly state the DB persist. In AttackHandlers (`attack-handlers.ts:253-259`), after `setAttacksAllowed()`, the result is immediately written:

```typescript
currentResources = setAttacksAllowed(currentResources, attacksPerAction);
await this.deps.combatRepo.updateCombatantState(actorCombatant.id, {
  resources: currentResources as any,
});
```

In the programmatic path (`grapple-action-handler.ts:99-100`), the init is NOT persisted immediately — it's held in a local variable and the combined state (init + useAttack) is persisted together at the end. But in the tabletop path, the attack consumption is deferred (happens in `handleAttackRoll()` via `markActionSpent()`), so the init MUST be persisted at creation time. Otherwise, if the player submits a roll and `markActionSpent()` reads the combatant's resources, `attacksAllowedThisTurn` would still be the default 1.

**Fix:** Add explicit note in the GrappleHandlers rewrite spec: "Persist `attacksAllowedThisTurn` to DB via `combatRepo.updateCombatantState()` immediately after `setAttacksAllowed()`, matching AttackHandlers line 255-258."

---

## Missing Context

- **`markActionSpent()` uses entity ID matching** (`characterId === actorId || monsterId === actorId || npcId === actorId`), confirmed at `tabletop-event-emitter.ts:60`. This was previously flagged as a bug (CO-A2-03) for only matching `characterId`, but it has been fixed to match all three entity types. No issue for grapple.
- **`handleSavingThrowAction()` always returns `actionComplete: true`** — this is baked into the `buildResult()` opts passed at line 1063: `{ actionComplete: true, requiresPlayerInput: false, narration }`. If the internal chaining approach is used (plan step 4b option b), the contest hit path would inherit this `actionComplete: true`, which is the correct behavior per Issue 2 above.

---

## Validated (No Issues)

1. **Q1 resolved:** Deferred `useAttack()` to hit time is correct. The attack is consumed regardless of save outcome. R4 option (b) is the right call — just need to fix the contradiction in the ActionEconomy section.
2. **Q3 validated:** `markActionSpent()` → `useAttack()` → increments `attacksUsedThisTurn` by 1, sets `actionSpent = true` only when `newUsed >= allowed`. Verified at `resource-utils.ts:88-98`. Consumes **one** attack slot, not the whole action.
3. **Q5 validated:** "Grapple then attack" works correctly. Both share the `attacksAllowedThisTurn` pool. Lazy init uses `if (getAttacksAllowedThisTurn(currentResources) === 1)` guard so it's set once. A Fighter (2 attacks) can grapple (uses 1) then attack (uses 1, `actionSpent = true`).
4. **Q6 validated:** No double-consumption risk. On miss: `markActionSpent()` once, pending action cleared. On hit: `markActionSpent()` once before SAVING_THROW, then `handleSavingThrowAction()` has zero resource mutations.
5. **Q7 validated:** Escape grapple stays programmatic. Uses `spendAction()` → immediately `actionSpent = true`. Does NOT use `useAttack()`. Correct per D&D 5e 2024 (full action, not part of multi-attack pool). Verified at `grapple-action-handler.ts` — escape path does NOT have `skipActionCheck: true`, so the standard action-spent gate runs.
6. **Action Surge interaction:** `grantAdditionalAction()` resets `actionSpent = false` and adds to `attacksAllowedThisTurn`. After Action Surge, a Fighter can grapple again with the new action's pool. No changes needed.

---

## Suggested Changes

1. **Fix Issue 1:** Replace the ActionEconomy section's "On HIT: after the SAVING_THROW resolves" with "On HIT: before creating the SAVING_THROW (R4 option b)." Ensure the `handleAttackRoll()` contest hit branch calls `this.eventEmitter.markActionSpent(encounter.id, actorId)` before chaining to the save.
2. **Fix Issue 2:** Replace all "actionComplete: true/false based on Extra Attack" with "actionComplete: true" in Steps 4a, 4b, and 5.
3. **Fix Issue 3:** Add DB persist call after `setAttacksAllowed()` in the GrappleHandlers rewrite spec.
