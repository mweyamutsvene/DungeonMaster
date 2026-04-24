# SME Feedback — ClassAbilities — Round 2
## VERDICT: APPROVED

All three round 1 notes are incorporated.

## Note verification

1. **No new registry collector — reuse `getAllCombatTextProfiles()`** ✓
   - Plan extends existing `ClassCombatTextProfile` with optional `allyAttackReactions?: AttackReactionDef[]` field (combat-text-profile.ts bullet 1).
   - New `detectAllyAttackReactions(input, profiles)` helper takes the same `profiles` collection — no parallel registry, no new `registry.ts` getter. Application callers continue using `getAllCombatTextProfiles()`.

2. **Hydration staleness follow-up TODO** ✓
   - `combat-resource-builder.ts` bullet: "TODO: staleness on mid-combat re-equip."
   - Also acknowledged in Deferred: "Mid-combat re-equip flag refresh: not exercised v1."
   - Scope is clear: flags computed at hydration time only; re-equip mid-combat will not refresh protection/interception eligibility in v1.

3. **Negative assertion test against target-scan** ✓
   - Test Plan line: `combat-text-profile.ally-reactions.test.ts — detection positive/negative/condition-gated cases + negative assertion against target-scan.`
   - This locks in that `detectAllyAttackReactions` does NOT fire when the protector IS the target (i.e., self-scan must go through the normal `attackReactions` path like Shield). Prevents future regressions from collapsing the two scan paths.

## Additional observations (non-blocking)
- Condition gate moved into both `protection.ts` helpers AND `detect()` — good defense in depth; domain helper is authoritative, profile-level gate short-circuits earlier.
- `fighter.ts` TODO comments explicitly mention OA path is deferred — consistent with Deferred §.

## No new issues for ClassAbilities flow.
Defer to ReactionSystem-SME on rollMode/ordering math and CombatOrchestration-SME on Dueling offhand wiring.
