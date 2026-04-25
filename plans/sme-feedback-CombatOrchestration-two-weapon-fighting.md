# SME Feedback — CombatOrchestration — Round 1
## Verdict: NEEDS_WORK

## Issues (if NEEDS_WORK)
1. Offhand action-economy consumption is not fully covered in the plan. Current tabletop roll flow consumes an attack slot unconditionally in miss paths (`roll-state-machine.ts`) and in hit/damage completion (`damage-resolver.ts`) via `markActionSpent()`. If rework only updates offhand validation + damage math, offhand can still incorrectly consume Attack-action usage (especially harmful with Extra Attack interleaving).
2. "Pass real action-usage context" is underspecified for the `hasUsedAction("Attack")` contract used by bonus executors. If implemented as `actionSpent === true`, prerequisites will be wrong for multi-attack turns (first attack made, action not yet fully spent). The plan must pin this to real attack-usage counters/state, not a generic spent-action flag.
3. Test plan does not explicitly validate parser-chain vs fallback offhand parity. The objective calls out both routes, but listed scenarios only validate rules outcomes, not that both parse routes enforce identical prevalidation + Nick handling.

## Missing Context
- `handleBonusAbility()` currently injects a mock combat context with `hasUsedAction()` always true for all bonus abilities. This affects not only offhand but also Martial Arts / Flurry / Frenzy executor prerequisites that key on `Attack` usage.
- Offhand routing enters through at least two dispatcher branches (`parserChain offhand` and `command.kind === "offhand"`) with different prevalidation behavior today.

## Suggested Changes
1. Add explicit CombatOrchestration scope for offhand action-economy spend gating in both roll stages:
   - `tabletop/roll-state-machine.ts`: guard miss-path `markActionSpent()` calls so offhand bonus attacks do not consume Attack-action usage.
   - `tabletop/rolls/damage-resolver.ts`: guard post-hit `markActionSpent()` similarly for offhand bonus attacks.
2. In `dispatch/class-ability-handlers.ts`, replace mock `hasUsedAction()` bypass with a real implementation backed by actor combatant resources, and define `Attack` as "at least one attack has been used this turn" (e.g., `attacksUsedThisTurn > 0`), not "action fully spent".
3. In `tabletop/action-dispatcher.ts`, require a single shared offhand prevalidation helper used by both parser-chain offhand and fallback `command.kind === "offhand"` route, including Nick/bonus-cost behavior.
4. Expand tests to prove orchestration invariants, not only rule outcomes:
   - Add at least one scenario/assertion that forces fallback offhand route and verifies the same rejection/acceptance behavior as direct parser route.
   - Add an action-economy regression test for Extra Attack interleaving (`attack -> offhand -> second attack`) to ensure offhand does not consume Attack-action slots.
