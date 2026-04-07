# Plan: Lucky Feat — Interactive Player Expenditure

## Background

The Lucky feat grants 3 luck points per long rest. Each point can be spent to reroll
any d20 (attack roll, ability check, or saving throw) made by the character, or to
force an attacker targeting the character to reroll their attack roll.

The structural domain foundation is implemented in:
- `domain/rules/lucky.ts` — `canUseLucky`, `useLuckyPoint`, `resetLuckyPoints`, `LUCKY_POINTS_MAX`
- `domain/rules/feat-modifiers.ts` — `luckyEnabled: boolean`, `luckPoints?: number`
- `domain/combat/attack-resolver.ts` — auto-use on attack rolls (structural only, no player choice)
- `domain/rules/rest.ts` — `restoreFeatLuckPoints()` to reset points on long rest

The current implementation **auto-spends** a luck point whenever an attack roll would miss
(blind greedy policy). The goal of this plan is to make expenditure **player-interactive**.

---

## Goals

1. **Prompt before spending**: When a roll would miss (or any d20 result is low), pause
   the tabletop flow and ask the player whether they want to spend a luck point.
2. **Track current points**: Lucky points must be tracked as a real-time resource pool
   in the combatant's resources, not inferred from `FeatModifiers.luckPoints`.
3. **Support all roll types**: Lucky can also be spent on ability checks and saving throws,
   not just attack rolls.
4. **Opponent reroll**: The Lucky feat also allows imposing a reroll on an attacker
   targeting you — this is a reactive use case (pending action / reaction flow).

---

## Implementation Steps

### Step 1 — Lucky resource pool
- Add a `luckPoints` resource pool to the combatant's `ResourcePool[]` in
  `CombatResourceBuilder` when `classHasFeature(...)` or `featModifiers.luckyEnabled`.
- Initialize with `max: LUCKY_POINTS_MAX`, `current: LUCKY_POINTS_MAX`.
- Restore on long rest via `refreshClassResourcePools` or `restoreFeatLuckPoints`.

### Step 2 — Tabletop pending action for Lucky
- When a d20 roll produces a result the player *might* want to reroll, add a new
  pending action type: `"lucky_reroll_prompt"` with fields:
  - `rollType: "attack" | "abilityCheck" | "savingThrow"`
  - `originalRoll: number`
  - `originalTotal: number`
  - `wouldHit: boolean` (for attacks)
  - `wouldSucceed: boolean` (for checks/saves)
- The tabletop route suspends the roll result until the player responds.

### Step 3 — Player response API
- `POST /encounters/:encounterId/reactions/:pendingActionId/respond`
  with `{ spend: true | false }`.
- If `spend: true`: decrement `luckPoints` pool, apply the reroll.
- If `spend: false`: proceed with the original result.

### Step 4 — Remove auto-use from attack-resolver.ts
- Remove the auto-use greedy policy added in RULES-L1.
- The domain layer should only expose `canUseLucky(points)` as a gate check;
  the decision is made in the application/tabletop layer.

### Step 5 — Opponent attack reroll (reactive Lucky)
- When the character is targeted by an attack, create a `"lucky_impose_reroll"`
  pending action if the character has Lucky + luckPoints > 0.
- Works similarly to the Shield spell reaction flow via `TwoPhaseActionService`.

---

## Affected Files (future)
- `domain/rules/lucky.ts` — no changes needed (primitives are already correct)
- `domain/entities/classes/combat-resource-builder.ts` — add luckPoints pool
- `application/services/combat/tabletop/roll-state-machine.ts` — insert Lucky prompt
- `application/services/combat/two-phase/` — opponent reroll reaction handler
- `infrastructure/api/routes/sessions/session-tabletop.ts` — suspend/resume flow
- `domain/rules/feat-modifiers.ts` — remove auto-use from `luckPoints` field note

---

## Out of Scope for This Ticket
- Warlock's Eldritch Mind / other luck-adjacent features
- Halfling Lucky subrace (separately tracked)
