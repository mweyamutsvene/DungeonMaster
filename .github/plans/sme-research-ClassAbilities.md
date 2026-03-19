# SME Research — ClassAbilities — Barbarian Phase 8.1

## Current State of Barbarian Domain

### `barbarian.ts` — What Exists
- **RageState interface** + `createRageState(level)` — rage resource pool factory
- `startRage()`, `endRage()`, `resetRageOnLongRest()` — state transition helpers
- `rageUsesForLevel(level)` — 2/3/4/5/6 uses by level bracket
- `rageDamageBonusForLevel(level)` — +2/+3/+4 by level bracket
- **BARBARIAN_COMBAT_TEXT_PROFILE** — 2 action mappings:
  - `rage` → `class:barbarian:rage` (bonusAction)
  - `reckless-attack` → `class:barbarian:reckless-attack` (classAction)
  - `attackEnhancements: []` — empty
- **Barbarian ClassDefinition** — `hitDie: 12`, saving throws: STR/CON, `resourcesAtLevel` returns `[createRageState(level).pool]`
- **Missing**: No `capabilitiesForLevel` method. The Barbarian is one of very few classes without it (Fighter, Monk, Rogue all have one).
- **Missing**: No Unarmored Defense, Danger Sense, Feral Instinct, Extra Attack, or Rage-end helpers.

### Existing Executors (2)

#### `rage-executor.ts`
- **Already grants B/P/S resistance** via ActiveEffect system: creates 3 `resistance` effects with `damageType: "bludgeoning"/"piercing"/"slashing"` and `source: "Rage"`.
- Also creates a `melee_damage_rolls` bonus effect (+2/+3/+4) and a `saving_throws` advantage effect for STR.
- Sets `raging: true` flag on resources.
- **Task spec Feature #1 (Rage damage resistance) is ALREADY IMPLEMENTED.** The rage executor creates the resistance effects, and `roll-state-machine.ts:1613-1636` already reads `getActiveEffects()` → `getDamageDefenseEffects()` to merge resistance into `applyDamageDefenses()` call. This code path is class-agnostic and handles Rage-sourced resistance correctly.

#### `reckless-attack-executor.ts`
- Creates 2 ActiveEffects: self advantage on melee attacks (`until_end_of_turn`), incoming attack advantage (`until_start_of_next_turn`).
- Validates via `ClassFeatureResolver.hasRecklessAttack()`.
- No resource cost (free action).

### Registry & Registration
- `registry.ts`: `BARBARIAN_COMBAT_TEXT_PROFILE` is in `COMBAT_TEXT_PROFILES` array ✓
- `class-resources.ts`: Barbarian case returns `[createRageState(level).pool]` ✓
- `app.ts`: Both `RageExecutor` and `RecklessAttackExecutor` registered ✓
- `class-feature-resolver.ts`: Has `isBarbarian()`, `hasRage()`, `hasRecklessAttack()`, and Barbarian is included in `hasMartialExtraAttack()` ✓

---

## Feature-by-Feature Analysis

### Feature 1: Rage Damage Resistance — **ALREADY DONE**

**Finding**: The `RageExecutor` already creates `createEffect(nanoid(), "resistance", "custom", "permanent", { damageType: "bludgeoning", source: "Rage" })` (and piercing/slashing). The `roll-state-machine.ts` damage handler at line ~1613 reads ActiveEffect resistance via `getDamageDefenseEffects()` and merges it into the `applyDamageDefenses()` call. Similarly, `ai-action-executor.ts:627-647` does the same for AI turns, and `two-phase-action-service.ts:692-707` handles it for opportunity attack damage.

**Recommendation**: No changes needed. May want an E2E scenario to verify end-to-end, but the code is already wired.

---

### Feature 2: Unarmored Defense (AC = 10 + DEX + CON)

**Current AC resolution**:
- `Creature.getAC()` (`creature.ts:101-127`): If no equipment armor/shield, returns `this.armorClass` (the raw number from data). If armor equipped, calculates `base + DEX (capped)`. Shield bonus added if trained.
- `Character.getAC()` overrides only to add feat bonus (armorClassBonusWhileArmored).
- In the tabletop flow, `roll-state-machine.ts:1047` reads AC from `target.statBlock?.armorClass || target.sheet?.armorClass || 10`.
- AC is also read from `resources.armorClass` in some flows (`two-phase-action-service.ts:1232`).

