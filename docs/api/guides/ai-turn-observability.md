# Guide: AI Turn Observability

AI turns are server-driven and can span multiple events and actions.

## Key Principle

A successful `endTurn` response does not mean AI processing is finished.

## Trigger Paths

AI can be triggered by:

- `POST /sessions/:id/actions` with `kind: "endTurn"`
- Internal combat progression during tabletop flow (`nextTurn`, reaction resume, death-save auto-flow)

## Observe AI Progress

Use both:

- `GET /sessions/:id/events` (primary real-time stream)
- `GET /sessions/:id/combat/:encounterId/tactical` (authoritative state sync)

## Typical Event Sequence

1. `AiDecision`
2. Optional `NarrativeText`
3. One or more resolution events (`Move`, `AttackResolved`, `DamageApplied`, `ActionResolved`)
4. Optional reaction events (`ReactionPrompt`, `ReactionResolved`)
5. `TurnAdvanced`

## Reaction-Gated AI

- AI may pause on pending reactions.
- Client must resolve pending reactions through reaction endpoints before AI chain fully resumes.
- After response, server may immediately continue AI flow and emit additional events.

## Client Synchronization Pattern

1. Keep SSE connected.
2. On `TurnAdvanced`, re-fetch tactical state.
3. If waiting on reactions, poll or fetch `GET /encounters/:encounterId/reactions`.
4. Treat unknown extra fields in AI/event payloads as forward-compatible.

## Practical Pitfalls

- Do not assume exactly one AI action per turn.
- Do not assume `TurnAdvanced` payload includes all actor context.
- Handle SSE reconnect with backlog deduplication.
