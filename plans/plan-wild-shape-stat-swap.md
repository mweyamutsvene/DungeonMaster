---
type: plan
flow: ClassAbilities,CreatureHydration,EntityManagement
feature: wild-shape-stat-swap
author: claude-orchestrator
status: DRAFT
created: 2026-04-24
updated: 2026-04-24
---

# Plan: Wild Shape true stat-block swap (Druid L2)

## Why this matters

Druid L2 Wild Shape is THE druid identity feature. Current implementation in `wild-shape-executor.ts` grants temp HP and stores beast-form metadata in resources but **does NOT actually swap the creature's stat block**. Effect: the druid still uses character AC, attack bonus, damage dice. The "wild shape" is cosmetic.

## Current state

- `WildShapeExecutor` creates temp HP equal to beast HP and stores `wildShapeAc`, `wildShapeHp`, `wildShapeAttacks`, `wildShapeSpeed` in resources.
- Comment in code: "Druid keeps their own HP; temp HP absorbs damage first" — explicitly diverges from RAW.
- `RevertWildShapeExecutor` clears the metadata.
- No reverse hydration: loading a session mid-wild-shape uses Character AC/HP, not beast form.

## Proposed design

### Approach — overlay stat-block at hydration time

Treat wild shape as a "form override" stored on the combatant. The CreatureHydration pipeline checks for an active wild shape form and overlays its stat block on top of the character.

```ts
interface WildShapeForm {
  beastName: string;           // e.g., "Brown Bear"
  beastStats: ParsedMonsterStatBlock;  // cached from monster catalog
  originalCharacterId: string;
  appliedAtRound: number;
  hpRemainingInForm: number;   // beast HP, separate from character HP
  hitDiceUsed: number;         // for revert validation
}
```

When hydrating a character with `resources.wildShapeForm` set:
1. AC = beastStats.armorClass
2. Speed = beastStats.speed (but min by druid's own if higher)
3. Attacks = beastStats.attacks (+ druid's STR/DEX for to-hit/damage at L2-L9, beast's stats at L10+)
4. HP = wildShapeForm.hpRemainingInForm (separate pool from character HP)
5. Saves: STR/DEX = beast's, INT/WIS/CHA = character's
6. Skills: keep character's, add beast's if higher
7. Size = beast's size

When damage is dealt:
- If `hpRemainingInForm > 0`, decrement that pool.
- If the form drops to 0 HP, revert to character form. Excess damage carries over to character HP.

### Approach choice: overlay vs replacement

**Overlay** (recommended): keep character data intact, layer beast stats on top. Easier to revert. Can be queried from sheet at any time.

**Replacement**: actually replace the combatant's stat block. Cleaner read-side but harder to revert correctly.

Overlay matches the existing partial implementation and minimizes disruption.

### Beast catalog

Need a lookup: beast name → ParsedMonsterStatBlock. The existing monsters parser handles this for monsters; wild shape just queries `MonsterRepository.getByName()` for "Brown Bear", "Wolf", "Giant Spider", etc.

CR limit per druid level (RAW 2024):
- L2-3: CR 1/4 (no fly, no swim — special clauses)
- L4-7: CR 1/2 (swim ok)
- L8+: CR 1 (fly ok)

### Reverting

Triggers:
- Druid uses Wild Shape action again (reverts to choose new form)
- Beast HP drops to 0 (auto-revert, excess carries over)
- Druid takes a long rest (forced revert)
- Druid activates Revert (free action 2024 RAW, none in 2014)

## Touched files

| File | Change |
|---|---|
| `application/services/combat/abilities/executors/druid/wild-shape-executor.ts` | Replace temp-HP path with form-overlay setter |
| `application/services/combat/helpers/creature-hydration.ts` | Read `resources.wildShapeForm` and overlay beast stats |
| `application/services/combat/helpers/wild-shape-form-helper.ts` (NEW) | Apply/revert form, validate CR vs druid level |
| `application/services/combat/tabletop/rolls/damage-resolver.ts` | Route damage to beast HP pool first; auto-revert on 0 |
| `domain/entities/creatures/character.ts` | Optionally expose `getWildShapeForm()` for sheet queries |

## Test strategy

- Unit: `wild-shape-form-helper.test.ts` — valid forms, CR limits, revert on damage, multi-revert (excess HP carry).
- E2E: scenario where druid wild-shapes into Brown Bear, takes hits, beast HP drops to 0, druid reverts to character form taking the carry-over damage.

## Risks

- Spellcasting in beast form: 2024 RAW says Druid can still cast spells via the special "Beast Form" rules. Verify spell DC/attack bonus continues to use druid stats.
- Wild Companion (2024) — spend Wild Shape to cast Find Familiar. Out of scope for this plan; small follow-up.
- Circle of the Moon (alt subclass) — stronger combat-focused wild shape. Depends on this plan; out of scope here.

## Estimated scope

~1.5 days. ~5 files touched. ~400 LOC.

## Unblocks

- Druid playable as a frontline combatant L2+
- Circle of the Moon subclass viable
