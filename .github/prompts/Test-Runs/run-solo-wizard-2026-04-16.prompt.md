# Agent Player Test Run: Solo Wizard vs Undead Patrol
Date: 2026-04-16
Scenario: solo-wizard.json
Outcome: Victory
Elara HP at end: 11/32
Rounds played: 5

## Round-by-Round Summary

### Round 1 (Elara initiative 16)
- **Fire Bolt** → Skeleton Warrior: spell attack 15+7=22 vs AC 13, hit! 2d10=14 fire damage (26→12 HP)
- End turn (action spent, bonus/move unused — testing early end)
- AI: Skeleton Shortbow → Shield prompted → **accepted** → AC 12→17, "15+0=? vs AC 17 — Miss!"
- AI: Skeleton moved to (20,10)
- AI: Zombie moved to (15,5), Slam: "1+3=4 vs AC 12 — Miss!" (**Shield should still be active at AC 17!**)

### Round 2 (Elara)
- **Quarterstaff** → Zombie: attack 12+1=13 vs AC 8, hit! 1d8−1=5 bludgeoning (22→17 HP) — note: 1d8 not 1d6
- End turn
- AI: Skeleton Shortbow → Shield prompted → **declined** → "14+0=? vs AC 12 — Hit!" 7 damage (32→25→... 25? No, 14 HP since prev was 20... wait)
  - Actually: HP was 32, Round 1 no damage taken. Round 2: Shortbow 7 damage (32→25)
- AI: Zombie Slam → Shield prompted → **accepted** → AC 12→17, "18+0=? vs AC 17 — Hit!" 5 damage (25→20)

### Round 3 (Elara)
- **Burning Hands** (L1 slot) → DEX save DC 15, cone: Skeleton [failed], 8 fire damage (12→4 HP)
  - Only 1 creature in cone (Zombie in opposite direction — geometrically correct)
- End turn
- AI: Skeleton Shortbow → Shield prompted → **declined** → "13+0=? vs AC 12 — Hit!" 6 damage (20→14)
- AI: Skeleton moved to (12,10)
- AI: Zombie Slam: 3+3=6 vs AC 12, miss

### Round 4 (Elara)
- **Magic Missile** (L1 slot) → auto-hit! 3 darts (4+2+5=11 force), Skeleton killed (4→0 HP)
  - No attack roll requested ✅
- End turn
- AI: Zombie Slam: 15+3=18 vs AC 12, hit, 3 damage (14→11)
  - Shield NOT offered (0 L1 slots remaining) — correct!

### Round 5 (Elara)
- **Scorching Ray** (L2 slot) → Zombie, 3 beams:
  - Beam 1: 14+7=21 vs AC 8, hit! 2d6=8 fire (17→9)
  - Beam 2: 16+7=23 vs AC 8, hit! 2d6=7 fire (9→2)
  - Beam 3: 12+7=19 vs AC 8, hit! 2d6=6 fire (2→0) — **Zombie killed! VICTORY!**

## Spell Slot Tracking (verified each round)
| Action           | L1 Before | L1 After | L2 Before | L2 After |
|------------------|-----------|----------|-----------|----------|
| Shield (R1)      | 4/4       | 3/4      | 3/3       | 3/3      |
| Shield (R2)      | 3/4       | 2/4      | 3/3       | 3/3      |
| Burning Hands(R3)| 2/4       | 1/4      | 3/3       | 3/3      |
| Magic Missile(R4)| 1/4       | 0/4      | 3/3       | 3/3      |
| Scorching Ray(R5)| 0/4       | 0/4      | 3/3       | 2/3      |

Final: L1: 0/4 | L2: 2/3 | L3: 2/2 | arcaneRecovery: 1/1 — **all correct** ✅

## ✅ Confirmed Working
- Fire Bolt cantrip: correct spell attack bonus (+7 = proficiency 3 + INT mod 4), correct 2d10 at level 5
- Magic Missile: auto-hits with no attack roll, 3 darts × (1d4+1), force damage, correctly kills target
- Burning Hands: save-based (no attack roll), DEX save DC 15, cone geometry applied, only hits targets in cone direction
- Scorching Ray: 3 separate beams each with individual spell attack roll + 2d6 fire damage, L2 slot spent
- Shield reaction: correctly prompted when character is attacked, AC increases by +5 (12→17), L1 slot consumed
- Spell slot tracking: all slots decrement correctly across all spells and reactions
- End turn after casting: action economy correctly shows "Action spent" and allows ending turn with unused bonus/movement
- Quarterstaff melee attack: correctly resolves with attack bonus +1 and damage
- Cantrip is free (no spell slots consumed for Fire Bolt)
- Shield not offered when no L1 slots available (Round 4)
- Defeated enemies correctly marked and removed from combat flow
- AI enemies use appropriate weapons (ranged when far, melee when close)
- Initiative calculation correct (14 raw + 2 DEX = 16)
- Turn order respected throughout (Elara 16, Skeleton 6, Zombie 0)
- Victory condition triggers when all enemies at 0 HP
- Post-combat menu displays correctly

