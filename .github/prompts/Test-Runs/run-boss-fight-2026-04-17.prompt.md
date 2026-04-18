# Agent Player Test Run: Boss Fight — Fighter vs Ogre
Date: 2026-04-17
Scenario: boss-smoke / boss-fight
Outcome: Victory
Thorin Ironfist HP at end: 42/42 (full — never took damage)
Ogre HP at end: 0/59
Rounds played: 1 (+ 1 partial Ogre turn at start)

## Combat Summary
- Round 0: Ogre went first (initiative 19 vs Thorin 18), moved toward Thorin, Greatclub attack 12 vs AC 18 → Miss.
- Round 1 (Thorin): 
  - Attack 1: d20=15 → 15+6=21 vs AC 11 → Hit, damage 8+3=11 (Ogre HP 59→48). Sap triggered.
  - Extra Attack (auto-chain): d20=8 → 8+6=14 vs AC 11 → Hit, damage 15+3=18 (Ogre HP 48→30). Sap triggered.
  - Action Surge: Activated, "Gained 2 additional attacks."
  - Action Surge Attack 1: d20=7 → 7+6=13 vs AC 11 → Hit, damage 6+3=9 (Ogre HP 30→21). Sap triggered.
  - Extra Attack (Action Surge chain): d20=14 → 14+6=20 vs AC 11 → Hit, damage 9+3=12 (Ogre HP 21→9). Sap triggered.
  - Turn ended. Ogre fled (moveAwayFrom).
- Opportunity Attack: Thorin took OA as Ogre tried to flee. Hit → 10 damage. Ogre HP 9→0. Ogre down. Victory!

---

## ✅ Confirmed Working

- Ogre stat block: HP 59/59 confirmed at combat start
- Ogre AC 11: Attack roll totals of 13–21 all hit; Ogre's Greatclub missed vs AC 18 (12 vs 18)
- Thorin AC 18: Ogre Greatclub attack 12 vs 18 correctly registered as Miss
- Thorin attack bonus +6: Confirmed across all 4 attacks (roll + 6 = total)
- Extra Attack auto-chaining: After first attack damage resolved, server immediately prompted for second attack (correct 2 attacks per action at Fighter level 5)
- Turn economy tracking: After 2 regular attacks, showed "Action 0/2 attacks" correctly
- Action Surge activation: "I use action surge" parsed correctly, response "Action Surge! Gained 2 additional attacks (2 attacks remaining)"
- Action Surge gives correct attack count: Turn economy showed "Action 0/4 attacks" after all 4 attacks
- Action Surge resource consumed: `actionSurge: 0/1` after use (was 1/1 before)
- Longsword damage: 1d10+3 (versatile one-handed dice consistent with solo-fighter observation)
- Weapon mastery Sap: Triggered on every hit, applied "disadvantage on next attack" to Ogre — stacked with successive hits (Ogre showed [Sapped] condition)
- Opportunity Attack triggered: When Ogre used moveAwayFrom, OA prompt appeared correctly ("Ogre is moving away! Take an Opportunity Attack? (y/n)")
- OA resolved successfully: Hit for 10 damage, killing the Ogre
- Victory screen: Displayed correctly ("VICTORY! All enemies have been defeated!"), post-combat menu showed options 1–5
- Post-combat menu (quit): Sending "5" accepted

---

## 🚩 Bugs & Unexpected Behavior

### BUG-F1: Extra Attack roll prompt mislabeled "for damage" instead of "for attack"
**Severity**: Low (cosmetic/UX)
**Reproduction**:
  1. Attack an enemy and hit (1d10+3 damage resolves)
  2. Extra Attack auto-chains
  3. Server shows: `Extra Attack: Roll a d20 for Longsword vs Ogre. Enter your d20 roll for damage:`
**Expected (UX)**: The prompt should say "Enter your d20 roll for **attack**:" (not "for damage")
**Server response**: `Enter your d20 roll for damage:` (displayed for d20 attack roll, not damage roll)
**Note**: Same as BUG-8 / BUG-M1 from previous test runs. Confirmed recurring across Fighter and Monk.

