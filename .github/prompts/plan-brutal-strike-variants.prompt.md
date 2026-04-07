# Plan: Brutal Strike Full Interactivity

## Feature
Barbarian Brutal Strike (D&D 5e 2024, Level 9) — allow player to choose variant via API and fully apply effects to the target.

## Context
The `BrutalStrikeExecutor` (CLASS-M3) currently:
- Validates eligibility (Raging + Reckless Attack used)
- Records `brutalStrikeVariant` and `brutalStrikeBonusDice` in actor resources
- Returns the bonus dice notation in the summary

**Not yet implemented**: +1d10 damage application to the target, and the variant-specific target conditions (speed halved, push 15 ft, or disadvantage on next roll).

## Variant API Design

### Text-based input (ActionDispatcher)
The `BARBARIAN_COMBAT_TEXT_PROFILE` already maps these text patterns to `class:barbarian:brutal-strike`:
- `"brutal strike"` → default (hamstring blow)
- `"hamstring blow"` → Hamstring Blow
- `"forceful blow"` → Forceful Blow
- `"staggering blow"` → Staggering Blow

Variant is inferred from the abilityId or params.variant in the executor.

### Programmatic input (`/actions` endpoint)
```json
{
  "type": "classAbility",
  "abilityId": "class:barbarian:brutal-strike",
  "actorId": "<barbarian-id>",
  "targetId": "<target-id>",
  "params": {
    "variant": "hamstring-blow",
    "weaponDamageDice": "1d12"
  }
}
```

## Implementation Steps

### Step 1: Extend `handleClassAbility` to support target condition application
File: `application/services/combat/tabletop/dispatch/class-ability-handlers.ts`

Add a new post-processing block (similar to the existing `aoeEffect === "turnUndead"` block):
```ts
if (result.data?.brutalStrikeVariant && result.data?.brutalStrikeTargetId) {
  await this.processBrutalStrike(sessionId, encounterId, actorId, result.data, characters, monsters, npcs);
}
```

The `processBrutalStrike` helper should:
1. Find the target combatant by ID
2. Roll the bonus dice (`brutalStrikeBonusDice`) using `this.deps.diceRoller`
3. Apply  HP reduction to the target
4. Apply the variant-specific effect:
   - **Hamstring Blow**: Add `ActiveEffect` with `type: "speed_multiplier"`, `value: 0.5`, source "Brutal Strike", duration `until_start_of_next_turn` on target
   - **Forceful Blow**: Apply forced movement (15 ft push) using `applyForcedMovement`
   - **Staggering Blow**: Add `ActiveEffect` with `type: "disadvantage"`, scope `attack_rolls_and_saves`, duration `until_end_of_next_turn` on target

### Step 2: Pass target info from BrutalStrikeExecutor
The executor needs `params.targetId` (the target's character/monster ID to affect). 
Update `BrutalStrikeExecutor.execute()` to include `brutalStrikeTargetId` in the returned data.

In `handleClassAbility`, pass `targetRef` to the executor params (currently only actors are sent).

### Step 3: Add `speed_multiplier` effect type
If not already present, add `speed_multiplier` as a recognized effect type in `domain/entities/combat/effects.ts`. This would be read in movement calculation logic to cap the creature's available movement.

### Step 4: E2E test scenario
Create `scripts/test-harness/scenarios/class-abilities/barbarian-brutal-strike.json`:
```json
{
  "name": "Barbarian Brutal Strike",
  "description": "Barbarian with Reckless Attack hits a target and uses Brutal Strike (Hamstring Blow)",
  "steps": [
    { "action": "parseCombatAction", "actor": "character", "text": "rage" },
    { "action": "parseCombatAction", "actor": "character", "text": "reckless attack goblin" },
    { "action": "parseCombatAction", "actor": "character", "text": "hamstring blow" }
  ]
}
```

### Step 5: Unit tests
File: `application/services/combat/abilities/executors/barbarian/brutal-strike-executor.test.ts`
- Test eligibility checks (not raging, no reckless attack)
- Test variant selection from abilityId
- Test default variant (hamstring-blow)

## D&D 5e 2024 Rules Reference
> **Brutal Strike (Barbarian 9)**: If you use Reckless Attack and your attack hits, you can use this feature to choose one of these effects on the target for the attack:
> - **Forceful Blow**: Target takes 1d10 extra damage and must succeed DC(8 + STR mod + prof) STR save or be pushed 15 ft.
> - **Hamstring Blow**: Target takes 1d10 extra damage and its Speed is halved until the start of your next turn.
> - **Staggering Blow**: Target takes 1d10 extra damage and has Disadvantage on the next attack roll or saving throw it makes before the start of your next turn.

Note: The push for Forceful Blow in the PHB is 15 ft (not 10 ft as originally described in the task — use 15 ft per 2024 PHB).