## 🚩 Bugs & Unexpected Behavior

### BUG-W1: Shield AC Bonus Doesn't Persist to Subsequent Attackers
**Severity**: High
**Reproduction**:
  1. Round 1: Skeleton Warrior attacks → Shield prompted → accepted → AC 12→17
  2. Skeleton attack misses (15 vs AC 17) ✅
  3. Zombie attacks (same round, before Elara's next turn) → Slam shows "vs AC 12" — not AC 17
**Expected (5e 2024 rule)**: Shield grants "+5 bonus to AC... until the start of your next turn." The AC bonus should apply to ALL attacks until Elara's next turn, including the Zombie's attack later in the same round.
**Actual**: Shield AC bonus only applied to the single attack it was triggered on. The next attacker (Zombie) targeted base AC 12 instead of 17.
**Evidence**: Round 1: Shield on Skeleton → "vs AC 17". Same round, Zombie → "vs AC 12". Round 2: Shield on Zombie → "vs AC 17" — confirming Shield works per-attack but doesn't persist.

### BUG-W2 (=BUG-7): Reaction Messages Show Internal Combatant IDs
**Severity**: Medium
**Reproduction**:
  1. Any time Shield is prompted (accept or decline)
  2. The reaction message shows `[Reaction] SU7P9K9ETolTSJbKU49di uses shield` or `SU7P9K9ETolTSJbKU49di declines shield`
**Expected**: `[Reaction] Elara the Wise uses shield` / `Elara the Wise declines shield`
**Actual**: Internal combatant ID is displayed instead of the character name
**Server response**: `✅ [Reaction] SU7P9K9ETolTSJbKU49di uses shield`

### BUG-W3: Inconsistent Attack Roll Display Format for AI Attacks
**Severity**: Low
**Reproduction**:
  1. Skeleton Warrior Shortbow attacks show: `Shortbow: 14 + 0 = ? vs AC 12`
  2. Zombie Slam attacks show: `Slam: 15 + 3 = 18 vs AC 12` (correct format)
  3. After some rounds, Zombie Slam correctly shows `15 + 3 = 18` but Skeleton keeps showing `+0`
**Expected**: Attack display should consistently show `[raw roll] + [attack bonus] = [total] vs AC [target]`
**Actual**: Skeleton Shortbow (+4 bonus) displays `+0` modifier. The first number may be the total, but the format is inconsistent with Zombie Slam which correctly shows the modifier.
**Note**: The actual hit/miss math appears correct (attacks that should hit do hit), so this may be a display-only issue where the Skeleton's Shortbow attack bonus isn't extracted from the stat block properly.

### BUG-W4: Quarterstaff Uses 1d8 Instead of Scenario-Defined 1d6
**Severity**: Low
**Reproduction**:
  1. Scenario JSON defines Quarterstaff as `"diceSides": 6` (1d6−1)
  2. Game displays and rolls `1d8−1` for quarterstaff damage
**Expected**: Use the damage dice defined in the scenario character sheet (1d6−1 one-handed)
**Actual**: Uses 1d8−1 (two-handed versatile mode)
**Note**: This might be intentional — the server may apply D&D versatile weapon rules (1d8 two-handed when no shield), overriding the scenario definition. If intentional, the scenario definition should be updated to match. Either way, the scenario JSON is misleading.

## ⚠️ Ambiguous / Needs Review
- **Burning Hands targeting**: I said "on the Skeleton Warrior and Zombie" but only the Skeleton was in the cone. The Zombie was in the opposite direction from the Skeleton relative to Elara. The system correctly computed the cone direction toward the primary target (Skeleton). This seems geometrically correct, but the UX could inform the player that the Zombie was outside the cone area.
- **Concentration tracking**: Could NOT be tested — none of the prepared spells (Fire Bolt, Magic Missile, Burning Hands, Scorching Ray, Shield) require concentration. The solo-wizard scenario needs a concentration spell added (e.g., Hold Person, Flaming Sphere, or Web) to test this mechanic.
- **Shield prompt after damage**: In Rounds 1-2, the "Shield spell used/declined - attack resolved" message appears AFTER the next combatant's turn actions, not immediately after the attack resolution. This creates confusing output ordering.
- **Zombie attack bonus display**: In Round 4, Zombie Slam showed `15 + 3 = 18` (correct +3 bonus), but in Round 1, Skeleton showed `14 + 0` — the inconsistency might be related to how ranged vs melee monster attack bonuses are resolved.

## 📝 Notes
- The wizard gameplay loop feels natural: cantrip (free) → save spells for key moments → Shield when needed → Level 2+ for multi-target/finisher
- All 4 spell types tested: cantrip attack roll (Fire Bolt), auto-hit (Magic Missile), save-based area (Burning Hands), multi-beam attack (Scorching Ray)
- Shield reaction UX is great — prompting "Cast Shield to raise AC?" before each eligible attack is intuitive
- AI behavior was reasonable: Skeleton used Shortbow at range, moved tactically; Zombie closed for melee
- The `arcaneRecovery: 1/1` resource tracked but never tested (would need short rest)
- L3 spell slots (2/2) unused — no L3 spells in the prepared list
- Total damage dealt by Elara: 14 (Fire Bolt) + 5 (Quarterstaff) + 8 (Burning Hands) + 11 (Magic Missile) + 21 (Scorching Ray) = 59 damage dealt across 5 rounds
- Total damage taken: 7 (Shortbow R2) + 5 (Slam R2) + 6 (Shortbow R3) + 3 (Slam R4) = 21 damage taken (HP 32→11)

## Checklist Summary

```
SCENARIO: solo-wizard
CHARACTER: Elara the Wise (Level 5 Wizard)
OUTCOME: Victory
HP_AT_END: 11/32
ROUNDS: 5

CHECKLIST:
- [x] Fire Bolt cantrip works (2d10 at level 5): +7 attack, 2d10 fire, correct cantrip scaling
- [x] Magic Missile auto-hits: 3 darts, 1d4+1 each, force damage, no roll requested
- [x] Burning Hands (save-based, area): DEX save DC 15, cone AoE, L1 slot consumed
- [x] Scorching Ray (multiple attack rolls): 3 beams, each with d20+7 spell attack + 2d6 fire
- [x] Shield reaction (+5 AC): Prompted on attack, AC 12→17, L1 slot consumed, but duration bug (BUG-W1)
- [x] Spell slot tracking: All slots decrement correctly through 5 rounds of combat
- [x] Creative: Cast spell then end turn: Action economy correct, bonus/move preserved
- [ ] Creative: Move into melee range: Enemies came to me, didn't test player-initiated movement into melee
- [x] Creative: Use quarterstaff: Hit Zombie, 1d8-1 damage (versatile override from 1d6)
- [ ] Concentration tracking: UNTESTABLE — no concentration spells in prepared list

BUGS_FOUND:

BUG-W1: Shield AC Bonus Doesn't Persist Until Start of Next Turn
Severity: High
Reproduction: Cast Shield on first attacker's turn; second attacker in same round targets base AC
Expected: +5 AC persists until start of caster's next turn (per PHB 2024)
Actual: +5 AC only applies to the triggering attack
Server_response: Skeleton attack "vs AC 17" then Zombie attack same round "vs AC 12"

BUG-W2: Reaction Messages Show Internal Combatant IDs (=BUG-7 from batch 1)
Severity: Medium
Reproduction: Accept or decline Shield reaction
Expected: "[Reaction] Elara the Wise uses shield"
Actual: "[Reaction] SU7P9K9ETolTSJbKU49di uses shield"
Server_response: "✅ [Reaction] SU7P9K9ETolTSJbKU49di uses shield"

BUG-W3: Inconsistent AI Attack Roll Display Format
Severity: Low
Reproduction: Skeleton Shortbow attacks show "+0" modifier, Zombie Slam correctly shows "+3"
Expected: Consistent "[raw] + [bonus] = [total] vs AC" format
Actual: Skeleton Shortbow: "14 + 0 = ? vs AC 12" (wrong +0, missing total)
Server_response: "⚔️ [Attack] Shortbow: 14 + 0 = ? vs AC 12 - Hit! (7 damage)"

BUG-W4: Quarterstaff Damage Dice Override
Severity: Low
Reproduction: Attack with quarterstaff, scenario defines 1d6, game uses 1d8
Expected: 1d6-1 (matching scenario definition)
Actual: 1d8-1 (versatile two-handed override)
Server_response: "Roll 1d8-1 for damage"

CONFIRMED_WORKING:
- Fire Bolt cantrip: +7 spell attack, 2d10 fire at level 5, no slot consumed
- Magic Missile auto-hit: no roll, 3 darts × (1d4+1) force damage
- Burning Hands: save-based, DEX DC 15, cone AoE geometry, L1 slot consumed
- Scorching Ray: 3 beams, separate attack rolls per beam, 2d6 fire each, L2 slot consumed
- Shield reaction: prompted on attack, +5 AC, L1 slot consumed, not offered when 0 slots
- Spell slot tracking: all types decrement correctly across rounds
- Action economy: correct action/bonus/reaction/movement tracking per turn
- Turn order: initiative-based, consistent all rounds
- Victory condition: triggers on all enemies at 0 HP
- Post-combat menu: functional
- AI behavior: appropriate weapon selection, tactical movement

AMBIGUOUS:
- Concentration: not testable with current prepared spell list, needs scenario update
- Burning Hands multi-target: only hit 1 target (geometrically correct), but no UX feedback about missed targets
- Shield duration display: "Shield spell used - attack resolved" message appears with delayed timing
- Arcane Recovery: tracked as resource but no short rest taken to test
```
