# Phase 2 Hard Abilities — Implementation Plan

These monk abilities require architecture changes beyond simple scenario+parser additions. While these abilties specify monk, there are other potential class abilities other than monk that may require similar patterns (e.g. reaction interrupts, hit-rider effects, initiative triggers). The implementation of these monk abilities should be done in a way that establishes reusable patterns for other classes and abilities in the future.

## 1. Stunning Strike (Hit-Rider Pattern)

**D&D 5e 2024 Rule**: Once per turn, when you hit a creature with a Monk weapon or Unarmed Strike, you can spend 1 Focus Point to attempt a stunning strike. Target makes a CON save vs your ki save DC.

### Current State
- Executor exists (`stunning-strike-executor.ts`) but implements it as a standalone attack (wrong per RAW)
- No "post-hit modifier" pattern exists in the tabletop flow

### Required Changes
1. **New pattern: Hit-Rider declaration** — After a successful attack roll in `handleAttackRoll`, before requesting damage roll, add an optional "declare enhancement" step where the player can announce "stunning strike"
2. **CON Saving Throw** — After damage is applied, auto-resolve CON save (or request roll in tabletop mode):
   - **Save DC**: 8 + proficiency bonus + WIS modifier
   - **Fail**: Stunned until start of monk's next turn
   - **Success (5e 2024)**: Target's speed halved until end of your next turn; next attack against them has Advantage
3. **Condition Application** — Add/apply Stunned condition via `combatRepo.updateCombatantState`
4. **Refactor executor** to NOT make its own attack — instead, it should process the stunning effect given that a hit already occurred

### Architecture Impact
- `handleAttackRoll()` or `applyDamageResult()` needs a post-hit hook
- New pending action type: `SAVING_THROW` or `HIT_ENHANCEMENT`
- Condition system needs Stunned effects (skip turn, auto-fail STR/DEX saves, advantage on attacks against)

## 2. Deflect Attacks (Reaction Pattern) — ✅ COMPLETE

**D&D 5e 2024 Rule**: When you are hit by an attack, you can use your Reaction to reduce the damage by 1d10 + DEX modifier + Monk level. If reduced to 0, you can spend 1 ki to redirect the attack.

### Implementation Status — FULLY IMPLEMENTED
- **Deflection**: Implemented in `two-phase-action-service.ts` `completeAttack()` via two-phase reaction framework
- **Ki Redirect**: When damage reduced to 0, auto-spends 1 ki to make a ranged Unarmed Strike (DEX + proficiency vs AC, 2× Martial Arts die + DEX mod Force damage) against the original attacker
- **Detection**: `DEFLECT_ATTACKS_REACTION` in `monk.ts` detects eligible monks (level 3+, has reaction), provides context including `dexMod`, `monkLevel`, `proficiencyBonus`, `martialArtsDieSize`
- **Events emitted**: `DeflectAttacks` (deflection roll), `DeflectAttacksRedirect` (redirect attack/damage), `DamageApplied` (redirect damage to attacker)
- **Test scenario**: `monk/deflect-attacks.json` (basic deflection) + `monk/deflect-attacks-redirect.json` (full deflection + ki redirect)
- **Old executor deleted**: `deflect-attacks-executor.ts` was dead code, removed

## 3. Open Hand Technique (Flurry Extension)

**D&D 5e 2024 Rule**: When you hit with a Flurry of Blows strike, you can apply one of three techniques: Addle (disadvantage on next attack), Push (STR save or pushed 15ft), Topple (DEX save or knocked Prone).

### Current State
- Executor exists (`open-hand-technique-executor.ts`) with full technique logic
- Flurry of Blows flow doesn't include technique choice
- Saving throw mechanics exist in domain (`makeSavingThrow`, `calculateSaveDC`)

### Required Changes
1. **Technique choice step** — After a Flurry hit, prompt player for technique choice (Addle/Push/Topple)
2. **Saving throw integration** — Server auto-resolves the save using seeded dice
3. **Effect application** — Apply conditions/position changes based on technique + save result
4. **Flurry integration** — Modify flurry damage resolution to check if character has Open Hand and prompt for technique

### Architecture Impact
- Flurry damage handler needs post-hit technique selection step
- New pending action type for technique choice
- Saving throw resolution in tabletop flow

## 4. Uncanny Metabolism (Initiative Hook)

**D&D 5e 2024 Rule**: When you roll Initiative, you can regain all expended Focus Points (ki). In addition, you regain HP equal to your Martial Arts die roll + monk level. Once per long rest.

### Current State
- Executor exists (`uncanny-metabolism-executor.ts`) with full logic
- Resource pool `uncanny_metabolism` is NOT initialized in `handleInitiativeRoll`
- No initiative-triggered ability hook exists

### Required Changes
1. **Resource pool init** — Add `uncanny_metabolism` pool (1 use per long rest) in `handleInitiativeRoll`
2. **Auto-trigger on initiative** — After initiative roll, if monk has uncanny_metabolism pool available:
   - Restore ALL ki points to max
   - Heal: martial arts die roll + monk level
   - Spend 1 from uncanny_metabolism pool
3. **No player input needed** — This triggers automatically, just report the result

### Architecture Impact
- Minimal — just add logic to `handleInitiativeRoll` after resource pool initialization
- Could be done as a post-initiative phase before the first turn

## Priority Order
1. **Uncanny Metabolism** (easiest of the hard ones — just initiative hook, no new patterns)
2. **Open Hand Technique** (medium — needs Flurry integration + technique choice)
3. **Stunning Strike** (hard — needs hit-rider pattern + CON save)
4. **Deflect Attacks** (hardest — needs reaction system during AI turns)
