# SME Research — ActionEconomy — Item-Use Action Cost

## Scope
- `packages/game-server/src/domain/entities/combat/action-economy.ts` (~120 lines)
- `packages/game-server/src/application/services/combat/helpers/resource-utils.ts` (section 1–280)
- `packages/game-server/src/application/services/combat/helpers/combat-hydration.ts` (lines 110–210, `extractActionEconomy`)
- `packages/game-server/src/application/services/combat/combat-service.ts` (`advanceTurnOrder`, `processIncomingCombatantEffects` ~lines 650–740)
- `packages/game-server/src/application/services/combat/tabletop/dispatch/interaction-handlers.ts` (lines 80–350)
- Executors: `monk/flurry-of-blows-executor.ts`, `bard/bardic-inspiration-executor.ts`, `rogue/cunning-action-executor.ts`, `fighter/action-surge-executor.ts`
- Task context: Items will declare `useCost: 'action' | 'bonus' | 'free' | 'none'` + equip cost; the item-use path must charge the right economy slot.

## Current State

### Domain-layer economy (`action-economy.ts`)
Two parallel state shapes coexist:

**Domain type `ActionEconomy`** (immutable, authoritative during a Combat "tick"):
```ts
{ actionAvailable, bonusActionAvailable, reactionAvailable,
  movementRemainingFeet, actionsUsed: SpecificActionType[] }
```
Helpers: `freshActionEconomy(speed)`, `canSpend{Action|BonusAction|Reaction|Movement}()`, immutable `with{Action|BonusAction|Reaction|Movement}Spent()`. Legacy mutable `spend*()` helpers are `@deprecated`. **There is NO `hasFreeObjectInteraction` field in the domain type.**

**Persisted "resources" bag** (`JsonValue` on `CombatantStateRecord.resources`): the on-the-wire truth between turns. Flags used by helpers/handlers:
- `actionSpent`, `bonusActionUsed`, `reactionUsed`
- `movementRemaining`, `movementSpent`, `dashed`, `disengaged`
- `attacksUsedThisTurn`, `attacksAllowedThisTurn`
- Per-turn class flags: `sneakAttackUsedThisTurn`, `stunningStrikeUsedThisTurn`, `rageAttackedThisTurn`, `rageDamageTakenThisTurn`, `elementalAffinityUsedThisTurn`, `colossusSlayerUsedThisTurn`, `cleaveUsedThisTurn`, `nickUsedThisTurn`, `loadingWeaponFiredThisTurn`, `bonusActionSpellCastThisTurn`, `actionSpellCastThisTurn`
- **`objectInteractionUsed`** (see §2)
- `readiedAction` (cleared at start of next turn)

### Resource-utils helpers (`resource-utils.ts`)
Turn-flag shape is edited via named helpers, not the domain `ActionEconomy`:
- `hasSpentAction`, `clearActionSpent`
- `hasBonusActionAvailable(resources)` → `readBoolean(r, "bonusActionUsed") !== true`
- `useBonusAction(resources)` → spreads `{ ...r, bonusActionUsed: true }`
- `resetReaction`, `hasDisengaged`, `markDisengaged`, `clearDisengage`
- **`resetTurnResources(resources)`** — single giant reset returning a new object with all turn-scoped flags zeroed (lines 185–225). **Does NOT currently reset `objectInteractionUsed`.** That reset is handled in the hydration path (see below).

## 2. `objectInteractionUsed` — already exists

Yes. The "free Object Interaction (1/turn)" concept is already implemented as a `resources.objectInteractionUsed: boolean` flag. Findings:

| Location | Role |
|---|---|
| `combat-hydration.ts:162` | `extractActionEconomy()` resets it to `false` when the domain economy is fresh; otherwise preserves it. This is the **only reset site** — `resetTurnResources()` does not touch it. |
| `interaction-handlers.ts:99,129,143,323,342` | Pickup, Draw Weapon, Utilize-action handlers read via `readBoolean(resources, "objectInteractionUsed")` and write `{ objectInteractionUsed: true }` on consume. If already true, they fall back to spending the Utilize action (full Action). |
| `hydration-types.ts:92` | Typed on the resources record alongside `bonusActionUsed?`. |
| `RuleBookDocs/markdown/playing-the-game.md:541` | Matches 5e 2024 rule: "one free interaction per turn." |

Implementation pattern — read/write:
```ts
const objectInteractionUsed = readBoolean(resources, "objectInteractionUsed") ?? false;
if (objectInteractionUsed) throw new ValidationError("...Utilize action...");
await combatRepo.updateCombatantState(id, { resources: { ...resources, objectInteractionUsed: true } });
```

**Gap:** `resetTurnResources()` does not include `objectInteractionUsed`. Reset relies solely on `extractActionEconomy()` running in `processIncomingCombatantEffects()` on turn advance (combat-service.ts ~line 726). Any path that calls `resetTurnResources` directly would skip it.

## 3. Bonus-action consumption pattern — concrete example

**Bardic Inspiration** (`bard/bardic-inspiration-executor.ts:47–68`) is the clearest direct-consume pattern:

```ts
if (!hasBonusActionAvailable(resources)) {
  return { success: false, summary: "No bonus action available (...)", error: "NO_BONUS_ACTION" };
}
if (!hasResourceAvailable(resources, "bardicInspiration", 1)) { return {...}; }

let updatedResources = spendResourceFromPool(resources, "bardicInspiration", 1);
updatedResources = useBonusAction(updatedResources);   // ← sets bonusActionUsed: true
```

