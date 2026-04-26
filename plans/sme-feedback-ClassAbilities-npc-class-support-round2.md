# SME Feedback — ClassAbilities — Round 2
## Verdict: APPROVED

## Issues (if NEEDS_WORK)
- None.

## Missing Context
- None blocking for the ClassAbilities flow.
- Keep implementation aligned with the domain-first contract: class detection/feature gating stays in class domain files; NPC support should only provide Character-like mechanics data to existing ClassAbilities consumers.

## Suggested Changes
1. Keep the `npc.ts` mechanics getters and hydration/resolver wiring comprehensive enough to supply all ClassAbilities inputs already expected by executors and `buildCombatResources()` (class/subclass identity, level/classLevels, ability scores, resource pools, spell fields, feats/fighting style/equipment-derived flags).
2. Preserve single-path resource initialization through `buildCombatResources()` with no NPC-only fork so prepared-spell reactions and class-derived combat flags remain consistent.
3. Maintain the new initiative/resource and class-ability-dispatch tests as required regression gates for class-backed NPC support.