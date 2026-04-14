# Agent Player Test Run: Solo Fighter vs Goblins
Date: 2026-04-13
Scenario: solo-fighter
Outcome: Victory
Thorin HP at end: 42/42
Rounds played: 1

## Combat Log Summary

**Turn Order (Round 1):**
| Initiative | Combatant | Action |
|---|---|---|
| 17 | Goblin Warrior 1 | AI "moveToward" — no attack |
| 16 | Thorin Ironfist | Attacked + killed Goblin 1, moved 20ft, attacked + killed Goblin 2 |
| 13 | Goblin Warrior 2 | Never acted (killed on Thorin's turn) |

**Attack Roll Details:**
- Attack 1: Longsword vs Goblin 1 → d20=17, 17+6=23 vs AC 15, HIT → 7+3=10 damage (7→0 dead)
- Attack 2: Handaxe (auto-selected) vs Goblin 2 → d20=15, 15+6=21 vs AC 15, HIT → 5+3=8 damage (7→0 dead)

**Notes on attack modifier:** +6 = STR modifier (+3) + proficiency bonus (+3). Level 5 Fighter with STR 16, proficiency +3. Correct.

---

## ✅ Confirmed Working

- Initiative roll accepted and applied with DEX modifier (rolled 14, got initiative 16 → +2 DEX modifier applied)
- Turn order sorted correctly by initiative (17, 16, 13)
- Melee attack resolution: d20 roll + server-applied modifier vs AC — correct
- Damage modifier applied correctly (die face + STR modifier)
- Goblin dies instantly at 0 HP — correct
- Ranged/melee range enforcement works: server rejected attack on Goblin 2 at 30ft > 20ft with clear error message
- Movement processed correctly (moved 20ft, distance tracked)
- Combat victory detected after all enemies reach 0 HP
- Post-combat menu presented and quit option works
- Control server (`--control-port 3101`) functioned reliably
- Session setup (session creation, character + monster placement) worked without errors
- Attack modifier calculation correct throughout (+6 = STR+3 + Prof+3)

---

## 🚩 Bugs & Unexpected Behavior

### BUG-1: Goblin AI only moves, never attacks — no damage dealt to player
**Severity**: High  
**Reproduction**: Run solo-fighter scenario; observe Goblin Warrior 1 (initiative 17) with Thorin already at 5 ft. AI takes "moveToward" action with no attack.  
**Expected**: A Goblin Warrior adjacent to (or within movement range of) a target should move AND attack on the same turn. In D&D 5e, movement and attack are independent; using one does not consume the other.  
**Observed**: The AI logged `[AI] moveToward` and moved to position (15, 5) which is 5 ft from Thorin — exactly melee range — but never attacked. Thorin took 0 damage the entire combat.  
**Server response**: `🤖 [AI] moveToward — The goblin darts forward, closing in on Thorin to prepare for a flanking assault! [Turn → Next combatant]`  
**Impact**: Combat is trivially easy; the Goblin pose no threat. AI-controlled monsters that only move are functionally harmless.

---

### BUG-2: Server auto-selects wrong weapon when player explicitly specifies "longsword"
**Severity**: Medium  
**Reproduction**:
1. Move Thorin to (30, 10) — 10 ft from Goblin Warrior at (40, 10)
2. Type: `I attack the Goblin Warrior with my longsword`
3. Observe server uses Handaxe instead

**Expected**: Server should either (a) honor the explicit weapon choice and report "out of reach — longsword requires 5 ft, target is 10 ft away", OR (b) if auto-selecting, explicitly tell the player "Longsword can't reach (10 ft > 5 ft)" dont default to range weapon, especially when the player specified a weapon. The player should never be surprised by the server silently swapping their weapon choice without explanation.  
**Observed**: Server silently swapped to Handaxe, narrated "Thorin Ironfist raises his Handaxe", and prompted for 1d6+3 damage instead of 1d10+3.  
**Server response**: `📖 Thorin Ironfist raises his Handaxe and swings it toward the Goblin Warrior...` → `Enter your 1d6+3 roll for damage:`  
**Note**: The weapon swap may be *mechanically intentional* (thrown handaxe at 10 ft is valid), but the silent override with no explanation is a UX/rules clarity issue — the player is left unaware of why their stated weapon wasn't used.

---

### BUG-3: Extra Attack does not auto-chain — returns to `>` prompt between strikes
**Severity**: Medium  
**Reproduction**:
1. Thorin (Level 5 Fighter) attacks Goblin Warrior 1 with longsword on his turn
2. Attack kills Goblin Warrior 1 (7 damage > 7 HP)
3. Observe: game returns to `>` prompt without prompting for the second Extra Attack

**Expected**: In D&D 5e 2024, the Fighter's Extra Attack feature means the Attack action yields 2 attack rolls. After the first attack (whether hit, miss, or kill), the server should immediately prompt for the second d20 attack roll (with the player optionally choosing a new target). The session should NOT return to the full action menu between Extra Attack strikes.  **THIS NEEDS TO BE CONFIRMED WITH GAME RULES**
**Observed**: After killing Goblin 1, the game returned to `>` action prompt. No indication that a second Extra Attack was still available. The player had to manually re-input another attack command to use the second attack.  
**Additional note**: The second attack WAS accepted when manually re-issued (the action economy allowed it), confirming Extra Attack is tracked server-side. The UX gap is that there's no feedback that an Extra Attack remains. A player who doesn't know to re-type the attack would end their turn with an unused Extra Attack.

---

### BUG-4: Damage roll prompt confused by two-number input (non-critical)
**Severity**: Low  
**Reproduction**:
1. Server prompts `Enter your 1d6+3 roll for damage:`
2. Player sends `"15 8"` (intended as 2d20 rolls — player was confused by earlier disadvantage messaging from a different game session)
3. Server responds with error

**Expected**: Server should accept a single integer for damage rolls; the error itself is correct.  
**Observed**: `⚠ Please enter a number for your damage roll.` — server recovers gracefully and re-prompts. No crash.  
**Assessment**: Correct error handling. The confusion arose from player error (polluting port 3102's output into mental model). NOT a server bug.

---

## ⚠️ Ambiguous / Needs Review

- **Extra Attack target selection UX**: When the first Extra Attack kills its target, should the game return to the `>` prompt (to let player choose a new target) or should it immediately show "Extra Attack: choose your second target" with a narrowed prompt? Current behavior (return to full `>` prompt) is defensible but gives no indication the Extra Attack is still pending. WE SHOULD SHOW A PROMPT INDICATING EXTRA ATTACK IS STILL AVAILABLE.

- **Dead goblin positions and "moveToward" logic**: Goblin 1 was at (15, 5) at the start of its turn, which is already 5 ft from Thorin. Was the goblin placed there at combat-start, or did it start further away and move to (15,5) during round 1? If it started adjacent, the movement was wasted (and should not have happened). If it started further away, the movement is correct but the lack of an attack on the same turn is still the bug.

- **Thrown weapon at 10 ft with adjacent characters**: The second Goblin Warrior was 10 ft from Thorin when the Handaxe attack was made. The dead Goblin 1 was at (15, 5) — about 18 ft from Thorin's new position (30, 10). No nearby enemy threatened Thorin, so there should be no disadvantage on a ranged attack. The lack of disadvantage was confirmed. This part is correct.

---

## 📝 Notes

- **Combat completeed in a single round**: Both goblins died on Thorin's first full turn. Goblin 2 (initiative 13) never acted because Thorin (initiative 16) moved and killed it before initiative 13 came around. This is correct D&D behavior.
- **Thorin took 0 damage**: Due to BUG-1 (goblin's AI never attacking), Thorin ended battle at full HP 42/42.
- **Initiative**: Thorin rolled 14 on d20, got init 16. Implies DEX mod +2. Goblin 1 got init 17, Goblin 2 got init 13. Both rolled independently — correct.
- **Control server reliability**: The `/output` endpoint correctly drains buffered output. Polling every 3-5 seconds was sufficient.
- **Error outputs from old session** (port 3102) occasionally appeared in terminal output when PowerShell recycled a terminal session — not a game server bug, only a test harness UX observation.
- Second Wind was never tested (Thorin never went below 21 HP). Testing Second Wind requires Goblin AI to actually attack.
- Action Surge was never tested — with combat ending in 1 round, there was no scenario that warranted using it.
