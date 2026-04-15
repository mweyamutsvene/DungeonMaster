# Plan: Damage Reaction + Extra Attack Chain Conflict

## Problem
When a level 5+ character deals damage to a target that has a damage reaction (e.g., Hellish Rebuke), the damage reaction does NOT fire because the Extra Attack chain creates a pending ATTACK action that blocks the `pendingAfterRoll` guard in `tryInitiateDamageReaction()`.

## D&D 5e Rules
Per D&D 5e 2024, Hellish Rebuke is a reaction triggered "when you take damage". It should fire immediately after damage is dealt, even if the attacker has more attacks remaining from Extra Attack. The correct sequence:
1. Attacker deals damage (attack 1 of 2)
2. Target uses reaction: Hellish Rebuke
3. Attacker continues with Extra Attack (attack 2 of 2)

## Current Behavior
1. Attacker deals damage
2. Damage-resolver chains to Extra Attack (creates ATTACK pending action)
3. Route handler checks for damage reaction but finds pending action → skips
4. Damage reaction never fires

## Root Cause
Single pending action slot — `combatRepo.setPendingAction()` overwrites any existing pending action. The damage-resolver's EA chain and the damage reaction both need the slot.

## Proposed Fix
Option A: **Pending action queue** — Allow multiple pending actions in a priority queue. Damage reactions have higher priority than EA chains. Process reactions first, then resume the EA chain.

Option B: **Two-phase interleave** — Before the damage-resolver creates the EA chain pending action, check for damage reactions. If one is detected, create the damage reaction pending action FIRST. When the reaction resolves, THEN create the EA chain pending action.

Option C: **Route-level orchestration** — In the roll-result route handler, after the damage-resolver returns the EA chain response, intercept and create the damage reaction. Store the EA chain info in a separate field so it can be resumed after the reaction resolves.

## Files Affected
- `packages/game-server/src/infrastructure/api/routes/sessions/session-tabletop.ts` (tryInitiateDamageReaction guard)
- `packages/game-server/src/application/services/combat/tabletop/rolls/damage-resolver.ts` (EA chain creation)
- `packages/game-server/src/application/repositories/combat-repository.ts` (pending action queue?)
- `packages/game-server/src/infrastructure/api/app.test.ts` (test uses level 4 workaround)

## Workaround
Test currently uses level 4 attacker (no Extra Attack) to avoid the conflict.
