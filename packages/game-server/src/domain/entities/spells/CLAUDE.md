# SpellSystem — Architectural Constraints

## Scope
`domain/entities/spells/` (catalog, types, progression) + `application/services/combat/tabletop/spell-action-handler.ts` (orchestration) + `application/services/combat/spell-delivery/*` (per-effect handlers) + `domain/rules/concentration.ts` (concentration invariant).

## Laws
1. **Spells declare, handlers apply.** Catalog entries (`catalog/level-N.ts`, `catalog/cantrips.ts`) emit `SpellEffectDeclaration` shapes from `prepared-spell-definition.ts`. They never compute damage, mutate state, or import from `application/`.
2. **Slot expenditure is the handler's job, not the spell's.** `SpellActionHandler` debits the slot via `spell-slot-manager.ts` after validation. Catalog entries must NOT model slot cost in their effect arrays.
3. **Concentration is single-source.** All concentration tracking, drop, and break-on-damage logic lives in `domain/rules/concentration.ts` and is consumed by `damage-resolver.ts`. Effect handlers never re-implement concentration semantics.
4. **Damage and saves flow through the shared combat pipeline.** Spells that deal damage route through `damage-resolver.ts`; spells with saves route through `save-resolver.ts`. No per-spell damage math in delivery handlers.
5. **Effect-type-keyed delivery.** `BuffDebuffSpellDeliveryHandler`, `HealingSpellDeliveryHandler`, `SpellAttackDeliveryHandler`, `SpellSaveDeliveryHandler` each own one `SpellEffectDeclaration.type`. New effect types require a new handler — do not stuff branches into existing ones.
6. **Upcast scaling is declarative.** `upcastScaling.additionalDice` for dice-based scaling; `upcastFlatBonus` for flat-value scaling (temp HP, retaliation). Handlers apply the formula; catalog entries declare the per-level increment.
7. **Riders use `triggerAt`.** `on_next_weapon_hit` (smite family), `on_save_fail`, etc. are declared via `ActiveEffect.triggerAt` + `SpellEffectDeclaration.triggerAt`. Consumed by `hit-rider-resolver.ts`. Co-existence with the keyword Divine Smite path is required.
8. **Catalog tests are mandatory.** New spells need a unit test in `catalog/catalog.test.ts` (or a spell-specific `*.test.ts` like `armor-of-agathys.test.ts`) covering the effect shape and any upcast.
