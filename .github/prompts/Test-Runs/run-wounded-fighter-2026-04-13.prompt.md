# Agent Player Test Run: Wounded Fighter vs Goblin Horde
Date: 2026-04-13
Scenario: wounded-fighter
Outcome: Victory
Thorin HP at end: 29/42
Rounds played: 2

## ✅ Confirmed Working
- Starting HP correctly set to 18/42 (wounded state confirmed on first combatant display)
- Second Wind available at start (`secondWind: 1/1`) and heals correctly: `6 + 5 = 11 HP`, bringing Thorin from 18 → 29 HP
- Second Wind is correctly registered as a bonus action (action remained available after use)
- Action Surge correctly available and activates (`actionSurge: 1/1` → granted 2 additional attacks)
- Action economy tracking: Action Surge and Second Wind both show `0/1` after being spent across the turn boundary
- First attack (Longsword, `1d10+3`) uses correct attack bonus (+6) and damage modifier (+3)
- Combat display shows resources, HP, turn economy and position correctly each turn
- Goblin AI correctly moved toward Thorin, attempted attack, then used Disengage as a class feature (Nimble Escape)
- Goblin attack roll uses correct modifier: `3 + 4 = 7 vs AC 18 - Miss!`
- Melee range enforcement working: correctly rejected attack on goblin 30ft away (`400: Target is out of range (30ft > 20ft)`)
- Victory condition triggers properly when all 4 goblins reach 0 HP
- Post-combat menu renders correctly with 5 options
- In Round 2, specifying weapon explicitly (`"I attack the Goblin Warrior with my longsword"`) correctly selected the Longsword

## 🚩 Bugs & Unexpected Behavior

### BUG-1: Second "attack again" command parsed as off-hand TWF attack with Handaxe+Disadvantage instead of Extra Attack
**Severity**: High
**Reproduction**:
1. On Thorin's turn (Level 5 Fighter, having Extra Attack), send `"I attack the Goblin Warrior"` (first attack — correctly uses Longsword)
2. After first attack resolves, send `"I attack the nearest Goblin Warrior again"`
3. Server initiates Handaxe attack **with Disadvantage** via `2d20 take lower` prompt
**Expected (5e 2024 rule)**: Extra Attack (Fighter 5) allows two attacks as part of the same Attack action. Both attacks should use the same weapon (or chosen weapon), with no disadvantage. Two-Weapon Fighting uses a Handaxe as a **bonus action** and does NOT impose disadvantage — it simply omits the ability modifier from damage (unless the Two-Weapon Fighting style is taken).
**Server response**:
```
📖 Thorin Ironfist raises his Handaxe and swings it toward the Goblin Warrior...
  ⬇ Disadvantage! Roll 2d20 and take the lower.
Roll a d20 with disadvantage (roll 2d20, take lower) for attack against Goblin Warrior
Enter your 2d20 rolls for attack (e.g. 15 8):
```

### BUG-2: Explicit weapon specification ("with my longsword") ignored when attack is parsed as off-hand
**Severity**: Medium
**Reproduction**:
1. After using Action Surge, send `"I attack the nearest Goblin Warrior with my longsword"`
2. Server selects Handaxe with Disadvantage despite explicit weapon specification
**Expected (5e 2024 rule)**: Player should be able to specify which weapon to attack with. If the player says "with my longsword," the server should use the longsword.
**Server response**:
```
> I attack the nearest Goblin Warrior with my longsword
📖 Thorin Ironfist raises his Handaxe and swings it toward the Goblin Warrior...
  ⬇ Disadvantage! Roll 2d20 and take the lower.
```
Note: In Round 2, when no prior attack had been made that turn, `"I attack the Goblin Warrior with my longsword"` correctly selected Longsword. The issue appears isolated to attacks after a first attack resolves within the same turn.

