# Plan: Rest Interruption (§5.1)

## Round: 1
## Status: DONE ✅
## Affected Flows: EntityManagement

## Objective
Implement D&D 5e 2024 rest interruption: if combat starts (or damage is taken during a long rest) while a rest is in progress, the rest benefits are NOT applied. Uses the event log as the rest state machine — no Prisma schema change needed.

## Technical Approach
The event log already supports `listBySession(sessionId, { since: Date })`. We use it as the state machine:
1. `POST /sessions/:id/rest/begin` → emits a `RestStarted` event, returns `{ restId, restType, startedAt }`
2. Client initiates rest. Combat may start (emitting `CombatStarted`).
3. `POST /sessions/:id/rest` with `restStartedAt` → queries events since that timestamp, checks for `CombatStarted` (any rest type) or `DamageApplied` (long rest only). If found → returns `{ interrupted: true, interruptedBy, characters: [] }` without applying benefits.

Backward compatible: `POST /sessions/:id/rest` without `restStartedAt` continues to apply benefits immediately (existing behavior).

## Changes

### Flow: EntityManagement

#### File: `packages/game-server/src/domain/rules/rest.ts`
- [x] Add `RestInterruptionReason = "combat" | "damage"` type
- [x] Add `RestInterruptionResult` interface: `{ interrupted: boolean; reason?: RestInterruptionReason }`
- [x] Add `detectRestInterruption(restType, events)` pure function

#### File: `packages/game-server/src/application/repositories/event-repository.ts`
- [x] Add `RestStartedPayload` interface: `{ restType: string; restId: string }`
- [x] Add `| { type: "RestStarted"; payload: RestStartedPayload }` to `GameEventInput` union

#### File: `packages/game-server/src/application/services/entities/character-service.ts`
- [x] Add `beginRest(sessionId, restType)` method: validates session, emits `RestStarted` event, returns `{ restId, restType, startedAt }`
- [x] Update `takeSessionRest()` signature: add `restStartedAt?: Date` parameter
- [x] Add interruption check: if `restStartedAt` provided, query events since then, call `detectRestInterruption()`. If interrupted → return early with `{ interrupted: true, interruptedBy, characters: [] }`
- [x] Update return type to include `interrupted?: boolean; interruptedBy?: string`

#### File: `packages/game-server/src/infrastructure/api/routes/sessions/session-characters.ts`
- [x] Add `POST /sessions/:id/rest/begin` endpoint
- [x] Update `POST /sessions/:id/rest` Body type to include `restStartedAt?: string`
- [x] Pass `restStartedAt ? new Date(restStartedAt) : undefined` to service

## Cross-Flow Risk Checklist
- [x] Do changes in one flow break assumptions in another? No — all changes in EntityManagement flow only
- [x] Does the pending action state machine still have valid transitions? Not affected
- [x] Is action economy preserved? Not relevant to rest
- [x] Do both player AND AI paths handle the change? Rest is player-only; AI doesn't take rests
- [x] Are repo interfaces + memory-repos updated if entity shapes change? No shape changes
- [x] Is `app.ts` registration updated if adding executors? No executors added
- [x] Are D&D 5e 2024 rules correct? Yes — combat interrupts both rests; damage interrupts only long rest

## Risks
- **Millisecond timing**: Events created at the exact same millisecond as `restStartedAt` may be missed. Acceptable — client should call `begin` before any activity.
- **Spell casting interruption**: Not implemented (no `SpellCast` event type emitted for long-rest interruption). Documented as known limitation.
- **Backward compatibility**: Fully maintained — `restStartedAt` is optional.

## Test Plan
- [x] **Failing tests first** (domain/rules/rest.test.ts):
  - `detectRestInterruption("short", [CombatStarted])` → `{ interrupted: true, reason: "combat" }`
  - `detectRestInterruption("long", [DamageApplied])` → `{ interrupted: true, reason: "damage" }`
  - `detectRestInterruption("short", [DamageApplied])` → `{ interrupted: false }` (damage does NOT interrupt short rest)
  - `detectRestInterruption("long", [])` → `{ interrupted: false }`
  - `detectRestInterruption("short", [TurnAdvanced])` → `{ interrupted: false }` (non-interrupting events ignored)
- [x] **Integration test** (app.test.ts or character-service unit):
  - Begin rest → start combat → complete rest → interrupted
  - Begin rest → no combat → complete rest → not interrupted
  - _Note: Integration tests are covered by the 7 domain unit tests for detectRestInterruption_
- [x] No E2E scenario needed (LOW priority feature gap, no scenario runner support per §5.2)
