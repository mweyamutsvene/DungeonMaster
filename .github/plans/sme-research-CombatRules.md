# SME Research — CombatRules — Barbarian Phase 8.1

**Date**: 2026-03-18  
**Subject**: Barbarian class feature coverage gaps as they relate to domain rules layer

---

## 1. Damage Resistance (Rage B/P/S Resistance)

### Current State: ✅ ALREADY WORKING

The Rage Executor (`rage-executor.ts`) already creates three `ActiveEffect` objects with `type: "resistance"` for bludgeoning, piercing, and slashing:

```ts
createEffect(nanoid(), "resistance", "custom", "permanent", {
  damageType: "bludgeoning", source: "Rage", ...
}),
// ... same for piercing, slashing
```

**How it flows through damage resolution**:

1. `roll-state-machine.ts` (line ~1613) fetches target's `ActiveEffect[]` via `getActiveEffects(targetCombatant.resources)`.
2. Calls `getDamageDefenseEffects(tgtEffects, damageType)` from `domain/entities/combat/effects.ts` (line ~344).
3. If `effDef.resistances` is true, merges the damage type into `defenses.damageResistances`.
4. Then calls `applyDamageDefenses(totalDamage, damageType, defenses)` from `domain/rules/damage-defenses.ts`.
5. `applyDamageDefenses` is a pure function: returns `Math.floor(damage / 2)` for resistance.

**Same pattern exists in**: `ai-action-executor.ts` (line ~627), `two-phase-action-service.ts` (line ~692), `action-service.ts` (line ~602).

**Domain layer** (`damage-defenses.ts`): Pure function, 100 lines. Takes `DamageDefenses` interface (arrays of string damage types) and applies immunity > resistance > vulnerability priority. No changes needed here.

**Verdict**: Rage damage resistance is fully functional via the ActiveEffect pipeline. No domain rules changes needed for this feature.

---

## 2. Unarmored Defense (AC = 10 + DEX + CON)

### Current State: ❌ NOT IMPLEMENTED for Barbarian

**How AC is computed today**:

There are **two separate AC computation paths**:

#### Path A: Domain `Creature.getAC()` (creature.ts, line ~98)
```ts
getAC(): number {
  if (!this.equipment?.armor && !this.equipment?.shield) {
    return this.armorClass;  // Falls back to stored flat number
  }
  // Equipment-based calculation: base + (capped) DEX modifier + shield
}
```

- `Character.getAC()` (character.ts, line ~209) overrides to add feat-based AC bonuses (Defense fighting style).
- For **unarmored** characters without equipment data, it returns the stored `this.armorClass` value.
- **This domain path is used by `resolveAttack()`** (attack-resolver.ts line ~127: `target.getAC()`).

#### Path B: Application-layer flat lookup (roll-state-machine.ts, line ~1047)
```ts
const baseAC = (target as any).statBlock?.armorClass || (target as any).sheet?.armorClass || 10;
```

- The tabletop flow reads AC directly from the stored sheet/statBlock data.
- It then adds `ActiveEffect` AC bonuses (Shield spell, etc.) via `calculateFlatBonusFromEffects(targetEffects, 'armor_class')`.

**Where Unarmored Defense should hook in**:

There are two possible approaches:

**Option A (Preferred — compute at sheet creation time)**: When a Barbarian character is created/generated, compute Unarmored Defense AC (`10 + DEX mod + CON mod`) and store it as `armorClass` in the sheet. This is how Monk Unarmored Defense works in the mock generator (llm/mocks/index.ts line ~641). Pro: No changes to AC lookup paths. Con: Must be done everywhere sheets are created (character generator, test scenarios, manual creation).

**Option B (Systematic — domain override)**: Override `getAC()` in `Character` to check `classId === "barbarian"` and compute `10 + DEX + CON` when no armor is equipped. This only helps Path A (domain `resolveAttack`). Path B (tabletop flow) would still need patching.

**Option C (ActiveEffect)**: Apply a permanent `bonus` effect to `armor_class` during combat initialization. Works for Path B but feels wrong for a passive class feature.

### Risk Assessment
- The tabletop flow (Path B) is the **primary combat path** used in the game. It reads `sheet.armorClass` directly.
- The domain `resolveAttack` path (Path A) is used for programmatic combat and some integration tests.
- **Both paths must be consistent** — if implementing in the domain, must also ensure Path B gets the correct value.
- The simplest correct approach is **Option A**: compute the correct AC at character creation/generation time. The domain `barbarian.ts` should export a helper like `barbarianUnarmoredDefenseAC(dexMod, conMod)` that the character generator and test harness call.
- Alternatively, a hybrid: add the computation to `Character.getAC()` (domain), AND ensure the sheet `armorClass` stored value is correct so Path B also works.

---

## 3. Saving Throw Advantage (Danger Sense)

### Current State: ❌ NOT IMPLEMENTED

**How saving throws work today**:

There are **two saving throw systems**:

