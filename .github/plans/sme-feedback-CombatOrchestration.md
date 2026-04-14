# SME Feedback — CombatOrchestration — Round 1
## Verdict: NEEDS_WORK

The plan is architecturally sound and the core design decisions (D1–D5) are correct. The `contestType` discriminator on `AttackPendingAction` is the right approach, and the overall ATTACK→SAVING_THROW chain is well-designed. However, there are **3 blocking issues** and **3 minor issues** that need resolution before implementation.

---

## Blocking Issues

### B1: `handleAttackRoll()` return type is too narrow — cannot return combined contest result

**Problem**: `handleAttackRoll()` is typed as `Promise<AttackResult>` (line 354 of `roll-state-machine.ts`). The plan says to "chain internally" (Step 4b, Option b) — call `handleSavingThrowAction()` within the hit path and return a combined result. But `handleSavingThrowAction()` returns `Promise<SavingThrowAutoResult>`, which is a completely different shape.

The plan's Step 5 envisions a combined response containing **both** attack roll details AND save details. But no such combined type is defined. If `handleAttackRoll()` returns a raw `SavingThrowAutoResult`, the client loses the attack roll info (rawRoll, modifier, total, targetAC, hit flag). If it returns an `AttackResult`, there's no place for save details.

**Why this matters**: The `RollHandlerFn` type (`tabletop-types.ts:454`) allows returning `AttackResult | SavingThrowAutoResult | ...` so TypeScript won't block *compilation*. But the API consumer (player-cli, test harness) parses the response shape to decide what to display. A `SavingThrowAutoResult` with `rollType: "savingThrow"` when the player just submitted an attack roll will confuse the client.

**Fix**: Define a new `ContestResult` type in `tabletop-types.ts` that extends `AttackResult` with contest-specific fields:

```typescript
export interface ContestResult extends AttackResult {
  /** Present when the attack was a grapple/shove contest that hit */
  contestSave?: {
    ability: string;
    dc: number;
    rawRoll: number;
    modifier: number;
    total: number;
    success: boolean;
    outcomeSummary: string;
    conditionsApplied?: string[];
  };
}
```

Then `handleAttackRoll()` returns `Promise<AttackResult | ContestResult>` (or just `AttackResult` since `ContestResult extends AttackResult`). The `hit` path for contests: set `hit: true`, `requiresPlayerInput: false`, `actionComplete: computed`, and populate `contestSave` with the saving throw resolution. The `message` field combines both: `"14 + 7 = 21 vs AC 15. Hit! Target rolls STR save: d20(8) + 2 = 10 vs DC 16. Failed! Grappled!"`.

This keeps backward compatibility — existing clients that don't know about `contestSave` still see a valid `AttackResult` with `hit: true` and the combined message.

### B2: `handleSavingThrowAction()` unconditionally sets `actionComplete: true` — breaks Extra Attack

**Problem**: The plan says to chain internally from `handleAttackRoll()` hit path → `handleSavingThrowAction()`. But `handleSavingThrowAction()` (line 1026) calls `savingThrowResolver.buildResult()` with `actionComplete: true` hardcoded (line 1057). This is correct for spell saves (spell consumes the whole action), but wrong for grapple/shove (consumes ONE attack from the Extra Attack pool).

If a Fighter with Extra Attack grapples as attack 1 of 2, the response must have `actionComplete: false` so the player can make attack 2.

**Fix**: Don't delegate to `handleSavingThrowAction()` for the chain. Instead, call `this.savingThrowResolver.resolve()` directly within the contest hit path (just like `HitRiderResolver` does for Stunning Strike saves). This gives full control over `actionComplete` computation. Compute it the same way the regular miss path does: call `useAttack()`, then check `hasSpentAction()` on the updated resources.

