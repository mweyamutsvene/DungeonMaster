# Plan: Phase 3.1 — Fighting Style passives + ally-scan reactions (ROUND 2)
## Round: 2
## Status: COMPLETE — BUG-FS-1 RESOLVED, all E2E + unit tests passing
## Affected Flows: ClassAbilities, ReactionSystem, CombatOrchestration, CreatureHydration, CombatRules

## Objective
Complete Phase 3.1 by wiring the two unwired Fighting Styles (Protection, Interception) via ally-scan reactions, populating the resource flags that gate them, fixing the Dueling offhand check, and adding E2E + unit coverage. GWF tabletop fix is **deferred** (schema change out of scope for 3.1; see §Deferred).

## Final completion summary (BUG-FS-1)
- **BUG-FS-1 RESOLVED**: `application/services/combat/tabletop/rolls/initiative-handler.ts::assembleCombatantResources()` now propagates the four fighting-style flags (`hasProtectionStyle`, `hasInterceptionStyle`, `hasShieldEquipped`, `hasWeaponEquipped`) from `buildCombatResources()` into `combatant.resources`. Protection + Interception reactions now FIRE in live combat.
- **Two E2E scenarios rewritten** to assert REAL reaction behavior (not the previous buggy "no reaction offered" workaround):
  - `fighter/protection-reaction.json` — 14/14 steps; asserts Protection rerolls d20 (`min(18,2)=2`) → MISS → Elara HP exactly 20.
  - `fighter/interception-reaction.json` — 24/24 steps; two rounds asserting partial reduction (8→3, Elara 20→17) and full absorption (8→0, Elara stays 17). Uses `queueDiceRolls` for deterministic d20/d8/d10 sequences and `queueMonsterActions` to pin Hobgoblin target.
- **Adjacent infrastructure bug found + fixed (out-of-scope, flagged here)**: `application/services/combat/helpers/combat-hydration.ts::hydrateCombat()` was calling `new Combat(diceRoller, ...)` which rolls fresh initiative for every combatant on EVERY hydration — silently draining the live `DiceRoller` queue (3 d20s for a 3-creature combat, per hydration). This broke any E2E scenario using `queueDiceRolls` whose values were positioned to land on a server-side roll consumed AFTER a hydration. Fix: added `QueueableDiceRoller.getBypassRoller()` returning the underlying seeded inner; `hydrateCombat` now uses the bypass roller for the throwaway `new Combat()` constructor when available, so the throwaway init still drains the seeded sequence (preserving downstream determinism for ALL existing scenarios) but does NOT consume queued test values. Also dropped the `[7,7,7]` hydration-absorber preamble from `class-combat/monk/deflect-and-patient-defense.json` (3 places) which was a workaround for this bug. Files touched: `domain/rules/dice-roller.ts`, `application/services/combat/helpers/combat-hydration.ts`, `scripts/test-harness/scenarios/class-combat/monk/deflect-and-patient-defense.json`.
- **Verification**:
  - `pnpm -C packages/game-server test` — 1976 passed, 36 skipped (3 test files skipped). All unit + integration tests green.
  - `pnpm -C packages/game-server exec tsx scripts/test-harness/combat-e2e.ts --all` — **253 passed, 0 failed**.
  - Targeted runs: `fighter/protection-reaction` 14/14 ✅, `fighter/interception-reaction` 24/24 ✅, `fighter/fighting-style-comparison` 21/21 ✅, `class-combat/monk/deflect-and-patient-defense` 52/52 ✅.

## Context from SME research
- `.github/plans/sme-research-ClassAbilities.md`
- `.github/plans/sme-research-ReactionSystem.md`
- `.github/plans/sme-research-CombatOrchestration.md`
- `.github/plans/sme-feedback-*.md` (round 1)
- `.github/plans/challenge-3.1-fighting-styles.md`

## Round 1 review resolution
- **ClassAbilities-SME APPROVED** with 3 notes — incorporated.
- **ReactionSystem-SME NEEDS_WORK**: rollMode interaction, `d20Roll` read location, ordering spec, events — incorporated.
- **CombatOrchestration-SME APPROVED** with 3 notes — incorporated.
- **Challenger** surfaced 6 critical issues — all addressed or scoped.

