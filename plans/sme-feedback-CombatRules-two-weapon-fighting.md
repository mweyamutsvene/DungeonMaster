# SME Feedback — CombatRules — Round 1
## Verdict: NEEDS_WORK

## Issues (if NEEDS_WORK)
1. CombatRules step is too vague for a rules-critical change. "Expand TWF domain helper" does not specify the required rule outputs needed to prevent logic drift across dispatcher, executor, and damage resolver.
2. The plan does not explicitly preserve the Attack-action prerequisite as a hard invariant in the domain-facing contract. Current tabletop path has a known bypass risk when mock action state is used.
3. Nick handling is not specified as a strict once-per-turn contract in the proposed domain/helper API. Without this, bonus-action preservation and turn reset behavior can regress.
4. Dual Wielder override is listed only in executor work, not in the CombatRules contract. This keeps Light-gate logic fragmented and risks parser/fallback divergence.
5. Offhand damage modifier behavior is phrased as "preserve baseline" but the plan does not require explicit metadata to identify offhand/TWF attacks. Relying on bonus-action string sentinels is brittle and can break style interactions.

## Missing Context
- The plan does not state the required deterministic output shape for CombatRules evaluation (eligibility reason, bonus-action consumption, Nick marker, damage-mod policy).
- The plan does not anchor that all TWF checks must remain pure in domain logic and only consume precomputed combat state inputs.
- The plan does not explicitly bind to D&D 5e 2024 behavior as acceptance criteria per case (Light baseline, Dual Wielder override, Nick no-bonus-action once/turn, style damage add-back).

## Suggested Changes
1. Replace CombatRules bullet with a concrete contract task in packages/game-server/src/domain/combat/two-weapon-fighting.ts:
   - Add a pure evaluator returning structured result fields: `allowed`, `reason`, `requiresBonusAction`, `usesNick`, `offhandAddsAbilityModifier`.
   - Inputs must include: main/offhand weapon properties, hasDualWielderFeat, hasTwoWeaponFightingStyle, hasTakenAttackActionThisTurn, nickAlreadyUsedThisTurn, and offhandNickEligible.
2. Add an explicit invariant to the plan: offhand extra attack is denied when Attack action has not been taken this turn (before any parser/fallback branching).
3. Add an explicit invariant to the plan: Nick can waive bonus-action cost at most once per turn and must depend on turn-scoped `nickUsedThisTurn` lifecycle.
4. Move Dual Wielder override ownership into CombatRules evaluator (single source of truth), with orchestration limited to wiring feat/state inputs and enforcing returned decision.
5. Add one unit test block in CombatRules scope (domain-level) before orchestration edits:
   - Light+Light allowed, consumes bonus action.
   - Non-Light denied without Dual Wielder.
   - Non-Light allowed with Dual Wielder.
   - Nick path waives bonus action once, then reverts/denies per turn state.
   - Style toggles offhand ability-mod add policy only on valid offhand attack.