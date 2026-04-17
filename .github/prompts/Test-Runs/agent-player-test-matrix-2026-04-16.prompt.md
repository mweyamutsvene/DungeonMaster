# Agent Player Test Matrix — 2026-04-16
**LLM Provider**: Ollama (`gpt-oss:20b`)  
**Purpose**: Comprehensive combat mechanics testing with creative play patterns

---

## Batch 1: Melee Core + Creativity (Ports 3002–3004)

### Test A: `solo-fighter` — Fighter Mechanics + Grapple/Shove
- [x] Session starts, initiative rolls work
- [x] Extra Attack (2 attacks/action) chains properly
- [ ] Action Surge grants 4-attack round *(not tested — goblins died too fast)*
- [ ] Second Wind heals when HP < 50% *(not tested — took no damage)*
- [ ] **Creative: Grapple** an enemy mid-combat *(not tested)*
- [ ] **Creative: Shove** an enemy (knock prone) *(not tested)*
- [ ] **Creative: End turn early** — verify AI takes its turn correctly *(not tested)*
- [ ] **Creative: Dash** action instead of attack *(not tested)*
- [x] AI enemies react properly to player positioning
- [x] Combat ends correctly when all enemies die
- [x] LLM narration fires and makes sense
- **🐛 BUG-5**: Weapon switch — said "longsword" but system used Handaxe at range
- **🐛 BUG-6**: Longsword damage showed 1d10+3 (versatile?) vs scenario's 1d8+3

### Test B: `solo-barbarian` — Rage + Reckless Attack
- [x] Rage activates as bonus action
- [x] Rage damage bonus (+2) applies to melee attacks
- [x] Reckless Attack gives advantage (2d20 rolls)
- [x] Extra Attack (2/action) works
- [x] **Creative: End turn without attacking** — Rage may have dropped (BUG-14)
- [x] **Creative: Grapple while raging** — worked! Hit→STR save, orc resisted
- [x] **Creative: Move away from enemy** — OA prompted (**BUG-2**: 404 on resolve)
- [ ] AI gets advantage against raging barbarian *(not clearly observed)*
- [ ] Damage resistance to B/P/S while raging *(not clearly observed)*
- **🐛 BUG-2**: OA pending action 404 breaks movement
- **🐛 BUG-4**: Dash only gave 30ft, not 60ft (30+30)
- **🐛 BUG-8**: Extra Attack prompt says "damage" instead of "attack"
- **🐛 BUG-9**: Damage display omits Rage +2 in arithmetic
- **🐛 BUG-11**: Javelin long range (35ft vs 30/120) rejected
- **🐛 BUG-14**: Rage bonus disappeared after Dash turn

### Test C: `solo-rogue` — Sneak Attack + Cunning Action ⚠️ INCOMPLETE
- [x] Sneak Attack damage (3d6) applies on eligible hits
- [x] Cunning Action: Hide works as bonus action
- [x] Cunning Action: Disengage works as bonus action (short phrasing only)
- [x] **Creative: Hide then attack** — advantage from hidden ✅
- [ ] **Creative: Disengage and move away** — **🐛 BUG-1**: OA still triggered after Disengage!
- [ ] **Creative: End turn after moving only** — *(encounter stuck)*
- [ ] **Creative: Dash via Cunning Action** — *(not tested)*
- [x] Uncanny Dodge reaction when hit (prompted, but **BUG-13**: fetch failed after)
- **🐛 BUG-1**: Disengage doesn't suppress OAs (CRITICAL)
- **🐛 BUG-2**: OA 404 crashed move resolution
- **🐛 BUG-3**: Encounter hung permanently after cascading failures
- **🐛 BUG-7**: Reaction log shows internal IDs, not character names
- **🐛 BUG-10**: Multi-dice damage input rejected (expects single total)
- **🐛 BUG-12**: AI attack display shows +0 modifier/missing totals
- **🐛 BUG-13**: "fetch failed" after Uncanny Dodge reaction

---

## Batch 2: Casters + Special Mechanics (Ports 3005–3007)

### Test D: `solo-wizard` — Spell Slots + Reactions
- [ ] Fire Bolt cantrip works (spell attack roll + 2d10 at level 5)
- [ ] Magic Missile auto-hits (no attack roll needed)
- [ ] Burning Hands (save-based, area) works
- [ ] Scorching Ray (multiple attack rolls) works
- [ ] Shield reaction triggers when hit (+5 AC)
- [ ] Spell slot tracking decrements correctly
- [ ] **Creative: Cast spell then end turn** — verify economy
- [ ] **Creative: Move into melee range** — cast cantrip point blank
- [ ] **Creative: Use quarterstaff** — melee attack with wizard
- [ ] Concentration tracking if applicable

