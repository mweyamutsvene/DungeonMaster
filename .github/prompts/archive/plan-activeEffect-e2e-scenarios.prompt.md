# Plan: Generic ActiveEffect E2E Scenarios — Phase 10b

## Overview

Create 4 E2E scenarios that exercise the 4 deferred generic ActiveEffect mechanics from Phase 10. Each scenario tests a **generic resolution point** — not a specific spell. The spell/effect declarations in the character sheets are fictional test effects that happen to exercise these patterns.

This validates that the ActiveEffect system handles:
1. Per-combatant ongoing damage with save-to-end
2. Target-specific bonus damage on attacks
3. Retaliatory damage on melee hit
4. Caster-turn-triggered ongoing damage

## Prerequisites

- Phase 10 ActiveEffect system (COMPLETE)
- Caster-turn trigger fix in `processActiveEffectsAtTurnEvent` (COMPLETE — added `sourceCombatantId` filtering)
- 118 E2E scenarios currently passing

## Scenario Designs

### Scenario 1: `core/ongoing-damage.json` — Ongoing Damage with Save-to-End

**Generic mechanic:** `type: 'ongoing_damage'` with `triggerAt: 'start_of_turn'` and `saveToEnd`

**Setup:**
- **PC**: Warrior with a melee attack (enough to not complicate things)
- **Monster**: "Venomous Serpent" — has a save-based spell/ability that applies ongoing poison damage to the PC
  - Effect: `ongoing_damage`, 1d6 poison, fires at `start_of_turn`, save-to-end CON DC 12, 10 rounds
  - The monster applies this via `aiConfig.defaultBehavior: "castSpell"` + a `preparedSpells` entry with `saveAbility: "constitution"` and an `effects` array containing the ongoing damage

**Flow:**
1. Initiate combat, roll initiative (PC goes first)
2. PC attacks Serpent (deals damage, advances combat)
3. End turn → monster's turn
4. Monster casts "Venomous Bite" (save-based spell with ongoing_damage effect on target)
5. Wait for PC turn → `assertState` HP dropped (ongoing damage fired at start of turn)
6. Assert PC took 1-6 poison damage at start of turn
7. End turn → monster endTurn → waitForTurn → assert HP dropped again OR effect ended (save succeeded)

**Key assertions:**
- `characterHp.max` < starting HP after first turn with effect active
- Effect processes reliably at turn start
- If save succeeds (deterministic dice), effect is removed

**Notes:**
- The seeded dice roller produces deterministic results. We need to predict the save outcome based on the dice sequence. The scenario should assert HP ranges rather than exact values to tolerate dice variance across seeds.
- Actually: The monster needs to apply the effect to the PC. The simplest way: give the monster a save-based spell where on failed save, an `ongoing_damage` effect is applied. But currently the `effects` array on prepared spells is for buff/debuff path spells, not save-based spells. 
  - **Alternative approach**: Give the PC a save-based spell that applies ongoing_damage to the monster. Then we can check `monsterHp` dropping at start of monster's turn.
  - **Better alternative**: Use the buff/debuff spell pattern — the monster casts a "Poison Touch" spell with `appliesTo: "enemies"` that applies `ongoing_damage` to all enemies (the PC). No save needed to apply — the save-to-end is for removing the effect each turn.

---

### Scenario 2: `core/hunters-mark.json` — Target-Specific Bonus Damage

**Generic mechanic:** `type: 'bonus'`, `target: 'damage_rolls'`, `diceValue`, `targetCombatantId` filtering

**Setup:**
- **PC**: Ranger with Hunter's Mark + a weapon attack
  - Hunter's Mark: `effects: [{ type: "bonus", target: "damage_rolls", diceValue: { count: 1, sides: 6 }, duration: "concentration", appliesTo: "target" }]`
  - A longbow attack
