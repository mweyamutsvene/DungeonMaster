# Agent Player Test Run: Solo Monk vs Orc Brute
Date: 2026-04-13
Scenario: solo-monk
Outcome: Victory
Monk HP at end: 36/36 (untouched)
Rounds played: 2 (Kai's turns; Orc went first both rounds)
Ki spent: 1 confirmed (Flurry of Blows); Stunning Strike unverifiable (see BUG-1)

---

## ✅ Confirmed Working

- **Ki pool initializes correctly**: Kai Stormfist started combat with `ki: 5/5` — correct for Level 5 Monk.
- **Uncanny Metabolism tracked**: `uncanny_metabolism: 0/1` displayed as a separate once-per-long-rest resource — correct for 2024 PHB Monk Level 2 feature.
- **Flurry of Blows: 2 bonus strikes granted**: After `"I use flurry of blows"`, the server chained exactly 2 attack rolls sequentially, matching the 5e rule of 2 unarmed strikes as a bonus action.
- **Flurry of Blows: ki decrements correctly**: Ki went from `5/5` → `4/5` after Flurry of Blows, visible in the COMBATANTS display at the start of Round 2. Cost of 1 ki verified.
- **Unarmed Strike damage die is 1d8 at Level 5**: Prompt showed `Roll 1d8+3 for damage` for all unarmed strikes (main action and both Flurry strikes). Per 5e 2024, Monk Martial Arts die at Level 5 is 1d8 — correct.
- **Attack bonus is +6**: `14 + 6 = 20 vs AC 13` — proficiency (+3 at Level 5) + DEX modifier (+3) = +6. Correct.
- **Stunning Strike option offered on ALL hits (including Flurry)**: Every unarmed hit — main action hit, Flurry Strike 1, and Flurry Strike 2 — showed:
  ```
  ⚔ On-hit abilities available:
    • Stunning Strike: include "with stunning strike" in your roll
  ```
  This is correct per 5e 2024 — Stunning Strike can be used on any hit if ki is available.
- **Stunning Strike keyword parsed on damage roll**: Sending `"6 with stunning strike"` was accepted by the server without error.
- **Orc Brute AI uses tactical behavior**: At low HP, it used Disengage + moveAwayFrom to flee; appropriate AI decision for survival.
- **Combat ended correctly**: `HP: 6 → 0. Victory!` on lethal hit.

---

## 🚩 Bugs & Unexpected Behavior

### BUG-1: Stunning Strike on Lethal Hit — CON Save Not Triggered, Ki Spend Unverifiable
**Severity**: Medium  
**Reproduction**:
1. Start solo-monk scenario.
2. Orc Brute has 6 HP remaining.
3. Attack with unarmed strike (hit) and enter damage as `"6 with stunning strike"`.
4. Server applies 9 total damage (6 roll + 3 mod), killing the orc instantly.
5. Observe: no CON save prompt is shown. Victory screen appears immediately.

**Expected (5e 2024 rule)**: Stunning Strike is declared when you hit (before damage). You spend 1 ki point and the target attempts a CON saving throw (DC = 8 + proficiency bonus + WIS modifier). If creatures drop to 0 HP from the hit's damage, the stun condition is irrelevant — the save should be skipped as a correct optimization. However, the ki point **should still be spent** (you declared the technique before knowing the outcome). The server's behavior of skipping the save on a lethal hit is potentially correct, but **ki was not visibly decremented** in the victory display.

**Server response**: `6 + 3 = 9 damage to Orc Brute! HP: 6 → 0. Victory!` — no save prompt, no ki decrement confirmation, combat ended immediately.

**Impact**: Cannot confirm whether:
  - (a) The ki point was NOT spent (incorrect — ki should be spent on declaration)
  - (b) The ki WAS spent but the victory screen doesn't re-show resources  
  - (c) The server correctly skipped both the save AND the ki cost (reasonable QoL behavior, not strictly rule-accurate)

**Recommendation**: In a non-lethal scenario, verify Stunning Strike prompts a CON save and decrements ki.

---

### BUG-2: Monk Extra Attack (Level 5) Not Available as Part of Action
**Severity**: Low / Needs Verification  
**Observation**: At Level 5, the Monk can make 2 attacks when taking the Attack action (Extra Attack). When `"I attack with unarmed strike"` was entered in Round 1, only 1 attack roll was prompted. The second attack of Extra Attack was not automatically chained.

**Expected (5e 2024 rule)**: A Level 5 Monk with Extra Attack gets 2 attacks when taking the Attack action — before any Flurry of Blows bonus action. The action attack should prompt 2 sequential attack rolls.

**Server response**: Only 1 attack roll prompted for the main action: `Enter your d20 roll for attack`. After that resolved, the prompt returned to `>` without chaining a second attack.

**Note**: The Flurry of Blows bonus action did chain 2 attacks, so the multi-attack chaining mechanism exists. It may be that Monk Extra Attack simply isn't plumbed in, or the character sheet was built without Extra Attack at Level 5.

**Recommendation**: Review whether `Kai Stormfist` character sheet has the Extra Attack feature at Level 5, and whether the tabletop attack handler chains multiple attacks for it. 

---

## ⚠️ Ambiguous / Needs Review

- **Patient Defense not tested**: Combat ended in Round 2 before Patient Defense could be tested. A dedicated Round 3 was planned but combat ended from the lethal Stunning Strike hit. Suggest a future run where the Orc Brute is given more HP to allow all three ki abilities to be tested in sequence.

- **Stunning Strike CON save DC**: Never observed. Expected DC = 8 + 3 (proficiency) + WIS mod. Kai's WIS modifier is unknown from this run. A non-lethal test scenario is needed to observe the actual DC displayed.

- **Orc Brute never attacked Kai**: In Round 1, the Orc used a move action to close distance but did not attack. In Round 2, it disengaged and fled. This means `Reaction` (e.g., an Opportunity Attack from Orc's move) was never tested, and Kai took 0 damage. Good for Kai, but limits testing coverage.

- **Third column in combatant display**: Values like `Orc Brute: HP 30/30 | (15, 5) | 5 ft` — the third `5 ft` value's meaning is ambiguous. Could be distance-to-nearest-enemy, combatant reach, or movement remaining. Documentation should clarify this display column.

---

## 📝 Notes

### Ki Tracking Summary
| Action | Expected ki cost | Ki after (displayed) |
|--------|-----------------|----------------------|
| Combat start | — | 5/5 ✅ |
| Flurry of Blows (Round 1) | 1 ki | 4/5 ✅ Confirmed |
| Stunning Strike (Round 2, lethal hit) | 1 ki | Unknown — combat ended |
| Patient Defense (Round 3) | 1 ki | Not tested |

**Net ki confirmed spent**: 1 (Flurry), 0 verified otherwise. Expected: 3+ for full scenario.

### Did Stunning Strike prompt a CON save?
No — the Orc Brute died from the damage before any save was requested. This is likely correct behavior (dead creatures don't save), but the ki cost transparency is unclear.

### Did Flurry give 2 extra attacks?
**Yes** — both Flurry strikes requested separate d20 attack rolls and d8+3 damage rolls sequentially. Confirmed correct.

### Orc Brute never got to attack
The Orc spent its Round 1 action on `moveToward` (move only, no attack), and Round 2 on `disengage + moveAwayFrom`. Kai took 0 damage. This prevented testing of defensive reactions (Patient Defense / Dodge effect).

### Unarmed Strike vs. Weapon Attack
All Kai's attacks were bare-handed unarmed strikes. None of the listed scenarios tested the Martial Arts free bonus action unarmed strike (after a weapon attack). This feature (attack with monk weapon → free unarmed strike bonus) remains untested for this character.
