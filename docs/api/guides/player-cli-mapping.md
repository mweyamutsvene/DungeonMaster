# Guide: Player CLI Endpoint Mapping

This maps `packages/player-cli/src/game-client.ts` methods to server endpoints.

## Core

- `healthCheck` -> `GET /health`
- `createSession` -> `POST /sessions`
- `addCharacter` -> `POST /sessions/:id/characters`
- `generateCharacter` -> `POST /sessions/:id/characters/generate`
- `addMonster` -> `POST /sessions/:id/monsters`
- `addNpc` -> `POST /sessions/:id/npcs`
- `listMonsterCatalog` -> `GET /monsters`

## Tabletop Combat

- `initiateCombat` -> `POST /sessions/:id/combat/initiate`
- `submitRoll` -> `POST /sessions/:id/combat/roll-result`
- `submitAction` -> `POST /sessions/:id/combat/action`
- `completeMove` -> `POST /sessions/:id/combat/move/complete`
- `endTurn` -> `POST /sessions/:id/actions` (`kind: endTurn`)

## State/Utility

- `rest` -> `POST /sessions/:id/rest`
- `getInventory` -> `GET /sessions/:id/characters/:charId/inventory`
- `getCombatState` -> `GET /sessions/:id/combat`
- `getTacticalView` -> `GET /sessions/:id/combat/:encounterId/tactical`
- `getEvents` -> `GET /sessions/:id/events-json`

## Reactions

- `getReactions` -> `GET /encounters/:encounterId/reactions`
- `respondToReaction` -> `POST /encounters/:encounterId/reactions/:pendingActionId/respond`

## LLM Paths Used By CLI

- `parseIntent` -> `POST /sessions/:id/llm/intent`
- `queryTactical` -> `POST /sessions/:id/combat/query`

## Operational Notes

- CLI also uses SSE via `EventStream` on `GET /sessions/:id/events` (raw fetch stream).
- CLI behavior is an implementation reference for robust reaction + roll loops.
- Current CLI type for health check expects `{ status: string }`, while server returns `{ ok: true }`.