### Test E: `solo-monk` — Ki Pool + Stunning Strike
- [ ] Ki pool initializes correctly (5 ki at level 5)
- [ ] Flurry of Blows: 2 extra unarmed strikes
- [ ] Stunning Strike: CON save prompt on hit
- [ ] Patient Defense: dodge as bonus action
- [ ] Step of the Wind: bonus action dash/disengage
- [ ] **Creative: Flurry then Stunning Strike** on same turn
- [ ] **Creative: Patient Defense then end turn** — defensive play
- [ ] **Creative: Move halfway, attack, move rest** — split movement
- [ ] Open Hand Technique options on Flurry hit
- [ ] Deflect Attacks reaction

### Test F: `boss-fight` — Fighter vs Ogre (High Stakes)
- [ ] Ogre stat block loads correctly (59 HP, AC 11)
- [ ] Ogre hits hard — damage values correct
- [ ] Action Surge + Extra Attack = 4-attack nova round
- [ ] Second Wind heals at right amount (1d10+5)
- [ ] **Creative: Grapple the Ogre** — STR contest
- [ ] **Creative: Shove Ogre prone** then attack with advantage
- [ ] **Creative: Move away to provoke OA** — test opportunity attack
- [ ] **Creative: End turn early** when Ogre at low HP
- [ ] Combat victory triggers properly

---

## Batch 3: Multi-Combatant + Edge Cases (Ports 3008–3010)

### Test G: `solo-warlock` — Eldritch Blast Multi-Beam
- [ ] Eldritch Blast fires 2 beams (level 5)
- [ ] Each beam gets separate attack roll
- [ ] Force damage 1d10 per beam (NOT 2d10)
- [ ] Hex concentration applies +1d6 necrotic per hit
- [ ] Pact Blade melee attack works
- [ ] **Creative: Cast Hex then Eldritch Blast** — combo
- [ ] **Creative: Switch to melee mid-fight** — Pact Blade
- [ ] **Creative: End turn without attacking** — hold ground
- [ ] Spell slot (level 3) tracking

### Test H: `wounded-fighter` — Survival Pressure
- [ ] Starts at 18/42 HP (below 50%)
- [ ] Second Wind fires immediately (survival priority)
- [ ] 4 Goblin Warriors → multi-enemy AI turns work
- [ ] Action Surge when outnumbered
- [ ] **Creative: Focus fire one goblin** to reduce enemy count
- [ ] **Creative: Move to bottle-neck position** — tactical movement
- [ ] **Creative: Grapple one goblin** while fighting others
- [ ] Multiple enemies taking turns in sequence
- [ ] Death save if HP hits 0

### Test I: `solo-paladin` — Divine Smite + Healing
- [ ] Lay on Hands healing works
- [ ] Divine Smite post-hit (bonus radiant damage)
- [ ] Extra Attack (2/action)
- [ ] Shield of Faith concentration (+2 AC)
- [ ] **Creative: Smite + Extra Attack** combo round
- [ ] **Creative: Cure Wounds** instead of attacking
- [ ] **Creative: End turn early** to conserve resources
- [ ] **Creative: Grapple a fiend** — STR contest
- [ ] Spell slot management across Smite + spells

---

## Batch 4: Remaining Scenarios (Ports 3011–3013)

### Test J: `party-dungeon` — Multi-Combatant Party
- [ ] Multiple PCs/NPCs in party
- [ ] Turn order with multiple combatants
- [ ] Targeting specific enemies by name
- [ ] **Creative: Move to protect NPC ally** 
- [ ] **Creative: Dash past enemies** — provoke multiple OAs
- [ ] AI targets weakest party member
- [ ] Multi-combatant victory condition

### Test K: `monk-vs-monk` — Mirror Match
- [ ] Both combatants have ki abilities
- [ ] Stunning Strike vs Stunning Strike
- [ ] Deflect Attacks from both sides
- [ ] **Creative: Patient Defense** against monk enemy
- [ ] **Creative: Step of the Wind to reposition**
- [ ] **Creative: Grapple the enemy monk**
- [ ] Ki resource war — who runs out first

---

## Summary Stats
| Metric | Count |
|--------|-------|
| Total scenarios | 11 |
| Total test checks | ~115 |
| Batches completed | 1 of 4 |
| Scenarios run | 3 (fighter ✅, barbarian ✅, rogue ⚠️ stuck) |
| Bugs found | **14** (3 Critical, 6 Medium, 5 Low) |
| Unexpected behaviors | 4 (ambiguous/needs review) |
| Missing features | Dash extra movement, long-range attacks |

### Bug Report
See [run-batch1-2026-04-16.prompt.md](run-batch1-2026-04-16.prompt.md) for full details.

### Top 3 Blockers
1. **BUG-2**: OA pending action 404 — all movement-triggered reactions broken
2. **BUG-1**: Disengage not suppressing OAs — core 5e mechanic
3. **BUG-4**: Dash not granting extra movement
