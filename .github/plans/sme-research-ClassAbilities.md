# SME Research — ClassAbilities — EM-M1: Basic Multiclassing Support

## Summary

The ClassAbilities flow is **deeply single-class-centric**. Nearly every function takes a single `classId` + `level` pair. The multi-class-ready `hasFeature(classLevels[], feature)` in registry.ts exists but has **zero callers** — all 16+ usage sites call `classHasFeature(singleClassId, feature, level)` instead.

---

## Affected Files & Why

### 1. `domain/entities/classes/registry.ts`
- **`hasFeature(classLevels, feature)`** (line 125) — already multi-class-ready. Takes `Array<{classId, level}>`, calls `classLevels.some(({classId, level}) => classHasFeature(...))`. Currently **zero callers**.
- **`classHasFeature(classId, feature, level, subclassId?)`** — single-class check. Called ~16 times across combat services. These callers extract a single `actorClassName` + `actorLevel`.
- **`getCriticalHitThreshold(classId, classLevel, subclassId?)`** — single-class. Multiclass Fighter 3/Rogue 5 Champion needs Fighter class level for Improved Critical threshold.
- **`getArmorTrainingForClass(classId)`** — single-class. Multiclass needs union of all classes' armor training.

### 2. `domain/entities/classes/class-feature-resolver.ts`
- **`getAttacksPerAction(sheet, className, level)`** — takes single className + level. For multiclass, Extra Attack comes from a **specific class** (Fighter 5, Monk 5, etc.), but the level checked must be the **class level**, not character level. D&D 5e rule: Extra Attack does NOT stack across classes.
- **`getUnarmedStrikeStats(sheet, className, level)`** — checks `MARTIAL_ARTS` via single classHasFeature. For multiclass Monk, needs Monk **class level** for martial arts die size.
- **`getClassCapabilities(sheet, className, level)`** — returns capabilities for one class. Multiclass needs union from all classes.
- **`getProficiencyBonus(sheet, level)`** — uses total character level. ✅ Already correct for multiclass.
- **`hasOpenHandTechnique(sheet, className, subclass, level)`** — single class. Correct for Monk class level check, but callers pass total level.

### 3. `domain/entities/classes/combat-resource-builder.ts`
- **`buildCombatResources({className, level, sheet})`** — takes single className + level. Calls `getClassDefinition(classId).resourcesAtLevel(level, abilityModifiers)`.
- Multiclass needs: iterate all class entries, call each class's `resourcesAtLevel()` with **class-specific level**, merge pools.
- **Warlock pact magic** (line 148): hardcoded `if (classId === "warlock")` — works for multiclass because it explicitly checks Warlock.
- **Spell slots** (line 119): from sheet, not class — ✅ already class-agnostic.

### 4. `domain/entities/classes/combat-text-profile.ts`
- **`tryMatchClassAction(text, profiles)`** — scans ALL profiles regardless of class. ✅ Already multiclass-compatible (comment: "class eligibility is validated later by the AbilityRegistry executor").
- **`matchAttackEnhancements(..., classId, level, ...)`** — filters by single `classId`. Multiclass Monk 5/Fighter 3 needs Monk's classId + Monk's level for Stunning Strike.
- **`getEligibleOnHitEnhancements(..., classId, level, ...)`** — same single-classId filter.
- **`detectAttackReactions(input, profiles)`** — `AttackReactionInput` has single `className` + `level`. Each reaction's `detect()` checks its own class eligibility internally. Multiclass needs to run for each class entry.
- **`detectDamageReactions/detectSpellReactions`** — same pattern as attack reactions.

### 5. `domain/entities/classes/feature-keys.ts`
- No changes needed. Feature keys are strings, class-agnostic. ✅

### 6. `domain/rules/class-resources.ts`
- **`defaultResourcePoolsForClass({classId, level})`** — single class. Multiclass needs iteration + merge.

### 7. `domain/rules/rest.ts`
- **`refreshClassResourcePools({classId, level, rest, pools})`** — single class. Multiclass needs each class's refresh policy applied to its pools.

### 8. `application/services/combat/abilities/executors/executor-helpers.ts`
- **`extractClassInfo(params)`** — returns single `{level, className}`. Currently resolves from `params.className → sheet.className → actor.getClassId()`.
- **`requireClassFeature(params, featureKey)`** — uses extractClassInfo then classHasFeature. For multiclass, would need to check the **correct class** for the feature — i.e., Fighter's Action Surge needs Fighter level, not total level.
- This is the **central executor entry point** — all 14 executors use it. Fixing here cascades to all executors.