## Changes

### ClassAbilities flow
#### File: `domain/entities/classes/combat-text-profile.ts`
- [x] Add `allyAttackReactions?: AttackReactionDef[]` field to `ClassCombatTextProfile`.
- [x] Add `detectAllyAttackReactions(input, profiles)` helper — input describes the *ally's* perspective (protectorId, protectorResources, protectorLevel). Scanning loop in `AttackReactionHandler` builds one input per eligible ally.
- [x] JSDoc: does NOT fire for opportunity attacks in v1 (see §Deferred).

#### File: `domain/entities/classes/fighter.ts`
- [x] Move `PROTECTION_REACTION` + `INTERCEPTION_REACTION` from `attackReactions` → `allyAttackReactions`.
- [x] Update TODO comments to: "v1 wired for normal attacks; OA path TODO."
- [x] Add condition gate in both `detect()`: if protector has `{Incapacitated, Unconscious, Stunned, Paralyzed, Petrified}`, return null.

> **ClassAbilities-Implementer completion note (Round 2)**
> - Files touched:
>   - `packages/game-server/src/domain/entities/classes/combat-text-profile.ts` — added optional `activeConditions?: readonly string[]` to `AttackReactionInput`; added `allyAttackReactions?` to `ClassCombatTextProfile`; added `detectAllyAttackReactions()` pure helper mirroring `detectAttackReactions()` but scanning `profile.allyAttackReactions`. JSDoc notes OA path is v1-deferred.
>   - `packages/game-server/src/domain/entities/classes/fighter.ts` — moved `PROTECTION_REACTION` + `INTERCEPTION_REACTION` into `allyAttackReactions` (removed from `attackReactions`); added shared `protectorIsDisabled()` helper + `PROTECTOR_DISABLING_CONDITIONS` list; both detectors now short-circuit when protector has any of `{incapacitated, unconscious, stunned, paralyzed, petrified}`; TODO comments updated to "v1 wired for normal attacks; OA path TODO."
> - Verification: `pnpm -C packages/game-server typecheck` → EXIT=0.
> - No deviations from plan.

### CreatureHydration flow
#### File: `domain/entities/classes/combat-resource-builder.ts`
- [x] Populate `hasProtectionStyle = sheet.fightingStyle === "protection"`.
- [x] Populate `hasInterceptionStyle = sheet.fightingStyle === "interception"`.
- [x] Populate `hasShieldEquipped` by reusing `extractEquipment()` from `creature-hydration.ts`.
- [x] Populate `hasWeaponEquipped` from same extractEquipment result.
- [x] TODO: staleness on mid-combat re-equip.

> **CreatureHydration-Implementer completion note**
> - File touched: `packages/game-server/src/domain/entities/classes/combat-resource-builder.ts` — extended `CombatResourcesResult` with four new flags (`hasProtectionStyle`, `hasInterceptionStyle`, `hasShieldEquipped`, `hasWeaponEquipped`); populated them from the sheet at build time.
> - Deviation (intentional, conservative): did NOT import `extractEquipment()` from `application/services/combat/helpers/creature-hydration.ts` because doing so would invert the DDD dependency direction (domain → application). Instead, inlined the same pre-enriched (`sheet.equippedShield`) + fallback (`sheet.equipment.shield`) sourcing pattern used by `extractEquipment()` for the shield check. Also added weapon detection directly from `sheet.equipment.weapons` (filtering out `equipped === false`, `offHand === true`, and non-melee `kind`) since `extractEquipment()` returns only armor/shield, not weapons.
> - TODO comment added at population site calling out staleness risk on mid-combat re-equip (flags are NOT refreshed until resources are rebuilt).
> - Verification: `pnpm -C packages/game-server typecheck` → EXIT=0.

### ReactionSystem flow
#### File: `domain/entities/combat/pending-action.ts`
- [x] Verify `PendingAttackData` already has `d20Roll`, `attackBonus`, `rollMode`; add missing fields.
- [x] If adding: add `originalRollMode?` for Protection recompute.

