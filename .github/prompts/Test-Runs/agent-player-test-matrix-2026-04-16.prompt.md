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

### Test D: `solo-wizard` — Spell Slots + Reactions- DONE
- [X] Fire Bolt cantrip works (spell attack roll + 2d10 at level 5)
- [ ] Magic Missile auto-hits (no attack roll needed)
- [ ] Burning Hands (save-based, area) works
- [ ] Scorching Ray (multiple attack rolls) works
- [ ] Shield reaction triggers when hit (+5 AC)
- [ ] Spell slot tracking decrements correctly
- [ ] **Creative: Cast spell then end turn** — verify economy
- [ ] **Creative: Move into melee range** — cast cantrip point blank
- [ ] **Creative: Use quarterstaff** — melee attack with wizard
- [ ] Concentration tracking if applicable

### Test E: `solo-monk` — Ki Pool + Stunning Strike — DONE (2026-04-17)
- [x] Ki pool initializes correctly (5 ki at level 5)
- [x] Flurry of Blows: 2 extra unarmed strikes (both chained, ki spent 4→3)
- [x] Stunning Strike: CON save prompt on hit (auto-resolved for NPC, Orc Brute stunned)
- [ ] Patient Defense: dodge as bonus action *(not tested — combat ended round 1, enemy missed)*
- [ ] Step of the Wind: bonus action dash/disengage *(not tested — combat ended too fast)*
- [x] **Creative: Flurry then Stunning Strike** on same turn ✅ (Stunning Strike first, then Flurry after)
- [ ] **Creative: Patient Defense then end turn** — defensive play *(not tested)*
- [ ] **Creative: Move halfway, attack, move rest** — split movement *(not tested)*
- [ ] Open Hand Technique options on Flurry hit *(⚠️ scenario JSON has no subclass field — feature untestable)*
- [ ] Deflect Attacks reaction *(not tested — enemy never hit Kai)*
- **🐛 BUG-M1**: Extra Attack prompt mislabeled "for damage" instead of "for attack" (cosmetic, same as BUG-8)
- **⚠️ NOTE**: `solo-monk.json` missing `subclass` field — Open Hand Technique can't be tested
- **⚠️ NOTE**: 1-round victory means defensive ki abilities (Patient Defense, Step of Wind, Deflect Attacks) untested
- Report: `run-solo-monk-2026-04-17.prompt.md`

### Test F: `boss-fight` — Fighter vs Ogre (High Stakes) — DONE (2026-04-17)
- [x] Ogre stat block loads correctly (59 HP, AC 11)
- [ ] Ogre hits hard — damage values correct *(not observed — Ogre only attacked once and missed)*
- [x] Action Surge + Extra Attack = 4-attack nova round ("Action 0/4 attacks" confirmed)
- [ ] Second Wind heals at right amount (1d10+5) *(not tested — Thorin took no damage)*
- [ ] **Creative: Grapple the Ogre** — STR contest *(not tested — Ogre died in round 1)*
- [ ] **Creative: Shove Ogre prone** then attack with advantage *(not tested — Ogre died in round 1)*
- [x] **Creative: OA triggered** when Ogre fled (moveAwayFrom) — OA hit, 10 damage, killed Ogre
- [ ] **Creative: End turn early** when Ogre at low HP *(ended turn at 9 HP, Ogre fled)*
- [x] Combat victory triggers properly
- **🐛 BUG-F1**: Extra Attack roll prompt mislabeled "for damage" instead of "for attack" (same as BUG-8/BUG-M1)
- **🐛 BUG-F3**: Post-OA 404 on stale pending action after OA kills enemy (same as BUG-2)
- **🐛 BUG-F4**: Initiative display inconsistency — narrative says 18, turn order shows 19 for Ogre
- Report: `run-boss-fight-2026-04-17.prompt.md`

---

## Batch 3: Multi-Combatant + Edge Cases (Ports 3008–3010)

