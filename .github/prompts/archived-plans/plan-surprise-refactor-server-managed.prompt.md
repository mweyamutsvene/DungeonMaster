# Plan: Refactor Surprise Mechanic — Server-Managed State

## Problem

Surprise is currently passed as a client parameter in `POST /sessions/:id/combat/initiate`:
```json
{ "text": "I attack", "actorId": "...", "surprise": "enemies" }
```

This violates the "backend is source of truth" principle. The client can arbitrarily declare who's
surprised. Surprise state is only transient (stored in the pending action, then discarded).

## Goal

1. **Server owns surprise state** — persisted on `CombatEncounter` (like `mapData`)
2. **Server auto-determines surprise** from creature Hidden conditions + Stealth vs Passive Perception
3. **DM can override** via a dedicated PATCH endpoint
4. **Client no longer passes surprise** in the initiate request body

## D&D 5e 2024 Rules

> "If a combatant is surprised by combat starting, that combatant has Disadvantage on their
> Initiative roll. For example, if an ambusher starts combat while **hidden** from a foe…"

Surprise determination:
- Creature A is Hidden (has Hidden condition + `stealthRoll` in resources)
- Creature B's Passive Perception < A's stealth roll → B is surprised
- Passive Perception = 10 + Wisdom(Perception) modifier

## Existing Infrastructure

| Component | Status | Notes |
|-----------|--------|-------|
| Hidden condition tracking | ✅ | `conditions[]` + `resources.stealthRoll` on combatant |
| `passivePerception` on monster stat blocks | ✅ | Stored as number in JSON |
| Character `skills.perception` | ✅ | Via `sheet.skills` or `extractSkills()` |
| `mapData` pattern on encounter | ✅ | Exact pattern to follow for `surprise` |
| `detectHidden(stealth, passivePerception)` | ✅ | `domain/rules/hide.ts` |
| `SurpriseSpec` type | ✅ | `"enemies" \| "party" \| { surprised: string[] }` |
| `isCreatureSurprised()` helpers | ✅ | In tabletop-combat-service + roll-state-machine |

## Implementation Phases

### Phase 1 — Schema & Repository (Foundation)

| # | Task | Details |
|---|------|---------|
| 1 | Add `surprise Json?` to `CombatEncounter` | Prisma schema change |
| 2 | Run migration | `prisma migrate dev` |
| 3 | Add `surprise` to `CombatEncounterRecord` type | `application/types.ts` |
| 4 | Update repository interface | Add `surprise` to `updateEncounter` patch + `createEncounter` input |
| 5 | Update Prisma repository | `infrastructure/db/combat-repository.ts` |
| 6 | Update in-memory repository | `infrastructure/testing/memory-repos.ts` |

### Phase 2 — DM Override Endpoint

| # | Task | Details |
|---|------|---------|
| 7 | Create `PATCH /sessions/:id/combat/surprise` | In `session-combat.ts`, follows terrain pattern |
| 8 | Find or create encounter | Creates encounter with default map if none exists |
| 9 | Validate and store surprise | Accept `SurpriseSpec`, store on encounter |

### Phase 3 — Domain: Surprise Auto-Computation

| # | Task | Details |
|---|------|---------|
| 10 | Create `getPassivePerception(creature)` helper | In `domain/rules/` or `domain/combat/` |
| 11 | Create `computeSurprise(partyMembers, enemies)` | Returns `SurpriseSpec \| undefined` |
| 12 | Logic: Hidden creatures → compare stealth vs passive perception | Per D&D 5e 2024 rules |

### Phase 4 — Refactor `initiateAction`

| # | Task | Details |
|---|------|---------|
| 13 | Remove `surprise` parameter from `initiateAction()` | Service layer signature change |
| 14 | Read surprise from encounter record | After finding/creating encounter |
| 15 | Auto-compute surprise if not set on encounter | Call `computeSurprise()` with loaded creatures |
| 16 | Store computed surprise on encounter | Via `updateEncounter()` |
| 17 | Remove `surprise` from API request body | `session-tabletop.ts` route |

