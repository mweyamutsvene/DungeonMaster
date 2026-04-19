# Agent Player Test Run: Wounded Fighter
Date: 2026-04-19
Scenario: wounded-fighter.json
Outcome: Victory
Thorin HP at end: 26/42
Rounds played: 2

## Player and Enemy Actions Taken

### Round 0 (Enemy Initiative)
- Goblin Warrior 1 (initiative 17) went first vs Thorin (initiative 16)
  - moveToward: Goblin moved to (20,5)
  - Attack: Scimitar 5+4=9 vs AC 18 → Miss
  - Nimble Escape: Disengage
  - moveAwayFrom: Retreated to stay out of reach

### Round 1 (Player Turn)
- **Second Wind**: Healed 8 HP (rolled 3 + 5 level). HP 18→26. secondWind 1→0
- **Attack 1 vs Goblin 1 (nearest, at 20,5)**:
  - Said "longsword" — server used Handaxe (BUG-H1)
  - d20=15 → 15+6=21 vs AC 15 → Hit
  - Damage 1d6+3: rolled 5 → 5+3=8. Goblin 1 HP 7→0 DEFEATED
- **Move + Attack 2 vs Goblin at (40,20)**: 
  - Requested "move to (35,20) and attack the Goblin Warrior with my longsword"
  - Move was IGNORED — position stayed at (10,10) (BUG-H2)
  - Attack hit the ALREADY DEAD Goblin 1 (HP 0→0) instead of living target (BUG-H3)
  - d20=12 → 12+6=18 vs AC 15 → Hit (on dead target)
  - Damage 1d6+3: rolled 4 → 4+3=7. Goblin HP 0→0 (wasted)
- **Action Surge**: Activated. "Gained 2 additional attacks (2 attacks remaining)." actionSurge 1→0
- **Action Surge Attack 1 vs Goblin at (40,20)**:
  - Said "longsword" — server used Handaxe with DISADVANTAGE (30ft = long range for thrown weapon) (BUG-H4)
  - 2d20=[14,11] → 11+6=17 vs AC 15 → Hit
  - Damage 1d6+3: rolled 5 → 5+3=8. Goblin HP 7→0 DEFEATED
- **Action Surge Attack 2 vs Goblin at (40,30)**:
  - Again Handaxe with disadvantage
  - 2d20=[16,13] → 13+6=19 vs AC 15 → Hit
  - Damage 1d6+3: rolled 4 → 4+3=7. Goblin HP 7→0 DEFEATED
- **Turn ended**

### Round 1 (Enemy AI Turns)
- Goblin 4 (only survivor, was at 40,40):
  - moveToward: Moved from (40,40) to (20,20)
  - Attack Thorin with Scimitar → **FAILED**: "Target is 10ft away, but Scimitar has 5ft reach. Move closer first." (BUG-H5)
  - Turn ended (no retry)

### Round 2 (Player Turn)
- **Move + Attack 1 vs last Goblin**:
  - Requested "move to (15,20) and attack the Goblin Warrior with my longsword"
  - Move AGAIN IGNORED — position still (10,10) (BUG-H2 persists)
  - Again hit a DEAD goblin (HP 0→0) (BUG-H3 persists)
- **Attack 2 — "I attack the living Goblin Warrior"**:
  - This time targeted the living goblin at (20,20)
  - d20=14 → 14+6=20 vs AC 15 → Hit
  - Damage 1d6+3: rolled 5 → 5+3=8. Goblin HP 7→0 DEFEATED
  - **VICTORY!**

## ✅ Confirmed Working
- Second Wind: Correctly healed (1d10+level), correctly consumed resource (1→0)
- Action Surge: Correctly granted 2 additional attacks, correctly consumed resource (1→0)
- Extra Attack: 2 attacks per action correctly enforced (Action 0/2, then 0/4 with Action Surge)
- Turn economy tracking: Bonus action consumed by Second Wind, Action/attacks tracked properly
- Initiative system: Goblin won initiative (17 vs 16) and acted first
- AI Nimble Escape: Goblin correctly used Disengage as bonus action then moved away
- Victory detection: All enemies defeated → combat ended correctly
- **Server crash fix validated**: AI turns processed successfully — no more unhandled rejections crashing the server

## 🚩 Bugs & Unexpected Behavior

### BUG-H1: Server ignores weapon choice — always uses Handaxe instead of Longsword
**Severity**: High
**Reproduction**:
  1. Say "I attack the Goblin Warrior with my longsword"
  2. Server narrates "Thorin Ironfist raises his Handaxe" and uses 1d6+3 damage
**Expected (5e 2024 rule)**: Longsword should deal 1d8+3 (versatile 1d10+3 two-handed). Player explicitly chose longsword.
**Server response**: Always uses Handaxe (1d6+3) regardless of player weapon choice. LLM narration even says "Handaxe".
**Notes**: This is a persistent bug also seen in prior test runs (BUG-5 in test matrix). The wounded-fighter scenario sheet includes Longsword as first attack, Handaxe as second. The server appears to always pick the first weapon or a different weapon than requested.

