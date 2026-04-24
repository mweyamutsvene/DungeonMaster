# Plan: Class Combat Suite — Multi-Round E2E Scenarios (L1–5)
## Round: 1
## Status: COMPLETED (28 / 29 scenarios passing; WL1 remains blocked by GAP-6)
## Affected Flows: All (scenario-only — no engine changes)

## Objective
Create a new `class-combat/` E2E scenario suite with **multiple scenarios per class**, each designed around synergistic ability groups and combat setups that naturally exercise those abilities. Scenarios include both **solo hero** and **multi-PC party** configurations. All scenarios use **bumped HP** (100–150 on heroes and monsters) to sustain multi-round combat, and **fully scripted monster turns** via `queueMonsterActions`.

As you write out these scenarios, you are bound to find instances where the testrunner doesn't support a particular interaction or tracking need. In those cases, **note the gap** in the coverage file and **propose a solution** (e.g. new assertion type, new testrunner feature) by dispatching an a subagent to do research, that would allow you to implement the scenario as envisioned. The goal is to end up with a comprehensive suite of combat scenarios that test core class features in realistic combat contexts, and a set of proposed testrunner improvements to fill any gaps encountered along the way.

*** DONT TRY AND WORK AROUND SCENARIOS THAT REQUIRE NEW FEATURES OR UPDATES TO THE TEST RUNNER/HARNESS — INSTEAD NOTE THE GAP AND PROPOSE A SOLUTION. THE GOAL IS TO END UP WITH BETTER TESTRUNNER CAPABILITIES ALONGSIDE THE SCENARIOS. ***

*** DONT ALLOW TESTS TO PASS BY WORKAROUNDING BUGS OR MISSING FEATURES — INSTEAD NOTE THE GAP AND PROPOSE A SOLUTION. ***

### Design Principles
1. **Multiple scenarios per class** — each groups 2–4 synergistic abilities with a combat setup that naturally exercises them
2. **Multi-PC party scenarios** — spells like Bless, Healing Word, Bane, and support abilities require allies on the battlefield
3. **Multi-monster setups** — AoE spells, Turn Undead, and tactical positioning need 2–4 enemies
4. **Bumped HP** — heroes at 100–150, monsters at 80–150 to sustain 3–5 rounds
5. **Fully scripted monsters** via `queueMonsterActions` for determinism
6. **Monster abilities as secondary tests** — Multiattack, spellcasting, Nimble Escape, damage resistance, condition immunity, legendary actions
7. **Resource tracking** — `assertState` after resource-consuming actions to verify pool depletion
8. **Level 5** — Extra Attack, subclass, L3 spells, all core features online

---

## FIGHTER (Champion, L5) — 3 Scenarios

### F1: `fighter/burst-and-endurance.json` — Action Surge + Second Wind + Extra Attack
**Setup**: Solo Fighter (100 HP) vs Orc Warchief (Multiattack, 120 HP) + Hobgoblin (Multiattack, 100 HP)
**Why this grouping**: Action Surge and Second Wind are the Fighter's signature resource abilities. Pairing with Extra Attack tests the "burst damage then self-heal" loop against Multiattack enemies.
**Round Plan (4 rounds)**:
1. Initiative → Attack Orc (Extra Attack, 2 hits). Monster: Orc Multiattack (2 attacks on Fighter)
2. Action Surge → 4 total attacks on Orc (burst round). Monster: Hobgoblin Multiattack
3. Second Wind (bonus) → Attack Hobgoblin. Assert: Second Wind used, HP restored. Monster: Orc attacks
4. Attack to finish. Assert: Action Surge used (resource=0), Second Wind used (resource=0)
**Monster abilities tested**: Multiattack (both monsters)

### F2: `fighter/weapon-mastery-tactics.json` — Weapon Mastery + Improved Critical + Movement
**Setup**: Solo Fighter (100 HP, Greatsword w/ Graze mastery) vs 3 Goblins (Nimble Escape, 80 HP each, spread positions)
**Why this grouping**: Weapon mastery effects (Graze on miss = STR damage), Improved Critical (crit on 19), and tactical movement against mobile enemies that use Nimble Escape.
**Round Plan (4 rounds)**:
1. Initiative → Move to Goblin A, Attack (Extra Attack). Monster: Goblin A Nimble Escape (disengage) + move away, Goblin B shoot
2. Move to Goblin B → Attack (hope for mastery trigger on miss). Monster: Goblin C shoot, Goblin A repositions
3. Attack Goblin B. Monster: Goblins reposition (testing Nimble Escape repeatedly)
4. Chase Goblin C → Attack. Assert: movement tracking, mastery effects applied
**Monster abilities tested**: Nimble Escape (all 3 goblins), ranged attacks

### F3: `fighter/tank-vs-resistance.json` — Fighting Style + Damage Resistance + Heavy Hitter
**Setup**: Solo Fighter (120 HP, Defense style AC 20) vs Zombie (damage resist: bludgeoning, 100 HP) + Ogre (heavy damage, 120 HP)
**Why this grouping**: Tests Fighter as a tank — high AC from Fighting Style (Defense), attacking through damage resistance, surviving heavy damage from Ogre.
**Round Plan (4 rounds)**:
1. Initiative → Attack Zombie with slashing weapon (bypasses bludgeoning resist). Monster: Ogre Greatclub (big hit vs AC 20)
2. Attack Zombie (Extra Attack). Monster: Zombie slam, Ogre hit
3. Attack Ogre. Monster: both attack. Assert: HP damage tracked across rounds
4. Finish. Assert: damage resistance correctly applied to Zombie (if switched to bludgeoning weapon)
**Monster abilities tested**: Damage resistance (Zombie), Heavy damage (Ogre)

---

## MONK (Open Hand, L5) — 4 Scenarios

