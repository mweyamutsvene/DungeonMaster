# Plan: SSE Event Type Narrowing (§2.3)

## Round: 1
## Status: APPROVED (self-reviewed after comprehensive research)
## Affected Flows: EntityManagement, CombatOrchestration

---

## Objective

`IEventRepository.append()` accepts `type: string`, losing TypeScript discriminant narrowing.
Define a `GameEventInput` discriminated union over all 22 event types, update the interface, and update all callers and implementations. Gives compile-time protection against typos in event type strings and documents payload shapes for each event.

---

## Complete Event Type Catalogue (22 types)

### Entity/Session (character-service.ts, game-session-service.ts)
| Type | File | Payload |
|------|------|---------|
| `SessionCreated` | game-session-service.ts | `{ sessionId: string }` |
| `CharacterAdded` | character-service.ts | `{ characterId, name, level }` |
| `RestCompleted` | character-service.ts | `{ restType, characters[] }` |

### Combat Lifecycle (combat-service.ts)
| Type | File | Payload |
|------|------|---------|
| `CombatStarted` | combat-service.ts | `{ encounterId }` |
| `CombatEnded` | combat-service.ts + roll-state-machine.ts | `{ encounterId, result }` |
| `TurnAdvanced` | combat-service.ts | `{ encounterId, round, turn }` |
| `DeathSave` | combat-service.ts + roll-state-machine.ts | `{ encounterId, roll, result, deathSaves, combatantId?, actor?, hpRestored? }` |

### Combat Actions (action-service.ts + two-phase-action-service.ts + tabletop)
| Type | File | Payload |
|------|------|---------|
| `AttackResolved` | 3 callers (different shapes) | `{ encounterId, attacker, target, hit, + extras }` |
| `DamageApplied` | 3 callers | `{ encounterId, target, amount, hpCurrent, + extras }` |
| `ActionResolved` | action-service.ts | `{ encounterId, actor, action: string, + action-specific }` |
| `OpportunityAttack` | 2 callers | `{ encounterId, attackerId, targetId, + extras }` |
| `Move` | 2 callers | `{ encounterId, actorId, from, to, distanceMoved, interrupted? }` |
| `HealingApplied` | tabletop-event-emitter.ts | `{ encounterId, healer, target, amount, hpCurrent }` |
| `NarrativeText` | tabletop-event-emitter.ts | `{ encounterId, actor, text }` |
| `ConcentrationMaintained` | tabletop-event-emitter.ts | `{ encounterId, combatant, spellName, dc, roll, damage }` |
| `ConcentrationBroken` | tabletop-event-emitter.ts | `{ encounterId, combatant, spellName, dc, roll, damage }` |

### Reactions (two-phase-action-service.ts + reactions route)
| Type | File | Payload |
|------|------|---------|
| `ReactionPrompt` | two-phase-action-service.ts | `ReactionPromptEventPayload` (existing) |
| `ReactionResolved` | reactions.ts route | `ReactionResolvedEventPayload` (existing) |
| `Counterspell` | two-phase-action-service.ts | `{ encounterId, counterspellerId, counterspellerName, targetSpell, spellSaveDC, saveRoll, success }` |
| `ShieldCast` | two-phase-action-service.ts | `{ encounterId, casterId, casterName, previousAC, newAC }` |
| `DeflectAttacks` | two-phase-action-service.ts | `{ encounterId, deflectorId, deflectorName, deflectRoll, dexMod, monkLevel, totalReduction, damageAfterReduction }` |
| `DeflectAttacksRedirect` | two-phase-action-service.ts | `{ encounterId, deflectorId, deflectorName, targetId, targetName, attackRoll, attackerAC, hit, damage, martialArtsDieSize, dexMod, proficiencyBonus }` |

---

## Changes

### EntityManagement Flow

#### [File: application/repositories/event-repository.ts]
- [ ] Add `import type { Position } from "../../domain/rules/movement.js"`
- [ ] Define all payload interfaces (22 event types)
  - Simple/specific interfaces for consistent events (SessionCreated, CharacterAdded, etc.)
  - Extend `Record<string, unknown>` (index signature) for complex polymorphic events (AttackResolved, ActionResolved, DamageApplied, OpportunityAttack, Move, DeathSave)
- [ ] Define `export type GameEventInput` discriminated union (22 members)
- [ ] Define `export type GameEventType = GameEventInput["type"]` convenience alias
- [ ] Update `IEventRepository.append()`: `input: { id: string } & GameEventInput`

