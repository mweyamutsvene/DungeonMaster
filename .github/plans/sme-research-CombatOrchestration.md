# SME Research — CombatOrchestration — Barbarian Phase 8.1

## Scope
Research on how the 6 Barbarian features touch the CombatOrchestration layer:
1. Rage damage resistance
2. Unarmored Defense (AC override)
3. Danger Sense (advantage on DEX saves)
4. Extra Attack (Barbarian Lv 5)
5. Rage end mechanics (turn-start check)
6. Feral Instinct (Lv 7) — advantage on initiative + anti-surprise

---

## 1. Rage Damage Resistance — Already Fully Wired

**Verdict: NO COMBAT ORCHESTRATION CHANGES NEEDED.**

The Rage executor (`rage-executor.ts`) already creates three `ActiveEffect` entries with `type: "resistance"` for bludgeoning, piercing, and slashing damage. These flow through damage resolution automatically:

**Roll State Machine damage path** (`roll-state-machine.ts` ~L1614):
```
handleDamageRoll() → reads target's ActiveEffects → getDamageDefenseEffects(tgtEffects, damageType) 
→ merges into defenses.damageResistances → applyDamageDefenses() halves the damage
```

This code path already:
- Reads `getActiveEffects(targetCombatantForDefenses.resources)` (L1617-1619)
- Calls `getDamageDefenseEffects(tgtEffects, damageType)` which checks `e.type === 'resistance' && e.damageType === damageType` (L1620)
- Merges into `defenses.damageResistances` (L1622-1624)
- Calls `applyDamageDefenses()` which halves the damage (L1632-1636)

The identical pattern exists in:
- `ai-action-executor.ts` (L627-647) — AI monster attack path
- `two-phase-action-service.ts` (L692-707) — opportunity attack path
- `action-service.ts` (L572+) — legacy action path

All these paths use the same `getDamageDefenseEffects()` → `applyDamageDefenses()` chain, so Rage BPS resistance works out of the box as long as the Rage ActiveEffects are on the combatant's resources (which the RageExecutor ensures).

---

## 2. Unarmored Defense — NOT in Combat Orchestration scope

**Verdict: NOT A COMBAT ORCHESTRATION CONCERN.**

Unarmored Defense changes the `armorClass` value on the **character sheet** (pre-combat, at character creation/level-up time). The combat flow simply reads `armorClass` from `target.statBlock?.armorClass` or `target.sheet?.armorClass`:

**Where AC is read** (`roll-state-machine.ts` L1065):
```typescript
const baseAC = (target as any).statBlock?.armorClass || (target as any).sheet?.armorClass || 10;
```

This is also the pattern in `ai-action-executor.ts` (L486-491). Neither location computes AC — they just read a pre-calculated number.

**Where Unarmored Defense should actually live:**
- Character generation / sheet builder (probably `infrastructure/llm/mocks/index.ts` L631-648 which already handles Monk Unarmored Defense)
- The mock character generator already does: `armorClass = 10 + dexMod + wisMod` for monks
- Barbarian Unarmored Defense is: `armorClass = 10 + DEX mod + CON mod` (no armor, shield allowed)

**Risk if not done:** If a Barbarian character is created with default "10 + DEX" AC instead of "10 + DEX + CON", they'll have a lower AC in combat. But the combat orchestration layer doesn't need changes — it just reads whatever AC value is stored.

---

## 3. Danger Sense — Advantage on DEX saves

**Verdict: NEEDS TARGETED INTEGRATION, but via ActiveEffect, not code changes to SavingThrowResolver.**

### Current SavingThrowResolver flow (`saving-throw-resolver.ts` L120-187):

```
resolve() → getActiveEffects(targetCombatant.resources) 
→ hasAdvantageFromEffects(targetEffects, 'saving_throws', 'dexterity') 
→ if advantage, roll 2d20 take highest
```

The resolver already checks for advantage/disadvantage on saving throws via `ActiveEffect` system (L178-181):
```typescript
const hasEffectAdvantage = hasAdvantageFromEffects(targetEffects, 'saving_throws', saveAbility);
const hasEffectDisadvantage = hasDisadvantageFromEffects(targetEffects, 'saving_throws', saveAbility);
```

