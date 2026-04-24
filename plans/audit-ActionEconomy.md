---
type: sme-research
flow: ActionEconomy
feature: mechanics-audit-l1-5
author: claude-explore-action-economy
status: DRAFT
created: 2026-04-24
updated: 2026-04-24
---

## Scope

Turn-by-turn action economy for characters and monsters in combat (L1-5). Action/bonus/reaction spending, movement tracking, per-turn/per-round/per-encounter resets, class resource lifecycle integration.

## Currently Supported

### Core Framework
- `ActionEconomy` interface: action, bonus action, reaction, movement (feet).
- Immutable updaters: `withActionSpent()`, `withBonusActionSpent()`, `withReactionSpent()`, `withMovementSpent()`.
- `resetTurnResources()` clears 23+ turn-scoped fields at turn start (weapon mastery, sneak attack, stunning strike, rage flags, bonus action spell restriction, readied action).

### Turn/Round Lifecycle
- `Combat.endTurn()` (domain/combat/combat.ts:149–190): advances turn, wraps round at end of initiative, resets fresh `ActionEconomy`.
- `extractActionEconomy()` serializes to DB JSON; `parseActionEconomy()` hydrates.
- Effects cleanup (`shouldRemoveAtEndOfTurn()` / `shouldRemoveAtStartOfTurn()`) integrated into endTurn.
- Jump multiplier reset per-round (combat.ts:166–176).

### Multi-Attack Tracking
- `attacksUsedThisTurn` / `attacksAllowedThisTurn` in resources JSON.
- Extra Attack: `ClassFeatureResolver.getAttacksPerAction()` per class + level; `grantAdditionalAction()` resets `actionSpent`.
- Action Surge (Fighter L2): resets `actionSpent`, grants additional attacks, checks resource pool (short rest).
- Sneak Attack, Stunning Strike, Colossus Slayer, Elemental Affinity: one-per-turn flags in resources, reset via `resetTurnResources()`.

### Reactions
- `hasReactionAvailable()` / `useReaction()` / `resetReaction()` in resource-utils.
- Reaction reset at turn start via `resetTurnResources()`.
- Reaction-triggered pending actions (readied attacks, shield).

### Movement
- Base speed from creature; effective via `getEffectiveSpeed()` (ActiveEffect modifiers: bonus, penalty, multiplier).
- `movementRemainingFeet` decremented via `withMovementSpent()`.
- Difficult terrain + jump multiplier tracked in `MovementState`.

### Free Object Interaction (2024)
- `hasFreeObjectInteractionAvailable()` / `useFreeObjectInteraction()`.
- Resets each turn.

### Legendary Actions (Monsters)
- `legendaryActionsRemaining` / `legendaryActionCharges` tracked.
- `spendLegendaryAction()` decrements; `resetLegendaryActions()` at start of boss turn.
- `parseLegendaryTraits()` loads from stat block; defs copied at encounter start.
- `processIncomingCombatantEffects()` triggers reset for legendary.

### Bonus Action Spell Restrictions (2024)
- `bonusActionSpellCastThisTurn` / `actionSpellCastThisTurn` flags prevent action-slot + bonus-slot spell in same turn.

### Ready Action (2024)
- `readiedAction` persisted; cleared at start of next turn.
- Trigger detection via `readied-attack-trigger.ts`.
- Reaction must be available to ready (no separate reaction for ready itself).

### Class Resource Pools
- Fighter: `actionSurge` (SR, 1 use L2-16, 2 uses L17+), `secondWind` (SR, 1), `indomitable` (LR, 1-3 by tier).
- Barbarian: `rage` (per-day, infinite L20), LR reset; `raging` flag + turn flags (`rageAttackedThisTurn`, `rageDamageTakenThisTurn`); end-condition checked at turn start.
- Monk: `ki` (max = level, L2+), SR reset; `uncanny_metabolism` (L2+, 1/LR), `wholeness_of_body` (L6+ Open Hand).
- Sorcerer: `sorceryPoints`.
- Cleric/Druid: `channelDivinity` (once per SR).
- Bard: `bardic_inspiration` (charges, SR reset).

## Needs Rework

1. **Domain ↔ Application layer coupling.** `ActionEconomy` lives in `domain/entities/combat/` but hydration/extraction in application layer. `Combat.endTurn()` manually resets with `freshActionEconomy()` instead of calling `resetTurnResources()` utility. Drift risk.
2. **Per-round reset semantics scattered.** Jump multiplier per-round; weapon mastery flags per-turn. `loadingWeaponFiredThisTurn` unclear timing.
3. **Disengage/Dash enforcement missing.** `markDisengaged()` / `clearDisengage()` exist in resource-utils but never called during action execution. `dashed` flag reset in `resetTurnResources()` but never set during Dash handler. Movement handlers don't check disengage before imposing OAs.
4. **Reaction mid-round lifecycle ambiguous.** Reaction resets at turn start, but 2024 allows reaction outside your turn. No guard preventing use after spent on interrupt. No `reactionSpentThisRound` vs `reactionAvailableThisTurn` distinction.
5. **Monk Flurry of Blows economy incomplete.** Doesn't check `bonusActionUsed` or `bonusActionSpellCastThisTurn` before allowing.
6. **Multiattack vs Extra Attack semantic gap.** `grantAdditionalAction()` increments `attacksAllowedThisTurn` but assumes Extra Attack (PC). AI multiattack doesn't populate for monsters from stat block.
7. **Ready action trigger validation weak.** If `readiedAction` stored, reaction flag should be spent; invariant not checked.
8. **Lair actions parsed, not triggered.** `parseLegendaryTraits()` loads `lairActions` from stat block; `isInLair` set but no trigger at initiative count 20. No lair action charge tracking.

## Missing — Required for L1-5

### P0
- **Difficult terrain cost audit per turn** — no validation of total terrain cost ≤ speed pool.
- **OA readiness per trigger** — detection works but doesn't prevent multiple OAs per trigger. 2024: "once per trigger."
- **Lair action trigger at initiative 20** — loaded but not wired.
- **Disengage/Dash action flags wired** — must mark creature to affect OA detection / speed.

### P1
- **Armor class recalculation timing** — doesn't refresh per turn; Barbarian Unarmored Defense CON/DEX change mid-turn not recomputed.
- **Ritual casting constraint** — no validator preventing ritual + action spell same turn.
- **Concentration check logging** — loss handled but not audited at turn boundaries.

### P2
- **`reactionSpentThisRound` flag** — for better reaction accounting.
- **Flurry of Blows bonus-action validation**.

## Cross-Flow Dependencies

- **Effects ← ActionEconomy**: Effects module cleanup in `Combat.endTurn()`; speed modifiers.
- **Classes ← ActionEconomy**: `ClassFeatureResolver` drives extra attacks; resource limits from class defs.
- **PendingActions ↔ ActionEconomy**: Ready state tied to reaction spending.
- **Reactions ← ActionEconomy**: Attack/spell reaction handlers check reaction availability.
- **Damage ← ActionEconomy**: Damage handlers write turn-scoped flags (rage, sneak attack).

## Summary

**Status: Core framework functional; gaps in integration and 2024 nuance.**

**Working:** Fresh action economy per turn, multi-attack tracking (Extra Attack + Action Surge), legendary action charges, bonus action spell restrictions, free object interaction, ready action lifecycle.

**Critical gaps:**
1. Domain reset duplicated with application reset — drift risk.
2. Disengage/Dash flags not enforced.
3. Bonus action Flurry lacks economy guards.
4. Reaction mid-round lifecycle ambiguous.
5. Difficult terrain cost not audited per action.
6. Lair actions parsed but not triggered.
