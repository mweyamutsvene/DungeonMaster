# Plan: Fix Class-Combat Engine Gaps (GAP-6 → GAP-11)
## Round: 1
## Status: IN_PROGRESS
## Affected Flows: SpellSystem, SpellCatalog, CombatRules, CombatOrchestration, ClassAbilities

## Objective
Fix the six engine gaps uncovered by the class-combat suite:
- **GAP-6**: Hex bonus damage not applied to Eldritch Blast beams
- **GAP-7**: Improved Critical (Champion 19-20) not wired in tabletop flow
- **GAP-8**: Hold Person save-to-end bypasses dice queue + hardcodes wisdom 0
- **GAP-9**: Advantage vs Paralyzed — mostly works, but `isAutoCriticalHit` has a casing bug; tabletop flow lacks auto-crit entirely
- **GAP-10**: `lay on hands on <ally>` cannot target PC (4 sub-bugs in `handleBonusAbility`)
- **GAP-11**: Bane spell missing from catalog + BuffDebuff handler doesn't do save-on-cast

Implementation order (low risk → higher risk):
1. GAP-11 (additive catalog + save-on-cast branch)
2. GAP-9 (casing fix)
3. GAP-7 (crit threshold + auto-crit in tabletop)
4. GAP-8 (signature change, hydrated creatures)
5. GAP-10 (4 sub-bugs, `allowsAllyTarget` flag)
6. GAP-6 (localize via unit test, fix effect persistence)

## Changes

### GAP-11 — Bane Spell
- [x] Add `BANE` entry to `domain/entities/spells/catalog/level-1.ts` with `saveAbility: 'charisma'`, `type: 'penalty'` on `attack_rolls` and `saving_throws`, `diceValue: {count:1,sides:4}`, concentration, appliesTo `'enemies'`.
- [x] Extend `BuffDebuffSpellDeliveryHandler.handle` to run a CHA save per target when `spellMatch.saveAbility` is set; only apply effects on failure. (Single-target for now via `castInfo.targetName`.)
- [x] Update C2 scenario assertions to reflect slot consumption and concentration switch Bless → Bane on successful cast.

### GAP-9 — `isAutoCriticalHit` casing
- [x] Fix `domain/combat/attack-resolver.ts` line 123 to use title-case `"Paralyzed"` / `"Unconscious"` matching the `Condition` type.
- [x] Update `attack-resolver.test.ts` stubs if needed.

