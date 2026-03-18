# Task Spec: Cover Mechanics Phase 13.1 — DEX Saving Throw Cover Bonus

## Objective
Implement DEX saving throw cover bonus per D&D 5e 2024 rules. When a creature has cover relative to the source of a DEX save effect (e.g., Fireball), it gains +2 (half cover) or +5 (three-quarters cover) to the save. Total cover means automatic success.

## Rules Reference
| Degree | AC Bonus | DEX Save Bonus |
|--------|----------|----------------|
| Half Cover | +2 | +2 |
| Three-Quarters Cover | +5 | +5 |
| Total Cover | Auto-success | Auto-success |

## Scope

### Files to Modify
1. `packages/game-server/src/application/services/combat/tabletop/saving-throw-resolver.ts` — Add cover calculation for DEX saves
2. `packages/game-server/src/domain/rules/combat-map.ts` — Possibly extend `getCoverLevel()` if additional context needed

### Files to Create
3. `packages/game-server/scripts/test-harness/scenarios/core/cover-dex-save-bonus.json` — E2E scenario

### Files to Read (Context Required)
- `packages/game-server/src/domain/rules/combat-map.ts` — Existing `getCoverLevel()`, `getCoverACBonus()`
- `packages/game-server/src/application/services/combat/tabletop/saving-throw-resolver.ts` — Current save resolution flow
- `packages/game-server/src/application/services/combat/tabletop/spell-action-handler.ts` — How save-based spells call the resolver
- `packages/game-server/src/application/services/combat/tabletop/tabletop-types.ts` — Type definitions

## Tasks

| # | Task | Details |
|---|------|---------|
| 1 | Extend SavingThrowResolver context | Pass caster position + combat map into saving throw resolution |
| 2 | Calculate cover between caster and target | Call `getCoverLevel()` for DEX saves only |
| 3 | Apply bonus to DEX save total | Half → +2, Three-quarters → +5, Total → auto-success |
| 4 | E2E scenario | `core/cover-dex-save-bonus.json` — creature behind half cover gets +2 on Fireball DEX save |

## Verification
- `pnpm -C packages/game-server typecheck` passes
- `pnpm -C packages/game-server test` passes
- `pnpm -C packages/game-server test:e2e:combat:mock` passes (including new scenario)
- Existing `core/cover-ac-bonus.json` scenario still passes (no regression)
