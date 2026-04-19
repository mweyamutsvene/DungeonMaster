# Agent Player Test Run: Party vs Goblins (Party Dungeon)
Date: 2026-04-19
Scenario: party-dungeon.json
Outcome: Victory
Thorin HP at end: 36/42
Elara HP at end: 21/24
Rounds played: 2

## Player and Enemy Actions Taken

### Round 0 (Enemy Initiative)
- Turn order: Goblin Boss (18), Thorin (16), Elara the Wise (15), Goblin Archer (11), Goblin Warrior (3)
- **Goblin Boss**:
  - moveToward → moved to (15,5), 5ft from Thorin
  - Attack Thorin with Scimitar: 19+4=23 vs AC 18 → Hit! 6 damage. HP 42→36.

### Round 1 (Player Turn)
- **Attack 1 vs Goblin Boss** (5ft, melee):
  - Longsword correctly used (1d8+3)
  - d20=15 → 15+6=21 vs AC 17 → Hit
  - Damage: 7+3=10. Goblin Boss HP 21→11. Sap applied.
- **Extra Attack (auto-chain) vs Goblin Boss**:
  - d20=13 → 13+6=19 vs AC 17 → Hit
  - Damage: 8+3=11. Goblin Boss HP 11→0 DEFEATED.
- **Turn ended** (Action Surge and Second Wind still available, unused)

### Round 1 (Ally + Enemy Turns)
- **Elara the Wise** (NPC Wizard, AI-controlled):
  - Fire Bolt vs Goblin Archer: 7+5=12 vs AC 13 → Miss
- **Goblin Archer**:
  - Shortbow vs Elara: 12+4=16 vs AC 12 → Hit! 3 damage. Elara HP 24→21.
- **Goblin Warrior**:
  - Ended turn. "Used Nimble Escape to hide and avoid detection."
  - Did NOT move or attack — stayed at (40,30)

### Round 2 (Player Turn)
- **Move**: "I move to (35, 20)" — Moved 25ft from (10,10) to (35,20). Movement displayed correctly.
  - NOTE: Compound "move to (35,20) and attack" only executed the move part. Attack needed separate command.
- **Attack 1 vs Goblin Archer** (5ft from (35,20)):
  - d20=12 → 12+6=18 vs AC 13 → Hit
  - Damage: 5+3=8. Goblin Archer HP 7→0 DEFEATED.
- **Compound move+attack failed**: "I move to (35, 25) and attack the Goblin Warrior" → HTTP 400 "Target is out of reach (10ft > 5ft)". Move was NOT executed either.
- **Separate move**: "move to (35, 25)" → Moved 5ft successfully.
- **Attack 2 vs Goblin Warrior** (~7ft diagonal from (35,25) to (40,30)):
  - Server accepted attack at ~7ft diagonal (grid tolerance)
  - d20=14 → 14+6=20 vs AC 15 → Hit
  - Damage: 6+3=9. Goblin Warrior HP 7→0 DEFEATED.
  - **VICTORY!**

## ✅ Confirmed Working
- **Longsword correctly used**: 1d8+3 throughout (party-dungeon Thorin only has Longsword, no Handaxe — confirms BUG-H1 is multi-weapon related)
- **Extra Attack**: Auto-chained correctly, 2 attacks/action
- **Sap weapon mastery**: Applied after first hit on Goblin Boss
- **Movement system**: Standalone "move to (X,Y)" commands work correctly. Position tracked accurately at (35,20) then (35,25).
- **NPC ally (Elara the Wise)**: AI-controlled, took her turn automatically, targeted enemies with Fire Bolt. Correct behavior.
- **Goblin Archer ranged attack**: Correctly used Shortbow at range against Elara
- **Multi-combatant initiative**: 5 combatants tracked correctly in turn order
- **Server stability**: No crashes, all AI turns processed smoothly (5 combatants including NPC ally)
- **Path display**: "Path: (10,10) → (35,20) [25ft]" shown in combatant display — nice feature
- **Diagonal melee range tolerance**: Attack allowed at ~7ft diagonal distance (sqrt(5²+5²)≈7ft) — reasonable grid interpretation
- **Resource tracking**: actionSurge 1/1 and secondWind 1/1 shown but unused (fight was easy enough)

## 🚩 Bugs & Unexpected Behavior