#### System 1: `domain/rules/ability-checks.ts` → `savingThrowForCreature()`
- Pure function: `savingThrow(diceRoller, dc, abilityModifier, mode)`.
- Calls `getAdjustedMode()` which checks `creature.getD20TestModeForAbility()` (armor training penalty).
- Used by `concentration.ts` for concentration saves.

#### System 2: `domain/rules/saving-throws.ts` → `makeSavingThrow()`
- Self-contained, uses `Math.random()` (not deterministic!).
- Takes `advantage` and `disadvantage` booleans directly.
- Appears to be an older/standalone system.

#### System 3 (application layer): `saving-throw-resolver.ts`
- The primary saving throw handler in the tabletop flow.
- **Already checks ActiveEffects** for advantage/disadvantage:
  ```ts
  const hasEffectAdvantage = hasAdvantageFromEffects(targetEffects, 'saving_throws', saveAbility);
  const hasEffectDisadvantage = hasDisadvantageFromEffects(targetEffects, 'saving_throws', saveAbility);
  ```
- This is the path that Danger Sense would flow through.

**How Danger Sense should work**:

Per D&D 5e 2024: Advantage on DEX saving throws against effects you can see. Does NOT apply if Blinded, Deafened, or Incapacitated.

**Implementation approach**:
1. **Domain declaration** (`barbarian.ts`): Export a `hasDangerSense(level)` function → true at level 2+.
2. **ActiveEffect at combat init**: During `handleInitiativeRoll()`, if the character is a Barbarian level 2+, add a permanent `advantage` effect on `saving_throws` with `ability: "dexterity"`.
3. **Condition gating**: This is the tricky part. The effect is permanent but should be suppressed when the Barbarian is Blinded, Deafened, or Incapacitated. Two sub-approaches:
   - **Pre-check in SavingThrowResolver**: Before applying the advantage, check the creature's conditions. If Blinded/Deafened/Incapacitated, skip the advantage effect with source "Danger Sense".
   - **Conditional ActiveEffect**: Add a `conditionGate` field to ActiveEffect that lists conditions that suppress it. More general but adds complexity to the effect system.

**Condition system for gating** (`domain/entities/combat/conditions.ts`):
- `Condition` type includes `'Blinded'`, `'Deafened'`, `'Incapacitated'` (and all standard 5e conditions).
- `getConditionEffects(condition)` returns mechanical effects (`cannotSee`, `cannotHear`, `cannotTakeActions`).
- Conditions are stored as `Set<string>` on Creature (lowercase).
- In the combatant data model, conditions are tracked as `ActiveCondition[]` with duration metadata.

**Risk**: The "against effects you can see" clause is ambiguous in a grid-based system. For practical purposes, we should treat it as "always active unless Blinded/Deafened/Incapacitated", which is the standard interpretation.

---

## 4. Extra Attack (Barbarian Lv 5)

### Current State: ✅ ALREADY IMPLEMENTED (class-agnostic)

`ClassFeatureResolver.hasMartialExtraAttack()` includes `"barbarian"` in the list. `ClassFeatureResolver.getAttacksPerAction()` returns 2 at level 5+ for all martial classes.

In the tabletop flow, `action-dispatcher.ts` (line ~2336) calls:
```ts
const attacksPerAction = ClassFeatureResolver.getAttacksPerAction(actorSheet, actorClassName, actorLevel);
if (attacksPerAction > 1) {
  currentResources = setAttacksAllowed(currentResources, attacksPerAction);
}
```

**Verdict**: No domain or application changes needed. Just needs E2E scenario verification.

---

## 5. Rage End Mechanics

### Current State: ❌ NOT IMPLEMENTED

**Rules**: Rage ends if:
- (a) The Barbarian didn't attack a hostile creature or take damage since the start of their last turn
- (b) The Barbarian falls unconscious

**What exists today**: 
- The Rage Executor creates effects with `duration: "permanent"` (meaning until removed).
- There is no turn-end check that evaluates whether the Barbarian attacked or took damage.
- `rage-executor.ts` sets `raging: true` on resources as a flag.

**What needs to exist**:
- A tracking mechanism: `lastTurnAttackedOrTookDamage` flag on resources, updated whenever the Barbarian attacks or takes damage during their turn.
- A turn-start or turn-end hook that checks whether rage should end.
- An unconscious check: when a Barbarian drops to 0 HP, end rage immediately.

**Domain rules impact**:
- This is primarily an **application-layer** concern (turn management, state tracking). The domain doesn't track turn progression.
- The domain could export a pure function `shouldRageEnd(raging, attackedThisTurn, tookDamageThisTurn, isUnconscious)` for clarity.
- The existing `endRage()` function in `barbarian.ts` handles the state transition.

**Risk**: Turn tracking (`lastTurnAttackedOrTookDamage`) requires changes to:
- Attack resolution flow — set flag when Barbarian attacks
- Damage application flow — set flag when Barbarian takes damage
- Turn advancement flow — check flag and end rage if absent

This touches multiple application-layer files but **no domain rules files** directly.

---

## 6. Feral Instinct (Lv 7) — Initiative Advantage

### Current State: ❌ NOT IMPLEMENTED

