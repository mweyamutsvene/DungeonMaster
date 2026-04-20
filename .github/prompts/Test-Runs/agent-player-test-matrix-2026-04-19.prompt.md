# Agent Player Test Matrix — 2026-04-19 (Round 2)
**LLM Provider**: Ollama (`gpt-oss:20b`)  
**Purpose**: Cover untested classes, deeper spell mechanics, tactical combat patterns, edge cases, and regression verification of all previously fixed bugs.

> **Prerequisites**: All 204 E2E mock scenarios pass. All 30 bugs from Round 1 are fixed. This round focuses on live LLM agent play to discover new integration issues.

---

## Batch 1: Untested Classes + New Scenarios (Ports 3002–3005)

### Test A: `solo-cleric` — Cleric Full Toolkit (**NEW SCENARIO**)
**Why**: Cleric was never tested in Round 1. Tests save-based cantrips, healing, buffs, concentration, Turn Undead channel divinity, and the most common support class patterns.
- [ ] Sacred Flame cantrip works (DEX save, radiant damage, ignores cover)
- [ ] Toll the Dead cantrip works (WIS save, d8/d12 based on damage status)
- [ ] Guiding Bolt spell attack + "next attack has advantage" effect
- [ ] Bless concentration buff applies +1d4 to attack rolls
- [ ] Shield of Faith as bonus action (+2 AC concentration)
- [ ] Cure Wounds heals for 2d8 + WIS modifier
- [ ] Healing Word as bonus action (ranged heal, 2d4 + WIS)
- [ ] Spirit Guardians aura zone (3d8 radiant, WIS save, enemies only)
- [ ] Turn Undead channel divinity (WIS save or turned)
- [ ] Spell slot tracking decrements correctly after each cast
- [ ] Concentration tracking — casting a new conc spell drops the old one
- [ ] **Creative: Bless self → attack with Sacred Flame** — verify +1d4 on save DC
- [ ] **Creative: Spirit Guardians → move into enemies** — aura damages on enter
- [ ] **Creative: Healing Word + attack same turn** — bonus action spell + action
- [ ] **Creative: Switch from offense to defense** — cast Cure Wounds on self when low
- [ ] AI enemies target the cleric (only combatant)
- [ ] Combat ends correctly when all enemies die
- [ ] LLM narration fires and makes sense

### Test B: `endurance-fighter` — Multi-Round Attrition (**NEW SCENARIO**)
**Why**: Previous fighter tests ended in 1-2 rounds. This has 4 enemies (1 captain + 3 soldiers) to force resource management over 3-4 rounds. Tests Second Wind timing, Action Surge strategic use, and potentially death saves.
- [ ] Initiative rolls for 5 combatants work correctly
- [ ] Turn order cycles through all combatants
- [ ] Extra Attack (2/action) chains reliably every round
- [ ] Action Surge at the right moment (strategic use, not round 1)
- [ ] Second Wind triggers when HP < 50% (bonus action heal)
- [ ] Resource tracking across multiple rounds (action surge 1→0, second wind 1→0)
- [ ] Multiple enemies attack in sequence without stalling
- [ ] **Creative: Kite enemies** — move away, force them to approach
- [ ] **Creative: Focus fire one target** — kill captain first
- [ ] **Creative: Throw handaxe at range** — ranged attack before melee
- [ ] **Creative: Use shield bash** — offhand/unarmed attack after main weapon
- [ ] HP attrition — player takes meaningful damage over multiple rounds
- [ ] Death saves if player reaches 0 HP (stretch goal)
- [ ] Victory declared when all 4 enemies die
- [ ] AI uses ranged attacks (longbow) when out of melee range
- [ ] AI pathfinding with multiple enemies doesn't stall

### Test C: `ranged-archer` — Pure Ranged Combat (**NEW SCENARIO**)
**Why**: All previous tests were melee-focused. Tests longbow at range, long-range disadvantage, ranged-in-melee disadvantage, kiting, Archery feat bonus, and weapon switching.
- [ ] Longbow attack at normal range (≤150 ft) — no disadvantage
- [ ] Longbow attack at long range (>150 ft, ≤600 ft) — disadvantage applies
- [ ] Ranged attack while enemy is within 5 ft — disadvantage applies
- [ ] Archery feat +2 attack bonus reflected in attack roll
- [ ] Extra Attack with ranged weapon chains correctly
- [ ] Action Surge with ranged weapons (4 arrows in one round)
- [ ] **Creative: Kite wolves** — shoot, move back, shoot again
- [ ] **Creative: Switch to shortsword** when wolves close in
- [ ] **Creative: Throw dagger** at fleeing enemy
- [ ] **Creative: Disengage and reposition** to maintain range
- [ ] Fast wolves (speed 40-50) close distance quickly — tests movement disparity
- [ ] Multiple enemies converging from different directions
- [ ] Combat resolution when melee and ranged mix