### 9. `domain/entities/creatures/character.ts` (CharacterData + Character)
- **`characterClass: string`** — stores single class name
- **`classId?: CharacterClassId`** — stores single classId
- **`level: number`** — stores single total level (ambiguous: is it class level or character level?)
- **`getClass()`, `getClassId()`, `getLevel()`** — single-value returns
- **`getAC()`** — line ~290: checks `classHasFeature(this.classId, UNARMORED_DEFENSE, this.level)` — uses total level, should use class level for feature threshold check (minor: both Barbarian and Monk get it at level 1, so total level ≥ 1 always passes)
- **`takeRest(rest)`** — calls `refreshClassResourcePools({classId: this.classId, level: this.level})` — single class. Multiclass needs per-class refresh.
- **`levelUp()`** — assumes single class progression. Multiclass needs to specify which class to advance.

---

## Key Patterns Relevant to This Task

### Pattern A: "className + level" pair propagation
Combat services extract `actorClassName` + `actorLevel` from combatant records. This pair flows through:
`combatant-resolver.ts` → tabletop types → `classHasFeature(actorClassName, feature, actorLevel)`

For multiclass, `actorLevel` is ambiguous — is it the Fighter level or total level? Nearly every callsite treats it as total character level, but `classHasFeature` compares it against the class feature's required level. This works today because single-class means class level = character level. **Multiclass breaks this assumption.**

### Pattern B: CombatResourceBuilder single-class delegation
`buildCombatResources()` calls `classDef.resourcesAtLevel(level)` for one class. Multiclass needs to iterate all class entries and merge resource pools (without double-counting spell slots).

### Pattern C: Reaction detection single className
`AttackReactionInput.className` is a single string. A Monk 3/Wizard 5 character needs both Deflect Attacks (from Monk) and Shield (from Wizard) detected. The `detect()` functions in each profile check their own class fields — but they only get called if the input `className` matches or the function scans all profiles.

**Good news**: `detectAttackReactions()` already iterates ALL profiles and calls each `detect()` — so if the `detect()` functions use `classHasFeature` internally with their own classId, it could work. Need to verify each detect() implementation.

### Pattern D: Proficiency bonus uses total level
`proficiencyBonusByLevel(level)` uses total character level regardless of class split. ✅ Already correct.

---

## Dependencies That Could Break

1. **Every `classHasFeature(className, feature, level)` callsite** — if `level` becomes class-specific instead of total, callers need to know which class to check for which feature. Currently hardcoded patterns like `classHasFeature(actorClassName, SNEAK_ATTACK, actorLevel)` assume the actorClassName IS the right class for SNEAK_ATTACK.

2. **CombatResourceBuilder** — assumes single class. If a Fighter 5/Wizard 5 enters combat, both class's resourcesAtLevel() must be called with their respective class levels.

3. **Rest refresh** — `refreshClassResourcePools` takes single classId. A multiclass character's resource pools come from multiple classes; each pool needs its own class's refresh policy.

4. **Character entity getAC()** — checks UNARMORED_DEFENSE for single classId. A Monk 1/Barbarian 1 (unlikely but legal) would need to choose which unarmored defense applies.

5. **Hit point calculation** — `maxHitPoints({hitDie})` uses a single hit die. Multiclass levels use different hit dice per class.

---

## Risks

1. **Scope creep**: Full multiclass support touches almost every system. Recommend "basic" scope = multiple class entries with per-class levels, but defer complex interaction rules (spell slot merging, proficiency stacking) to later milestones.

2. **Backward compatibility of combat state**: Existing combatant records in encounters store a single `className`. Need migration path for active games.

3. **Performance in reaction detection**: Currently O(profiles × reactions). With multiclass, if we call detection once per class entry, it's still O(classes × profiles × reactions) — negligible.

4. **The `extractClassInfo()` helper in executors is the highest-risk change** — it's the centralized chokepoint for all 14 executors. Getting this wrong breaks every class ability. Recommend: expand to return `classLevels: Array<{classId, level}>` and add a `findClassLevel(classId)` helper.

---

## Recommendations

1. **Add `classLevels: Array<{classId: CharacterClassId, level: number}>` to CharacterData** alongside existing `characterClass`/`classId` for backwards compat. Derive single-class from it when present.

2. **Expand `extractClassInfo()` in executor-helpers.ts** to support `classLevels` array. Add `findClassForFeature(classLevels, featureKey)` that returns the matching class+level pair.

3. **Keep `classHasFeature(classId, feature, classLevel)` unchanged** — it already takes class-specific level. The fix is at the **callsite** level: callers need to pass the correct class's level, not total level.

4. **Expand `buildCombatResources()`** to accept `classLevels` array and iterate each class's `resourcesAtLevel()`.

5. **The `matchAttackEnhancements()` and `getEligibleOnHitEnhancements()` functions** need to accept `classLevels` or be called once per class entry. Prefer the latter to keep function signatures simple.

6. **Defer**: Multiclass spell slot merging, multiclass proficiency stacking, multiclass fighting style conflicts, multiclass Extra Attack stacking prohibition. These are CombatRules/SpellSystem concerns.
