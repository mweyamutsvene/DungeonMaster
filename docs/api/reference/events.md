# Events And Streaming

## Endpoints

- `GET /sessions/:id/events` (SSE)
- `GET /sessions/:id/events-json?limit=N` (JSON polling/testing)

## SSE Behavior

On connect:

1. Server sends SSE headers and `: connected` comment.
2. Server replays backlog events (default `limit=50`).
3. Server subscribes client to live events.
4. Server sends heartbeat comments every 15 seconds (`: ping`).

## SSE Frame Format

For each event:

```text
event: <EventType>
data: {"type":"<EventType>","payload":{...},"createdAt":"..."}
```

## Frequently Observed Event Types

- Session/entity lifecycle: `SessionCreated`, `CharacterAdded`, `MonsterAdded`, `NPCAdded`
- Combat lifecycle: `TurnAdvanced`, `CombatEnded`, `ActionResolved`
- Combat resolution: `AttackResolved`, `DamageApplied`, `HealingApplied`, `Move`
- Reaction lifecycle: `ReactionPrompt`, `ReactionResolved`, `Counterspell`
- Concentration: `ConcentrationMaintained`, `ConcentrationBroken`
- AI visibility: `AiDecision`, `NarrativeText`, `LegendaryAction`, `LairAction`

## Client Guidance

- SSE is the primary real-time channel. Use events-json as fallback/debug.
- On reconnect, deduplicate events because backlog replay can overlap with previously seen events.
- Treat event payload fields as extensible. Handle unknown fields safely.
- After key state transitions (for example `TurnAdvanced`), re-fetch tactical/combat snapshot for authoritative current state.
