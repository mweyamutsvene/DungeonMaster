# Guide: Robust Client Turn Loop

This is the recommended client loop for tabletop play.

## 1. Start/Resume Encounter

1. Call `POST /sessions/:id/combat/initiate` with player intent.
2. If response has `requiresPlayerInput=true`, collect roll input and call `POST /sessions/:id/combat/roll-result`.
3. Repeat until initiative is resolved and encounter becomes active.

## 2. Submit Action

1. Call `POST /sessions/:id/combat/action` with `{ text, actorId, encounterId }`.
2. Inspect response:
   - If `type="REACTION_CHECK"`: resolve reactions first.
   - If `requiresPlayerInput=true`: continue roll loop via `POST /sessions/:id/combat/roll-result`.
   - If action complete: proceed to next user decision.

## 3. Resolve Reaction Checks

1. Fetch pending reactions: `GET /encounters/:encounterId/reactions`.
2. For each opportunity that belongs to the active player, respond with `POST /encounters/:encounterId/reactions/:pendingActionId/respond`.
3. If response indicates more player input is needed (for example OA rolls), continue via `POST /sessions/:id/combat/move/complete` until complete.
4. Re-fetch tactical/combat state after reaction completion.

## 4. Handle Roll Interrupts

If encounter pending action is a roll interrupt, call:

- `POST /sessions/:id/combat/:encounterId/pending-roll-interrupt/resolve`

Then continue normal roll processing.

## 5. End Turn

1. Call `POST /sessions/:id/actions` with `kind: "endTurn"`.
2. Do not assume turn is fully advanced immediately; monitor events and tactical state.

## 6. Recommended Sync Strategy

- Keep SSE connected (`GET /sessions/:id/events`).
- On major events (`TurnAdvanced`, reaction completion), re-fetch tactical view.
- Tolerate branch-specific response payloads and unknown optional fields.

## 7. Failure Recovery

- On `400`: show actionable validation message.
- On `404`: refresh state and verify IDs are still valid.
- On reaction expiration/stale pending action: refresh reactions list and combat state before retrying.