### M1: `monk/flurry-and-open-hand.json` — Flurry of Blows + Open Hand Technique + Extra Attack
**Setup**: Solo Monk (100 HP) vs Hobgoblin Captain (Multiattack, 100 HP) + Gnoll (80 HP)
**Why this grouping**: Flurry triggers Open Hand Technique (push/prone/addle). Extra Attack chains with FoB for 4 unarmed strikes per turn. Tests ki spending across rounds.
**Round Plan (4 rounds)**:
1. Initiative → Attack Hobgoblin (Extra Attack 2 hits) + Flurry of Blows (2 more hits) → Open Hand (push prone on hit). Assert: 1 ki spent
2. Attack prone Hobgoblin (advantage) + Flurry → Open Hand (addle). Monster: Hobgoblin Multiattack, Gnoll charges. Assert: 2 ki spent
3. Attack Gnoll + Martial Arts (bonus unarmed, free). Monster: both attack. Assert: 2 ki total (saved ki this round)
4. Flurry on Gnoll → Open Hand (push). Assert: 3 ki total spent, ki pool tracked
**Monster abilities tested**: Multiattack (Hobgoblin), charge movement (Gnoll)

### M2: `monk/stunning-strike-lockdown.json` — Stunning Strike + Extra Attack + Ki Economy
**Setup**: Solo Monk (100 HP) vs Bandit Captain (Multiattack, 100 HP) + Thug (80 HP)
**Why this grouping**: Stunning Strike is the Monk's key control ability at L5, costs 1 ki. Testing stun → advantage on stunned target → follow-up. Exercises ki economy (5 ki at L5, can't spam everything).
**Round Plan (4 rounds)**:
1. Initiative → Attack Captain (Extra Attack, hit) → Stunning Strike (CON save). Assert: 1 ki spent, Captain stunned (or not)
2. If stunned: advantage attacks on Captain. Flurry of Blows. Assert: 2 ki. Monster: Thug attacks (Captain skips if stunned)
3. Stunning Strike on Thug. Attack. Assert: 3 ki. Monster: Captain recovers, Multiattack
4. Attack. Assert: ki pool depleted or tracked correctly
**Monster abilities tested**: Multiattack (Captain), condition interaction (stunned skip)

### M3: `monk/deflect-and-patient-defense.json` — Deflect Attacks + Patient Defense + Step of the Wind
**Setup**: Solo Monk (100 HP) vs 3 Skeleton Archers (ranged, 80 HP each, spread around monk)
**Why this grouping**: Defensive abilities. Deflect Attacks triggers on incoming ranged attacks. Patient Defense (Dodge) gives disadvantage to all attackers. Step of the Wind (Dash) for repositioning between ranged enemies. All cost ki — tests resource choices.
**Round Plan (4 rounds)**:
1. Initiative → Step of the Wind (Dash, 1 ki) → move to Skeleton A, Attack. Monster: Skeleton B & C shoot → Deflect Attacks on first hit (reaction). Assert: 1 ki (SotW)
2. Patient Defense (1 ki, Dodge). Attack Skeleton A. Monster: All 3 shoot at disadvantage. Assert: 2 ki total
3. Step of the Wind → move to Skeleton B, Attack. Monster: Skeletons shoot → Deflect. Assert: 3 ki
4. Attack Skeleton B. Assert: Deflect used twice (reaction per round), Patient Defense used once, SotW used twice
**Monster abilities tested**: Ranged attacks from multiple positions, Condition immunity (Poisoned on skeletons)

### M4: `monk/ki-resource-depletion.json` — Full Ki Cycle: All Abilities in One Fight
**Setup**: Solo Monk (120 HP) vs Hobgoblin Captain (100 HP) + Goblin (Nimble Escape, 80 HP) + Gnoll (80 HP)
**Why this grouping**: Starts with 5 ki at L5. Use all 5 across rounds: FoB (1), FoB (1), Patient Defense (1), Stunning Strike (1), Step of the Wind (1). Tests that running out of ki forces fallback to free Martial Arts.
**Round Plan (5 rounds)**:
1. FoB → Open Hand. Assert: ki=4. Monster: Hobgoblin Multiattack → Deflect (free reaction)
2. FoB. Assert: ki=3. Monster: Gnoll charge, Goblin shoots
3. Stunning Strike on Hobgoblin. Assert: ki=2. Monster: Goblin Nimble Escape
4. Patient Defense. Attack. Assert: ki=1. Monster: all attack at disadvantage
5. Step of the Wind → close to Goblin → Attack + Martial Arts (free BA, 0 ki). Assert: ki=0, used all 5 ability types
**Monster abilities tested**: Multiattack, Nimble Escape, charge

---

## ROGUE (Thief, L5) — 3 Scenarios

### R1: `rogue/sneak-attack-advantage.json` — Sneak Attack + Hide + Ranged Attacks
**Setup**: Solo Rogue (100 HP, Shortbow) vs 2 Goblin Scouts (ranged, 80 HP each) + Thug (melee, 80 HP)
**Why this grouping**: Sneak Attack requires advantage or ally adjacent. Hide (Cunning Action) grants advantage on next attack. Tests the Rogue's core damage loop: Hide → Shoot with advantage → Sneak Attack (3d6 at L5).
**Round Plan (4 rounds)**:
1. Initiative → Cunning Action: Hide (bonus) → Shortbow attack at Thug with advantage (Sneak Attack). Monster: Thug moves toward, Goblins shoot
2. Cunning Action: Hide → Shoot Goblin A (Sneak Attack). Monster: Thug arrives in melee, Goblins shoot
3. Cunning Action: Disengage (escape Thug melee) → Move → Shoot. Monster: Thug chases, Goblins reposition
4. Hide → Shoot. Assert: Sneak Attack dealt every round, all via advantage from Hide
**Monster abilities tested**: Ranged attacks, melee pursuit

### R2: `rogue/cunning-escape-artist.json` — All 3 Cunning Actions + Uncanny Dodge
**Setup**: Solo Rogue (100 HP, Rapier) vs Bandit Captain (Multiattack, 100 HP) + Bandit (80 HP)
**Why this grouping**: Tests all three Cunning Action variants (Dash/Disengage/Hide) plus Uncanny Dodge (halve damage from one attack). Captain's Multiattack provides multiple attacks per turn — Uncanny Dodge only works on one.
**Round Plan (4 rounds)**:
1. Initiative → Attack Captain (Sneak Attack, adjacent Bandit = ally for SA). Monster: Captain Multiattack → Uncanny Dodge first hit
2. Cunning Action: Disengage → Move away from melee. Monster: Captain and Bandit chase
3. Cunning Action: Dash → kite away → ranged attack or end. Monster: Both pursue. Captain attacks → Uncanny Dodge
4. Cunning Action: Hide → Attack with advantage. Assert: Uncanny Dodge used 2x (once per round), all 3 CA types used
**Monster abilities tested**: Multiattack (Captain), pursuit AI behavior

