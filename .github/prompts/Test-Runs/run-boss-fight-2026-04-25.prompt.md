# Agent Player Test Run: boss-fight
Date: 2026-04-25
Scenario: boss-fight
Outcome: Victory
Thorin HP at end: 34/42
Rounds played: 7

## Player and Enemy actions taken
- Round 0: Thorin won initiative, 16 vs Ogre 1.
- Round 1 (Player):
  - Move: from (10, 10) to (35, 10), 25 ft, entering melee.
  - Attack 1: Longsword d20=15 -> 15+6 = 21 vs AC 11 -> Hit, damage die 6 -> 9 damage (Ogre HP 59->50).
  - Extra Attack: Longsword d20=13 -> 13+6 = 19 vs AC 11 -> Hit, damage die 5 -> 8 damage (Ogre HP 50->42).
  - Action Surge: Activated, transcript said Gained 2 additional attacks (2 attacks remaining).
  - Action Surge Attack 1: Longsword d20=16 -> 16+6 = 22 vs AC 11 -> Hit, damage die 7 -> 10 damage (Ogre HP 42->32).
  - Extra Attack (Action Surge chain): Longsword d20=12 -> 12+6 = 18 vs AC 11 -> Hit, damage die 3 -> 6 damage (Ogre HP 32->26).
  - End turn.
- Round 1 (Ogre):
  - Did not attack while adjacent at 5 ft.
  - Transcript: AI ends turn, The Ogre stays in close range, awaiting the next turn to strike.
- Round 2 (Player):
  - End turn to allow enemy action and try to trigger Second Wind later.
- Round 2 (Ogre):
  - Greatclub attack: 12+6 = 18 vs AC 18 -> Hit, 8 damage (Thorin HP 42->34).
- Round 3 (Player):
  - End turn again to try to drop below 50 percent HP for Second Wind.
- Round 3 (Ogre):
  - moveAwayFrom triggered instead of attacking.
  - Opportunity Attack prompt appeared. Player declined.
  - Ogre moved to (70, 10). Thorin remained 34/42 HP.
- Round 4 (Player):
  - End turn again.
- Round 4 (Ogre):
  - moveAwayFrom again, increasing distance to 60 ft instead of re-engaging.
- Round 5 (Player):
  - Dash: transcript only said Dashed. and did not move Thorin.
  - Move: manually moved from (35, 10) to (65, 10), 30 ft.
  - End turn.
- Round 5 (Ogre):
  - moveAwayFrom again, keeping distance at 30 ft.
- Round 6 (Player):
  - Attempted thrown attack: I throw a javelin at the Ogre -> HTTP 400 Bad Request: You don't have anything you can throw. Your available attacks: Longsword, Handaxe.
  - Attack 1: Throw Handaxe at 30 ft, prompt showed disadvantage, d20=12 -> 12+6 = 18 vs AC 11 -> Hit, damage die 4 -> 7 damage (Ogre HP 26->19).
  - Extra Attack: Prompt still showed disadvantage even after Vex said advantage on next attack against Ogre, d20=11 -> 11+6 = 17 vs AC 11 -> Hit, damage die 5 -> 8 damage (Ogre HP 19->11).
  - End turn.
- Round 6 (Ogre):
  - moveToward to melee.
  - Greatclub attack: 2+6 = 8 vs AC 18 -> Miss.
- Round 7 (Player):
  - Declared: I attack the Ogre with my sword.
  - Transcript interleaved AI movement during player action: Ogre shifts to maintain close range, then Ogre retreats from Thorin, moving 15 feet to avoid damage.
  - Opportunity Attack prompt appeared during this sequence. Player accepted.
  - Opportunity Attack resolved automatically with no player roll prompt: Hit! (8 damage) (Ogre HP 11->3).
  - Follow-up attack: Throw Handaxe at 20 ft, prompt showed advantage, d20=14 -> 14+6 = 20 vs AC 11 -> Hit, damage die 2 -> 5 damage (Ogre HP 3->0).
  - Victory.