**How initiative advantage works today**:

There are **two initiative flows**:

#### Flow A: Domain `Creature.rollInitiative()` (creature.ts, line ~276)
```ts
rollInitiative(diceRoller: DiceRoller): number {
  return diceRoller.d20(this.getInitiativeModifier()).total;
}
```
- Always rolls normal (no advantage/disadvantage support).
- Used by `domain/combat/initiative.ts → rollInitiative()`.
- `Character.getInitiativeModifier()` adds Alert feat proficiency bonus.

#### Flow B: Tabletop `computeInitiativeRollMode()` (roll-state-machine.ts, line ~131)
- Application-layer function that computes advantage/disadvantage from surprise and conditions.
- Returns `"normal" | "advantage" | "disadvantage"`.
- Feeds into `rollInitiativeD20()` which rolls 2d20 for advantage/disadvantage.
- **Does NOT currently check class features** (Feral Instinct, etc.).

There's ALSO `computeInitiativeModifiers()` (tabletop-combat-service.ts, line ~87) — a SEPARATE function for the initiating player's roll. It checks surprise + conditions but NOT class features.

**Implementation approach**:

**Domain side**: Export `hasFeral Instinct(level)` from `barbarian.ts` → true at level 7+.

**Application side**: In both `computeInitiativeRollMode()` and `computeInitiativeModifiers()`:
- Look up the character's class and level.
- If Barbarian level 7+, add an advantage source.
- Feral Instinct also grants can't-be-surprised — need to check if the surprise system allows per-creature overrides (it does: `SurpriseSpec` can be `{ surprised: string[] }` which lists surprised creature IDs).

**Domain initiative functions** (`creature.ts`, `initiative.ts`) have no advantage/disadvantage support and would need modification OR we accept that initiative advantage is handled entirely at the application layer (which is the current pattern for surprise-based disadvantage).

**Risk**: The initiative system has two parallel implementations:
1. Domain `rollInitiative()` — simple, no advantage support
2. Application `computeInitiativeRollMode()` + `rollInitiativeD20()` — full advantage support

Feral Instinct should be added to approach #2 (application layer) since that's the one actually used in the tabletop combat flow. The domain `rollInitiative()` is used by the programmatic combat path and would need separate handling if consistency is required.

---

## Summary of Domain Rules Layer Impact

| Feature | Domain Changes Needed | Application Changes Needed |
|---------|----------------------|---------------------------|
| Rage Damage Resistance | **None** — already works via ActiveEffects | **None** — already works |
| Unarmored Defense | `barbarian.ts`: export AC calculation helper | Character creation/generation, mock generator |
| Danger Sense | `barbarian.ts`: export `hasDangerSense(level)` | `handleInitiativeRoll()`: add ActiveEffect; `saving-throw-resolver.ts`: condition gating |
| Extra Attack | **None** — already class-agnostic | **None** — already works |
| Rage End Mechanics | `barbarian.ts`: export `shouldRageEnd()` pure function | Turn management, attack/damage tracking |
| Feral Instinct | `barbarian.ts`: export `hasFeralInstinct(level)` | `computeInitiativeRollMode()`, `computeInitiativeModifiers()` |

## Concerns and Risks

1. **AC computation dual-path problem (Unarmored Defense)**: The tabletop flow reads `sheet.armorClass` directly (Path B), bypassing domain `getAC()`. Any AC-computation change must address both paths, OR we ensure the stored `armorClass` value is correct at creation time.

2. **Danger Sense condition gating has no precedent**: No existing ActiveEffect is conditionally suppressed by the bearer's conditions. This is new territory for the effect system. The simplest path is a special-case check in `SavingThrowResolver` (check conditions before applying Danger Sense advantage), but a general-purpose `conditionGate` on effects would be more extensible.

3. **Two parallel initiative systems**: Domain `rollInitiative()` vs application `computeInitiativeRollMode()`. Feral Instinct only needs the application layer, but if some combat path uses the domain function, the Barbarian won't get advantage. This is acceptable given the architecture — the tabletop flow is the primary path.

4. **`saving-throws.ts` uses `Math.random()`**: The standalone `makeSavingThrow()` in `domain/rules/saving-throws.ts` uses `Math.random()` directly, bypassing the `DiceRoller` abstraction. This is NOT deterministic and should NOT be used in production combat flows. The `SavingThrowResolver` (application layer) and `savingThrowForCreature` (`ability-checks.ts`) use `DiceRoller` correctly. **This is a pre-existing issue, not introduced by Barbarian features.**

5. **Rage end mechanics are purely application-layer**: Tracking whether a Barbarian attacked or took damage per turn requires state that only the application layer maintains. The domain can provide a pure decision function, but all the wiring is in the tabletop flow.

6. **Feral Instinct "can't be surprised"**: The surprise system (`SurpriseSpec`) supports per-creature surprise via `{ surprised: string[] }`. When computing surprise, a Barbarian with Feral Instinct (level 7+, not Incapacitated) should be excluded from the surprised list. This is a separate concern from initiative advantage.
