---
type: plan
flow: ReactionSystem,ActionEconomy,ClassAbilities
feature: d20-roll-interrupt-hook
author: claude-orchestrator
status: COMPLETE
created: 2026-04-24
updated: 2026-04-25
---

# Plan: d20 Roll-Interrupt Architectural Hook

**Problem**: No hook between "d20 rolled" and "hit/save resolved." Blocks: Bardic Inspiration consumption, Lucky feat, Diviner Portent, Cutting Words, Tactical Mind, Silvery Barbs, Halfling Lucky. Highest-leverage architectural gap.

## What Was Built

### Types (`domain/entities/combat/pending-action.ts`)
`RollInterruptOption` union (bardic-inspiration, lucky-feat, halfling-lucky, portent, cutting-words) + `PendingRollInterruptData` + resume context types (`AttackRollResumeContext`, `SaveRollResumeContext`).

### Resolver (`tabletop/rolls/roll-interrupt-resolver.ts`)
`RollInterruptResolver` class — scans actor `activeEffects`, luckPoints, feat list, and species for available options. Provides `findAttackInterruptOptions`, `findSaveInterruptOptions`, `buildAttackInterruptData`, `buildSaveInterruptData`.

### Attack path hook (`tabletop/roll-state-machine.ts` → `handleAttackRoll`)
After d20 roll, before hit/miss: checks options, stores `PendingRollInterruptData`, returns `requiresPlayerInput: true`. Re-entry with `interruptResolved: true` skips the check and applies `interruptBonusAdjustment` / `interruptForcedRoll`.

### Save path hook (`tabletop/roll-state-machine.ts` → `handleSavingThrowAction`)
Player character saves only. Pre-rolls d20, checks options, stores interrupt. Re-entry passes `forcedRoll` + `bonusAdjustment` to `SavingThrowResolver.resolve()`. Concentration saves (CON) covered automatically since they route through the same SAVING_THROW path.

### Resolution endpoint (`infrastructure/api/routes/sessions/session-tabletop.ts`)
`POST /sessions/:id/combat/:encounterId/pending-roll-interrupt/resolve`
Handles both attack and save resume contexts. Choices: `decline`, `bardic-inspiration`, `lucky-feat`, `halfling-lucky`, `portent`.

## Files Changed

| File | Change |
|---|---|
| `domain/entities/combat/pending-action.ts` | `PendingRollInterruptData`, `RollInterruptOption`, resume contexts |
| `tabletop/rolls/roll-interrupt-resolver.ts` (NEW) | Option detection + payload builders |
| `tabletop/tabletop-types.ts` | `AttackPendingAction` + `SavingThrowPendingAction` interrupt fields; `AttackResult.rollInterrupt` |
| `tabletop/roll-state-machine.ts` | Attack + save interrupt hooks |
| `tabletop/rolls/saving-throw-resolver.ts` | `opts?: { forcedRoll?, bonusAdjustment? }` parameter |
| `infrastructure/api/routes/sessions/session-tabletop.ts` | Resolve endpoint (attack + save paths) |

## Tests
- Unit: `roll-interrupt-resolver.test.ts` — 15 cases (all options, edge cases, multiple options, save delegation)

## Scope Notes
- `domain/combat/attack-resolver.ts` (AI auto-attacks): not hooked — AI attacks auto-resolve without player input; Lucky/BI not applicable for non-player turns
- `helpers/concentration-helper.ts`: no separate hook needed — concentration checks are SAVING_THROW actions and covered by the save path hook
- Cutting Words (enemy attack interrupts from ally Bard): architecture is in place; actual detection requires scanning ally combatants — deferred until Bard class abilities land

## Unblocks
Bardic Inspiration, Lucky feat, Halfling Lucky, Portent — all functional once Bard/Diviner/Halfling abilities are wired in.
