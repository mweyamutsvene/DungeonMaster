# SME Research — CombatOrchestration — Two-Weapon Fighting Rework (Light + Bonus Off-hand)

## Scope
- Files read (approx line counts):
  - `packages/game-server/src/application/services/combat/tabletop/action-dispatcher.ts` (~630)
  - `packages/game-server/src/application/services/combat/tabletop/combat-text-parser.ts` (~700)
  - `packages/game-server/src/application/services/combat/tabletop/dispatch/class-ability-handlers.ts` (~860)
  - `packages/game-server/src/application/services/combat/tabletop/roll-state-machine.ts` (~1550)
  - `packages/game-server/src/application/services/combat/tabletop/rolls/damage-resolver.ts` (~900)
  - `packages/game-server/src/application/services/combat/tabletop/tabletop-types.ts` (~540)
  - `packages/game-server/src/application/services/combat/tabletop/pending-action-state-machine.ts` (~60)
  - `packages/game-server/src/application/services/combat/tabletop/tabletop-event-emitter.ts` (~250)
  - `packages/game-server/src/application/services/combat/helpers/resource-utils.ts` (~440)
  - `packages/game-server/src/application/services/combat/helpers/combat-hydration.ts` (~230)
  - `packages/game-server/src/application/services/combat/abilities/executors/common/offhand-attack-executor.ts` (~210)
  - `packages/game-server/src/domain/combat/two-weapon-fighting.ts` (~50)
  - `packages/game-server/scripts/test-harness/scenarios/core/offhand-attack.json`
  - `packages/game-server/scripts/test-harness/scenarios/core/twf-light-required.json`
  - `packages/game-server/scripts/test-harness/scenarios/mastery/nick-mastery.json`
- Task context: Review current two-weapon flow in CombatOrchestration and identify rework plan for parser/dispatch/pending-state/damage/action-economy, with concrete implementation and test recommendations.

## Current State
- Parsing:
  - `tryParseOffhandAttackText()` accepts `offhand attack`, `off-hand`, `bonus attack`, `twoweaponattack` patterns.
- Dispatch:
  - Direct parser-chain route (`id: offhand`) does pre-validation: requires 2 weapons, both Light, and checks Nick mastery to optionally skip bonus action cost.
  - LLM fallback route (`command.kind === "offhand"`) directly calls `handleBonusAbility(..."base:bonus:offhand-attack")` without the parser-chain TWF/Nick pre-validation.
- Ability execution / pending action:
  - `OffhandAttackExecutor` in tabletop mode creates `ATTACK` pending action with `bonusAction: "offhand-attack"` and damage modifier forced to `0`.
  - It validates TWF via domain `canMakeOffhandAttack(...)`, but currently never passes `hasDualWielderFeat`.
  - It checks "Attack action required" via `combat.hasUsedAction(actorId, "Attack")`.
  - In tabletop orchestration, `ClassAbilityHandlers.handleBonusAbility()` provides a mock combat context where `hasUsedAction()` always returns `true`, effectively bypassing that prerequisite.
- Pending action state machine:
  - No dedicated offhand state. Offhand uses standard `ATTACK -> DAMAGE -> null` transitions.
- Damage resolution:
  - Base offhand damage uses `roll + parsed damage modifier` where offhand pending action sets base modifier to `0`.
  - `DamageResolver` adds TWF-style ability modifier back only when `action.bonusAction === "offhand-attack"` and feat modifiers indicate TWF style.
  - Extra Attack chaining explicitly excludes bonus-action attacks, including offhand.
- Action economy flags:
  - Bonus action gating in class ability path uses `hasBonusActionAvailable()` / `useBonusAction()` (`bonusActionUsed` flag).
  - Hydration serializes `bonusActionSpent` (domain economy) and also carries `bonusActionUsed`, creating dual-flag compatibility surface.
  - Nick flow sets `nickUsedThisTurn` when bonus cost is skipped.

## Impact Analysis
| File | Change Required | Risk | Why |
|------|-----------------|------|-----|
| `application/services/combat/tabletop/action-dispatcher.ts` | Medium | High | Must unify offhand validation between direct parser-chain and LLM fallback route; currently divergent behavior. |
| `application/services/combat/tabletop/combat-text-parser.ts` | Low | Low | Keep parser pure; maybe extend aliases only. |
| `application/services/combat/tabletop/dispatch/class-ability-handlers.ts` | Medium | High | Must stop bypassing offhand Attack prerequisite (mock `hasUsedAction: true` currently bypasses). |
| `application/services/combat/abilities/executors/common/offhand-attack-executor.ts` | Medium | High | Must support Dual Wielder override and reliable prerequisite checks from real turn state. |
| `application/services/combat/tabletop/tabletop-types.ts` | Low | Medium | Ensure offhand metadata contract remains explicit/stable (`bonusAction` discriminator). |
| `application/services/combat/tabletop/rolls/damage-resolver.ts` | Medium | Medium | Offhand damage correctness depends on `bonusAction` tag and feat-mod mapping; fragile if tagging drifts. |
| `application/services/combat/tabletop/tabletop-event-emitter.ts` | Medium | Medium | `markActionSpent()` currently increments attack counters for every resolved hit/miss path, including bonus-action offhand. Validate intended semantics. |
| `application/services/combat/helpers/resource-utils.ts` | Low | Medium | Mixed `*Used`/`*Spent` vocab impacts enforcement consistency for bonus-action checks. |
| `application/services/combat/helpers/combat-hydration.ts` | Low | Medium | Compatibility bridge between `bonusActionSpent` and `bonusActionUsed` can mask drift. |
| `domain/combat/two-weapon-fighting.ts` | Low | Low | Domain already models Dual Wielder + offhand damage modifier policy; orchestration needs to consume it consistently. |

