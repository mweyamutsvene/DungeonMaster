# SME Research — ReactionSystem — Damage Reaction + Extra Attack Chain Conflict

## Scope
- Files read: `two-phase-action-service.ts` (270 lines), `damage-reaction-handler.ts` (300 lines), `reactions.ts` (450 lines), `pending-action.ts` (280 lines), `pending-action-repository.ts` (50 lines), `session-tabletop.ts` (lines 40-260), `damage-resolver.ts` (lines 520-620), `roll-state-machine.ts` (lines 760-830)
- Task: Allow damage reactions to fire between EA chain attacks, then resume the EA chain

## Current State

### `DamageReactionHandler.initiate()` (damage-reaction-handler.ts:48-104)
1. Creates `PendingDamageReactionData` with `{ attackerId, damageType, damageAmount, sessionId }`
2. Creates a `PendingAction` in `PendingActionRepository` (multi-record two-phase store)
3. Emits `ReactionPrompt` SSE event
4. Returns `{ status: "awaiting_reactions", pendingActionId }`

**Key detail**: This only writes to `PendingActionRepository` — it does NOT touch the encounter-level `pendingAction` slot. The encounter-level slot is set to `"reaction_pending"` by the **caller** (e.g., the attack completion handler in `reactions.ts` line 275). For damage reactions initiated from the tabletop route, the caller in `session-tabletop.ts` would need to do the same.

### `DamageReactionHandler.complete()` (damage-reaction-handler.ts:112-300)
1. Retrieves the PendingAction from `PendingActionRepository`
2. Checks `resolvedReactions` for a "use" choice
3. If **Absorb Elements**: heals back `floor(damageAmount/2)`, spends spell slot, marks `reactionUsed: true`
4. If **Hellish Rebuke**: rolls 2d10 fire damage, attacker DEX save (with Evasion support), applies damage, spends spell slot, marks `reactionUsed: true`
5. Calls `markCompleted()` + `delete()` on the pending action
6. Returns `{ reactionType, used, healBack?, retaliationDamage?, retaliationSaved? }`

**Critical**: `complete()` does NOT touch the encounter-level `pendingAction` slot. It only cleans up the two-phase `PendingActionRepository`. The caller is responsible for encounter-level state.

### Reaction route auto-complete for `damage_reaction` (reactions.ts:353-380)
After player responds and status becomes `"ready_to_complete"`:
```
1. Calls twoPhaseActions.completeDamageReaction()
2. Calls deps.combat.setPendingAction(encounterId, null)  ← CLEARS encounter slot
3. Calls deps.aiOrchestrator.processAllMonsterTurns()     ← attempts AI resume
4. Returns { status: "completed", damageReactionResult }
```

**This is where EA chain restoration must happen** — step 2 currently clears the slot unconditionally.

### The two pending action systems (documented in pending-action.ts lines 8-36)
| System | Purpose | Storage | Cardinality |
|--------|---------|---------|-------------|
| Encounter-level `pendingAction` | "What roll does the player need next?" | Single JSON blob on Encounter | ONE per encounter |
| `PendingActionRepository` | "Which reactions are available?" | Multi-record store with TTL | MANY per encounter |

These are independent. The only sync point is when encounter `pendingAction` is set to `{ type: "reaction_pending" }` to pause the tabletop flow.

## Impact Analysis — ReactionSystem Files

| File | Change Required | Risk | Why |
|------|----------------|------|-----|
| `pending-action.ts` | Add `resumeAction?: unknown` to `PendingDamageReactionData` | **LOW** | Type-only change; backward compatible |
| `damage-reaction-handler.ts` | Accept + store `resumeAction` in `initiate()` input; pass through in `complete()` result | **LOW** | Handler just stores/returns data, no logic change |
| `reactions.ts` (damage_reaction block) | After completion, check for `resumeAction`; if present, restore it to encounter slot instead of clearing to null; skip AI resume | **MED** | Must distinguish player-EA-resume from AI-resume |
| `two-phase-action-service.ts` | Update `initiateDamageReaction` signature to accept `resumeAction` param | **LOW** | Passthrough to handler |

## How Deferred EA Chain Should Work

### Storage: `PendingDamageReactionData.resumeAction`
Add `resumeAction?: Record<string, unknown>` to `PendingDamageReactionData`. When the route handler creates a damage reaction and an EA chain was deferred, it serializes the `AttackPendingAction` into this field. The data travels with the two-phase pending action through create → respond → complete.