**How `hasAdvantageFromEffects` works** (`effects.ts` L292-301):
```typescript
effects.some(
  e => e.type === 'advantage' && e.target === target
    && (ability === undefined || e.ability === ability)
    && !e.targetCombatantId
);
```

### Implementation Strategy — Two Options:

#### Option A: Permanent ActiveEffect (Recommended)
Create a **permanent** ActiveEffect when the Barbarian enters combat (at initiative roll time). In `handleInitiativeRoll()` (or via `buildCombatResources()`), if the character is a Barbarian level 2+, add:
```typescript
createEffect(id, "advantage", "saving_throws", "permanent", {
  ability: "dexterity",
  source: "Danger Sense",
  description: "Advantage on DEX saving throws (Barbarian Danger Sense)",
})
```

**Pros:** Zero changes to `SavingThrowResolver` — the existing `hasAdvantageFromEffects` call picks it up automatically.

**Cons:** Slight inaccuracy — D&D 5e 2024 Danger Sense says "that you can see" (not blinded) and "not Incapacitated". These conditions would need to be checked. However, the Blinded/Incapacitated conditions typically impose disadvantage on other things, so the advantage+disadvantage cancellation in the resolver (L183-192) handles the blinded case already.

#### Option B: Direct check in SavingThrowResolver
Add a class-feature check in the resolver: if the target is a Barbarian level 2+ and the save is DEX, grant advantage. This requires passing class info into the resolver, which currently doesn't have access to character sheets.

**Recommendation:** Option A is strongly preferred. The ActiveEffect pattern is already established for Rage (STR save advantage) and is extensible. If literal RAW compliance is needed for blindness/incapacitation, add a conditional check when creating the effect or use `until_triggered` with a condition guard.

### Where to create the Danger Sense effect:
- In `buildCombatResources()` or `handleInitiativeRoll()` at combat start
- Or better: Barbarian domain file exports a function, `buildCombatResources()` calls it

---

## 4. Extra Attack (Barbarian Lv 5) — Already Class-Agnostic

**Verdict: NO COMBAT ORCHESTRATION CHANGES NEEDED.**

**ClassFeatureResolver.getAttacksPerAction()** (`class-feature-resolver.ts` L166-183):
```typescript
static getAttacksPerAction(sheet, className, level): number {
  // ...
  const hasMartial = ClassFeatureResolver.hasMartialExtraAttack(sheet, className);
  // ...
  if (hasMartial && effectiveLevel >= 5) return 2;
  return 1;
}
```

**ClassFeatureResolver.hasMartialExtraAttack()** (`class-feature-resolver.ts` L156-161):
```typescript
static hasMartialExtraAttack(sheet, className): boolean {
  const name = (className ?? sheet?.className ?? "").toLowerCase();
  return ["fighter", "monk", "ranger", "paladin", "barbarian"].includes(name);
}
```

Barbarian is already in the list. At level 5+, `getAttacksPerAction` returns 2. The action dispatcher and roll state machine use this to set `attacksAllowedThisTurn` — no changes needed.

---

## 5. Rage End Mechanics — Turn-Start Hook

**Verdict: NEEDS NEW LOGIC in CombatService turn advancement.**

### D&D 5e 2024 Rage End Rules:
Rage ends early if:
- You haven't **attacked a hostile creature** since your last turn, AND
- You haven't **taken damage** since your last turn
- (Also ends if you fall Unconscious, but KO already breaks effects via `applyKoEffectsIfNeeded`)

### Current Turn Tracking Data:

**What we already track** (from `resetTurnResources()` in `resource-utils.ts` L184-207):
- `attacksUsedThisTurn: 0` — reset each turn (counts attacks made)
- `actionSpent: false` — whether the action was used

**What we DON'T track:**
- Whether the barbarian **attacked a hostile** this turn (not just "used attacks" — needs to distinguish actual hostile-targeting attacks from general attack use)
- Whether the barbarian **took damage** this turn

### Where Turn Start/End Hooks Exist:

**CombatService.advanceTurn()** (`combat-service.ts` L600-800):
1. **End-of-turn processing** (L648-666):
   - Condition expiry via `removeExpiredConditions("end_of_turn", ...)`
   - ActiveEffect expiry via `processActiveEffectsAtTurnEvent(records, "end_of_turn", ...)`
   - Zone triggers via `processZoneTurnTriggers(encounter, records, "on_end_turn", ...)`

2. **Turn advancement** (L670-692):
   - `combat.endTurn()` → moves to next combatant, may wrap to new round
   - `resetTurnResources()` for the new active combatant (or all if new round)

3. **Start-of-turn processing** (L720-760):
   - Condition expiry via `removeExpiredConditions("start_of_turn", ...)`
   - ActiveEffect start-of-turn via `processActiveEffectsAtTurnEvent(records, "start_of_turn", ...)`
   - Zone start-of-turn triggers

### Implementation Plan:

**Step 1:** Add two new resource tracking flags:
- `rageAttackedThisTurn: boolean` — set to `true` when barbarian makes an attack against a hostile
- `rageDamageTakenThisTurn: boolean` — set to `true` when barbarian takes damage

These should be reset each turn in `resetTurnResources()` and set in:
- `rageAttackedThisTurn` → in `handleDamageRoll()` when damage is applied by the barbarian (after a successful attack), or in `handleAttackRoll()` when an attack hits
- `rageDamageTakenThisTurn` → in `handleDamageRoll()` when the target is the barbarian and has Rage active

**Step 2:** Add rage-end check at start of barbarian's turn.

**Best location:** In `processActiveEffectsAtTurnEvent("start_of_turn", ...)` — this already runs at the start of each combatant's turn. Add a check: if the active combatant has a `Rage` ActiveEffect AND both `rageAttackedThisTurn === false` AND `rageDamageTakenThisTurn === false`, remove all Rage-sourced effects and set `raging: false`.

**Alternative location:** In `CombatService.advanceTurn()` after `resetTurnResources()` — add a barbarian-specific check. This is less clean but more explicit.

**Recommended approach:** Add the check in `CombatService.advanceTurn()` at the start-of-turn section (around L750), BEFORE `processActiveEffectsAtTurnEvent`. This keeps it explicit and avoids overloading the generic ActiveEffect processing. The check would:

```
1. Get the newly active combatant
2. Check if they have Rage ActiveEffects (effects.some(e => e.source === "Rage"))
3. If yes, read rageAttackedThisTurn and rageDamageTakenThisTurn from PREVIOUS turn resources
   (IMPORTANT: do this BEFORE resetTurnResources clears them)
4. If neither flag is true, remove all Rage-sourced effects, set raging: false
```

**Critical ordering concern:** The rage-end check must happen **BEFORE** `resetTurnResources()` clears the tracking flags. Currently `resetTurnResources()` is called at L482 (individual turn) or L469 (new round). The check needs to be inserted before these calls.

### Specific Code Locations That Need Modification:

| File | Location | Change |
|------|----------|--------|
| `resource-utils.ts` L184 | `resetTurnResources()` | Add `rageAttackedThisTurn: false, rageDamageTakenThisTurn: false` to reset |
| `roll-state-machine.ts` ~L1570 | `handleDamageRoll()` after damage applied | If actor has Rage, set `rageAttackedThisTurn: true` on actor. If target has Rage, set `rageDamageTakenThisTurn: true` on target |
| `combat-service.ts` ~L465-485 | `advanceTurn()` turn start | Add rage-end check BEFORE `resetTurnResources()` |
| `ai-action-executor.ts` ~L600+ | AI attack damage path | If AI barbarian attacks, set `rageAttackedThisTurn: true`. If AI barbarian takes damage, set `rageDamageTakenThisTurn: true` |

### Risks:
- **Race condition:** Must check rage-end BEFORE resetting turn resources. Get the ordering wrong and rage never ends.
- **Multiple damage paths:** Damage can come from: `handleDamageRoll()`, opportunity attacks in `two-phase-action-service.ts`, zone damage in `zone-damage-resolver.ts`, ongoing damage in `processActiveEffectsAtTurnEvent()`. All paths that deal damage to a raging barbarian should set `rageDamageTakenThisTurn`.
- **AI attacks:** When AI barbarians attack via `ai-action-executor.ts`, that path needs to set `rageAttackedThisTurn` too.
- **Alternative simplification:** Instead of tracking two separate flags, could track a single `rageStillActive` flag that starts `true` each turn and gets confirmed by attacks/damage. But the D&D rule checks "since your last turn", which spans the gap between turns, so the flags should persist across the gap.

