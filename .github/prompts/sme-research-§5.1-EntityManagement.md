# SME Research: §5.1 Rest Interruption — EntityManagement Flow

## Files Examined
- `domain/rules/rest.ts` — rest rules: `refreshClassResourcePools`, `spendHitDice`, `recoverHitDice`
- `application/services/entities/character-service.ts` — `takeSessionRest()`, `beginRest()` (to add)
- `application/repositories/event-repository.ts` — `GameEventInput` union, `IEventRepository`
- `application/repositories/game-session-repository.ts` — `IGameSessionRepository` (no `update` method)
- `infrastructure/api/routes/sessions/session-characters.ts` — `POST /sessions/:id/rest` endpoint
- `infrastructure/testing/memory-repos.ts` — `MemoryEventRepository` (has `listBySession` with `since`)
- `infrastructure/db/event-repository.ts` — `PrismaEventRepository` (has `listBySession` with `since`)
- `application/types.ts` — `GameSessionRecord` shape

## Current Rest System State

`POST /sessions/:id/rest` → `CharacterService.takeSessionRest(sessionId, restType, hitDiceSpending)`:
- Instantly applies resource pool refreshes
- Long rest: restores HP to max, recovers half hit dice
- Short rest: spends hit dice if `hitDiceSpending` provided
- Emits `RestCompleted` event
- **No interruption check — stateless, always applies benefits**

## Key Finding: No Prisma Schema Change Needed

The `IEventRepository` already provides:
```typescript
listBySession(sessionId, { since?: Date }): Promise<GameEventRecord[]>
```
This means we can use the **event log as the rest state machine**:
1. `POST /rest/begin` → emits `RestStarted` event (records when rest started)
2. Combat starts → `CombatStarted` event is emitted
3. `POST /rest` with `restStartedAt` → queries events since then, checks for `CombatStarted`/`DamageApplied`

Both `MemoryEventRepository` and `PrismaEventRepository` already implement the `since` filter correctly.

## D&D 5e 2024 Interruption Rules
- **Short Rest** (1 hour): interrupted by combat or strenuous activity → `CombatStarted`
- **Long Rest** (8 hours): interrupted by combat, taking damage, or casting a spell → `CombatStarted` + `DamageApplied`
- Spell casting during long rest would require tracking resource expenditure events (out of scope)

## Interruption Impact
- If interrupted: rest benefits NOT applied (no HP restore, no resource refresh, no hit dice recovery)
- Characters keep current resource/HP state

## Files to Modify

| File | Change |
|------|--------|
| `domain/rules/rest.ts` | Add `RestInterruptionReason`, `RestInterruptionResult`, `detectRestInterruption()` |
| `application/repositories/event-repository.ts` | Add `RestStartedPayload`, `RestStarted` to `GameEventInput` union |
| `application/services/entities/character-service.ts` | Add `beginRest()`, update `takeSessionRest()` |
| `infrastructure/api/routes/sessions/session-characters.ts` | Add `/rest/begin`, update `/rest` |
| `domain/rules/rest.test.ts` | Add failing tests for `detectRestInterruption()` |

## Risks
- **Backward compatibility**: `takeSessionRest()` without `restStartedAt` continues working unchanged
- **Clock skew**: `since: restStartedAt` needs slight margin — could miss events in same millisecond. Use the exact Date returned from `beginRest()`
- **No `update` on `IGameSessionRepository`**: We're NOT adding rest state to session record — using event log instead. No schema change needed.
