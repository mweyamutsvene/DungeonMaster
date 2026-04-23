# SME Research — ClassAbilities — Phase 3.8 Colossus Slayer

## Scope
- Task: Implement Ranger Hunter "Colossus Slayer" (+1d8 once/turn on wounded target).
- Files read: `rogue.ts`, `ranger.ts`, `damage-resolver.ts`, `roll-state-machine.ts`, `combat-hydration.ts`, `combat-text-profile.ts`, `hit-rider-resolver.ts`, `registry.ts`, `hunters-mark-colossus.json`, `feature-keys.ts`, `HUNTERS_MARK` spell, `move-hunters-mark-executor.ts`.

## Headline Finding — Feature Is Already Implemented, Missing Only One Line

**Colossus Slayer is already fully wired** in [damage-resolver.ts L296-L319](packages/game-server/src/application/services/combat/tabletop/rolls/damage-resolver.ts#L296-L319):

```ts
if (className && classHasFeature(className, COLOSSUS_SLAYER, level, subclass)
    && !actorResRec.colossusSlayerUsedThisTurn && this.deps.diceRoller) {
  const csHpMax = targetForCS?.hpMax ?? 0;
  const csHpBefore = targetForCS?.hpCurrent ?? 0;
  if (targetForCS && csHpMax > 0 && csHpBefore > 0 && csHpBefore < csHpMax) {
    const csDie = this.deps.diceRoller.rollDie(8).total;
    totalDamage += csDie;
    effectBonusSuffix += ` + ${csDie}[colossus-slayer]`;
    actorResRec.colossusSlayerUsedThisTurn = true;
    await this.deps.combatRepo.updateCombatantState(actorCombatant.id, {
      resources: { ...actorResRec, colossusSlayerUsedThisTurn: true } as any,
    });
  }
}
```

Subclass gating uses `classHasFeature(className, COLOSSUS_SLAYER, level, subclass)` — correct. `COLOSSUS_SLAYER` feature-key is declared in [feature-keys.ts L169](packages/game-server/src/domain/entities/classes/feature-keys.ts#L169), and the Hunter subclass's features map at [ranger.ts L67](packages/game-server/src/domain/entities/classes/ranger.ts#L67) contains `[COLOSSUS_SLAYER]: 3`.

### The Actual Bug: flag never resets between turns

The once-per-turn flag `colossusSlayerUsedThisTurn` is **not enumerated** in the `isFreshEconomy` reset block at [combat-hydration.ts L146-L165](packages/game-server/src/application/services/combat/helpers/combat-hydration.ts#L146-L165). The hydration spreads `...resources` first and then explicitly reassigns known per-turn flags (`sneakAttackUsedThisTurn`, `stunningStrikeUsedThisTurn`, `rageAttackedThisTurn`, …). Any flag not in the list survives via the spread. Net effect: Colossus Slayer fires once in the entire combat and never again.

**Same latent bug** exists for `elementalAffinityUsedThisTurn` (Draconic Sorcerer L5).

## Sneak Attack Pattern Reference (the canonical "once/turn bonus dice" wiring)

| Concern | File | Line |
|---|---|---|
| Domain eligibility pure function | `rogue.ts` | L25-L46 (`isSneakAttackEligible`) |
| Dice progression function | `rogue.ts` | L7-L15 (`sneakAttackDiceForLevel`) |
| Feature-key constant | `feature-keys.ts` | `SNEAK_ATTACK = "sneak-attack"` |
| Feature-map gate (class features) | `rogue.ts` | Rogue.features `"sneak-attack": 1` |
| Eligibility call-site (attack roll) | `roll-state-machine.ts` | L907-L962 — checks `classHasFeature(SNEAK_ATTACK)`, computes ally adjacency, reads `sneakAttackUsedThisTurn` from normalized resources |
| Dice injected into formula | `roll-state-machine.ts` | L1004 (`sneakAttackDice` on `DamagePendingAction`) + formula splice ~L1020 |
| `DamagePendingAction.sneakAttackDice` type | `tabletop-types.ts` | L123-L124 |
| Flag marked "used" after hit | `damage-resolver.ts` | L425-L434 (`patchResources(..., { sneakAttackUsedThisTurn: true })`) |
| **Per-turn reset** | `combat-hydration.ts` | L151 — in `isFreshEconomy` list |
| Hydration type | `hydration-types.ts` | L91 |
| Default init | `resource-utils.ts` | L196 |

## `attackEnhancements` / `ClassCombatTextProfile` — Not The Right Tool Here

`AttackEnhancementDef` (combat-text-profile.ts L332-L368) is player-opt-in text-parsed (Stunning Strike, Divine Smite, OHT). Player types a keyword in damage text, `matchOnHitEnhancementsInText` returns matches, `HitRiderResolver.assembleOnHitEnhancements` builds a `HitRiderEnhancement`. **Colossus Slayer auto-fires** (no keyword) and checks target HP at hit time, so the inline pattern used by Sneak Attack / Elemental Affinity is the correct home — which is where it already lives.

## Ranger / Hunter Definition State

- `Ranger` definition ([ranger.ts L73-L157](packages/game-server/src/domain/entities/classes/ranger.ts#L73)) — complete, no changes needed.
- `Hunter` subclass ([ranger.ts L60-L72](packages/game-server/src/domain/entities/classes/ranger.ts#L60)) — features map includes `HUNTERS_PREY: 3` and `COLOSSUS_SLAYER: 3`. No changes needed.
- `RANGER_COMBAT_TEXT_PROFILE` ([ranger.ts L161-L172](packages/game-server/src/domain/entities/classes/ranger.ts#L161)) — has one action mapping (move-hunters-mark) and empty `attackEnhancements`. No changes needed for CS.
- `MoveHuntersMarkExecutor` — mark transfer on kill is ALREADY implemented in [move-hunters-mark-executor.ts](packages/game-server/src/application/services/combat/abilities/executors/ranger/move-hunters-mark-executor.ts). Registered in `app.ts`.

## Subclass-Aware Feature Lookup

`classHasFeature(classId, feature, level, subclassId?)` in [registry.ts L103-L125](packages/game-server/src/domain/entities/classes/registry.ts#L103) already handles subclass features. Existing CS block passes `subclass` correctly (from `sheet.subclass`).

## Scenario Failure Prediction (did not run — analysis only)

Based on the hydration bug, expected failure point:

- **R1 attack 1 damage** (Ogre at full HP): CS correctly does NOT trigger — passes.
- **R1 attack 2 damage** (Ogre wounded): CS fires once, flag set to `true` — passes (Ogre HP 17-34).
- **End R1 → start R2**: hydration does NOT reset `colossusSlayerUsedThisTurn` (flag persists via `...resources` spread).
- **R2 attack 1 damage**: CS eligibility check fails on `!actorResRec.colossusSlayerUsedThisTurn` → no +1d8. Ogre takes roughly 9 less damage than scenario min bound. First failing assertion: `monsterHp: { name: "Ogre", min: 0, max: 18 }` — Ogre HP likely 19-27 instead.

Note: I have not actually run `combat-e2e.ts` in this research. High-confidence prediction; orchestrator can verify pre-implementation.

## Mark Transfer on Kill — Out of 3.8 Scope

Mark transfer (R3 step `move Hunter's Mark to Thug`) is already implemented via `MoveHuntersMarkExecutor` and registered. The scenario tests it end-to-end. No additional work in 3.8; verification only.

## Recommended Implementation

**Single-line fix** — add to [combat-hydration.ts L146-L165](packages/game-server/src/application/services/combat/helpers/combat-hydration.ts#L146-L165) reset block:

```ts
colossusSlayerUsedThisTurn: isFreshEconomy ? false : (resources as any).colossusSlayerUsedThisTurn ?? false,
elementalAffinityUsedThisTurn: isFreshEconomy ? false : (resources as any).elementalAffinityUsedThisTurn ?? false,
```

Add matching entries to `hydration-types.ts` (after line 91, next to `sneakAttackUsedThisTurn`) and default `false` in `resource-utils.ts` (around L196).

## Risks & Dependencies

1. **No domain class-file changes needed.** All 2024 data is already declared (feature-keys, Hunter subclass features map, capabilities).
2. **Elemental Affinity piggyback fix** — same reset bug. The plan should either fix both together (recommended — same pattern) or scope-gate Elemental Affinity out with a TODO.
3. **No new tests for Sneak Attack / Stunning Strike reset** needed — those flags are already in the reset list.
4. **Target HP read at hit time**: CS reads `targetForCS.hpCurrent` BEFORE damage application (via `findCombatantByEntityId(combatants, action.targetId)` — `combatants` was fetched earlier in `resolveDamageRoll`). This is correct per RAW ("missing any of its HP" evaluated at hit moment, not after weapon damage). Scenario R1 attack 1 (Ogre full HP) correctly denies CS; attack 2 (post-attack-1 damage) correctly allows it.
5. **AI/monster rangers**: If a Hunter ranger NPC is in combat, the flag would also persist across their turns. Same fix covers both actors since hydration is shared.
6. **Critical hits and CS**: Current implementation rolls 1 d8 flat — RAW 2024 does not double CS dice on crit. Behavior is correct (unlike Sneak Attack which does double on crit — separate concern).

## Verdict

Phase 3.8 is effectively a **one-file, two-line change** to `combat-hydration.ts` (plus hydration-types + resource-utils defaults for consistency). All heavy lifting (feature-keys, subclass features map, damage-resolver inline wiring, dice injection, persist flag, mark-transfer executor) was completed in earlier phases but never validated end-to-end across multiple turns.
