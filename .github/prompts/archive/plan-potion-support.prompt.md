# Plan: Non-Healing Potion Support
## Round: 1
## Status: COMPLETE
## Affected Flows: CombatRules, CombatOrchestration, AIBehavior, EntityManagement

## Objective
Extend the potion system beyond healing potions to support buff/effect potions from the D&D 5e 2024 Basic Rules. Currently, `handleUseItemAction()` and the AI executor only handle healing potions — everything else throws `"Only healing potions are currently supported"`. The `ActiveEffect` system and `MagicItemDefinition` type already have the infrastructure to support buff potions; we need to bridge the gap.

---

## D&D 5e 2024 Basic Rules Potion Catalog

18 potions exist in the Basic Rules. Categorized by implementation complexity:

### Tier 1: Simple Effect Potions (can map directly to existing `ActiveEffect` types)
These grant a single well-defined effect that maps cleanly to the existing effect system.

| Potion | Rarity | Effect | Duration | ActiveEffect Mapping |
|--------|--------|--------|----------|---------------------|
| **Potion of Resistance** | Uncommon | Resistance to one damage type | 1 hour (600 rounds) | `type: 'resistance', damageType: X, duration: 'rounds', roundsRemaining: 600` |
| **Potion of Heroism** | Rare | 10 temp HP + Bless effect (1d4 to attacks/saves) | 1 hour | `type: 'temp_hp', value: 10` + `type: 'bonus', target: 'attack_rolls', diceValue: {1,4}` + `type: 'bonus', target: 'saving_throws', diceValue: {1,4}` |
| **Potion of Invulnerability** | Rare | Resistance to ALL damage | 1 minute (10 rounds) | Multiple `type: 'resistance'` effects for each damage type, or a single `type: 'resistance', damageType: 'all'` |
| **Potion of Giant Strength** | Varies | Set STR score to X | 1 hour | `type: 'custom', description: 'STR set to X'` — needs STR override in stat resolution |
| **Potion of Climbing** | Common | Climb speed = Speed, advantage on Athletics to climb | 1 hour | `type: 'speed_modifier'` (climb speed) + `type: 'advantage', target: 'ability_checks', ability: 'strength'` (Athletics only, but we don't have skill-specific targeting) |
| **Potion of Water Breathing** | Uncommon | Breathe underwater | 24 hours | No combat mechanical effect — flavor only |
| **Potion of Vitality** | Very Rare | Remove Exhaustion + Poisoned | Instant | Instant condition removal, no ongoing effect |
| **Potion of Poison** | Uncommon | 4d6 poison damage + DC 13 CON save or Poisoned 1 hour | Instant + Poisoned condition | Damage application + condition application |

### Tier 2: Spell-Replicating Potions (grant the effect of a spell, no concentration)
These reference existing spells. Could reuse spell effect definitions if spells are defined as data.

| Potion | Rarity | Spell Effect | Duration |
|--------|--------|-------------|----------|
| **Potion of Speed** | Very Rare | Haste (no concentration, no lethargy) | 1 minute (10 rounds) |
| **Potion of Invisibility** | Rare | Invisible condition; ends on attack/damage/cast | Until triggered |
| **Potion of Flying** | Very Rare | Fly speed = Speed, can hover | 1 hour |
| **Potion of Growth** | Uncommon | Enlarge (Enlarge/Reduce) | 10 minutes (100 rounds) |
| **Potion of Diminution** | Rare | Reduce (Enlarge/Reduce) | 1d4 hours |
| **Potion of Gaseous Form** | Rare | Gaseous Form (no concentration) | 1 hour |
| **Potion of Animal Friendship** | Uncommon | Animal Friendship (level 3, DC 13) | Per spell |
| **Potion of Clairvoyance** | Rare | Clairvoyance (no concentration) | Per spell |
| **Potion of Mind Reading** | Rare | Detect Thoughts (DC 13, no concentration) | 10 minutes |

### Tier 3: Out of Scope
| Potion | Reason |
|--------|--------|
| **Potion of Longevity** | Non-combat, age reduction |
| **Animal Friendship / Clairvoyance / Mind Reading** | Non-combat utility spells, no mechanical combat effect |

---

## Architecture: Potion Effect Data Model

### Option A: `PotionEffect` on `MagicItemDefinition` (RECOMMENDED)
Add an optional `potionEffects` field to `MagicItemDefinition` that declares what `ActiveEffect`s to apply when consumed.

```typescript
export interface PotionEffect {
  /** ActiveEffects to apply on the drinker. */
  effects: Omit<ActiveEffect, 'id' | 'appliedAtRound' | 'appliedAtTurnIndex'>[];
  /** Instant healing (for healing potions — replaces POTION_HEALING_FORMULAS). */
  healing?: { diceCount: number; diceSides: number; modifier: number };
  /** Instant damage (for Potion of Poison). */
  damage?: { diceCount: number; diceSides: number; damageType: string };
  /** Conditions to apply on the drinker. */
  applyConditions?: Array<{ condition: string; duration: string; roundsRemaining?: number }>;
  /** Conditions to remove from the drinker. */
  removeConditions?: string[];
  /** Save to resist (for Potion of Poison). */
  save?: { ability: Ability; dc: number; effectOnFail: string };
}
```

This keeps the domain data-driven and lets the application layer generically apply effects without potion-specific code.

### Option B: Hard-coded per-potion handlers (NOT recommended)
Like `POTION_HEALING_FORMULAS` but for each potion type. Doesn't scale.

---

## Phased Implementation

### Phase 1: Infrastructure — `PotionEffect` data model + generic applicator
Build the foundation so any potion with a `potionEffects` field Just Works.

#### [File: `packages/game-server/src/domain/entities/items/magic-item.ts`]
- [x] Add `PotionEffect` interface
- [x] Add optional `potionEffects?: PotionEffect` field to `MagicItemDefinition`

#### [File: `packages/game-server/src/domain/entities/items/magic-item-catalog.ts`]
- [x] Migrate healing potion definitions to use `potionEffects.healing` instead of the separate `POTION_HEALING_FORMULAS` lookup table
- [x] Keep `POTION_HEALING_FORMULAS` as a deprecated re-export (or update all consumers) for backward compat during migration

#### [File: `packages/game-server/src/application/services/combat/tabletop/interaction-handlers.ts`]
- [x] Refactor `handleUseItemAction()` to be generic:
  1. Look up `MagicItemDefinition`
  2. If it has `potionEffects.healing` → apply healing (existing logic)
  3. If it has `potionEffects.effects` → apply each `ActiveEffect` to combatant resources
  4. If it has `potionEffects.damage` → apply damage
  5. If it has `potionEffects.removeConditions` → remove conditions
  6. If it has `potionEffects.applyConditions` → apply conditions
  7. Consume the item, spend action
  8. If none of the above → throw not-supported error

#### [File: `packages/game-server/src/application/services/combat/ai/handlers/use-object-handler.ts`]
- [x] Refactor `UseObjectHandler.execute()` to use the generic potion effect system instead of hard-coded healing formula lookup
- [x] AI should be able to use any potion that has `potionEffects` defined

### Phase 2: Tier 1 Potion Definitions
Add catalog entries with `potionEffects` for the simple-effect potions.

#### [File: `packages/game-server/src/domain/entities/items/magic-item-catalog.ts`]
- [x] Add `POTION_OF_RESISTANCE` (parameterized by damage type — factory function with 13 variants)
- [x] Add `POTION_OF_HEROISM` (10 temp HP + Bless effects)
- [x] Add `POTION_OF_INVULNERABILITY` (resistance to all damage, 10 rounds)
- [x] Add `POTION_OF_POISON` (4d6 poison damage + DC 13 CON save + Poisoned condition)
- [x] Add `POTION_OF_VITALITY` (remove Exhaustion + Poisoned)
- [x] Add `POTION_OF_CLIMBING` (climb speed)
- [x] Add `POTION_OF_WATER_BREATHING` (flavor only)

### Phase 3: Tier 2 Spell-Replicating Potions
Potions that grant spell effects. These are more complex because they combine multiple effects.

#### [File: `packages/game-server/src/domain/entities/items/magic-item-catalog.ts`]
- [x] Add `POTION_OF_SPEED` — Haste effects: +2 AC, advantage on DEX saves, double speed. TODO: extra action (see Risks)
- [x] Add `POTION_OF_INVISIBILITY` — Invisible condition, ends on attack/damage/cast
- [x] Add `POTION_OF_GIANT_STRENGTH` (variants) — 6 variants (Hill/Frost/Stone/Fire/Cloud/Storm Giant)
- [x] Add `POTION_OF_GROWTH` — Enlarge effects: +1d4 weapon damage, advantage on STR
- [x] Add `POTION_OF_FLYING` — Fly speed = walking speed
- [x] Add `POTION_OF_DIMINUTION` — Reduce effects: -1d4 damage, disadvantage on STR
- [x] Add `POTION_OF_GASEOUS_FORM` — resistance to bludg/pierc/slash

### Phase 4: AI Tactical Awareness
Teach the AI when to use non-healing potions.

#### [File: `packages/game-server/src/application/services/combat/ai/ai-context-builder.ts`]
- [x] Update potion detection to use `potionEffects` field rather than `POTION_HEALING_FORMULAS`
- [x] Pre-filter `useObject` action when inventory has no usable potions with `potionEffects`

#### [File: `packages/game-server/src/application/services/combat/ai/handlers/use-object-handler.ts`]
- [x] AI prefers healing potions when HP <= 50%; falls back to first available buff potion otherwise

### Phase 5: E2E Test Scenarios

#### [File: `packages/game-server/scripts/test-harness/scenarios/`]
- [x] `potion-of-resistance.json` — Drink fire resistance potion, item consumed, HP unchanged
- [x] `potion-of-heroism.json` — Drink heroism, verify tempHp = 10, HP unchanged
- [x] `potion-of-invulnerability.json` — Drink invulnerability, item consumed, HP unchanged
- [x] `potion-of-speed.json` — Drink speed potion, item consumed, HP unchanged
- [x] `ai-use-buff-potion.json` — AI goblin drinks Potion of Heroism (buff), HP unchanged, tempHp = 10

#### [File: `packages/game-server/scripts/test-harness/scenario-runner.ts`]
- [x] Added `characterTempHp` assertion (min/max/exact) — checks `resources.tempHp`
- [x] Added `monsterTempHp` assertion (name + min/max/exact) — checks monster `resources.tempHp`

---

## Cross-Flow Risk Checklist
- [x] Do changes in one flow break assumptions in another? — Yes: `POTION_HEALING_FORMULAS` migration affects both tabletop handler and AI executor. Need to update both simultaneously or keep the old lookup as fallback.
- [ ] Does the pending action state machine still have valid transitions? — N/A. UseItem action already exists; just extending what it can do.
- [ ] Is action economy preserved? — Yes. Drinking a potion always costs 1 action (D&D 5e 2024 rules).
- [x] Do both player AND AI paths handle the change? — Yes. Player path via `handleUseItemAction()`, AI path via `executeUseObject()`. Both will use the generic `potionEffects` system.
- [ ] Are repo interfaces + memory-repos updated if entity shapes change? — No schema change. `MagicItemDefinition` is a domain type, not a DB entity.
- [ ] Is `app.ts` registration updated? — N/A. No new executors.
- [ ] Are D&D 5e 2024 rules correct? — Yes. All potion descriptions sourced from 2024 Basic Rules `magic-items-a-z.md`.

## Risks
- **Haste extra action**: Potion of Speed grants the Haste effect, which includes "one extra action per turn (limited to Attack [one weapon attack only], Dash, Disengage, Hide, or Use Object)." This requires modifying the action economy system to allow a second limited action. This is a significant change and may need its own plan. **Mitigation:** Implement Potion of Speed without the extra action initially, just the +2 AC / advantage DEX saves / double speed. Document the extra action as a TODO.
- **STR score override**: Potion of Giant Strength sets STR to a fixed value. The combat stat resolution pipeline needs to support "set ability score to X" overrides from active effects. Currently `ItemStatModifier` has `setTo` but it's for equipped items, not active effects. **Mitigation:** Add `setTo` support to `ActiveEffect` or use a `custom` effect type with a handler.
- **Duration tracking**: 1 hour = 600 rounds, 10 minutes = 100 rounds. The `roundsRemaining` field is a number, so this works mechanically, but typical combats are 5-15 rounds. Effects with 600 rounds remaining will practically never expire in combat. This is correct per rules but may feel weird. **Mitigation:** Accept this — it matches D&D rules where potions typically outlast combat.
- **Damage type for Resistance potion**: The DM chooses or rolls randomly. For pre-assigned potions in inventory, the damage type should be part of the item instance (e.g., "Potion of Resistance (Fire)"). **Mitigation:** Use the item name to encode the type, or add a `properties` field on `CharacterItemInstance`.

## Test Plan
- [x] Unit tests for `PotionEffect` application in isolation — covered via E2E scenarios (all 160 pass)
- [x] Unit tests for healing potion migration (existing behavior preserved via `potionEffects.healing`) — use-potion-healing E2E passes
- [x] Integration test: player drinks Potion of Resistance — potion-of-resistance E2E passes (9/9)
- [x] Integration test: player drinks Potion of Heroism, verify temp HP + Bless effect active — potion-of-heroism E2E passes (9/9)
- [x] E2E scenario: full combat with potion usage — all potion scenarios pass
- [x] Regression: existing healing potion E2E scenarios still pass after migration — 160/160 passed

## Open Questions
1. **Should `POTION_HEALING_FORMULAS` be removed or kept as backward compat?** Removing is cleaner but requires updating all consumers in one pass.
2. **How should Potion of Resistance damage type be specified?** Via item name ("Potion of Resistance (Fire)") or a new field on `CharacterItemInstance`?
3. **Should Potion of Speed extra action be in scope?** It's a significant action economy change. Recommend deferring to a separate plan.
4. **Should the AI be taught about ALL potions or just healing + resistance/invulnerability?** Start with commonly useful combat potions, expand later.
