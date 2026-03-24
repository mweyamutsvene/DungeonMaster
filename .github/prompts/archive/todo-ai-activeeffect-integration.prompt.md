# TODO: Wire ActiveEffect system into AI Attack Path

## Problem

The AI monster attack path (`AiActionExecutor.executeAttack()` in `ai-action-executor.ts`) bypasses the `ActiveEffect` system entirely. When AI-controlled monsters attack, they do NOT check:

1. **Advantage/Disadvantage from ActiveEffects** — e.g., Dodge (disadvantage on attacks against dodger), Bane (-1d4 on attack rolls)
2. **AC bonuses from ActiveEffects** — e.g., Shield of Faith (+2 AC), Haste (+2 AC)
3. **Attack bonuses from ActiveEffects** — e.g., Bless (+1d4 on attack rolls on attacker)
4. **Extra damage from ActiveEffects** — e.g., Hunter's Mark (+1d6 damage)
5. **Damage defense from ActiveEffects** — e.g., Resist Elements (resistance to fire)

## Root Cause

The AI attack path has two sub-paths:
- **Path A (Two-Phase)**: Rolls its own `d20()`, gets AC from `getCombatStats().armorClass`, resolves damage inline
- **Path B (ActionService.attack)**: Builds `AttackSpec` from stat block, calls `resolveAttack()` domain function

Neither path calls `getActiveEffects()` or any of the effect resolution functions.

**Contrast**: The tabletop flow (`action-dispatcher.ts` → `roll-state-machine.ts`) fully processes ActiveEffects for advantage/disadvantage, AC bonuses, attack bonuses, extra damage, and damage defense.

## Fix Approach

Wire `getActiveEffects()` + effect resolution functions into both AI attack sub-paths:

### Path A (Two-Phase in `ai-action-executor.ts`)
1. After getting `targetAC = getCombatStats().armorClass`:
   - Load target's `activeEffects` from combatant resources
   - Add `calculateFlatBonusFromEffects(targetEffects, 'armor_class')` to AC
2. Before rolling d20:
   - Load attacker's and target's active effects
   - Check `hasAdvantageFromEffects(attackerEffects, 'attack_rolls')`
   - Check `hasDisadvantageFromEffects(attackerEffects, 'attack_rolls')`
   - Check target effects with `targetCombatantId` for attacks against them
   - Roll 2d20 when advantage/disadvantage applies
3. On hit, when computing damage:
   - Add bonus damage from effects (extra dice, flat bonus)
   - Apply damage defense from effects (resistance/immunity/vulnerability)

### Path B (ActionService.attack)
1. Add AC bonus from effects to `targetAC`
2. Set `spec.mode` based on effect advantage/disadvantage
3. Add bonus damage from effects after `resolveAttack()`

## Impact

Currently, all buff/debuff spells (Bless, Bane, Shield of Faith, Dodge, etc.) only affect player-side attack resolution. Monster AI attacks ignore all ActiveEffects. This makes defensive buffs less effective than intended.

## Priority

High — This is core combat correctness. Defensive spells like Shield of Faith and Dodge should affect monster attacks.

## Files Modified
- `packages/game-server/src/application/services/combat/ai/ai-action-executor.ts`
- `packages/game-server/src/application/services/combat/action-service.ts` (Path B)
- `packages/game-server/src/application/services/combat/two-phase-action-service.ts` (Opportunity attacks)

---

## Status: COMPLETE

### Implementation Notes

**Research findings**: The initial analysis in this TODO was partially inaccurate. Both the AI two-phase path and ActionService.attack already had full ActiveEffect integration for advantage/disadvantage, attack bonus, AC bonus, extra damage, and damage defense. The actual gaps were:

| Path | Adv/Disadv | Atk Bonus | AC Bonus | Extra Dmg | Dmg Defense | Retaliatory |
|---|---|---|---|---|---|---|
| RollStateMachine (tabletop) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| AiActionExecutor (two-phase) | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ → ✅ |
| ActionService.attack (fallback) | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ → ✅ |
| OA in completeMove | ❌ → ✅ | ❌ → ✅ | ❌ → ✅ | ❌ → ✅ | ❌ → ✅ | ❌ → ✅ |

### Changes Made

1. **`ai-action-executor.ts`** — Added retaliatory damage check after melee hit damage application. Uses `targetActiveEffects` already in scope, rolls retaliatory damage dice via `this.diceRoller`, applies to AI attacker with KO handling.

2. **`action-service.ts`** — Added retaliatory damage check after damage application and KO handling, before `spendAction`. Uses `targetActiveEffects` and `diceRoller` already in scope.

3. **`two-phase-action-service.ts`** — Complete rewrite of monster OA auto-roll block:
   - Replaced `Math.random()` with deterministic `SeededDiceRoller` (seeded from encounter state)
   - Uses actual `proficiencyBonus` from `getCombatStats()` instead of hardcoded `2`
   - Added advantage/disadvantage from ActiveEffects + conditions via `deriveRollModeFromConditions()`
   - Added attack bonus from ActiveEffects (Bless dice, etc.)
   - Added AC bonus from target's ActiveEffects (Shield of Faith, etc.)
   - Uses monster's actual melee attack data (dice, damage type) when available, falls back to 1d8 + ability mod
   - Added extra damage from ActiveEffects (Rage, Hunter's Mark, etc.)
   - Added damage defense from ActiveEffects (resistance, immunity, vulnerability)
   - Added retaliatory damage after OA hit

### Validation
- Typecheck: Clean
- Unit tests: 458 passed (0 failed)
- E2E scenarios: 118 passed (0 failed)