---

## 6. Feral Instinct (Lv 7) — Advantage on Initiative + Anti-Surprise

**Verdict: NEEDS CHANGES in `computeInitiativeRollMode()` and player initiative flow.**

### Current Initiative Roll Flow:

**`computeInitiativeRollMode()`** (`roll-state-machine.ts` L131-160):
```typescript
function computeInitiativeRollMode(
  creatureId: string,
  surprise: SurpriseSpec | undefined,
  side: "party" | "enemy",
  conditions?: unknown[],
): "normal" | "advantage" | "disadvantage" {
  let adv = 0;
  let disadv = 0;
  if (isCreatureSurprised(creatureId, surprise, side)) disadv++;
  // Checks: Invisible → adv, Incapacitated → disadv
  // adv + disadv cancel to normal
}
```

This function does NOT have access to class/level info. It only gets `creatureId`, `surprise`, `side`, and `conditions`.

### Where initiative is rolled:

**Player initiative** (L474-505): The primary PC provides their own roll. The function doesn't call `computeInitiativeRollMode` for the primary initiator — it just adds `dexModifier + alertBonus` to their provided roll value. Feral Instinct advantage for the **player rolling** would need to be communicated via the `RollRequest` response (the `advantage: true` field).

**Multi-PC auto-roll** (L565-575):
```typescript
const otherInitMode = computeInitiativeRollMode(otherChar.id, action.surprise, "party", otherSheet?.conditions);
const otherRoll = rollInitiativeD20(this.deps.diceRoller, otherInitMode);
```

**Monster auto-roll** (L640-650):
```typescript
const monsterInitMode = computeInitiativeRollMode(targetId, action.surprise, "enemy", statBlock?.conditions);
const monsterRoll = rollInitiativeD20(this.deps.diceRoller, monsterInitMode);
```

**NPC auto-roll** (L700-710):
```typescript
const npcInitMode = computeInitiativeRollMode(npc.id, action.surprise, "party", statBlock?.conditions);
const npcRoll = rollInitiativeD20(this.deps.diceRoller, npcInitMode);
```

### Required Changes:

#### A. Expand `computeInitiativeRollMode()` signature:
Add an optional `classInfo` parameter:
```typescript
function computeInitiativeRollMode(
  creatureId: string,
  surprise: SurpriseSpec | undefined,
  side: "party" | "enemy",
  conditions?: unknown[],
  classInfo?: { className: string; level: number },
): "normal" | "advantage" | "disadvantage" {
  // ... existing logic ...
  // Add: if classInfo is Barbarian level 7+, adv++
  if (classInfo && classInfo.className.toLowerCase() === "barbarian" && classInfo.level >= 7) adv++;
  // D&D 5e 2024: Feral Instinct also makes you immune to surprise
  // → if creature is surprised AND has Feral Instinct, remove the surprise disadvantage
  // (Actually, 2024 Feral Instinct says "you have Advantage on Initiative rolls" — that's it.
  // The anti-surprise is handled separately.)
}
```

#### B. Update call sites:
All 3 auto-roll paths need to pass `classInfo`:
- Multi-PC: `computeInitiativeRollMode(otherChar.id, action.surprise, "party", otherSheet?.conditions, { className: otherClassName, level: otherLevel })`
- Monster: `computeInitiativeRollMode(targetId, action.surprise, "enemy", statBlock?.conditions, { className: monsterClassName, level: monsterLevel })` (unlikely for monsters, but architecturally clean)
- NPC: `computeInitiativeRollMode(npc.id, action.surprise, "party", statBlock?.conditions, { className: npcClassName, level: npcLevel })`

#### C. Player initiative request:
In `TabletopCombatService.initiateAction()` (`tabletop-combat-service.ts`), when building the `RollRequest` for the primary PC, check if the PC has Feral Instinct and set `advantage: true` on the request. The PC rolls their own die — the `advantage` flag tells the client to roll 2d20.

