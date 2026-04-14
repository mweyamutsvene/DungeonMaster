# Agent Player Test Run: Monk vs Monk Mirror Match
Date: 2026-04-13
Scenario: monk-vs-monk
Outcome: **Victory**
Kai HP at end: 36/36 (untouched)
Vex HP at end: 0/33
Rounds played: 4
Kai ki spent: 3 (Flurry of Blows: 1, Stunning Strike: 1, Patient Defense: 1)
Final ki pool: 2/5

---

## Combat Log Summary

| Round | Kai Action | Result | Vex Response |
|-------|-----------|--------|-------------|
| R1 | Unarmed + Flurry of Blows | 8 dmg + 8 dmg (2nd miss) | Shadow Fist miss (9+6=15 vs AC 16) |
| R2 | Unarmed + Stunning Strike + Patient Defense | 8 dmg, Vex STUNNED (CON 13 vs DC 14) | STUNNED, can't act |
| R3 | Wasted (end turn by mistake) | – | Nimble Escape + Flee (30 ft away) |
| R4 | Move → Unarmed | 11 dmg, Vex 9→0 HP | Dead |

---

## ✅ Confirmed Working

### 1. Ki Pool Tracking (Kai) — Correct Per 5e 2024
- Started at 5/5, each ability correctly decremented:
  - `flurry of blows` → 5→4 ✅
  - `stunning strike` → 4→3 ✅
  - `patient defense` → 3→2 ✅
- Display always reflected the updated value on the next turn panel.

### 2. Flurry of Blows — Correct
- Accepted natural language `"I use flurry of blows"` as bonus action.
- Spawned exactly 2 additional unarmed strike rolls (not 1, not 3).
- Both flurry attacks offered Stunning Strike as on-hit option (correct — any unarmed hit can spend ki).
- Consumed 1 ki and bonus action slot correctly.
- Attack modifier (+6) was identical to the main action strike.
- Damage die was 1d8+3 (correct for level 5 monk).

### 3. Stunning Strike — Correct
- Offered as on-hit option via in-damage-roll prompt: `"include 'with stunning strike' in your roll"`.
- Accepted natural language embed: `"5 with stunning strike"`.
- Spent 1 ki and triggered CON saving throw.
- Save DC 14 = 8 + proficiency (3) + WIS mod (3) — plausible for level 5 monk with 16 WIS.
- Vex failed (13 vs DC 14): **"Vex Nightthorn fails CON save (13 vs DC 14) and is Stunned!"** ✅

### 4. Stunned Condition — Duration Correct (5e 2024 Rules)
- Interpretation verified: "until the start of YOUR next turn" (attacker's, not target's).
- Timeline:
  - Stun applied: Round 2 Kai's turn (init 18)
  - Round 2 Vex's turn (init 10): "Vex Nightthorn is stunned and cannot act!" ✅
  - Round 3 Kai's turn: Stun expired at start of Kai's turn (stun tag not visible) ✅
  - Round 3 Vex's turn: Vex acted freely (Nimble Escape + flee) ✅
- Stun lasted exactly one turn cycle (Vex lost 1 full turn), matching 5e 2024 Stunning Strike rules.

### 5. Patient Defense — Correct
- Accepted `"I use patient defense"`.
- Response: `"Dodged (bonus action via Patient Defense, spent 1 ki)"` ✅
- Consumed 1 ki and bonus action slot.
- (Dodge effect could not be confirmed independently since Vex never hit Kai afterward.)

### 6. Monk Unarmored Movement +10 ft (Level 5)
- Round 1: Move prompt showed `Move 30 ft` (before initiative was processed).
- Round 2+: Move prompt showed `Move 40 ft` ✅ — level 5 Monk gets +10 ft Unarmored Movement.

### 7. Martial Arts Die: 1d8 at Level 5
- All unarmed strikes dealt `1d8+3` damage ✅.
- Level 5 Monk Martial Arts die is d8 (correct per 5e 2024 table).

### 8. Vex AI Behavior — Tactically Sound
- Round 1: Attacked Kai with Shadow Fist (melee, missed).
- Round 2: Correctly lost turn while stunned.
- Round 3: Used Nimble Escape (Disengage as bonus-action-equivalent) to safely flee. Smart tactical retreat at 9 HP. ✅
- Vex's ki resource was tracked independently (separate monster entity with its own state).

---

## 🚩 Bugs & Unexpected Behavior

### BUG-1: Vex chains Shadow Fist followed by Flurry of Blows in same turn, but Flurry of blows is ignored and not executed
**Severity**: High
**Reproduction**:
1. On Round 1, Vex Nightthorn lashes out with a necrotic Shadow Fist, then unleashes a flurry of rapid strikes!
2. Observe: only the Shadow Fist attack is executed (miss), no follow-up Flurry of Blows attacks occur.
**Expected**: The server should execute the full declared action sequence. Or LLM should know that it cannot chain action/bonus action in the same prompt. The LLM should understand per prompt what it can do and what is still available. And the LLM should avoid wasting bonus actions or actions by prematurely ending turn.