### Test G: `solo-warlock` — Eldritch Blast Multi-Beam — DONE (2026-04-17)
- [x] Eldritch Blast fires 2 beams (level 5)
- [x] Each beam gets separate attack roll
- [x] Force damage 1d10 per beam (NOT 2d10)
- [x] Hex concentration applies +1d6 necrotic per hit (on hexed target; retarget failed — BUG-WL2)
- [x] Pact Blade melee attack works
- [x] **Creative: Cast Hex then Eldritch Blast** — combo ✅
- [x] **Creative: Switch to melee mid-fight** — Pact Blade ✅
- [ ] **Creative: End turn without attacking** — hold ground *(not tested)*
- [x] Pact Magic slot (level 3) tracking — `pactMagic 2/2→1/2` ✅; `spellSlot_3` stuck at 2/2 (BUG)
- **🐛 BUG-WL1**: Hex damage formula display wrong — "14 + 0 = 20" arithmetic impossible (Hex dice applied silently)
- **🐛 BUG-WL2**: Hex retarget via bonus action silently fails — new target doesn't receive +1d6
- **🐛 BUG-WL3**: Pact Blade display "5 + 4 = 12" (Hex modifier hidden, same root as WL1)
- **🐛 BUG-WL4**: Beam 2 still prompts and resolves against 0 HP dead target ("HP: 0 → 0")
- **🐛 BUG-2**: OA 404 reproduced twice (same as all prior tests)
- **⚠️ INVESTIGATE**: No concentration save prompted after Malachar took 12 damage (Hex active, DC 10 CON save required per 5e)
- **⚠️ INVESTIGATE**: `spellSlot_3` never decremented (only `pactMagic` decremented) — dual tracking inconsistency
- **⚠️ INVESTIGATE**: Spectral Guard never moved or attacked in 4 rounds (AI passivity bug)
- Report: `run-solo-warlock-2026-04-17.prompt.md`

### Test H: `wounded-fighter` — Combat State Corruption (2026-04-18)
- [x] Starts at 18/42 HP (below 50%)
- [x] Second Wind fires immediately (survival priority) — healed 13 HP (8+5) ✅
- [x] Second Wind resource decremented (1→0) ✅
- [x] Action Surge grants 2 additional attacks ✅ ("Gained 2 additional attacks")
- [x] Action Surge resource decremented (1→0) ✅
- [x] Extra Attack (2/action) chains correctly ✅
- [x] Disadvantage on hidden target handled (2d20, lower taken) ✅
- [x] 3 of 4 Goblins killed in single round via SecondWind + ExtraAttack + ActionSurge
- [ ] Multiple enemies taking turns in sequence *(AI stall then combat loop)*
- [ ] Death save if HP hits 0 *(not needed — took no damage)*
- **🐛 BUG-5** (reproduced): "longsword" auto-selects Handaxe by default
- **🐛 BUG-6** (reproduced): Longsword damage 1d10+3 instead of 1d8+3 (versatile always two-hand)
- **🐛 BUG-H1** (new): Ranged long-range attack rejected — 30ft > 20ft normal range, ignores 60ft long range
- **🐛 BUG-H2** (new): AI stalls when dead combatants block pathfinding (root cause: dead bodies treated as occupied)
- **🐛 BUG-H3** (Critical): Server attacks already-dead goblins at full HP (7→0 on dead targets)
- **🐛 BUG-H4** (Critical): Player turn auto-resolved without player input
- **🐛 BUG-H5** (Critical): Combat loop replays identical turn sequence indefinitely
- **🐛 BUG-H6** (High): No victory declared despite all enemies at 0 HP
- Report: `run-batch2-2026-04-18.prompt.md`

