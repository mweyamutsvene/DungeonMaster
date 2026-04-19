# Agent Player Test Run: Solo Paladin vs Fiends
Date: 2026-04-19
Scenario: solo-paladin.json
Outcome: Victory
Sir Aldric HP at end: 26/44
Rounds played: 3

## Player and Enemy Actions Taken

### Round 0 (Enemy Initiative)
- Turn order: Fiend Scout (20), Sir Aldric (12), Hell Hound (10)
- **Fiend Scout** attacked Sir Aldric with Claws: 19+4=23 vs AC 20 → Hit! 7 damage. HP 44→37.

### Round 1 (Player Turn)
- **Attack 1 vs Fiend Scout** (5ft, melee):
  - Longsword correctly used (1d8+3)
  - d20=15 → 15+6=21 vs AC 13 → Hit
  - Server offered Divine Smite: "include 'with divine smite' in your roll"
  - Damage: 6 with divine smite → 6+3+12=21. Fiend Scout HP 33→12.
  - Sap mastery applied: "Fiend Scout has disadvantage on next attack!"
  - spellSlot_1: 4→3. Bonus action consumed by Divine Smite.
- **Extra Attack (auto-chain) vs Fiend Scout**:
  - d20=16 → 16+6=22 vs AC 13 → Hit
  - Damage prompt: 1d8+3 (NO Divine Smite offer — bonus already consumed)
  - Sent "7 with divine smite" → 7+3=10 only (smite keyword ignored, bonus used)
  - Fiend Scout HP 12→2. Sap re-applied.
  - spellSlot_1 stayed 3/4 (no slot consumed — correct)
- Turn ended.

### Round 1 (Enemy Turns)
- **Hell Hound** (at 20,10, 10ft from Aldric):
  - AI tried attack from 10ft → FAILED: "Target is 10ft away, but Bite has 5ft reach"
  - AI moveToward → moved to (15,5), now 5ft
  - AI attacked again: Bite 20+5=25 vs AC 20 → Hit! **CRITICAL!** 11 damage. HP 37→26.
- **Fiend Scout** (2HP, Sapped):
  - Claws: 2+4=6 vs AC 20 → Miss
  - (Only 1 die shown — disadvantage from Sap may have been applied internally)

### Round 2 (Player Turn)
- **Attack 1 vs Fiend Scout** (2HP):
  - d20=14 → 14+6=20 vs AC 13 → Hit
  - Server offered Divine Smite (bonus available this turn)
  - Damage: 3 (no smite) → 3+3=6. Fiend Scout HP 2→0 DEFEATED.
- **Attack 2 vs Hell Hound** (manually initiated, not EA chain):
  - d20=13 → 13+6=19 vs AC 15 → Hit
  - Server offered Divine Smite (bonus still available)
  - Damage: 7 with divine smite → 7+3+12=22. Hell Hound HP 45→23.
  - Sap applied. spellSlot_1: 3→2. Bonus consumed.
- Turn ended.

### Round 2 (Enemy Turn)
- **Hell Hound** (Sapped):
  - Bite: 11+5=16 vs AC 20 → Miss
  - (Only 1 die shown — disadvantage from Sap may have been applied internally)

### Round 3 (Player Turn)
- **Attack 1 vs Hell Hound**:
  - d20=16 → 16+6=22 vs AC 15 → Hit
  - Divine Smite offered, used it.
  - Damage: 8 with divine smite → 8+3+5=16. Hell Hound HP 23→7.
  - Sap applied. spellSlot_1: 2→1. Bonus consumed.
  - **Note**: Only 5 bonus smite damage (vs 12 on Fiend Scout). See analysis below.
- **Extra Attack (auto-chain) vs Hell Hound**:
  - d20=12 → 12+6=18 vs AC 15 → Hit
  - No Divine Smite offered (bonus consumed)
  - Damage: 5+3=8. Hell Hound HP 7→0. **VICTORY!**

## ✅ Confirmed Working
- **Longsword correctly used**: 1d8+3 damage every time (no weapon substitution bug — paladin only has one weapon)
- **Extra Attack**: 2 attacks per action correctly enforced throughout
- **Divine Smite on-hit opt-in**: Server correctly prompts "include 'with divine smite' in your roll" after every hit where bonus action is available
- **Divine Smite consumes bonus action**: Correct per 5e 2024 rules — Divine Smite is a bonus action, so only one smite per turn
- **Divine Smite on EA chain blocked**: When bonus action was consumed by first smite, EA chain correctly does NOT offer smite. Keyword ignored if sent anyway. Spell slot NOT consumed. All correct.
- **Spell slot tracking**: Started 4/4, ended 1/4 = 3 slots consumed for 3 successful smites
- **Sap weapon mastery**: Correctly applied "disadvantage on next attack" after each hit
- **Resource display**: Spell slots, Lay on Hands (25/25), Channel Divinity (1/1) all shown correctly
- **Server stability**: All AI turns processed without crashes (crash fix from earlier verified)
- **Attack bonus**: +6 (STR 16 +3 mod + proficiency 3) correct throughout

