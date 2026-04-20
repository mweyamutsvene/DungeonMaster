# Plan: Fix 5 Endurance Fighter Bugs
## Round: 1
## Status: DRAFT
## Affected Flows: CombatOrchestration, CombatRules

## Objective
Fix 5 bugs found during endurance-fighter AgentTestPlayer run. 4 are server-side (BUG-1,2,3,5), 1 is display-only (BUG-4). Each has a RED regression E2E scenario in `scripts/test-harness/scenarios/fighter/`.

---

## BUG-1: Auto-throw silently switches weapon when target out of melee reach
**Scenario**: `fighter/endurance-bug-1-explicit-weapon-range.json` (RED ✅)
**Root cause**: `attack-handlers.ts:342` — when `dist > reach`, `findThrownWeapon(actorSheet, lowered)` returns ANY throwable weapon (e.g., Handaxe) even though the player explicitly named a melee-only weapon (e.g., "longsword"). The `findThrownWeapon` method falls through to `throwable[0]` when no weapon name matches.
**Fix**: In the auto-throw block (line 340-355), before auto-switching, check if the player explicitly named a weapon in their text. If they did, and that weapon is NOT throwable, throw a `ValidationError` instead of silently switching.

### Changes
#### [File: `packages/game-server/src/application/services/combat/tabletop/dispatch/attack-handlers.ts`]
- [ ] In the auto-throw block (~line 340), add a guard: if the player's text mentions a specific weapon name (check `lowered` against all equipped weapon names), and that weapon isn't throwable, throw `ValidationError("Target is out of reach (Xft > Yft). {WeaponName} can't be thrown.")` instead of auto-switching. Only auto-throw when no specific weapon is named OR the named weapon has Thrown property.

---

## BUG-2: Dead combatants count as "hostile within 5ft" for ranged disadvantage
**Scenario**: `fighter/endurance-bug-2-sap-wrong-disadvantage-target.json` (RED ✅)
**Root cause**: `attack-handlers.ts:906-915` — `hostileWithin5ft` check iterates all combatants but does NOT filter out dead ones (`hpCurrent <= 0`). A killed adjacent enemy still triggers ranged attack disadvantage.
**Fix**: Add `if ((c as any).hpCurrent <= 0) return false;` to the `hostileWithin5ft` lambda.

### Changes
#### [File: `packages/game-server/src/application/services/combat/tabletop/dispatch/attack-handlers.ts`]
- [ ] In `computeAttackRollModifiers` (~line 906), add HP check: `if (c.hpCurrent != null && c.hpCurrent <= 0) return false;` right after the `c.id === actorCombatant.id` guard.

---

## BUG-3: Vex advantage not applied to chained Extra Attack
**Scenario**: `fighter/endurance-bug-3-vex-advantage-uses-max.json` (RED ✅)
**Root cause**: `damage-resolver.ts:588` — when chaining Extra Attack after damage, copies `rollMode: action.rollMode` from the previous pending action. The Vex ActiveEffect was just applied to the attacker by weapon-mastery-resolver, but the chained ATTACK pending action inherits the old "normal" rollMode instead of recomputing it to "advantage".
**Fix**: After building the chained EA pending action in damage-resolver, recompute rollMode by checking the attacker's active effects (specifically Vex). The simplest fix is to call `computeAttackRollModifiers` or a lighter variant that checks for advantage-granting effects on the attacker.

### Changes
#### [File: `packages/game-server/src/application/services/combat/tabletop/rolls/damage-resolver.ts`]
- [ ] In the Extra Attack chaining block (~line 580-615), after creating the chained attack pending action, check the attacker's current active effects for advantage-granting effects (Vex). If found, set `rollMode: "advantage"` on the chained action instead of copying from the previous action. The cleanest approach: read the actor combatant's current resources (which were just updated by weapon-mastery-resolver), check for `activeEffects` with `type: "advantage"` and `scope: "attack_rolls"`, and set rollMode accordingly. Also check for disadvantage effects to handle the full matrix.

#### [File: `packages/game-server/src/application/services/combat/tabletop/rolls/damage-resolver.ts`] (alternative)
- [ ] Alternatively, factor out a `deriveRollModeFromEffects(resources)` helper that reads active effects and returns the appropriate rollMode. Use this when building chained EA pending actions. This is cleaner than duplicating the logic from `computeAttackRollModifiers` which also handles conditions, hostile-within-5ft, etc.

---

## BUG-4: Sapped condition displays on defeated combatant (DISPLAY-ONLY)
**Scenario**: `fighter/endurance-bug-4-sap-clears-on-defeat.json` (GREEN — server is correct)
**Root cause**: CLI display issue — the server correctly clears conditions on KO'd targets, but the CLI may show stale state. Not fixable via game-server changes.
**Fix**: Low priority. Defer to CLI work.