### BUG-F2: Stale "I use action surge" text appeared in input buffer at wrong roll prompt
**Severity**: Low
**Reproduction**:
  1. During a damage roll phase, a previously-queued "I use action surge" message flushed through
  2. Server responded: "Include your roll number before the ability keyword. Example: '8 with stunning strike' or '6 with topple'"
**Expected**: Stale command inputs from previous turns should not interfere with current roll prompts
**Server response**: `⚠ Include your roll number before the ability keyword.`
**Note**: The damage still processed correctly after the error. This is likely a CLI input buffer issue, not a server bug.

### BUG-F3: Post-OA 404 error for stale pending action (benign)
**Severity**: Low
**Reproduction**:
  1. Opportunity Attack triggered as Ogre fled
  2. OA resolved — Ogre died, combat ended
  3. Server showed: `Reaction failed: HTTP 404 Not Found: Pending action not found: l8Ar_zaZDlAGoXEnp9TIw`
**Expected**: No error after successful OA that kills the enemy
**Server response**: `Reaction failed: HTTP 404 Not Found: Pending action not found: l8Ar_zaZDlAGoXEnp9TIw`
**Note**: Combat still ended correctly with Victory screen. The 404 appears to be a cleanup issue — the pending action was already consumed/resolved when the OA killed the enemy, but a second resolution attempt was made.

### BUG-F4: Initiative display inconsistency — narrative says 18, turn order shows 19
**Severity**: Low (cosmetic)
**Reproduction**:
  1. Player sent d20=16 for initiative
  2. Server said: "Ogre's initiative of 18, from a roll of 16 plus a +2 dex bonus, places it ahead"
  3. Turn order displayed: `Ogre (Initiative: 19)` and `Thorin Ironfist (Initiative: 18)`
**Expected**: If Ogre's initiative total is 18, turn order should show `Ogre (Initiative: 18)`, not 19
**Server response**: Initiative: 19 in turn order vs "initiative of 18" in narrative

---

## ⚠️ Ambiguous / Needs Review

- **Action Surge gives 2 vs 1 additional action**: The game said "Gained 2 additional attacks (2 attacks remaining)." In D&D 5e, Action Surge gives you 1 additional action, which at Fighter 5 = 2 more attacks (Extra Attack applies). So "2 additional attacks" is correct in practice, but the framing implies 2 bonus attacks rather than 1 bonus action. Could be misleading to a rules-minded player but is mechanically accurate.
- **Sap mastery stacks per hit**: Every attack triggered "Ogre has disadvantage on next attack!" The Sap condition stacked descriptions but they may refer to the same mechanical effect (advantage refreshes each turn). This is correct per RAW (Sap imposes disadvantage on the target's NEXT attack roll, and each Sap replaces the previous for the same turn).

---

## 📝 Not Tested

- **Second Wind**: Thorin never took damage (Ogre missed the only attack), so Second Wind was never triggered. HP stayed at 42/42.
- **Grapple**: Ogre died before Round 2 started. Grapple test was planned for Round 2.
- **Shove Prone**: Same — Ogre died before Round 2.
- **Ogre damage output**: Ogre attacked once (Greatclub, missed). No opportunity to verify 2d8+4 damage values.
- **Multiple rounds of Ogre attacks**: Ogre was killed in Round 1. No data on Ogre's attack pattern frequency.

---

## 📝 Notes

- The boss-fight scenario is substantially shorter than expected due to high player damage output (~38 damage in one turn + 10 OA = 48 total from 59 max). Consider buffing the Ogre HP to 80–100 for a more meaningful "boss" fight.
- Action Surge + Extra Attack combo (4-attack nova round) is fully functional and correctly tracked.
- Weapon mastery Sap on Longsword working well — creates meaningful tactical effect (disadvantage on Ogre's attack).
- Opportunity Attack integration is smooth — prompt appeared correctly mid-Ogre-movement.
- The post-OA 404 (BUG-F3) is the same pattern seen in BUG-2 across other test runs. Consistently reproducible when an OA kills the target.
