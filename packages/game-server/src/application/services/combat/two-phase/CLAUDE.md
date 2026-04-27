# ReactionSystem — Quick Constraints

Speak caveman. Keep short.

## Scope
`combat/two-phase/` + `two-phase-action-service.ts` + OA helper + pending-action types.

## Laws
1. One handler per trigger type: move, attack, spell, damage.
2. Handlers private to `TwoPhaseActionService`.
3. Flow is `initiate* -> complete*` only; keep transition/status validation explicit per handler and avoid bypass paths.
4. OA logic lives only in `helpers/oa-detection.ts`.
5. One reaction per creature per round; reset on own next turn start.
6. Use current code truth: Shield give retro +5 AC. Counterspell here use target CON save vs counterspeller DC. Damage reactions happen after damage land.
7. Ally-targeting reaction scans stay in reaction handlers.
8. Reaction status live in `PendingActionRepository`. Tabletop pending-action machine is different beast. Do not mix.
9. Attack and move reactions bigger now: Protection, Interception, Uncanny Dodge, Cutting Words, Sentinel, readied action, War Caster OA. Keep trigger logic in reaction flow, not random caller.

## API Docs Alignment

- Canonical client API docs live in `docs/api/` (README + reference + guides).
- When changing routes, payloads, errors, events, or client integration loops, update the matching files in `docs/api/reference/` and `docs/api/guides/` in the same change.
- For SME research, agent reviews, and implementation plans that affect client contracts, cite and update the impacted docs under `docs/api/`.
- Treat these docs as done criteria for contract changes: `docs/api/reference/endpoints.md`, `docs/api/reference/schemas.md`, `docs/api/reference/events.md`, and `docs/api/reference/errors.md`.