### Test D: `party-dungeon` — Multi-PC Party Retry
**Why**: Timed out in Round 1 (BUG-J1). Re-test in isolation without Ollama contention.
- [ ] Session starts without timeout
- [ ] Fighter PC + Wizard NPC both get initiative
- [ ] Turn order alternates correctly between party and enemies
- [ ] NPC (Elara) takes AI-controlled actions (Fire Bolt)
- [ ] Player can target specific enemies by name
- [ ] Goblin Boss uses Nimble Escape (bonus action disengage/hide)
- [ ] Goblin Archer uses ranged attacks
- [ ] Multiple combatant deaths tracked correctly
- [ ] Victory when all goblins die
- [ ] **Creative: Position behind Elara** — let NPC tank
- [ ] **Creative: Focus Goblin Boss** — coordinate with NPC
- [ ] **Creative: End turn and let NPC handle it** — passive play

---

## Batch 2: Spell System Deep Dive (Ports 3006–3008)

### Test E: `wizard-full-toolkit` — Level 7 Wizard (**NEW SCENARIO**)
**Why**: Round 1 wizard only tested Fire Bolt cantrip. This tests the full spell arsenal including AoE, multi-attack, save-based, zone, concentration, reactions, and upcasting.
- [ ] Fire Bolt cantrip (2d10 at level 7)
- [ ] Ray of Frost cantrip (damage + speed reduction effect)
- [ ] Magic Missile auto-hit (3 darts, no attack roll)
- [ ] Burning Hands (DEX save, 3d6 fire, 15-ft cone AoE)
- [ ] Scorching Ray (3 separate attack rolls, 2d6 fire each)
- [ ] Hold Person (WIS save, Paralyzed condition, concentration)
- [ ] Web (zone spell, DEX save or Restrained)
- [ ] Fireball (DEX save, 8d6 fire, 20-ft radius AoE)
- [ ] Wall of Fire (zone, 5d8 fire, concentration)
- [ ] Shield reaction when hit (+5 AC)
- [ ] Counterspell reaction when Bandit Mage casts
- [ ] Misty Step bonus action teleport (30 ft)
- [ ] Spell slot tracking across multiple levels (1/2/3/4)
- [ ] Concentration management — dropping one to cast another
- [ ] **Creative: Fireball opening** — nuke clustered bandits
- [ ] **Creative: Hold Person → attack paralyzed target** (auto-crit in melee)
- [ ] **Creative: Misty Step away + Fire Bolt** — bonus + action combo
- [ ] **Creative: Web area denial** — block corridor, pick off with cantrips
- [ ] **Creative: Upcast Scorching Ray** at level 3 (4 rays instead of 3)
- [ ] Bandit Mage casts spells (Fire Bolt, Magic Missile, etc.)
- [ ] Concentration save when wizard takes damage

### Test F: `solo-warlock` — Hex + Eldritch Blast Regression
**Why**: Multiple bugs found in Round 1 (WL1-WL4). Re-verify all fixes + test concentration saves.
- [ ] Eldritch Blast fires 2 beams at level 5
- [ ] Each beam gets separate attack roll
- [ ] Force damage 1d10 per beam (correct, not 2d10)
- [ ] Hex concentration applies +1d6 necrotic per beam hit (**was BUG-WL1**)
- [ ] Hex retarget via bonus action works (**was BUG-WL2**)
- [ ] Damage formula display shows all components clearly (**was BUG-WL1/WL3**)
- [ ] Beam 2 skips dead targets (**was BUG-WL4**)
- [ ] Pact Magic slot tracking (separate from spell slots)
- [ ] **Creative: Hex → EB → EB → retarget Hex** — full rotation
- [ ] Concentration save when damaged (DC = max(10, damage/2))
- [ ] OA resolution works when moving (**was BUG-2**)
- [ ] AI Spectral Guard actually takes actions (not passive)

