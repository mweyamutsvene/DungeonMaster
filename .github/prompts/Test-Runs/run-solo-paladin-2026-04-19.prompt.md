# Agent Player Test Run: Solo Paladin
Date: 2026-04-19
Scenario: solo-paladin
Outcome: Incomplete (AI stall after Round 3)
Sir Aldric HP at end: 44/44 (never took damage)
Rounds played: 3 (Aldric turns only; AI stalled mid Round 4)

---

## Scenario Setup
- Sir Aldric the Just: Paladin 5, AC 20, HP 44, STR +6 attack, Longsword
- Hell Hound: HP 45/45, AC 15, Bite (5ft reach)
- Fiend Scout: HP 33/33, AC 13
- Resources initialized: spellSlot_1: 4/4 | spellSlot_2: 2/2 | layOnHands: 25/25 | channelDivinity:paladin: 1/1
- Turn order: Hell Hound (init 18), Sir Aldric (init 14), Fiend Scout (init 11)

---

## Player and Enemy Actions Taken

### Round 0 (Initiative / Hell Hound Round 1 Turn)
- Player rolled initiative: d20=14
- Hell Hound turn: tried to attack Aldric at 10ft range → `[Action Failed] Target is 10ft away, but Bite has 5ft reach.` → AI skipped attack correctly

### Round 1 (Sir Aldric)
- Attack 1: `I attack the Fiend Scout with my longsword` → d20=17 → 17+6=23 vs AC 13 → Hit
  - On-hit prompt: `Divine Smite available — include "with divine smite" in roll`
  - Damage: `6 with divine smite` → 6+3+16=25 total damage (display showed "6 + 3 = 25")
  - Fiend Scout HP: 33→8. Sap applied. spellSlot_1: 4/4→3/4
- Extra Attack (auto-chain): d20=15 → 15+6=21 vs AC 13 → Hit
  - Damage: `4` → 4+3=7 → Fiend Scout HP: 8→1
- Turn economy after attacks: `Action 0/2 attacks | Bonus used | Reaction ready | Move 30 ft`
- Sent: `end turn`

### Round 1 (AI — Fiend Scout init 11)
- Fiend Scout: "The Fiend Scout is too weak and sapped to act, so it holds its ground."

### Round 1 (AI — Hell Hound, new round start)
- Hell Hound: `[AI] moveToward` → moved to (15,5)
- Hell Hound: `[AI] attacks Sir Aldric with Bite` → 2+5=7 vs AC 20 → Miss

### Round 2 (Sir Aldric)
- Sent: `I cast shield of faith as a bonus action`
- Response: `Cast shield of faith as a bonus action.` (no slot consumed visible, spellSlot_1 stayed 3/4)
- Sent: `I attack the Hell Hound with my longsword`
- Response: `✗ HTTP 400 Bad Request: Actor has already spent their action this turn`
- **BUG-P2 confirmed**: Shield of Faith consumed the ACTION slot, not bonus action
- Sent: `end turn` (wasted turn — no attack, no damage)

### Round 2 (AI)
- Fiend Scout: holds ground (1HP/sapped)
- Hell Hound: `[AI] moveToward` → stayed near / attacked → 2+5=7 vs AC 20 → Miss

### Round 3 (Sir Aldric)
- Repeated Shield of Faith test: `I cast shield of faith as a bonus action`
- Response: same as Round 2 — consumed action, blocked attack
- spellSlot_1: still 3/4 (no slot consumed after 2 casts of a 1st-level spell)
- Sent: `end turn`

### Round 3→4 (AI Stall)
- After Aldric ended turn, AI output became empty for 6+ minutes
- Server health: `{"ok":true}` (server alive)
- CLI was alive (control port responding)
- AI never produced output — same pattern as BUG-H2
- Session terminated by sending `5` (quit)

---

## ✅ Confirmed Working

- Paladin resource pools initialize correctly: `layOnHands: 25/25`, `channelDivinity:paladin: 1/1`, `spellSlot_1: 4/4`, `spellSlot_2: 2/2`
- Paladin features array displayed on session start ✅
- Divine Smite on-hit prompt appears correctly after a hit ✅
- Divine Smite triggers on keyword in damage input ("with divine smite") ✅
- Spell slot (level 1) correctly decremented after Divine Smite: 4/4 → 3/4 ✅
- Extra Attack auto-chains immediately after first attack resolves ✅
- Sap (longsword weapon mastery) applies on hit and persists across rounds ✅
- Hell Hound AI correctly failed Bite at 10ft (5ft reach): `[Action Failed] Target is 10ft away` ✅
- Hell Hound AI moved to 5ft and attacked in subsequent round ✅
- Fiend Scout AI correctly holds ground at 1HP/Sapped (narration-appropriate) ✅
- AC 20 on Aldric blocking Hell Hound Bite (2+5=7 vs AC 20 → Miss) ✅
- Bonus action resets to "ready" at start of each of Aldric's turns ✅

---

## 🚩 Bugs & Unexpected Behavior

