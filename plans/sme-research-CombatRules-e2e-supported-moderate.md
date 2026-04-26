---
type: sme-research
flow: CombatRules
feature: e2e-supported-moderate-2-1
author: combatrules-sme
status: DRAFT
created: 2026-04-25
updated: 2026-04-25
---

# SME Research - CombatRules - Section 2.1 Supported+Moderate E2E Backlog

Scope: only rows in section 2.1 with `Status=SUPPORTED` and `Coverage=MODERATE`.
Audience: E2EScenarioWriter.

## 1) Damage types + resistance/immunity/vulnerability
- 2024 rules target: immunity wins; resistance and vulnerability on same damage type cancel; final HP loss reflects post-defense damage.
- Existing coverage: `core/damage-resistance.json`, `core/potion-of-resistance.json`, `class-combat/fighter/tank-vs-resistance.json`.
- Highest-value missing E2E assertions: one deterministic sequence covering immunity precedence and resistance+vulnerability cancel in the same scenario.
- Recommended scenario action: EXTEND `packages/game-server/scripts/test-harness/scenarios/core/damage-resistance.json`.
- Suggested deterministic assertions (exact fields): `assertState.expect.characterHp`, `assertState.expect.monsterHp`, `rollResult.expect.hit`, `rollResult.expect.isCritical`.

## 2) Temp HP absorption
- 2024 rules target: damage is absorbed by temp HP first; leftover spills to HP; replacing temp HP uses highest value.
- Existing coverage: `core/combat-rules-matrix-temp-hp-conditions-exhaustion.json`, `core/heroism.json`, `core/potion-of-heroism.json`, `warlock/armor-of-agathys.json`.
- Highest-value missing E2E assertions: sequential-hit test proving temp HP depletion across multiple hits and replacement-with-higher-value behavior.
- Recommended scenario action: EXTEND `packages/game-server/scripts/test-harness/scenarios/core/combat-rules-matrix-temp-hp-conditions-exhaustion.json`.
- Suggested deterministic assertions (exact fields): `assertState.expect.characterTempHp`, `assertState.expect.characterHp`, `assertState.expect.monsterHp`.

## 3) Conditions (15/15)
- 2024 rules target: all listed conditions apply proper combat effects and are removable by correct save/expiry paths.
- Existing coverage: `core/combat-rules-matrix-temp-hp-conditions-exhaustion.json`, `core/combat-rules-matrix-grapple-shove-escape-unarmed.json`, `core/condition-stacking.json`, plus focused condition scenarios.
- Highest-value missing E2E assertions: deterministic coverage for under-asserted conditions (deafened/charmed/petrified/invisible branches) and condition clear timing.
- Recommended scenario action: ADD `packages/game-server/scripts/test-harness/scenarios/core/conditions-2024-full-matrix.json`.
- Suggested deterministic assertions (exact fields): `assertState.expect.characterConditions`, `assertState.expect.monsterConditions`, `assertState.expect.combatStatus`.

## 4) Exhaustion (2024: 10 levels, -2/level)
- 2024 rules target: exhaustion stacks up to 10; penalties apply consistently to d20 tests and movement; death at 10.
- Existing coverage: `core/exhaustion-accumulation.json`, `core/combat-rules-matrix-temp-hp-conditions-exhaustion.json`.
- Highest-value missing E2E assertions: turn-by-turn penalty scaling checkpoints and terminal state at level 10 in combat flow.
- Recommended scenario action: EXTEND `packages/game-server/scripts/test-harness/scenarios/core/exhaustion-accumulation.json`.
- Suggested deterministic assertions (exact fields): `rollResult.expect.disadvantage`, `assertState.expect.characterPosition`, `assertState.expect.characterHp`, `assertState.expect.combatStatus`.

## 5) Saving throws (adv/disadv, proficiency)
- 2024 rules target: save modifier includes correct proficiency; roll mode (adv/disadv/normal) applies from effects/features/context.
- Existing coverage: `wizard/counterspell-2024-proficient-save.json`, `wizard/counterspell-2024-con-save.json`, `class-combat/rogue/evasion-vs-aoe.json`, `core/combat-rules-matrix-cover-ac-dex.json`.
- Highest-value missing E2E assertions: one scenario forcing all three roll modes on saves with explicit proficient vs non-proficient branches.
- Recommended scenario action: EXTEND `packages/game-server/scripts/test-harness/scenarios/core/combat-rules-matrix-cover-ac-dex.json`.
- Suggested deterministic assertions (exact fields): `rollResult.expect.advantage`, `rollResult.expect.disadvantage`, `assertState.expect.characterHp`, `assertState.expect.monsterHp`, `assertState.expect.characterConditions`.

## 6) Ability checks + 18-skill proficiency + expertise
- 2024 rules target: check math respects ability modifier + proficiency/expertise/half-proficiency by skill mapping.
- Existing coverage: `core/search-action.json`, `core/hide-stealth-vs-passive.json`, `rogue/cunning-action-hide.json`, grapple contest scenarios.
- Highest-value missing E2E assertions: deterministic mini-matrix for proficiency vs expertise vs half-proficiency in live action flow.
- Recommended scenario action: ADD `packages/game-server/scripts/test-harness/scenarios/core/ability-checks-skill-matrix.json`.
- Suggested deterministic assertions (exact fields): `assertState.expect.characterConditions`, `assertState.expect.monsterConditions`, `assertState.expect.characterPosition`, `rollResult.expect.requiresPlayerInput`.