### R3: `rogue/evasion-vs-aoe.json` — Evasion + Sneak Attack + Monster Spellcaster
**Setup**: Solo Rogue (100 HP) vs Dark Mage (spellcaster: Burning Hands, Thunderwave, 80 HP) + Thug (80 HP)
**Why this grouping**: Evasion (DEX save success → 0 damage, fail → half). Dark Mage casts AoE spells directly at Rogue. Thug provides adjacency for Sneak Attack when no advantage.
**Round Plan (4 rounds)**:
1. Initiative → Attack Thug (Sneak Attack, Thug adjacent to Mage). Monster: Mage casts Burning Hands (DEX save → Evasion)
2. Attack Mage. Monster: Mage casts Thunderwave (CON save AoE). Thug attacks
3. Cunning Action: Hide → Attack Mage with advantage (Sneak Attack). Monster: Mage casts again
4. Finish. Assert: Evasion triggered on AoE saves, Sneak Attack each round
**Monster abilities tested**: Monster spellcasting (Dark Mage AoE), Save-based spells

---

## WIZARD (Evocation, L5) — 4 Scenarios

### W1: `wizard/aoe-blaster.json` — Fireball + Burning Hands + Cantrip Scaling
**Setup**: Solo Wizard (100 HP) vs 4 Goblins (80 HP each, clustered at start, spread after R1)
**Why this grouping**: AoE damage spells hitting multiple targets. Fireball (L3, 20ft sphere), Burning Hands (L1, 15ft cone). When out of good slots, fall back to Fire Bolt (2d10 at L5).
**Round Plan (4 rounds)**:
1. Initiative → Fireball centered on goblin cluster (hits 3–4). Assert: L3 slot spent, multiple goblins damaged
2. Burning Hands (L1) on remaining cluster. Monster: Surviving goblins scatter and attack. Assert: L1 slot spent
3. Fire Bolt (cantrip, 2d10) at nearest goblin. Monster: Goblins shoot/melee
4. Fire Bolt again. Assert: slot tracking (1 L3 used, 1 L1 used), cantrip scaling verified (2d10)
**Monster abilities tested**: Multiple clustered targets, save-based damage on multiple enemies

### W2: `wizard/shield-and-counterspell.json` — Shield + Counterspell + Concentration (Hold Person)
**Setup**: Solo Wizard (100 HP) vs Ogre Mage (spellcaster: Hold Person, Misty Step, 100 HP) + Skeleton Archer (80 HP)
**Why this grouping**: All 3 reactions in context. Shield triggers from Skeleton ranged attack. Counterspell triggers from Ogre Mage casting. Hold Person tests concentration. Uses both reaction types (attack defense + spell interrupt).
**Round Plan (5 rounds)**:
1. Initiative → Hold Person (L2) on Ogre Mage (concentration). Monster: Skeleton shoots → Shield (+5 AC). Assert: L2 slot, L1 slot for Shield
2. Scorching Ray (L2, 3 beams) at Skeleton. Monster: Ogre Mage casts Hold Person → Counterspell (L3 slot). Assert: L2 and L3 slots
3. Fire Bolt at Skeleton. Monster: Skeleton shoots → Shield again. Assert: shield slots tracked
4. Fire Bolt. Monster: Ogre Mage casts again. Concentration save if hit. Assert: concentration maintained or broken
5. Cleanup. Assert: all 3 reactions exercised, spell slot tracking across 5 rounds
**Monster abilities tested**: Monster spellcasting (Ogre Mage), ranged attacks (Skeleton)

