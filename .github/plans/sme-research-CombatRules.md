# SME Research — CombatRules — Rules Primitives Audit for L1–5 Class Features

As you wish Papi....

## Scope
- Files reviewed: `domain/rules/` (60+), `domain/combat/attack-resolver.ts`, `domain/entities/combat/conditions.ts`, `application/services/combat/tabletop/roll-state-machine.ts`, `application/services/combat/tabletop/dispatch/attack-handlers.ts`, `application/services/combat/tabletop/combat-text-parser.ts`, `application/services/combat/tabletop/rolls/saving-throw-resolver.ts`, `application/services/combat/tabletop/spell-delivery/save-spell-delivery-handler.ts`, `application/services/combat/tabletop/dispatch/class-ability-handlers.ts`, `application/services/combat/abilities/executors/paladin/lay-on-hands-executor.ts`, `application/services/combat/abilities/executors/fighter/second-wind-executor.ts`, `domain/entities/classes/barbarian.ts`, `domain/entities/classes/paladin.ts`, `domain/rules/evasion.ts`, `domain/rules/movement.ts`.
- Task: Validate rules primitives that L1–5 class features depend on; identify gaps that block class-ability E2E tests.

## Implemented & Working Primitives (one-line)
- D20 core: `rollD20` / `d20Test` / `savingThrowTest` (nat-20 auto-pass, nat-1 auto-fail for saves) — [advantage.ts](packages/game-server/src/domain/rules/advantage.ts#L10-L95).
- Crit range lookup is live in tabletop: `getCriticalHitThreshold(classId, level, subclassId)` used at [roll-state-machine.ts](packages/game-server/src/application/services/combat/tabletop/roll-state-machine.ts#L472-L488) AND domain `resolveAttack()` — [attack-resolver.ts](packages/game-server/src/domain/combat/attack-resolver.ts#L162-L181). **GAP-7 is NOT a rules-layer gap.**
- Auto-crit on Paralyzed/Unconscious melee within 5 ft is wired in both tabletop — [roll-state-machine.ts](packages/game-server/src/application/services/combat/tabletop/roll-state-machine.ts#L489-L506) — and domain — [attack-resolver.ts](packages/game-server/src/domain/combat/attack-resolver.ts#L109-L125,L180).
- Condition → attack advantage/disadvantage aggregation: Blinded / Paralyzed / Stunned / Unconscious / Petrified / Restrained / StunningStrikePartial grant incoming advantage; Invisible/Hidden grant self advantage; Blinded/Frightened/Poisoned/Restrained/Prone impose outgoing disadvantage — [combat-text-parser.ts](packages/game-server/src/application/services/combat/tabletop/combat-text-parser.ts#L43-L82), [conditions.ts](packages/game-server/src/domain/entities/combat/conditions.ts#L140-L306).
- Prone distance-aware modifier (melee ≤5 ft → advantage, otherwise disadvantage) — [combat-text-parser.ts](packages/game-server/src/application/services/combat/tabletop/combat-text-parser.ts#L66-L73).
- Hidden attacker first-attack advantage + condition cleared on attack — [roll-state-machine.ts](packages/game-server/src/application/services/combat/tabletop/roll-state-machine.ts#L544-L560); Sneak Attack trigger consumes it.
- Flanking (optional — `mapData.flankingEnabled`), higher-ground advantage, obscuration modifiers, heavy-weapon + Small/Tiny disadvantage, ranged long-range + hostile-within-5-ft disadvantage — [attack-handlers.ts](packages/game-server/src/application/services/combat/tabletop/dispatch/attack-handlers.ts#L858-L935).
- Saving throw primitives: auto-fail STR/DEX for Stunned/Paralyzed/Petrified/Unconscious — [conditions.ts](packages/game-server/src/domain/entities/combat/conditions.ts#L425); condition-based save disadvantage; Paladin Aura of Protection; **Danger Sense ActiveEffect filter** (negated when Blinded/Deafened/Incapacitated) — [saving-throw-resolver.ts](packages/game-server/src/application/services/combat/tabletop/rolls/saving-throw-resolver.ts#L377-L430); species save advantages.
- Evasion (L7; out of L1–5 scope but working): `applyEvasion()` wired in save-spell-delivery-handler — [evasion.ts](packages/game-server/src/domain/rules/evasion.ts#L22-L50), [save-spell-delivery-handler.ts](packages/game-server/src/application/services/combat/tabletop/spell-delivery/save-spell-delivery-handler.ts#L235-L238,L637).
- Damage defenses: resistance / immunity / vulnerability + per-type additional damage routing (Divine Smite radiant add-on) — [damage-defenses.ts](packages/game-server/src/domain/rules/damage-defenses.ts), [attack-resolver.ts](packages/game-server/src/domain/combat/attack-resolver.ts#L217-L262). Rage B/P/S resistance confirmed in existing tests.
- Healing: Second Wind `1d10 + level` via `dice.rollDie(10, 1, 0)` (no auto-max) — [second-wind-executor.ts](packages/game-server/src/application/services/combat/abilities/executors/fighter/second-wind-executor.ts#L72-L83). Lay on Hands pool model (5 × paladin level) — [paladin.ts](packages/game-server/src/domain/entities/classes/paladin.ts#L14-L35).
- Movement: Difficult Terrain 0.5×, Prone crawl 0.5×, Disengage avoids OA, jump-landing DC 10 acrobatics → prone, forced movement bypasses difficult terrain — [movement.ts](packages/game-server/src/domain/rules/movement.ts#L484-L535).
- Action economy (1 action / 1 bonus / 1 reaction / speed), Extra Attack via `attacksPerAction`, Two-weapon + Nick mastery, offhand bonus-action gating — in `class-resources.ts` + `resource-utils.ts`.

## BROKEN Primitives
1. **GAP-10 — Lay on Hands cannot target a PC ally via text dispatcher.**
   - Dispatcher only scans monsters/NPCs and falls back to *nearest hostile*; characters never considered as targets — [class-ability-handlers.ts](packages/game-server/src/application/services/combat/tabletop/dispatch/class-ability-handlers.ts#L139-L188).
   - Payload field-name mismatch: handler sends `params.targetId` but executor reads `params.targetEntityId` — [class-ability-handlers.ts](packages/game-server/src/application/services/combat/tabletop/dispatch/class-ability-handlers.ts#L228-L234) vs [lay-on-hands-executor.ts](packages/game-server/src/application/services/combat/abilities/executors/paladin/lay-on-hands-executor.ts#L56). Executor always falls back to self.
   - Executor declares `allowsAllyTarget = true` but **no call site reads that flag** (grep returns zero). The hostile-only filter is hardcoded.
2. **GAP-8 — Hold Person save-to-end** (application-layer, not rules-layer). The rules primitives exist (`savingThrowTest`, `getEffectiveAbilityModifier`); the bug is in the end-of-turn save hook passing `wisdomMod = 0` and using inline RNG instead of `deps.dice`. Fix belongs in the spell/effect handler, not in `domain/rules/`.

## MISSING Primitives L1–5 class features require
- **Generic "save-to-end-condition" ActiveEffect primitive.** No `saveToEnd`, `endOfTurnSave`, or repeat-save hook exists anywhere (`grep` returns zero). Hold Person (L2 paladin/bard/cleric/wizard/warlock), Sleep (L1 wizard 2024 = incapacitated with end-of-turn CON), Tasha's Hideous Laughter, Command, Suggestion, Bane/Bless duration management all bolt this on manually → every one risks GAP-8-style bugs. Needs:
  - `ActiveEffect.saveToEnd?: { ability: Ability; dc: number; onSuccessRemoveConditions: string[] }`.
  - End-of-turn hook iterates a combatant's ActiveEffects with `saveToEnd`, calls `savingThrowTest(deps.dice, dc, effectiveMod, mode)`, removes effect + listed conditions on success.
- **"Can-see-source" visibility gate for Danger Sense.** [saving-throw-resolver.ts](packages/game-server/src/application/services/combat/tabletop/rolls/saving-throw-resolver.ts#L377-L390) correctly negates Danger Sense when Blinded/Deafened/Incapacitated but grants advantage against any DEX save regardless of source visibility. 2024 RAW requires the barbarian see the effect. Needs a `source.position`-aware check against combat map sight.
- **Danger Sense advantage is declared but never applied.** `isDangerSenseNegated` is defined in [barbarian.ts](packages/game-server/src/domain/entities/classes/barbarian.ts#L70) but **zero callers** and no ActiveEffect with `source === "Danger Sense"` is ever created (grep `Danger Sense` returns only the negation filter). L2 Barbarian DEX-save advantage silently does nothing.
- **Frightened: line-of-sight check.** Condition effects model `selfAttackDisadvantage` + `cannotMoveCloserToSource` but there's no rules helper `canSeeFearSource(combatMap, fromPos, sourcePos)` — Turn Undead (L2 cleric) and future frightening-gaze abilities need this.
- **Stand-up-from-prone costs half speed.** `PRONE: 0.5` appears as a crawl multiplier in [movement.ts](packages/game-server/src/domain/rules/movement.ts#L486) but I did not find a dedicated "stand from prone = half speed" movement cost helper; verify at dispatch layer or add.
- **Speed bonus stacking (Monk Unarmored Movement +10 L2, Barbarian Fast Movement +10 L5).** Unable to confirm these flow through `getEffectiveSpeed()` rather than being baked into sheet at hydration; flag for EntityManagement/CreatureHydration SMEs.

## Interaction Bugs
- **GAP-9 is largely stale.** Advantage vs Paralyzed/Stunned/Unconscious flows through `hasIncomingAttackAdvantage` → `deriveRollModeFromConditions` and both tabletop and domain `resolveAttack` paths honor it. Auto-crit within 5 ft is wired in both paths. The only real residual risk is a casing hazard in pure-domain `isAutoCriticalHit(target, kind, dist)`: it calls `target.hasCondition("paralyzed")` / `"unconscious"` (lowercase) while stored conditions are title-case `"Paralyzed"`/`"Unconscious"` — [attack-resolver.ts](packages/game-server/src/domain/combat/attack-resolver.ts#L119-L124), [conditions.ts](packages/game-server/src/domain/entities/combat/conditions.ts#L190). Callers that use real `Creature.hasCondition` (not a stub) may silently fail to auto-crit. **Fix: change literals to title-case `"Paralyzed"` / `"Unconscious"`.**
- **Advantage stacking correctness**: `deriveRollModeFromConditions` collapses any positive count to a single advantage/disadvantage; opposing sources cancel to normal. Correct per 2024 RAW — do not change.
- **Stunning Strike → Hold Person chaining**: Both set incoming-advantage on the target. Aggregation correctly emits a single advantage. Auto-crit fires only on Paralyzed/Unconscious (not Stunned) per RAW. No bug.
- **Pack Tactics / Flanking (2024)**: Pack Tactics lives in monster stat blocks and is NOT wired via `deriveRollModeFromConditions`; verify the Pack Tactics bonus is applied at attack-roll computation (out of L1–5 PC scope). 2024 core has no default Flanking — correctly gated behind `mapData.flankingEnabled`.

## Recommendations for GAP-7 / GAP-8 / GAP-9 / GAP-10 at the rules layer
1. **GAP-7 (Improved Critical)** — *Already implemented.* Action: reclassify in COVERAGE.md as a test-coverage gap and add a Champion L3 nat-19 E2E scenario. No rules-layer change.
2. **GAP-8 (Hold Person save-to-end)** — Fix at application layer (effect handler), not rules layer. BUT use this as the forcing function to add a generic **`ActiveEffect.saveToEnd` primitive** (see Missing Primitives). That primitive is pure + reusable for Sleep, Suggestion, Hideous Laughter. Primitive signature: `resolveSaveToEnd(dice, target, effect) → { success, totalRoll }`.
3. **GAP-9 (Advantage vs Paralyzed)** — *Mostly implemented.* Rules-layer action: fix the title-case bug in `isAutoCriticalHit` ([attack-resolver.ts L119-L124](packages/game-server/src/domain/combat/attack-resolver.ts#L119-L124)). Reclassify the remainder as a test-coverage gap.
4. **GAP-10 (Lay on Hands ally target)** — Application-layer fix, not rules:
   - In [class-ability-handlers.ts](packages/game-server/src/application/services/combat/tabletop/dispatch/class-ability-handlers.ts#L143-L188), when executor's `allowsAllyTarget === true`, also scan `combatantType === "Character"` / friendly NPCs and skip the hostile-only nearest fallback.
   - Standardize the payload key: rename `params.targetId` → `params.targetEntityId` project-wide (or change the executor to read `params.targetId`). Grep the executor base type and fix call sites together.

## Constraints & Invariants (do not violate)
- Rules modules stay pure — no Fastify/Prisma/LLM.
- `DiceRoller` is the sole randomness source; any new primitive must accept a `DiceRoller` so `QueueableDiceRoller` keeps E2E deterministic.
- Advantage/disadvantage collapse rule: any count collapses to a single source; opposing sources cancel to normal.
- Auto-crit applies only to Paralyzed/Unconscious melee within 5 ft (do not extend to Stunned).

## Top-Priority Recommendations (ordered)
1. Add generic **`ActiveEffect.saveToEnd`** primitive — unblocks GAP-8 + Sleep/Suggestion/Hideous Laughter/Command with one well-tested code path.
2. Fix **GAP-10 ally-target dispatch** — two-file fix (dispatcher filter + payload key). Unblocks Lay on Hands L1 and any future bonus-action healing on allies.
3. Fix **title-case bug in `isAutoCriticalHit`** — one-line fix closes a subtle domain-path bug and finishes GAP-9.
4. Verify **Danger Sense ActiveEffect is actually created** somewhere (suspect silent miss at L2 Barbarian).
5. Verify **Fast Movement / Unarmored Movement** speed bonuses — defer to EntityManagement / CreatureHydration SMEs.
6. Reclassify **GAP-7 and GAP-9** in COVERAGE.md as test-coverage gaps, not rules gaps.

<!-- ARCHIVED PRIOR RESEARCH BELOW -->

## GAP-7: Improved Critical in Tabletop Flow

### Root Cause
`roll-state-machine.ts::handleAttackRoll` hardcodes the crit threshold:
- [roll-state-machine.ts#L472-L475](packages/game-server/src/application/services/combat/tabletop/roll-state-machine.ts#L472-L475) — `const isCritical = rollValue === 20;`

It never consults `getCriticalHitThreshold(classId, level, subclassId)`. The AI/domain path does:
- [attack-resolver.ts#L172-L180](packages/game-server/src/domain/combat/attack-resolver.ts#L172-L180) — queries `getCriticalHitThreshold(classId, charLevel, subclassId)` and flags crit when `d20 >= critThreshold`.

Registry function supports Champion Improved (19) / Superior (18):
- [registry.ts#L193-L199](packages/game-server/src/domain/entities/classes/registry.ts#L193-L199)
- Verified by [subclass-framework.test.ts#L113-L135](packages/game-server/src/domain/entities/classes/subclass-framework.test.ts#L113-L135).

Auto-crit on melee ≤5ft vs Paralyzed/Unconscious (`isAutoCriticalHit`, [attack-resolver.ts#L113-L125](packages/game-server/src/domain/combat/attack-resolver.ts#L113-L125)) is ALSO only invoked inside domain `resolveAttack()`; the tabletop player path skips it.

### Files
- Fix site: [roll-state-machine.ts#L472-L475](packages/game-server/src/application/services/combat/tabletop/roll-state-machine.ts#L472-L475)
- Reference impl: [attack-resolver.ts#L172-L193](packages/game-server/src/domain/combat/attack-resolver.ts#L172-L193)
- Helpers available: `getCriticalHitThreshold` from `domain/entities/classes/registry.js`; `isAutoCriticalHit` exported from `domain/combat/index.ts`
- Classid extraction pattern (used in session routes): [session-characters.ts#L225](packages/game-server/src/infrastructure/api/routes/sessions/session-characters.ts#L225) — `(sheet.classId as string) ?? character.className?.toLowerCase() ?? ""`
- Level helper: `ClassFeatureResolver.getLevel(sheet, char.level)` ([attack-handlers.ts#L240](packages/game-server/src/application/services/combat/tabletop/dispatch/attack-handlers.ts#L240))
- Subclass lookup: `sheet.subclass` ([attack-handlers.ts#L600](packages/game-server/src/application/services/combat/tabletop/dispatch/attack-handlers.ts#L600))
- Scenario TODO already placed: [weapon-mastery-tactics.json#L178](packages/game-server/scripts/test-harness/scenarios/class-combat/fighter/weapon-mastery-tactics.json#L178)

### Fix Path (minimum viable)
1. In `handleAttackRoll`, right before line 472, resolve attacker class info (guard when not a character):
   - `classId = (attackerSheet.classId as string) ?? attackerChar?.className?.toLowerCase() ?? ""`
   - `subclassId = attackerSheet.subclass as string | undefined`
   - `level = ClassFeatureResolver.getLevel(attackerSheet, attackerChar?.level)`
2. `const critThreshold = classId && level ? getCriticalHitThreshold(classId, level, subclassId) : 20;`
3. Replace `const isCritical = rollValue === 20;` with `const isCritical = rollValue >= critThreshold;`
4. After `hit` is computed and before damage, fold in auto-crit:
   ```ts
   let isCriticalFinal = isCritical;
   if (hit && !isCriticalFinal) {
     const tConds = normalizeConditions(targetCombatant?.conditions as unknown[]);
     const isMelee = action.weaponSpec?.kind !== "ranged";
     const within5 = distanceFt === undefined || distanceFt <= 5;
     if (isMelee && within5 && tConds.some(c => c.condition === "Paralyzed" || c.condition === "Unconscious")) {
       isCriticalFinal = true;
     }
   }
   ```
   (Inline check avoids the casing bug in `isAutoCriticalHit`; see GAP-9.)
5. Update `weapon-mastery-tactics.json` — change nat-20 step tagged with TODO to nat-19 and assert `isCritical: true` on a level-3+ Champion.

### Risks
- Low; localized to one function. Non-Champion classes unchanged.
- Monsters/NPCs lack `sheet.classId` — guard the lookup (threshold falls back to 20).
- Extra Attack chain re-enters `handleAttackRoll` per rollResult, so threshold is re-derived automatically.
- `distanceFt` is already computed earlier in `handleAttackRoll` for ranged/cover logic — reuse it; don't recompute.
- `weapon-mastery-tactics` scenario's existing nat-20 assertion is a non-regression case; keep one nat-20 step plus add the nat-19 Champion case to guard both branches.

---

## GAP-9: Advantage vs Paralyzed Targets

### Root Cause (likely a misdiagnosis on main paths)
Both primary attack paths already route target conditions through `deriveRollModeFromConditions()`:

- Tabletop: [attack-handlers.ts#L933-L1034](packages/game-server/src/application/services/combat/tabletop/dispatch/attack-handlers.ts#L933-L939) — `computeAttackRollModifiers()` calls `normalizeConditions(targetCombatant.conditions)` and returns via `deriveRollModeFromConditions`.
- Programmatic: [attack-action-handler.ts#L209](packages/game-server/src/application/services/combat/action-handlers/attack-action-handler.ts#L209).
- Helper ([combat-text-parser.ts#L61-L62](packages/game-server/src/application/services/combat/tabletop/combat-text-parser.ts#L61-L62)) calls `hasIncomingAttackAdvantage()`.
- Condition catalog ([conditions.ts#L144-L306](packages/game-server/src/domain/entities/combat/conditions.ts#L144)) correctly sets `incomingAttacksHaveAdvantage: true` for **Blinded, Paralyzed, Petrified, Restrained, Stunned, Unconscious, StunningStrikePartial**. Prone uses distance-aware `getProneAttackModifier`.

**Real gap**: Pure-domain `resolveAttack()` does NOT check target conditions for mode — only uses `spec.mode` from caller ([attack-resolver.ts#L135, L146-L163](packages/game-server/src/domain/combat/attack-resolver.ts#L135)). Any direct caller (OA reactions, ad-hoc integration tests) that skips pre-computation misses target-condition advantage. Audit all `resolveAttack()` callers.

**Latent bug in `isAutoCriticalHit`**: uses lowercase names ([attack-resolver.ts#L123](packages/game-server/src/domain/combat/attack-resolver.ts#L123)) — `target.hasCondition("paralyzed")` / `"unconscious"`. The `Condition` type stores title-case (`"Paralyzed"`, `"Unconscious"` — see [conditions.ts#L189, L259](packages/game-server/src/domain/entities/combat/conditions.ts#L189)). Unless every `CreatureAdapter.hasCondition()` lower-cases internally, auto-crit never fires from the AI path either. Existing test [attack-resolver.test.ts#L767-L795](packages/game-server/src/domain/combat/attack-resolver.test.ts#L767-L795) uses stub adapters — doesn't catch the casing bug.

### Files
- [attack-resolver.ts#L113-L125](packages/game-server/src/domain/combat/attack-resolver.ts#L113-L125) — `isAutoCriticalHit` (casing bug)
- [attack-resolver.ts#L135-L192](packages/game-server/src/domain/combat/attack-resolver.ts#L135) — `resolveAttack` mode/auto-crit
- [combat-text-parser.ts#L43-L82](packages/game-server/src/application/services/combat/tabletop/combat-text-parser.ts#L43-L82) — `deriveRollModeFromConditions` (already correct)
- [conditions.ts#L189-L306](packages/game-server/src/domain/entities/combat/conditions.ts#L189) — condition catalog (already correct)

### Fix Path (including auto-crit scope decision)
Recommended scope: **verify + tighten, don't reimplement.**

1. **Write a failing-test repro first**: E2E scenario that applies `Paralyzed` to a monster, player attacks, assert `advantage: true` in the attack event. If it already passes on tabletop, GAP-9 is misdiagnosed — document the reporter's actual repro (likely a direct `resolveAttack()` caller or a condition stored lowercase).
2. **If the repro fails**, trace how `Paralyzed` was written to `combatant.conditions` in the repro. Most likely a caller stored a raw string or lowercase; fix the writer, not the reader.
3. **Fold auto-crit into tabletop flow** — covered by GAP-7 step 4 above. Using title-case `"Paralyzed"`/`"Unconscious"` matches the stored `Condition` type.
4. **Fix `isAutoCriticalHit` casing** — either lowercase inside the function before calling `hasCondition`, OR switch string literals to title-case. Prefer title-case to match the `Condition` type; update [attack-resolver.test.ts](packages/game-server/src/domain/combat/attack-resolver.test.ts) stubs accordingly.
5. **Do NOT** add target-condition advantage checks inside `resolveAttack()` — duplicates caller logic and violates the contract that the pure domain consumes `spec.mode` as given.

### Risks
- Highest risk is misdiagnosis — reproducer first is cheap insurance.
- If the casing fix flips adapter behavior, audit all `hasCondition()` implementations: `Creature` class, `CreatureAdapter` in `combat-utils.ts`, any test stubs.
- Scope creep: a general "normalize condition name" helper could be added but is out of scope for this minimal fix.

---

## Recommendations (ordered)
1. **GAP-7**: Implement threshold lookup + auto-crit in `handleAttackRoll`. Update scenario. High confidence, one file.
2. **GAP-9**: Write reproducer first; likely a test/data issue, not a missing rule. Tie any tabletop auto-crit work to GAP-7.
3. Fix `isAutoCriticalHit` casing bug at the same time — isolated and clearly correct.

<!-- ARCHIVED PRIOR RESEARCH BELOW -->

# SME Research — CombatRules — BUG-H1, BUG-6, BUG-P1

## Scope
- Files read: `attack-handlers.ts` (~830 lines), `damage-resolver.ts` (~660 lines), `weapon-catalog.ts` (~340 lines), `equipped-items.ts`, `armor-catalog.ts`, `hit-rider-resolver.ts` (~300 lines), `tabletop-types.ts`
- Task: Research three combat rules bugs (range validation, versatile damage, damage display)

## Bug 1: BUG-H1 — Long-range attack rejected

### Current Code
**File**: `packages/game-server/src/application/services/combat/tabletop/dispatch/attack-handlers.ts`

**Range validation** (lines 500-504):
```typescript
if (inferredKind === "ranged") {
  const maxRange = longRange ?? normalRange ?? 600;
  if (dist > maxRange + 0.0001) {
    throw new ValidationError(`Target is out of range (${Math.round(dist)}ft > ${Math.round(maxRange)}ft)`);
  }
}
```

**Range population** (lines 476-499): Two paths populate `normalRange`/`longRange`:
1. **Thrown path** (line 477): `if (isThrownAttack && thrownNormalRange)` → sets both from `resolveThrownRange()`
2. **Non-thrown path** (line 480): parses `spec?.range ?? equippedWeapon?.range`

**`resolveThrownRange`** (lines 659–680) — **PRECISE ROOT CAUSE IS HERE**:
```typescript
private resolveThrownRange(weapon: any): { normalRange?: number; longRange?: number } {
  if (weapon.kind === "ranged" && weapon.range && typeof weapon.range === "string"
      && weapon.range.toLowerCase() !== "melee") {
    const parts = weapon.range.split("/").map(Number);
    const normalRange = parts.length >= 1 && !isNaN(parts[0]) ? parts[0] : undefined;
    const longRange   = parts.length >= 2 && !isNaN(parts[1]) ? parts[1] : undefined;
    return { normalRange, longRange };  // ← EARLY RETURN with longRange=undefined if range="20"
  }
  // catalog lookup is never reached for ranged weapons with partial range string
  const catalogRange = getWeaponThrownRange(weaponName, ...);
  ...
}
```

### Root Cause Analysis
Error message `"30ft > 20ft"` means `maxRange = longRange ?? normalRange = 20`. `longRange` is undefined.

**Exact failure path**: A character sheet stores the Handaxe attack as `kind: "ranged"` (common for thrown weapons) with `range: "20"` (only normal range as string — no "/60" segment). The early-return branch fires and returns `{ normalRange: 20, longRange: undefined }`. The catalog lookup that would return `[20, 60]` is completely bypassed. Then:
```typescript
const maxRange = longRange ?? normalRange ?? 600;  // = 20 (not 60)
if (30 > 20.0001) throw ValidationError("30ft > 20ft");  // ← BUG
```

**Why `enrichAttackProperties` doesn't save you**: It enriches `properties`, `mastery`, `versatileDamage` but **NOT** `range`. A weapon stored with `range: "20"` stays `range: "20"` after enrichment.

**Secondary rules gap**: Even with correct ranges, there is **no disadvantage flag** when `normalRange < dist <= longRange`. D&D 5e 2024: attacks beyond normal range use Disadvantage. Separate follow-up.

### Proposed Fix
In `resolveThrownRange` (lines 659-680): only early-return from the string branch if BOTH parts exist. Otherwise fall through to catalog:
```typescript
if (weapon.kind === "ranged" && weapon.range && typeof weapon.range === "string"
    && weapon.range.toLowerCase() !== "melee") {
  const parts = weapon.range.split("/").map(Number);
  const normalRange = parts.length >= 1 && !isNaN(parts[0]) ? parts[0] : undefined;
  const longRange   = parts.length >= 2 && !isNaN(parts[1]) ? parts[1] : undefined;
  if (normalRange !== undefined && longRange !== undefined) {
    return { normalRange, longRange };  // complete — safe to return
  }
  // Partial range string — fall through to catalog for authoritative long range
}
```

### Dependencies at Risk
- `resolveThrownRange` is a private method with 3 call sites in `attack-handlers.ts` only. Change is self-contained.
- The catalog lookup (`getWeaponThrownRange`) already handles Handaxe, Javelin, Spear, Trident correctly.

---

## Bug 2: BUG-6 — Longsword versatile always uses two-handed damage

### Current Code
**File**: `packages/game-server/src/application/services/combat/tabletop/dispatch/attack-handlers.ts`

**`resolveVersatileGrip`** (lines 723-766):
```typescript
// Default detection logic (lines 748-753):
const hasShield = !!(actorSheet?.equipment?.armor?.type === "shield"
  || (actorSheet?.equipment?.shield));
const attacks = (actorSheet?.attacks ?? actorSheet?.equipment?.weapons ?? []) as any[];
const hasSecondWeapon = attacks.filter((a: any) => a.kind === "melee").length >= 2;
hands = (hasShield || hasSecondWeapon) ? 1 : 2;  // ← DEFAULT IS TWO-HANDED
```

Then (lines 756-760):
```typescript
if (hands === 2 && versatileDamage?.diceSides) {
  effectiveDiceSides = versatileDamage.diceSides;  // Uses d10 for Longsword
}
```

### Root Cause
**Two issues**:

1. **Default is wrong per D&D 5e 2024**: The code defaults to `hands = 2` (two-handed) when it can't detect a shield or dual-wield. Per 5e 2024 rules: *"A Versatile weapon can be used with one or two hands."* — two-handed is the optional mode requiring explicit intent. Default should be one-handed.

2. **Shield detection checks completely wrong keys** (confirmed by reading source):
   - `actorSheet.equipment.armor.type === "shield"` — `armor.type` is always `"light"`, `"medium"`, or `"heavy"`. Shields are a separate entity from armor, never stored here. Always `false`.
   - `actorSheet.equipment.shield` — wrong nesting AND wrong key name.

   **The actual key is `actorSheet.equippedShield` (top-level on sheet)**, set by `recomputeArmorFromInventory` in `armor-catalog.ts`:
   ```typescript
   // armor-catalog.ts line 211
   equippedShield = { name: equippedShieldItem.name, armorClassBonus: shieldBonus };
   // stored as sheet.equippedShield — top-level, NOT sheet.equipment.shield
   ```
   Confirmed by `creature-hydration.ts` line 146: `const enrichedShield = sheet.equippedShield;`
   Also confirmed by `EquippedItems` interface in `equipped-items.ts`: `shield?: EquippedShield` (the field is `shield` in the typed interface but the sheet sets it under `equippedShield` at top level).

### Proposed Fix
**Two-part fix**:

1. **Fix shield detection** (line ~741): change the check to use the actual sheet field:
```typescript
const hasShield = !!(actorSheet?.equippedShield           // primary: top-level enriched field
  || actorSheet?.equipment?.shield                         // legacy fallback
  || actorSheet?.equipment?.armor?.type === "shield");     // legacy fallback
```

2. **Change default from `hands = 2` to `hands = 1`** per D&D 5e 2024 rules:
```typescript
// D&D 5e 2024: Versatile defaults to one-handed. Two-handed requires explicit intent.
hands = (hasShield || hasSecondWeapon) ? 1 : 1;  // default is 1h; only 2h if explicit text
```
Actually: just set `hands = 1` as the else-branch default regardless. Two-handed requires the player to type "two-handed" / "2h" explicitly.

The shield detection fix alone corrects the reported bug. The default change aligns rules for cases where shield detection might still miss.

### Dependencies at Risk
- **E2E scenarios** that expect two-handed damage for versatile weapons without explicit "two-handed" text will change to one-handed. These scenarios need updating.
- **AI attacks** using versatile weapons: AI text doesn't include "two-handed" → will now correctly default to one-handed.
- `divine-smite.json` scenario: Longsword damage would change from 1d10 to 1d8 (since no explicit two-handed text). The scenario setup may need `damage.diceSides: 8` or the test steps updated.

---

## Bug 3: BUG-P1 — Divine Smite damage arithmetic display

### Current Code
**File**: `packages/game-server/src/application/services/combat/tabletop/rolls/damage-resolver.ts`

**Enhancement damage processing** (lines 327-380):
```typescript
// Line 362: Enhancement bonus damage added to totalDamage
totalDamage += bonusDamage;

// Line 377-378: Enhancement result stored with summary string
enhancementResults.push({
  summary: `${enhancement.displayName}: ${bonusDamage} bonus damage!`,
});
```

**Message formatting** (lines 653-654, and ALL similar templates at lines 437, 600, 620):
```typescript
`${rollValue} + ${damageModifier}${effectBonusSuffix} = ${totalDamage} damage to ${targetName}!`
```

### Root Cause
The message equation `${rollValue} + ${damageModifier} = ${totalDamage}` only includes the base weapon damage components. Enhancement bonus damage (Divine Smite's 16 radiant) is added to `totalDamage` but NOT to the left side of the equation. The enhancement appears AFTER the equation as a suffix: `" Divine Smite: 16 bonus damage!"`.

Result: `6 + 3 = 25 damage ... Divine Smite: 16 bonus damage!`
Expected: `6 + 3 + 16[Divine Smite] = 25 damage ... Divine Smite: 16 bonus damage!`

### Proposed Fix
Track total enhancement bonus damage and include it in the equation:
```typescript
// After enhancement loop, compute total enhancement damage
const enhancementDamageTotal = enhancementResults.reduce(
  (sum, r) => sum + (r.bonusDamage ?? 0), 0
);
const enhDmgStr = enhancementDamageTotal > 0
  ? ` + ${enhancementDamageTotal}[smite]`
  : "";

// Update message templates (all 5 locations):
`${rollValue} + ${damageModifier}${effectBonusSuffix}${enhDmgStr} = ${totalDamage} damage to ${targetName}!`
```

This requires:
1. Adding `bonusDamage` to the `HitRiderEnhancementResult` type so enhancement results carry their numeric damage
2. Computing `enhancementDamageTotal` after the enhancement loop
3. Updating ALL 5 message template locations (lines ~437, ~478, ~600, ~620, ~653-654)

### Dependencies at Risk
- **HitRiderEnhancementResult type** needs a new optional `bonusDamage` field — check `tabletop-types.ts`
- **E2E scenarios** that assert on exact message text will need updating
- **CLI display** may parse the damage message — check if `player-cli/src/display.ts` does regex on the equation format
- Effect bonus suffix (`effectBonusSuffix` for Rage, Hex) is already included in the equation — enhancement damage needs the same treatment

---

## Risks
1. **BUG-H1**: Enrichment fix only affects new characters. Existing characters retain stale data. May need a migration or runtime catalog fallback.
2. **BUG-6**: Changing default to one-handed affects ALL versatile weapons for ALL characters. Must audit every versatile weapon scenario (Longsword, Battleaxe, Warhammer, Quarterstaff).
3. **BUG-P1**: 5 message template locations must ALL be updated consistently. Missing one creates inconsistent display.
4. **Cross-bug**: None of these changes affect domain pure functions — they're all in the application-layer tabletop dispatch/resolution code. No domain rule violations.

## Recommendations
1. **BUG-6 is the simplest fix**: Change default to `hands = 1`. Minimal code change, correct per rules. Fix first.
2. **BUG-P1 is medium complexity**: Add `bonusDamage` tracking and update 5 message templates. Straightforward but touches many lines.
3. **BUG-H1 requires deepest investigation**: The exact character sheet format causing the failure needs reproduction. Add `range` to `enrichAttackProperties` + add catalog fallback in range validation. Also add long-range disadvantage (already at line 892-895).
