# SME Research — CombatRules — Two-Weapon Fighting 2024 Rework

## Scope
- Files read:
  - packages/game-server/src/domain/combat/two-weapon-fighting.ts (1-49)
  - packages/game-server/src/domain/combat/two-weapon-fighting.test.ts (1-59 via search excerpts)
  - packages/game-server/src/domain/rules/weapon-mastery.ts (1-194)
  - packages/game-server/src/domain/rules/feat-modifiers.ts (1-267, focused 160-267)
  - packages/game-server/src/domain/combat/attack-resolver.ts (210-280, plus earlier excerpts)
  - packages/game-server/src/domain/rules/fighting-style.test.ts (1-194)
  - packages/game-server/src/domain/entities/combat/action-economy.ts (1-109)
  - packages/game-server/src/domain/combat/combat.ts (1-260)
  - packages/game-server/src/application/services/combat/abilities/executors/common/offhand-attack-executor.ts (1-208)
  - packages/game-server/src/application/services/combat/tabletop/action-dispatcher.ts (440-540)
  - packages/game-server/src/application/services/combat/tabletop/dispatch/class-ability-handlers.ts (540-900)
  - packages/game-server/src/application/services/combat/tabletop/rolls/damage-resolver.ts (180-260 via excerpt)
  - packages/game-server/src/application/services/combat/tabletop/rolls/weapon-mastery-resolver.ts (300-390)
  - packages/game-server/src/application/services/combat/helpers/resource-utils.ts (150-340)
  - packages/game-server/src/application/commands/game-command.ts (70-320)
  - packages/game-server/src/application/services/combat/tabletop/combat-text-parser.ts (350-740)
  - packages/game-server/src/domain/entities/classes/combat-resource-builder.ts (180-290)
- Task context: Research current two-weapon fighting behavior and provide implementation guidance for DnD 5e 2024 (Light, bonus action, TWF style damage, Nick expectations) with CombatRules emphasis.

## Current State
- Pure domain TWF exists but is narrow:
  - canMakeOffhandAttack(main, off, hasDualWielderFeat=false) checks both Light unless feat bool is passed.
  - computeOffhandDamageModifier(abilityMod, hasStyle) exists but is currently only used in its own unit test.
- Effective runtime TWF flow is mostly application-layer orchestration:
  - Parsing: offhand command or text routes to offhand handling.
  - Dispatcher performs Light checks inline and checks Nick mastery to optionally skip bonus action cost.
  - Executor builds pending ATTACK with damage.modifier set to 0.
  - DamageResolver later re-adds ability modifier for Two-Weapon Fighting style when bonusAction === offhand-attack.
- Attack action prerequisite contract is present but currently weak in tabletop path:
  - Offhand executor checks combat.hasUsedAction(Attack).
  - In ClassAbilityHandlers tabletop execution context, mock combat hasUsedAction always returns true, so this prerequisite is not enforced there.
- Nick mastery handling split:
  - weapon-mastery.ts documents Nick as extra attack as part of Attack action (not bonus action), once/turn.
  - weapon-mastery-resolver does nothing for Nick and expects dispatch layer to handle it.
  - class-ability-handlers marks nickUsedThisTurn when skipBonusActionCost=true.
  - resetTurnResources clears nickUsedThisTurn each turn.
- Fighting style integration:
  - feat-modifiers includes twoWeaponFightingAddsAbilityModifierToBonusAttackDamage.
  - DamageResolver applies style by adding chosen ability mod for offhand attacks.
  - Dueling is prevented for offhand attacks by passing offhandWeaponEquipped=true when bonusAction is offhand-attack.

## Impact Analysis
| File | Change Required | Risk | Why |
|------|-----------------|------|-----|
| packages/game-server/src/domain/combat/two-weapon-fighting.ts | Expand API to return structured TWF eligibility/result context (Light check, extra-attack mode, bonus-action cost, style damage policy) | med | Current boolean helper cannot encode Nick mode or Attack-action coupling cleanly |
| packages/game-server/src/domain/rules/weapon-mastery.ts | Keep Nick semantics as single source of truth for rule text/metadata; potentially expose helper for Nick extra-attack mode | med | Nick behavior is currently duplicated conceptually across domain comments and dispatcher logic |
| packages/game-server/src/domain/rules/feat-modifiers.ts | Ensure TWF style damage modifier contract aligns with offhand attack classification | low | Existing flag is good, but coupling to action.bonusAction marker is indirect |
| packages/game-server/src/domain/combat/attack-resolver.ts | Optional: add explicit offhand/twf context in AttackSpec to reduce downstream inference and align with style/dueling logic | med | Currently lacks offhand context; app layer compensates with ad hoc markers |
| packages/game-server/src/application/services/combat/tabletop/action-dispatcher.ts | Refactor inline Light/Nick logic to call domain helper; preserve parsing intent only | high | Core runtime gate today; highest regression surface for offhand legality and Nick BA preservation |
| packages/game-server/src/application/services/combat/abilities/executors/common/offhand-attack-executor.ts | Consume richer domain result, remove duplicated/partial checks, support Dual Wielder integration through real feat lookup | high | Current validation and damage assumptions are split across layers and partially duplicated |
| packages/game-server/src/application/services/combat/tabletop/dispatch/class-ability-handlers.ts | Enforce real Attack-action prerequisite in tabletop path (do not hardcode hasUsedAction=true for offhand validation context) | high | Present behavior can allow offhand without actually spending Attack action |
| packages/game-server/src/application/services/combat/tabletop/rolls/damage-resolver.ts | Replace offhand detection by string marker with explicit context field if introduced; keep style damage additive logic | med | String sentinel bonusAction=offhand-attack is brittle |
| packages/game-server/src/application/services/combat/helpers/resource-utils.ts | Keep nickUsedThisTurn lifecycle stable; ensure reset semantics unchanged | med | Nick once/turn behavior depends on this flag resetting correctly |
| packages/game-server/src/application/commands/game-command.ts and combat-text-parser.ts | Keep command compatibility (offhand command/text aliases) while behavior shifts behind domain helper | low | Parser compatibility is user-facing but low-risk if command shape unchanged |

