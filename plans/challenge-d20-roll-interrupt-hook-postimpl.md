---
type: challenge
feature: d20-roll-interrupt-hook
status: COMPLETE
created: 2026-04-26
---

# Post-Implementation Challenge — d20 Roll-Interrupt Hook

## Summary

The shipped implementation handles self-interrupts (the acting combatant modifying their own d20 roll) for both attack and saving throw paths. Seven adversarial scenarios were evaluated. Two pass cleanly, one partially passes, and four expose genuine gaps — three are design-level deferred scope, one is a type safety risk requiring a field addition.

---

## Adversarial Scenarios

### Scenario 1: Lucky Feat — Enemy Attack Against Player

**PHB 2024 Rule**: Lucky (Feat, PHB p. 200): "When an attack roll is made against you, you can spend 1 luck point to impose disadvantage on that roll." Reactive use — triggered on an *enemy's* roll against the player.

**Implementation Behavior**: The interrupt resolver only scans the acting combatant's resources. When an enemy attacks a player, the player's Lucky points are never checked. No notification is sent to the defending player.

**Expected Behavior**: When an enemy rolls an attack against a player character who has Lucky and luck points remaining, the server should pause and offer Lucky (disadvantage on the enemy's roll) to the target player before resolving the attack.

**Verdict**: FAIL

**Risk**: high — this is one of the two primary Lucky use cases. Implementing it requires a reactive interrupt channel (notify target, not attacker), which is a distinct architecture not present in the current design.

---

### Scenario 2: Bardic Inspiration on Death Saves

**PHB 2024 Rule**: Bardic Inspiration (Bard, PHB p. 54): the BI die can be added to "an ability check, an attack roll, or a saving throw." Death saves are saving throws (PHB p. 21).

**Implementation Behavior**: The save interrupt hook fires inside `handleSavingThrowAction`. Death saves are processed in a separate `handleDeathSave` branch. The interrupt resolver is not called in the death save path.

**Expected Behavior**: A PC holding a BI die should be offered it when rolling a death save.

**Verdict**: FAIL

**Risk**: high — BI is silently unavailable at the most critical moment. Fix: call `rollInterruptResolver.findSaveInterruptOptions` in `handleDeathSave` before evaluating vs DC 10, following the same pre-roll + pause pattern used in `handleSavingThrowAction`.

---

### Scenario 3: Halfling Lucky on Ability Checks

**PHB 2024 Rule**: Halfling's Lucky trait (PHB p. 81): applies to "an attack roll, ability check, or saving throw." All three d20 roll types.

**Implementation Behavior**: The resolver is only called in `handleAttackRoll` and `handleSavingThrowAction`. Ability checks in combat (grapple Athletics, shove, contested skills) go through a third dispatch path with no interrupt hook.

**Expected Behavior**: When a Halfling PC rolls a 1 on any combat ability check, the reroll option should be offered.

**Verdict**: FAIL

**Risk**: medium — ability checks in combat are less frequent than attacks/saves but contested grapple and shove checks can be decisive. Fix: hook `findSaveInterruptOptions` (or a new `findCheckInterruptOptions`) into the ability check dispatcher.

---

### Scenario 4: Portent — Replacing Enemy Rolls

**PHB 2024 Rule**: Divination Wizard's Portent (PHB p. 115): "when you or a creature you can see makes an attack roll, an ability check, or a saving throw, you can use your reaction to replace the number rolled with one of your Portent dice." Explicitly includes creatures other than the Diviner.

**Implementation Behavior**: Portent detection scans the *acting combatant's* resources. When an enemy rolls, the Diviner's Portent dice are never checked. No reaction expenditure path exists for cross-turn Portent use.

**Expected Behavior**: When any creature the Diviner can see makes a d20 roll, the Diviner should be offered Portent (spending their reaction) before the roll resolves.

**Verdict**: FAIL

**Risk**: high — replacing enemy rolls is the defining power of the Divination subclass. Implementing it requires a fundamentally different architecture: async interrupt of another combatant's turn, reaction expenditure by a third party, and a timeout/skip mechanism.

---

### Scenario 5: Lucky Feat — Player's Own Attack Roll (Basic Case)

**PHB 2024 Rule**: Lucky allows spending a luck point to gain advantage on "an attack roll, ability check, or saving throw you make."

**Implementation Behavior**: `findAttackInterruptOptions` checks `feat_lucky` in the actor's feat list and `luckPoints > 0` in resources. If both are present, a `lucky-feat` option is emitted. The resolve endpoint rerolls the d20, decrements luckPoints, and reconstructs the `AttackPendingAction` with `interruptResolved: true`.

**Expected Behavior**: Matches implementation.

**Verdict**: PASS

**Risk**: low

---

### Scenario 6: Crit Persistence After Bardic Inspiration Bonus

**PHB 2024 Rule**: A critical hit is determined by a natural 20 on the d20 face (PHB p. 228). BI adds a die to the *total*, not the d20 result. The crit flag must be based on the natural d20, not the modified total.

**Implementation Behavior**: The attack interrupt fires after the auto-crit check (`isCritical` is set before the interrupt block). The `interruptBonusAdjustment` is applied to `attackBonus`, not to `rollValue`. The natural d20 is preserved as `rollValue` throughout. On re-entry with `interruptResolved: true`, `interruptForcedRoll` overrides `rollValue` only when set (Lucky/Portent); BI sets `interruptBonusAdjustment` instead, leaving `rollValue` unchanged.

**Expected Behavior**: Nat-20 crit with BI applied stays a crit. The implementation preserves this correctly since crit is evaluated before the interrupt fires and `rollValue` is not mutated by BI.

**Verdict**: PASS

**Risk**: low — the implementation handles this correctly. However, `PendingRollInterruptData` stores `rawRoll: number[]` without a distinct `naturalD20` field. If future interrupt types modify `rawRoll[0]` before re-entry, crit/fumble safety would need re-evaluation. Consider adding an explicit `naturalD20` field to `PendingRollInterruptData` as a safeguard.

---

### Scenario 7: Double Interrupt Guard (Lucky Reroll Spawning Another Interrupt)

**PHB 2024 Rule**: Lucky requires using the new roll — no chaining.

**Implementation Behavior**: `AttackPendingAction.interruptResolved` and `SavingThrowPendingAction.interruptResolved` are set to `true` on the reconstructed action. Both `handleAttackRoll` and `handleSavingThrowAction` check `!action.interruptResolved` before calling the resolver. A rerolled Lucky die cannot trigger a second interrupt.

**Expected Behavior**: Matches implementation.

**Verdict**: PASS

**Risk**: low

---

## Gaps Requiring Follow-up

### GAP-1: Reactive interrupts — Lucky on enemy attack + Portent on any roll (Scenarios 1, 4)

Both require interrupting a roll on combatant A's turn to notify combatant B (the Lucky defender or the Diviner). This is architecturally distinct from the current self-interrupt model. Recommended approach: explicitly scope v1 as "self-interrupts only" in the plan documentation, and create a separate `plan-reactive-roll-interrupt.md` for the reactive use cases when Bard/Diviner subclass features are implemented.

### GAP-2: Death save path not wired (Scenario 2)

Call `rollInterruptResolver.findSaveInterruptOptions` inside `handleDeathSave` before rolling the death save d20. Follow the same pre-roll + pause pattern used in `handleSavingThrowAction`. This is a ~15 LOC addition to an existing method.

### GAP-3: Ability check path not wired (Scenario 3)

Enumerate which ability check paths exist in the combat dispatcher (grapple, shove, initiative tiebreaker, skill challenges). Add `findSaveInterruptOptions` (or a dedicated `findCheckInterruptOptions`) to each. Halfling Lucky is the only immediate trigger; Lucky feat also applies to ability checks.

### GAP-4 (Advisory): naturalD20 field in PendingRollInterruptData

The current type stores `rawRoll: number[]` which is the pre-interrupt d20 value. Consider renaming to `naturalD20: number` (singular) and keeping it as the immutable original roll. This prevents future interrupt types from accidentally conflating the natural d20 face with a modified value.

---

## What the Implementation Gets Right

1. Two-phase state pattern (pause → client prompt → resolve endpoint) is correct for turn-based async interrupts.
2. `interruptResolved: true` guard correctly prevents Lucky reroll from spawning a second interrupt cycle.
3. BI on saves correctly applies as `bonusAdjustment` (additive to modifier) rather than replacing the d20, which is PHB-accurate.
4. Crit flag is set before the interrupt fires and is not re-evaluated on re-entry — nat-20 crits survive BI application.
5. Portent stores its pre-rolled value as an `ActiveEffect` with `duration: "until_triggered"`, which is consumed on use — correct lifecycle.
