# SME Feedback — CombatOrchestration — Round 1
## Verdict: NEEDS_WORK

## Issues

### 1. BLOCKING — Feral Instinct: Player-rolled initiative path uses wrong approach
The plan says to add a new check in `initiateAction()` in `tabletop-combat-service.ts` to set `rollMode: "advantage"` on the RollRequest. But `initiateAction()` **already delegates this to `computeInitiativeModifiers()`** (L321), which produces `{ advantage, disadvantage }` flags that drive the RollRequest (L336-337). The plan should modify `computeInitiativeModifiers()` to also accept class info and check Feral Instinct, **not** add a separate override in `initiateAction()`. Adding a separate check would either be redundant or conflict with the existing cancellation logic (e.g., surprise + Feral Instinct advantage should cancel to normal, but two separate checks would break the adv/disadv counter).

**Affected plan step:** `tabletop-combat-service.ts` → "Feral Instinct — Player Initiative RollRequest"

### 2. BLOCKING — Rage tracking: `rageAttackedThisTurn` set in wrong place
The plan says to set `rageAttackedThisTurn: true` in **both** `handleDamageRoll` (roll-state-machine.ts) AND `action-dispatcher.ts`. This is wrong:
- **action-dispatcher.ts** — dispatches the attack and returns a RollRequest (pending action). The attack hasn't resolved yet. Setting the flag here is premature.
- **handleDamageRoll** — only fires on damage, meaning the attack hit. But D&D 5e 2024 Rage says "attacked a hostile creature" — an attack that **misses** still counts.

**Correct location:** `handleAttackRoll()` in roll-state-machine.ts (L1025). This is where the d20 roll is resolved. At this point the barbarian has made an attack roll against a hostile, regardless of hit/miss. Set `rageAttackedThisTurn: true` here. Remove it from both `handleDamageRoll` and `action-dispatcher.ts`.

### 3. BLOCKING — `resetTurnResources()` vs `extractActionEconomy()` — two reset paths
The plan says to add `rageAttackedThisTurn: false` and `rageDamageTakenThisTurn: false` to `resetTurnResources()` in `resource-utils.ts`. However, the **primary tabletop flow** goes through `nextTurnDomain()` (combat-service.ts L587), which uses **`extractActionEconomy()`** (combat-hydration.ts L112) to reset turn-based flags — NOT `resetTurnResources()`. The `resetTurnResources()` path is only used by the fallback `nextTurn()` when full domain dependencies aren't available.

The rage tracking flags **must also be reset** in `extractActionEconomy()` (when `isFreshEconomy` is true, set both to `false`). Otherwise they'll persist through the `...resources` spread and never reset in the tabletop flow.

### 4. MEDIUM — Rage end check: ordering in `nextTurnDomain()` path is more complex than described
The plan says "BEFORE calling `resetTurnResources()` (both in new-round path and single-turn path)." But in `nextTurnDomain()`, the flow is:
1. End-of-turn processing (L660-690)
2. `combat.endTurn()` advances to next combatant (L692)  
3. Skip defeated non-characters (L696-706)
4. `extractActionEconomy()` persists resources for ALL combatants (L703-712)
5. Start-of-turn processing (L720-760)

The rage-end check must happen **before step 4** but needs to identify which combatant just ended their turn. At step 4, the turn has already advanced, so the "currently active" combatant is the NEW one. The plan needs to clarify: read the outgoing combatant's rage flags (the one whose turn just ended) before `extractActionEconomy()` resets them. The `outgoingEntityId` variable (L659) is available and correct for this.

### 5. LOW — Missing damage paths for `rageDamageTakenThisTurn`
The plan lists `handleDamageRoll` and `ai-action-executor.ts` as damage paths. It correctly identifies these as primary paths. But the plan's Risk #2 mentions zone damage and OA damage too. The plan body does NOT include concrete plan steps for:
- **Opportunity attacks** in `two-phase-action-service.ts` (L520-615) — when OA damage hits a raging barbarian
- **Zone damage** in `zone-damage-resolver.ts` (L176-190) — when zone damage hits a raging barbarian
- **Ongoing ActiveEffect damage** at start/end of turn — `processActiveEffectsAtTurnEvent()` in combat-service.ts

These should be listed as explicit plan steps, not just risk items.