## Constraints and Invariants
- CombatRules purity: domain rules/combat helpers stay deterministic and infrastructure-free.
- 2024 rules baseline only.
- Nick once/turn tracking must remain turn-scoped and reset at turn start.
- Offhand extra attack still depends on taking Attack action in the turn.
- Bonus action economy must not be consumed when Nick is the applied path.
- Keep backwards command compatibility for offhand player inputs.

## Options and Tradeoffs
| Option | Pros | Cons | Recommendation |
|--------|------|------|---------------|
| A: Minimal patch in dispatcher/executor only | Fast, localized | Keeps rule logic duplicated and partially outside domain | Avoid for long-term correctness |
| B: Domain-first TWF policy object + thin orchestration | Centralizes Light/Nick/style decisions, testable pure logic, reduces drift | Requires touchpoints across dispatcher/executor/damage resolver | Preferred |
| C: Move all TWF into AttackResolver only | Very pure for combat math | Hard to model turn resources and bonus-action consumption there | Avoid |

## Risks
1. Hidden prerequisite bypass: Offhand can slip through without true Attack-action usage in tabletop path.
- Mitigation: pass real action usage state into executor validation context.
2. Nick/bonus-action desync: Nick preserving BA relies on skipBonusActionCost and nickUsedThisTurn synchronization.
- Mitigation: unify with a single domain result enum and one write path for nickUsedThisTurn.
3. Dual Wielder drift: domain helper supports a feat bool but runtime does not currently source it from feat IDs in offhand flow.
- Mitigation: plumb feat IDs into TWF policy evaluation explicitly.
4. Dueling and TWF interaction regressions: current gating partly depends on bonusAction string marker.
- Mitigation: attach explicit offhand/twf metadata to pending action.
5. Parser and AI contract breakage: changing offhand command semantics may impact LLM command generation/tests.
- Mitigation: keep kind=offhand contract stable and refactor internals only.

## 2024 RAW Considerations
- Light requirement:
  - Baseline: extra attack from two-weapon fighting requires Light weapon usage pattern.
  - Repo status: Light is enforced inline in dispatcher and in canMakeOffhandAttack, but Dual Wielder feat is not wired through feat IDs in runtime flow.
- Bonus action usage:
  - Baseline: extra attack normally costs bonus action.
  - Repo status: implemented via handleBonusAbility unless Nick sets skipBonusActionCost.
- Two-Weapon Fighting style damage modifier:
  - Baseline: style adds ability modifier to extra attack damage.
  - Repo status: applied in DamageResolver for offhand marker path.
- Nick mastery expectations:
  - Baseline: extra attack from Light weapon can be part of Attack action and not consume bonus action; once per turn.
  - Repo status: intent implemented via skipBonusActionCost + nickUsedThisTurn, with reset each turn; mastery resolver intentionally no-ops for Nick.

## Recommendations
1. Implement a domain-first TWF evaluator in CombatRules scope that returns structured output:
- canUseExtraAttack
- reason
- consumesBonusAction
- markNickUsed
- damageAbilityModifierPolicy
2. Route both dispatcher and offhand executor through that evaluator; remove duplicated Light checks.
3. Enforce Attack-action prerequisite with real state in tabletop path (replace mock always-true for this check).
4. Promote explicit offhand context on pending action instead of relying on bonusAction string sentinel.
5. Wire Dual Wielder feat lookup through feat IDs to the domain evaluator.
6. Add focused tests:
- domain: Light + Dual Wielder + Nick + style combinations
- orchestration: BA consumed vs preserved, nickUsedThisTurn lifecycle, Attack-action prerequisite
- regression: Dueling not applied on offhand while TWF style still applies when eligible.
