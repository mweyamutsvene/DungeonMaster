# Agent Player Test Run: Solo Monk — Ki Pool & Stunning Strike
Date: 2026-04-17  
Scenario: `solo-monk` (scenario id: `monk-smoke`)  
Outcome: **Victory**  
Kai Stormfist HP at end: **36/36** (full health, never took damage)  
Rounds played: **1**  
LLM Provider: Ollama (`gpt-oss:20b`)  
Control port: 3005

---

## Summary Table

| Metric | Value |
|--------|-------|
| Character | Kai Stormfist (Monk 5) |
| Enemy | Orc Brute (HP 30, AC 13) |
| Ki used | 2/5 (1 Stunning Strike + 1 Flurry of Blows) |
| Ki remaining | 3/5 |
| Total damage dealt | 31 (9 + 8 + 7 + 7) |
| Attacks made | 4 (2 action, 2 flurry) |
| Outcome | Victory, 1 round |

---

## Turn-by-Turn Transcript Summary

**Round 1 — Orc Brute's turn (Initiative 21):**
- Orc moved from spawn to melee range (30 ft gap closed)
- Greataxe attack: 10+5=15 vs AC 16 → **Miss**

**Round 1 — Kai's turn (Initiative 17):**
1. Unarmed Strike → 15+6=21 vs AC 13 → **Hit** → Stunning Strike offered
   - Damage: 6+3=9 → `6 with stunning strike` sent
   - Orc CON save: 8 vs DC 14 → **Fail** → Orc Brute **Stunned** (1 ki spent → 4/5)
2. Extra Attack (auto-chained): 15+6=21 vs AC 13 → **Hit** → No Stunning Strike offered (target already stunned)
   - Damage: 5+3=8 → Orc HP: 30→21
3. Flurry of Blows (bonus action, 1 ki spent → 3/5):
   - Strike 1: 15+6=21 vs AC 13 → **Hit** → Damage: 4+3=7 → Orc HP: 21→13
   - Strike 2: 15+6=21 vs AC 13 → **Hit** → Damage: 4+3=7 → Orc HP: 13→0 **DEFEATED**

---

## ✅ Confirmed Working

