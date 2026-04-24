# SME Feedback — ReactionSystem — Round 1
VERDICT: NEEDS_WORK

## Validation of the four specified items

### (a) Protector `reactionUsed` consumption — ✅ CORRECT
Plan explicitly states "Consume protector's reaction (not target's)" for both Protection and Interception branches. This matches the invariant from my research (§Constraints #1). The Cross-Flow Risk Checklist also flags this ("Must verify"). Acceptable — implementer must resolve the protector via `opportunity.combatantId` (not `target.id`), mirroring the Sentinel pattern, NOT the Deflect pattern.

### (b) Reroll-take-min as disadvantage proxy — ✅ MATHEMATICALLY SOUND, but incomplete
Plan: "roll a second d20 via `input.diceRoller`, take `min(original, second)`, recompute hit/miss against target AC." Mathematically equivalent to true disadvantage. However the plan does **not** specify:
- Where the *original* `d20Roll` is read from. `PendingAttackData` has `d20Roll` at L678-L685 — implementer must use that, not `attackRoll` (which is the pre-totaled value).
- What happens if the original attack was already rolled with advantage. 2024 rules: advantage + disadvantage cancel → single d20, no reroll. Plan silently ignores this. **Add a bullet: if `pendingAttack.rollMode === "advantage"`, Protection cancels advantage to straight (no reroll needed); if `"normal"`, reroll and take min; if `"disadvantage"`, no-op (already at disadvantage).**
- `attackTotal` and `hit` fields on `PendingAttackData` must be mutated, and the downstream damage path must honor the new miss (existing Cutting Words precedent at L484-L487 confirms this mutation is supported).

### (c) Ally-scan loop location in `initiate()` — ✅ CORRECT LOCATION
Plan: "after existing target-scan reaction detection and Sentinel scan, add ally-scan loop." Matches my recommendation and the Sentinel precedent at L193-L263. Implementer must use distance to **target**, not **attacker** (research §Constraints #3) — plan does not explicitly call this out; add a note.

### (d) Protection-then-Interception ordering within a single attack — ❌ NOT ADDRESSED
This is the primary NEEDS_WORK issue. The plan lists two new `complete()` branches but does not specify their position in the existing reaction resolution sequence. From my research (§Constraints #6, §5):
- **Protection MUST resolve before the hit check** (before Shield AC bump, before Cutting Words modifier is baked in? — arguable, but before hit/miss is finalized).
- **Interception MUST resolve AFTER the damage roll, before Uncanny Dodge halving**, and its reduction stacks with Deflect (both floor at 0).
- The existing sequence in `complete()` (L543-L600) is: Shield AC bump → hit check → damage roll → Deflect → Uncanny Dodge. Plan needs to specify: **Protection slots between Shield and hit check; Interception slots between Deflect and Uncanny Dodge.**
- On a single attack, if both a Protection and an Interception opportunity exist, Protection resolves first (may convert hit→miss, nullifying Interception). Plan must state this explicitly to avoid implementers running them in declaration order.

## Additional gaps

1. **Missing: extend `PendingAttackData` to carry `d20Roll`, `attackBonus`, `rollMode`.** Research flagged this as "mostly present, verify." Plan has no bullet for this verification. Add one under ReactionSystem flow.
2. **Missing: emit `ProtectionApplied` / `InterceptionApplied` events** for CLI/transcript visibility. Research §Risks #1 called this out. Not a blocker but should be a checklist item.
3. **Missing: auto-decline policy for NPC protectors.** Deterministic AI has no ally-reaction hook. Without an explicit auto-decline, NPC-ally Protection opportunities will hang the pending action state machine. Add: "AI protectors auto-decline in Phase 3.1 (defer AI hook to future phase)."
4. **Sentinel precedent uses attacker position for distance**; plan correctly uses target position but does not call out this divergence, which an implementer copying Sentinel code verbatim would miss.

## Suggested changes to plan
- Add bullet under attack-reaction-handler `complete()`: "**Ordering**: Protection → (existing hit check) → (existing damage roll) → Deflect → Interception → Uncanny Dodge."
- Add bullet: "Handle `rollMode` interaction: advantage+Protection = straight roll; disadvantage+Protection = no-op."
- Add bullet under ReactionSystem flow: "Verify `PendingAttackData` carries `d20Roll`, `attackBonus`, `rollMode`; extend if absent."
- Add bullet: "AI protectors auto-decline in this phase."
- Add note under `initiate()` ally-scan: "distance computed to **target** position (not attacker)."