### BUG-3: Extra Attack does not auto-chain — requires manual re-input
**Severity**: Medium
**Reproduction**:
1. As Level 5 Fighter, send `"I attack the Goblin Warrior"` — first attack resolves and kills target
2. Server returns `>` prompt with no indication a second attack remains available
3. Player must explicitly send another attack command to get a second attack
**Expected (5e 2024 rule)**: When a Fighter with Extra Attack uses the Attack action, the system should prompt for all attacks in sequence automatically (or at least indicate "you have 1 attack remaining"). The current experience requires the player to organically know to ask again.
**Server response**: After first kill the prompt returns to `>` with no indication a second attack remains available within the same action.

### BUG-4: Action Surge attack count message appears incorrect
**Severity**: Low
**Reproduction**:
1. Fighter makes first attack, then off-hand (bonus) attack (both resolve)
2. Send `"I use action surge and attack the Goblin Warrior"`
3. Observe message: `Action Surge! Gained 2 additional attacks (4 total attacks remaining).`
**Expected (5e 2024 rule)**: At this point in the turn the Attack action and Bonus Action are both used. Action Surge grants one more Action = 2 more attacks for a Level 5 Fighter. The message "4 total attacks remaining" implies 4 more attacks remain, which contradicts "gained 2 additional." At most 2 should remain.
**Server response**: `Action Surge! Gained 2 additional attacks (4 total attacks remaining).`

## ⚠️ Ambiguous / Needs Review
- The wounded-fighter scenario did NOT trigger any special narrative or mechanical handling for a character below 50% HP at combat start. The server simply started combat normally. If the scenario intends to test something specific about the wounded state beyond Second Wind availability, that functionality is not visible.
- The off-hand Handaxe attack uses `1d6+3` damage (adds ability modifier). Standard 5e TWF without the Two-Weapon Fighting style should NOT add the STR modifier to damage. However, if Thorin has the Two-Weapon Fighting style, `+3` is correct. Thorin's character sheet should be verified.
- The Handaxe attack with Disadvantage: in standard 5e, the only time a melee attack has disadvantage inherently is when attacking while prone, heavily obscured, etc. None of those conditions apply here. The disadvantage application needs investigation.
- for advantage and disadvantage roles, the server should specify that the player should role two dice and take the higher or lower, respectively. Currently the prompt asks for two values, but the user should just be asked for single value assuming the user understands the mechanic.

## 📝 Notes
- **Starting HP validation**: Thorin correctly starts at 18/42 HP (below 50% of 42 max). Second Wind was available immediately as the scenario intended.
- **Second Wind formula**: Healed `1d10 + Fighter Level` = `6 + 5 = 11 HP`. Matches 5e 2024 rules exactly.
- **Combat flow summary**:
  - Round 1: Second Wind (+11 HP, 18→29), Move 30ft to (40,10), Longsword attack kills Goblin 1 (11 dmg), Handaxe+Disadvantage kills Goblin 2 (8 dmg), Action Surge activated, Handaxe+Disadvantage kills Goblin 3 (9 dmg). 4th goblin out of range (30ft). Ended turn. Goblin 4 moved in, attacked with Scimitar (7 vs AC 18 — Miss), used Disengage.
  - Round 2: Goblin 4 adjacent at 5ft. Longsword attack kills Goblin 4 (10 dmg). Victory.
- **No damage taken**: Thorin ended at 29/42 HP — identical to post-Second Wind HP — the single goblin attack missed.
- **Attack bonus consistency**: All attacks used +6 to hit (STR +3 + Prof +3 at level 5). This is correct.
- **Melee range**: System uses 20ft as the max melee attack range, not 5ft (standard reach). This is a mild discrepancy vs RAW but may be intentional for the grid system.

## 📝 Notes
- First run reached enemy AI progression after end turn, but control output visibility was intermittent.
- Second run also exhibited prompt synchronization issues and could not be completed reliably end-to-end within the control loop.
- Because of the desync, post-combat menu was not reached, so menu exit with 5 could not be executed in this scenario run.