### BUG-2: Deflect Attacks Reaction Never Triggered
**Severity**: Medium (feature untested)
**Reproduction**:
1. Vex attacked Kai once: Shadow Fist 9+6=15 vs AC 16 → **Miss**.
2. No Deflect Attacks prompt appeared (correct — the attack missed, no damage to reduce).
3. After stun, Vex fled rather than attacking further.
4. Kai was never hit, so Deflect Attacks reaction was never triggered throughout combat.
**Expected (5e 2024)**: Deflect Attacks (Monk level 3): "When you take damage from an Attack Roll, you can use your Reaction to reduce the damage by 1d10 + your Dexterity modifier + your Monk level." Should offer a reaction the moment an attack HITS and deals damage.
**Server response**: No reaction prompt was shown (attack always missed or target fled).
**Status**: **Inconclusive** — This is a test coverage gap. Vex's attack roll modifier (+6) made it unlikely to hit Kai's AC 16. Recommend a dedicated test where Vex can reliably hit.

### BUG-3: Stunned Condition Not Shown in Combatant List
**Severity**: Low (UX / observability)
**Reproduction**:
1. Apply Stunning Strike to Vex.
2. View combatant panel: `Vex Nightthorn: HP 9/33 | (30, 0) | 0 ft`.
3. No `[STUNNED]` or condition indicator in the combatant display.
**Expected (5e 2024)**: Active conditions (Stunned, Frightened, Poisoned, etc.) should be visible in the tactical view so the player can plan around them with advantage, etc.
**Server response**: Only a turn-level message "Vex Nightthorn is stunned and cannot act!" — no persistent condition tag in the combatant list.

---

## ⚠️ Ambiguous / Needs Review

### REVIEW-1: `uncanny_metabolism: 0/1` Starting Value
**Issue**: Kai's resource panel at the start of combat shows `uncanny_metabolism: 0/1`. Per 5e 2024 Monk (level 5+): Uncanny Metabolism triggers when you **roll initiative**, allowing you to regain all spent Ki Points. If `0/1` means "0 uses available, 1 max" (like ki: current/max), then the feature should show `1/1` at combat start since it hasn't been expended this long rest.
**Possibility 1**: `0/1` = "currently spent 0 of 1 available" (inverted from ki display) → feature IS available.
**Possibility 2**: `0/1` = "0 remaining of 1 max" → feature is UNAVAILABLE at the start of combat, which would be wrong.
**Recommend**: Clarify the numeric format for non-ki resources, or add a `(used / max)` label.

### REVIEW-2: Vex Nightthorn "Shadow Fist" Attack (Necrotic)
**Issue**: Vex's AI attack was described as "Shadow Fist" with necrotic damage narration: "Vex Nightthorn lashes out with a necrotic Shadow Fist, then unleashes a flurry of rapid strikes!" 
Per standard 5e 2024, monks use unarmed strikes (bludgeoning) or monk weapons. "Shadow Fist" with necrotic damage does not exist in the base rules and appears to be a custom monster ability. This is fine if intentional (custom stat block), but should be documented so future tests know Vex is not a PHB monk clone.

### REVIEW-3: Vex's Extra Attack (Level 5) Not Observed
**Issue**: At level 5, monks gain Extra Attack (attack twice when taking the Attack action). Vex used only one attack with Shadow Fist before the AI turn ended, which says `[Turn → Next combatant]`. It's unclear if:
- Vex's stat block doesn't have Extra Attack (intentional custom monster design).
- The AI only chose one attack.
- The AI decided Shadow Fist was more valuable than doubling up.
**Expected**: A level 5 monk should make 2 attacks with the Attack action.

### REVIEW-4: Advantage on Attack Rolls vs. Stunned Target — Not Verified
**Issue**: Per 5e 2024, attack rolls against a Stunned creature have Advantage. The tabletop flow requires the player to enter a raw d20 roll — the server then applies its own modifiers. It's unclear if the server would internally apply Advantage (e.g., roll highest of two dice) when attacking a stunned target or if it relies on the player to supply both rolls.
During Round 3, Kai wasted the entire turn by ending it immediately (agent error), so no attack was made against the stunned Vex. This should be tested in a future run.

---

## 📝 Notes

### Ki Pool Tracking
**Were ki pools tracked separately per combatant?**
Yes. Kai's ki was clearly displayed and decremented individually (`ki: 5/5 → 4/5 → 3/5 → 2/5`). Vex has a separate ki pool (Nimble Escape at Round 3 confirms ki was available), but Vex's ki pool is not visible to the player in the combatant list.

### Stunned Condition
**Did Stunned apply correctly?**
Yes. Stun was applied, Vex lost their next turn, and the stun expired exactly when it should per 5e 2024 ("until the start of your next turn" = Kai's Round 3 turn). The condition cleared before Vex's Round 3 turn, letting Vex act freely. Duration behavior is **correct**.

### Deflect Attacks Reaction
**Was Deflect Attacks offered as a reaction?**
No — it was never triggered because Vex missed every attack. The prerequisite (taking damage from an attack) was never met. This cannot be confirmed as working or broken from this run alone. A dedicated test with a guaranteed hit is required.

### Other Observations
- The command `"I attack Vex Nightthorn with unarmed strike"` (abbreviated to `"I attack Vex with unarmed strike"`) resolved correctly to Vex Nightthorn by partial name match.
- `"I use flurry of blows"` and `"I use patient defense"` parsed correctly without needing specific syntax.
- Stunning Strike syntax `"5 with stunning strike"` (embedding ability name in the damage roll text) is functional but non-obvious; no help text in the roll prompt explains this properly.
- The CLI polling interval occasionally caused echoed input to appear in later output chunks, which was confusing during test execution even though the underlying game state was correct.
- Kai's movement to (30,0) in Round 1 — same cell as Vex — did not cause any collision issue; the server accepted two combatants occupying the same grid cell.