### Test G: `solo-paladin` — Shield of Faith + Smite Regression
**Why**: BUG-P2 (Shield of Faith consumed action instead of bonus action) and BUG-P3 (no spell slot consumed). Re-verify fixes.
- [ ] Divine Smite extra radiant damage on hit (2d8 base, +1d8 vs fiend/undead)
- [ ] Shield of Faith as BONUS ACTION (+2 AC, concentration) (**was BUG-P2**)
- [ ] Shield of Faith consumes spell slot (**was BUG-P3**)
- [ ] Shield of Faith + attack on same turn (bonus + action)
- [ ] Lay on Hands healing (pool of 25 HP)
- [ ] Spell slot tracking for smite + spells
- [ ] Extra Attack (2/action) chains
- [ ] Sap weapon mastery applies on hit
- [ ] **Creative: Shield of Faith → Divine Smite combo** — AC buff + damage burst
- [ ] **Creative: Lay on Hands when critical** — emergency healing
- [ ] Concentration save after taking damage with Shield of Faith active
- [ ] AI enemies don't stall (**was BUG-P4**)

---

## Batch 3: Tactical Combat Patterns (Ports 3009–3011)

### Test H: `grapple-arena` — Grapple-Focused Combat (**NEW SCENARIO**)
**Why**: Grapple was attempted but never successful in Round 1. Dedicated scenario with high-STR barbarian for reliable grapple testing.
- [ ] Grapple action succeeds (STR check vs target STR/DEX)
- [ ] Rage gives advantage on grapple STR checks
- [ ] Grappled condition applied to target (speed 0, can't move)
- [ ] Grappled target can attempt escape (action: STR/DEX vs grappler STR)
- [ ] Drag grappled target during movement (half speed)
- [ ] Shove prone after grapple (ADV on melee, DISADV at range)
- [ ] Attack grappled+prone target with advantage
- [ ] Extra Attack: grapple + attack in same action
- [ ] **Creative: Rage → grapple → shove prone → attack** — full combo
- [ ] **Creative: Grapple and drag toward edge** — tactical positioning
- [ ] **Creative: Release grapple voluntarily** — switch targets
- [ ] Grapple breaks when grappler is incapacitated
- [ ] Can't grapple creature more than one size larger

### Test I: `rogue-assassination` — Hit-and-Run Tactics (**NEW SCENARIO**)
**Why**: Round 1 rogue test was incomplete (BUG-1/2/3 cascading failures). New dedicated scenario at level 7 tests the full rogue tactical loop.
- [ ] Sneak Attack (4d6) on first hit with advantage or ally adjacent
- [ ] Cunning Action: Hide as bonus action → Hidden condition
- [ ] Cunning Action: Disengage as bonus action → no OA (**was BUG-1**)
- [ ] Cunning Action: Dash as bonus action → double movement
- [ ] Hidden → attack with advantage → Sneak Attack triggers
- [ ] Uncanny Dodge reaction → halve damage from attack (**was BUG-13**)
- [ ] Evasion: DEX save for half → take zero damage
- [ ] **Creative: Hide → Shortbow attack from stealth** — ranged sneak attack
- [ ] **Creative: Rapier attack → Cunning Action Disengage → move away**
- [ ] **Creative: Dash to reposition** — get behind cover
- [ ] **Creative: End turn hidden** — force enemies to search
- [ ] Sneak Attack limited to once per turn
- [ ] Hidden condition breaks on attack
- [ ] OA system works correctly after Disengage (**was BUG-2**)
- [ ] No encounter hang/crash (**was BUG-3**)

### Test J: `monk-vs-monk` — Mirror Match Retry
**Why**: Timed out in Round 1 (BUG-K1). Tests ki resource war, Stunning Strike vs Stunning Strike, Deflect Attacks reactions, and Flurry of Blows.
- [ ] Session starts without timeout
- [ ] Both combatants have ki pools (5 each)
- [ ] Player Flurry of Blows (2 extra unarmed strikes, 1 ki)
- [ ] Stunning Strike on hit (CON save or stunned, 1 ki)
- [ ] Patient Defense (dodge as bonus action, 1 ki)
- [ ] Step of the Wind (dash/disengage as bonus, 1 ki)
- [ ] Deflect Attacks reaction (reduce damage, redirect if reduced to 0)
- [ ] NPC monk uses ki abilities via AI
- [ ] Ki resource war — who exhausts first
- [ ] Stunned condition properly prevents actions
- [ ] **Creative: Flurry → Stunning Strike on each hit** — max stun chance
- [ ] **Creative: Patient Defense → wait for enemy to waste ki**
- [ ] **Creative: Step of the Wind to kite** — disengage + bonus move

---

## Batch 4: Edge Cases & Stress Tests (Ports 3012–3014)

### Test K: `party-fighter-cleric` — Party Coordination (**NEW SCENARIO**)
**Why**: Tests multi-PC party with AI-controlled ally. Fighter + Cleric NPC vs Orc warband. Validates NPC AI spell selection, buff/heal behavior, and coordinated combat.
- [ ] Fighter + Cleric NPC both get initiative
- [ ] Cleric NPC casts Bless on party (self + fighter)
- [ ] Cleric NPC uses Healing Word when ally is wounded
- [ ] Cleric NPC uses Sacred Flame or Guiding Bolt for damage
- [ ] Cleric NPC casts Spirit Guardians when enemies close in
- [ ] Fighter Extra Attack chains while Blessed (+1d4 on attacks)
- [ ] Orc War Chief hits hard (1d12+4) — creates healing pressure
- [ ] Multiple rounds of coordinated combat
- [ ] **Creative: Position behind Cleric NPC** — let AI tank
- [ ] **Creative: Move away from Orc War Chief** — force OA or let cleric heal
- [ ] **Creative: Focus the ranged Orc Raider** — eliminate ranged threat first
- [ ] Bless concentration maintained while cleric takes damage
- [ ] Victory when all orcs die

### Test L: `wounded-fighter` — Death Save Scenario
**Why**: Round 1 wounded-fighter never reached 0 HP. Intentionally play recklessly to trigger death saves.
- [ ] Start at 18/42 HP
- [ ] Skip Second Wind — play recklessly to test death saves
- [ ] **Creative: Move into melee with all goblins** — maximize incoming damage
- [ ] **Creative: End turn without attacking** — let goblins pile on
- [ ] Death save triggers at 0 HP (d20: 10+ success, 9- failure)
- [ ] 3 successes → stabilize
- [ ] 3 failures → death
- [ ] Natural 20 → regain 1 HP
- [ ] Natural 1 → 2 failures
- [ ] Taking damage at 0 HP = automatic death save failure
- [ ] Healing at 0 HP restores consciousness
- [ ] Second Wind can't be used while unconscious (bonus action requires consciousness)

### Test M: `solo-barbarian` — Rage + OA Regression
**Why**: Multiple bugs from Round 1 (BUG-2 OA 404, BUG-4 Dash distance, BUG-14 Rage drop). Re-verify all fixes.
- [ ] Rage activates as bonus action (+2 damage, resistance, ADV on STR)
- [ ] Rage damage bonus shows in attack equation (**was BUG-9**)
- [ ] Reckless Attack gives advantage (2d20)
- [ ] Dash gives full double movement (60 ft total) (**was BUG-4**)
- [ ] OA triggers correctly when moving away (**was BUG-2**)
- [ ] OA resolves without 404 error (**was BUG-2**)
- [ ] Rage persists after Dash turn (no attack required in 2024 rules) (**was BUG-14**)
- [ ] Damage resistance to B/P/S while raging
- [ ] Javelin at long range (30/120 ft) accepted (**was BUG-11**)
- [ ] Extra Attack prompt says "attack" not "damage" (**was BUG-8**)
- [ ] **Creative: Rage → Reckless → Grapple** — STR check with ADV
- [ ] **Creative: Move away from enemy** — trigger OA, test resolution
- [ ] **Creative: Throw javelin at 60 ft** — long range with disadvantage

---

## Batch 5: Advanced Spell & Reaction Interactions (Ports 3015–3016)

### Test N: `solo-wizard` (original) — Shield + Concentration Saves
**Why**: Round 1 wizard test only used Fire Bolt. Re-run with focus on Shield reaction, concentration saves, and multi-spell turns.
- [ ] Fire Bolt cantrip works (2d10 at level 5)
- [ ] Magic Missile auto-hit (3 darts × 1d4+1 force)
- [ ] Burning Hands (DEX save, 15-ft cone, 3d6 fire)
- [ ] Scorching Ray (3 rays × 2d6 fire, separate attacks)
- [ ] Shield reaction triggers when attacked (+5 AC until next turn)
- [ ] Concentration save when maintaining a spell and taking damage
- [ ] **Creative: Cast Scorching Ray → take damage → Shield reaction**
- [ ] **Creative: Melee attack with quarterstaff** — wizard in melee
- [ ] **Creative: Move away to avoid melee** — kiting with cantrips
- [ ] Spell slot tracking over multiple rounds
- [ ] Skeleton vulnerability to radiant damage (if applicable)

### Test O: `boss-fight` — OA + Action Surge Regression
**Why**: BUG-F1 (Extra Attack mislabel), BUG-F3 (post-OA 404). Re-verify.
- [ ] Action Surge + Extra Attack = 4 attacks in one round
- [ ] Extra Attack label says "attack" not "damage" (**was BUG-F1**)
- [ ] Ogre takes OA when fleeing — OA resolves cleanly (**was BUG-F3**)
- [ ] Post-OA no stale pending action errors
- [ ] Second Wind at right timing (when damaged)
- [ ] **Creative: Grapple the Ogre** — STR contest
- [ ] **Creative: Shove Ogre prone** → attack with advantage
- [ ] Initiative display consistent between narrative and turn order (**was BUG-F4**)

---

## Summary: Coverage Matrix

### New Areas Tested (not in Round 1)
| Area | Test(s) | Priority |
|------|---------|----------|
| Cleric class | A | **Critical** — never tested |
| Save-based cantrips (Sacred Flame) | A | High |
| Healing spells (Cure Wounds, Healing Word) | A, K | High |
| Buff concentration (Bless, Spirit Guardians) | A, E, K | High |
| Fireball (AoE save spell) | E | High |
| Hold Person (paralysis) | E | High |
| Web (zone + restrained) | E | Medium |
| Counterspell (reaction interrupt) | E | High |
| Misty Step (bonus teleport) | E | Medium |
| Ranged-only combat | C | High |
| Long-range disadvantage | C | Medium |
| Ranged-in-melee disadvantage | C | Medium |
| Grapple-focused combat | H | High |
| Drag grappled target | H | Medium |
| Shove prone + advantage | H | High |
| Multi-round attrition | B | High |
| Death saves | L | **Critical** — never triggered |
| Party NPC AI spellcasting | K | High |
| Coordinated party combat | D, K | High |
| Rogue hit-and-run loop | I | High |
| Evasion (DEX save zero) | I | Medium |
| Mirror match (ki war) | J | Medium |

### Regression Verification (previously fixed bugs)
| Bug | Fix Description | Re-test In |
|-----|----------------|------------|
| BUG-1 | Disengage suppresses OAs | I |
| BUG-2 | OA pending action 404 | F, I, M |
| BUG-4 | Dash gives full double movement | M |
| BUG-8/F1/M1 | Extra Attack says "attack" not "damage" | M, O |
| BUG-9 | Rage +2 in damage equation | M |
| BUG-11 | Javelin long range accepted | M |
| BUG-13 | Uncanny Dodge reaction doesn't crash | I |
| BUG-14 | Rage persists after Dash turn | M |
| BUG-WL1/WL3 | Hex damage formula display | F |
| BUG-WL2 | Hex retarget works | F |
| BUG-WL4 | Beams skip dead targets | F |
| BUG-P2 | Shield of Faith as bonus action | G |
| BUG-P3 | Shield of Faith consumes spell slot | G |
| BUG-P4 | AI stall after multiple rounds | G |
| BUG-F3 | Post-OA stale pending action | O |
| BUG-F4 | Initiative display consistency | O |
| BUG-J1 | Party dungeon timeout | D |
| BUG-K1 | Monk-vs-monk timeout | J |
| BUG-H2 | Dead combatant pathfinding stall | B |

### New Player-CLI Scenarios Created
| Scenario File | Description |
|---------------|-------------|
| `solo-cleric.json` | Cleric vs undead horde (Sacred Flame, Guiding Bolt, Bless, Spirit Guardians, Turn Undead) |
| `endurance-fighter.json` | Fighter vs 4 hobgoblins (multi-round attrition, resource management) |
| `ranged-archer.json` | Archer fighter vs wolf pack (pure ranged combat, kiting) |
| `wizard-full-toolkit.json` | Level 7 wizard vs bandits + enemy mage (full spell arsenal) |
| `grapple-arena.json` | Barbarian vs gladiators (grapple/shove focused) |
| `party-fighter-cleric.json` | Fighter + Cleric NPC vs orcs (party coordination) |
| `rogue-assassination.json` | Level 7 rogue hit-and-run (stealth loop, evasion, uncanny dodge) |

---

## Execution Notes

### Port Assignments
- Batch 1 (A-D): Ports 3002–3005
- Batch 2 (E-G): Ports 3006–3008
- Batch 3 (H-J): Ports 3009–3011
- Batch 4 (K-M): Ports 3012–3014
- Batch 5 (N-O): Ports 3015–3016

### Running a Test
```bash
# Start server for a specific port
PORT=3002 pnpm -C packages/game-server dev

# Run CLI with scenario
pnpm -C packages/player-cli start -- --scenario solo-cleric
```

### Bug Reporting Format
```
**🐛 BUG-XX**: [Short description]
- Severity: Critical | High | Medium | Low
- Steps to reproduce
- Expected vs actual behavior
- Related to: [previous bug ID if regression]
```

### Success Criteria
- All 15 tests (A-O) complete without server crashes
- All regression bugs remain fixed
- New coverage areas produce at least 80% checkbox completion
- Any new bugs are documented with severity and reproduction steps
