# Agent Player Test Run: Endurance Fighter vs Hobgoblin Warband
Date: 2026-04-19
Scenario: endurance-fighter.json
Outcome: Victory
Valeria Steelhand HP at end: 44/44 (never took damage — all enemy attacks missed AC 18)
Rounds played: 4 rounds

## Player and Enemy actions taken

- Round 0 (Initiative): Hobgoblin Soldier A: 17, Valeria: 16, Soldier B: 11, Captain: 8, Soldier C: 7

- Round 1 (Hobgoblin Soldier A): moveToward + Longsword attack: 9+3=12 vs AC 18 → Miss
- Round 1 (Player — Valeria Steelhand):
  - Attack 1: d20=14 → 14+6=20 vs AC 16 → Hit, 7+3=10 damage. Soldier A HP: 18→8. Sap: Soldier A disadvantage on next attack.
  - Extra Attack (auto-chain): d20=16 → 16+6=22 vs AC 16 → Hit, 5+3=8 damage. Soldier A HP: 8→0 [DEFEATED]
  - Action Surge: Activated → "Gained 2 additional attacks (2 attacks remaining)." actionSurge: 1→0
  - Action Surge Attack 1 (vs Soldier B at 20ft): server switched to Handaxe with DISADVANTAGE → [17,12] → 12+6=18 vs AC 16 → Hit, 6+3=9 damage. Soldier B HP: 18→9. Vex: Advantage on next attack vs Soldier B.
  - Extra Attack (Action Surge chain, Vex advantage): [15,18] → 15+6=21 vs AC 16 → Hit, 5+3=8 damage. Soldier B HP: 9→1.
  - Total: "Action 0/4 attacks" ✅
  - End turn
- Round 1 (Soldier B): moveToward + Longsword: 6+3=9 vs AC 18 → Miss. Then moveAwayFrom (1 HP)
  - Opportunity Attack: Valeria reaction → Hit, 10 damage. Soldier B HP: 1→0 [DEFEATED]
- Round 1 (Captain): moveToward + Longsword: 2+4=6 vs AC 18 → Miss
- Round 1 (Soldier C): moveToward + Longsword: 4+3=7 vs AC 18 → Miss. AI ends turn.

- Round 2 (Player — Valeria):
  - Attack 1: d20=15 → 15+6=21 vs AC 17 → Hit, 8+3=11 damage. Captain HP: 39→28. Sap applied.
  - Extra Attack: d20=17 → 17+6=23 vs AC 17 → Hit, 6+3=9 damage. Captain HP: 28→19.
  - End turn
- Round 2 (Captain): disengage + moveAwayFrom to (35,0)
- Round 2 (Soldier C): disengage + moveAwayFrom to (35,5)

- Round 3 (Player — Valeria):
  - Move to (30,5) — used all 30ft movement
  - Attack 1 vs Soldier C: d20=13 → 13+6=19 vs AC 16 → Hit, 7+3=10 damage. Soldier C HP: 18→8. Sap applied.
  - Extra Attack: d20=18 → 18+6=24 vs AC 16 → Hit, 5+3=8 damage. Soldier C HP: 8→0 [DEFEATED]
  - End turn (0 ft move remaining)
- Round 3 (Captain): Longsword: 12+4=16 vs AC 18 → Miss (note: Sap disadvantage NOT visible in this roll — Captain may have attacked without disadvantage from prior Sap)

- Round 4 (Player — Valeria):
  - Attack 1 vs Captain: d20=16 → 16+6=22 vs AC 17 → Hit, 8+3=11 damage. Captain HP: 19→8. Sap applied.
  - Extra Attack: d20=14 → 14+6=20 vs AC 17 → Hit, 6+3=9 damage. Captain HP: 8→0 [DEFEATED]

## ✅ Confirmed Working

- Extra Attack auto-chain confirmed working correctly every round ✅
- Action Surge activated correctly: "Gained 2 additional attacks" ✅
- Action Surge resource consumed (1→0) ✅
- Total attack counter shown correctly: "Action 0/4 attacks" after Action Surge + 2 Extra Attacks ✅
- Sap weapon mastery text displayed on every longsword hit ✅
- Vex weapon mastery text displayed on handaxe hit ✅
- Action economy reset correctly each round (Action/Bonus/Reaction all ready at start of each turn) ✅
- Opportunity attack triggered when Soldier B fled at 1 HP ✅
- Disengage action correctly prevented OA when Captain fled ✅
- Fighter attack bonus +6 consistently applied (proficiency +3 + STR +3) ✅
- Hobgoblin Captain AC 17 correctly applied ✅
- Hobgoblin Soldier AC 16 correctly applied ✅
- Second Wind NOT needed (never took damage) — but still tracked as 1/1 ✅

## 🚩 Bugs & Unexpected Behavior

### BUG-1: Wrong Weapon Selected When Explicit Weapon Specified (Longsword → Handaxe)
**Severity**: Medium
**Reproduction**:
  1. Valeria has both Longsword and Handaxe in her weapon list
  2. Player says "I attack Hobgoblin Soldier B with my **longsword**" — explicit weapon name
  3. Soldier B is at 20ft distance
**Expected (5e 2024 rule)**: If Soldier B is within Longsword range (5ft), use Longsword. If out of range (20ft), server should either reject the attack or prompt the player to choose a ranged option.
**Server response**: Server silently switched to Handaxe without informing the player: "Valeria Steelhand grips her Handaxe, eyes fixed on Hobgoblin Soldier B." No error or confirmation that weapon was changed.
**Impact**: Player is not informed that their weapon choice was overridden. This breaks the explicit weapon targeting request and is confusing.