- **Monster 1**: "Goblin Scout" (primary target / marked)
- **Monster 2**: "Goblin Grunt" (secondary, to verify mark doesn't affect attacks on this target)

**Flow:**
1. Initiate + initiative
2. PC casts Hunter's Mark targeting Goblin Scout (bonus action spell)
3. PC attacks Goblin Scout → assert hit → roll damage
4. Assert Goblin Scout HP dropped by weapon damage + 1d6 bonus
5. Next round: PC attacks Goblin Grunt → damage roll → no bonus (mark is on Scout, not Grunt)
6. Assert Goblin Grunt HP dropped by weapon damage only (lower damage than marked target)

**Key assertions:**
- `monsterHp` for Goblin Scout: max < (startingHP - baseDamageMin - 1) — bonus damage applied
- `monsterHp` for Goblin Grunt: damage is base only (no bonus dice)
- `characterConcentration: "Hunter's Mark"`

**Notes:**
- Hunter's Mark is a bonus action spell (`isBonusAction: true`). The PC can cast it and attack in the same turn.
- `appliesTo: "target"` means the `targetCombatantId` is set to the named target. The `handleBuffDebuffSpell` handler resolves this.
- Two monsters needed to prove target-specificity.

---

### Scenario 3: `core/retaliatory-damage.json` — Retaliatory Damage on Melee Hit

**Generic mechanic:** `type: 'retaliatory_damage'`, fires when creature with effect is hit by melee attack

**Setup:**
- **PC**: Fighter with a self-buff spell that grants retaliatory damage
  - "Frost Armor" spell: `effects: [{ type: "temp_hp", target: "hit_points", value: 10, duration: "concentration", appliesTo: "self" }, { type: "retaliatory_damage", target: "hit_points", value: 5, damageType: "cold", duration: "concentration", appliesTo: "self" }]`
- **Monster**: "Orc Brute" with melee attack, enough HP to survive retaliation

**Flow:**
1. Initiate + initiative (PC goes first)
2. PC casts "Frost Armor" on self → temp HP + retaliatory damage effect
3. End turn → Monster attacks PC with melee
4. Wait for turn → assert Monster HP dropped by 5 cold (retaliatory damage from melee hit)
5. Assert PC HP is full (temp HP absorbed the attack)

**Key assertions:**
- `monsterHp` for Orc Brute: max < starting HP (retaliatory damage dealt)
- `characterHp.min` >= base HP (temp HP absorbed damage)
- `characterConcentration: "Frost Armor"`

**Notes:**
- Retaliatory damage triggers in `handleDamageRoll()` when the defender has `retaliatory_damage` effects and the attack is melee.
- The monster must attack with a melee weapon (not ranged).

---

### Scenario 4: `core/caster-turn-damage.json` — Caster-Turn-Triggered Ongoing Damage

**Generic mechanic:** `ongoing_damage` where `sourceCombatantId !== entityId` — fires on the **caster's** turn, not the victim's

**Setup:**
- **PC**: Caster with a concentration spell that applies ongoing damage to the target, triggered at start of caster's turn
  - "Searing Bond" spell: `effects: [{ type: "ongoing_damage", target: "hit_points", diceValue: { count: 2, sides: 8 }, damageType: "fire", duration: "concentration", triggerAt: "start_of_turn", appliesTo: "target" }]`
  - Also has a basic melee weapon for endTurn purposes
- **Monster**: "Iron Golem" with high HP to survive multiple rounds

**Flow:**
1. Initiate + initiative (PC goes first)  
2. PC casts "Searing Bond" targeting Iron Golem
3. End turn → Monster attacks (takes its turn normally)
4. Wait for PC turn → at **start of PC's turn**, the caster-triggered ongoing damage fires on the Golem
5. Assert Golem HP dropped (2d8 fire damage at start of caster's turn)
6. PC ends turn → Monster turn → wait for PC turn → assert Golem HP dropped again
7. End combat or verify concentration break removes the effect

**Key assertions:**
- `monsterHp` for Iron Golem: max < starting HP after PC's second turn starts (caster-turn damage applied)
- Damage accumulates each round at start of PC's turn
- `characterConcentration: "Searing Bond"`

**Notes:**
- This is the newly-fixed caster-turn trigger. Without the fix in `processActiveEffectsAtTurnEvent`, the effect would never fire because the Golem's effects wouldn't be checked when it's the PC's turn.
- The `sourceCombatantId` on the effect (set by `handleBuffDebuffSpell`) must match the active creature's entity ID.
- **IMPORTANT**: `appliesTo: "target"` in the buff/debuff handler applies the effect TO the target, but the `sourceCombatantId` is the caster. When the caster's turn starts, the system now checks all combatants for effects where `sourceCombatantId === activeEntityId`.

## Implementation Order

1. Write `core/ongoing-damage.json`
2. Write `core/hunters-mark.json`
3. Write `core/retaliatory-damage.json`
4. Write `core/caster-turn-damage.json`
5. Run each scenario individually to verify
6. Run full E2E suite to verify no regressions
7. Update Phase 10 plan doc — mark deferred scenarios as complete

## Verification

1. `pnpm -C packages/game-server exec tsx scripts/test-harness/combat-e2e.ts --scenario core/ongoing-damage` — passes
2. `pnpm -C packages/game-server exec tsx scripts/test-harness/combat-e2e.ts --scenario core/hunters-mark` — passes
3. `pnpm -C packages/game-server exec tsx scripts/test-harness/combat-e2e.ts --scenario core/retaliatory-damage` — passes
4. `pnpm -C packages/game-server exec tsx scripts/test-harness/combat-e2e.ts --scenario core/caster-turn-damage` — passes
5. `pnpm -C packages/game-server exec tsx scripts/test-harness/combat-e2e.ts --all` — all 122+ scenarios pass (118 existing + 4 new)

## Dependencies

- Phase 10 ActiveEffect system (COMPLETE)
- Caster-turn trigger fix (COMPLETE)
- Existing E2E scenario runner with assertState, HP assertions, concentration assertions

## Complexity

Low — each scenario is a JSON file with character/monster setup + action steps. No code changes required (unless scenario runner needs new assertion types). The 4 scenarios are independent and can be developed in any order.