**Two flavors** across the codebase:
1. **Executor consumes directly** via `useBonusAction()` — Bardic Inspiration, Rage, etc. (they return updated resources to the caller which persists).
2. **Caller consumes on the executor's behalf** — `class-ability-handlers.ts:857` spreads `{ ...(skipBonusActionCost ? {} : { bonusActionUsed: true }) }` around the executor result. Flurry of Blows, Patient Defense, Cunning Action ride this path; the executors themselves don't call `useBonusAction`. `action-service.ts:120` does the same for the programmatic path (`updatedResources = { ...actorResources, bonusActionUsed: true }` when `skipActionCheck` is set).

Both flavors converge on the same `resources.bonusActionUsed = true` flag.

## 4. Turn reset — start vs. end

The end-of-turn call is `combat.endTurn()` (domain) in `advanceTurnOrder` (combat-service.ts:652). The persisted-flag reset for the **incoming** combatant happens in `processIncomingCombatantEffects` (line 726) via:

```ts
const resources = extractActionEconomy(combat, creatureId, record.resources);
await this.combat.updateCombatantState(creatureId, { resources });
```

`extractActionEconomy` (combat-hydration.ts:124) detects `isFreshEconomy = actionAvailable && bonusActionAvailable && reactionAvailable` and, when true, zeros every turn-scoped flag (including `objectInteractionUsed`). So:

- **Domain economy** resets inside `combat.endTurn()`/`startTurn` for the new creature.
- **Persisted resources bag** resets at **start of incoming turn** via `processIncomingCombatantEffects` for **every** creature in initiative order (the `Promise.all(order.map(...))` loop).
- `resetTurnResources()` in resource-utils is a separate path used by a few call sites; it is **not** the primary turn-boundary reset.

## 5. "Free action" concept today

There is no first-class `'free'` action type. The closest concept is **"does not consume action economy"**, realized by:

- **Action Surge** (`fighter/action-surge-executor.ts:52–66`): spends a resource-pool use (`spendResourceFromPool(r, 'actionSurge', 1)`) and calls `grantAdditionalAction(...)` to bump `attacksAllowedThisTurn`. It **does not** call `useBonusAction`, does not set `actionSpent`, and is routed through `handleClassAbility()` (not `handleBonusAbility()`). Effectively "free" because it bypasses both action slots.
- **Dropping an item** (`interaction-handlers.ts:165` comment): "Dropping an item costs no action at all (not even a free interaction)." Implemented by simply not touching any flag.

There is no `'none'`/`'free'` enum anywhere in `ActionType` or `SpecificActionType`. `ActionType = "Action" | "BonusAction" | "Reaction" | "Movement"`.

## Constraints & Invariants
1. **Dual state**: any new cost field must be honored in BOTH the domain `ActionEconomy` path AND the persisted `resources` bag. The hydration round-trip (`extractActionEconomy` ↔ `parseActionEconomy`) must preserve it.
2. **Reset site is `extractActionEconomy`**, not `resetTurnResources`. Any new per-turn flag added should be zeroed there (see `objectInteractionUsed:162` as the template).
3. **Consumption idiom is `{ ...resources, <flag>: true }`**. Always spread; never mutate.
4. **Two consume paths**: executor-internal (`useBonusAction`) and caller-applied (`class-ability-handlers` / `action-service`). Mixing them causes double-spend — pick one per ability.
5. **Action Surge precedent**: "free-ish" abilities work by spending a pool + tweaking counters, not by introducing a new action type.

## Where `hasFreeObjectInteraction` would live
It already exists as `resources.objectInteractionUsed` (inverted-sense boolean: `true` = spent). No need to add a new flag for item-use action cost — reuse it when `useCost: 'free'` is declared, following the exact pattern at `interaction-handlers.ts:99–129`.

For `useCost: 'bonus'` → call `useBonusAction(resources)` + gate on `hasBonusActionAvailable(resources)`.
For `useCost: 'action'` → spread `{ ...resources, actionSpent: true }` + gate on `!hasSpentAction(resources)`.
For `useCost: 'none'` → touch nothing (drop-item precedent).

## Risks
1. **`resetTurnResources` blind spot**: it doesn't reset `objectInteractionUsed`. If item-use ever runs through a code path that reset-by-`resetTurnResources` instead of hydration, free-use items would desync. Mitigation: add `objectInteractionUsed: false` to `resetTurnResources` for defense-in-depth.
2. **Double-spend on equip+use**: if `equipCost: 'free'` and `useCost: 'free'` both read the same `objectInteractionUsed` flag, a single combined step (draw-and-drink) needs a single spend, not two.
3. **Bonus action spell gate**: `bonusActionSpellCastThisTurn` restricts same-turn spell casts. A bonus-action potion does NOT trigger that gate, but be careful not to conflate the two flags.

## Recommendations
1. Reuse `objectInteractionUsed` for `useCost: 'free'` — do not introduce a parallel flag.
2. Use `useBonusAction(resources)` + `hasBonusActionAvailable()` for `useCost: 'bonus'`; pick a single consume-site (executor-internal preferred for the new item-use path — simpler than piggy-backing on `class-ability-handlers`).
3. For `useCost: 'action'`, check `!hasSpentAction(resources)` and set `actionSpent: true` via spread.
4. Consider adding `objectInteractionUsed: false` to `resetTurnResources()` to close the reset-path gap.
5. Do **not** extend `ActionType` with `'Free'` / `'None'`. Keep the cost enum at the item/use-site layer only; the economy flags stay as-is.