### BUG-H2: "Move to (X,Y) and attack" — movement is completely ignored
**Severity**: High
**Reproduction**:
  1. Send "I move to (35, 20) and attack the Goblin Warrior with my longsword"
  2. Position remains at (10, 10) throughout entire combat
  3. Repeated with "I move to (15, 20) and attack" — still (10, 10)
**Expected**: Thorin should move to the requested position (spending movement), THEN attack
**Server response**: Position never changes from (10,10). The "Move 30 ft" remains in turn economy. Movement part of compound commands silently dropped.
**Notes**: This means all attacks were thrown at 30ft range (causing disadvantage cascade in BUG-H4).

### BUG-H3: Attacks target dead/defeated combatants instead of living ones
**Severity**: High
**Reproduction**:
  1. Kill Goblin 1 at (20,5)
  2. Send "I attack the Goblin Warrior" or even specify coordinates of a living goblin
  3. Server targets the dead Goblin 1 (HP 0→0) 
  4. Happened twice: 2nd attack in round 1, and 1st attack in round 2
**Expected**: Dead/0HP combatants should be excluded from targeting. When multiple goblins share the same name, the server should target the nearest LIVING one.
**Server response**: `HP: 0 → 0` — damage applied to already-dead goblin, attack wasted
**Workaround**: Saying "I attack the living Goblin Warrior" worked on the 2nd try in round 2.

### BUG-H4: Handaxe causes disadvantage at range (cascade from BUG-H1 + BUG-H2)
**Severity**: Medium (cascade)
**Reproduction**:
  1. Because movement is ignored (BUG-H2), Thorin stays at (10,10)
  2. Because server uses Handaxe (BUG-H1) instead of longsword
  3. Handaxe is thrown weapon with 20/60 range. At 30ft, it's in long range → disadvantage
  4. Server correctly applies disadvantage for long-range thrown attack
**Expected**: If using longsword (melee), player should need to be within 5ft. If movement worked (BUG-H2 fixed), player would be in melee range.
**Notes**: The disadvantage itself is mechanically correct for a thrown handaxe at 30ft. The root causes are BUG-H1 and BUG-H2.

### BUG-H5: AI goblin fails to attack after moveToward — stops 10ft away with 5ft reach weapon
**Severity**: Medium
**Reproduction**:
  1. Last surviving Goblin at (40,40) uses moveToward
  2. Moves to (20,20) — now 10ft from Thorin at (10,10)
  3. Attempts Scimitar attack → "Target is 10ft away, but Scimitar has 5ft reach. Move closer first."
  4. Turn ends without attack
**Expected (5e 2024 rule)**: Goblin has 30ft speed. Distance from (40,40) to (10,10) ≈ 42ft. After moving 30ft it should be ≈12ft away. But the AI should calculate remaining movement and get within 5ft, or at minimum the second AI decision should be another moveToward, not attack.
**Server response**: AI made only one moveToward decision then immediately tried to attack from 10ft. The AI wasted its turn.

## ⚠️ Ambiguous / Needs Review
- **Second Wind as bonus action**: Used Second Wind, which correctly consumed the bonus action slot (shown as "Bonus used"). However, the action prompt showed `> I use second wind` as separate from the attack. In 5e 2024, Second Wind IS a bonus action — this is correct behavior. But it means the first attack hit prompt said "Enter your d20 roll for at15ck:" (corrupted text — minor display bug).
- **Attack bonus +6**: Thorin has STR 16 (+3) + proficiency 3 = +6. This is correct for both longsword and handaxe.
- **Turn economy display**: After Action Surge, showed "Action 0/4 attacks" (2 base + 2 surge). This is correct.
- **Goblin at (40,40) missing from initial first goblin turn**: Only Goblin 1 acted in round 0. The other 3 goblins (initiative 12, 6, 6) should have had turns too. It appears only the first goblin in initiative got a turn before Thorin. Need to verify if the others acted but output was consumed, or if there was a turn-order bug.

## 📝 Notes
- **Server crash fix validated**: The main goal of re-running this test was to verify the crash fix (process-level handlers in main.ts + try/catch in ai-turn-orchestrator.ts). The server survived all AI turns without crashing. Fix is confirmed working.
- **Corrupted prompt text**: "Enter your d20 roll for at15ck:" — the "15" from the attack roll bled into the prompt text. Minor display/timing bug in CLI.
- **BUG-H1, H2, H3 are the most impactful**: These three bugs fundamentally break the melee fighter experience. Movement doesn't work, weapon choice is ignored, and dead targets get re-attacked.
- **5e rules note on Handaxe**: Handaxe is Light, Thrown (20/60), 1d6 slashing. Longsword is Versatile (1d8/1d10), no Thrown. The scenario sheet lists both. Server should respect player's explicit weapon choice.