## ✅ Confirmed Working
- Initiative flow and initial combat setup worked on the live CLI control server.
- Fighter Extra Attack auto-chained correctly after a normal melee attack action.
- Action Surge granted exactly 2 additional attacks, producing a legal 4-attack round, and the resource display updated to actionSurge: 0/1.
- Thrown Handaxe attacks were supported by the parser and also auto-chained with Extra Attack.
- Inventory-aware attack validation worked when the player attempted to throw a non-existent javelin; the server returned a clear 400 with the actual available attacks.

## 🚩 Bugs & Unexpected Behavior

### BUG-1: Ogre skipped an adjacent melee turn, blocking intended Second Wind verification
**Severity**: Medium
**Reproduction**:
  1. In Round 1, move Thorin to 5 ft and complete a full 4-attack Action Surge turn, leaving the Ogre at 26 HP and adjacent.
  2. End Thorin's turn.
  3. Observe the Ogre immediately end its turn without making any attack despite being in melee.
**Expected (5e 2024 rule)**: An adjacent Ogre with a usable melee attack should normally take an attack action on its turn unless a specific condition or AI rule prevents it, and the scenario goal expects incoming damage so Second Wind can be exercised.
**Server response**: `The Ogre stays in close range, awaiting the next turn to strike.`

### BUG-2: Dash consumed the action but granted no movement
**Severity**: High
**Reproduction**:
  1. Let the Ogre kite out to long range.
  2. On Thorin's turn, enter `dash`.
  3. Observe that the only output is `Dashed.` and Thorin does not move at all.
  4. Manual movement afterward was still required and only moved 30 ft.
**Expected (5e 2024 rule)**: Dash should increase available movement for the turn rather than doing nothing.
**Server response**: `Dashed.`

### BUG-3: Turn-order instability converted a declared player attack into enemy movement plus an auto-resolved opportunity attack
**Severity**: High
**Reproduction**:
  1. After the Ogre re-entered melee at 11 HP, enter `I attack the Ogre with my sword` on Thorin's turn.
  2. Observe AI movement messages interleaved into the player action.
  3. The Ogre then moved away and triggered an opportunity attack prompt.
  4. Accept the opportunity attack and observe that it resolves as a hit for 8 damage without any player attack roll or damage roll prompt.
**Expected (5e 2024 rule)**: The declared player attack should resolve on the player's turn, and an opportunity attack should still use the normal attack-resolution pipeline instead of auto-hitting.
**Server response**: `The Ogre retreats from Thorin, moving 15 feet to avoid damage.` and later `Opportunity Attack Thorin Ironfist: Hit! (8 damage)`

### BUG-4: Vex advantage did not cancel long-range disadvantage on the follow-up Handaxe attack
**Severity**: Medium
**Reproduction**:
  1. Throw a Handaxe at the Ogre from 30 ft and hit.
  2. The transcript says `Vex: Advantage on next attack against Ogre!`
  3. Observe the immediate Extra Attack prompt still instructing `roll 2d20, take the lowest`.
**Expected (5e 2024 rule)**: One source of advantage and one source of disadvantage should cancel, producing a normal d20 roll.
**Server response**: `Vex: Advantage on next attack against Ogre! Extra Attack: Roll a d20 (roll 2d20, take the lowest) for Handaxe vs Ogre.`

## ⚠️ Ambiguous / Needs Review
- Ogre AI behavior oscillated between ending turn in melee, attacking in melee, repeatedly retreating, and then re-engaging. Some of that may be intentional tactical logic, but the combination made the scenario goal of using Second Wind impossible in this run.
- The retreat transcript said the Ogre was moving 40 feet away, but the follow-up movement line reported 30 ft to (70, 10). That may be a text inconsistency rather than a rules bug.

## 📝 Notes
- Scenario goal was only partially achievable in live play. Extra Attack and Action Surge were verified successfully, but Second Wind could not be exercised because Thorin never dropped below 50 percent HP after the Ogre skipped one adjacent turn and then entered a retreat loop.
- Final outcome was Victory with Thorin at 34/42 HP.