---
type: pattern
flow: ClassAbilities
feature: pattern-class-feature-l1-5
author: claude-orchestrator
status: COMPLETE
created: 2026-04-24
updated: 2026-04-24
---

# Pattern — Class Feature at Levels 1–5

A consolidated shape for adding a non-spell class ability that lives in the L1–5 progression band. Covers Rogue Cunning Strike, Wizard Arcane Recovery, Warlock Dark One's Blessing, Sorcerer Draconic Resilience, Fighter Fighting Style passive, etc.

Use the scaffold CLI to generate skeletons:

```bash
pnpm scaffold class-feature <class> <feature-name>
```

## Files Touched (always 6)

| # | File | Action |
|---|------|--------|
| 1 | `domain/entities/classes/feature-keys.ts` | add `export const FEATURE_KEY = 'feature-key'` |
| 2 | `domain/entities/classes/<class>.ts` | add to `features` map: `'feature-key': minLevel`. If text-driven, add to `<CLASS>_COMBAT_TEXT_PROFILE.actionMappings` |
| 3 | `application/services/combat/abilities/executors/<class>/<feature>-executor.ts` | new file implementing `AbilityExecutor` |
| 4 | `application/services/combat/abilities/executors/<class>/index.ts` | export the new executor |
| 5 | `application/services/combat/abilities/executors/index.ts` | re-export from `<class>/index` |
| 6 | `infrastructure/api/app.ts` | register in BOTH main and test registries: `abilityRegistry.register(new FeatureExecutor())` |

Plus testing surface (always 2):

| # | File | Action |
|---|------|--------|
| 7 | `executors/<class>/<feature>-executor.test.ts` | unit tests — `canExecute` true/false paths + `execute` happy path with mocked dice |
| 8 | `scripts/test-harness/scenarios/<class>/<feature>.json` | E2E scenario — must FAIL initially (drives implementation) |

## Three Decision Points

1. **Bonus action vs free action vs reaction.** Determines routing in `TabletopCombatService.parseCombatAction()` and which `handle*Ability()` path consumes economy.
   - Bonus action (Rogue Cunning Action, Monk Flurry) → `handleBonusAbility()` consumes `bonusActionUsed`.
   - Free (Fighter Action Surge) → `handleClassAbility()`, no economy consumption, but spends a resource pool.
   - Reaction (Wizard Shield, Warlock Hellish Rebuke) → wired via `attackReactions` in `ClassCombatTextProfile`, NOT through executors.

2. **Resource pool.** If the feature has limited uses, declare a pool in `class-resources.ts` and initialize in `handleInitiativeRoll()` when combat starts. Use `<feature>UsedThisTurn` flag if it's a once-per-turn rider; reset in `combat-hydration.ts isFreshEconomy` block.

3. **Subclass gating.** Two-tier check:
   - Necessary: `features` map provides the level gate via `classHasFeature(classId, FEATURE_KEY, level)`.
   - Sufficient: executor's `canExecute()` guards the subclass match (e.g., Draconic Sorcery Red).

## Common Mistakes

- Forgetting to register in BOTH main + test registry in `app.ts` → "feature works in CLI but tests fail."
- Forgetting `combat-hydration.ts` reset of per-turn flags → feature fires only once per combat instead of once per turn (see Colossus Slayer fix in commit `3f6c6dd`).
- Adding a boolean `has<Feature>()` method on `ClassFeatureResolver` instead of using the features map. **NEVER do this.** Use `classHasFeature()`.

## Reference Implementations

- **Cunning Strike (Rogue L5, 2024)** — text-rider on attack action: [packages/game-server/src/domain/entities/classes/rogue.ts](../../packages/game-server/src/domain/entities/classes/rogue.ts) + commit `059d8f4`.
- **Arcane Recovery (Wizard L1)** — rest-time bookkeeping, NOT an in-combat executor: commit `3d4d213`.
- **Dark One's Blessing (Warlock Fiend L3)** — passive damage-resolver hook with subclass check: commit `1883241`.
- **Fighting Style passives (Fighter L1)** — `ClassCombatTextProfile.attackEnhancements` + reactions: commit `6ffb3e2`.

## Verification Checklist

- [ ] `pnpm -C packages/game-server typecheck` clean
- [ ] `pnpm -C packages/game-server test` — new unit test passes
- [ ] `pnpm -C packages/game-server test:e2e:combat:mock -- --all` — new scenario passes (and was failing before implementation)
- [ ] No new `has<Feature>()` boolean on `ClassFeatureResolver`
- [ ] Executor registered in BOTH `app.ts` registries
