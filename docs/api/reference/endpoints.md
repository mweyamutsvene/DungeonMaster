# Endpoint Reference

This page lists client-facing endpoints grouped by domain.

## Health

- `GET /health`
  - Purpose: liveness check
  - Response: `{ "ok": true }`

## Catalog

- `GET /monsters`
  - Query: `search?`, `limit?` (1..200), `offset?` (>=0)
  - Response: `{ monsters: [...], total: number }`

## Sessions

- `POST /sessions`
  - Body: `{ storyFramework?: unknown, storySeed?: number }`
- `GET /sessions`
  - Query: `limit?`, `offset?`
- `GET /sessions/:id`
  - Implementation note: response currently includes `session`, `characters`, and `monsters` (NPCs are fetched internally but not returned in payload)
- `DELETE /sessions/:id`

## Characters And Rest

- `POST /sessions/:id/characters`
  - Body: `{ name, level, className?, sheet, background?, asiChoice?, languageChoice? }`
- `DELETE /sessions/:id/characters/:characterId`
- `POST /sessions/:id/characters/generate`
  - Body: `{ name, className, level?, sheet?, seed? }`
- `PATCH /sessions/:id/characters/:characterId`
  - Body: `{ asiChoices?, skillProficiencies?, skillExpertise?, preparedSpells?, knownSpells? }`
- `GET /sessions/:id/characters/:characterId/spells`
- `POST /sessions/:id/rest/begin`
  - Body: `{ type: "short" | "long" }`
- `POST /sessions/:id/rest`
  - Body: `{ type: "short" | "long", hitDiceSpending?, restStartedAt?, arcaneRecovery? }`

## Monsters And NPCs

- `POST /sessions/:id/monsters`
  - Body: `{ name, statBlock, monsterDefinitionId?, id? }`
- `DELETE /sessions/:id/monsters/:monsterId`
- `POST /sessions/:id/npcs`
  - Body (stat block): `{ name, statBlock, faction?, aiControlled?, id? }`
  - Body (class-backed): `{ name, className, level, sheet, faction?, aiControlled?, id? }`

## Combat Lifecycle (Session)

- `POST /sessions/:id/combat/start`
- `POST /sessions/:id/combat/next`
- `GET /sessions/:id/combat`
  - Query: `encounterId?`
- `GET /sessions/:id/combat/:encounterId/combatants`
- `POST /sessions/:id/combat/end`
  - Body: `{ encounterId?, reason: "dm_end"|"flee"|"surrender", result?: "Victory"|"Defeat"|"Draw" }`

### Combat Map/DM Overrides

- `PATCH /sessions/:id/combat/terrain`
- `PATCH /sessions/:id/combat/flanking`
- `PATCH /sessions/:id/combat/surprise`
- `PATCH /sessions/:id/combat/ground-items`
- `PATCH /sessions/:id/combat/:encounterId/combatants/:combatantId`

## Tabletop Combat (Manual Roll Flow)

- `POST /sessions/:id/combat/initiate`
  - Body: `{ text, actorId }`
- `POST /sessions/:id/combat/roll-result`
  - Body: `{ text, actorId }`
- `POST /sessions/:id/combat/action`
  - Body: `{ text, actorId, encounterId }`
- `POST /sessions/:id/combat/move/complete`
  - Body: `{ pendingActionId, roll?, rollType? }`
- `POST /sessions/:id/combat/:encounterId/pending-roll-interrupt/resolve`
  - Body: `{ actorId, choice }`

## Programmatic Actions

- `POST /sessions/:id/actions`
  - Supports `kind`: `endTurn`, `attack`, `classAbility`, `help`

## Tactical And Query

- `GET /sessions/:id/combat/:encounterId/tactical`
- `POST /sessions/:id/combat/query`
  - Body: `{ query, actorId, encounterId, seed? }`
- `POST /sessions/:id/combat/:encounterId/path-preview`
  - Body: `{ from, to, maxCostFeet?, desiredRange?, avoidHazards? }`

## LLM Utilities

- `POST /sessions/:id/llm/intent`
- `POST /sessions/:id/llm/act`
- `POST /sessions/:id/llm/narrate`

## Events

- `GET /sessions/:id/events` (SSE)
- `GET /sessions/:id/events-json`
  - Query: `limit?` (default 50)

## Inventory

- `GET /sessions/:id/characters/:charId/inventory`
- `POST /sessions/:id/characters/:charId/inventory`
- `DELETE /sessions/:id/characters/:charId/inventory/:itemName`
- `PATCH /sessions/:id/characters/:charId/inventory/:itemName`
- `POST /sessions/:id/characters/:charId/inventory/:itemName/use-charge`
- `POST /sessions/:id/characters/:charId/inventory/:itemName/use`
- `POST /sessions/:id/characters/:charId/inventory/:itemName/transfer`

## Reactions (Encounter-Scoped)

- `POST /encounters/:encounterId/reactions/:pendingActionId/respond`
- `GET /encounters/:encounterId/reactions/:pendingActionId`
- `GET /encounters/:encounterId/reactions`

## Contract Notes

- Many combat endpoints return branch-specific payloads; avoid strict single-schema assumptions.
- `actorId` (entity) and `combatantId` (encounter state) are different identifiers.
- `POST /sessions/:id/actions` can trigger asynchronous AI follow-up after the immediate response.