### Restore location: `reactions.ts` damage_reaction auto-complete (line ~360)
```typescript
// After completeDamageReaction succeeds:
const drData = pendingAction.data as PendingDamageReactionData;
if (drData.resumeAction) {
  // Restore the EA chain ATTACK pending action
  await deps.combat.setPendingAction(encounterId, drData.resumeAction as JsonValue);
  // Do NOT call processAllMonsterTurns — player still has attacks
} else {
  await deps.combat.setPendingAction(encounterId, null as any);
  // Resume AI turns as before
  try { await deps.aiOrchestrator.processAllMonsterTurns(...); } catch {}
}
```

### Route handler orchestration: `session-tabletop.ts`
Currently the route does:
1. Capture `pendingBeforeRoll` before `processRollResult()`
2. Call `processRollResult()` — EA chain writes ATTACK to encounter slot
3. Check `tryInitiateDamageReaction()` — blocked by ATTACK in slot

Under Option A (proposed):
1. Capture `pendingBeforeRoll` before `processRollResult()`
2. Call `processRollResult()` — returns `extraAttackChain` in result, does NOT write to slot
3. Check `tryInitiateDamageReaction()` — slot is now clear, can proceed
4. If reaction fires: pass `extraAttackChain` as `resumeAction` to `initiateDamageReaction()`
5. If no reaction: write `extraAttackChain` to slot manually (same behavior as today)

## `setPendingAction(encounterId, null)` Clearing Semantics

Current clearing points after damage reaction:
- `reactions.ts:363` — unconditional `setPendingAction(null)` after `completeDamageReaction()`
- This clears the encounter-level slot, allowing new tabletop actions

With the fix, this must become conditional: clear only if no `resumeAction`. If `resumeAction` exists, write it instead.

## Risks to ReactionSystem

1. **Pending action state corruption**: If the damage reaction completes but the `resumeAction` restore fails (crash mid-operation), the EA chain is lost. Mitigation: the restore is a single `setPendingAction` call — atomic at the Prisma level. Risk is minimal.

2. **Stale `resumeAction`**: If the target dies from Hellish Rebuke retaliation, the EA ATTACK pending action points at a dead target. The damage-resolver already handles "target dead → return to prompt for new target" (line 588). We should do the same: after restore, if original target died from the reaction, clear the `targetId` or return `actionComplete: false, requiresPlayerInput: false` to let the player choose a new target. However, this is a UX concern in the route handler, not in the reaction system itself.

3. **Reaction-during-AI-turn**: If the damage was dealt by a monster (AI attack), there should be no EA chain to resume (AI handles its own multi-attack). The `resumeAction` field would simply be absent/null. The existing guard in the route handler only calls `tryInitiateDamageReaction` for tabletop rolls (player characters), so this is safe.

4. **Multiple reactions on same damage**: D&D 5e allows only ONE reaction per round per creature. `damage-reaction-handler` already marks `reactionUsed: true` on the reactor's resources. No risk of double-firing.

5. **Miss path parity**: `roll-state-machine.ts:800` has the same EA miss chaining pattern with `setPendingAction`. If graze damage from a miss triggers a damage reaction (unlikely but possible — graze = Str mod, could be nonzero), the same conflict would occur. The fix in `damage-resolver.ts` should be mirrored in `roll-state-machine.ts`: return chain intent instead of writing to slot. The reaction system itself doesn't need separate handling for miss vs hit — `resumeAction` works the same either way.

## Constraints & Invariants (ReactionSystem-specific)

1. **`DamageReactionHandler.complete()` must NOT write to encounter-level `pendingAction`** — this is the caller's responsibility. Any EA chain restore must happen in `reactions.ts`, not in the handler.
2. **`PendingActionRepository` is multi-record** — adding `resumeAction` to the data doesn't conflict with other pending actions.
3. **Reaction completion always deletes from `PendingActionRepository`** — no cleanup concern for the `resumeAction` field.
4. **The `processAllMonsterTurns()` call after damage reaction must be skipped when restoring EA chain** — otherwise AI acts while the player still has attacks remaining.

## Recommendations

1. **Add `resumeAction?: Record<string, unknown>` to `PendingDamageReactionData`** — minimal type change, carries EA chain context through the reaction lifecycle.
2. **Modify `reactions.ts` damage_reaction auto-complete** — conditional restore instead of unconditional null clear.
3. **Update `DamageReactionHandler.initiate()` call signature** — accept and store `resumeAction` from caller context (route handler or wherever the deferred EA chain info comes from).
4. **Do NOT modify `DamageReactionHandler.complete()` internals** — it already returns cleanly. The restore logic belongs in `reactions.ts`.
5. **The return type of `completeDamageReaction` may optionally include `resumeAction`** so the route can detect it, OR `reactions.ts` can read it directly from `pendingAction.data.resumeAction`. Reading from data is simpler and doesn't require changing the service return type.
