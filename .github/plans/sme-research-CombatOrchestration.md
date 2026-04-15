# SME Research — CombatOrchestration — Damage Reaction + Extra Attack Chain Conflict

## Scope
- Files read: `damage-resolver.ts` (650 lines), `session-tabletop.ts` (300 lines), `roll-state-machine.ts` (key sections ~200 lines), `tabletop-types.ts` (250 lines), `two-phase-action-service.ts` (270 lines), `reactions.ts` (lines 340-395), `combat-repository.ts` (interface)
- Task: Damage reactions (Hellish Rebuke, Absorb Elements) must fire between Extra Attack chain attacks per D&D 5e 2024 rules

## Current State

### Single-slot pending action system
`ICombatRepository` has **one slot per encounter**: `setPendingAction(encounterId, action)` / `getPendingAction(encounterId)`. No stacking, queueing, or suspension mechanism exists.

### Damage resolution + EA chain flow (damage-resolver.ts lines 548-590)
After damage resolves, damage-resolver checks `canMakeAttack(freshActor.resources)`. If true and guards pass (`!combatEnded && !bonusAction && !spellStrike && !weaponHasLoading`), it:
1. Creates `AttackPendingAction` with same target/weapon
2. Calls `setPendingAction(encounter.id, nextPending)` — **overwrites** the just-consumed DAMAGE action
3. Returns `{ rollType: "damage", actionComplete: false, requiresPlayerInput: true }` with an "Extra Attack" message

### Route handler flow (session-tabletop.ts lines 210-240)
1. Captures `pendingBeforeRoll` via `getPendingAction()` **before** calling `processRollResult()`
2. Calls `processRollResult()` — delegates to RollStateMachine → DamageResolver
3. After resolution, checks `isDamagePendingAction(pendingBeforeRoll)` → calls `tryInitiateDamageReaction()`
4. `tryInitiateDamageReaction()` at line 80: `const pendingAfterRoll = await deps.combatRepo.getPendingAction(encounterId); if (pendingAfterRoll) return null;` — **this is the blocker**

### The conflict
DamageResolver creates the EA ATTACK pending action **inside** `processRollResult()`, so by the time the route handler calls `tryInitiateDamageReaction()`, the pending action slot already contains the EA chain. The guard correctly prevents clobbering it — but incorrectly prevents the damage reaction from firing.

### Reaction completion flow (reactions.ts lines 350-380)
After damage reaction resolves: `setPendingAction(encounterId, null)` → tries `processAllMonsterTurns()`. **No mechanism to restore the EA chain ATTACK pending action.** Even if we got the reaction to fire, the EA chain would be lost.

## Impact Analysis

| File | Change Required | Risk | Why |
|------|----------------|------|-----|
| `damage-resolver.ts` | Decouple EA chain creation from damage resolution OR return EA chain intent without writing to pending action slot | **HIGH** | Core damage path; flurry/spell-strike chains use same pattern |
| `session-tabletop.ts` | Remove/modify `pendingAfterRoll` guard; orchestrate reaction-then-EA-resume | **MED** | Must save EA chain context, initiate reaction, then restore EA after reaction completes |
| `reactions.ts` | After damage reaction completion, restore EA chain pending action instead of clearing to null | **MED** | Must know EA chain context to restore it |
| `tabletop-types.ts` | Possibly add `suspendedAction` field to DamagePendingAction or create new type | **LOW** | Type changes only |
| `roll-state-machine.ts` | EA miss chaining (line 768) has the same conflict pattern as damage-resolver | **MED** | Parallel fix needed for miss → graze damage → reaction scenario |

## Constraints & Invariants

1. **Single pending action slot** — the entire tabletop flow assumes one pending action at a time. Adding a stack/queue is a significant architectural change.
2. **Flurry-of-blows chains must NOT be affected** — FoB creates ATTACK pending actions at line 402 of damage-resolver.ts. Guard `!action.bonusAction` already excludes FoB from EA chaining, but the `tryInitiateDamageReaction` guard blocks ALL pending actions, not just EA.
3. **Spell-strike chains must NOT be affected** — same pattern with `spellStrike` field, same guard excludes from EA path.
4. **Loading weapon guard** must remain — one shot per action.
5. **`rollType: "damage"` contract** — EA chain returns `rollType: "damage"` (not "attack") so scenario/CLI expectations validate. Any change must preserve this.
6. **D&D 5e 2024 rule**: Reactions can fire at any point between attacks in an Extra Attack sequence. Damage reactions (Hellish Rebuke) trigger "when you take damage" — this is immediate, before the next attack in the sequence.