**What needs to change in `barbarian.ts`** (domain):
- Add a pure function: `barbarianUnarmoredDefenseAC(dexMod: number, conMod: number): number` → `10 + dexMod + conMod`.
- Add to `capabilitiesForLevel` (display-only listing for Unarmored Defense).

**Where to apply it** (application):
- The character `sheet.armorClass` value is typically pre-computed by the character generator or stored on the character record. If the character sheet already has the correct AC (computed with CON), no runtime override is needed.
- **Risk**: If character sheets are generated via LLM without knowing Barbarian Unarmored Defense, the `armorClass` value on the sheet might be wrong. The proper fix is either:
  - (a) Compute it in the character generator when creating barbarian characters, OR
  - (b) Override at combat-time in `handleInitiativeRoll` or the AC resolution code.
- **For E2E scenarios**: The AC is set directly in the scenario JSON, so the test can just set the correct value.

**Recommendation**: 
1. Add the pure domain function to `barbarian.ts` for reference/reuse.
2. The **primary consumer** should be the character generation flow — ensure it picks the higher of (base AC with armor) vs (10 + DEX + CON) for unarmored barbarians.
3. No change needed in `roll-state-machine.ts` or `action-dispatcher.ts` — they consume the `armorClass` value from the sheet/statBlock, which should already be correct if the generator does its job.
4. If a runtime override is desired, it would go in `buildCombatResources()` or a new hook in `handleInitiativeRoll()` that computes and stores `armorClass` on the combatant resources.

---

### Feature 3: Danger Sense (Lv 2) — Advantage on DEX Saves

**Current saving throw system**:
- `SavingThrowResolver` (`saving-throw-resolver.ts:81+`) already checks `hasAdvantageFromEffects(targetEffects, 'saving_throws', saveAbility)` for ActiveEffect-based advantage.
- The Rage executor already uses this pattern: it adds an advantage effect on `saving_throws` with `ability: "strength"`.

**What needs to change**:

*Option A — ActiveEffect at Rage start*:
Add a Danger Sense DEX save advantage as a permanent ActiveEffect in the `RageExecutor`. But this is wrong — Danger Sense is independent of Rage. A level 2+ Barbarian has Danger Sense always, not just while raging.

*Option B — ActiveEffect at combat init*:
In `buildCombatResources()` or `handleInitiativeRoll()`, if the character is a Barbarian level 2+, add an ActiveEffect for DEX save advantage. This would be consumed by `SavingThrowResolver` automatically.

*Option C — Domain flag in resources*:
Add `dangerSense: true` to combatant resources and check it in `SavingThrowResolver`. But this breaks the ActiveEffect pattern.

**Recommendation**: Option B is the cleanest. At combat initialization, add a permanent ActiveEffect:
```typescript
createEffect(nanoid(), "advantage", "saving_throws", "permanent", {
  ability: "dexterity",
  source: "Danger Sense",
  description: "Advantage on DEX saving throws (Danger Sense)",
})
```
This could be initialized in `buildCombatResources()` or a new post-init hook. The `SavingThrowResolver` already handles ability-specific advantage filtering.

**Caveat (D&D 5e 2024)**: Danger Sense doesn't work if the Barbarian is Blinded, Deafened, or Incapacitated. This condition check would need to happen at save resolution time, not effect creation time. The `SavingThrowResolver` could be updated to skip the Danger Sense effect if those conditions are present, or the effect could have metadata (e.g., `disabledByConditions: ["blinded", "deafened", "incapacitated"]`).

**Domain change**: Add `hasDangerSense(level)` to `barbarian.ts` or to `ClassFeatureResolver`.

---

### Feature 4: Extra Attack (Lv 5)

**Current Extra Attack system**:
- `ClassFeatureResolver.hasMartialExtraAttack()` already includes `"barbarian"` in the martial class list.
- `ClassFeatureResolver.getAttacksPerAction()` returns 2 for any martial class at level 5+ (including barbarian).
- `action-dispatcher.ts:2333-2343` calls `getAttacksPerAction()` and sets `attacksAllowedThisTurn` on resources.

