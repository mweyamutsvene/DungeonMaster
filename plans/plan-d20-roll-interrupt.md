---
type: plan
flow: ReactionSystem,ActionEconomy,ClassAbilities
feature: d20-roll-interrupt-hook
author: claude-orchestrator
status: DRAFT
created: 2026-04-24
updated: 2026-04-24
---

# Plan: d20 Roll-Interrupt Architectural Hook

## Why this matters

Several 2024 features modify a d20 result *after* it's rolled but *before* hit/save resolution finalizes. Without a roll-interrupt hook, all of these are blocked:

| Feature | Mechanic |
|---|---|
| **Bardic Inspiration consumption** | Ally adds BI die to a failed attack/save/check. Currently the BI effect is created on the target but never consumed. |
| **Lucky feat** | Spend a luck point to reroll a d20 you just made; choose either result. |
| **Diviner Portent** | Replace your or another's d20 with a pre-rolled value (1/short rest x2). |
| **Cutting Words** (Bard Lore L3) | Reaction: subtract BI die from an attacker's roll/check/damage. |
| **Tactical Mind** (Fighter L2 2024) | Spend Second Wind to reroll a failed ability check. |
| **Silvery Barbs** (future spell) | Reaction: target who just succeeded must reroll, take lower. |
| **Halfling Lucky** (species trait) | Auto-reroll natural 1s. |

This is the single highest-leverage architectural gap.

## Current state

- `RollStateMachine.processRollResult()` takes the player's submitted d20 value and immediately returns hit/miss + chains to damage.
- No "between rolled and resolved" hook.
- ActiveEffect system has `until_triggered` duration but consumption is up to call sites; no centralized post-roll hook reads the BI effect bag.
- Halfling Lucky is partially handled via a separate `lucky-reroll` pending-action type (see `domain/entities/combat/pending-action.ts:117` `PendingLuckyRerollData`) — there's a precedent for a roll-interrupt PendingAction.

## Proposed design

### Phase 1 — generalize the existing Lucky pattern

The `PendingLuckyRerollData` type already encodes the shape: store enough context to (a) finalize as-is or (b) re-roll. Generalize this:

```ts
export interface PendingRollInterruptData {
  type: "roll_interrupt";
  /** Session ID for event emission. */
  sessionId: string;
  /** Encounter actor entity ID (characterId / monsterId / npcId). */
  actorEntityId: string;
  /** What kind of d20 roll was just made. */
  rollKind: "attack" | "save" | "ability_check" | "damage" | "concentration";
  /** Raw d20 value(s) the actor rolled (pre-modifier). */
  rawRoll: number[];
  /** Modifier total at the time of the roll. */
  modifier: number;
  /** Final total before any interrupt. */
  totalBeforeInterrupt: number;
  /** Available interrupt options for this actor (computed on creation). */
  options: RollInterruptOption[];
  /** Original action's pending-resume context (so we can finalize after the choice). */
  resumeContext: { /* attack pending ID, save target ID, etc. */ };
}

export type RollInterruptOption =
  | { kind: "bardic-inspiration"; effectId: string; sides: number; sourceCombatantId: string }
  | { kind: "lucky-feat"; pointsRemaining: number }
  | { kind: "halfling-lucky" }    // auto-applies on natural 1
  | { kind: "portent"; valueRolled: number; portentEffectId: string }
  | { kind: "second-wind-reroll" }     // Tactical Mind
  | { kind: "cutting-words"; effectId: string; sides: number; sourceCombatantId: string };
```

### Phase 2 — hook into the roll resolvers

Add a `RollInterruptResolver` invoked from each d20 roll path:

1. `RollStateMachine.processRollResult()` — for player attack rolls
2. `SavingThrowResolver.resolve()` — for save rolls
3. `AbilityCheckResolver` (if it exists) — for skill checks
4. `attack-resolver.ts` (programmatic) — for AI / OA path

The resolver:
- Computes `totalBeforeInterrupt`
- Scans actor's `activeEffects` + ally effects (for BI granted by ally) + party-wide effects (Cutting Words from any Bard within 60 ft)
- If any options exist, creates a `PendingRollInterruptData` and pauses
- Otherwise finalizes as today

### Phase 3 — resolution endpoints

New API endpoint: `POST /sessions/:id/combat/:enc/pending-roll-interrupt/resolve`
Body: `{ pendingId, choice: "decline" | { kind: "bardic-inspiration", ... } | ... }`

The handler:
- For `decline` → finalize with `totalBeforeInterrupt`
- For BI/Cutting Words → roll the die, add/subtract from total, consume the effect, finalize
- For Lucky → re-roll d20, take chosen value, decrement Lucky points, finalize
- For Portent → replace d20 value with pre-rolled value, consume Portent effect, finalize
- For Second-Wind-reroll → re-roll d20, spend Second Wind, finalize with new total

### Phase 4 — UI / AI integration

- Mock LLM: deterministic-ai chooses interrupt only if the new total would change a fail to a success.
- Player CLI: prompts when `PendingRollInterruptData` is the active pending action.

## Touched files

| File | Change |
|---|---|
| `domain/entities/combat/pending-action.ts` | Add `PendingRollInterruptData` to the union; add `roll_interrupt` to `PendingActionType`. |
| `application/services/combat/tabletop/rolls/roll-interrupt-resolver.ts` (NEW) | Detect & build pending action. |
| `application/services/combat/tabletop/roll-state-machine.ts` | Call interrupt resolver post d20, before hit/save. |
| `application/services/combat/tabletop/rolls/saving-throw-resolver.ts` | Same hook in save flow. |
| `application/services/combat/helpers/concentration-helper.ts` | Same hook in concentration save. |
| `domain/rules/attack-resolver.ts` | Programmatic path same hook. |
| `infrastructure/api/routes/sessions/session-tabletop.ts` | New `pending-roll-interrupt/resolve` endpoint. |
| `application/services/combat/abilities/executors/bard/bardic-inspiration-executor.ts` | Document that BI is now consumable via interrupt (no change to grant logic). |
| Class executors that need this hook (Tactical Mind, Diviner Portent, etc.) | Wire via the new flow. |

## Test strategy

- Unit: `roll-interrupt-resolver.test.ts` — 10+ cases (no options, BI declined, BI used and changes outcome, Lucky reroll lower, Portent replace, multiple options chooses one).
- E2E: `scenarios/wizard/d20-interrupt-bardic-inspiration.json` (already in scenarios-pending/) becomes the gold-standard test for BI consumption end-to-end. Move into active scenarios after implementation.

## Risks

- Performance: every d20 roll now does an effect-bag scan + ally scan. Cache effect lookup by combatant per-encounter, invalidate on effect mutation.
- Cycle: interrupt → reroll → another interrupt? Guard with a single-pass flag on the pending action; second interrupt declined automatically.
- AI complexity: deterministic AI must compute "would this change the outcome?" — needs visibility into the current target's AC/DC, which it already has via tactical context.

## Estimated scope

~2–3 days of focused work. ~8–10 files touched. ~600 LOC added (mostly in the resolver + new pending-action path).

## Unblocks (once landed)

1. Bardic Inspiration consumption — immediate
2. Lucky feat — immediate (just add to options scan)
3. Tactical Mind reroll — immediate
4. Cutting Words — immediate
5. Diviner Portent — needs a way to store pre-rolled values (separate but small)
6. Halfling Lucky — auto-add via species hydration
