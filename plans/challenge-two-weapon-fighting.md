# Plan Challenge — Two-Weapon Fighting Rework

## Overall Assessment: ADEQUATE

## Critical Issues (must address before implementation)
1. Route-parity hole between parser-chain and fallback offhand paths is not explicitly closed in plan steps.
Required: one shared offhand-eligibility gate used by direct parser and fallback command routes.

2. Attack-action prerequisite bypass is known in tabletop mock context but not fully closed in all call sites.
Required: remove mock-true hasUsedAction behavior for offhand checks and pass real action-usage signal.

3. Dual Wielder support is under-specified.
Required: explicitly wire feat-source data flow into legality evaluator for both routes.

4. Offhand style damage add-back depends on string tagging.
Required: protect with a typed/shared discriminator contract and tests.

5. Action-economy compatibility surface is not addressed.
Required: verify bonus-action behavior across bonusActionUsed and bonusActionSpent compatibility paths.

## Concerns
1. Offhand attacks and attacks-used counters need explicit policy and tests.
2. AI offhand intent parity is not explicitly covered.
3. Nick once-per-turn negative test should be required.

## Edge Cases to Test
1. Same intent with parser-route and fallback-route phrasing yields identical legality/resource outcomes.
2. Offhand before Attack action fails via both routes.
3. Dual Wielder allows non-Light pair; no-feat case fails.
4. Nick first free offhand preserves bonus action; second free attempt same turn is blocked/charged per design.
5. Next turn reset allows one free Nick again.
6. Offhand without style excludes ability modifier.
7. Offhand with style includes ability modifier.
8. Main-hand with style unchanged.
9. Dueling does not apply on offhand while TWF style still can.
10. Bonus-action outcomes consistent despite spent/used compatibility representation.