**Current location:** `tabletop-combat-service.ts` ~L230-260 builds the `InitiatePendingAction` and returns a `RollRequest`. Check the initiating character's class/level and set `advantage: true` if applicable.

#### D. Feral Instinct anti-surprise:
**D&D 5e 2024 Feral Instinct (Lv 7):** "You have Advantage on Initiative rolls. In addition, if you are surprised at the start of combat, you aren't surprised if you aren't Incapacitated."

Two parts:
1. **Advantage on initiative** — handled by `computeInitiativeRollMode()` change above
2. **Anti-surprise** — need to modify `isCreatureSurprised()` or `computeInitiativeRollMode()`:
   - If the barbarian is Lv 7+ and NOT incapacitated, they cannot be surprised
   - In `computeInitiativeRollMode()`: if the creature would be surprised but has Feral Instinct and is not incapacitated, remove the surprise disadvantage

The cleanest approach: in `computeInitiativeRollMode()`, after computing `disadv++` for surprise, check if `classInfo.className === "barbarian" && classInfo.level >= 7` AND the creature is NOT incapacitated → `disadv--` to cancel the surprise disadvantage.

### Specific Code Locations:

| File | Line | Change |
|------|------|--------|
| `roll-state-machine.ts` L131 | `computeInitiativeRollMode()` | Add `classInfo?` param, check Barbarian Lv7+ for advantage, negate surprise if not incapacitated |
| `roll-state-machine.ts` L574 | Multi-PC auto-roll call | Pass `classInfo` |
| `roll-state-machine.ts` L644 | Monster auto-roll call | Pass `classInfo` (optional) |
| `roll-state-machine.ts` L703 | NPC auto-roll call | Pass `classInfo` |
| `tabletop-combat-service.ts` ~L250 | `initiateAction()` RollRequest | Check Feral Instinct and set `advantage: true` |

### Domain-First Principle:
The Barbarian domain file (`barbarian.ts`) should export:
- `hasFeralInstinct(level: number): boolean` → returns `level >= 7`
- `hasDangerSense(level: number): boolean` → returns `level >= 2`

`computeInitiativeRollMode()` would import and use these. This keeps detection in the domain layer per the established pattern.

---

## Summary: What Touches CombatOrchestration

| Feature | Touches CombatOrchestration? | Effort | Risk |
|---------|------------------------------|--------|------|
| Rage resistance | **No** — already works via ActiveEffect | 0 | None |
| Unarmored Defense | **No** — character sheet concern | 0 | None for orchestration |
| Danger Sense | **Minimal** — add ActiveEffect at combat start | Low | Low |
| Extra Attack | **No** — already class-agnostic | 0 | None |
| Rage end mechanics | **Yes** — needs new tracking + turn-start hook | Medium-High | Multiple damage paths must set flags; ordering matters |
| Feral Instinct | **Yes** — needs `computeInitiativeRollMode()` + RollRequest changes | Medium | Low, well-contained changes |

---

## Concerns & Risks

1. **Rage end is the hardest feature.** It requires tracking across turn boundaries ("since your last turn"), and damage can come from at least 5 different code paths (tabletop attack, OA, zone damage, ongoing effect damage, AI attack). Missing any path means rage never ends for that damage source.

2. **`resetTurnResources()` ordering.** The rage-end check MUST happen before the tracking flags are cleared. The current code resets resources immediately upon turn advancement. This ordering constraint is easy to get wrong.

3. **Feral Instinct is well-contained** but touches a function with 3 call sites + the tabletop service facade. All changes are backward-compatible (optional parameter).

4. **Danger Sense via ActiveEffect is elegant** but slightly over-applies: D&D 5e 2024 says "you can't be Blinded, Deafened, or Incapacitated." The ActiveEffect advantage would still be present even if the barbarian is blinded (though the SavingThrowResolver already checks disadvantage from effects, so adv+disadv would cancel to normal). For RAW compliance, could add a guard in the effect's eligibility, but the 5e cancellation rule makes this a non-issue in practice.

5. **No breaking changes for existing classes.** All changes are additive — `computeInitiativeRollMode()` gets an optional param, `resetTurnResources()` gets new fields set to `false`, `processActiveEffectsAtTurnEvent` is untouched.
