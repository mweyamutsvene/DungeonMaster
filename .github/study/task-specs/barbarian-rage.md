# Task Spec: Class Features Phase 8.1 — Barbarian Gaps

## Objective
Complete Barbarian class feature coverage. Domain already has: Rage resource pool, Rage damage bonus, combat text profile (rage + reckless-attack), and 2 executors (Rage, Reckless Attack). Fill the remaining 6 feature gaps.

## Rules Reference (D&D 5e 2024)

### Rage Damage Resistance
While raging, Barbarian has resistance to bludgeoning, piercing, and slashing damage.

### Unarmored Defense
When wearing no armor: AC = 10 + DEX modifier + CON modifier. Can still use a shield.

### Danger Sense (Lv 2)
Advantage on DEX saving throws against effects you can see (traps, spells). Not while Blinded, Deafened, or Incapacitated.

### Extra Attack (Lv 5)
Can attack twice when taking the Attack action on their turn.

### Rage End Mechanics
Rage ends early if: (a) the Barbarian didn't attack a hostile creature or take damage since the start of their last turn, or (b) the Barbarian falls unconscious.

### Feral Instinct (Lv 7)
Advantage on initiative rolls. Additionally, can't be surprised unless incapacitated.

## Scope

### Files to Modify
1. `packages/game-server/src/domain/entities/classes/barbarian.ts` — Feature definitions, resource pool updates
2. `packages/game-server/src/application/services/combat/abilities/executors/barbarian/rage-executor.ts` — Add resistance granting
3. `packages/game-server/src/domain/rules/damage-defenses.ts` — Support rage resistance in damage calculation
4. `packages/game-server/src/domain/combat/attack-resolver.ts` — Unarmored Defense AC override
5. `packages/game-server/src/application/services/combat/tabletop/roll-state-machine.ts` — Initiative advantage, damage resistance
6. `packages/game-server/src/application/services/combat/tabletop/action-dispatcher.ts` — Extra Attack for Barbarian
7. Turn advancement / rage tracking — Rage end mechanics

### Files to Create
8. E2E: `packages/game-server/scripts/test-harness/scenarios/barbarian/rage-resistance.json`
9. E2E: `packages/game-server/scripts/test-harness/scenarios/barbarian/unarmored-defense.json`
10. E2E: `packages/game-server/scripts/test-harness/scenarios/barbarian/rage-ends.json`
11. E2E: `packages/game-server/scripts/test-harness/scenarios/barbarian/extra-attack.json`

### Files to Read (Context Required)
- `packages/game-server/src/domain/entities/classes/barbarian.ts` — Current domain state
- `packages/game-server/src/application/services/combat/abilities/executors/barbarian/` — Both executors
- `packages/game-server/src/domain/rules/class-resources.ts` — Resource pool initialization
- `packages/game-server/src/domain/entities/classes/fighter.ts` — Extra Attack pattern to follow
- `packages/game-server/src/application/services/combat/tabletop/roll-state-machine.ts` — Initiative + damage flow

## Tasks

| # | Feature | Details | Complexity |
|---|---------|---------|-----------|
| 1 | Rage damage resistance | Rage executor grants B/P/S resistance; damage-defenses.ts applies it | Small |
| 2 | Unarmored Defense | AC = 10 + DEX + CON when no armor; check in attack resolution | Small |
| 3 | Danger Sense | Advantage on visible DEX saves; flag in combatant resources | Small |
| 4 | Extra Attack (Lv 5) | Barbarian extra attack — ensure class-agnostic if Fighter pattern exists | Medium |
| 5 | Rage end mechanics | End rage if no attack/damage last turn OR unconscious | Medium |
| 6 | Feral Instinct (Lv 7) | Advantage on initiative rolls | Small |

## Cross-Domain Touches
- **Domain rules** (damage-defenses, attack-resolver): Resistance lookup, AC calculation
- **Domain classes** (barbarian.ts): Feature definitions, resource updates
- **Application executors** (rage-executor): Resistance granting logic
- **Application tabletop** (roll-state-machine, action-dispatcher): Initiative, damage, extra attack
- **E2E scenarios**: 4 new scenario files

## Verification
- `pnpm -C packages/game-server typecheck` passes
- `pnpm -C packages/game-server test` passes
- `pnpm -C packages/game-server test:e2e:combat:mock` passes (including 4 new scenarios)
- Existing barbarian scenarios still pass (`barbarian/rage-damage-bonus.json`, etc.)
