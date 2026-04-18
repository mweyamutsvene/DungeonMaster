---
description: "Architecture and conventions for the ReactionSystem flow: TwoPhaseActionService, opportunity attacks, Shield/Deflect Attacks/Counterspell reactions, damage reactions, pending action state machine."
applyTo: "packages/game-server/src/application/services/combat/two-phase/**,packages/game-server/src/application/services/combat/two-phase-action-service.ts,packages/game-server/src/domain/entities/combat/pending-action.ts,packages/game-server/src/infrastructure/api/routes/reactions.ts,packages/game-server/src/application/services/combat/helpers/oa-detection.ts"
---

# ReactionSystem Flow

## Purpose
Manages the two-phase reaction resolution pipeline: server detects a reaction trigger, pauses combat to offer the reaction to the player/AI, then resumes based on the response. Handles opportunity attacks, Shield, Deflect Attacks, Counterspell, and post-damage reactions.

## File Responsibility Matrix

| File | ~Lines | Responsibility |
|------|--------|----------------|
| `combat/two-phase-action-service.ts` | ~420 | Facade: delegates to 4 handler modules |
| `combat/two-phase/move-reaction-handler.ts` | ~200 | OA initiation on movement leaving threatened squares |
| `combat/two-phase/attack-reaction-handler.ts` | ~180 | Shield (+5 AC retroactive), Deflect Attacks |
| `combat/two-phase/spell-reaction-handler.ts` | ~150 | Counterspell (slot + ability check for higher levels) |
| `combat/two-phase/damage-reaction-handler.ts` | ~120 | Post-damage reaction opportunities |
| `domain/entities/combat/pending-action.ts` | ~100 | PendingAction union type for state machine |
| `combat/helpers/oa-detection.ts` | ~80 | `detectOpportunityAttacks()` — centralized OA eligibility |
| `combat/tabletop/pending-action-state-machine.ts` | ~150 | Valid state transitions for pending actions |
| `infrastructure/api/routes/reactions.ts` | ~100 | POST respond / GET pending reaction routes |

## Key Types/Interfaces

- `TwoPhaseActionService` — facade with paired initiate/complete methods: `initiateMove()` / `completeMove()`, `initiateAttack()` / `completeAttack()`, `initiateSpellCast()` / `completeSpellCast()`, `initiateDamageReaction()` / `completeDamageReaction()`
- `PendingActionType` — `"move" | "spell_cast" | "attack" | "damage_reaction" | "lucky_reroll" | "ability_check"`
- `ReactionType` — `"opportunity_attack" | "counterspell" | "shield" | "absorb_elements" | "hellish_rebuke" | "deflect_attacks" | "uncanny_dodge" | "readied_action" | "sentinel_attack" | "lucky_reroll" | "silvery_barbs" | "interception" | "protection"`
- `PendingAction` — core interface with `id`, `encounterId`, `actor`, `type`, `data`, `reactionOpportunities`, `resolvedReactions`, `expiresAt`
- `DetectOpportunityAttacksInput` — single input object passed to `detectOpportunityAttacks(input: DetectOpportunityAttacksInput)`; NOT positional args
- `PendingActionStateMachine` — validates state transitions (e.g., `reaction_pending` → `reaction_resolved`)

### Dual Pending Action Systems (CO-L7)
There are TWO parallel pending action systems that do NOT conflict:
1. **Encounter-level `pendingAction` field** — singleton JSON blob; used by the tabletop dice flow (RollStateMachine) for ATTACK/DAMAGE/INITIATIVE rolls
2. **PendingActionRepository** — multi-record store; used by TwoPhaseActionService for reaction opportunities

The only synchronization point: when encounter `pendingAction = "reaction_pending"`, the tabletop flow is paused waiting for reactions from PendingActionRepository.

## Known Gotchas

- **Reactions consume one per round** — resets at the start of the creature's OWN turn, not at round start. A creature that uses Shield on someone else's turn cannot take an OA until their next turn begins.
- **OA uses reach, not range** — a creature with 5ft reach threatens adjacent squares only. A creature with 10ft reach (e.g., with a polearm) threatens a wider area.
- **Shield is retroactive** — it applies +5 AC to the TRIGGERING attack (possibly turning a hit into a miss) and persists until the start of the caster's next turn.
- **The two-phase flow pauses combat state** — the encounter's `pendingAction` field is set, and all other actions are blocked until the reaction is resolved or declined.
- **OA detection is centralized in `oa-detection.ts`** — both ActionService.move (programmatic) and MoveReactionHandler.initiate (two-phase) reuse it. Never duplicate OA eligibility logic inline.
