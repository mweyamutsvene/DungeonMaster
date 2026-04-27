# Shared Schemas And IDs

## ID Glossary

- `sessionId`: game session identifier (`/sessions/:id`)
- `encounterId`: combat encounter identifier
- `characterId`: character entity identifier
- `monsterId`: monster entity identifier
- `npcId`: NPC entity identifier
- `combatantId`: encounter combatant state identifier (not the same as entity ID)
- `pendingActionId`: reaction pending action identifier from repository-backed reaction flow
- `opportunityId`: individual reaction opportunity identifier under a pending action

## Core Polymorphic Combat Response

Many combat endpoints return a branch-shaped object. Interpret fields conditionally.

Common fields:

- `type?: string`
- `message?: string`
- `narration?: string`
- `requiresPlayerInput?: boolean`
- `actionComplete?: boolean`
- `rollType?: string`
- `diceNeeded?: string`
- `pendingActionId?: string`

### Common `rollType` values

- `initiative`
- `attack`
- `damage`
- `deathSave`
- `savingThrow`
- `opportunity_attack`
- `opportunity_attack_damage`

## Reaction Pending Action Snapshot

Returned by:

- `GET /encounters/:encounterId/reactions`
- `GET /encounters/:encounterId/reactions/:pendingActionId`

Typical shape:

```json
{
  "id": "...",
  "encounterId": "...",
  "type": "move|attack|spell_cast|damage_reaction|lucky_reroll|ability_check",
  "status": "awaiting_reactions|ready_to_complete|completed|expired|cancelled",
  "reactionOpportunities": [
    {
      "id": "...",
      "combatantId": "...",
      "reactionType": "opportunity_attack|counterspell|shield|..."
    }
  ],
  "resolvedReactions": [],
  "expiresAt": "2026-..."
}
```

## Reaction Response Payload

`POST /encounters/:encounterId/reactions/:pendingActionId/respond` returns status-driven payloads.

Common fields:

- `success: boolean`
- `pendingActionId: string`
- `status: string`
- `message?: string`

Optional branch payloads:

- `attackResult`
- `spellCastResult`
- `damageReactionResult`
- `moveResult`

## Session Snapshot Shapes

`GET /sessions/:id` currently returns:

```json
{
  "session": { "id": "..." },
  "characters": [],
  "monsters": []
}
```

Implementation note: route fetches NPCs internally but does not include `npcs` in the returned object.

## Health Endpoint Shape

`GET /health` returns:

```json
{ "ok": true }
```