**Finding**: **Extra Attack already works for Barbarian.** The logic is class-agnostic — it checks `hasMartialExtraAttack()` which includes barbarian, and `getAttacksPerAction()` returns 2 for barbarian level 5+.

**Recommendation**: No code changes needed. Add it to `capabilitiesForLevel` for display. An E2E scenario could verify it, but the implementation is already complete.

---

### Feature 5: Rage End Mechanics

**Current state**: Rage effects are created as `"permanent"` duration ActiveEffects with `source: "Rage"`. There is no automatic mechanism to end rage. The domain has `endRage()` which just sets `active: false`, but nothing calls it during turn advancement.

**D&D 5e 2024 rules**: Rage ends if:
1. The Barbarian didn't attack a hostile or take damage since the start of their last turn.
2. The Barbarian falls unconscious.
3. The Barbarian chooses to end it (no action required).

**What needs to change**:

1. **Turn tracking**: Need to track whether the barbarian attacked or took damage during their turn. Options:
   - Add `rageAttackedThisTurn: boolean` and `rageTookDamageThisTurn: boolean` flags to resources.
   - At start of barbarian's turn, check if *neither* flag is true from the previous turn → end rage.
   - Reset flags when turn starts.

2. **Where to hook in**: The turn advancement logic in `combat-service.ts:415+` calls `resetTurnResources()`. A new hook could be added there:
   - At start of a barbarian's turn, before resetting, check if rage conditions are met.
   - If rage should end, remove all ActiveEffects with `source: "Rage"` and reset `raging: false`.

3. **Unconscious check**: When a character drops to 0 HP (already handled by `applyKoEffectsIfNeeded()`), if they have Rage active, end it immediately. This would be a new check in the KO handler.

4. **New domain functions in `barbarian.ts`**:
   - `shouldRageEnd(attackedThisTurn: boolean, tookDamageThisTurn: boolean, isUnconscious: boolean): boolean`
   
5. **New application-layer logic**: 
   - In `resetTurnResources()` or a new `processBarbarianRage()` helper called during turn advancement.
   - In the KO path (`applyKoEffectsIfNeeded` or similar).

**Complexity**: Medium. Requires changes in multiple layers (domain, resource utils, combat service).

**Risk**: The `resetTurnResources()` function currently knows nothing about class identity. Adding class-aware logic here would break its simplicity. Consider a separate `processTurnStartEffects()` pass that's class-aware, run after `resetTurnResources()`.

---

### Feature 6: Feral Instinct (Lv 7) — Advantage on Initiative Rolls

**Current initiative system**:
- Player character initiative: `handleInitiativeRoll()` in `roll-state-machine.ts:449+` takes a player-rolled value and adds DEX modifier + Alert feat bonus if applicable. No class-feature advantage is applied because the player rolls physically.
- NPC/monster auto-roll: `computeInitiativeRollMode()` at line 131 computes advantage/disadvantage from surprise + conditions. It does NOT check class features.
- Other characters (multi-PC): Also use `computeInitiativeRollMode()` for auto-rolling.

**What needs to change**:

For server-rolled characters (multi-PC, multi-character scenarios), `computeInitiativeRollMode()` needs to check if the creature is a Barbarian level 7+ and grant advantage. This requires passing class/level info to the function.

For the primary player character (who rolls manually), the server can't force advantage — but it should indicate to the CLI/client that this character has advantage on initiative and should roll 2d20 take highest. This would be communicated via the pending action's roll request.

**Domain changes**:
- Add `hasFeralInstinct(level: number): boolean` → `level >= 7` to `barbarian.ts`.
- Add to `ClassFeatureResolver`: `static hasFeralInstinct(sheet, className, level)`.

**Application changes**:
- Update `computeInitiativeRollMode()` to accept class info and check Feral Instinct.
- For player-rolled initiative, the `INITIATIVE` pending action could include `rollMode: "advantage"` or a `feralInstinct: true` flag.

**D&D 5e 2024 bonus**: Feral Instinct also says "you can't be surprised unless incapacitated." This would need a check in the surprise system (`isCreatureSurprised()`).

---