### 6. LOW — `computeInitiativeRollMode()` surprise negation: does NOT negate surprise itself
The plan says: "If creature would be surprised AND has Feral Instinct AND NOT incapacitated, negate the surprise disadvantage (-1 from `disadv`)." This correctly removes the initiative disadvantage, but D&D 5e 2024 Feral Instinct also says the barbarian can "act normally" on their first turn — they're no longer surprised for the purpose of taking actions. The current surprise system only affects initiative rolls (as disadvantage), so this may be moot. But if any code later checks "is this creature surprised?" for other purposes (e.g., preventing reactions in round 1), Feral Instinct should also negate that. Worth a note in the plan.

### 7. LOW — Danger Sense condition gating: `hasAdvantageFromEffects` returns boolean
The plan says to "add a source-check in SavingThrowResolver — if the advantage effect has source: 'Danger Sense' AND the target has conditions, skip that advantage effect." But `hasAdvantageFromEffects()` returns a plain `boolean` — you can't conditionally remove one advantage source from a boolean result. The CombatRules-SME already flagged this. The implementation should **filter the effects array** before passing it to `hasAdvantageFromEffects()`, removing any effect with `source === "Danger Sense"` when the target has Blinded/Deafened/Incapacitated conditions. The plan should be explicit about this approach.

## Missing Context
- The `nextTurnDomain()` path is the primary tabletop flow, not the fallback `nextTurn()`. The plan's rage-end mechanics are entirely written for the fallback path's `resetTurnResources()` and miss the domain path's `extractActionEconomy()`.
- `computeInitiativeModifiers()` in `tabletop-combat-service.ts` (L94) is a separate function from `computeInitiativeRollMode()` in `roll-state-machine.ts` (L131). Both need Feral Instinct, but for different code paths (player-rolled vs server auto-rolled).

## Suggested Changes

### For Issue 1 (Feral Instinct player-rolled path):
Replace the `tabletop-combat-service.ts` plan step with:
- [ ] Expand `computeInitiativeModifiers()` signature to accept optional `classInfo?: { className: string; level: number }` (or extract from `sheet` which is already passed)
- [ ] If Barbarian level 7+, increment `advSources++`
- [ ] If creature is surprised AND has Feral Instinct AND NOT incapacitated, decrement `disadvSources--` (same pattern as `computeInitiativeRollMode`)
- Remove the separate `initiateAction()` plan step — it's not needed.

### For Issue 2 (rageAttackedThisTurn location):
- Move the `rageAttackedThisTurn` flag setting to `handleAttackRoll()` in `roll-state-machine.ts` (around L1025-1100, after the attack roll is resolved but before hit/miss branching).
- Remove the `action-dispatcher.ts` rage tracking plan step entirely.
- Remove the `handleDamageRoll` attacker tracking (keep only the `rageDamageTakenThisTurn` target tracking in handleDamageRoll).

### For Issue 3 (dual reset paths):
Add a plan step:
- [ ] In `extractActionEconomy()` (combat-hydration.ts L112), add `rageAttackedThisTurn: isFreshEconomy ? false : (resources as any).rageAttackedThisTurn ?? false` and same for `rageDamageTakenThisTurn`. This mirrors how other turn-scoped flags are already reset there.

### For Issue 4 (rage end check in nextTurnDomain):
Add a plan step:
- [ ] In `nextTurnDomain()`, BEFORE the `extractActionEconomy` loop (L703), read the outgoing combatant's rage state. Use `outgoingEntityId` (already available at L659) to find the outgoing record and check rage flags. If rage should end, remove Rage-sourced ActiveEffects and set `raging: false` on that combatant's resources before `extractActionEconomy()` overwrites the flags.

### For Issue 5 (missing damage paths):
Add explicit plan steps for:
- [ ] `two-phase-action-service.ts`: when opportunity attack damage is applied to a raging barbarian target, set `rageDamageTakenThisTurn: true`
- [ ] `zone-damage-resolver.ts`: when zone damage is applied to a raging barbarian, set `rageDamageTakenThisTurn: true`
- [ ] Or: create a shared helper `markRageDamageTaken(combatantId, combatRepo)` that all damage paths can call

### For Issue 7 (Danger Sense gating):
Clarify the plan step to read:
- [ ] In `SavingThrowResolver`, before calling `hasAdvantageFromEffects()`, filter the effects array: if the target has `["blinded", "deafened", "incapacitated"]` conditions, remove any effect with `source === "Danger Sense"` from the array before passing to `hasAdvantageFromEffects()`.