### Phase 5 — E2E Scenarios & Scenario Runner

| # | Task | Details |
|---|------|---------|
| 18 | Add `setSurprise` action type to scenario runner | Calls `PATCH /sessions/:id/combat/surprise` |
| 19 | Update `surprise-ambush.json` | Use `setSurprise` action before initiate |
| 20 | Update `surprise-party.json` | Use `setSurprise` action before initiate |
| 21 | Update `partial-surprise.json` | Use `setSurprise` action before initiate |
| 22 | Update Alert feat scenarios if affected | Check `alert-initiative-swap.json` + `alert-decline-swap.json` |
| 23 | Create auto-surprise scenario | Hidden creature → server auto-computes surprise |

### Phase 6 — Documentation & Cleanup

| # | Task | Details |
|---|------|---------|
| 24 | Update `SESSION_API_REFERENCE.md` | Document new PATCH surprise endpoint, remove surprise from initiate |
| 25 | Update `plan-surprise-mechanics.prompt.md` | Reference this refactoring |
| 26 | Remove duplicate `isCreatureSurprised` | Extract to shared util if practical |

## API Changes

### New: `PATCH /sessions/:id/combat/surprise`
```json
// Request
{ "surprise": "enemies" | "party" | { "surprised": ["creature-id-1", "creature-id-2"] } }

// Response
{ "success": true, "encounterId": "...", "surprise": ... }
```

### Modified: `POST /sessions/:id/combat/initiate`
```json
// Before
{ "text": "...", "actorId": "...", "surprise": "enemies" }

// After — surprise removed from body
{ "text": "...", "actorId": "..." }
```

## Flow After Refactoring

```
DM Override:            setSurprise → initiate → rollResult → combat
Auto-Compute:                        initiate → rollResult → combat
                                     (server checks Hidden conditions)
```

## Notes
- `surprise` field on encounter persists for the combat's lifetime (queryable)
- Backward compatible: if encounter has no surprise, all creatures roll normally
- Auto-computation only triggers if no explicit surprise is set
- The pending action still carries surprise (read from encounter during creation)

---

## Completion Summary (Phase 1–6 DONE)

**All phases completed successfully.**

### What was done:
- **Phase 1**: Added `surprise Json?` to CombatEncounter Prisma model. Migration `20260308212054_add_encounter_surprise` applied. Updated `CombatEncounterRecord`, repository interface, Prisma repo, and in-memory repo.
- **Phase 2**: Added `PATCH /sessions/:id/combat/surprise` endpoint in `session-combat.ts`. Creates encounter with default map if none exists. Validates surprise format.
- **Phase 3**: Added `SurpriseCreatureInfo` interface, `getPassivePerception()`, and `computeSurprise()` in `domain/rules/hide.ts`. Exported via barrel.
- **Phase 4**: Removed `surprise` from `initiateAction()` signature and from the route body in `session-tabletop.ts`. Added surprise resolution logic: reads from encounter, auto-computes from Hidden conditions if not set, stores result on encounter.
- **Phase 5**: Added `SetSurpriseAction` to scenario runner. Updated 3 existing surprise scenarios to use `setSurprise` before `initiate`. Created `auto-surprise-hidden.json` testing auto-computation from Hidden condition.
- **Phase 6**: Updated `SESSION_API_REFERENCE.md` and `copilot-instructions.md`.

### Test results:
- TypeScript compilation: Clean
- Unit tests: 458 passed
- E2E scenarios: 124 passed, 0 failed (including 4 surprise scenarios)

### Assumptions:
- `getPassivePerception()` uses `statBlock.passivePerception` for monsters, `10 + skills.perception` for characters, or `10 + floor((wisdom - 10) / 2)` as fallback.
- Auto-computation marks a creature as surprised only if ALL enemies are Hidden with stealth > its passive perception.
- The `PATCH /combat/surprise` endpoint creates a Pending encounter with a default map if none exists.
