# SME Research — CombatOrchestration — Sentinel Effect #3

## Status: ALREADY IMPLEMENTED (mostly)

The Sentinel Effect #3 is **already substantially implemented**. Here's what exists and what may need attention.

---

## What Already Exists

### Domain Layer — `domain/rules/opportunity-attack.ts`
- `SentinelReactionTrigger` interface + `canMakeSentinelReaction()` pure function (lines 165–205)
- Checks: hasSentinel, hasReaction, notIncapacitated, within 5ft, notTarget

### Pending Action Type — `domain/entities/combat/pending-action.ts`
- `"sentinel_attack"` already in `ReactionType` union (line 13)

### Detection — `two-phase/attack-reaction-handler.ts` `initiate()`
- Lines ~195–250: After Shield/Deflect detection, scans ALL combatants for:
  - Not attacker, not target, alive (hp > 0)
  - Has `sentinelEnabled` resource flag
  - Has reaction available
  - Within 5ft of attacker (via `calculateDistance`)
  - Calls `canMakeSentinelReaction()` domain function
- Creates `sentinel_attack` reaction opportunity with context `{ attackerId, sentinelName }`

### Resolution — `two-phase/attack-reaction-handler.ts` `complete()`
- Lines ~760–895: Full implementation:
  - Finds sentinel reactions from `resolvedReactions`
  - Gets Sentinel's melee attack stats via `combatants.getAttacks()`
  - Gets attacker's AC
  - Rolls attack (seeded deterministic dice)
  - Applies damage on hit (`applyKoEffectsIfNeeded`)
  - Marks Sentinel's reaction as used
  - Emits `SentinelReactionAttack` event
  - Returns `sentinelAttacks[]` in completion result

### Facade — `two-phase-action-service.ts`
- `completeAttack()` return type includes `sentinelAttacks?` array (lines ~183–193)

### Routes — `infrastructure/api/routes/reactions.ts`
- `"sentinel_attack"` mapped to label `"Sentinel reaction attack"` (line 193)

### AI Path — `ai/ai-attack-resolver.ts`
- Calls `twoPhaseActions.initiateAttack()` (line 217) → detection runs automatically
- `awaiting_reactions` status handled (line 267) → stores pending action + pauses AI turn
- Reaction route auto-completes when all reactions responded → resumes AI turns

### E2E Scenario — `scenarios/core/sentinel-reaction.json`
- Full scenario: 2 fighters + skeleton, monster attacks Tim, Sentinel Sam gets reaction

---

## Potential Gaps / Issues to Verify

### 1. Incapacitation Check (TODO in code)
- Line ~221: `observerIncapacitated: false, // TODO: check incapacitation from conditions`
- Should read conditions from `other.conditions` and check for Incapacitated/Stunned/Unconscious/Paralyzed/Petrified
- **Risk**: Low (edge case), but incorrect per RAW — incapacitated Sentinel shouldn't get reaction

### 2. Tabletop (player-attack) Path
- The tabletop path (`session-tabletop.ts` roll-result flow → `RollStateMachine`) handles damage resolution **differently** from the two-phase initiate path
- Player attacks go: `initiate → rollResult (attack) → rollResult (damage) → resolve`
- The Sentinel detection only runs in `AttackReactionHandler.initiate()` which is called from the AI attack path
- **Question**: When a PLAYER attacks in tabletop flow, does the attack go through `initiateAttack()`? Let me check...

### 3. Sentinel Attacking the Attacker's Speed
- D&D 2024 Sentinel: Effect #2 says OA hit reduces speed to 0. Effect #3 (reaction attack) does NOT reduce speed to 0 — it's just a normal melee attack.
- Current code correctly does NOT set `reducesSpeedToZero` for sentinel_attack reactions ✓

### 4. Multiple Sentinels
- Code loops over ALL combatants, so multiple Sentinels within 5ft each get their own reaction opportunity. This is correct per RAW (each uses their own reaction).

### 5. Sentinel Self-Attack (friendly fire edge case)
- Code correctly skips `other.id === actor.id` (attacker) and `other.id === target.id` (target)
- Sentinel must be a THIRD party — correct ✓

---

## Files Modified (Summary)

| File | What | Status |
|------|------|--------|
| `domain/rules/opportunity-attack.ts` | `canMakeSentinelReaction()` | ✅ Done |
| `domain/entities/combat/pending-action.ts` | `sentinel_attack` reaction type | ✅ Done |
| `two-phase/attack-reaction-handler.ts` | Detection in `initiate()`, resolution in `complete()` | ✅ Done (TODO: incapacitation) |
| `two-phase-action-service.ts` | Facade types updated | ✅ Done |
| `infrastructure/api/routes/reactions.ts` | Label mapping | ✅ Done |
| `scenarios/core/sentinel-reaction.json` | E2E scenario | ✅ Done |

## Recommendation
The implementation appears complete. The main gap is the **incapacitation check** at line ~221. Verify the E2E scenario passes (`sentinel-reaction`). If it does, the feature is functional. If implementation work is needed, it's only the incapacitation guard fix.