## Options & Tradeoffs

| Option | Pros | Cons | Recommendation |
|--------|------|------|---------------|
| **A: Return EA chain intent from damage-resolver; route handler orchestrates** — DamageResolver returns `{ extraAttackChain: AttackPendingAction }` in result without writing to pending slot. Route handler checks for damage reaction first; if none, writes EA to slot. If reaction fires, saves EA context on the two-phase pending action for restoration after reaction completes. | Clean separation of concerns; damage-resolver stays pure; route handler owns orchestration | Requires changes to DamageResult type; reactions.ts must know how to restore EA; miss path in RSM needs same treatment | ✓ **Preferred** |
| **B: Two-slot pending action system** — Add `suspendedPendingAction` alongside `pendingAction`. EA chain writes to suspended slot; damage reaction writes to primary slot. After reaction completes, promote suspended → primary. | Minimal service-layer changes; general solution for future reaction-during-chain needs | Architectural complexity; all getPendingAction callers must understand two slots; migration risk | ✗ Over-engineered for now |
| **C: Delay EA chain creation** — Move EA chain logic out of damage-resolver entirely. After damage resolves, route handler checks `canMakeAttack()` and creates the EA pending action. | Keeps damage-resolver simpler | Duplicates EA eligibility logic between route handler and service layer; miss path still in RSM | ✗ Violates DRY |
| **D: Embed EA chain data on the damage reaction pending action** — When initiating damage reaction, attach `{ resumeAction: AttackPendingAction }` to the two-phase pending action data. After reaction completes, reactions.ts reads `resumeAction` and restores it. | Minimal new types; data travels with the reaction | Tight coupling between reaction system and EA chain; two-phase pending action type gets complex | Acceptable fallback |

## Risks

1. **Flurry/spell-strike regression**: Both use the same `setPendingAction` pattern in damage-resolver. Option A must ensure `extraAttackChain` is ONLY returned for EA chains (not flurry/spell-strike). The existing guards (`!bonusAction && !spellStrike`) already distinguish these, so the same guards gate the new return field.
2. **Miss path parity**: `roll-state-machine.ts` line 768 has EA miss chaining with the same `setPendingAction` pattern. If graze damage kills a target or triggers a damage reaction, the same conflict occurs. Must be fixed in parallel.
3. **E2E scenario runner auto-complete**: The scenario runner detects "Extra Attack" in response messages and auto-completes with natural-1 miss rolls. If the response structure changes (e.g., EA chain info moves to a separate field), the auto-complete regex may break.
4. **Reaction completion → EA resume timing**: After `completeDamageReaction`, the reactions route currently calls `processAllMonsterTurns()`. If the damage was dealt by a player character (EA chain), we must NOT trigger AI turns — we must restore the EA pending action for the player. Need to distinguish player-EA-resume from AI-turn-resume.
5. **Multiple damage reactions**: D&D 5e allows only one reaction per round, so at most one damage reaction per attack. This simplifies the flow (no reaction queue needed).

## Recommendations

1. **Use Option A** (return EA chain intent, route handler orchestrates):
   - `DamageResolver.resolve()` returns `extraAttackChain?: AttackPendingAction` in the result object instead of calling `setPendingAction()` for EA chains
   - Route handler in `session-tabletop.ts`: if `extraAttackChain` exists AND damage reaction detected → save EA chain on the two-phase pending action, initiate reaction; if no reaction → write EA chain to pending slot as before
   - `reactions.ts` damage reaction completion: if `resumeAction` exists on the pending action data → restore it to pending slot instead of clearing to null; skip `processAllMonsterTurns()`
2. **Fix miss path in parallel** (RSM line 768): Same pattern — return chain intent instead of writing directly, let route handler orchestrate
3. **Add `resumeAction?: unknown` to the two-phase pending action** (in `pending-action.ts` or reaction handler data) for carrying EA context through the reaction lifecycle
4. **Update E2E scenario auto-complete** if response shape changes — verify "Extra Attack" message text is preserved
