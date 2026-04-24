# SME Feedback — CombatRules — Round 1 (Inventory G2)
## Verdict: NEEDS_WORK

Scope: D&D 5e **2024** RAW correctness of the item action-cost defaults and Goodberry spell definition in `plan-inventory-g2-scalable.prompt.md`. Architecture/non-rules concerns deferred to other SMEs.

## Issues

1. **Goodberry spell `duration` is wrong** (SpellSystem → `level-1.ts` entry).
   Plan: "1 min duration, no concentration." 2024 RAW: **Duration = Instantaneous**, no concentration. The 10 berries are a physical artifact that persists up to 24 h — *not* a spell duration. Berry expiry must live on the item (`longRestsRemaining`), never on the spell. Set `duration: 'instantaneous'`.

2. **Scroll default `{use:'utilize'}` is wrong** (D1, item-action-defaults.ts).
   2024 DMG Spell Scrolls: *"The scroll has the same casting time as the spell."* A 1-action spell scroll consumes a **Magic Action** (≈ `'action'`); a bonus-action spell scroll consumes a bonus action; etc. It is **not** the Utilize action — Utilize is reserved for magic items whose description says "Utilize." Options:
   - (a) Default scroll to `{use:'action'}` with a TODO for variable casting times.
   - (b) Add a `'spell-casting-time'` sentinel resolved at cast time from the embedded spell. Scalable; matches plan's ethos.

3. **`give` default conflates hand-off with administer** (D1, potion category default = `{give:'bonus'}`).
   2024 RAW:
   - *Hand a willing ally an item within 5 ft* → **free object interaction** (1/turn slot).
   - *Administer a potion* (force-feed unconscious/unwilling ally) → **Bonus Action** (2024 Potion of Healing: "drink it **or administer it** to another creature… as a Bonus Action").
   Plan silently charges a bonus action for a simple hand-off. Split the verb:
   - `give: 'free-object-interaction'` (default most items, incl. potions)
   - `administer: 'bonus'` (potions, injury poisons)
   Parser: `"hand <item> to <ally>"` = give; `"feed <item> to"` / `"administer <item>"` = administer. The planned `druid/goodberry-feed-ally.json` scenario (unconscious ally) is an *administer*, not a give.

4. **Armor `equipDurationMinutes` only captures donning; doff is distinct in 2024** (armor-catalog.ts).
   2024 PHB armor table:
   | Category | Don | Doff |
   |---|---|---|
   | Light | 1 min | 1 min |
   | Medium | 5 min | 1 min |
   | Heavy | 10 min | 5 min |
   Heavy doff especially differs. Replace with `{donMinutes, doffMinutes}` or the model is wrong the first time anyone removes heavy armor before a short rest.

5. **Goodberry 24 h → 1 long rest is an unacknowledged approximation** (D3).
   RAW: 24 hours from casting. Plan: vanishes at next long rest (8 h). A druid who casts at dawn and long-rests at dusk loses berries RAW would still grant. Given the explicit "no in-world clock" constraint this is acceptable as a pragmatic stub, but the plan's "Deferred" section does not call it out. Add an explicit bullet: *"Goodberry 24 h expiry is approximated as `longRestsRemaining:1` (stricter than RAW — acceptable without an in-world clock)."* Also document in the spell's JSDoc.

## Confirmed correct vs 2024 RAW

- Goodberry: casting time Action ✓; V/S/M mistletoe ✓; 10 berries ✓; 1 HP each ✓; Druid + Ranger ✓.
- Goodberry eat-berry = **Bonus Action** ✓ (2024 changed from 2014 Action — plan correctly uses 2024).
- Potion of Healing drink = **Bonus Action** ✓ (2024 item entry).
- Injury poison coating = **Bonus Action** ✓ (2024 DMG).
- Weapon draw/stow = **free object interaction** (1/turn) ✓.
- Shield don/doff = action-equivalent ≈ Utilize ✓.
- `resetTurnResources()` missing `objectInteractionUsed` (D8) — real defect, good catch.

## Suggested Changes (minimal to unblock)

1. `level-1.ts` Goodberry: `duration: 'instantaneous'` (not 1 min).
2. `item-action-defaults.ts`: scroll → `{use:'action'}` + TODO for `'spell-casting-time'` sentinel.
3. `ItemActionCosts`: split `give` (→ `'free-object-interaction'` default) from new `administer` (→ `'bonus'` for potions/poisons). Update potion + goodberry defaults and parser verbs.
4. `armor-catalog.ts`: `{donMinutes, doffMinutes}` populated per 2024 table.
5. Plan "Deferred" + Goodberry JSDoc: document the 24 h → 1 long rest approximation.

Re-review after these fixes for APPROVAL.

<!-- STALE CONTENT BELOW — previous grapple-plan feedback, ignore -->
<!--
The plan's inline code for the advantage fix in `grapple-action-handler.ts` has:
```typescript
const proneModifier = getProneAttackModifier(targetConditions, "melee", 5);
```