### BUG-P1: Divine Smite damage arithmetic display incorrect
**Severity**: Low (cosmetic — HP math is correct)
**Reproduction**:
  1. Attack with longsword, hit
  2. Roll damage with `"6 with divine smite"`
  3. Server responds: `6 + 3 = 25 damage` (then separately: `Divine Smite: 16 bonus damage!`)
**Expected (5e rule)**: Display should show `6 + 3 + 16 = 25 damage` in the equation, not `6 + 3 = 25`
**Server response**: `6 + 3 = 25 damage to Fiend Scout! HP: 33 → 8. Sap: ... Divine Smite: 16 bonus damage!`
**Note**: The smite bonus is narrated after the fact but missing from the inline arithmetic. HP reduction (25 total) is correct.

### BUG-P2: Shield of Faith "as a bonus action" consumes the action, not bonus action
**Severity**: High — completely breaks the paladin bonus action spell flow
**Reproduction**:
  1. It is the paladin's turn (Action ready, Bonus ready)
  2. Send: `I cast shield of faith as a bonus action`
  3. Response: `Cast shield of faith as a bonus action.`
  4. Send: `I attack the Hell Hound with my longsword`
  5. Response: `✗ HTTP 400 Bad Request: Actor has already spent their action this turn`
**Expected (5e 2024 rule)**: Shield of Faith is a bonus action spell. It should consume the bonus action slot and leave the action available for an attack.
**Reproduced**: 2 times in identical scenarios (Round 2 and Round 3)
**Impact**: Paladin cannot use Shield of Faith + attack on same turn. One full turn wasted per cast.

### BUG-P3: Shield of Faith does not consume a spell slot
**Severity**: High — broken resource tracking
**Reproduction**:
  1. spellSlot_1: 3/4 after Round 1 Divine Smite
  2. Round 2: `I cast shield of faith as a bonus action` → `Cast shield of faith as a bonus action.`
  3. Resources still show: `spellSlot_1: 3/4` (unchanged)
  4. Round 3: same cast again → still `spellSlot_1: 3/4`
**Expected (5e rule)**: Shield of Faith costs a 1st-level spell slot. Should decrement spellSlot_1: 3/4 → 2/4 → 1/4 across two casts.
**Note**: Either the spell is being handled as a "free cast" or the action-economy handler is not routing to the spell slot manager. Related to BUG-P2 (same cast path is broken).

### BUG-P4: AI Stall (Round 4, same as BUG-H2)
**Severity**: High — combat uncompletable
**Reproduction**:
  1. Fiend Scout at 1HP (Sapped), Hell Hound at 45HP (adjacent to player)
  2. Player ends turn (Round 3)
  3. Wait 6+ minutes — no AI output
  4. Server health confirms server is alive
**Expected**: Hell Hound (already adjacent at 5ft) should attack Aldric immediately. Fiend Scout should hold ground as it did in Rounds 1-2.
**Note**: This is a repeat of BUG-H2 from the wounded-fighter scenario. Ollama appears to time out or loop when Fiend Scout at 1HP is in the initiative order even when its AI logic already worked correctly in prior rounds. Hell Hound not producing output despite being adjacent is new — previous rounds it worked fine.

---

## ⚠️ Ambiguous / Needs Review

- **Bonus action "used" after Round 1 attacks**: After Round 1 (two longsword attacks, one with Divine Smite), the turn economy showed `Bonus used`. No bonus action was explicitly requested. This may be correct if Divine Smite (in 5e 2024) costs a reaction/bonus action, or it could be a false "used" flag. Needs rule verification.
  - 5e 2014: Divine Smite is free (no action cost — just expend slot on hit)
  - 5e 2024: Divine Smite costs a reaction
  - If server uses 2024 rules, Bonus being "used" is wrong (should be Reaction used)
  - If server uses 2014 rules, Bonus being "used" is wrong (should remain available)

- **Shield of Faith concentration**: Never confirmed whether concentration was tracked (can't verify because slot wasn't consumed either — BUG-P3)

- **Paladin Aura of Protection not tested**: Couldn't reach a round with saving throws to verify +CHA bonus to saves

---

## 📝 Features Not Tested (due to AI stall + BUG-P2 wasting turns)

- Lay on Hands (never took damage; could have tested proactively)
- Cure Wounds spell
- Channel Divinity
- Divine Smite with Level 2 slot (would give 3d8 radiant vs fiend = 4d8 total)
- Shield of Faith AC bonus verification
- Aura of Protection (saving throw bonus)
- Concentration breaking on damage

---

## 📝 Notes

- The Hell Hound's Bite attack failed in Round 1 (correct range enforcement) and then correctly moved and missed in Rounds 1-2. This shows AI movement → attack sequencing works.
- Aldric never took damage (AC 20 + Hell Hound only hits on 15+). This prevented testing reactive features (Lay on Hands, Shield spell).
- The Fiend Scout's "hold ground" AI behavior at 1HP is actually good — it correctly assessed it couldn't act effectively. The stall seems to be Ollama timing out, not a logic error in the game server.
- All three bugs (P1-P3) relate to the spell cast handling path for paladin — Divine Smite (which works through a keyword in damage) works correctly, but Shield of Faith (which goes through a full cast action) is broken in both action economy routing and resource tracking.