### Changes
- [ ] (DEFERRED) Fix in `packages/player-cli/src/display.ts` — skip showing conditions for combatants with HP ≤ 0.

---

## BUG-5: Sapped condition expires at start of turn instead of on next attack
**Scenario**: `fighter/endurance-bug-5-sap-next-attack-disadvantage.json` (RED ✅)
**Root cause**: `weapon-mastery-resolver.ts:173` creates Sapped with `duration: "until_start_of_next_turn"` and `expiresAt: { event: "start_of_turn", combatantId: actorId }`. The `actorId` is the ATTACKER (who applied Sap), so it expires at the start of the attacker's next turn. BUT `removeExpiredConditions` in `conditions.ts:727` ALSO checks `duration === "until_start_of_next_turn"` WITHOUT `expiresAt` matching (line 727), which means ANY start_of_turn event clears it.

Wait — re-reading `removeExpiredConditions`: if `expiresAt` IS defined, the duration-based fallback is skipped (line 720: `if (!expired && !c.expiresAt)`). So the `expiresAt` check should work correctly: it only clears at the start of the attacker's turn, not the target's.

But the E2E log showed it clearing at the target's turn start. This means either:
1. `actorId` in the weapon-mastery-resolver call is actually the target's ID (caller bug), OR
2. The `expiresAt.combatantId` stores the entity ID but `removeExpiredConditions` compares against entity IDs too.

**NEEDS INVESTIGATION**: Check what `actorId` is in the weapon-mastery-resolver call site — is it the attacker's entity ID or combatant ID? And what does `removeExpiredConditions` compare against? The `combat-service.ts:725` passes `activeEntityId` which is the entity ID of the current turn's creature.

**D&D 5e 2024 Sap Rule**: "If you hit a creature with this weapon, that creature has Disadvantage on its next attack roll before the start of your next turn." So `until_start_of_next_turn` with `expiresAt: actorId` (the attacker) IS correct per RAW. The bug is likely that the IDs don't match (entity vs combatant ID mismatch).

### Changes
#### [File: Investigation needed]
- [ ] Verify the `actorId` passed to `weapon-mastery-resolver.resolve()` and confirm it matches what `combat-service.ts` uses as `activeEntityId` in the start-of-turn cleanup. If there's an ID type mismatch (combatant record ID vs entity ID), fix the mismatch.
- [ ] Additionally, per D&D 5e 2024: Sap should give disadvantage on the target's NEXT attack, then be consumed — not persist until start of attacker's turn. The current implementation lets the target make multiple attacks with disadvantage. Consider changing to "consumed on first attack" semantics (like Vex uses `until_triggered` for advantage). This would be a second improvement beyond fixing the expiry bug.

---

## Cross-Flow Risk Checklist
- [x] Do changes in one flow break assumptions in another? — No, all fixes are localized
- [x] Does the pending action state machine still have valid transitions? — Yes, no state machine changes
- [x] Is action economy preserved? — Yes, no economy changes
- [x] Do both player AND AI paths handle the change? — BUG-2 fix is player path only; AI already filters dead in `ai-attack-resolver.ts:192`
- [x] Are repo interfaces + memory-repos updated? — No entity shape changes
- [x] Is `app.ts` registration updated? — No new executors
- [x] Are D&D 5e 2024 rules correct? — Yes, verified Sap/Vex definitions

## Risks
- **BUG-3 fix complexity**: Recomputing rollMode in damage-resolver requires reading fresh combatant state. The damage-resolver already has access to deps, so this is feasible but needs careful placement.
- **BUG-5 root cause uncertainty**: Need to confirm the ID mismatch theory before implementing. If the IDs DO match, the bug is elsewhere (perhaps conditions are being double-processed).

## Test Plan
- [ ] BUG-1: `fighter/endurance-bug-1-explicit-weapon-range.json` turns GREEN
- [ ] BUG-2: `fighter/endurance-bug-2-sap-wrong-disadvantage-target.json` turns GREEN
- [ ] BUG-3: `fighter/endurance-bug-3-vex-advantage-uses-max.json` turns GREEN
- [ ] BUG-5: `fighter/endurance-bug-5-sap-next-attack-disadvantage.json` turns GREEN
- [ ] All existing E2E scenarios still pass (`test:e2e:combat:mock -- --all`)
- [ ] Unit test: dead combatant excluded from hostileWithin5ft
- [ ] Unit test: auto-throw blocked when explicit melee weapon named

## SME Approval
- [ ] CombatOrchestration-SME
- [ ] CombatRules-SME
