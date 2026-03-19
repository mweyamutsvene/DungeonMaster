# SME Feedback — CombatOrchestration — Round 2
## Verdict: APPROVED

All 3 BLOCKING issues from Round 1 are resolved. Two minor items remain (one MEDIUM, one LOW) that can be addressed during implementation without re-planning.

---

## Verification of Round 1 Issues

### 1. ✅ BLOCKING Issue 1 (Feral Instinct player path) — RESOLVED
The plan now correctly targets `computeInitiativeModifiers()` (L94 in `tabletop-combat-service.ts`) and extracts className/level from the already-passed `sheet` parameter. The explicit note "NO separate check in `initiateAction()` needed" confirms the delegation pattern is preserved. The adv/disadv counter logic is correct:
- `advSources++` for Feral Instinct (unconditional at level 7+)
- `disadvSources--` only when surprised AND has Feral Instinct AND NOT incapacitated
- This correctly nets to advantage when surprised, normal when not, and cancels properly with other sources.

The server auto-rolled path (`computeInitiativeRollMode()` in `roll-state-machine.ts`) mirrors this correctly. All 3 call sites (multi-PC L574, monster L644, NPC L703) have `className`/`level` available nearby from existing code.

### 2. ✅ BLOCKING Issue 2 (rageAttackedThisTurn location) — RESOLVED
The plan now places `rageAttackedThisTurn: true` solely in `handleAttackRoll()` (~L1025 in `roll-state-machine.ts`), after the attack roll is resolved regardless of hit/miss. The plan explicitly notes "D&D 5e 2024: attacked a hostile creature means made an attack roll, not necessarily hit." The `action-dispatcher.ts` is no longer mentioned for rage tracking. `handleDamageRoll` only sets `rageDamageTakenThisTurn` on the target (correct — damage received, not damage dealt).

### 3. ✅ BLOCKING Issue 3 (dual reset paths) — RESOLVED
Both reset paths are now explicitly covered:
- **Primary tabletop path:** `extractActionEconomy()` in `combat-hydration.ts` resets `rageAttackedThisTurn` and `rageDamageTakenThisTurn` on fresh economy, using the exact `isFreshEconomy ? false : (resources as any).field ?? false` pattern matching `sneakAttackUsedThisTurn`.
- **Fallback path:** `resetTurnResources()` in `resource-utils.ts` adds both flags.

### 4. ✅ MEDIUM Issue 4 (rage end ordering in nextTurnDomain) — MOSTLY RESOLVED (see note below)
The plan correctly identifies `outgoingEntityId` (available at ~L659) as the combatant whose turn just ended, and places the rage-end check BEFORE the `extractActionEconomy` loop. The plan reads current (pre-reset) resources and calls `shouldRageEnd()` with the correct inputs.

**⚠️ Remaining concern — persistence race condition (MEDIUM):** The plan says "Persist via `updateCombatantState()`" before the `extractActionEconomy` loop. But the loop uses `freshRecords` (fetched at ~L700, before rage-end persist), so `extractActionEconomy` would spread stale `record.resources` (still having `raging: true`) and overwrite the rage-end changes. Fix during implementation: after persisting rage-end, also update the `freshRecords` array in-memory for the outgoing combatant, so `extractActionEconomy` receives the corrected state. This is a one-line fix (`outgoingFreshRecord.resources = updatedResources`) and doesn't change the plan's overall approach.

### 5. ⚠️ LOW Issue 5 (missing damage paths) — PARTIALLY RESOLVED
New plan steps added:
- ✅ OA damage in `two-phase-action-service.ts`
- ✅ AI attack tracking in `ai-action-executor.ts`
- ✅ AI damage taken tracking in `ai-action-executor.ts`

Still missing concrete plan steps (LOW — can be TODO'd for follow-up):
- Zone damage in `action-dispatcher.ts` (~L411-454) and `two-phase-action-service.ts` (~L827-860) — `resolveZoneDamageForPath()` reduces HP directly without setting rage flags
- Ongoing ActiveEffect damage in `processActiveEffectsAtTurnEvent()` (combat-service.ts)
- The plan's Risk #2 correctly identifies these as paths to audit but doesn't elevate them to plan steps

For MVP, the covered paths (tabletop attacks, OA, AI) handle the >95% case. Zone/ongoing damage can be a fast follow-up.

### 6. ✅ LOW Issue 7 (Danger Sense gating) — RESOLVED
The plan now explicitly specifies the effects array filtering approach: filter out effects with `source === "Danger Sense"` when the target has disabling conditions, then pass the filtered array to `hasAdvantageFromEffects()`. This correctly suppresses Danger Sense without affecting other advantage sources (e.g., Bless). The target combatant's conditions are accessible from `targetCombatantForEffects.conditions` which is already fetched in `SavingThrowResolver.resolve()`.

**Note for CombatRules SME:** The plan gates Danger Sense on `["blinded", "deafened", "incapacitated"]` (2014 rules). D&D 5e 2024 simplified this to only Incapacitated. This is a rules question outside CombatOrchestration scope — defer to CombatRules SME for the definitive condition list.

---

## Summary

| Round 1 Issue | Severity | Round 2 Status |
|---------------|----------|----------------|
| #1 Feral Instinct player path | BLOCKING | ✅ Resolved |
| #2 rageAttackedThisTurn location | BLOCKING | ✅ Resolved |
| #3 Dual reset paths | BLOCKING | ✅ Resolved |
| #4 Rage end ordering in nextTurnDomain | MEDIUM | ✅ Resolved (minor persistence note) |
| #5 Missing damage paths (OA, zone) | LOW | ⚠️ OA/AI covered; zone/ongoing still missing |
| #7 Danger Sense gating approach | LOW | ✅ Resolved |

## Implementation Notes
1. When implementing the `nextTurnDomain()` rage-end check, update `freshRecords` in-memory after persisting so `extractActionEconomy` doesn't overwrite the changes.
2. Zone damage rage tracking can be a fast-follow TODO — file scope is small and the pattern is identical to the OA path.
3. The `completeMove()` facade method (L370-490 in `tabletop-combat-service.ts`) has a player OA path that applies damage directly. This path should also set `rageDamageTakenThisTurn` if the target is raging — same pattern as the `two-phase-action-service.ts` step.
