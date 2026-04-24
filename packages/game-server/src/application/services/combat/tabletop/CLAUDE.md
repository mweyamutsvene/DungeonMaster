# CombatOrchestration — Architectural Constraints

## Scope
`combat/tabletop/*`, `tabletop-combat-service.ts`, `combat-service.ts`

## Laws
1. **Facade stays thin** — `TabletopCombatService` delegates to sub-modules. Its 4 public method signatures (`initiateAction`, `processRollResult`, `parseCombatAction`, `completeMove`) ripple across all route handlers when changed.
2. **CombatTextParser functions are pure** — no `this.deps`, no side effects. They receive text and return parsed action objects or null.
3. **Pending action state machine** — `initiate → (attack_pending | damage_pending | save_pending | death_save_pending) → resolved`. Invalid state transitions MUST be rejected.
4. **Two-phase action flow** — move phase → action phase → bonus phase → end turn. Action economy is tracked per phase.
5. **`abilityRegistry` is required** in `TabletopCombatServiceDeps` — no optional guards, no null checks.
6. **New action types require both** — a parser function in `combat-text-parser.ts` AND a dispatch route in `action-dispatcher.ts`.
7. **Dispatch handlers are ActionDispatcher-private** — `MovementHandlers`, `AttackHandlers`, `ClassAbilityHandlers`, `GrappleHandlers`, `SocialHandlers`, `InteractionHandlers` live in `dispatch/` and are only constructed and called by `ActionDispatcher`. They MUST NOT be imported from outside `tabletop/`.
8. **Roll resolvers live in `rolls/`** — `InitiativeHandler`, `HitRiderResolver`, `WeaponMasteryResolver`, and `DamageResolver` are RollStateMachine-private. `SavingThrowResolver` also lives in `rolls/` but is shared (imported by `SpellActionHandler`, `spell-delivery/`, `ClassAbilityHandlers`, and the barrel).
9. **Spell-delivery handlers are SpellActionHandler-private** — `BuffDebuffSpellDeliveryHandler`, `HealingSpellDeliveryHandler`, `SpellAttackDeliveryHandler`, `SaveSpellDeliveryHandler`, `ZoneSpellDeliveryHandler` live in `spell-delivery/` and are only wired through `spell-action-handler.ts`. Each owns exactly one `SpellEffectDeclaration.type`.