## Summary: What Needs to Change in `barbarian.ts`

| Item | Change Type | Details |
|------|-------------|---------|
| `capabilitiesForLevel()` | **New method** | Add to Barbarian ClassDefinition. Lists: Rage, Reckless Attack (2+), Unarmored Defense, Danger Sense (2+), Extra Attack (5+), Feral Instinct (7+) |
| `barbarianUnarmoredDefenseAC()` | **New function** | `(dexMod, conMod) => 10 + dexMod + conMod` |
| `shouldRageEnd()` | **New function** | `(attacked, tookDamage, unconscious) => boolean` |
| `hasFeralInstinct()` | **New function** | `(level) => level >= 7` |
| `hasDangerSense()` | **New function** | `(level) => level >= 2` |

## What New Executors Are Needed

**None.** The 6 features map to:
1. Rage resistance → Already in RageExecutor ✓
2. Unarmored Defense → AC calculation, not an executor
3. Danger Sense → ActiveEffect at combat init, not an executor
4. Extra Attack → Already works via ClassFeatureResolver ✓
5. Rage end mechanics → Turn advancement hook, not an executor
6. Feral Instinct → Initiative system modification, not an executor

None of these are text-parsed bonus/class actions that need executor dispatch via AbilityRegistry.

## What Changes to Existing Executors (Rage Executor)

**No changes needed.** The RageExecutor already:
- Creates B/P/S resistance ActiveEffects ✓
- Creates melee damage bonus ActiveEffect ✓
- Creates STR saving throw advantage ActiveEffect ✓
- Spends rage resource pool ✓
- Sets `raging: true` flag ✓

The omission is **rage ending**, which is a turn-advancement concern, not an executor concern.

## How Extra Attack Should Work — Is Fighter's Logic Class-Agnostic?

**Yes, it IS class-agnostic.** The key chain:
1. `ClassFeatureResolver.hasMartialExtraAttack()` checks if class is in `["fighter", "monk", "ranger", "paladin", "barbarian"]` — Barbarian is already included.
2. `ClassFeatureResolver.getAttacksPerAction()` returns 2 for any martial class at level 5+ (Fighter gets special escalation at 11/20).
3. `action-dispatcher.ts` calls `getAttacksPerAction()` and sets `attacksAllowedThisTurn` — works for any class.

**No changes needed for Barbarian Extra Attack.** It's already implemented.

## Registration Changes Needed in `app.ts`

**None.** No new executors are being created.

## Concerns and Risks

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| 1 | **Rage end requires turn-start hook** — `resetTurnResources()` is class-agnostic; adding barbarian rage tracking breaks its simplicity | Medium | Create a separate `processClassTurnStartEffects()` function called after `resetTurnResources()` |
| 2 | **Danger Sense condition gating** — D&D 5e 2024 says Danger Sense doesn't work when Blinded/Deafened/Incapacitated. The ActiveEffect system doesn't have a "disabled if condition X" mechanism | Low | Check conditions at save resolution time in `SavingThrowResolver`, not at effect level |
| 3 | **Feral Instinct surprise immunity** — "can't be surprised unless incapacitated" is a second aspect of Feral Instinct beyond initiative advantage that touches the surprise system | Low | Add a check in `isCreatureSurprised()` |
| 4 | **Unarmored Defense in character generator** — If the LLM character generator doesn't know about Barbarian Unarmored Defense, barbarian characters may have wrong AC | Medium | Ensure character generation computes max(armor AC, 10+DEX+CON) for barbarians. For test scenarios, AC is set in JSON directly |
| 5 | **Rage tracking state bloat** — Adding `rageAttackedThisTurn` / `rageTookDamageThisTurn` flags adds barbarian-specific state to generic combatant resources | Low | Acceptable — same pattern used for `sneakAttackUsedThisTurn`, `stunningStrikeUsedThisTurn` etc. |
| 6 | **Player-rolled initiative with Feral Instinct** — The server can't force the player to roll 2d20. Must communicate advantage to the client | Low | Include `rollMode: "advantage"` in the INITIATIVE pending action |
| 7 | **Feature #1 and #4 are already done** — The task spec lists them as work items but they're already implemented | Info | Verify with E2E tests, but no code changes needed |
