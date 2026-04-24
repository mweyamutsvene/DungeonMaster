VERDICT: APPROVED

As you wish Papi....

# SME Feedback — ReactionSystem — Round 2

## Round 1 concerns — all resolved

1. **rollMode interaction (adv+disadv=straight)** ✓
   - Plan §ReactionSystem "Protection rollMode math" explicitly codifies:
     - `advantage` → straight d20 (fresh roll, recompute)
     - `disadvantage` → redundant, emit `ProtectionRedundant`, do NOT consume reaction
     - `normal` → take min(original, new)
   - Matches 2024 RAW (adv + disadv cancel) and prevents wasted reactions.

2. **d20Roll read/store location on PendingAttackData** ✓
   - Plan calls for verification first ("Verify `PendingAttackData` already has `d20Roll`, `attackBonus`, `rollMode`; add missing fields") rather than blind-adding.
   - Adds `originalRollMode?` for Protection recompute — correct; needed so Protection can distinguish adv/disadv/normal AFTER the roll has been normalized.

3. **Ordering in complete()** ✓
   - Explicit 8-step sequence: Protection → Shield → hit/miss → damage → Deflect → Interception → Uncanny Dodge → apply.
   - This is the correct D&D 5e 2024 order: pre-roll modifiers (Protection) before AC bumps (Shield), then damage reducers layered post-damage-roll in pool order.

4. **ProtectionApplied / InterceptionApplied events** ✓
   - Plan emits `ProtectionApplied`, `InterceptionApplied`, and `ProtectionRedundant`. Sufficient for CLI/AI observability and scenario assertions.

## Deferrals — acceptable

- **OA-path ally-scan deferred** ✓ APPROVED.
  - Documented in §Deferred: "MoveReactionHandler does not re-enter AttackReactionHandler. OAs do NOT trigger Protection/Interception in v1."
  - This is architecturally correct — routing OA attacks through AttackReactionHandler's ally-scan would require a non-trivial refactor of MoveReactionHandler. Reasonable v1 scope.
  - Follow-up TODO noted in fighter.ts profile ("v1 wired for normal attacks; OA path TODO").
- Other deferrals (GWF tabletop, AI protectors, mid-combat re-equip, multi-protector UX) are all out of ReactionSystem's primary concern and reasonably scoped.

## Minor observations (non-blocking)

- §Risks item "Sentinel ally-scan interaction — verify reaction-flag consumption is per-combatant independent" — good defensive note. The existing pattern in AttackReactionHandler already scopes reaction consumption per-combatant via `resources.reactionUsed`, so this should hold, but verification during implementation is wise.
- Interception zero-damage path correctly relies on existing `if (damage > 0)` guards to suppress concentration saves. No new guard logic needed.
- Test plan covers all four round-1 concerns with dedicated unit tests (rollMode matrix, ally-scan negatives, damage floor).

## Verdict

**APPROVED.** All four round-1 concerns are addressed with correct semantics. OA deferral is architecturally sound and documented. Proceed to implementation.