- **Ki pool initializes at 5/5** for Level 5 Monk — displayed correctly at combat start
- **Stunning Strike** triggers during damage roll prompt — server shows "On-hit abilities available: Stunning Strike: include 'with stunning strike' in your roll"
- **Stunning Strike CON save** auto-resolved for NPC monster (8 vs DC 14 = fail) — appropriate AI-controlled behavior
- **Stunned condition** applied and persisted: Orc Brute shown as `[Stunned]` for remaining combat
- **Stunning Strike DC** correct: 14 = 8 + PB(3) + WIS mod(+3) ✅
- **Ki decrements correctly**: 5/5 → 4/5 after Stunning Strike → 3/5 after Flurry of Blows
- **Flurry of Blows** activates as bonus action, spends 1 ki, generates 2 extra unarmed strikes
- **Flurry of Blows chains correctly**: after 1st flurry hit, server prompts for 2nd strike automatically
- **Bonus action economy**: `Bonus used` shown in turn economy after Flurry
- **Action economy**: `Action 0/2 attacks` shown after both attacks used
- **Martial Arts die scaling**: Server uses 1d8+3 at Level 5 (overrides scenario sheet's 1d6+3) ✅
- **Attack bonus**: +6 applied correctly (PB3 + DEX+3)
- **Extra Attack auto-chains**: After first unarmed strike damage, server prompts for second attack automatically
- **Stunning Strike suppressed on second hit**: No Stunning Strike offered on Extra Attack when target already Stunned (correct behavior — no ki wasted on redundant stun)
- **Initiative**: 14+3=17 displayed correctly as "final score of 17"
- **Reaction ready**: shown in turn economy (Deflect Attacks reaction available per display)

---

## 🚩 Bugs & Unexpected Behavior

### BUG-M1: Extra Attack roll prompt mislabeled "for damage" instead of "for attack"
**Severity**: Low (cosmetic)  
**Reproduction**:
1. Declare unarmed strike attack
2. Roll attack (hit), roll damage
3. Server chains Extra Attack — prompts "Enter your d20 roll for damage:"
**Expected (correct label)**: "Enter your d20 roll for attack:" — it's an attack roll, not a damage roll
**Server response**: `"Extra Attack: Roll a d20 for Unarmed Strike vs Orc Brute.\nEnter your d20 roll for damage:"`
**Note**: Same as BUG-8 from previous batch testing. The roll value is processed correctly as an attack roll — only the label is wrong.

---

## ⚠️ Ambiguous / Needs Review

### AMBIGUOUS-1: Open Hand Technique options NOT shown on Flurry of Blows hits
- Scenario description says "Open Hand Monk" but the `solo-monk.json` has **no `subclass` field** in the character setup
- Without subclass declaration, the server cannot know Kai is an Open Hand Monk → Open Hand Technique correctly not offered
- **Action needed**: Add `"subclass": "Way of the Open Hand"` (or equivalent) to the scenario JSON if this feature is intended to be tested

### AMBIGUOUS-2: Patient Defense, Step of the Wind, Deflect Attacks — not tested
- Combat ended in 1 round (Orc Brute died before round 2)
- Orc Brute missed Kai in its only turn → Deflect Attacks reaction never triggered
- Kai was never in a defensive position → Patient Defense never tested
- **Recommendation**: Scenario needs a tougher enemy or multi-round encounter to exercise defensive abilities

### AMBIGUOUS-3: Server auto-rolled Orc Brute CON save for Stunning Strike (8 vs DC 14)
- The 8 seems like a fixed/internal roll — the CLI did not prompt the player to enter the monster's save
- This is correct behavior (AI monsters don't ask human player to roll for them)
- However, value of 8 might be hardcoded for testing; need to verify this is truly random

---

## 📝 Notes

- Combat was extremely fast (1 round) due to Kai's damage output vs Orc Brute's 30 HP
- Total damage in 1 turn: 9 + 8 + 7 + 7 = 31, exceeding Orc Brute's 30 HP
- The scenario would benefit from a tougher opponent (Orc War Chief? 2 Orc Brutes?) to exercise multi-round ki management
- Reaction slot shown as "ready" throughout combat — implies Deflect Attacks reaction is registered correctly, but couldn't be triggered
- `uncanny_metabolism: 0/1` resource shown — this appears to be a 5e 2024 feature (Uncanny Metabolism at Level 2 allows regaining ki on short rest). The `0/1` display is correct (not yet used)
- Unarmed strike in scenario sheet lists 1d6+3 but server correctly applies 1d8+3 (Martial Arts Level 5) — good server-side override

---

## Checklist

| Feature | Status | Notes |
|---------|--------|-------|
| Ki pool 5/5 at level 5 | ✅ Confirmed | Displayed correctly at start |
| Flurry of Blows (2 extra strikes, 1 ki) | ✅ Confirmed | Both strikes resolved correctly |
| Stunning Strike (CON save on hit, 1 ki) | ✅ Confirmed | Save auto-resolved for NPC |
| Ki decrements correctly | ✅ Confirmed | 5→4→3 after abilities |
| Martial Arts die scaling (1d8 at L5) | ✅ Confirmed | Server overrides scenario sheet |
| Patient Defense | ⬜ Not tested | Enemy never hit Kai |
| Step of the Wind | ⬜ Not tested | Combat ended in round 1 |
| Open Hand Technique | ⬜ No subclass set | Scenario missing subclass field |
| Deflect Attacks reaction | ⬜ Not tested | Enemy missed its only attack |
| Extra Attack mislabeled prompt | 🐛 BUG-M1 | Cosmetic, matches BUG-8 |
