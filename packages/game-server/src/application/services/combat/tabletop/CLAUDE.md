# CombatOrchestration — Quick Constraints

Speak caveman. Keep short.

## Scope
`combat/tabletop/*`, `tabletop-combat-service.ts`, `combat-service.ts`

## Laws
1. `TabletopCombatService` stays thin. Public methods are high ripple.
2. `CombatTextParser` pure only. No deps, no side effects.
3. Pending state machine strict. Valid jumps only. Not just `initiate -> pending -> resolved`; swap and chained attack/save states exist too.
4. Tabletop own text parse + roll flow. If move needs reaction handling, tabletop hand off to `twoPhaseActions`; reaction rules live elsewhere.
5. `abilityRegistry` required in deps.
6. New action type needs parser + dispatcher route.
7. Dispatch handlers private to `ActionDispatcher`.
8. Roll resolvers private to `RollStateMachine` (`SavingThrowResolver` shared).
9. Spell-delivery handlers live in `tabletop/spell-delivery/`. `SpellActionHandler` owns route order and picks first handler that matches.

Spell cast can pause before delivery for Counterspell. Spend/action timing must stay consistent across pause and resolve paths.
