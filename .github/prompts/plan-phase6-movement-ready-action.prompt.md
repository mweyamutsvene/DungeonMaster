# Plan: Phase 6 — Movement & Ready Action Improvements
## Round: 1
## Status: DRAFT
## Affected Flows: CombatRules, CombatOrchestration

## Objective
Implement 4 movement and positioning gaps: forced movement primitive (for spells like Thunderwave and weapon mastery Push), grapple drag cost (double movement), and the 3 Ready action deficiencies (expiry, spell readying, multiple trigger types). These affect tactical depth and rules correctness.

## Changes

### CombatRules — Forced Movement

#### [File: domain/rules/movement.ts or domain/combat/forced-movement.ts — NEW]
- [ ] Create `applyForcedMovement(target, direction, distanceFeet, map)` function
- [ ] Forced movement does NOT provoke opportunity attacks (D&D 2024 rule)
- [ ] Forced movement stops if it would move through walls/obstacles
- [ ] Forced movement stops at map edges
- [ ] Integrate with existing weapon mastery Push property (currently defined but may not use this primitive)
- [ ] Integrate with Thunderwave spell (pushes 10ft on failed save)
- [ ] Integrate with Open Hand Technique push option
- [ ] Integrate with Shove (push 5ft — currently may already work)

### CombatRules — Grapple Drag

#### [File: domain/rules/movement.ts]
- [ ] When a grappling creature moves, the grappled creature moves with them
- [ ] Movement costs DOUBLE (half speed) when dragging a grappled creature
- [ ] D&D 2024: "When you move, you can drag or carry the Grappled creature with you, but your Speed is halved, unless the creature is Tiny or two or more Sizes smaller than you"
- [ ] Add `isGrappling(creature, combat)` helper and `getGrappleDragCost(grappler, grappled)` speed modifier

### CombatOrchestration — Ready Action Expiry

#### [File: application/services/combat/combat-service.ts]
- [ ] In the turn-start processing (when a combatant's turn begins), check if that combatant has a `readiedAction` in their resources
- [ ] If so, clear it — readied actions expire at the start of the readier's next turn if not triggered
- [ ] D&D 2024: "If the trigger doesn't occur before the start of your next turn, you lose the action"

### CombatOrchestration — Ready Action: Spell Response

#### [File: application/services/combat/tabletop/dispatch/social-handlers.ts]
- [ ] Support `responseType: 'cast_spell'` in addition to `'attack'`
- [ ] When readying a spell: the caster immediately spends the spell slot and begins concentrating on the spell (held spell)
- [ ] If concentration is broken before the trigger, the spell is wasted
- [ ] On trigger: release the held spell as a reaction

#### [File: application/services/combat/two-phase/move-reaction-handler.ts]
- [ ] When detecting readied action triggers, support spell response execution — fire the held spell at the trigger creature

### CombatOrchestration — Ready Action: More Triggers

#### [File: application/services/combat/tabletop/dispatch/social-handlers.ts]
- [ ] Expand `tryParseReadyText()` to recognize more trigger types:
  - `creature_enters_range` — enemy comes within a specified range (current `creature_moves_within_range`)
  - `creature_casts_spell` — enemy begins casting a spell
  - `creature_attacks_ally` — enemy attacks a specific ally
- [ ] Store trigger details in `readiedAction` resource

#### [File: application/services/combat/two-phase/ or combat-service.ts]
- [ ] Check for `creature_casts_spell` triggers during spell casting phase
- [ ] Check for `creature_attacks_ally` triggers during attack resolution

## Cross-Flow Risk Checklist
- [ ] Do changes in one flow break assumptions in another? — Forced movement must not trigger OA (verify OA check path)
- [x] Does the pending action state machine still have valid transitions? — Ready → trigger → reaction is existing flow
- [x] Is action economy preserved? — Readied spell still costs spell slot and action; reaction to release
- [ ] Do both player AND AI paths handle the change? — AI doesn't currently Ready actions, so AI path is unaffected initially
- [ ] Are repo interfaces + memory-repos updated if entity shapes change? — readiedAction already stored in resources
- [x] Is `app.ts` registration updated if adding executors? — No new executors
- [x] Are D&D 5e 2024 rules correct? — Verified: forced movement, grapple drag, ready action all from 2024 PHB

## Risks
- **Forced movement grid resolution**: Need to determine what happens when forced into difficult terrain, another creature's space, or a wall. Keep simple: stop at obstacle.
- **Grapple drag** needs to update both creatures' positions atomically in the movement resolution.
- **Held spell concentration** is subtle: if the readier takes damage and fails concentration, the spell is lost but the action is already spent. This is a complex interaction.

## Test Plan
- [ ] Unit test: forced movement 10ft in direction, stops at wall
- [ ] Unit test: forced movement does NOT trigger opportunity attacks
- [ ] Unit test: grapple drag costs double movement
- [ ] Unit test: grapple drag moves grappled creature along with grappler
- [ ] Unit test: readied action expires at start of readier's next turn
- [ ] Unit test: readied spell requires concentration until triggered
- [ ] Unit test: creature_casts_spell trigger fires readied attack
- [ ] E2E scenario: thunderwave-push.json — Thunderwave pushes target 10ft on failed save
- [ ] E2E scenario: readied-action-expiry.json — readied action expires unused
- [ ] E2E scenario: grapple-drag.json — grappler moves with grappled target at half speed