## 7) Death saves (3/3, nat 1/20, damage at 0)
- 2024 rules target: nat 1 = 2 fails, nat 20 = regain 1 HP, 3 fails = death, 3 successes = stable, damage-at-0 increments failures (crit-at-0 = +2).
- Existing coverage: `core/death-save.json`, `core/death-save-nat1.json`, `core/death-save-nat20.json`, `core/death-save-failure.json`.
- Highest-value missing E2E assertions: explicit post-KO incoming crit branch and stable-to-damage regression path.
- Recommended scenario action: EXTEND `packages/game-server/scripts/test-harness/scenarios/core/death-save-failure.json`.
- Suggested deterministic assertions (exact fields): `rollResult.expect.deathSaves`, `rollResult.expect.deathSaveResult`, `assertState.expect.characterHp`, `assertState.expect.combatStatus`.

## 8) Initiative
- 2024 rules target: deterministic initiative ordering with correct modifiers and tie behavior.
- Existing coverage: `core/surprise-ambush.json`, `core/partial-surprise.json`, `core/invisible-initiative.json`, `core/alert-initiative-swap.json`.
- Highest-value missing E2E assertions: deterministic tie-order regression with explicit modifier differences and swap interaction.
- Recommended scenario action: ADD `packages/game-server/scripts/test-harness/scenarios/core/initiative-tie-breakers.json`.
- Suggested deterministic assertions (exact fields): `endTurn.expect.nextCombatant`, `waitForTurn.actor`, `assertState.expect.combatStatus`.

## 9) Surprise (2024: disadvantage on init)
- 2024 rules target: surprised creature rolls initiative with disadvantage; hidden-vs-passive logic and DM overrides are coherent.
- Existing coverage: `core/surprise-ambush.json`, `core/auto-surprise-hidden.json`, `core/surprise-party.json`, `core/partial-surprise.json`.
- Highest-value missing E2E assertions: mixed visibility branch (one visible enemy should prevent surprise) plus per-combatant override check.
- Recommended scenario action: EXTEND `packages/game-server/scripts/test-harness/scenarios/core/auto-surprise-hidden.json`.
- Suggested deterministic assertions (exact fields): `rollResult.expect.disadvantage`, `rollResult.expect.advantage`, `assertState.expect.combatStatus`, `assertState.expect.characterHp`.

## 10) Alert feat (2024)
- 2024 rules target: Alert initiative bonus applies; surprise immunity and willing swap constraints enforced.
- Existing coverage: `core/alert-initiative-swap.json`, `core/alert-decline-swap.json`, `core/surprise-alert-willing-swap-red.json`.
- Highest-value missing E2E assertions: deterministic invalid-swap target cases plus no-surprise behavior in mixed party state.
- Recommended scenario action: EXTEND `packages/game-server/scripts/test-harness/scenarios/core/alert-initiative-swap.json`.
- Suggested deterministic assertions (exact fields): `rollResult.expect.disadvantage`, `endTurn.expect.nextCombatant`, `assertState.expect.characterConditions`, `assertState.expect.combatStatus`.

## 11) Concentration (gain/damage save/break/replace/end)
- 2024 rules target: concentration starts on cast, drops on failed check/unconscious/replacement/dispel, and linked effects are removed.
- Existing coverage: `core/concentration-damage-break.json`, `core/concentration-replacement.json`, `wizard/dispel-magic-concentration-break.json`, `warlock/hex-concentration-save.json`.
- Highest-value missing E2E assertions: incapacitation/unconscious break branch and effect-source cleanup verification.
- Recommended scenario action: EXTEND `packages/game-server/scripts/test-harness/scenarios/core/concentration-damage-break.json`.
- Suggested deterministic assertions (exact fields): `assertState.expect.characterConcentration`, `assertState.expect.monsterConcentration`, `assertState.expect.monsterActiveEffects`, `assertState.expect.characterHp`.

## 12) Grapple escape action
- 2024 rules target: action-based escape uses proper contest/save route; success clears grappled, failure preserves grappled.
- Existing coverage: `core/grapple-escape.json`, `core/combat-rules-matrix-grapple-shove-escape-unarmed.json`.
- Highest-value missing E2E assertions: both success and failure branches in one deterministic scenario with economy checkpoint.
- Recommended scenario action: EXTEND `packages/game-server/scripts/test-harness/scenarios/core/grapple-escape.json`.
- Suggested deterministic assertions (exact fields): `assertState.expect.characterConditions`, `assertState.expect.monsterConditions`, `assertState.expect.characterPosition`, `assertState.expect.combatStatus`.