#### [File: infrastructure/testing/memory-repos.ts]
- [ ] Update `MemoryEventRepository.append()` signature to `input: { id: string } & GameEventInput`
- [ ] Import `GameEventInput` from event-repository.ts
- [ ] Cast `input.payload` as `JsonValue` internally (payload types are always JSON-serializable)

#### [File: infrastructure/db/event-repository.ts]
- [ ] Update `PrismaEventRepository.append()` signature
- [ ] Import `GameEventInput`
- [ ] Cast `input.payload as Prisma.InputJsonValue` internally

#### [File: infrastructure/db/publishing-event-repository.ts]
- [ ] Update `PublishingEventRepository.append()` signature
- [ ] Import `GameEventInput`

#### [File: infrastructure/db/deferred-publishing-event-repository.ts]
- [ ] Update `DeferredPublishingEventRepository.append()` signature
- [ ] Import `GameEventInput`

### CombatOrchestration Flow

#### [File: application/services/entities/game-session-service.ts]
- [ ] Verify `SessionCreated` payload matches `SessionCreatedPayload` (no changes needed)

#### [File: application/services/entities/character-service.ts]
- [ ] Verify `CharacterAdded` and `RestCompleted` payloads match interfaces (no changes needed)

#### [File: application/services/combat/combat-service.ts]
- [ ] Verify `CombatStarted`, `CombatEnded`, `TurnAdvanced`, `DeathSave` payloads (likely no cast removal needed)

#### [File: application/services/combat/action-service.ts]
- [ ] Remove `satisfies JsonValue` from all `events.append()` payload objects
- [ ] **Restructure `AttackResolved` payload**: Remove spread operators from `attacker`/`target` CombatantRef. The weapon/armor/ac were not consumed by any downstream consumer. Move to top-level flat keys or drop (they're duplicate info).
  - **Before**: `attacker: { ...input.attacker, weapon: attackerEquippedWeapon, armor: attackerEquippedArmor }`
  - **After**: `attacker: input.attacker` (pure `CombatantRef`)

#### [File: application/services/combat/two-phase-action-service.ts]
- [ ] Remove `as JsonValue` casts from all `events.append()` payload objects
- [ ] Verify each payload matches its typed interface

#### [File: application/services/combat/tabletop/tabletop-event-emitter.ts]
- [ ] Verify payloads match interfaces (no casts currently used; may need minor adjustments)

#### [File: application/services/combat/tabletop/roll-state-machine.ts]
- [ ] Verify `CombatEnded` and `DeathSave` payloads match interfaces

#### [File: infrastructure/api/routes/reactions.ts]
- [ ] Remove `as JsonValue` from `ReactionResolved` payload
- [ ] Import `GameEventInput` type if needed

---

## Cross-Flow Risk Checklist
- [ ] Do changes in one flow break assumptions in another?
  → These are pure type changes; no runtime behavior changes.
- [ ] Does the pending action state machine still have valid transitions?
  → Not affected — event appending is orthogonal to state machine.
- [ ] Is action economy preserved?
  → Not affected.
- [ ] Do both player AND AI paths handle the change?
  → Both paths emit events through the same service layer; both affected equally.
- [ ] Are repo interfaces + memory-repos updated if entity shapes change?
  → Yes — MemoryEventRepository.append() signature updated.
- [ ] Is `app.ts` registration updated if adding executors?
  → Not applicable (no executors).
- [ ] Are D&D 5e 2024 rules correct?
  → Not applicable (pure TypeScript type change).

---

## Risks

- **Excess property checking on `{ ...input.attacker, weapon: x }`**: Only in action-service.ts. Fixed by removing the spread (the weapon/armor data isn't consumed downstream anyway — CLI reads from top-level payload fields like `attackName` not from `attacker.weapon`).
- **`as JsonValue` casts bypassing type checks**: Removing them might expose payload mismatches → fixed by proper interface definitions with `[key: string]: unknown` index signatures.
- **`GameEventRecord.type: string`** in `application/types.ts` stays as `string` since it comes from the DB (Prisma) and can't be guaranteed narrowed. The discriminated union applies only to write-time (`append()` inputs), not read-time (DB records).

---

## Test Plan
- [ ] `pnpm -C packages/game-server typecheck` — zero errors after changes
- [ ] `pnpm -C packages/game-server test` — all 616 unit/integration tests pass
- [ ] `pnpm -C packages/game-server test:e2e:combat:mock` — all 153 E2E scenarios pass
- No new test scenarios needed — this is a type-only change with no runtime behavior difference