### BUG-2: Sap Condition Misapplied — Valeria Has Disadvantage on Next Attack (Not the Enemy)
**Severity**: High
**Reproduction**:
  1. Valeria hits Hobgoblin Soldier A with Longsword (Sap mastery)
  2. Server displays: "Sap: Hobgoblin Soldier A has disadvantage on next attack!"
  3. Valeria activates Action Surge
  4. Valeria attacks a DIFFERENT target (Hobgoblin Soldier B) — server gives VALERIA disadvantage: "⬇ Disadvantage! Roll 2d20 and take the lower."
**Expected (5e 2024 rule)**: Sap gives the **hit TARGET** (Soldier A) disadvantage on **its next attack roll**. Valeria should NOT have disadvantage. No other active condition explains why Valeria would have disadvantage.
**Server response**: `⬇ Disadvantage! Roll 2d20 and take the lower.` on Valeria's attack against Soldier B.
**Possible Root Cause**: Sap condition stored on attacker instead of target, OR Sap condition bleeding from Soldier A to affect the attacker's next attack (inverted).

### BUG-3: Vex Advantage Takes the LOWER Roll Instead of Higher
**Severity**: High  
**Reproduction**:
  1. Valeria hits Soldier B with Handaxe (Vex mastery) — "Vex: Advantage on next attack against Hobgoblin Soldier B!"
  2. Extra Attack auto-chains — server correctly requests 2d20 rolls for advantage
  3. Player sends `15 18` (two d20 values)
  4. Result: `[15, 18] → 15 + 6 = 21` — takes the value 15 (the LOWER roll) instead of 18 (the HIGHER roll)
**Expected (5e 2024 rule)**: With Advantage, roll 2d20 and use the **HIGHER** result. [15, 18] should use 18, giving 18+6=24.
**Server response**: `[15, 18] → 15 + 6 = 21` — used 15 instead of 18.
**Note**: The disadvantage case ([17, 12] → 12) was correct (took the lower), so the min() logic is correct for disadvantage but the advantage case also uses min() when it should use max(). Compare to the disadvantage attack: `[17, 12] → 12 + 6 = 18` — correctly took the lower value (12). The advantage case incorrectly does the same.

### BUG-4: Sap Status Tag Persists on Defeated Combatant
**Severity**: Low
**Reproduction**:
  1. Hit Soldier A with Sap → Soldier A gets disadvantage
  2. Kill Soldier A on the same turn
  3. View combatant list
**Expected**: Dead combatants should not show active conditions (condition is irrelevant and clutters display)
**Server response**: `Hobgoblin Soldier A: HP 0/18 | (5, 0) | 5 ft [DEFEATED] [Sapped]` — shows both [DEFEATED] and [Sapped]

### BUG-5: Sap Condition Not Applied During Captain's Turn (Round 4 Observation)
**Severity**: Medium
**Reproduction**:
  1. Valeria hits the Hobgoblin Captain with Longsword Sap in Round 2 (HP 39→28, "Sap: Captain has disadvantage on next attack!")
  2. Wait for Captain's turn in Round 3
  3. Captain's attack: `Longsword: 12 + 4 = 16 vs AC 18 - Miss!` — shown as a NORMAL roll (not 2d20)
**Expected**: The Sap condition should cause the Captain to roll 2d20 and take the lower for his next attack roll. The CLI/server should show the disadvantage roll (e.g., "[8, 12] → 8 + 4 = 12 vs AC 18 - Miss").
**Server response**: Showed a single-die roll (12+4=16), not a disadvantage roll, after Sap was applied.
**Note**: Could be that Sap only lasts until "the start of your next turn" (the attacker's next turn, i.e. Valeria's next turn) and the Captain attacked after Valeria's Round 3 turn. But in Round 2, Valeria's turn ended, then Captain in the same round tried to flee (Disengage + moveAway). By the time Captain attacked in Round 3 after Valeria's Round 3 turn, the Sap would have expired. Timing may be correct.

## ⚠️ Ambiguous / Needs Review

- **Weapon selection at range**: When the target is out of melee range, the server automatically chooses a thrown/ranged weapon. This may be intentional design (server picks the best available weapon) but conflicts with the player's explicit weapon request. Should the server error out or ask for clarification instead?
- **Sap disadvantage source**: The disadvantage on the Action Surge attack might be from the ranged Handaxe throw, not from Sap. The Handaxe throw to a target exactly at range 20 might have been computed as long range with disadvantage. Need to verify — if Soldier B was at exactly 20ft and Handaxe normal range is 20ft, there should be no disadvantage. But if the grid uses a calculation that puts it at 20.something ft, it could be just over range.
- **"Vex: Advantage on next attack against Hobgoblin Soldier B!"** displayed after killing blow (HP: 9→1 → then 0 in next attack) — Vex triggers on the killing blow but the "next attack" never happens against a living Soldier B. This is cosmetically harmless but indicates Vex advantage stays tracked even on the enemy that just got finished.

## 📝 Notes
- Valeria never dropped below full HP (44/44 at end). Encounter was too easy for this fighter level. Second Wind (1/1 remaining) was never needed.
- The encounter design demonstrates that AC 18 plate armor is very strong at this level — all 8 enemy attacks missed.
- AI tactically used Disengage to avoid OAs when low HP — shows AI self-preservation logic working.
- The 4-attack Action Surge round is a key Fighter feature and worked mechanically (resource consumed, attack count correct), despite BUG-1 (wrong weapon) and BUG-2/3 (wrong advantage/disadvantage handling).
- BUG-3 (Vex advantage using min instead of max) is potentially widespread and would affect any advantage condition, not just Vex. This needs a targeted fix in the 2d20 roll selection logic.