Concretely, the contest hit branch in `handleAttackRoll()` should:
1. Call `this.eventEmitter.markActionSpent(encounter.id, actorId)` to consume the attack slot
2. Build the `SavingThrowPendingAction` (don't store it — resolve it inline)
3. Call `this.savingThrowResolver!.resolve(savingThrowAction, encounter.id, characters, monsters, npcs)` directly
4. Read updated combatant resources to determine `actionComplete`
5. Build and return a `ContestResult` (per B1 fix)
6. **Do NOT call `clearPendingAction()`** here — the ATTACK pending action was already the encounter-level pending action; after resolving the contest, clear it.

This avoids the round-trip of storing a SAVING_THROW pending action and avoids the `handleSavingThrowAction()` `actionComplete: true` issue entirely.

### B3: `contestSourceId` field is redundant

**Problem**: Plan adds `contestSourceId?: string` to `AttackPendingAction`. This is always identical to `actorId` (the attacker who initiated the grapple/shove). No other `AttackPendingAction` field duplicates `actorId` — the existing `attacker` field is already the same value.

**Fix**: Remove `contestSourceId`. When building the `SavingThrowPendingAction` (or inline resolution per B2), use `action.actorId` as `sourceId`. When tracking the grappler for the Grappled condition, use `action.actorId` directly in the condition's `source` field.

---

## Minor Issues

### M1: Plan doesn't address `clearPendingAction()` timing for the contest flow

**Context**: In the current attack flow, `clearPendingAction()` is called on MISS (line ~640) and the ATTACK pending action is "replaced" by a DAMAGE pending action on HIT (both go through `setPendingAction()`). For the contest flow with inline resolution (B2 fix):

The ATTACK pending action is the encounter-level pending action. After the contest resolves inline, `clearPendingAction()` must be called to clean up. This isn't explicitly mentioned in the plan.

**Fix**: Add to the plan: after inline saving throw resolution, call `this.deps.combatRepo.clearPendingAction(encounter.id)`.

### M2: Paralyzed auto-crit doesn't matter for grapple but plan raises it as a question

The plan's EC2 asks: "Should we track the crit for narrative purposes?" Answer: **No**. `isCritical` only matters for damage dice doubling. Grapple has no damage component. The attack hits (which is all that matters), and the save resolves. The `isCritical` flag in the `ContestResult` can be set to `true` for Paralyzed targets (it's computed from `rollValue === 20` in the existing code), but it has no mechanical effect. Don't add special handling — let the existing code set it naturally.

### M3: `GrappleHandlers` needs access to `deriveRollModeFromConditions` — plan mentions this but should be explicit

The plan says "Compute roll mode using `deriveRollModeFromConditions()` or equivalent." Confirm: `deriveRollModeFromConditions()` in `combat-text-parser.ts` is a pure exported function that takes `attackerConditions`, `targetConditions`, `attackKind`, optional extra advantage/disadvantage sources, and optional distance. Grapple/Shove handlers can import and call it directly — no need to duplicate or extract from `AttackHandlers.computeAttackRollModifiers()`.

`GrappleHandlers` will need to:
1. Load combatant data for both attacker and target
2. `normalizeConditions()` on both
3. Call `deriveRollModeFromConditions(attackerConds, targetConds, "melee", 0, 0, distance)` 
4. Use the result as `rollMode` on the pending action

---

## Missing Context

- **`SavingThrowResolver` does NOT check `autoFailStrDexSaves`** (confirmed: grep found zero matches). The plan correctly identifies this gap and proposes adding `autoFail?: boolean` to `SavingThrowPendingAction`. However, per the B2 fix (inline resolution), you could handle auto-fail BEFORE calling `.resolve()` — just skip the resolve entirely and manually apply the failure outcome. This is simpler and avoids changing `SavingThrowResolver` for a grapple-specific concern. **But** other saves also need auto-fail (e.g., spell saves against Stunned targets), so adding it to `SavingThrowResolver` is the right long-term choice. Keep the `autoFail` field on `SavingThrowPendingAction` and implement it in `SavingThrowResolver`.

- **`SavingThrowResolver.resolve()` already uses `action.sourceId` as condition source** (line ~393: `const condSource = action.sourceId ?? action.reason`). So when the Grappled condition is applied with `sourceId = attackerCombatantId`, the condition's `source` field will be set correctly. This confirms R5 from the plan is already handled — no additional work needed for condition source tracking **as long as** `sourceId` is set to the **combatant record ID** (not the entity ID). Verify which ID the SavingThrowResolver uses for `condSource` and which the escape grapple code looks up.

- **E2E scenario runner `rollResult` action type**: The test harness sends `{ text: "rolled 14", actorId }` to the roll-result endpoint. The response shape change (adding `contestSave`) won't break existing scenarios because they don't assert on unknown fields. New grapple scenarios will need to use the two-step `action` → `rollResult` pattern instead of the current single `action` step.

---

## Suggested Changes

1. **Define `ContestResult` type** in `tabletop-types.ts` extending `AttackResult` with `contestSave?` field (B1)
2. **Inline the saving throw resolution** in `handleAttackRoll()` contest hit path instead of delegating to `handleSavingThrowAction()` (B2) — call `savingThrowResolver.resolve()` directly, compute `actionComplete` from updated resources
3. **Remove `contestSourceId`** from the plan — use `action.actorId` everywhere (B3)
4. **Add `clearPendingAction()` call** after inline resolution (M1)
5. **Add `autoFail` support to `SavingThrowResolver`** as planned, but also use it for the inline resolution path (shared implementation)
6. **Explicitly state**: `GrappleHandlers` imports `deriveRollModeFromConditions` from `combat-text-parser.ts` (M3)

---

## Summary

The plan's core architecture is correct: `contestType` discriminator on `AttackPendingAction`, branching in `handleAttackRoll()` hit path, inline SAVING_THROW resolution, and keeping escape grapple programmatic. The fixes above address the return type gap (B1), the `actionComplete` bug (B2), and a redundant field (B3). With these changes, the implementation can proceed cleanly.
