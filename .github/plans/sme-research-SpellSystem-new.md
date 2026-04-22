# SME Research: SpellSystem Gaps

Scope: GAP-6 (Hex on EB), GAP-8 (Hold Person save-to-end), GAP-11 (Bane).

---

## GAP-6: Hex on Eldritch Blast

### Root Cause
Plumbing is mostly correct on paper — investigation must localise a residual bug, not add a missing feature.

Current pipeline:
1. `HEX` in [level-1.ts L441-L466](packages/game-server/src/domain/entities/spells/catalog/level-1.ts#L441) declares `{type:'bonus', target:'damage_rolls', diceValue:{count:1,sides:6}, damageType:'necrotic', duration:'concentration', appliesTo:'target'}` + disadvantage on ability_checks.
2. [`BuffDebuffSpellDeliveryHandler`](packages/game-server/src/application/services/combat/tabletop/spell-delivery/buff-debuff-spell-delivery-handler.ts#L108-L170) detects Hex as a caster damage rider (`isCasterDamageRider=true` when `appliesTo:'target' + target:'damage_rolls' + type:'bonus|penalty'`) and stores the effect on the **caster's** resources with `targetCombatantId = <victim entity id>` (monsterId of Shadow Construct).
3. [`SpellAttackDeliveryHandler`](packages/game-server/src/application/services/combat/tabletop/spell-delivery/spell-attack-delivery-handler.ts#L95-L106) builds `AttackPendingAction` with `targetId = getEntityIdFromRef(targetRef)` — same monsterId.
4. [`DamageResolver.resolve`](packages/game-server/src/application/services/combat/tabletop/rolls/damage-resolver.ts#L141-L166) calls `findCombatantByEntityId(combatants, action.actorId)`, filters attacker's effects for `damage_rolls | melee_damage_rolls | ranged_damage_rolls` with `(!e.targetCombatantId || e.targetCombatantId === targetId)`, rolls dice and adds to `totalDamage`.
5. EB beam chain at [damage-resolver.ts L451-L474](packages/game-server/src/application/services/combat/tabletop/rolls/damage-resolver.ts#L451) preserves `actorId` + `targetId` — beam 2 sees same Hex effect.

Symptom (`8+0`, `6+0`) means `dmgEffects` is empty at damage time. Most likely suspects (by probability):

- **A (highest) — stale resources stomped by bonus-action patch:** After the BuffDebuff handler writes Hex via `updateCombatantState`, the same `handle()` method at [buff-debuff-spell-delivery-handler.ts L181-L188](packages/game-server/src/application/services/combat/tabletop/spell-delivery/buff-debuff-spell-delivery-handler.ts#L181) patches `bonusActionUsed:true` using `actorCombatant.resources` — **stale pre-effect-write snapshot**. `patchResources` is a shallow merge, so if `activeEffects` is under a nested key it could be preserved, but if `patchResources` writes the full resources object, the freshly persisted Hex effect is overwritten. Must verify `patchResources` semantics.
- **B — `createEffect` drops `diceValue`:** Verify [effects.ts createEffect](packages/game-server/src/domain/entities/combat/effects.ts#L150-L185) actually threads `options.diceValue` to the returned effect. If it drops it, the filter still matches but no dice are rolled → zero bonus.
- **C (low) — two-phase reaction short-circuit:** [spell-action-handler.ts L205-L295](packages/game-server/src/application/services/combat/tabletop/spell-action-handler.ts#L205) returns `REACTION_CHECK` and **never invokes the delivery handler** if `initiateSpellCast` reports `awaiting_reactions`. For a warlock with no enemy counterspellers this shouldn't trigger, but worth confirming.

### Files
- [level-1.ts](packages/game-server/src/domain/entities/spells/catalog/level-1.ts#L441) — HEX definition (OK)
- [buff-debuff-spell-delivery-handler.ts](packages/game-server/src/application/services/combat/tabletop/spell-delivery/buff-debuff-spell-delivery-handler.ts#L108-L188) — effect write + bonusActionUsed patch
- [damage-resolver.ts](packages/game-server/src/application/services/combat/tabletop/rolls/damage-resolver.ts#L141-L166) — attacker effect lookup (OK)
- [effects.ts](packages/game-server/src/domain/entities/combat/effects.ts#L150) — verify `createEffect` threads `diceValue`
- [resource-utils.ts](packages/game-server/src/application/services/combat/helpers/resource-utils.ts#L368) — confirm `patchResources` vs `addActiveEffectsToResources` semantics

### Fix Path
1. **Write a targeted unit test first** in `buff-debuff-spell-delivery-handler.test.ts`: cast Hex, assert caster's `resources.activeEffects` contains a single effect with `target:'damage_rolls'`, `diceValue:{count:1,sides:6}`, `damageType:'necrotic'`, `targetCombatantId:<victim entityId>`. Localises A/B.
2. **If A:** make the bonus-action patch re-fetch the combatant before merging, or use a dedicated `patchResources` call that preserves `activeEffects`.
3. **If B:** fix `createEffect` to thread `diceValue` to the returned `ActiveEffect`.
4. **If C:** guard `initiateSpellCast` against spells with no enemy counterspell opportunities.
5. Extend `warlock/hex-and-blast.json` E2E to assert final HP is in the `(beam1_raw + beam2_raw + 2)…(beam1_raw + beam2_raw + 12)` range once fixed.

### Risks
- **Low:** Bonus/dice damage suffix is cosmetic — once effects fire, totals correct.
- **Medium (if A):** fix affects every self+target buff/debuff combo with bonus-action casting (Shield of Faith, Shield of Faith upcasts, Hunter's Mark). Broader E2E sweep needed.
- **Low:** EB chaining shared with Scorching Ray; ensure no regression.

---

## GAP-8: Hold Person Save-to-End

### Root Cause
Two distinct bugs in [`CombatService.processActiveEffectsAtTurnEvent`](packages/game-server/src/application/services/combat/combat-service.ts#L990-L1180):

1. **Hardcoded ability modifier 0 (primary):** At [combat-service.ts L1086-L1092](packages/game-server/src/application/services/combat/combat-service.ts#L1086), the save-to-end handler reads ability scores via `recordAny.sheet ?? recordAny.statBlock`. `record` is a bare `CombatantStateRecord` — **neither field exists** on that type. `abilityScoresRaw` becomes `{}`, `abilityScoreVal` is `undefined`, code falls back to `abilityScore = 10 → abilityMod = 0`. The `level = 1` fallback also breaks `profBonus`. This produces the exact `+ 0 (wisdom 0)` log string.
2. **QueueableDiceRoller bypass (likely derivative):** `this.diceRoller.d20()` at [L1144-L1152](packages/game-server/src/application/services/combat/combat-service.ts#L1144) DOES consume from the queue if `diceRoller` is `QueueableDiceRoller`. The combat-service is constructed once with `deps.diceRoller` (see L69 constructor + L528 `hydrateCombat`). Test harness wires QueueableDiceRoller as the shared singleton. Likely the queue IS being consumed — the scenario author's perception of "queue ignored" is actually bug (1) making every save roll look like a pass regardless of the queued value. Verify via log inspection post-fix.

Compare with [`SavingThrowResolver`](packages/game-server/src/application/services/combat/tabletop/rolls/saving-throw-resolver.ts) which correctly uses a hydrated `creature` adapter — that's the contract to mirror.

### Files
- [combat-service.ts L990-L1180](packages/game-server/src/application/services/combat/combat-service.ts#L990) — save-to-end block
- [combat-service.ts L614, L752](packages/game-server/src/application/services/combat/combat-service.ts#L614) — callers pass raw records
- [creature-hydration.ts](packages/game-server/src/application/services/combat/helpers/creature-hydration.ts) — existing `hydrateCharacter/Monster/NPC` pattern
- [saving-throw-resolver.ts](packages/game-server/src/application/services/combat/tabletop/rolls/saving-throw-resolver.ts) — reference implementation

### Fix Path
1. **Change `processActiveEffectsAtTurnEvent` signature** to receive `Creature[]` (or `Map<record.id, Creature>`) alongside `combatantRecords`. Caller at [L522](packages/game-server/src/application/services/combat/combat-service.ts#L522) already hydrates `creatures` via `this.hydrateCreatures` — thread that through.
2. **In the save-to-end block**, read `abilityScores[saveAbility]`, `level`/CR, and save proficiencies from the hydrated creature adapter. Drop the `recordAny.sheet ?? recordAny.statBlock` lookup.
3. **Add a focused unit test**: combatant with known WIS mod + Paralyzed `ActiveEffect` carrying `saveToEnd:{ability:'wisdom', dc:15}`, `QueueableDiceRoller.queue([10])` → assert logged modifier matches WIS mod AND pass/fail outcome matches `(10 + mod + prof) vs 15`.
4. **Re-enable W2 Counterspell leg** once save consumes queued dice deterministically. Assert `spellSlot_3` 2→1 after Counterspell reaction.

### Risks
- **Medium:** Changing the signature touches start-of-turn + end-of-turn callers. Integration regressions possible in `ongoing_damage` and `recurring_temp_hp` paths — those don't use ability scores, so logically unaffected, but coverage must confirm.
- **Low:** Hold Person save-to-end behavior will change for any scenario relying on the buggy `+0` mod. None currently do (GAP-8 is documented blocker).
- **Low:** If another wiring path constructs `CombatService` with a non-queue `DiceRoller`, a separate fix is needed — verify via grep on `new CombatService(`.

---

## GAP-11: Bane Spell

### Root Cause
Bane is not in the catalog. Grep of `packages/game-server/src/domain/entities/spells/**` finds zero `BANE` references. `resolveSpell('Bane', sheet)` returns no match → delivery dispatch skipped → fallback `[WARN] Spell 'Bane' has no effects defined` fires in [spell-action-handler.ts L342-L346](packages/game-server/src/application/services/combat/tabletop/spell-action-handler.ts#L342). Concentration never switches because `isConcentration = false` (no catalog match).

### Files
- [level-1.ts](packages/game-server/src/domain/entities/spells/catalog/level-1.ts) — add BANE entry + include in `LEVEL_1_CATALOG`
- [buff-debuff-spell-delivery-handler.ts](packages/game-server/src/application/services/combat/tabletop/spell-delivery/buff-debuff-spell-delivery-handler.ts) — **currently does NOT evaluate saves at cast**; applies effects unconditionally. Gap for Bane.
- [save-spell-delivery-handler.ts](packages/game-server/src/application/services/combat/tabletop/spell-delivery/save-spell-delivery-handler.ts) — alternative route if we extend the save handler with `effectsOnFailure`.

### Fix Path
Two designs — pick based on proximity to Bless:

**Option A (preferred): New catalog entry + extend BuffDebuff handler with per-target save-on-cast.**
```ts
export const BANE = {
  name: 'Bane',
  level: 1,
  concentration: true,
  saveAbility: 'charisma',
  effects: [
    { type: 'penalty', target: 'attack_rolls', diceValue:{count:1,sides:4},
      duration: 'concentration', appliesTo: 'enemies' },
    { type: 'penalty', target: 'saving_throws', diceValue:{count:1,sides:4},
      duration: 'concentration', appliesTo: 'enemies' },
  ],
  upcastScaling: { additionalTargets: 1 },
  school: 'enchantment',
  castingTime: 'action',
  range: 30,
  components: { v:true, s:true, m:'a drop of blood' },
  classLists: ['Bard','Cleric'],
  description: '...'
} as const satisfies CanonicalSpell;
```
Then in `BuffDebuffSpellDeliveryHandler.handle`: when `spellMatch.saveAbility` is set AND effect `type` is `'penalty'|'disadvantage'`, resolve a save per target via `SavingThrowResolver` (or inline). Apply effect only on **failure**. Requires new code branch in the handler and a new test.

**Option B:** Add `effectsOnFailure: SpellEffectDef[]` field to the canonical spell type and route Bane through `SaveSpellDeliveryHandler` (which already iterates targets and applies conditions on failure — extending to effects is natural). Broader handler change but cleaner separation.

### Target cap / multi-target
Bane targets up to 3 (+1 per upcast). Existing `appliesTo:'allies'`/`'enemies'` resolution in BuffDebuff handler affects ALL matching combatants with no cap. Required extension: honour a `maxTargets` field OR plumb a user-supplied `targets: string[]` list. For the first shipment, single-target cast with `castInfo.targetName` (ignore multi-target) is acceptable if C2 uses single-target; cap support can be a follow-up.

### Risks
- **Medium (Option A):** extending BuffDebuff handler to run saves affects the semantics of future debuff spells. Verify no regression in Hold Person (routes to `SaveSpellDeliveryHandler` because it has `damage` + `conditions.onFailure`, not `effects[]` with `appliesTo:'target'`). Check registry order at [spell-action-handler.ts L74-L81](packages/game-server/src/application/services/combat/tabletop/spell-action-handler.ts#L74).
- **Low:** Penalty dice on attack rolls/saves are already consumed by `calculateBonusFromEffects` — no AI changes needed.
- **Medium:** Multi-target cap (3 + upcast) needs new plumbing — defer to follow-up if C2 only uses single-target.
- **Low:** AI spell evaluator already lists `"bane"` at [ai-spell-evaluator.ts L47](packages/game-server/src/application/services/combat/ai/ai-spell-evaluator.ts#L47).

---

## Recommendations to Orchestrator

1. **GAP-6 is localisation, not design.** Write the failing unit test first (Hex effect written to caster resources), binary-search suspects A/B/C. Expected fix ≤20 LOC.
2. **GAP-8 requires a contract change** (`processActiveEffectsAtTurnEvent` takes hydrated creatures). Worth the refactor — raw-record ability lookup is an anti-pattern already bypassed elsewhere via `hydrateCombat` + `SavingThrowResolver`. Apply same pattern.
3. **GAP-11 is straight additive.** Ship Option A with single-target first. Defer multi-target + `maxTargets` plumbing to follow-up. AI already knows about Bane.
4. Post-fix E2E sweep: `warlock/hex-and-blast`, `wizard/shield-and-counterspell` (Counterspell leg re-enabled), `cleric/bless-and-bane-party` (C2).
