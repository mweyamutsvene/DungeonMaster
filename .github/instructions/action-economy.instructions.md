---
description: "Architecture and conventions for the ActionEconomy flow: action/bonus/reaction tracking, resource flags, turn resets, legendary actions, action economy lifecycle."
applyTo: "packages/game-server/src/domain/entities/combat/action-economy.ts,packages/game-server/src/application/services/combat/helpers/resource-utils.ts,packages/game-server/src/application/services/combat/helpers/combat-hydration.ts,packages/game-server/src/domain/entities/creatures/legendary-actions.ts"
---

# ActionEconomy Flow

## Purpose
Tracks turn-scoped combat availability across two representations: a small domain `ActionEconomy` record (action, bonus action, reaction, movement, actions used) and a larger persisted resources blob (object interaction, attack counters, disengage, movement flags, spell-turn restrictions, legendary charges, and other per-turn counters). Turn refresh happens at the start of a creature's turn and is persisted between server requests through the combat hydration layer.

## File Responsibility Matrix

| File | ~Lines | Responsibility |
|------|--------|----------------|
| `domain/entities/combat/action-economy.ts` | ~80 | Core ActionEconomy type + `freshActionEconomy()` factory |
| `combat/helpers/resource-utils.ts` | ~540 | Resource flag spend/check helpers, `getActiveEffects()`, `normalizeResources()`, `resetTurnResources()`, legendary action tracking |
| `combat/helpers/combat-hydration.ts` | ~200 | Hydrates `Combat` from persisted records, parses persisted action-economy flags into domain state, and serializes domain economy back into the `resources` blob via `extractActionEconomy()` |
| `domain/entities/creatures/legendary-actions.ts` | ~100 | Pure domain types/parser for legendary actions, lair actions, and `isInLair` metadata |

## Key Types/Interfaces

- `ActionEconomy` — `{ actionAvailable: boolean, bonusActionAvailable: boolean, reactionAvailable: boolean, movementRemainingFeet: number, actionsUsed: readonly SpecificActionType[] }` — immutable record; booleans default to `true`, movement starts at creature speed
- `SpecificActionType` — `"Attack" | "Dash" | "Dodge" | "Help" | "Hide" | "Ready" | "Search" | "UseObject" | "CastSpell"` — tracked in `actionsUsed[]`
- `freshActionEconomy(movementFeet)` — creates a full-resource economy for turn start
- **Primary (immutable) API**: `withActionSpent()` / `withBonusActionSpent()` / `withReactionSpent()` / `withMovementSpent(feet)` — return new `ActionEconomy` objects
- **Check functions**: `canSpendAction()` / `canSpendBonusAction()` / `canSpendReaction()` / `canSpendMovement(feet)` — read-only eligibility checks
- **Mutable runtime API still in active use** (`@deprecated`): `spendAction()` / `spendBonusAction()` / `spendReaction()` / `spendMovement()` mutate via cast and are still called by the `Combat` aggregate. Prefer the immutable helpers for new code, but do not assume the mutable path is unused.
- `extractActionEconomy(combat, creatureId, existingResources)` in `combat-hydration.ts` — serializes the current domain `ActionEconomy` back into persisted `resources`; hydration from DB state happens in `hydrateCombat()` / `parseActionEconomy()`
- `resetTurnResources(combatant)` in `resource-utils.ts` — resets all flags for new turn start
- **Actual turn-start persistence path**: production turn refresh currently flows through `CombatService.nextTurn()` -> `combat.endTurn()` -> `extractActionEconomy()` for all combatants, plus `resetLegendaryActions()` for the incoming legendary creature. `resetTurnResources()` is a utility helper, not the main turn-advance entry point.
- **Persisted flag vocabulary is mixed today**: `actionSpent` is shared, but bonus/reaction state appears as both `bonusActionSpent` / `reactionSpent` and `bonusActionUsed` / `reactionUsed`. Hydration uses the `...Spent` keys, helper utilities mostly use the `...Used` keys, and some consumers bridge both for compatibility.
- `LegendaryTraits` / `LegendaryActionDef` in `legendary-actions.ts` — legendary action definitions; runtime pool tracking via `getLegendaryActionsRemaining()` / `spendLegendaryAction()` in `resource-utils.ts`

## Known Gotchas

- **Resets at start of turn, not end** — when a creature's turn begins, they get fresh resources. There is NO "end of turn cleanup" for action economy.
- **Reactions reset at start of YOUR turn** — a creature that uses their reaction between turns (e.g., OA) gets it back only when their own turn starts, not at round start.
- **Movement is a budget, not binary** — `movementRemainingFeet` tracks remaining feet. A creature can move, attack, then move again if they have budget remaining.
- **Action Surge grants more attack capacity through resources, not a new `ActionEconomy` field** — the feature spends the `actionSurge` resource pool and applies its combat effect by increasing `attacksAllowedThisTurn` and clearing `actionSpent` via `grantAdditionalAction()`.
- **Free object interaction lives only in the persisted resources blob** — it is tracked with `objectInteractionUsed`, not on `ActionEconomy`. In the current turn-refresh path it is cleared when `extractActionEconomy()` writes a fresh economy, not by `resetTurnResources()`.
- **Use immutable updaters** — prefer `withActionSpent()` over the deprecated `spendAction()`. The deprecated mutable functions mutate via `(economy as any)` cast and will be removed.