### BUG-J1: Compound "move and attack" silently drops attack
**Severity**: Medium
**Reproduction**:
  1. Send "I move to (35, 20) and attack the Goblin Archer with my longsword"
  2. Server processes ONLY the move: "Moved to (35, 20) (25ft)."
  3. Returns to `>` prompt — attack is silently dropped
  4. Must send attack as a separate command
**Expected**: Server should parse compound move+attack and execute both parts
**Server response**: Only move executed, no error, no indication attack was ignored
**Notes**: This is distinct from BUG-H2 (where movement itself was ignored). Here movement works but the attack part of compound commands is dropped. The LLM parser appears to extract only the first action from compound commands.

### BUG-J2: Compound "move and attack" fails entirely when target out of reach from CURRENT position
**Severity**: Medium
**Reproduction**:
  1. At (35,20), Goblin Warrior at (40,30) = 10ft
  2. Send "I move to (35, 25) and attack the Goblin Warrior with my longsword"
  3. HTTP 400: "Target is out of reach (10ft > 5ft)"
  4. The move is NOT executed either — server checks range from current position before moving
**Expected**: Server should process move first, THEN check range for attack
**Server response**: Range check happens against pre-move position, entire compound command rejected
**Notes**: The 400 error implies the server tried to resolve the attack before the move. Combined with BUG-J1, compound move+attack is unreliable.

### BUG-J3: Goblin Warrior ended turn without acting (wasted turn)
**Severity**: Low
**Reproduction**:
  1. Goblin Warrior at (40,30), Thorin at (10,10) = 30ft
  2. AI decided: "ends turn" — "The goblin warrior stays in place, using Nimble Escape to hide"
  3. Did not move toward enemies or attack
**Expected (5e rules)**: With 30ft speed and a melee weapon (Scimitar +4), the goblin should move toward the nearest enemy and attack if in range, or at least close distance
**Server response**: AI chose to hide instead of engaging
**Notes**: This may be tactically valid (preserving stealth advantage for next turn), but seems suboptimal when allies are in combat nearby. The Goblin Boss was already engaging Thorin — the warrior should support.

### BUG-J4 (reconfirms BUG-H2): Movement ignored in wounded-fighter but works in party-dungeon
**Severity**: High (intermittent/scenario-dependent)
**Notes**: In wounded-fighter, "move to (35,20) and attack" ignored movement entirely (position stayed at 10,10). In party-dungeon, the same command format successfully moved to (35,20). The key difference may be:
  - wounded-fighter: Thorin has Longsword AND Handaxe in attack list
  - party-dungeon: Thorin has only Longsword
  - Or: wound-fighter's "move and attack" tried attack first (resolving handaxe throw), never executing move
  This suggests the LLM intent parser behaves differently based on weapon availability or other context.

## ⚠️ Ambiguous / Needs Review
- **Elara targeting**: Elara chose Goblin Archer over Goblin Warrior. Both were 30ft away. Archer is squishier (AC 13 vs 15) but similar HP. Reasonable AI choice.
- **Elara didn't move**: Stayed at (10,20) the whole fight. Fire Bolt has 120ft range, so staying back is tactically valid.
- **Goblin Archer targeted Elara not Thorin**: Archer hit Elara (AC 12) instead of Thorin (AC 18). Tactically smart — targets the squishier ally. Good AI behavior.

## 📝 Notes
- **Multi-combatant encounter works well**: 5 combatants (2 party, 3 enemy) tracked and acted in correct initiative order. No turn-order bugs.
- **NPC ally system functional**: Elara acts autonomously as AI-controlled party member. She attacks enemies, takes her turn in order, and the display shows her HP and position.
- **Fight was very easy**: Thorin killed the Goblin Boss in one action (2 attacks), then cleaned up remaining goblins in round 2. No healing needed (36/42 HP). Action Surge and Second Wind unused. Consider tougher scenarios.
- **Weapon selection correlation**: Longsword worked correctly in both party-dungeon (only weapon) and solo-paladin (only weapon). Handaxe substitution (BUG-H1) only occurs in wounded-fighter where both weapons exist. This strongly suggests the bug is in weapon selection when multiple weapons are available.
- **LLM response times acceptable**: All AI turns processed within reasonable time. No timeouts or Ollama contention issues (contrast with prior party-dungeon timeout in earlier test runs).