## 🚩 Bugs & Unexpected Behavior

### BUG-I1: AI attacks from 10ft with 5ft reach weapon (same as BUG-H5)
**Severity**: Medium
**Reproduction**:
  1. Hell Hound at (20,10), Sir Aldric at (10,10) — 10ft apart
  2. AI first action: attack with Bite (5ft reach)
  3. "Failed: Target is 10ft away, but Bite has 5ft reach. Move closer first."
  4. AI then moves and attacks successfully on retry
**Expected (5e 2024 rule)**: AI should check reach before attempting attack, or move first
**Server response**: AI wastes first action attempt, recovers on second try
**Notes**: Same bug as BUG-H5 in wounded-fighter. AI decision-maker doesn't pre-check distance before choosing attack action.

### BUG-I2: Divine Smite bonus damage inconsistent — 12 vs 5 for same slot level
**Severity**: Low (probably just RNG, needs review)
**Reproduction**:
  1. Smite 1 (vs Fiend Scout, 1st level slot): 12 bonus radiant damage
  2. Smite 2 (vs Hell Hound, 1st level slot): 12 bonus radiant damage
  3. Smite 3 (vs Hell Hound, 1st level slot): 5 bonus radiant damage
**Expected (5e 2024 rule)**: 1st level Divine Smite = 2d8 radiant (range 2-16, avg 9). If target is fiend/undead, +1d8 = 3d8 (range 3-24, avg 13.5).
**Analysis**: 
  - Fiend Scout: 12 from 3d8 (fiend bonus) = plausible
  - Hell Hound smite 1: 12 = plausible for either 2d8 or 3d8
  - Hell Hound smite 2: 5 = plausible for 2d8 (low roll) or 3d8 (very low)
  - Cannot determine from output whether fiend bonus was applied to Hell Hound. Need to check if Hell Hound creature type is set to "fiend" in the system.

## ⚠️ Ambiguous / Needs Review

### Sap Disadvantage on AI Attacks
- Sap mastery was applied to both Fiend Scout and Hell Hound after hits
- AI attack rolls only show 1 die (e.g., "Bite: 11 + 5 = 16") — cannot confirm if disadvantage was actually applied
- The Fiend Scout rolled 2 (very low, consistent with disadvantage) 
- The Hell Hound rolled 11 (could be lower of two dice)
- **Critical evidence**: Hell Hound's Bite in Round 1 rolled natural 20 CRITICAL when Sap had been applied to Fiend Scout, not Hell Hound — so that crit was valid. But in Round 2, Hell Hound was Sapped and rolled 11 — can't confirm disadvantage from display.
- **Recommendation**: AI attack display should show both dice when rolling with disadvantage, like player attacks do

### Divine Smite as Bonus Action (2024 Rules Compliance)
- The system treats Divine Smite as consuming the bonus action — this IS correct per 2024 rules
- However, "Bonus used" appears in the turn economy display without explanation of what consumed it
- A player might be confused why their bonus action is gone
- **Recommendation**: Display should say "Bonus used (Divine Smite)" or similar

### Lay on Hands Not Tested
- Sir Aldric never dropped below 50% HP (stayed at 26/44 = 59%), so Lay on Hands wasn't tested
- HP was 26/44 at end — scenario was too easy for the Paladin's damage output
- Lay on Hands (25/25) and Channel Divinity (1/1) both unused

### Fiend Creature Type
- Fiend Scout got +1d8 fiend bonus on Divine Smite (12 damage = plausible 3d8)
- Hell Hound: unclear if system typed it as fiend. In 5e lore, Hell Hounds ARE fiends, but the scenario stat block doesn't specify creature type
- Need to verify if the server infers creature type or only uses explicit typing

## 📝 Notes
- **Paladin experience is excellent**: Divine Smite opt-in after hit, Sap weapon mastery, Extra Attack — all work together smoothly
- **Weapon selection works with single weapon**: Unlike the Fighter (BUG-H1 with Handaxe), the Paladin's single Longsword was always selected correctly. This suggests the weapon substitution bug in wounded-fighter is related to having multiple weapons in the attack list.
- **2024 Divine Smite correctly implemented**: The bonus-action-per-turn limitation is enforced, spell slots are consumed, and the on-hit prompt system is elegant
- **Combat was relatively easy**: Paladin's AC 20 + Divine Smite damage made this a 3-round fight. Consider adding more monsters or reducing Paladin resources for a harder test
- **Spell slots consumed**: 3/4 level 1 slots used, 0/2 level 2 slots. Player never needed to upcast
