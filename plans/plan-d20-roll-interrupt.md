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

**Precedent**: `PendingLuckyRerollData` at `pending-action.ts:117` — generalize it.

## Design

### Phase 1 — generalize Lucky pattern

```ts
interface PendingRollInterruptData {
  type: "roll_interrupt";
  sessionId: string;
  actorEntityId: string;
  rollKind: "attack" | "save" | "ability_check" | "damage" | "concentration";
  rawRoll: number[];
  modifier: number;
  totalBeforeInterrupt: number;
  options: RollInterruptOption[];
  resumeContext: { /* attack pending ID, save target ID, etc. */ };
}

type RollInterruptOption =
  | { kind: "bardic-inspiration"; effectId: string; sides: number; sourceCombatantId: string }
  | { kind: "lucky-feat"; pointsRemaining: number }
  | { kind: "halfling-lucky" }
  | { kind: "portent"; valueRolled: number; portentEffectId: string }
  | { kind: "second-wind-reroll" }
  | { kind: "cutting-words"; effectId: string; sides: number; sourceCombatantId: string };
```

### Phase 2 — hook into roll paths

New `RollInterruptResolver`: invoked after d20 roll, before resolution.
- Computes `totalBeforeInterrupt`
- Scans actor `activeEffects` + ally effects (BI) + party effects (Cutting Words)
- Options exist → create `PendingRollInterruptData`, pause
- No options → finalize as today

Hook points: `RollStateMachine.processRollResult()`, `SavingThrowResolver.resolve()`, `AbilityCheckResolver`, `attack-resolver.ts`.

### Phase 3 — resolution endpoint

`POST /sessions/:id/combat/:enc/pending-roll-interrupt/resolve`
Body: `{ pendingId, choice: "decline" | { kind: "bardic-inspiration", ... } | ... }`

- `decline` → finalize with `totalBeforeInterrupt`
- BI/Cutting Words → roll die, add/subtract, consume effect, finalize
- Lucky → reroll d20, decrement points, finalize
- Portent → replace d20 with pre-rolled value, consume effect, finalize
- Second-wind-reroll → reroll d20, spend Second Wind, finalize

### Phase 4 — AI/UI

Mock LLM: choose interrupt only if new total changes fail→success.
Player CLI: prompt on `PendingRollInterruptData` pending.

## Files

| File | Change |
|---|---|
| `domain/entities/combat/pending-action.ts` | Add `PendingRollInterruptData` + `roll_interrupt` type |
| `tabletop/rolls/roll-interrupt-resolver.ts` (NEW) | Detect + build pending action |
| `tabletop/roll-state-machine.ts` | Hook after d20, before hit/save |
| `tabletop/rolls/saving-throw-resolver.ts` | Same hook |
| `helpers/concentration-helper.ts` | Same hook |
| `domain/rules/attack-resolver.ts` | Same hook (AI/OA path) |
| `infrastructure/api/routes/sessions/session-tabletop.ts` | New resolve endpoint |

## Tests
- Unit: `roll-interrupt-resolver.test.ts` — 10+ cases (no options, BI declined, BI used changes outcome, Lucky lower, Portent replace, multiple options)
- E2E: `scenarios/wizard/d20-interrupt-bardic-inspiration.json` (in scenarios-pending/) → move to active

## Risks
- Every d20 → effect-bag scan + ally scan → cache per combatant per encounter, invalidate on mutation
- Interrupt → reroll → another interrupt → guard with single-pass flag; second interrupt auto-declined
- AI must know AC/DC to evaluate "would this change outcome?" — already in tactical context

## Scope
~2–3 days. 8–10 files. ~600 LOC.

## Unblocks
Bardic Inspiration, Lucky feat, Tactical Mind, Cutting Words, Diviner Portent, Halfling Lucky — all immediate once landed.
