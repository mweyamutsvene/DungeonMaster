# SME Feedback — ClassAbilities — Round 2
## Verdict: APPROVED

Round 1 approval still holds. The CombatOrchestration revisions in Round 2 do not break or conflict with any ClassAbilities contracts.

## What Changed (Round 1 → Round 2)

The CombatOrchestration section was expanded with concrete file/function targets and line-number references. All new CombatOrchestration steps that touch ClassAbilities domain functions do so correctly:

| CombatOrchestration Step | ClassAbilities Domain Function | Correct? |
|--------------------------|-------------------------------|----------|
| `computeInitiativeRollMode()` calls `hasFeralInstinct(level)` | `barbarian.ts` → `hasFeralInstinct(level >= 7)` | Yes |
| `computeInitiativeModifiers()` calls `hasFeralInstinct()` via sheet | Same | Yes |
| `handleInitiativeRoll()` adds Danger Sense ActiveEffect using `hasDangerSense(level)` | `barbarian.ts` → `hasDangerSense(level >= 2)` | Yes |
| `nextTurnDomain()` / `nextTurn()` calls `shouldRageEnd()` | `barbarian.ts` → `shouldRageEnd(attacked, tookDamage, isUnconscious)` | Yes |
| `handleAttackRoll()` sets `rageAttackedThisTurn` | No domain function needed (flag set) | Yes |
| `handleDamageRoll()` sets `rageDamageTakenThisTurn` | No domain function needed (flag set) | Yes |
| `extractActionEconomy()` resets rage tracking flags | Follows existing `sneakAttackUsedThisTurn` pattern exactly | Yes |
| `SavingThrowResolver` gates Danger Sense on conditions | Should delegate to domain helper (Round 1 suggestion still applies) | Non-blocking |

## Round 1 Suggestions — Status

1. **`isDangerSenseNegated()` domain helper** — Round 2 plan still places the condition list inline in `SavingThrowResolver`. My Round 1 suggestion to extract this to `barbarian.ts` as a domain helper remains valid and non-blocking. Implementer should consider it.

2. **`capabilitiesForLevel` passive features** — Round 2 plan still includes passive features (Unarmored Defense, Danger Sense, Feral Instinct) in `capabilitiesForLevel`. Non-blocking — implementer should pick `economy: "free"` for consistency with Fighter's pattern.

## Verified Unchanged
- No new executors needed — still correct, all four features are passive/state-management.
- No `app.ts` registration changes — still correct.
- No `registry.ts` changes — `BARBARIAN_COMBAT_TEXT_PROFILE` is already registered.
- Barrel exports will auto-propagate new functions from `barbarian.ts`.
- `ClassFeatureResolver.hasDangerSense()` and `hasFeralInstinct()` follow the established `isBarbarian()` → delegate pattern (same as `hasRage()`, `hasRecklessAttack()`).
- Rage tracking flags in `extractActionEconomy()` follow the exact same pattern as `sneakAttackUsedThisTurn` and `stunningStrikeUsedThisTurn` — confirmed by reading the current file.

## No New Issues
The CombatOrchestration revisions are well-scoped and correctly reference ClassAbilities domain functions. No domain-first violations introduced.