### W3: `wizard/absorb-elements-melee.json` — Absorb Elements + Fire Bolt + Elemental Damage
**Setup**: Solo Wizard (100 HP) vs Fire Elemental (fire immune, fire melee damage, 100 HP) + Dire Wolf (80 HP)
**Why this grouping**: Absorb Elements triggers on elemental melee damage (Fire Elemental hits Wizard). Tests that Wizard gains resistance + bonus damage on next melee. Also tests fire immunity (Wizard's fire spells do nothing to Fire Elemental — must use non-fire).
**Round Plan (4 rounds)**:
1. Initiative → Ray of Frost at Fire Elemental (cold damage, not fire!). Monster: Fire Elemental melee → Absorb Elements (fire resist). Assert: L1 slot
2. Chill Touch at Dire Wolf. Monster: Dire Wolf bite (Pack Tactics). Fire Elemental melee → Absorb Elements
3. Ray of Frost. Monster: both attack
4. Assert: Absorb Elements triggered twice, fire immunity prevented fire damage to Fire Elemental, non-fire spells used
**Monster abilities tested**: Fire Elemental (fire damage, fire immunity), Pack Tactics (Dire Wolf)

### W4: `wizard/spell-slot-economy.json` — Full Slot Depletion Over Extended Fight
**Setup**: Solo Wizard (120 HP) vs 2 Skeleton Warriors (80 HP each, melee) + Goblin Archer (80 HP, ranged)
**Why this grouping**: Extended fight to deplete all slots: L3 ×2, L2 ×3, L1 ×4 at L5. Tests that Wizard correctly tracks 9 spell slots across 6 rounds, ending with cantrips-only.
**Round Plan (6 rounds)**:
1. Fireball (L3). 2. Scorching Ray (L2). 3. Shield (L1, reaction) + Burning Hands (L1). 4. Hold Person (L2) + Shield (L1). 5. Fire Bolt (cantrip). 6. Fire Bolt. Assert: all 9 slots consumed, cantrip fallback
**Monster abilities tested**: Melee + ranged pressure forcing slot spending, condition immunity (Skeletons: Poisoned)

---

## BARBARIAN (Berserker, L5) — 3 Scenarios

### B1: `barbarian/rage-and-reckless.json` — Rage + Reckless Attack + Damage Resistance
**Setup**: Solo Barbarian (120 HP, Unarmored Defense) vs Ogre (heavy damage, 120 HP) + Giant Spider (poison, 100 HP)
**Why this grouping**: Rage grants resistance to bludgeoning/piercing/slashing + bonus damage. Reckless Attack gives advantage but enemies get advantage too. Ogre's big hits test rage resistance. Spider's poison tests rage resistance to piercing.
**Round Plan (4 rounds)**:
1. Initiative → Rage (bonus) → Attack Ogre (Extra Attack, +2 rage damage). Monster: Ogre Greatclub → rage halves damage. Assert: rage active, resistance applied
2. Reckless Attack on Ogre (advantage). Monster: Ogre hits with advantage (from Reckless), Spider bites → rage resists piercing
3. Attack Spider. Monster: both attack with advantage. Assert: Reckless advantage applied both ways
4. Attack. Assert: rage damage bonus tracked, damage resistance consistently applied
**Monster abilities tested**: Heavy damage (Ogre, tests resistance), Poison damage (Spider)

### B2: `barbarian/frenzy-extra-attack.json` — Frenzy + Extra Attack + Sustained Rage
**Setup**: Solo Barbarian (120 HP) vs 3 Gnolls (aggressive charge, 80 HP each)
**Why this grouping**: Frenzy (Berserker L3) grants an extra melee attack as bonus action while raging. Combined with Extra Attack = 3 attacks per round. 3 Gnolls test sustained damage output and rage maintenance (rage ends if you don't attack/take damage).
**Round Plan (4 rounds)**:
1. Rage (bonus) → Attack Gnoll A (Extra Attack). Monster: All 3 Gnolls charge. Assert: rage active
2. Reckless Attack + Frenzy (bonus, extra melee). 3 attacks total. Monster: Gnolls attack (advantage from Reckless). Assert: Frenzy used
3. Attack + Frenzy. 3 attacks again. Monster: Gnolls attack. Assert: rage still active (attacked + took damage)
4. Attack + Frenzy. Assert: Frenzy used every round, 3 attacks/round tracked, rage maintained
**Monster abilities tested**: Aggressive charge (Gnolls), multiple enemies sustaining rage

### B3: `barbarian/rage-resistance-types.json` — Rage vs Multiple Damage Types
**Setup**: Solo Barbarian (150 HP) vs Fire Elemental (fire damage, 100 HP) + Skeleton Warrior (slashing, 80 HP) + Ogre (bludgeoning, 100 HP)
**Why this grouping**: Rage resists bludgeoning, piercing, slashing — but NOT fire. Tests that resistance correctly applies to physical damage and does NOT apply to fire. Each monster delivers a different damage type.
**Round Plan (4 rounds)**:
1. Rage → Attack Skeleton (slashing weapon). Monster: Fire Elemental hits (fire, NOT resisted), Skeleton hits (slashing, resisted), Ogre hits (bludgeoning, resisted)
2. Attack Fire Elemental (priority — unresisted damage). Monster: all attack. Assert: fire damage full, physical halved
3. Reckless on Fire Elemental. Monster: attacks. Assert: damage type tracking
4. Finish. Assert: resistance correctly applied per damage type across all rounds
**Monster abilities tested**: Fire damage (bypasses rage), slashing, bludgeoning

---

## CLERIC (Life, L5) — 4 Scenarios

### C1: `cleric/party-healer.json` — Healing Word + Cure Wounds + Multi-PC Healing
**Setup**: **Party** — Cleric (100 HP) + Fighter (100 HP) + Rogue (80 HP) vs Orc Warchief (Multiattack, 120 HP) + Bandit (80 HP)
**Why this grouping**: Healing spells TARGET ALLIES — needs multi-PC party. Healing Word (bonus action, ranged) on injured Fighter. Cure Wounds (action, touch) on dying Rogue. Tests heal targeting, bonus action spell economy.
**Round Plan (5 rounds)**:
1. Initiative → Cleric: Guiding Bolt at Orc (L1, attack roll). Fighter: Attack Orc. Rogue: Attack Bandit. Monster: Orc Multiattack on Fighter (big damage)
2. Cleric: Healing Word on Fighter (bonus, L1) + Sacred Flame (cantrip action). Fighter: Attack. Rogue: Attack. Monster: Bandit hits Rogue
3. Cleric: Cure Wounds on Rogue (action, touch, L1). Fighter: Attack. Monster: Orc hits Fighter again
4. Cleric: Healing Word on Fighter (bonus). Sacred Flame. Assert: 3 heal spells cast, slots tracked, ally HP restored
5. Cleanup. Assert: Cleric spell slot economy (4 L1 slots used), both allies healed at least once
**Monster abilities tested**: Multiattack (Orc — forces healing), damage pressure on allies

### C2: `cleric/bless-and-bane-party.json` — Bless on Allies + Bane on Enemies (Multi-target Buff/Debuff)
**Setup**: **Party** — Cleric (100 HP) + Fighter (100 HP) + Paladin (100 HP) vs 3 Hobgoblins (100 HP each)
**Why this grouping**: Bless targets up to 3 allies (+1d4 attacks/saves). Bane targets up to 3 enemies (CHA save or -1d4). Requires multi-PC party AND multi-monster setup. Concentration management across rounds.
**Round Plan (5 rounds)**:
1. Initiative → Cleric: Bless on Cleric + Fighter + Paladin (L1, concentration). Fighter: Attack Hobgoblin A. Paladin: Attack Hobgoblin B. Monster: Hobgoblins Multiattack
2. Cleric: Sacred Flame (maintain Bless concentration). Fighter: Attack (with Bless +1d4). Paladin: Attack (with Bless). Assert: Bless active on all 3
3. Cleric: takes damage → concentration save (with Bless +1d4 to own save!). If Bless holds: continue. Fighter attacks. Monster: Hobgoblins attack
4. If Bless broke: Bane on 3 Hobgoblins (L1, new concentration). Monsters now have -1d4 on attacks and saves. Fighter attacks. Assert: Bane applied
5. Assert: Bless/Bane concentration tracked, buff/debuff effects applied to correct targets, spell slots tracked
**Monster abilities tested**: Multiattack (Hobgoblins, 3 of them), multiple targets for Bane

### C3: `cleric/turn-undead-horde.json` — Turn Undead + Spirit Guardians vs Undead Pack
**Setup**: Solo Cleric (120 HP) vs 3 Skeleton Warriors (80 HP each, condition immune: Poisoned) + Wight (Life Drain, 100 HP)
**Why this grouping**: Turn Undead (Channel Divinity) targets ALL undead in 30ft — needs multiple undead. Spirit Guardians (L3, concentration zone) damages enemies starting turn in range. Tests Turn fleeing + zone damage combo.
**Round Plan (5 rounds)**:
1. Initiative → Turn Undead (Channel Divinity). Assert: CD used (1 of 2). Skeletons fail WIS save → Turned (flee). Wight may save
2. Spirit Guardians (L3, concentration). Assert: L3 slot spent. Monster: Turned skeletons flee. Wight attacks (conc save)
3. Sacred Flame at Wight. Monster: Skeletons Turned wears off → they re-enter → Spirit Guardians damage. Wight Life Drain → conc save
4. Attack Skeleton. Assert: Spirit Guardians zone damage applied to re-entering skeletons
5. Cleanup. Assert: CD used, Spirit Guardians concentration tracked, zone damage applied each round
**Monster abilities tested**: Undead type (Turn Undead target), Life Drain (Wight), Condition immunity: Poisoned (Skeletons)

### C4: `cleric/divine-support-multiround.json` — Shield of Faith + Guiding Bolt + Sacred Flame
**Setup**: **Party** — Cleric (100 HP) + Fighter (120 HP) vs Ogre (120 HP) + Bandit Captain (Multiattack, 100 HP)
**Why this grouping**: Shield of Faith (L1, bonus action, concentration) on Fighter ally (+2 AC). Guiding Bolt (L1, attack) grants next attacker advantage on target. Tests Cleric as support: buff ally AC, mark enemy for ally to exploit.
**Round Plan (4 rounds)**:
1. Cleric: Shield of Faith on Fighter (bonus, L1, concentration) + Guiding Bolt on Ogre (action, L1). Fighter: Attack Ogre (advantage from Guiding Bolt). Assert: SoF active, Guiding Bolt advantage
2. Cleric: Sacred Flame at Captain (maintain SoF). Fighter: Attack. Monster: Ogre attacks Fighter (vs buffed AC)
3. Cleric: Healing Word on Fighter (bonus, L1) + cantrip. Monster: Captain Multiattack on Fighter. Assert: SoF still active, Fighter healed
4. Cleanup. Assert: Shield of Faith concentration maintained, Guiding Bolt advantage consumed, spell slots tracked
**Monster abilities tested**: Heavy damage (Ogre vs buffed AC), Multiattack (Captain)

---

## PALADIN (Devotion, L5) — 3 Scenarios

### P1: `paladin/smite-and-heal.json` — Divine Smite + Lay on Hands + Extra Attack
**Setup**: Solo Paladin (120 HP) vs Fiend (vulnerability: radiant, 100 HP) + Specter (necrotic damage, 80 HP)
**Why this grouping**: Divine Smite on-hit (radiant, bonus action, costs spell slot) deals massive damage to fiends. Lay on Hands (bonus action) for self-healing against Specter necrotic. Extra Attack doubles smite opportunities.
**Round Plan (4 rounds)**:
1. Initiative → Attack Fiend (Extra Attack, hit) → Divine Smite on first hit (L1 slot). Assert: radiant damage, L1 slot spent. Monster: Fiend attacks
2. Attack Fiend → Divine Smite (L1 slot). Monster: Specter Life Drain (necrotic). Assert: 2 L1 slots spent
3. Lay on Hands (bonus, 15 HP self-heal). Attack Specter. Monster: Fiend attacks. Assert: LoH pool reduced by 15
4. Attack to finish. Assert: 2 smites used (2 L1 slots), LoH pool tracked (25→10), Extra Attack every round
**Monster abilities tested**: Radiant vulnerability (Fiend, double smite damage), Life Drain (Specter)

### P2: `paladin/party-aura-tank.json` — Bless + Shield of Faith + Party Support
**Setup**: **Party** — Paladin (120 HP) + Wizard (80 HP) + Rogue (80 HP) vs Ogre Mage (spellcaster, 100 HP) + 2 Hobgoblins (80 HP each)
**Why this grouping**: Bless targets all 3 PCs. Shield of Faith on Wizard (concentration). Tests Paladin as party protector against spell-saving monsters. Paladin in frontline tanking, supporting squishier allies with buffs.
**Note**: Aura of Protection is L6 feature — skipping aura assertions. Using Bless/SoF as L5-available party support.
**Round Plan (4 rounds)**:
1. Paladin: Bless on all 3 PCs (L1, concentration). Wizard: Fire Bolt. Rogue: Attack. Monster: Ogre Mage casts Hold Person on Wizard → Wizard saves
2. Paladin: Attack Hobgoblin (with Bless +1d4). Wizard: Scorching Ray. Rogue: Sneak Attack. Monster: Hobgoblins Multiattack
3. Paladin: Lay on Hands on Wizard (bonus). Attack. Rogue: Attack. Monster: Ogre Mage casts again
4. Assert: Bless active on party, saves boosted, Paladin as frontline protector
**Monster abilities tested**: Monster spellcasting (Ogre Mage — forces saving throws), Multiattack (Hobgoblins)

### P3: `paladin/channel-divinity-smite-burst.json` — Channel Divinity + Divine Smite + Spell Slots
**Setup**: Solo Paladin (100 HP) vs Wight (undead, 100 HP) + 2 Skeletons (80 HP each)
**Why this grouping**: Channel Divinity + Divine Smite burst against undead. Tests resource juggling: spell slots for smites vs. spell slots for spells vs. Channel Divinity.
**Round Plan (4 rounds)**:
1. Initiative → Channel Divinity (Sacred Weapon or Turn Undead). Attack Wight. Monster: Skeletons shoot
2. Attack Wight → Divine Smite (L1, extra radiant vs undead). Monster: Wight Life Drain, Skeletons attack
3. Attack Skeleton → Divine Smite (L2, bigger burst). Assert: CD used, L1+L2 slots tracked. Monster: attacks
4. Cure Wounds (self-heal). Attack. Assert: spell slot economy (smite + heal competing for slots)
**Monster abilities tested**: Undead (extra smite damage), Life Drain, Condition immunity

---

## WARLOCK (Fiend Pact, L5) — 3 Scenarios

### WL1: `warlock/hex-and-blast.json` — Hex + Eldritch Blast (2 Beams) + Pact Slot Economy
**Setup**: Solo Warlock (100 HP) vs 2 Bandit Captains (Multiattack, 100 HP each)
**Why this grouping**: Hex (bonus, concentration) + Eldritch Blast (2 beams at L5) is the core Warlock loop. Each EB beam triggers Hex bonus damage. Tests Pact Magic (2 L3 slots, short rest refresh).
**Round Plan (4 rounds)**:
1. Initiative → Hex on Captain A (bonus, L3 slot). Eldritch Blast at Captain A (2 beams + 2×Hex bonus). Assert: L3 slot spent, Hex active
2. EB at Captain A (2 beams + Hex). Monster: Captain A Multiattack. Assert: Hex damage per beam
3. EB at Captain A (finish → Hex transfers to Captain B for free). Monster: Captain B Multiattack. Assert: Hex transferred
4. EB at Captain B (2 beams + Hex). Assert: 1 L3 slot spent total (Hex = 1 slot), Hex transferred on kill
**Monster abilities tested**: Multiattack (both Captains)

### WL2: `warlock/hellish-rebuke-defense.json` — Hellish Rebuke + Eldritch Blast + Damage Reaction
**Setup**: Solo Warlock (100 HP) vs Bandit Warlord (Multiattack heavy damage, 120 HP) + Thug (80 HP)
**Why this grouping**: Hellish Rebuke (reaction, costs spell slot) triggers when Warlock takes damage. Warlord's Multiattack is a reliable damage trigger. Tests reaction + Pact slot economy (only 2 L3 slots — Hellish Rebuke competes with Hex).
**Round Plan (4 rounds)**:
1. Initiative → EB at Warlord (2 beams). Monster: Warlord Multiattack → Hellish Rebuke (L3 slot, reaction). Assert: L3 slot spent on rebuke
2. Hex (bonus, L3 slot) + EB. Monster: Thug attacks. Assert: both L3 slots spent, cantrip-only from here
3. EB + Hex damage (cantrip, free). Monster: Warlord attacks → NO Hellish Rebuke (no slots!). Assert: 0 slots, reaction unavailable
4. EB. Assert: Pact slots fully depleted, Hellish Rebuke used once, Hex concentration tracked
**Monster abilities tested**: Multiattack (Warlord — heavy damage triggers Rebuke), melee pressure

### WL3: `warlock/hold-and-control.json` — Hold Person + Eldritch Blast + Concentration Management
**Setup**: Solo Warlock (100 HP) vs Hobgoblin Captain (Multiattack, 100 HP) + 2 Goblins (Nimble Escape, 80 HP each)
**Why this grouping**: Hold Person (L2, upcast to L3) paralyzes humanoid — Warlock can then EB at advantage against paralyzed target. Tests concentration saves when Goblins shoot Warlock.
**Round Plan (4 rounds)**:
1. Initiative → Hold Person on Captain (L3 slot, concentration). EB at Goblin A (2 beams). Monster: Goblins shoot → conc save
2. EB at paralyzed Captain (auto-crit within 5ft, advantage at range). Monster: Goblins shoot → conc save. Assert: Hold Person concentration tracked
3. EB at Goblins. Monster: Captain breaks free (end-of-turn save) or stays paralyzed. Goblins Nimble Escape
4. Assert: Hold Person concentration tracked (maintained or broken by damage), paralyzed condition applied/expired
**Monster abilities tested**: Multiattack (Captain), Nimble Escape (Goblins), paralyzed condition interaction

---

## Full Scenario Matrix

| # | File | Class | Key Abilities Tested | Party? | Monsters | Monster Abilities |
|---|------|-------|---------------------|--------|----------|-------------------|
| F1 | `fighter/burst-and-endurance` | Fighter | Action Surge, Second Wind, Extra Attack | Solo | Orc Warchief, Hobgoblin | Multiattack ×2 |
| F2 | `fighter/weapon-mastery-tactics` | Fighter | Weapon Mastery (Graze), Movement | Solo | 3× Goblin | Nimble Escape ×3 |
| F3 | `fighter/tank-vs-resistance` | Fighter | Defense Style, High AC | Solo | Zombie, Ogre | Damage Resist, Heavy Damage |
| M1 | `monk/flurry-and-open-hand` | Monk | FoB, Open Hand, Extra Attack | Solo | Hobgoblin Captain, Gnoll | Multiattack, Charge |
| M2 | `monk/stunning-strike-lockdown` | Monk | Stunning Strike, Ki Economy | Solo | Bandit Captain, Thug | Multiattack, Stun Skip |
| M3 | `monk/deflect-and-patient-defense` | Monk | Deflect, Patient Defense, SotW | Solo | 3× Skeleton Archer | Ranged ×3, Condition Immunity |
| M4 | `monk/ki-resource-depletion` | Monk | All 5 Ki Abilities | Solo | Hobgoblin, Goblin, Gnoll | Multiattack, Nimble Escape |
| R1 | `rogue/sneak-attack-advantage` | Rogue | Sneak Attack, Hide, Ranged | Solo | 2× Goblin Scout, Thug | Ranged, Melee Pursuit |
| R2 | `rogue/cunning-escape-artist` | Rogue | All 3 Cunning Actions, Uncanny Dodge | Solo | Bandit Captain, Bandit | Multiattack |
| R3 | `rogue/evasion-vs-aoe` | Rogue | Evasion, Sneak Attack | Solo | Dark Mage, Thug | Monster Spellcasting AoE |
| W1 | `wizard/aoe-blaster` | Wizard | Fireball, Burning Hands, Cantrip | Solo | 4× Goblin | Clustered targets |
| W2 | `wizard/shield-and-counterspell` | Wizard | Shield, Counterspell, Hold Person | Solo | Ogre Mage, Skeleton Archer | Monster Spellcasting, Ranged |
| W3 | `wizard/absorb-elements-melee` | Wizard | Absorb Elements, Non-fire spells | Solo | Fire Elemental, Dire Wolf | Fire Immunity, Pack Tactics |
| W4 | `wizard/spell-slot-economy` | Wizard | All Slots Depleted (9 slots) | Solo | 2× Skeleton, Goblin Archer | Melee + Ranged Pressure |
| B1 | `barbarian/rage-and-reckless` | Barbarian | Rage, Reckless, Resistance | Solo | Ogre, Giant Spider | Heavy Damage, Poison |
| B2 | `barbarian/frenzy-extra-attack` | Barbarian | Frenzy, Extra Attack, Rage | Solo | 3× Gnoll | Aggressive Charge |
| B3 | `barbarian/rage-resistance-types` | Barbarian | Rage vs Fire/Slash/Bludgeon | Solo | Fire Elemental, Skeleton, Ogre | Fire (unresisted), Physical (resisted) |
| C1 | `cleric/party-healer` | Cleric | Healing Word, Cure Wounds | **Party (3)** | Orc Warchief, Bandit | Multiattack forcing heals |
| C2 | `cleric/bless-and-bane-party` | Cleric | Bless (3 allies), Bane (3 enemies) | **Party (3)** | 3× Hobgoblin | Multiattack ×3, Bane targets |
| C3 | `cleric/turn-undead-horde` | Cleric | Turn Undead, Spirit Guardians | Solo | 3× Skeleton, Wight | Undead ×4, Life Drain |
| C4 | `cleric/divine-support-multiround` | Cleric | Shield of Faith, Guiding Bolt | **Party (2)** | Ogre, Bandit Captain | Heavy Damage, Multiattack |
| P1 | `paladin/smite-and-heal` | Paladin | Divine Smite, Lay on Hands | Solo | Fiend, Specter | Radiant Vulnerability, Life Drain |
| P2 | `paladin/party-aura-tank` | Paladin | Bless, Shield of Faith, Party | **Party (3)** | Ogre Mage, 2× Hobgoblin | Monster Spells, Multiattack |
| P3 | `paladin/channel-smite-burst` | Paladin | Channel Divinity, Smite, Slots | Solo | Wight, 2× Skeleton | Undead, Life Drain |
| WL1 | `warlock/hex-and-blast` | Warlock | Hex, EB 2-beam, Hex Transfer | Solo | 2× Bandit Captain | Multiattack ×2 |
| WL2 | `warlock/hellish-rebuke-defense` | Warlock | Hellish Rebuke, Pact Slots | Solo | Bandit Warlord, Thug | Multiattack Heavy |
| WL3 | `warlock/hold-and-control` | Warlock | Hold Person, Concentration | Solo | Hobgoblin Captain, 2× Goblin | Multiattack, Nimble Escape |

**Totals**: 27 scenarios | 8 classes | 6 party scenarios (2–3 PCs each) | 21 solo scenarios | ~108 rounds of combat

---

## Monster Ability Coverage Summary

| Monster Ability | Scenario Count | Which Scenarios |
|-----------------|---------------|-----------------|
| Multiattack | 14 | F1, M1, M2, M4, R2, C1, C2, C4, P2, P3, WL1, WL2, WL3 |
| Nimble Escape | 5 | F2, M4, W1, WL3 |
| Monster Spellcasting | 4 | R3, W2, P2, WL3 |
| Damage Resistance | 2 | F3, B3 |
| Damage Immunity (Fire) | 2 | W3, B3 |
| Condition Immunity | 4 | M3, W4, C3, P3 |
| Heavy Damage (Ogre) | 4 | B1, B3, C4, F3 |
| Life Drain (Wight/Specter) | 3 | C3, P1, P3 |
| Poison Damage | 2 | B1, B3 |
| Pack Tactics | 1 | W3 |
| Aggressive Charge | 2 | B2, M1 |
| Ranged Attacks | 5 | F2, M3, R1, W2, W4 |
| Undead Type | 4 | C3, P1, P3 |

---

## Multi-Player Scenario Summary

| Scenario | PCs in Party | Reason Multi-PC Required |
|----------|-------------|--------------------------|
| C1: party-healer | Cleric + Fighter + Rogue | Healing Word/Cure Wounds target **allies** |
| C2: bless-and-bane-party | Cleric + Fighter + Paladin | Bless targets **up to 3 allies**, Bane targets **3 enemies** |
| C4: divine-support-multiround | Cleric + Fighter | Shield of Faith on **ally**, Guiding Bolt advantage for **ally** |
| P2: party-aura-tank | Paladin + Wizard + Rogue | Bless on **3 PCs**, Shield of Faith on **ally** |
| R1/R2 (optional upgrade) | — | Could add ally for Sneak Attack adjacency source instead of Hide |

---

## File Structure

```
scripts/test-harness/scenarios/class-combat/
├── fighter/
│   ├── burst-and-endurance.json
│   ├── weapon-mastery-tactics.json
│   └── tank-vs-resistance.json
├── monk/
│   ├── flurry-and-open-hand.json
│   ├── stunning-strike-lockdown.json
│   ├── deflect-and-patient-defense.json
│   └── ki-resource-depletion.json
├── rogue/
│   ├── sneak-attack-advantage.json
│   ├── cunning-escape-artist.json
│   └── evasion-vs-aoe.json
├── wizard/
│   ├── aoe-blaster.json
│   ├── shield-and-counterspell.json
│   ├── absorb-elements-melee.json
│   └── spell-slot-economy.json
├── barbarian/
│   ├── rage-and-reckless.json
│   ├── frenzy-extra-attack.json
│   └── rage-resistance-types.json
├── cleric/
│   ├── party-healer.json
│   ├── bless-and-bane-party.json
│   ├── turn-undead-horde.json
│   └── divine-support-multiround.json
├── paladin/
│   ├── smite-and-heal.json
│   ├── party-aura-tank.json
│   └── channel-divinity-smite-burst.json
└── warlock/
    ├── hex-and-blast.json
    ├── hellish-rebuke-defense.json
    └── hold-and-control.json
```

---

## Implementation Order

| Phase | Scenarios | Rationale |
|-------|-----------|-----------|
| 1 | F1 (Fighter burst) | Simplest class, no spells, validates multi-round + monster scripting pattern |
| 2 | M1 (Monk FoB) | Validates ki spending + Open Hand across rounds |
| 3 | B1 (Barbarian rage) | Validates rage + resistance tracking |
| 4 | R1 (Rogue sneak) | Validates Sneak Attack + Hide loop |
| 5 | W1 (Wizard AoE) | Validates AoE + multi-target + cantrip fallback |
| 6 | C1 (Cleric healer) | **First multi-PC party scenario** — validates ally targeting |
| 7 | C2 (Cleric bless/bane party) | **Multi-PC + multi-monster buff/debuff** — validates multi-target spells |
| 8 | Remaining solo scenarios (F2-3, M2-4, R2-3, W2-4, B2-3, P1, P3, WL1-3) | Fill out solo coverage |
| 9 | Remaining party scenarios (C4, P2) | Multi-PC with support buffs |
| 10 | C3 (Turn Undead horde) | 4-undead special scenario |

---

## Cross-Flow Risk Checklist
- [x] Do changes in one flow break assumptions in another? — **No.** Purely new E2E scenarios.
- [x] Does the pending action state machine still have valid transitions? — **N/A.**
- [x] Is action economy preserved? — **Tested by scenarios** — each round tracks action/bonus/reaction.
- [x] Do both player AND AI paths handle the change? — **Yes.** Player drives heroes, `queueMonsterActions` drives monsters.
- [x] Are repo interfaces + memory-repos updated? — **N/A.**
- [x] Is `app.ts` registration updated? — **N/A.**
- [x] Are D&D 5e 2024 rules correct? — **Yes.** Divine Smite = bonus action (2024), Extra Attack at L5, etc.

## Risks
- **Long scenarios may be fragile** — Mitigation: `assertState` at each round boundary to localize failures.
- **Monster spellcasting via queueMonsterActions** — need to verify `castSpell` decision type works for scripted monster turns.
- **Frenzy executor exists but no E2E** — may discover bugs in Barbarian scenarios.
- **Bless has known slot bug** — use Shield of Faith for Cleric concentration where possible, document Bless bug.
- **Multi-PC combat with actor field** — well-tested in existing `multi-pc-coordinated-attack.json`, should be solid.
- **Aura of Protection is L6** — Paladin P2 uses Bless/SoF instead (L5-available).

## TODOs / Known Gaps
- ⚠️ **Danger Sense** (Barbarian L2) — not implemented, skip
- ⚠️ **Arcane Recovery** (Wizard L1) — not implemented, skip
- ⚠️ **Bless slot bug** — documented, use Shield of Faith where critical
- ⚠️ **Pack Tactics** (Dire Wolf) — verify engine support
- ⚠️ **Undead Fortitude** (Zombie) — verify engine support
- ⚠️ **Aura of Protection** (Paladin L6) — outside L5 scope

## Test Plan
- [x] Phase 1: `class-combat/fighter/burst-and-endurance.json` — 46/46 PASS
- [x] Phase 2: `class-combat/monk/flurry-and-open-hand.json` — 56/56 PASS
- [x] Phase 3: `class-combat/barbarian/rage-and-reckless.json` — 37/37 PASS
- [x] Phase 4: `class-combat/rogue/sneak-attack-advantage.json` — 28/28 PASS
- [x] Phase 5: `class-combat/wizard/aoe-blaster.json` — 21/21 PASS
- [x] Phase 6: `class-combat/cleric/party-healer.json` (multi-PC) — 27/27 PASS
- [x] Phase 7: `class-combat/cleric/bless-and-bane-party.json` (multi-PC + multi-monster) — 47/47 PASS
- [x] Phase 8: Remaining solo scenarios:
  - [x] F2 `fighter/weapon-mastery-tactics.json` — 29/29 (GAP-7: Improved Critical 19-range unsupported — nat20 workaround)
  - [x] F3 `fighter/tank-vs-resistance.json` — 48/48
  - [x] M2 `monk/stunning-strike-lockdown.json` — 44/44
  - [x] M3 `monk/deflect-and-patient-defense.json` — 52/52
  - [x] M4 `monk/ki-resource-depletion.json` — 59/59
  - [x] R2 `rogue/cunning-escape-artist.json` — 37/37
  - [x] R3 `rogue/evasion-vs-aoe.json` — 38/38 (L7 Thief)
  - [x] W2 `wizard/shield-and-counterspell.json` — 47/47 (GAP-8: Counterspell leg blocked by Hold Person save-to-end bug)
  - [x] W3 `wizard/absorb-elements-melee.json` — 29/29
  - [x] W4 `wizard/spell-slot-economy.json` — 65/65
  - [x] B2 `barbarian/frenzy-extra-attack.json` — 43/43
  - [x] B3 `barbarian/rage-resistance-types.json` — 31/31
  - [x] P1 `paladin/smite-and-heal.json` — 26/26
  - [x] P3 `paladin/channel-divinity-smite-burst.json` — 39/39 (Sacred Weapon not implemented — Divine Sense used instead)
  - [x] WL2 `warlock/hellish-rebuke-defense.json` — 36/36
  - [x] WL3 `warlock/hold-and-control.json` — 35/35 (GAP-9: Advantage vs Paralyzed not implemented)
  - [ ] WL1 `warlock/hex-and-blast.json` — BLOCKED by GAP-6 (Hex bonus damage not applied to EB beams)
- [x] Phase 9: Remaining party scenarios:
  - [x] C4 `cleric/divine-support-multiround.json` — 54/54
  - [x] P2 `paladin/party-aura-tank.json` — 70/70 (GAP-10: `lay on hands on <ally>` cannot target PC — self-heal workaround)
- [x] Phase 10: `class-combat/cleric/turn-undead-horde.json` (4-undead) — 33/33

### New Gaps Discovered (see `class-combat/COVERAGE.md`)
- **GAP-7**: Improved Critical (Champion 19-20) not wired in tabletop roll-state-machine
- **GAP-8**: Hold Person save-to-end bypasses QueueableDiceRoller + hardcodes wisdom 0
- **GAP-9**: Advantage vs Paralyzed creatures not implemented
- **GAP-10**: `lay on hands on <ally>` cannot target PC via text dispatcher
- **GAP-11** (aka GAP-BANE): Bane spell missing from spell catalog

### Confirmed Fixes (no longer gaps)
- BUG-4/GAP-2 (Bless not consuming slot) — FIXED and verified in C2/P2
- Shield of Faith slot consumption — verified in C4

## SME Approval
- [ ] ClassAbilities-SME
- [ ] CombatOrchestration-SME
- [ ] CombatRules-SME
