# Plan: Class Features — Phase 8

## Overview

Expand class feature coverage beyond the current Monk (HIGH) and Fighter (HIGH) focus.
Prioritized by: (1) what's closest to working, (2) most combat-impactful, (3) most commonly used in play.

## Current Status (102 E2E, 458 unit tests)

| Class | Level | Executors | Scenarios | Priority |
|-------|:-----:|:---------:|:---------:|:--------:|
| Barbarian | Medium | 2 (Rage, Reckless) | 2 | **P1** |
| Rogue | Medium | 1 (Cunning Action) | 3 | **P1** |
| Paladin | Low-Med | 1 (Lay on Hands) | 2 | **P2** |
| Cleric | Low | 1 (Turn Undead) | 2 | **P2** |
| Warlock | Low | 0 | 1 | **P3** |
| Bard | Stub | 0 | 0 | **P4** |
| Sorcerer | Stub | 0 | 0 | **P4** |
| Druid | Stub | 0 | 0 | **P5** |
| Ranger | Stub | 0 | 0 | **P5** |

## Phase 8.1 — Barbarian Gaps (Small-Medium)

Domain exists: Rage resource pool, Rage damage bonus, combat text profile (rage + reckless-attack).

| # | Feature | Gap | Complexity |
|---|---------|-----|-----------|
| 1 | Rage damage resistance | Rage executor starts rage but doesn't grant resistance to B/P/S damage | Small |
| 2 | Unarmored Defense | AC = 10 + DEX + CON when no armor — need AC override check in attack resolution | Small |
| 3 | Danger Sense | Advantage on DEX saves you can see — flag in combatant resources | Small |
| 4 | Extra Attack (Barbarian Lv 5) | Barbarian-specific extra attack action economy | Medium — may already work if Fighter's Extra Attack logic is class-agnostic |
| 5 | Rage end mechanics | Rage ends if: didn't attack/take damage since last turn, or knocked unconscious | Medium |
| 6 | Feral Instinct (Lv 7) | Advantage on initiative — add to initiative roll logic | Small |

### E2E Scenarios
- `barbarian/rage-resistance.json` — take B/P/S damage while raging → half damage
- `barbarian/unarmored-defense.json` — no armor, AC = 10 + DEX + CON
- `barbarian/rage-ends.json` — rage expires when no attacks/damage for a round
- `barbarian/extra-attack.json` — Lv 5 Barbarian gets two attacks

## Phase 8.2 — Rogue Gaps (Small-Medium)

Domain exists: Sneak Attack eligibility (finesse/ranged + advantage or adjacent ally), Cunning Action executor.

| # | Feature | Gap | Complexity |
|---|---------|-----|-----------|
| 1 | Rogue combat text profile | No `ROGUE_COMBAT_TEXT_PROFILE` registered — Sneak Attack handled inline | Small |
| 2 | Uncanny Dodge (Lv 5) | `capabilitiesForLevel` declares it but no reaction implementation | Medium |
| 3 | Evasion (Lv 7) | `capabilitiesForLevel` declares it but no save modification | Medium |
| 4 | Steady Aim (2024 optional) | Bonus action → advantage on next attack, but can't move that turn | Small-Med |

### E2E Scenarios
- `rogue/uncanny-dodge.json` — halve damage from visible attacker as reaction
- `rogue/evasion.json` — DEX save for half → 0 damage on success, half on fail
- `rogue/steady-aim.json` — bonus action advantage, movement locked

## Phase 8.3 — Paladin Gaps (Medium)

Domain exists: Lay on Hands pool, Channel Divinity pool, Divine Smite damage dice.

| # | Feature | Gap | Complexity |
|---|---------|-----|-----------|
| 1 | Divine Smite 2024 revision | Current: free rider on melee hit. 2024: it's a bonus-action spell | Medium |
| 2 | Aura of Protection (Lv 6) | Allies within 10ft add CHA to saves — combat-wide aura check | Medium |
| 3 | Extra Attack (Lv 5) | Same as Barbarian — ensure class-agnostic | Small |

### E2E Scenarios
- `paladin/divine-smite-2024.json` — bonus action spell version
- `paladin/aura-of-protection.json` — ally within aura gets save bonus

## Phase 8.4 — Cleric Gaps (Medium)

Domain exists: Channel Divinity pool, Turn Undead executor.

| # | Feature | Gap | Complexity |
|---|---------|-----|-----------|
| 1 | Divine Spark (Lv 2, 2024) | Heal 1d8×uses OR deal same as radiant to undead | Medium |
| 2 | Sear Undead (Lv 5, 2024) | Turn Undead adds radiant damage to failing undead | Small |
| 3 | Blessed Strikes (Lv 7, 2024) | +1d8 radiant on weapon/cantrip once per turn | Medium |

### E2E Scenarios
- `cleric/divine-spark-heal.json` — Channel Divinity to heal
- `cleric/divine-spark-damage.json` — Channel Divinity radiant damage
- `cleric/sear-undead.json` — Turn Undead + radiant damage

## Phase 8.5 — Warlock / Bard / Sorcerer Stubs (Medium-Large)

These need both domain + executor + profile work from scratch.

| # | Class | Feature | Complexity |
|---|-------|---------|-----------|
| 1 | Warlock | Eldritch Blast multi-beam | Medium-Large |
| 2 | Bard | Bardic Inspiration action + reaction (2024) | Medium |
| 3 | Sorcerer | Metamagic (Quickened, Twinned) | Large |

## Phase 8.6 — Druid / Ranger Stubs (Large)

| # | Class | Feature | Complexity |
|---|-------|---------|-----------|
| 1 | Druid | Wild Shape transformation | Very Large — new entity system for beast forms |
| 2 | Ranger | Hunter's Mark (free cast 2024) | Medium |

## Dependencies

- Extra Attack logic should be class-agnostic (currently Fighter-specific check in `action-dispatcher.ts`)
- Evasion logic (Rogue/Monk) needs save result modification hook
- Aura of Protection needs proximity-based save bonus system
- Wild Shape needs a form substitution system for stats/attacks

## Implementation Order

1. Phase 8.1 (Barbarian) — closest to done, most bang for buck
2. Phase 8.2 (Rogue) — Uncanny Dodge and Evasion are high-value
3. Phase 8.3 (Paladin) + Phase 8.4 (Cleric) — can be parallelized
4. Phase 8.5 (Warlock/Bard/Sorcerer) — larger scope
5. Phase 8.6 (Druid/Ranger) — largest scope, lowest priority

## Complexity

Large — spans multiple phases across many sessions. Each sub-phase is independently shippable.