## 13) Cover (half +2, 3/4 +5, total untargetable)
- 2024 rules target: half and three-quarters alter AC; total cover prevents targeting.
- Existing coverage: `core/cover-unified.json`, `core/combat-rules-matrix-cover-ac-dex.json`.
- Highest-value missing E2E assertions: explicit three-quarters and total-cover untargetable branch with deterministic miss/error checkpoints.
- Recommended scenario action: EXTEND `packages/game-server/scripts/test-harness/scenarios/core/cover-unified.json`.
- Suggested deterministic assertions (exact fields): `assertState.expect.monsterHp`, `action.expect.error`, `action.expect.errorContains`, `rollResult.expect.hit`.

## 14) Cover + Dex save bonus from AoE
- 2024 rules target: cover bonuses apply to Dex saves for area effects; non-Dex saves do not receive these bonuses.
- Existing coverage: `core/combat-rules-matrix-cover-ac-dex.json`, `core/cover-unified.json`.
- Highest-value missing E2E assertions: side-by-side Dex-save spell vs non-Dex-save spell with same geometry.
- Recommended scenario action: EXTEND `packages/game-server/scripts/test-harness/scenarios/core/combat-rules-matrix-cover-ac-dex.json`.
- Suggested deterministic assertions (exact fields): `assertState.expect.monsterHp`, `assertState.expect.characterHp`, `rollResult.expect.requiresPlayerInput`, `rollResult.expect.rollType`.

## 15) Dodge / Disengage / Dash
- 2024 rules target: Dodge imposes incoming attack disadvantage and grants Dex-save advantage until next turn; Disengage suppresses OA; Dash increases movement budget.
- Existing coverage: `core/dodge-disadvantage.json`, `core/disengage-prevents-oa.json`, `core/disengage-oa-suppression.json`, dash/movement scenarios, `rogue/cunning-action-dash.json`.
- Highest-value missing E2E assertions: Dodge expiry timing and same-round interaction with forced movement/AI attacks.
- Recommended scenario action: EXTEND `packages/game-server/scripts/test-harness/scenarios/core/dodge-disadvantage.json`.
- Suggested deterministic assertions (exact fields): `rollResult.expect.disadvantage`, `assertState.expect.characterHp`, `assertState.expect.characterPosition`, `assertState.expect.combatStatus`.

## 16) Two-weapon fighting (light + bonus off-hand)
- 2024 rules target: off-hand attack requires proper eligibility; ability modifier is not added unless negative; Nick/Dual Wielder constraints respected.
- Existing coverage: `core/offhand-attack.json`, `core/twf-light-required.json`, `core/twf-requires-attack-action.json`, `core/twf-nick-once-per-turn.json`, `core/twf-dual-wielder-non-light.json`, `core/twf-style-adds-offhand-modifier.json`.
- Highest-value missing E2E assertions: negative ability-modifier edge for off-hand damage (known fidelity gap).
- Recommended scenario action: RED `packages/game-server/scripts/test-harness/scenarios-pending/core/twf-negative-modifier-edge.json`.
- Suggested deterministic assertions (exact fields): `assertState.expect.monsterHp`, `rollResult.expect.hit`, `rollResult.expect.actionComplete`, `action.expect.error`.
- Expected failure reason: off-hand damage modifier handling for negative-mod branch is still not fidelity-complete.

## 17) Unarmed strikes (2024 STR+prof, 1+STR damage)
- 2024 rules target: baseline unarmed strike uses STR + proficiency to hit and 1 + STR modifier damage (non-monk baseline).
- Existing coverage: `core/combat-rules-matrix-grapple-shove-escape-unarmed.json`, grapple/shove scenarios, monk scenarios (non-baseline variants).
- Highest-value missing E2E assertions: explicit non-monk baseline formula path isolated from monk martial-arts scaling.
- Recommended scenario action: EXTEND `packages/game-server/scripts/test-harness/scenarios/core/combat-rules-matrix-grapple-shove-escape-unarmed.json`.
- Suggested deterministic assertions (exact fields): `rollResult.expect.rollType`, `rollResult.expect.hit`, `assertState.expect.monsterHp`, `assertState.expect.characterHp`.

## 18) Critical hit damage dice-vs-flat separation (2024)
- 2024 rules target: only dice are doubled on critical hit; flat bonuses are applied once.
- Existing coverage: `core/critical-hit.json`.
- Highest-value missing E2E assertions: crit with both dice and flat rider in one attack to verify no double-counting flat bonus.
- Recommended scenario action: EXTEND `packages/game-server/scripts/test-harness/scenarios/core/critical-hit.json`.
- Suggested deterministic assertions (exact fields): `rollResult.expect.isCritical`, `assertState.expect.monsterHp`, `assertState.expect.combatStatus`.

## Prioritization for E2E execution
1. RED first: `scenarios-pending/core/twf-negative-modifier-edge.json`.
2. Highest regression value to extend now: `core/damage-resistance.json`, `core/concentration-damage-break.json`, `core/cover-unified.json`, `core/exhaustion-accumulation.json`, `core/critical-hit.json`.
3. New additions after extensions: `core/conditions-2024-full-matrix.json`, `core/ability-checks-skill-matrix.json`, `core/initiative-tie-breakers.json`.
