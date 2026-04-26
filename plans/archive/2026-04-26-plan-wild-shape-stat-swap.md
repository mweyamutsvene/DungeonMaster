---
type: plan
flow: ClassAbilities,CreatureHydration,EntityManagement
feature: wild-shape-stat-swap
author: claude-orchestrator
status: COMPLETE
created: 2026-04-24
updated: 2026-04-26
---

# Plan: Wild Shape True Stat-Block Swap (Druid L2)

**Problem**: `WildShapeExecutor` grants temp HP + stores beast metadata in resources but doesn't swap stat block. Druid still uses character AC/attacks/damage. Wild Shape is cosmetic.

**Current**: stores `wildShapeAc/Hp/Attacks/Speed` in resources. No reverse hydration on session reload.

## Design: overlay at hydration time

Store `resources.wildShapeForm: WildShapeForm`. Hydration pipeline checks and overlays:

```ts
interface WildShapeForm {
  beastName: string;
  beastStats: ParsedMonsterStatBlock;
  originalCharacterId: string;
  appliedAtRound: number;
  hpRemainingInForm: number;  // separate pool
  hitDiceUsed: number;
}
```

**Overlay rules** (when `wildShapeForm` set):
- AC = beast AC
- Speed = beast speed (min of beast vs druid if druid higher)
- Attacks = beast attacks (druid STR/DEX for to-hit/damage at L2-9; beast stats at L10+)
- HP = `hpRemainingInForm` (separate from character HP)
- Saves: STR/DEX = beast; INT/WIS/CHA = character
- Skills: keep character's, add beast's if higher
- Size = beast

**Damage routing**: if `hpRemainingInForm > 0` → decrement beast pool. At 0 HP → revert, carry excess to character HP.

**Beast lookup**: `MonsterRepository.getByName("Brown Bear")` — already works for monsters.

**CR limits (2024)**:
- L2-3: CR 1/4 (no fly, no swim)
- L4-7: CR 1/2 (swim ok)
- L8+: CR 1 (fly ok)

**Revert triggers**: Wild Shape action again, beast HP → 0 (auto), long rest, Revert action (free in 2024).

## Files

| File | Change |
|---|---|
| `executors/druid/wild-shape-executor.ts` | Replace temp-HP path with form-overlay setter |
| `helpers/creature-hydration.ts` | Read `wildShapeForm`, overlay beast stats |
| `helpers/wild-shape-form-helper.ts` (NEW) | Apply/revert, validate CR vs level |
| `tabletop/rolls/damage-resolver.ts` | Route damage to beast HP first; auto-revert at 0 |
| `domain/entities/creatures/character.ts` | Optionally expose `getWildShapeForm()` |

## Tests
- Unit: `wild-shape-form-helper.test.ts` — valid forms, CR limits, revert on damage, excess HP carry
- E2E: druid wild-shapes Brown Bear, takes hits, beast HP→0, reverts with carry-over damage

## Risks
- Spellcasting in beast form: 2024 RAW allows; spell DC/attack must keep using druid stats via helper
- Wild Companion (spend Wild Shape for Find Familiar): out of scope, small follow-up
- Circle of Moon: stronger wild shape; depends on this plan, out of scope here

## Scope
~1.5 days. 5 files. ~400 LOC.

## Unblocks
Druid as frontline combatant L2+, Circle of Moon subclass viable.

## Execution Checklist
- [x] Run pre-change baseline gates (`typecheck`, `test`, `test:e2e:combat:mock -- --all`).
- [x] Add RED tests (unit + integration + E2E) for structured Wild Shape form state and stat swap.
- [x] Implement structured `wildShapeForm` state model and replace temp-HP-only Wild Shape execution path.
- [x] Integrate Wild Shape form overlay into hydration, tabletop attack selection, AC resolution, and damage routing.
- [x] Integrate Wild Shape form HP routing into AI melee/ranged damage application.
- [x] Green targeted regression suite (`wild-shape-form-helper`, wild-shape executor overlay test, integration + druid scenarios).
- [x] Run full post-change gates (`typecheck`, `test`, `test:e2e:combat:mock -- --all`).
- [x] Update legacy scenario expectation for removed Wild Shape temp HP assumption.

## Open Issues
- [x] `core/party-npc-victory` showed transient failure during one full-E2E pass; isolated rerun passed and final full-E2E rerun passed.