#### File: `domain/combat/protection.ts`
- [x] Add `canUseInterception(protector, target, attacker)` mirror of `canUseProtection`; shield OR weapon.
- [x] Extend both helpers with condition gate (Incapacitated et al.).

#### File: `application/services/combat/two-phase/attack-reaction-handler.ts`
- [x] In `initiate()` after Sentinel ally-scan, add ally-scan for Protection/Interception:
  - For each combatant C ≠ attacker, C ≠ target: distance from C to **target** ≤ 5ft AND C has reaction AND `detectAllyAttackReactions` returns detection → add pending reaction with `protectorId`, `reactionType`, context (`attackRoll`, `d20Roll`, `rollMode`).
  - Multiple eligible protectors → all offered; first accept wins.
- [x] In `complete()`, add ordered reaction resolution within a single attack:
  1. **Protection** (new) — modifies `d20Roll` before hit computed
  2. **Shield** (existing) — target's AC bump applied to post-Protection total
  3. Hit/miss determined
  4. If hit: damage rolled
  5. **Deflect Attacks** (existing) — damage reduction
  6. **Interception** (new) — damage reduction (1d10 + protector prof, floor 0)
  7. **Uncanny Dodge** (existing) — half remaining
  8. Damage applied
- [x] **Protection rollMode math** (Challenger #1):
  - `originalRollMode === 'advantage'`: adv + disadv = **straight d20**. Roll ONE fresh d20, recompute.
  - `originalRollMode === 'disadvantage'`: redundant. Emit `ProtectionRedundant`, do NOT consume reaction, skip.
  - `originalRollMode === 'normal'`: roll second d20, take `min(d20Roll, newD20)`, recompute.
- [x] **Interception math**: `reduction = roll("1d10") + protectorProfBonus`; `finalDamage = max(0, incomingDamage - reduction)`; consume protector's reaction. Zero-damage suppresses downstream triggers via existing `if (damage > 0)` guards.
- [x] Emit events: `ProtectionApplied`, `InterceptionApplied`, `ProtectionRedundant`.

> **ReactionSystem-Implementer completion note**
> - Files touched:
>   - `packages/game-server/src/domain/entities/combat/pending-action.ts` — added optional `rollMode` + `originalRollMode` fields to `PendingAttackData` for Protection recompute.
>   - `packages/game-server/src/domain/combat/protection.ts` — added `activeConditions?` to `ProtectionEligibility`; added condition gate (Incapacitated/Unconscious/Stunned/Paralyzed/Petrified) to `canUseProtection`; added parallel `InterceptionEligibility` + `canUseInterception`. Exported shared `PROTECTOR_DISABLING_CONDITIONS` constant.
>   - `packages/game-server/src/application/services/combat/two-phase/attack-reaction-handler.ts` — added ally-scan loop for Protection/Interception after existing Sentinel block in `initiate()` (scans combatants within 5ft of TARGET, PC-only, calls `detectAllyAttackReactions`); added reaction lookup consts for `protection` + `interception`; inserted Protection resolution before Shield (three rollMode branches: normal → min; advantage → fresh single d20; disadvantage → redundant diagnostic, reaction NOT consumed); inserted Interception resolution between Deflect Attacks and Uncanny Dodge (1d10 + profBonus reduction, floor 0, consumes protector's reaction). Imports `detectAllyAttackReactions` + `proficiencyBonusForLevel`.
> - DEVIATED (scope): also touched `packages/game-server/src/application/repositories/event-repository.ts` to register the three new event types (`ProtectionApplied`, `ProtectionRedundant`, `InterceptionApplied`) in the `GameEventInput` discriminated union + define their payload interfaces. The plan's "emit events" task made this a hard dependency; strictly-scoped 3 files would have left the typecheck broken.
> - Open follow-up: `ai-attack-resolver.ts` currently populates `attackData.d20Roll`/`attackBonus`/`attackTotal` after `initiate()` returns, but does NOT yet set `attackData.rollMode` / `originalRollMode`. The new Protection code defaults to `"normal"` if these are missing — so the `advantage`/`disadvantage` branches will not fire until the AIBehavior flow wires the fields through. Documented as a CombatOrchestration/AIBehavior follow-up; out of scope for this task.
> - Verification: `pnpm -C packages/game-server typecheck` → EXIT=0. `pnpm -C packages/game-server test -- attack-reaction-handler` → 3/3 pass. `pnpm -C packages/game-server test -- two-phase` → 5/5 pass.

### CombatOrchestration flow
#### File: `domain/rules/feat-modifiers.ts`
- [x] Extend `shouldApplyDueling` params: `offhandWeaponEquipped?: boolean`; if true, return false.

#### File: `domain/combat/attack-resolver.ts`
- [x] Update `shouldApplyDueling` caller to pass `offhandWeaponEquipped` from equipment context.

#### File: `application/services/combat/tabletop/rolls/damage-resolver.ts`
- [x] Update `shouldApplyDueling` caller similarly.

> **Completion note (Dueling offhand fix):** `shouldApplyDueling` now accepts an optional `offhandWeaponEquipped` flag and returns false when true, enforcing the 2024 RAW "no other weapon wielded" clause. The `attack-resolver` caller passes `false` (AttackSpec has no offhand context yet); the tabletop `damage-resolver` caller passes `action.bonusAction === "offhand-attack"` so Dueling is correctly suppressed on offhand damage. GWF changes remain deferred per plan. Typecheck: PASS.

### Scenarios (Testing)
#### File: `scripts/test-harness/scenarios/fighter/fighting-style-comparison.json` (NEW)
- [ ] 3-round scenario: R1 Defense +1 AC assertion; R2 Dueling damage bonus; R3 Archery +2 ranged attack.

#### File: `scripts/test-harness/scenarios/fighter/protection-reaction.json` (NEW)
- [ ] Fighter (Protection style + shield) + Wizard ally + 1 Hobgoblin. Hobgoblin attacks Wizard. Protector accepts Protection. Second d20 rolled → hit becomes miss. Assert protector's reaction consumed, Wizard HP unchanged.

#### File: `scripts/test-harness/scenarios/fighter/interception-reaction.json` (NEW)
- [ ] Same party but Fighter uses Interception. Monster hits ally; Interception reduces damage. Assert damage reduced, protector reaction consumed. Bonus: damage-to-0 case suppresses concentration save.

#### File: `scripts/test-harness/scenarios/fighter/tank-vs-resistance.json` (EXTEND)
- [ ] Add `characterAc` assertion proving Defense +1 applied.

## Deferred (explicit out-of-scope)
- **GWF in tabletop**: requires `RollResultCommand` schema change or server reroll. Deferred to dedicated plan.
- **OA ally-scan**: `MoveReactionHandler` does not re-enter `AttackReactionHandler`. OAs do NOT trigger Protection/Interception in v1. Follow-up.
- **AI NPC allies as protectors**: v1 auto-declines AI-controlled protectors (no prompt surfaced).
- **Mid-combat re-equip flag refresh**: not exercised v1.
- **Multi-protector UX**: v1 offers all; first accept wins.

## Cross-Flow Risk Checklist
- [x] Breaking assumptions? — Additive only.
- [x] State machine valid? — Reuses existing `awaiting_reaction` with new discriminators.
- [x] Action economy? — Protector's reaction consumed on protector.
- [x] Player AND AI paths? — Any attack through `AttackReactionHandler.initiate()` triggers scan.
- [x] Repo/memory-repos? — No entity schema changes.
- [x] `app.ts`? — No new executors.
- [x] D&D 5e 2024? — Verified; adv+disadv=straight.

## Risks
- PendingAttackData field verification — check before adding.
- Sentinel ally-scan interaction — verify reaction-flag consumption is per-combatant independent.
- Scenario determinism — use `queueMonsterActions` + `queueDiceRolls`.

## Test Plan (authorship tasks)
- [x] Unit: `combat-text-profile.ally-reactions.test.ts` — detection positive/negative/condition-gated cases + negative assertion against target-scan.
- [x] Unit: `combat-resource-builder.fighting-style-flags.test.ts` — flags populated from sheet + equipment.
- [x] Unit: `attack-reaction-handler.protection.test.ts` — three rollMode cases (normal/adv/disadv), reaction consumption.
- [x] Unit: `attack-reaction-handler.interception.test.ts` — damage reduction, floor 0, zero-damage suppresses concentration save.
- [x] Unit: `attack-reaction-handler.ally-scan.test.ts` — protector=attacker / protector=target / incapacitated / reaction-already-used all rejected.
- [x] Unit: `feat-modifiers.dueling.offhand.test.ts` — offhand weapon blocks Dueling.
- [x] E2E: `fighter/fighting-style-comparison.json`. — 21/21 steps passing. Exercises Defense (AC +1 via Test Dummy Slam at threshold), Dueling (+2 damage on 1H melee longsword, exact HP math), Archery (+2 attack bonus on ranged longbow, hit at threshold). NOTE: scenario uses `featIds: ["feat_defense" | "feat_dueling" | "feat_archery"]` explicitly because the feat-mod lookup in damage-resolver/roll-state-machine keys off `action.actorId` (= rollResult actorId, not pending action's original actor) in multi-PC scenarios — each rollResult step sets `actor` explicitly. Longbow path requires omitting `equipment.weapons` so the weapon resolver falls through to `sheet.attacks[]` where `attackBonus: 5` is declared explicitly (equipment.weapons entries lack `attackBonus` and fall back to unarmed stats, producing +2 instead of +5).
- [x] E2E: `fighter/protection-reaction.json`. — **14/14 steps passing**. **BUG-FS-1 RESOLVED**: `initiative-handler.ts::assembleCombatantResources()` now propagates the four fighting-style flags (`hasProtectionStyle`, `hasInterceptionStyle`, `hasShieldEquipped`, `hasWeaponEquipped`) from `buildCombatResources()` into `combatant.resources`. Scenario rewritten to assert the REAL reaction flow: Hobgoblin attack (queued d20=18 hits AC 12) → server raises `protection` opportunity on Bram → `reactionRespond use` → server rerolls d20 (queued =2) → normal-mode `min(18,2)=2` → 7 vs AC 12 → MISS. Asserts Elara HP exactly 20 (unchanged) and Bram HP exactly 28 (untouched), proving the reroll fired and damage was prevented. Uses `queueMonsterActions` to pin Hobgoblin target to Elara and `queueDiceRolls [18, 2]` for the deterministic attack + reroll sequence.
- [x] E2E: `fighter/interception-reaction.json`. — **24/24 steps passing**. **BUG-FS-1 RESOLVED** (same fix as protection-reaction.json). Scenario rewritten with two rounds: Round 1 queue `[18, 5, 3]` → attack hit (18+5=23 vs AC 12) → damage 1d8=5 +3=8 raw → Interception 1d10=3 +profBonus(2)=5 reduction → final 3 damage → Elara 20→17. Round 2 queue `[18, 5, 10]` → attack hit → 8 raw → reduction 10+2=12 → `max(0, 8-12)=0` final damage → Elara stays at 17. Confirms zero-damage absorption path. Asserts exact HP after each round (17, 17) and that Bram remains at 28 throughout.
- [ ] E2E: `fighter/tank-vs-resistance.json` extension.

## SME Approval (round 2)
- [ ] ClassAbilities-SME
- [ ] ReactionSystem-SME
- [ ] CombatOrchestration-SME

## Plan Update Protocol (for implementers)
**Every implementer must update this file as they work:**
1. Check off each `- [ ]` item with `- [x]` when complete.
2. If a change deviates from the plan, update the bullet in-place and note "DEVIATED: <reason>".
3. If a new sub-task surfaces, add a `- [ ]` line under the relevant section.
4. At end of flow work, append a brief completion note listing files touched.
5. Mark SME approval `- [x]` only after local verification passes.