The **actual** function signature (from `conditions.ts` line ~388) is:
```typescript
getProneAttackModifier(
  targetConditions: readonly ActiveCondition[],
  attackerDistanceFt: number,     // ← arg 2 is the DISTANCE (number)
  attackKind: 'melee' | 'ranged', // ← arg 3 is the KIND (string)
)
```

The plan swaps the distance and kind arguments. TypeScript would catch this at compile time, but it indicates the implementation spec is wrong.

**Fix**: Use `getProneAttackModifier(targetConditions, 5, "melee")`. Better yet — see Issue 4.

---

### Issue 2: Plan should use `deriveRollModeFromConditions()` directly instead of reimplementing advantage logic inline

The plan's Bug 2 fix for `grapple-action-handler.ts` manually reimplements all 6 advantage/disadvantage sources with inline `if` statements. But `deriveRollModeFromConditions()` in `combat-text-parser.ts` already implements this exact logic correctly (and is well-tested). It accepts `attackerConditions`, `targetConditions`, `attackKind`, `extraAdvantageSources`, `extraDisadvantageSources`, and `distanceFt`.

For grapple/shove, the call is simply:
```typescript
import { deriveRollModeFromConditions } from "../tabletop/combat-text-parser.js";

const attackerMode = deriveRollModeFromConditions(
  actorConditions, targetConditions, "melee",
  0, 0, dist, // dist = actual distance between actor and target
);
```

This already correctly handles: self-advantage (Invisible/Hidden), outgoing-disadvantage (Blinded/Frightened/Poisoned/Restrained/Prone/Sapped/Addled), incoming-advantage (Stunned/Paralyzed/Unconscious/Petrified/Restrained/Blinded), incoming-disadvantage (Invisible), and Prone distance-aware modifiers.

`AttackActionHandler` and `AiAttackResolver` already import and use this function for the same purpose. Using it in `GrappleActionHandler` avoids code duplication and the arg-order bug in Issue 1.

**Fix**: Replace the inline advantage computation block with a single `deriveRollModeFromConditions()` call.

---

### Issue 3: Save proficiency bug — divergent behavior between tabletop and programmatic paths

The domain function `resolveUnarmedStrike()` in `grapple-shove.ts` uses `abilityCheck()` for the target's save, passing the **raw ability modifier** (no proficiency):
```typescript
const useDex = targetDexMod > targetStrMod;
const targetMod = (useDex ? targetDexMod : targetStrMod) + savePenalty;
const saveCheck = abilityCheck(diceRoller, { dc, abilityModifier: targetMod, mode: ... });
```

D&D 5e 2024: Grapple/shove step 2 is a **Saving Throw**, not an ability check. A saving throw = d20 + ability modifier + **proficiency bonus** (if proficient in that save type). The domain code omits proficiency entirely.

**The tabletop path** (via `SavingThrowResolver`) correctly computes save proficiency (lines ~155-170 in saving-throw-resolver.ts: looks up `saveProficiencies`, adds proficiency bonus when proficient). So the tabletop path would give correct results.

**The programmatic path** (AI via `GrappleActionHandler` → `grappleTarget()` → `resolveUnarmedStrike()`) does NOT include proficiency. A Fighter with +2 DEX and proficiency in DEX saves should have a DEX save modifier of +2 + prof, but the programmatic path only uses +2.

This creates divergent behavior: the exact same grapple scenario produces different save totals depending on whether it goes through the tabletop or programmatic path.

**Fix (two options)**:
1. **(Minimal, this PR)** Add a `targetSaveProficiencyBonus?: number` field to `GrappleShoveOptions`. In `resolveUnarmedStrike()`, pass it through to `abilityCheck()` as `proficiencyBonus` + `proficient: true`. In `GrappleActionHandler`, compute the save proficiency from `targetStats.saveProficiencies` before calling the domain function.
2. **(Deferred)** Document as a known bug/TODO. The programmatic path (AI) currently ignores save proficiency for grapple/shove. This is pre-existing and orthogonal to the advantage fix. But it MUST be documented to avoid confusion when the two paths produce different outcomes.

At minimum: the plan should acknowledge this divergence and add a TODO.

---

### Issue 4: Target save ability selection ignores proficiency (affects WHICH ability is picked)

Related to Issue 3. The domain picks the save ability via:
```typescript
const useDex = targetDexMod > targetStrMod;
```

But D&D 5e 2024 says the target chooses which save (STR or DEX). A rational target picks the HIGHER **save modifier** — which includes proficiency. Example:
- Target has STR 14 (+2 mod), DEX 12 (+1 mod), proficient in DEX saves, proficiency bonus +3
- Raw mod comparison: STR +2 > DEX +1 → domain picks STR ❌
- Save mod comparison: STR +2 < DEX (+1 + 3 = +4) → target should pick DEX ✅

The tabletop path (SavingThrowResolver) doesn't make a choice — it resolves whatever ability is specified in the `SavingThrowPendingAction`. So the choosing logic lives in `RollStateMachine.handleAttackRoll()` contest branch. 

The plan says: "Compute which ability the target saves with (STR or DEX — use higher modifier, matching domain `resolveUnarmedStrike()` logic)". This matches the BUGGY domain logic.