## Constraints & Invariants
- Facade remains thin: `TabletopCombatService` should continue delegating to dispatcher/roll modules.
- `CombatTextParser` functions remain pure and side-effect free.
- Pending-action transitions must remain valid (`ATTACK -> DAMAGE -> ...`) with no illegal state jumps.
- Bonus-action offhand must not auto-chain as Extra Attack.
- D&D 5e 2024 intent to preserve:
  - Offhand attack requires Attack action context.
  - Light-property gate unless feature/feat override is explicitly implemented.
  - Offhand base damage excludes ability mod unless TWF style adds it.
  - Nick can preserve bonus action once per turn.

## Options & Tradeoffs
| Option | Pros | Cons | Recommendation |
|--------|------|------|---------------|
| A. Keep split validation (parser-chain only) and patch edge bugs | Small diff | Leaves LLM fallback inconsistent; high regression risk | ✗ Avoid |
| B. Centralize offhand eligibility in a single helper/service used by both parser-chain and LLM fallback | One source of truth; easier tests; cleaner invariants | Moderate refactor across dispatcher + executor + handler context | ✓ Preferred |
| C. Move all offhand checks only into executor, remove dispatcher pre-checks | Strong encapsulation | Requires richer execution context and may reduce early error clarity | △ Viable if done fully |

## Risks
1. Validation divergence risk: direct parser and LLM fallback can disagree on legality.
   - Mitigation: centralize legality check and route both paths through same function.
2. Attack-prerequisite bypass risk: mock combat context currently permits offhand at any time.
   - Mitigation: pass real per-turn action usage signal (or explicit flag) into executor params.
3. Bonus-action flag drift risk (`bonusActionUsed` vs `bonusActionSpent`).
   - Mitigation: standardize checks/writes for offhand path, add regression tests for both representations.
4. Damage-tag coupling risk: TWF damage add-back depends on `bonusAction === "offhand-attack"` string.
   - Mitigation: keep a typed discriminator constant/shared enum and assert in tests.
5. Nick behavior risk: one-per-turn skip can regress if reset/consumption path changes.
   - Mitigation: assert first/second offhand attempts in same turn and after turn reset.

## Recommendations
1. Implementation recommendations (concrete):
   - Introduce one offhand-eligibility function in orchestration layer that returns structured reason codes (`NO_OFFHAND`, `NOT_LIGHT`, `ATTACK_NOT_USED`, `NO_BONUS_ACTION`, `NICK_FREE_OK`, `DUAL_WIELDER_OK`).
   - Use it in BOTH `action-dispatcher` parser-chain offhand entry and LLM `command.kind === "offhand"` branch before calling `handleBonusAbility`.
   - Replace mock `hasUsedAction: true` dependency for offhand prerequisite with explicit real-turn context from resources/action-economy (or pass `attackActionUsedThisTurn` in params).
   - Wire Dual Wielder feat detection from character sheet/resources into `canMakeOffhandAttack(..., hasDualWielderFeat)`.
   - Keep offhand pending-action tagging explicit (`bonusAction: "offhand-attack"`) and avoid magic-string duplication.
   - Decide and codify whether offhand should increment `attacksUsedThisTurn`; if not intended, avoid `markActionSpent()` for bonus-action attacks or split action-vs-attack counters.
2. Unit/integration test recommendations:
   - Add dispatcher tests that compare direct-parse and LLM-fallback outcomes for identical offhand intent (must match).
   - Add class-ability/offhand executor tests for prerequisite enforcement in tabletop context (attack not used -> fail).
   - Add Dual Wielder test (non-Light pair should pass when feat present).
   - Add Nick tests: first offhand skips bonus cost, second offhand same turn consumes/fails appropriately.
   - Add damage-resolver tests verifying:
     - Offhand without TWF style: no ability mod.
     - Offhand with TWF style: ability mod added.
     - Main-hand attack with TWF style unchanged.
3. E2E strong-coverage assertion targets (where to assert):
   - `action` step immediately after combat start: offhand before any Attack action should assert error (`ATTACK_ACTION_REQUIRED` or equivalent message).
   - `action` step for offhand via alternate phrasing likely to trigger LLM fallback (avoid regex aliases) should assert same legality as direct parse.
   - `rollResult` damage step after offhand hit should assert exact HP delta proving base no-mod damage and TWF-style add-back in separate scenarios.
   - `assertState` after Nick offhand then another bonus-action feature (e.g., Second Wind) should assert bonus action preserved once.
   - `assertState` same turn second Nick offhand attempt should assert failure/bonus spent behavior.
   - `assertState` at next turn start should assert `nickUsedThisTurn` reset behavior indirectly (offhand can again preserve bonus once).
   - `assertState` around action economy should target both availability outcomes and resource flags that drive gate logic (`bonusActionUsed`/effective bonus availability).

## Verdict
- Rework is warranted in CombatOrchestration because current two-weapon flow has correctness gaps at route consistency and Attack-prerequisite enforcement, with moderate-to-high regression risk unless validation is centralized and backed by parity tests across parse paths.
