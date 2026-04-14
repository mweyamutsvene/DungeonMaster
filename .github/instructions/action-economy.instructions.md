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
| `combat/helpers/resource-utils.ts` | ~150 | Resource flag spend/check helpers, `getActiveEffects()`, `normalizeResources()` |
| `combat/helpers/combat-hydration.ts` | ~300 | `extractActionEconomy()` from DB state, `resetTurnResources()` at turn start |
| `domain/entities/creatures/legendary-actions.ts` | ~60 | Legendary action pool tracking for boss monsters |

## Key Types/Interfaces

- `ActionEconomy` — `{ actionUsed, bonusActionUsed, reactionUsed, movementUsed, movementAvailable, freeObjectInteractionUsed }`
- `freshActionEconomy(speed)` — creates a fresh economy with full movement budget
- `spendAction()` / `spendBonusAction()` / `spendReaction()` / `spendMovement(feet)` — consume resources
- `extractActionEconomy(combatant)` — hydrates economy from persisted DB state
- `resetTurnResources(combatant)` — resets all flags for new turn start
- `LegendaryActionPool` — tracks uses between legendary creature's turns

## Known Gotchas

- **Resets at start of turn, not end** — when a creature's turn begins, they get fresh resources. There is NO "end of turn cleanup" for action economy.
- **Reactions reset at start of YOUR turn** — a creature that uses their reaction between turns (e.g., OA) gets it back only when their own turn starts, not at round start.
- **Movement is a budget, not binary** — `movementUsed` vs `movementAvailable` (speed in feet). A creature can move, attack, then move again if they have budget remaining.
- **Action Surge grants a second action** — it doesn't reset `actionUsed`, it provides a separate additional action. The economy type has `actionSurgeUsed` specifically for this.
- **Free object interaction is once per turn** — drawing a weapon is free; drawing a second weapon in the same turn costs an action.