**Fix**: In both the contest branch (RollStateMachine) and (if the programmatic path is fixed) the domain/handler, compute the full save modifier (ability + proficiency if proficient) for each ability, THEN pick the higher one. The `SavingThrowResolver` already knows how to compute save modifiers, so the RollStateMachine can reuse that calculation when building the `SavingThrowPendingAction`.

---

### Issue 5: Restrained DEX save disadvantage logic needs explicit specification

The plan lists this as a task:
> Fix `.grapple()` save disadvantage: Check Restrained → DEX disadvantage for target save mode computation.

But the logic is non-trivial and unspecified:
1. First determine which ability the target picks (STR or DEX, accounting for proficiency per Issue 4)
2. If the target picks DEX AND is Restrained → `targetSaveMode: "disadvantage"`
3. If the target picks STR → Restrained doesn't apply (no STR save disadvantage on Restrained)

For the programmatic path: The handler must pre-compute the save ability choice, then check `savingThrowDisadvantage` from the target's conditions for that specific ability.

For the tabletop path: `SavingThrowResolver` already checks `hasEffectDisadvantage` from ActiveEffects but does **not** currently check condition-based `savingThrowDisadvantage`. Let me check...

Actually, `SavingThrowResolver.resolve()` checks `hasDisadvantageFromEffects(filteredEffects, 'saving_throws', saveAbility)` — this only checks **ActiveEffects**, not **Conditions**. Restrained's `savingThrowDisadvantage: ['dexterity']` is a **Condition effect**, not an ActiveEffect. So `SavingThrowResolver` also misses this!

**Fix**: Add condition-based saving throw disadvantage checking to `SavingThrowResolver.resolve()`. After the ActiveEffect disadvantage check, also check the target's conditions:
```typescript
const targetConditions = normalizeConditions(targetCombatantForEffects?.conditions ?? []);
const conditionSaveDisadvantage = targetConditions.some(c => {
  const effects = getConditionEffects(c.condition);
  return effects.savingThrowDisadvantage.includes(action.ability as Ability);
});
if (conditionSaveDisadvantage) hasEffectDisadvantage = true;
```

This fixes both the grapple/shove case (Restrained → DEX save disadvantage) AND any other future save that needs this (it's a general fix).

---

## Missing Context

1. **`SavingThrowResolver` does not currently check condition-based `savingThrowDisadvantage`** — This is a pre-existing gap that affects ALL saving throws against Restrained targets (not just grapple/shove). The plan should fix this in SavingThrowResolver as the canonical fix, rather than adding special-case logic in GrappleHandlers or GrappleActionHandler.

2. **The `abilityCheck()` function in `grapple-shove.ts` is semantically wrong for a saving throw** — Per D&D 5e 2024, the grapple/shove step 2 is explicitly a "Saving Throw", which includes save proficiency and natural 1/20 save rules (2024: nat 1 always fails, nat 20 always succeeds on saves). The domain's `abilityCheck()` doesn't handle natural 1/20 for saves (that's `isSavingThrowSuccess()` in advantage.ts). This means the programmatic path also misses nat 1/20 auto-fail/success on the save step.

3. **No consumers of `resolveGrapple`/`resolveShove` exist outside `grapple-action-handler.ts`** — Confirmed. Only one consumer of each domain function.

## Suggested Changes

1. **Use `deriveRollModeFromConditions()` in `GrappleActionHandler`** for attack roll advantage instead of reimplementing inline. Fixes Issue 1 and Issue 2 simultaneously.

2. **Add a TODO for save proficiency** in the domain `resolveUnarmedStrike()` or `GrappleActionHandler`. At minimum, document the divergence. Ideally fix in this PR since the tabletop fork introduces the discrepancy.

3. **Fix condition-based `savingThrowDisadvantage` in `SavingThrowResolver`** — Add condition checking alongside the existing ActiveEffect checking. This is the right layer for the fix (centralized, affects all saves).

4. **In `RollStateMachine` contest branch**: When picking the target's save ability, compute full save modifiers (ability + proficiency) for both STR and DEX, then pick the higher one. Pass the chosen ability to `SavingThrowPendingAction`.

5. **Correct `getProneAttackModifier` call** in all plan code blocks to `(conditions, distanceFt, attackKind)`.

6. **`hasAutoFailStrDexSaves()` helper**: Confirmed sufficient. Covers Paralyzed, Petrified, Stunned, Unconscious — all four conditions with `autoFailStrDexSaves: true`. ✅

7. **Paralyzed auto-crit**: Correctly noted as narrative-only for grapple (no damage). Standard `autoFail` on save handles it. ✅

8. **Domain `grapple-shove.ts` changes needed**: Consider adding `targetSaveProficiencyBonus` to `GrappleShoveOptions` and switching from `abilityCheck()` to a proper save roll (using `isSavingThrowSuccess()` for nat 1/20 handling). Without this, the programmatic path will lack:
   - Save proficiency
   - Natural 1/20 on saves
   - `savingThrowDisadvantage` condition check (Restrained DEX)

   These are all handled correctly by `SavingThrowResolver` on the tabletop path, creating an asymmetry.
-->

