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
8. Roll resolvers private to `RollStateMachine` (`SavingThrowResolver` shared). `RollInterruptResolver` instantiated in `RollStateMachine` constructor — scans actor effects/feats/species for BI/Lucky/Portent/Halfling Lucky options after d20 roll, before hit/save resolution.
9. Spell-delivery handlers live in `tabletop/spell-delivery/`. `SpellActionHandler` owns route order and picks first handler that matches.

Spell cast can pause before delivery for Counterspell. Spend/action timing must stay consistent across pause and resolve paths.

d20 roll-interrupt: after rolling, if options exist → store `PendingRollInterruptData` on encounter pendingAction slot, return `requiresPlayerInput: true`. Resume via `POST .../pending-roll-interrupt/resolve` with `interruptResolved: true` on the reconstructed pending action. Both attack and save paths implemented.

## API Docs Alignment

- Canonical client API docs live in `docs/api/` (README + reference + guides).
- When changing routes, payloads, errors, events, or client integration loops, update the matching files in `docs/api/reference/` and `docs/api/guides/` in the same change.
- For SME research, agent reviews, and implementation plans that affect client contracts, cite and update the impacted docs under `docs/api/`.
- Treat these docs as done criteria for contract changes: `docs/api/reference/endpoints.md`, `docs/api/reference/schemas.md`, `docs/api/reference/events.md`, and `docs/api/reference/errors.md`.
