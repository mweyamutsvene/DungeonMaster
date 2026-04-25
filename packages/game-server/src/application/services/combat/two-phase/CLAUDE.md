# ReactionSystem — Quick Constraints

Speak caveman. Keep short.

## Scope
`combat/two-phase/` + `two-phase-action-service.ts` + OA helper + pending-action types.

## Laws
1. One handler per trigger type: move, attack, spell, damage.
2. Handlers private to `TwoPhaseActionService`.
3. Flow is `initiate* -> complete*` only; invalid transitions rejected.
4. OA logic lives only in `helpers/oa-detection.ts`.
5. One reaction per creature per round; reset on own next turn start.
6. Use current code truth: Shield give retro +5 AC. Counterspell here use target CON save vs counterspeller DC. Damage reactions happen after damage land.
7. Ally-targeting reaction scans stay in reaction handlers.
8. Reaction status live in `PendingActionRepository`. Tabletop pending-action machine is different beast. Do not mix.
9. Attack and move reactions bigger now: Protection, Interception, Uncanny Dodge, Cutting Words, Sentinel, readied action, War Caster OA. Keep trigger logic in reaction flow, not random caller.
