# Task Spec: Ready Action Phase 6.1a — Non-Spell Ready

## Objective
Implement the Ready action for non-spell responses per D&D 5e 2024 rules. A creature uses its action to prepare a response (attack, dash, move, disengage) that triggers as a Reaction when a specified event occurs.

## Rules Reference
1. **Costs an Action** — uses the creature's standard action for the turn
2. **Trigger specification** — perceivable circumstance described by the creature
3. **Response types** — attack, dash, move, or disengage (taken as Reaction when triggered)
4. **Reaction consumption** — readied response consumes the creature's Reaction for the round
5. **Optional** — creature can choose to take or ignore the Reaction when trigger fires
6. **Duration** — persists until start of creature's next turn
7. **Spell readying** — NOT in scope for this task (Phase 6.1b)

## Scope

### Files to Create
1. Domain type: `ReadiedAction` interface in `packages/game-server/src/domain/entities/combat/`
2. E2E: `packages/game-server/scripts/test-harness/scenarios/core/ready-action-attack.json`
3. E2E: `packages/game-server/scripts/test-harness/scenarios/core/ready-action-move.json`
4. E2E: `packages/game-server/scripts/test-harness/scenarios/core/ready-action-expire.json`

### Files to Modify
5. `packages/game-server/src/application/services/combat/tabletop/combat-text-parser.ts` — Add `"ready"` parsing
6. `packages/game-server/src/application/services/combat/tabletop/action-dispatcher.ts` — Add `handleReadyAction()`
7. Combatant resources type — Add `readiedAction?: ReadiedAction` field
8. `packages/game-server/src/application/services/combat/tabletop/tabletop-types.ts` — Type updates if needed
9. Turn advancement logic — Trigger detection + readied action clearing
10. Reaction routes — Wire `"readied_action"` into existing reaction framework

### Files to Read (Context Required)
- Existing reaction framework: `packages/game-server/src/infrastructure/api/routes/reactions.ts`
- Turn advancement: combat service next-turn logic
- Condition/resource tracking patterns in combatant state

## Tasks

| # | Step | Details |
|---|------|---------|
| 1 | Domain Types | `ReadiedAction` interface: actionType, triggerDescription, triggerType, targetRef?, weaponName? |
| 2 | Text Parser | Add `"ready"` to `tryParseSimpleActionText` in combat-text-parser.ts |
| 3 | Action Handler | Create `handleReadyAction()` in action-dispatcher.ts — spend main action, store readiedAction |
| 4 | Trigger Detection | Check readied actions during movement/attack handlers; match structured trigger types |
| 5 | Reaction Execution | Add `"readied_action"` to ReactionType; wire into reactions.ts with player choice |
| 6 | Expiry | Clear readiedAction at start of creature's next turn |
| 7 | E2E Scenarios | Attack trigger, movement trigger, expiry (trigger never fires) |

## Verification
- `pnpm -C packages/game-server typecheck` passes
- `pnpm -C packages/game-server test` passes
- `pnpm -C packages/game-server test:e2e:combat:mock` passes (including new scenarios)
- Existing reaction scenarios still pass (no regression)
