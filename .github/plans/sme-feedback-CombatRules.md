# SME Feedback — CombatRules — Round 1

## Verdict: APPROVED

## Feedback

### 1. No domain rules file changes needed — CONFIRMED

The plan correctly identifies that **zero** files in `domain/rules/`, `domain/combat/`, or `domain/effects/` require modification. Every change in the plan targets either `domain/entities/classes/` (ClassAbilities flow) or `application/services/` (CombatOrchestration flow). Specifically verified:

- `domain/rules/damage-defenses.ts` — untouched. `applyDamageDefenses()` is a generic pure function; Rage resistance flows through the `ActiveEffect` → `getDamageDefenseEffects()` pipeline at the application layer.
- `domain/combat/attack-resolver.ts` — untouched. `resolveAttack()` calls `target.getAC()` which reads the stored `armorClass` value. No runtime override needed.
- `domain/combat/initiative.ts` — untouched. The simple `rollInitiative()` function has no advantage/disadvantage support, and Feral Instinct is correctly scoped to the application-layer `computeInitiativeRollMode()` (the tabletop flow's primary initiative path).
- `domain/rules/saving-throws.ts` — untouched. The plan correctly flags the pre-existing `Math.random()` issue as out of scope.
- `domain/entities/combat/effects.ts` — untouched. The generic `hasAdvantageFromEffects()` function stays class-agnostic. Danger Sense gating is handled in the application layer's `SavingThrowResolver`.

### 2. Damage resistance via ActiveEffects — VERIFIED CORRECT

The `RageExecutor` creates three `ActiveEffect` objects (`type: "resistance"`, `damageType: "bludgeoning"/"piercing"/"slashing"`, `source: "Rage"`). All four damage resolution paths consume these identically via `getDamageDefenseEffects()` → `applyDamageDefenses()`:
- `roll-state-machine.ts` (~L1620) — tabletop player attacks
- `ai-action-executor.ts` (~L635) — AI attacks
- `two-phase-action-service.ts` (~L694) — opportunity attacks
- `action-service.ts` (~L602) — programmatic actions

No domain rules changes needed. The pipeline is class-agnostic.

### 3. AC computation approach (sheet-level) — SOUND

The plan uses Option A: compute `10 + DEX mod + CON mod` at character creation/generation and store as `sheet.armorClass`. This matches the existing Monk Unarmored Defense pattern in the mock generator. Both AC paths are satisfied:
- Path A (domain `getAC()`): falls back to `this.armorClass` for unarmored creatures — correct.
- Path B (tabletop flow): reads `sheet.armorClass` directly — correct.

The domain helper `barbarianUnarmoredDefenseAC(dexMod, conMod)` is a pure computation used at creation time, not during combat, which is the right approach.

### 4. Pure functions in barbarian.ts — CORRECT PATTERN

All four proposed functions are pure predicates/computations with no side effects:
- `barbarianUnarmoredDefenseAC(dexMod, conMod)` → `10 + dexMod + conMod`
- `hasDangerSense(level)` → `level >= 2`
- `hasFeralInstinct(level)` → `level >= 7`
- `shouldRageEnd(attacked, tookDamage, isUnconscious)` → `(!attacked && !tookDamage) || isUnconscious`

These follow the existing pattern in `barbarian.ts` (e.g., `rageUsesForLevel()`, `rageDamageBonusForLevel()`). They live in `domain/entities/classes/barbarian.ts`, which is the correct location per the domain-first principle — class-specific detection stays in domain class files.

### 5. No accidental domain rules modifications — CONFIRMED

Every file in the plan's "Changes" section falls outside `domain/rules/**`, `domain/combat/**`, and `domain/effects/**`. The only `domain/` files touched are `domain/entities/classes/barbarian.ts` and `domain/entities/classes/class-feature-resolver.ts`, which belong to the ClassAbilities flow.

## Minor Advisory Notes (non-blocking)

1. **Danger Sense condition gating implementation detail**: The plan says "small filter in the existing `hasAdvantageFromEffects` result handling" in `SavingThrowResolver`. Since `hasAdvantageFromEffects()` returns a `boolean`, the implementer can't filter its return value. The actual implementation should **filter the effects array before** calling `hasAdvantageFromEffects` — removing any effect with `source === "Danger Sense"` when the target has Blinded/Deafened/Incapacitated conditions. This keeps the domain function generic while handling the class-specific gating in the application layer. Not a plan flaw, just a clarification for the implementer.

2. **Domain `rollInitiative()` gap**: The domain-layer `rollInitiative()` in `domain/combat/initiative.ts` has no advantage/disadvantage support. The plan correctly scopes Feral Instinct to the application-layer `computeInitiativeRollMode()` only. If any future combat path uses the domain function, Barbarians won't get initiative advantage there. This is acceptable since the tabletop flow is the primary path, but worth documenting as a known limitation.

## Issues
None blocking.

## Suggested Changes
None required.