### GAP-7 — Improved Critical + Auto-Crit in Tabletop
- [x] In `roll-state-machine.ts::handleAttackRoll`:
  - Resolve `classId`, `subclassId`, `level` from `attackerSheet` (guard non-character).
  - `critThreshold = getCriticalHitThreshold(classId, level, subclassId) ?? 20`
  - Replace `isCritical = rollValue === 20` with `isCritical = rollValue >= critThreshold`
  - After `hit`: fold in auto-crit for Paralyzed/Unconscious target in melee within 5ft (inline title-case check; don't rely on `isAutoCriticalHit` signature).
- [x] Update F2 scenario: change nat-20 TODO step to nat-19 Champion case; keep a nat-20 step as non-regression.

### GAP-8 — Hold Person save-to-end
- [x] Change `CombatService.processActiveEffectsAtTurnEvent` signature to accept hydrated `Creature[]` (or Map keyed by combatant id) alongside records.
- [x] Replace `recordAny.sheet ?? recordAny.statBlock` with creature-adapter ability-score + level lookup.
- [x] Thread hydrated creatures through both callers (start-of-turn, end-of-turn) at `combat-service.ts:614` and `:752`.
- [x] Re-enable W2 Counterspell leg — assert `spellSlot_3` 2→1 and Mage recovers from Paralyzed on queued high-roll.

### GAP-10 — Lay on Hands ally target (4 sub-bugs)
- [x] Add optional `allowsAllyTarget?: boolean` to `AbilityExecutor` interface.
- [x] Set `allowsAllyTarget = true` on `LayOnHandsExecutor`.
- [x] Add `AbilityRegistry.allowsAllyTarget(abilityId): boolean`.
- [x] In `class-ability-handlers.ts::handleBonusAbility`:
  - (Bug 1) When `allowsAllyTarget`, scan `characters` BEFORE monsters for name match; resolve `targetRef = { type: "Character", characterId }`.
  - (Bug 2) Pass `targetEntityId: combatantRefToEntityId(targetRef)` into executor params.
  - (Bug 3) `buildTargetActor` accepts real HP (`hpCurrent`/`hpMax`) from target combatant; no more 0/0 stub.
  - (Bug 4) When executor returns `result.data.targetEntityId`, write `hpCurrent` to THAT combatant instead of `actorCombatant`.
- [x] Update P2 scenario: enable `lay on hands on <ally>` and assert ally HP restoration.
- [x] Follow-up ticket: touch-range no-op (mockCombat.getPosition returns undefined) — separate plan.

### GAP-6 — Hex on Eldritch Blast
- [x] Write a unit test in `buff-debuff-spell-delivery-handler.test.ts`: cast Hex; assert caster's `resources.activeEffects` contains `{target:'damage_rolls', diceValue:{count:1,sides:6}, damageType:'necrotic', targetCombatantId:<victim entityId>}`.
- [x] If fails (Suspect A/B): inspect `patchResources` vs `createEffect`. Most likely fix: `patchResources` in `resource-utils.ts` shallow-merges but the BuffDebuff handler re-reads stale resources before the `bonusActionUsed` patch. Solution: re-fetch combatant before the second patch, OR merge `bonusActionUsed` into the SAME `updateCombatantState` call as the effect write.
- [x] Re-enable WL1 `hex-and-blast` full assertions — assert EB beam totals include Hex 1d6.

## Cross-Flow Risk Checklist
- [ ] `processActiveEffectsAtTurnEvent` signature change — audit all callers (`combat-service.ts:522, 614, 752`). Validate `ongoing_damage` / `recurring_temp_hp` paths still work.
- [ ] BuffDebuff save-on-cast — verify Hold Person still routes to `SaveSpellDeliveryHandler` (not BuffDebuff) via registry order.
- [ ] `AbilityExecutor` interface change is additive (optional flag) — no existing executors need edits.
- [ ] Roll-state-machine crit threshold change — monsters/NPCs have no classId; guard falls back to 20.
- [ ] Bane single-target cap — future multi-target work separate.

## Test Plan
- [ ] Unit test: Bane catalog entry resolves via `resolveSpell`
- [ ] Unit test: BuffDebuff handler runs save on cast when `saveAbility` set
- [ ] Unit test: Hex effect persists on caster resources after bonus-action patch
- [ ] Unit test: `isAutoCriticalHit` returns true for title-case Paralyzed condition
- [ ] Unit test: `handleAttackRoll` treats nat-19 as crit for L3+ Champion Fighter
- [ ] Unit test: Save-to-end reads real WIS mod from hydrated creature
- [ ] Unit test: `handleBonusAbility` resolves ally Character for Lay on Hands
- [ ] E2E: re-enable WL1 full assertions (Hex + EB totals)
- [ ] E2E: re-enable W2 Counterspell leg + assert spellSlot_3 2→1
- [ ] E2E: F2 nat-19 Champion crit step
- [ ] E2E: P2 ally heal assertions
- [ ] E2E: C2 updated Bless→Bane concentration switch + slot consumption
- [ ] Full suite: `test:e2e:combat:mock -- --all` passes 238/238

## Risks
- GAP-8 signature change is the broadest — if a non-queue DiceRoller is wired anywhere (e.g., production), dice queue behavior differs. Verify via grep.
- GAP-6 fix might need iteration — starting with unit test binary-search.
- GAP-10 ally heal exposes touch-range bug (range check is no-op); documented as follow-up, not in scope.
