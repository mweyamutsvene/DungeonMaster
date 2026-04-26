# Agent Player Test Run: Monk vs Monk
Date: 2026-04-25
Scenario: monk-vs-monk-smoke.json
Outcome: Victory
Thorin HP at end: Kai Stormfist 36/36
Rounds played: 4

## Player and Enemy actions taken
- Round 1 (Player): Initiative d20=14 -> 17 total vs Vex 13. Moved 25 ft from (0,0) to (25,0).
- Round 1 (Player): Attack 1 with Unarmed Strike: d20=16 -> 22 vs AC 15 -> Hit. Damage roll `5 with stunning strike` -> 8 damage (Vex 33 -> 25). Server auto-resolved Stunning Strike as failed CON save `5 vs DC 14`; Stunned applied.
- Round 1 (Player): Extra Attack: d20=15 -> 21 vs AC 15 -> Hit. Damage d8 face=4 -> 7 damage (Vex 25 -> 18).
- Round 1 (Player): Flurry of Blows activated from bonus action window. Flurry attack 1: d20=13 -> 19 vs AC 15 -> Hit. Damage d8 face=3 -> 6 damage (Vex 18 -> 12).
- Round 1 (Player): Flurry attack 2: d20=12 -> 18 vs AC 15 -> Hit. Damage d8 face=4 -> 7 damage (Vex 12 -> 5).
- Round 1 (Enemy): Vex Nightthorn lost the turn due to Stunned. Server output: `Vex Nightthorn is stunned and cannot act!`
- Round 2 (Player): Used `patient defense`. Server output: `Dodged (bonus action via Patient Defense, spent 1 ki)`.
- Round 2 (Enemy): AI used `disengage`, then `moveAwayFrom` with Step of the Wind. Output: `Vex disengages to avoid opportunity attacks while retreating.` followed by `Vex uses Step of the Wind to dash away from Kai, moving to safety.` Vex final position shown at (60,0), 35 ft away.
- Round 3 (Player): Used `I move next to Vex Nightthorn.` Server moved Kai from (25,0) to (55,0) and reported `Moved to (55, 0) (30ft)`. A second identical move command then returned `Already within 5ft of the target.`
- Round 3 (Enemy): AI used `dash`. Output: `Vex unleashes Step of the Wind and dashes away from Kai, retreating to safety.` Despite that text, the combat panel still showed Kai at (55,0), Vex at (60,0), distance 5 ft.
- Round 4 (Player): Attack 1 with Unarmed Strike: d20=11 -> 17 vs AC 15 -> Hit. Damage d8 face=2 -> 5 damage (Vex 5 -> 0). Victory triggered.
- Post-combat: Chose `5` to quit. Control server closed immediately afterward.

## ✅ Confirmed Working
- Player ki tracking worked for the tested abilities: Kai resources moved from `ki: 5/5` to `4/5` after Stunning Strike, `3/5` after Flurry of Blows, and `2/5` after Patient Defense.
- Monk Extra Attack auto-chained correctly after the first Attack action and returned a second attack prompt.
- Flurry of Blows correctly produced two separate bonus-action attack prompts and consumed 1 ki.
- Stunning Strike successfully applied Stunned and the enemy lost its next turn.
- Patient Defense was accepted as a bonus action and consumed 1 ki.
- Enemy AI used monk-flavored escape sequencing (`disengage`, `moveAwayFrom`, `dash`, Step of the Wind flavored narration), which suggests the retreat behavior is wired into the scenario.

## 🚩 Bugs & Unexpected Behavior

### BUG-1: Attacks against adjacent stunned target did not prompt for advantage
**Severity**: Medium
**Reproduction**:
  1. Stun Vex Nightthorn with Stunning Strike while adjacent.
  2. Continue with Extra Attack and Flurry of Blows while Vex remains Stunned and 5 ft away.
  3. Each follow-up attack prompt asks for a normal single d20 roll instead of indicating advantage.
**Expected (5e 2024 rule)**: Melee attacks against a stunned target within 5 feet should be made with advantage, so the CLI should instruct the player to roll 2d20 and submit the higher result.
**Server response**: `Roll a d20 for attack against Vex Nightthorn (no modifiers; server applies bonuses). Enter your d20 roll for attack:` and later `Second strike: Roll a d20.`

### BUG-2: Retreat narration and position state diverged after Step of the Wind dash
**Severity**: Medium
**Reproduction**:
  1. Leave Vex alive at 5 HP and end turn from adjacent range.
  2. Let the AI execute its retreat turn.
  3. Observe the combat log claim Vex dashed away to safety, but the board still shows Vex only 5 ft away.
**Expected (5e 2024 rule)**: A dash/Step of the Wind retreat should materially increase separation on the map and the narrated movement should match the final coordinates and distance.
**Server response**: `Vex unleashes Step of the Wind and dashes away from Kai, retreating to safety.` followed immediately by a combat panel showing `Kai Stormfist: HP 36/36 | (55, 0)` and `Vex Nightthorn: HP 5/33 | (60, 0) | 5 ft`.

## ⚠️ Ambiguous / Needs Review
- Deflect Attacks reaction was not observed. Vex never landed a hit on Kai because the first round stun lock removed its best attack window, and later AI turns were pure retreat behavior.
- The scenario goal says to flag turns where ki is not properly tracked separately per combatant. Kai's ki tracked correctly, but the UI did not expose Vex's ki pool directly enough to verify separate decrement values.
- After Kai gained a 40 ft move speed panel, `I move next to Vex Nightthorn.` only advanced Kai 30 ft on the first prompt, then a second identical prompt claimed Kai was already within 5 ft. That may indicate movement-parser truncation or only a presentation mismatch.
- Stunning Strike did not prompt for an explicit enemy CON roll input; the server auto-resolved `fails CON save (5 vs DC 14)`. That may be acceptable for AI enemies, but it is worth confirming that this is intentional for live interactive tests.

## 📝 Notes
- This run cleanly exercised the player monk resource loop and exposed one solid combat-rules issue plus one spatial/state consistency issue.
- Because the control server shut down immediately after choosing `5`, there was no final `/output` poll after exit; combat completion and victory were already fully captured before quit.