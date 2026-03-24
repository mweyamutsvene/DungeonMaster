# Plan: Surprise & Initiative Modifiers — Phase 14

## Overview

Surprise in D&D 5e 2024 is **much simpler** than 2014 — there is no "surprise round" or skipped
turns. Surprised creatures just get **Disadvantage on their Initiative roll**. They still act
normally on their turn. The current codebase already implements this for monsters/NPCs but has
gaps for player characters and condition-based initiative modifiers.

## D&D 5e 2024 Rules Reference

### Surprise
> "If a combatant is surprised by combat starting, that combatant has Disadvantage on their
> Initiative roll."

- No surprise round, no skipped turns — just disadvantage on the initiative d20
- Determined by DM based on Stealth vs. Perception, ambush context, etc.

### Initiative Modifiers (from Conditions)
| Condition | Effect |
|-----------|--------|
| Invisible | **Advantage** on Initiative roll |
| Incapacitated | **Disadvantage** on Initiative roll |

### Alert Feat (2024)
- Add Proficiency Bonus to Initiative (already implemented)
- Swap Initiative with a willing ally after rolling (not yet implemented)

## Current State

| Component | Status | Location |
|-----------|--------|----------|
| `surprise?: "enemies" \| "party"` on API | ✅ Done | `session-tabletop.ts` L27 |
| `InitiatePendingAction.surprise` field | ✅ Done | `tabletop-types.ts` L49-50 |
| Monster initiative disadvantage when surprised | ✅ Done | `roll-state-machine.ts` L331-337 |
| NPC initiative disadvantage when surprised | ✅ Done | `roll-state-machine.ts` L359-365 |
| E2E scenario: `core/surprise-ambush.json` | ✅ Done | Fighter ambushes monsters with disadvantage |
| Alert feat +PB to initiative | ✅ Done | `roll-state-machine.ts` L258-266 |
| Player character initiative disadvantage | ❌ Missing | Player roll accepted as-is when `surprise === "party"` |
| Per-creature surprise model | ❌ Missing | Binary "enemies" or "party" — no individual creature flags |
| Invisible → Advantage on initiative | ❌ Missing | No condition check before initiative roll |
| Incapacitated → Disadvantage on initiative | ❌ Missing | No condition check before initiative roll |
| Alert feat swap initiative | ✅ Done | `roll-state-machine.ts` handleInitiativeSwap + INITIATIVE_SWAP pending action |

## Implementation Plan

### Phase 14.1 — Player Character Surprise Disadvantage (Small)

When `surprise === "party"`, the player character should also roll with disadvantage. Since the
player submits their own d20 roll, we have two options:

**Option A (Server-enforced):** Require the client to submit TWO d20 values when surprised, and
the server takes the lower. This is consistent with how monsters are handled.

**Option B (Roll request hint):** The server's `RollRequest` response includes a `disadvantage: true`
flag so the player-cli knows to prompt for 2d20-take-lowest. Server trusts the client's final value.

| # | Task | Details |
|---|------|---------|
| 1 | Add `disadvantage?: boolean` to `RollRequest` | Signal to the client that the roll has disadvantage |
| 2 | Enforce disadvantage server-side (Option A) | Accept `rolls: [d20a, d20b]` and take min; or accept single pre-computed value |
| 3 | Player-CLI: display "You are surprised!" + roll 2d20 | Update combat REPL to handle disadvantage hint |
| 4 | E2E scenario | `core/surprise-party.json` — monsters ambush party, PC rolls with disadvantage |

### Phase 14.2 — Condition-Based Initiative Modifiers (Small)

Check combatant conditions before initiative rolls and apply advantage/disadvantage.

| # | Task | Details |
|---|------|---------|
| 5 | Check Invisible condition at initiative time | For server-rolled combatants (monsters/NPCs): roll 2d20 take highest |
| 6 | Check Incapacitated condition at initiative time | For server-rolled combatants: roll 2d20 take lowest |
| 7 | Signal advantage/disadvantage to player | Include condition-based adv/disadv in `RollRequest` |
| 8 | Stack with surprise | If both surprised AND Invisible, they cancel out (normal roll) |
| 9 | E2E scenario | `core/invisible-initiative-advantage.json` — Invisible creature gets advantage on initiative |

### Phase 14.3 — Per-Creature Surprise (Medium)

Change the surprise model from side-based to per-creature for more accurate D&D simulation.

