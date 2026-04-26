# SME Feedback — ClassAbilities — Round 1
## Verdict: NEEDS_WORK

## Issues (if NEEDS_WORK)
1. The ClassAbilities slice is underspecified around the actual NPC mechanics payload. The plan says [packages/game-server/src/domain/entities/creatures/npc.ts](packages/game-server/src/domain/entities/creatures/npc.ts) will expose Character-like class metadata getters, but ClassAbilities needs more than `className` and `level`. Executors and `buildCombatResources()` also depend on subclass, classLevels, ability scores, feat ids, prepared spells, spell slots, fighting style, and persisted resource pools. If the plan only adds lightweight getters, class-backed NPCs may pass a direct feature gate while still failing resource initialization, prepared-spell reactions, or subclass-gated abilities.
2. The test plan does not explicitly validate the ClassAbilities resource-builder contract for class-backed NPCs. The proposal adds an initiative-handler change, but the listed tests only prove route validation, hydration, and one tabletop class-ability dispatch. That can still miss the main failure mode where the NPC enters combat without class-owned pools or prepared-spell flags, causing ability execution and reactions to fail later.

## Missing Context
- Clarify whether class-backed NPC persistence will carry the same mechanics fields Characters already expose to ClassAbilities consumers: `classId` or normalized `className`, `level`, optional `subclass`, optional `classLevels`, `resourcePools`, `featIds`, `preparedSpells`, `knownSpells`, `spellSlots`, `fightingStyle`, and equipment snapshot data.
- Clarify whether class-backed NPCs are expected to support only direct class-ability execution, or also the broader ClassAbilities surface that rides on combat resources: prepared-spell reactions, subclass feature flags, pact magic, fighting-style reaction flags, and feat-driven combat flags.

## Suggested Changes
1. Tighten the NPC domain and hydration steps so the plan explicitly treats a class-backed NPC as an NPC with a Character-like mechanics payload, not just an NPC with extra `className` and `level` fields. The plan should name the required mechanics fields above and make them available through the existing ClassAbilities consumption paths.
2. Add one targeted validation step for initiative-time combat resource building on a class-backed NPC. At minimum, assert that entering combat produces the expected class resource pools and derived flags for a representative class-backed NPC, so the dispatcher test is not the only proof.