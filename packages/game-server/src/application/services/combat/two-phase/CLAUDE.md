# ReactionSystem — Architectural Constraints

## Scope
`application/services/combat/two-phase/` — reaction-phase handlers for movement, attack, spell, and damage triggers. Orchestrated by `two-phase-action-service.ts` (parent facade); OA detection helper lives in `combat/helpers/oa-detection.ts`; pending action types live in `domain/entities/combat/pending-action.ts`.

## Laws
1. **One handler per trigger class** — `MoveReactionHandler` (OAs and movement-triggered readies), `AttackReactionHandler` (Shield, Deflect Attacks, Interception, Protection, Parry), `SpellReactionHandler` (Counterspell, spell-triggered readies), `DamageReactionHandler` (Hellish Rebuke, Absorb Elements). New reaction categories require a new handler, not a branch in an existing one.
2. **Handlers are TwoPhaseActionService-private** — only `two-phase-action-service.ts` (and the two-phase barrel) imports them. Tabletop dispatch and action-service handlers must not instantiate reaction handlers directly.
3. **Two-phase flow is `initiate* → complete*`** — each handler pair pauses the turn by emitting a pending action, waits for the client response, then resumes. Invalid transitions MUST be rejected.
4. **OA detection is centralized** in `helpers/oa-detection.ts` — reused by `ActionService.move` (programmatic) and `MoveReactionHandler.initiate` (two-phase). Do not re-implement OA eligibility locally.
5. **Reaction economy is per-creature, per-round** — one reaction per creature, resets at the start of *their* next turn (not round start). Handlers must consume the reaction flag before awaiting the client response.
6. **D&D 5e 2024 semantics**:
   - Shield: +5 AC retroactive to the triggering attack, lasts until start of caster's next turn.
   - Counterspell: higher-level target spells require an ability check.
   - Damage reactions fire *after* damage is applied (e.g. Hellish Rebuke uses the trigger; the damage is already on the books).
7. **Ally-targeted reactions require ally scanning** — Interception/Protection reach across allies within range. The ally scan logic belongs in the reaction handler, not leaked into action handlers.
