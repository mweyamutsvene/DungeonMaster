---
type: pattern
flow: SpellSystem
feature: pattern-spell-buff-debuff
author: claude-orchestrator
status: COMPLETE
created: 2026-04-24
updated: 2026-04-24
---

# Pattern — Spell with Buff / Debuff Effect

Shape for adding a spell whose effect routes through `BuffDebuffSpellDeliveryHandler`. Covers `temp_hp`, `recurring_temp_hp`, `damage_rolls`, `armor_class`, `attack_rolls`, `saving_throws`, `retaliatory_damage`, advantage/disadvantage flags, and other persistent effect types.

Use the scaffold CLI to seed:

```bash
pnpm scaffold spell "Spell Name" <level>
```

## Files Touched

| # | File | Action |
|---|------|--------|
| 1 | `domain/entities/spells/catalog/level-N.ts` (or `cantrips.ts`) | add `SPELL_NAME` `CanonicalSpell` constant + push into the file's exported catalog array |
| 2 | `domain/entities/spells/catalog/<spell-name>.test.ts` | catalog shape + level + school + components + classLists + effect array assertions |
| 3 | `application/services/combat/spell-delivery/buff-debuff-spell-delivery-handler.ts` | (only if the spell needs a NEW effect type the handler doesn't cover yet) |
| 4 | `scripts/test-harness/scenarios/spells/<spell-name>.json` | E2E scenario — must FAIL initially |

## Effect Type Decision

If the spell uses one of these existing types, NO handler change needed — just declare it in the catalog entry:

| Effect type | Used by | Notes |
|---|---|---|
| `temp_hp` | Armor of Agathys, Heroism | Applied at cast; `withTempHp` semantics (max-of-current-vs-new). |
| `recurring_temp_hp` | Heroism (start of turn) | Re-applies each turn for the duration. |
| `damage_rolls` | Bless, Bane, Hunter's Mark, Hex, Divine Favor | Bonus/penalty dice on every weapon hit. |
| `armor_class` | Shield (reaction), Mage Armor, Barkskin | Stacking rules apply per `getEffectiveArmorClass`. |
| `attack_rolls` | Bless, Bane | Bonus/penalty d4 to attack roll. |
| `saving_throws` | Bless, Bane, Resistance | Bonus/penalty die to saves. |
| `retaliatory_damage` | Armor of Agathys, Hellish Rebuke | Auto-damage on hit. |
| `advantage` / `disadvantage` | Faerie Fire, Vicious Mockery, Reckless Attack | Per-roll-type flags. |

If the spell needs something NOT on this list, add a new branch to `buff-debuff-spell-delivery-handler.ts` rather than creating a parallel handler — keep the dispatch surface narrow.

## Upcast Scaling

Two declarative knobs on `SpellEffectDeclaration`:

- `upcastScaling.additionalDice` — for dice-based scaling (e.g., +1d6 per slot above base).
- `upcastFlatBonus` — for flat-value scaling (e.g., +5 temp HP per slot above base; see Armor of Agathys upcast in commit `143f88e`).

Handler computes: `resolvedValue = baseValue + (upcastFlatBonus ?? 0) * (castAtLevel - spellLevel)`.

## Concentration

If the spell is concentration:
- Set `concentration: true` on the catalog entry.
- DO NOT re-implement concentration semantics in the handler. The `damage-resolver.ts` checks for active concentration on every damage event and routes to `domain/rules/concentration.ts` for the save and break logic. **Single source of truth.**
- Verify concentration drop end-to-end with an E2E scenario that takes the caster down to 0 HP or applies enough damage to trigger a save (see commit `a0cf3f6` for the spell-source cleanup pattern).

## Riders (`triggerAt`)

For "applies on next weapon hit" or similar deferred triggers, use `triggerAt`:

- `triggerAt: 'on_next_weapon_hit'` (smite family — Searing Smite, Branding Smite, etc.)
- `triggerAt: 'on_save_fail'` (Vicious Mockery disadvantage)

Riders are applied via `hit-rider-resolver.ts::assembleOnHitEnhancements`. Co-existence with the keyword Divine Smite path is required and tested.

## Reference Implementations

- **Armor of Agathys (Warlock L1)** — `temp_hp` + `retaliatory_damage` + `upcastFlatBonus`: commits `a59de11` and `143f88e`.
- **Heroism (Bard L1)** — `recurring_temp_hp` start-of-turn application.
- **Bless / Bane (L1)** — `attack_rolls` + `saving_throws` mass buff/debuff with mid-target failure resolution: see `buff-debuff.bane.test.ts`.
- **Smite family (Paladin L1+)** — `on_next_weapon_hit` rider co-existing with Divine Smite keyword path: commit `e6b8dd8`.

## Verification Checklist

- [ ] `pnpm -C packages/game-server test` — catalog test + handler tests pass
- [ ] `pnpm -C packages/game-server test:e2e:combat:mock -- --all` — new scenario passes (was failing before implementation)
- [ ] Spell appears in `lookup_spell <name>` MCP tool result (sanity check the catalog wiring)
- [ ] If concentration: drop scenario tested (HP-to-0 or large incoming damage)
- [ ] If upcast: at least one E2E asserts the upcast value (see Armor of Agathys upcast scenario)
