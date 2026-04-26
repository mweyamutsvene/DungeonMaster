# Agent Player Test Run: Party Dungeon
Date: 2026-04-25
Scenario: party-dungeon-smoke.json
Outcome: Victory
Thorin HP at end: 37/42
Rounds played: 2

## Player and Enemy actions taken
- Round 0: Goblin Archer won initiative and acted first. Combat banner said the Archer's final initiative was 17, but the turn order listed Goblin Archer 19, Elara the Wise 18, Thorin Ironfist 17, Goblin Boss 15, Goblin Warrior 11.
- Round 0 (Goblin Archer): Moved closer to Thorin, then attacked with Shortbow. Attack roll 19 + 4 = 23 vs AC 18, hit for 5 damage. Thorin HP 42 -> 37.
- Round 0 (Elara): Cast Fire Bolt at Goblin Boss. Attack roll 4 + 5 = 9 vs AC 17, miss.
- Round 1 (Thorin): Moved from (10,10) to (25,10), attacked Goblin Archer with Longsword. Attack roll 16 + 6 = 22 vs AC 13, hit. Damage roll 5 + 3 = 8. Goblin Archer HP 7 -> 0. Extra Attack remained available.
- Round 1 (Thorin): Moved from (25,10) to (35,10), attacked Goblin Boss with Longsword. Attack roll 14 + 6 = 20 vs AC 17, hit. Damage roll 4 + 3 = 7. Goblin Boss HP 21 -> 14. Sap applied and the boss had disadvantage on its next attack.
- Round 1 (Goblin Boss): Took no attack. AI ended turn because Sap prevented acting.
- Round 1 (Goblin Warrior): Moved toward Elara, attacked with Scimitar. Attack roll 17 + 4 = 21 vs AC 12, hit for 3 damage. Elara HP 24 -> 21.
- Round 1 (Elara): Cast Fire Bolt at Goblin Boss. Attack roll 6 + 5 = 11 vs AC 17, miss. Then moved away to (10,50) to create distance from Goblin Warrior.
- Round 2 (Thorin): Attacked Goblin Boss with Longsword. Attack roll 18 + 6 = 24 vs AC 17, hit. Damage roll 8 + 3 = 11. Goblin Boss HP 14 -> 3. Extra Attack auto-chained immediately.
- Round 2 (Thorin): Extra Attack against Goblin Boss. Attack roll 17 + 6 = 23 vs AC 17, hit. Damage roll 4 + 3 = 7. Goblin Boss HP 3 -> 0.
- Round 2 (Goblin Warrior): Moved toward Thorin, attacked with Scimitar. Attack roll 3 + 4 = 7 vs AC 18, miss. Then AI announced Nimble Escape / Disengage and ended turn.
- Round 2 (Elara): Cast Fire Bolt at Goblin Warrior. Attack roll 20 + 5 = 25 vs AC 15, critical hit for 29 damage. Goblin Warrior HP 7 -> 0. Encounter ended in victory.

## ✅ Confirmed Working
- Initiative order included all 5 combatants in the turn order display before Thorin's first action.
- Elara the Wise took AI-controlled turns in initiative order without any 500 error.
- Fighter Extra Attack worked in party combat.
- Extra Attack remained available after Thorin killed one target mid-action and moved to a second target in the same turn.
- Extra Attack also auto-chained directly into the second attack prompt on Thorin's second turn.
- Once Goblin Archer and Goblin Boss hit 0 HP, later AI turns did not target those defeated combatants.
- The final surviving enemy correctly switched to Thorin as a living target after the boss died.
- Victory resolved cleanly and the post-combat menu appeared.

## 🚩 Bugs & Unexpected Behavior

### BUG-1: Initiative narration disagrees with actual turn order
**Severity**: Medium
**Reproduction**:
  1. Start `party-dungeon` and submit the initiative roll.
  2. Read the combat-start narration and the turn order list.
**Expected (5e 2024 rule)**: The announced winning initiative should match the actual initiative values used in turn order.
**Server response**: `The combat begins, with the Goblin Archer's final initiative of 17 granting it the first turn.` followed immediately by `Combat started! Goblin Archer's turn (Initiative: 19).` and a turn order list showing `Goblin Archer (Initiative: 19)` and `Thorin Ironfist (Initiative: 17)`.

## ⚠️ Ambiguous / Needs Review
- `Goblin Warrior` used `Nimble Escape` / `Disengage` after its scimitar attack. If this combatant is meant to inherit standard goblin traits, this may be correct. If `Goblin Warrior` is intended to be a separate stat block without Nimble Escape, this is a content or AI-ability leakage bug.
- Control/terminal output was chunked and sometimes lagged a turn behind, which briefly made Elara look skipped until the full transcript flushed. The combat state itself recovered correctly, but the live-observation surface is slightly misleading during polling.
- Some control output contained mojibake (`â`, `ð²`) instead of clean Unicode punctuation/icons.

## 📝 Notes
- Thorin never needed Second Wind or Action Surge in this run.
- End state before quitting: Thorin 37/42 HP, Elara 21/24 HP, all three enemies defeated.
- The most important positive regression signal from this run is that party-mode Extra Attack and dead-target cleanup both held under a mixed player-plus-AI ally fight.