| # | Task | Details |
|---|------|---------|
| 10 | Extend `surprise` to accept creature IDs | `surprise?: "enemies" \| "party" \| { surprised: string[] }` — backward compatible |
| 11 | Per-creature initiative disadvantage | Only apply disadvantage to specifically surprised creatures |
| 12 | E2E scenario | `core/partial-surprise.json` — some enemies surprised, others alert |

### Phase 14.4 — Alert Feat: Initiative Swap (Done)

D&D 5e 2024 Alert feat allows swapping initiative with a willing ally.

| # | Task | Details |
|---|------|---------|
| 13 | Post-initiative swap prompt | ✅ Implemented — `INITIATIVE_SWAP` pending action + swap offer in `CombatStartedResult` |
| 14 | API flow for swap acceptance | ✅ Implemented — reuses `POST .../combat/roll-result` with "swap with X" or "no swap" text |
| 15 | E2E scenarios | ✅ `core/alert-initiative-swap.json` + `core/alert-decline-swap.json` |

## Dependencies

- Phase 14.1 requires no new dependencies — just server-side logic change
- Phase 14.2 requires conditions to be set before combat starts (pre-combat buff system)
- Phase 14.3 is backward compatible — existing `"enemies" | "party"` values still work
- Phase 14.4 ~~depends on Phase 9 (multi-PC scenarios)~~ — multi-PC support exists, implemented

## Complexity

- Phase 14.1: Small (server-side check + CLI hint)
- Phase 14.2: Small (condition lookup before roll)
- Phase 14.3: Medium (schema change + per-creature logic)
- Phase 14.4: Done (reuses existing roll-result flow for swap decision)

## Priority

**Low-Medium** — The core surprise mechanic (monsters get initiative disadvantage) already works.
The gaps mainly affect edge cases (party being ambushed, invisible creatures). Phase 14.1 is the
highest value since it's the most common gap (party ambush scenarios).

---

## Implementation Notes (Completed)

### Summary

All four phases (14.1–14.4) implemented and verified. All 458 unit tests + 123 E2E scenarios pass.

### What was done

**Phase 14.1 — Player Character Surprise Disadvantage**
- `tabletop-combat-service.ts`: Added `computeInitiativeModifiers()` helper that checks surprise + conditions → returns `{ advantage, disadvantage }` flags with D&D 5e cancellation (adv+disadv = normal). Updated `initiateAction()` to include `advantage`/`disadvantage` on the `RollRequest` returned to the client, with modified `message` ("Roll with disadvantage/advantage!") and `diceNeeded` ("2d20" when applicable).
- Option B chosen: Server signals disadvantage in `RollRequest`; client is trusted to submit the correct roll. No server-side enforcement of two d20 values.
- E2E: `core/surprise-party.json` — party ambushed, PC gets `disadvantage: true` on initiative.

**Phase 14.2 — Condition-Based Initiative Modifiers**
- `roll-state-machine.ts`: Added `computeInitiativeRollMode()` helper that takes creatureId, surprise, side, and conditions → returns `"normal" | "advantage" | "disadvantage"`. Checks both surprise and Invisible/Incapacitated conditions on the creature's statBlock/sheet, applies D&D 5e cancellation.
- Added `rollInitiativeD20()` helper that rolls 2d20-take-best/worst based on mode.
- Refactored all three server-rolled initiative paths (multi-PC auto-roll, monster auto-roll, NPC auto-roll) to use `computeInitiativeRollMode()` + `rollInitiativeD20()`.
- E2E: `core/invisible-initiative.json` — PC with `conditions: ["Invisible"]` gets `advantage: true`.

**Phase 14.3 — Per-Creature Surprise**
- `tabletop-types.ts`: Extended `SurpriseSpec = "enemies" | "party" | { surprised: string[] }`. Updated `InitiatePendingAction.surprise` to use `SurpriseSpec`. Backward compatible.
- `session-tabletop.ts`: Extended API body validation to accept the new object form.
- Both `tabletop-combat-service.ts` and `roll-state-machine.ts` have `isCreatureSurprised()` helpers that check the per-creature `{ surprised: [...] }` form.
- `scenario-runner.ts`: Extended `InitiateAction` types to support `{ surprised: string[] }`. Added monster/NPC/character name → ID resolution in the initiate handler so scenario JSON can use creature names. Added `advantage`/`disadvantage` expect assertions.
- E2E: `core/partial-surprise.json` — only "Sleeping Bandit" is surprised (name resolved to ID at runtime).

