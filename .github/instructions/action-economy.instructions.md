---
description: "Architecture and conventions for the ActionEconomy flow: action/bonus/reaction tracking, resource flags, turn resets, legendary actions, action economy lifecycle."
applyTo: "packages/game-server/src/domain/entities/combat/action-economy.ts,packages/game-server/src/application/services/combat/helpers/resource-utils.ts,packages/game-server/src/application/services/combat/helpers/combat-hydration.ts,packages/game-server/src/domain/entities/creatures/legendary-actions.ts"
---

# ActionEconomy Flow

## Purpose
Tracks what each creature can do on their turn: action, bonus action, reaction, movement budget, and free object interaction. Resets at turn start, consumed by combat actions, and persisted between server requests.

## File Responsibility Matrix

| File | ~Lines | Responsibility |
|------|--------|----------------|
| `domain/entities/combat/action-economy.ts` | ~80 | Core ActionEconomy type + `freshActionEconomy()` factory |
| `combat/helpers/resource-utils.ts` | ~540 | Resource flag spend/check helpers, `getActiveEffects()`, `normalizeResources()`, `resetTurnResources()`, legendary action tracking |
| `combat/helpers/combat-hydration.ts` | ~160 | `extractActionEconomy()` from DB state, full combatant hydration |
| `domain/entities/creatures/legendary-actions.ts` | ~80 | Legendary action definitions (`LegendaryTraits`, `LegendaryActionDef`) |

## Key Types/Interfaces

- `ActionEconomy` — `{ actionAvailable: boolean, bonusActionAvailable: boolean, reactionAvailable: boolean, movementRemainingFeet: number, actionsUsed: readonly SpecificActionType[] }` — immutable record; booleans default to `true`, movement starts at creature speed
- `SpecificActionType` — `"Attack" | "Dash" | "Dodge" | "Help" | "Hide" | "Ready" | "Search" | "UseObject" | "CastSpell"` — tracked in `actionsUsed[]`
- `freshActionEconomy(movementFeet)` — creates a full-resource economy for turn start
- **Primary (immutable) API**: `withActionSpent()` / `withBonusActionSpent()` / `withReactionSpent()` / `withMovementSpent(feet)` — return new `ActionEconomy` objects
- **Check functions**: `canSpendAction()` / `canSpendBonusAction()` / `canSpendReaction()` / `canSpendMovement(feet)` — read-only eligibility checks
- **Legacy mutable API** (`@deprecated`): `spendAction()` / `spendBonusAction()` / `spendReaction()` — mutate via `(economy as any)` cast; still used in older code paths
- `extractActionEconomy(combatant)` in `combat-hydration.ts` — hydrates economy from persisted DB state
- `resetTurnResources(combatant)` in `resource-utils.ts` — resets all flags for new turn start
- `LegendaryTraits` / `LegendaryActionDef` in `legendary-actions.ts` — legendary action definitions; runtime pool tracking via `getLegendaryActionsRemaining()` / `spendLegendaryAction()` in `resource-utils.ts`

## Known Gotchas

- **Resets at start of turn, not end** — when a creature's turn begins, they get fresh resources. There is NO "end of turn cleanup" for action economy.
- **Reactions reset at start of YOUR turn** — a creature that uses their reaction between turns (e.g., OA) gets it back only when their own turn starts, not at round start.
- **Movement is a budget, not binary** — `movementRemainingFeet` tracks remaining feet. A creature can move, attack, then move again if they have budget remaining.
- **Action Surge grants a second action** — it doesn't use the `ActionEconomy` type at all; Action Surge is tracked in the JSON resources blob via `resource-utils.ts`. The `ActionEconomy` type has NO `actionSurgeUsed` field.
- **Free object interaction is tracked in the resources blob** — NOT in `ActionEconomy`. Managed via the JSON resources field on `CombatantStateRecord`.
- **Use immutable updaters** — prefer `withActionSpent()` over the deprecated `spendAction()`. The deprecated mutable functions mutate via `(economy as any)` cast and will be removed.