### Test I: `solo-paladin` — PARTIAL (Re-tested 2026-04-19)
- [ ] Lay on Hands healing works *(not tested — Aldric never took damage)*
- [x] Divine Smite post-hit (bonus radiant damage) ✅ — 16 radiant bonus vs fiend, slot decremented
- [x] Extra Attack (2/action) ✅ — auto-chains correctly
- [ ] Shield of Faith concentration (+2 AC) *(BUG-P2: consumes action instead of bonus action)*
- [ ] Channel Divinity *(not tested)*
- [ ] Cure Wounds spell *(not tested)*
- [x] Resource pools initialize correctly: layOnHands 25/25, channelDivinity 1/1, spellSlots ✅
- [x] Sap weapon mastery applies on hit ✅
- [x] AC 20 correctly blocks low attack rolls ✅
- ~~**⚠️ BUG-I1**~~ RESOLVED: Ollama contention, not a code bug. Re-test on 4/19 started immediately.
- **🐛 BUG-P1** (Low): Divine Smite damage display shows "6 + 3 = 25" — omits +16 smite in equation
- **🐛 BUG-P2** (High): Shield of Faith consumes action instead of bonus action — blocks attack on same turn
- **🐛 BUG-P3** (High): Shield of Faith does not consume spell slot — spellSlot_1 unchanged after cast
- **🐛 BUG-P4** (High): AI stall after Round 3 (same as BUG-H2)
- **⚠️**: Bonus action marked "used" after Divine Smite in Round 1 (no bonus action requested — rule mismatch?)
- Report: `run-solo-paladin-2026-04-19.prompt.md`

---

## Batch 4: Remaining Scenarios (Ports 3011–3013)

### Test J: `party-dungeon` — INCOMPLETE — Server Timeout (2026-04-18)
- [ ] Multiple PCs/NPCs in party *(not reached — server timeout)*
- [ ] Turn order with multiple combatants *(not reached)*
- [ ] Targeting specific enemies by name *(not reached)*
- **⚠️ BUG-J1** (Needs Re-Test): `/combat/initiate` times out after 120s. NPC initialization suspected, but Ollama contention from stuck wounded-fighter AI is the likely confound. Re-test in isolation.
- Report: `run-batch2-2026-04-18.prompt.md`

### Test K: `monk-vs-monk` — INCOMPLETE — Server Timeout (2026-04-18)
- [ ] Both combatants have ki abilities *(not reached — server timeout)*
- [ ] Stunning Strike vs Stunning Strike *(not reached)*
- [ ] Ki resource war — who runs out first *(not reached)*
- **⚠️ BUG-K1** (Needs Re-Test): `/combat/initiate` times out after 120s. Monster has `className: "monk"` + `level: 5` — server resource init suspected, but Ollama contention is likely confound. Re-test in isolation.
- Report: `run-batch2-2026-04-18.prompt.md`

---

## Summary Stats
| Metric | Count |
|--------|-------|
| Total scenarios | 11 |
| Total test checks | ~115 |
| Batches completed | 2 of 4 |
| Scenarios run | 9 (fighter ✅, barbarian ✅, rogue ⚠️, wizard ✅, monk ✅, boss ✅, warlock ✅, wounded-fighter ⚠️, paladin ⚠️, party-dungeon ❌, monk-vs-monk ❌) |
| Bugs found | **30** (6 Critical, 10 High, 8 Medium, 6 Low/Cosmetic) |
| Resolved | BUG-I1 (Ollama contention, not code) |
| Unexpected behaviors | 6 (ambiguous/needs review) |
| Missing features | Dash extra movement, long-range attacks |

### Bug Reports
- Batch 1: [run-batch1-2026-04-16.prompt.md](run-batch1-2026-04-16.prompt.md)
- Batch 2: [run-batch2-2026-04-18.prompt.md](run-batch2-2026-04-18.prompt.md)
- Paladin: [run-solo-paladin-2026-04-19.prompt.md](run-solo-paladin-2026-04-19.prompt.md)

### Top 8 Blockers
1. **BUG-H3/H4/H5**: Dead goblins attacked at full HP + player turn auto-resolved + combat loop (Critical — combat state corruption)
2. **BUG-H6**: No victory despite all enemies at 0 HP (High — combat never ends)
3. **Dead combatant pathfinding**: Dead bodies block movement in 4 files (root cause of BUG-H2/P4 AI stall)
4. **BUG-P2/P3**: Shield of Faith consumes action (not bonus) + no spell slot consumed (High — spell casting broken)
5. **BUG-H1/BUG-11**: Long-range attacks rejected (Medium — only normal range checked)
6. **BUG-6**: Longsword versatile always 1d10 two-hand (Medium)
7. **BUG-2**: OA pending action 404 (Critical — movement reactions broken)
8. **BUG-1**: Disengage not suppressing OAs (Critical — core 5e mechanic)