**Phase 14.4 — Alert Feat Initiative Swap**
- `tabletop-types.ts`: Added `INITIATIVE_SWAP` to `PendingActionType`, new `InitiativeSwapPendingAction` interface (stores alertHolderId, encounterId, sessionId, eligible targets), added to `TabletopPendingAction` union. Added `requiresPlayerInput?` and `initiativeSwapOffer?` fields to `CombatStartedResult`.
- `roll-state-machine.ts`: After all combatants are persisted in `handleInitiativeRoll`, checks if the primary PC has Alert feat (`initiativeSwapEnabled`). If yes and eligible allies exist (other PCs/NPCs), stores `INITIATIVE_SWAP` pending action and returns `CombatStartedResult` with `requiresPlayerInput: true` + `initiativeSwapOffer`. AI orchestrator start is deferred until after swap decision.
- New `handleInitiativeSwap` method: parses player text ("swap with <name>" or "no swap"/"decline"), swaps initiative values in DB via `updateCombatantState`, re-reads turn order (auto-sorted by descending initiative), clears pending action, starts AI orchestrator if monster goes first.
- `processRollResult` dispatch: Added `INITIATIVE_SWAP` case that routes to `handleInitiativeSwap` before `parseRollValue` (since it's a choice, not a dice roll).
- `scenario-runner.ts`: Added `initiativeSwapOffer?: boolean` to `RollResultAction.expect`, with assertion validation.
- E2E: `core/alert-initiative-swap.json` — Scout (Alert feat) + Tank, Scout swaps initiative with Tank. `core/alert-decline-swap.json` — Ranger (Alert feat) + Cleric, Ranger declines swap.

### Files modified
- `packages/game-server/src/application/services/combat/tabletop/tabletop-types.ts` — SurpriseSpec type, InitiativeSwapPendingAction, CombatStartedResult extended
- `packages/game-server/src/application/services/combat/tabletop/tabletop-combat-service.ts` — computeInitiativeModifiers, isCreatureSurprised, SurpriseSpec re-export
- `packages/game-server/src/application/services/combat/tabletop/roll-state-machine.ts` — computeInitiativeRollMode, rollInitiativeD20, isCreatureSurprised, refactored initiative paths, Alert swap detection + handleInitiativeSwap
- `packages/game-server/src/infrastructure/api/routes/sessions/session-tabletop.ts` — API body validation
- `packages/game-server/scripts/test-harness/scenario-runner.ts` — type extensions, name→ID resolution, assertions, initiativeSwapOffer validation

### Files created
- `packages/game-server/scripts/test-harness/scenarios/core/surprise-party.json`
- `packages/game-server/scripts/test-harness/scenarios/core/invisible-initiative.json`
- `packages/game-server/scripts/test-harness/scenarios/core/partial-surprise.json`
- `packages/game-server/scripts/test-harness/scenarios/core/alert-initiative-swap.json`
- `packages/game-server/scripts/test-harness/scenarios/core/alert-decline-swap.json`

### Assumptions
- Option B (signal-only) for player surprise: the server trusts the client's submitted d20 value. If server-side enforcement is desired later, the multi-d20 approach can be added.
- `isCreatureSurprised` is duplicated in both `tabletop-combat-service.ts` and `roll-state-machine.ts` — both are small (4-line) functions. Could be extracted to a shared util if more callers arise.
- Conditions are read from `sheet.conditions` (for PCs) and `statBlock.conditions` (for monsters/NPCs) at initiative time. Pre-combat conditions must be set on the character sheet or stat block before combat starts.
- Alert feat initiative swap only applies to the PRIMARY PC (the one who manually rolls initiative). Auto-rolled secondary PCs with Alert do not get a swap offer. This could be extended later if needed.
- Only party allies (other PCs + NPCs) are eligible swap targets — enemies are excluded per D&D 5e 2024 rules ("willing ally").
- A creature can only be involved in one swap (currently enforced implicitly by only offering one swap to the primary PC).

---

### Post-Implementation Refactoring

**Surprise mechanic was refactored to be server-managed** — see [plan-surprise-refactor-server-managed.prompt.md](plan-surprise-refactor-server-managed.prompt.md).

Key changes:
- Surprise is no longer passed in the `POST /combat/initiate` request body
- New `PATCH /sessions/:id/combat/surprise` endpoint for DM overrides
- Surprise is persisted on the encounter record (`surprise Json?` in Prisma)
- Server auto-computes surprise from Hidden conditions + Stealth vs Passive Perception if not explicitly set
- All 4 surprise scenarios updated + new `auto-surprise-hidden.json` scenario added
- E2E count: 124 scenarios (was 123)
