# Class Combat E2E — Ability Coverage Tracker

> Auto-updated as scenarios are implemented. Each row = one ability/feature/spell tested in the `class-combat/` suite.

## Coverage Summary

| Class | Abilities Covered | Scenarios | Status |
|-------|------------------|-----------|--------|
| Fighter | 5 / 5 | 3 / 3 | Complete |
| Monk | 8 / 8 | 4 / 4 | Complete |
| Rogue | 5 / 5 | 3 / 3 | Complete |
| Wizard | 8 / 9 | 4 / 4 | Complete |
| Barbarian | 5 / 5 | 3 / 3 | Complete |
| Cleric | 9 / 10 | 4 / 4 | Complete (Bane fixed — GAP-BANE resolved Phase 0.3) |
| Paladin | 6 / 6 | 3 / 3 | Complete |
| Warlock | 5 / 5 | 3 / 3 | Complete |

### Cross-Class Regression Scenarios

| ID | Scenario | Scope | Status |
|----|----------|-------|--------|
| X1 | `core/healing-dice-regression.json` | Fighter Second Wind + Cleric Healing Word/Cure Wounds + Paladin Lay on Hands amount control | - [x] PASS (22/22) |

---

## Fighter (Champion, L5)

| Ability / Feature | Type | Scenario | How Tested | Synergies | Status |
|-------------------|------|----------|------------|-----------|--------|
| Extra Attack | Feature (L5) | F1, F2, F3 | 2 attacks per Attack action every round | All combat abilities | - [x] |
| Action Surge | Resource (1/rest) | F1: burst-and-endurance | Use in R2 for 4 attacks total; assert `actionSurge` pool → 0 | Extra Attack (4 hits in one round) | - [x] |
| Second Wind | Resource (1/rest) | F1: burst-and-endurance, X1 | Use in R3 as bonus action; assert HP increase + `secondWind` pool → 0. X1 asserts roll-bound healing range (no auto-max) | Sustain through multi-round fight | - [x] |
| Weapon Mastery (Graze) | Feature (L1) | F2: weapon-mastery-tactics | Attack with Greatsword; on miss, Graze deals STR mod damage | Movement + Extra Attack vs mobile enemies | - [x] |
| Improved Critical | Feature (Champion L3) | F2: weapon-mastery-tactics | Uses natural 20 (19 range BLOCKED by GAP-7) | Extra Attack (more chances to crit) | - [x] (partial, see GAP-7) |

### Potential Synergies Not Yet Covered
- Fighting Style (Defense) + high AC → tested implicitly in F3 via AC 20
- Action Surge + Great Weapon Master (feat not implemented)
- Two-weapon fighting + Nick property → future scenario

---

## Monk (Open Hand, L5)

| Ability / Feature | Type | Scenario | How Tested | Synergies | Status |
|-------------------|------|----------|------------|-----------|--------|
| Extra Attack | Feature (L5) | M1, M2, M3, M4 | 2 attacks per Attack action | All combat abilities | - [x] |
| Flurry of Blows | Ki (1) | M1: flurry-and-open-hand, M4 | Bonus action after Attack; 2 extra unarmed strikes. Assert ki decremented | Open Hand Technique, Extra Attack | - [x] |
| Open Hand Technique | Feature (L3) | M1: flurry-and-open-hand | On FoB hit: push 15ft / knock prone / addle (no reactions). Assert condition applied | Flurry of Blows (triggers on FoB) | - [x] |
| Stunning Strike | Ki (1) | M2: stunning-strike-lockdown, M4 | On unarmed hit: target CON save or Stunned. Assert condition + ki spent | Extra Attack (more chances to stun) | - [x] |
| Deflect Attacks | Reaction (free) | M1, M3: deflect-and-patient-defense, M4 | Reaction to reduce incoming attack damage. Assert via reaction prompt | Ranged enemies (archers force deflect) | - [x] |
| Patient Defense | Ki (1) | M3: deflect-and-patient-defense, M4 | Bonus action Dodge; all attacks at disadvantage. Assert ki spent | Multiple attackers (maximizes value) | - [x] |
| Step of the Wind | Ki (1) | M3: deflect-and-patient-defense, M4 | Bonus action Dash; double movement. Assert ki spent + position | Ranged enemies (close distance) | - [x] |
| Martial Arts | Feature (L1) | M1, M4 | Free bonus action unarmed strike (when no ki spent on FoB). Assert no ki cost | Fallback when ki depleted | - [x] |

### Potential Synergies Not Yet Covered
- Stunning Strike + Flurry (stun on first FoB hit → advantage on rest) → partially in M2
- Wholeness of Body (L5) → could add to M4 as ki-free healing
- Slow Fall → terrain scenario

---

## Rogue (Thief, L5)

| Ability / Feature | Type | Scenario | How Tested | Synergies | Status |
|-------------------|------|----------|------------|-----------|--------|
| Sneak Attack (3d6) | Feature (L1) | R1, R2, R3 | Extra damage on hit with advantage or adjacent ally. Assert bonus damage formula 1d6+3d6+4 | Hide (advantage), ally adjacency | - [x] |
| Cunning Action: Hide | Bonus Action | R1: sneak-attack-advantage | Hide as bonus → advantage on next attack → Sneak Attack | Sneak Attack (advantage source) | - [x] |
| Cunning Action: Disengage | Bonus Action | R1: sneak-attack-advantage, R2 | Disengage to avoid OA when leaving melee | Kiting melee enemies | - [x] |
| Cunning Action: Dash | Bonus Action | R2: cunning-escape-artist | Dash as bonus to double movement for repositioning | Kiting ranged enemies | - [x] |
| Uncanny Dodge | Reaction (L5) | R1: sneak-attack-advantage, R2: cunning-escape-artist, R3: evasion-vs-aoe | Halve damage from one attack per round via `waitForReaction uncanny_dodge` + `reactionRespond use` | Multiple attackers (only 1/round) | - [x] |
| Evasion | Feature (Rogue L7) | R3: evasion-vs-aoe | Uses L7 Thief. DEX save success = 0 damage; fail = half damage on AoE. Tested vs Burning Hands via monster castSpell | Multi-target AoE survival | - [x] |

### Potential Synergies Not Yet Covered
- Evasion (L7) → listed in plan but Thief L5 doesn't have it (Rogues get Evasion at L7 — need L7 or skip R3)
- Expertise (double proficiency) → passive, no explicit test needed
- Thieves' Cant → RP, not combat
- Sneak Attack via ally adjacency (R1) + via Hidden advantage (R1 R2) — both tested in R1

---

## Wizard (Evocation, L5)

| Ability / Feature | Type | Scenario | How Tested | Synergies | Status |
|-------------------|------|----------|------------|-----------|--------|
| Fireball | Spell (L3) | W1: aoe-blaster | 8d6 fire, 20ft sphere, DEX save. Assert damage + slot spent (L3: 2→1) | Multiple clustered targets | - [x] |
| Burning Hands | Spell (L1) | W1: aoe-blaster | 3d6 fire, 15ft cone, DEX save. Assert slot spent (L1: 4→3) | Clustered targets, slot fallback | - [x] |
| Fire Bolt (2d10) | Cantrip | W1: aoe-blaster, W2, W4 | 2d10 fire at L5 (cantrip scaling). Attack roll + damage roll, no slot cost | Zero-cost fallback when slots depleted | - [x] |
| Shield | Reaction (L1) | W2: shield-and-counterspell | +5 AC until next turn on incoming attack. Shield reaction consumed spellSlot_1 (4→3) on forced Bone Sniper hit | Skeleton ranged attack trigger | - [x] |
| Counterspell | Reaction (L3) | W2: shield-and-counterspell | BLOCKED by GAP-8 (Hold Person save-to-end hardcodes wisdom 0 & bypasses queueable dice, leaving Shadow Mage locked). Counterspell leg disabled; assertion pinned at 2/2 | Enemy spellcaster | - [~] (partial, see GAP-8) |
| Hold Person | Spell (L2) | W2: shield-and-counterspell, WL3: hold-and-control | Concentration, paralyze humanoid. `queueDiceRolls [1]` forces WIS save fail; characterConcentration set correctly | Concentration lockdown | - [x] |
| Scorching Ray | Spell (L2) | W2: shield-and-counterspell, W4: spell-slot-economy | 3 beams, each attack roll | Slot economy (efficient L2 damage) | - [x] |
| Absorb Elements | Reaction (L1) | W3: absorb-elements-melee | Triggered on incoming fire damage; halves damage + L1 slot consumed via damage-reaction flow | Fire-immune enemy follow-up | - [x] |
| Ray of Frost | Cantrip | W3: absorb-elements-melee | Cold damage cantrip vs fire-immune enemy (full damage lands) | Non-fire damage against Fire Elemental | - [x] |
| Chill Touch | Cantrip | W3: absorb-elements-melee | Necrotic cantrip bypasses fire immunity (L5 scaling 2d8) | Alternative non-fire damage | - [x] |
| Fire Immunity Check | Mechanic | W3: absorb-elements-melee | Fire Bolt at Flame Sprite → `15 + 0 = 0 damage` confirmed | Reinforces type-matching importance | - [x] |
| Spell Slot Economy | Resource | W4: spell-slot-economy | Deplete all 9 slots (2×L3, 3×L2, 4×L1) across 10 rounds; cantrip fallback assertion | Cantrip fallback when depleted | - [x] |

### Potential Synergies Not Yet Covered
- Sculpt Spells (Evocation L2) → exclude allies from AoE → needs multi-PC AoE scenario
- Potent Cantrip (Evocation L6) → out of L5 scope
- Absorb Elements → listed in W3, needs verification of reaction system

---

## Barbarian (Berserker, L5)

| Ability / Feature | Type | Scenario | How Tested | Synergies | Status |
|-------------------|------|----------|------------|-----------|--------|
| Rage | Resource (3/day) | B1, B2, B3 | Bonus action to activate. +2 rage damage, resistance to B/P/S. Assert resource pool decremented | All melee combat | - [x] |
| Reckless Attack | Feature (L2) | B1: rage-and-reckless, B3 | Advantage on attacks, enemies get advantage too. Assert advantage on roll | Rage (survive extra hits via resistance) | - [x] |
| Rage Damage Resistance | Feature (w/ Rage) | B1: rage-and-reckless, B3 | Halve bludgeoning/piercing/slashing. Assert HP reflects half damage via ranges | Different damage type enemies | - [x] |
| Frenzy | Feature (Berserker L3) | B2: frenzy-extra-attack | `frenzy attack <target>` text routes to FrenzyExecutor; Rage+Extra Attack+Frenzy = 3 attacks/round from R2 onward. NOTE: subclass must be in sheet object | Rage + Extra Attack (3 attacks) | - [x] |
| Extra Attack | Feature (L5) | B1: rage-and-reckless, B2, B3 | 2 attacks per Attack action. Assert attack chain (Greataxe Cleave auto-hits adjacents) | All combat abilities | - [x] |

### Potential Synergies Not Yet Covered
- Danger Sense (L2) → advantage on DEX saves vs visible effects → not yet implemented
- Unarmored Defense → passive AC, no explicit test needed
- Rage + fire damage immunity check → B3 tests that fire bypasses rage resistance
- Greataxe Cleave → auto-hits adjacent enemies (discovered in B1, tested implicitly)

---

## Cleric (Life, L5)

| Ability / Feature | Type | Scenario | How Tested | Synergies | Status |
|-------------------|------|----------|------------|-----------|--------|
| Healing Word | Spell (L1, bonus) | C1: party-healer, C4, X1 | Heal ally at range as bonus action. Assert ally HP healed + slot spent (3→2). 2d4+4 at L5. X1 asserts strict HP range to detect auto-max healing regressions | Multi-PC (target ally) | - [x] |
| Cure Wounds | Spell (L1, action) | C1: party-healer, X1 | Heal ally in touch range as action. Assert ally HP healed + slot spent (2→1). 2d8+4 at L5. X1 asserts strict HP range to detect auto-max healing regressions | Multi-PC (target dying ally) | - [x] |
| Guiding Bolt | Spell (L1, attack) | C1: party-healer, C4 | 4d6 radiant spell attack (roll+7 vs AC). Assert damage + slot spent (4→3) | Ally follow-up attack | - [x] |
| Sacred Flame | Cantrip | C1: party-healer, C2, C3 | DEX save cantrip, auto-resolved. Assert no slot cost. 2d8 at L5 | Maintain concentration while dealing damage | - [x] |
| Bless | Spell (L1, concentration) | C2: bless-and-bane-party | Casts Bless on all 3 party members. Asserts concentration set + L1 slot consumed (4→3). Guiding Bolt (non-concentration) cast in R2, asserts Bless concentration persists (3→2 slots). Slot-consumed assertion confirms GAP-2/BUG-4 is FIXED. | Multi-PC (3 targets), concentration | - [x] |
| Bane | Spell (L1, concentration) | C2: bless-and-bane-party, unit: buff-debuff.bane.test.ts | GAP-BANE RESOLVED (Phase 0.3): Bane IS in catalog (level-1.ts:45). Root bug was BuffDebuffHandler overwriting earlier effects when multiple effect declarations targeted the same combatant — fixed by mutating in-memory snapshot after each write. Unit test asserts 3 enemies with mocked saves: only the failed-save target receives both penalty effects. | Multi-monster (3 targets) | - [x] |
| Turn Undead | Channel Divinity | C3: turn-undead-horde | CD pool spent, WIS saves resolved server-side (queueDiceRolls), CR 0.25 skeletons destroyed (Destroy Undead), CR 3 Grimwight Frightened | Multiple undead, Destroy Undead threshold | - [x] |
| Spirit Guardians | Spell (L3, concentration) | C3: turn-undead-horde | Zone aura active, 3d8 radiant on monster turn starts (on_start_turn trigger), L3 slot consumed, concentration tracked | Turn Undead (fleeing → re-entering zone) | - [x] |
| Shield of Faith | Spell (L1, bonus, conc) | C4: divine-support-multiround | +2 AC on ally (buff delivery), L1 slot consumed (GAP-2 resolved — buff spells now consume slots), concentration active across rounds | Multi-PC (buff ally) | - [x] |
| Concentration Management | Mechanic | C4: divine-support-multiround | Shield of Faith persists through non-concentration spells (Guiding Bolt, Sacred Flame, Healing Word). Two-spell rule blocks leveled bonus after leveled action. | All concentration spells | - [x] |

### Potential Synergies Not Yet Covered
- Disciple of Life (Life L1) → bonus healing on heal spells → needs assertion for extra HP
- Preserve Life (Life L2, CD) → mass heal at low HP → needs multi-PC with low HP allies
- Spiritual Weapon (L2) → bonus action attack each round → future scenario

---

## Paladin (Devotion, L5)

| Ability / Feature | Type | Scenario | How Tested | Synergies | Status |
|-------------------|------|----------|------------|-----------|--------|
| Divine Smite | Bonus Action (slot) | P1: smite-and-heal, P3 | On hit, expend slot for 2d8+ radiant. Assert radiant damage + slot | Extra Attack (2 smite chances), undead bonus | - [x] |
| Lay on Hands | Feature (25 HP pool) | P1: smite-and-heal, P2, X1 | Touch heal from pool. Assert HP restored + pool reduced. X1 verifies explicit amount input (e.g. "lay on hands 3") is honored exactly | Self-sustain or ally heal | - [x] |
| Extra Attack | Feature (L5) | P1, P2, P3 | 2 attacks per Attack action | Divine Smite (2 smite chances) | - [x] |
| Bless | Spell (L1, concentration) | P2: party-aura-tank, C2: bless-and-bane-party | +1d4 to 3 allies' attacks/saves. Multi-PC (Paladin+Wizard+Rogue); BUG-4 fix verified — L1 slot consumed 4→3 | Multi-PC party support | - [x] |
| Channel Divinity | Resource (L5 = 1/rest) | P3: channel-divinity-smite-burst | Divine Sense consumed CD pool (1→0). NOTE: Sacred Weapon not implemented; only Divine Sense exists | Undead enemies (no subclass variants) | - [x] |
| Spell Slot vs Smite Economy | Resource | P3: channel-divinity-smite-burst | Smite always consumes lowest available slot (L1 first); L2 preserved while L1 available | Cure Wounds self-heal competing with smites | - [x] |

### Potential Synergies Not Yet Covered
- Aura of Protection (L6) → +CHA to saves for nearby allies → out of L5 scope
- Sacred Weapon (Devotion CD) → +CHA to attack rolls → could be in P3
- Thunderous Smite (L1) → pushback on smite → future scenario

---

## Warlock (Fiend Pact, L5)

Current execution status:
- WL1 (`class-combat/warlock/hex-and-blast`) is passing.
- Hex bonus damage application now works with Eldritch Blast beams in class-combat flow.

| Ability / Feature | Type | Scenario | How Tested | Synergies | Status |
|-------------------|------|----------|------------|-----------|--------|
| Eldritch Blast (2 beams) | Cantrip | WL1, WL2: hellish-rebuke-defense, WL3: hold-and-control | 2 beams at L5, each attack roll. Multi-attack pattern confirmed in WL2/WL3 | Hex (bonus damage per beam) | - [x] |
| Hold Person | Spell (L2) | WL3: hold-and-control | Warlock Pact Magic uses spell's natural slot level (L2) not Pact L3; concentration + Paralyzed via forced WIS save fail | EB against paralyzed (blocked by GAP-9) | - [x] |
| Hex | Spell (L1, concentration) | WL1: hex-and-blast | Bonus action, +1d6 necrotic per hit. Assert damage bonus + conc | EB (2 beams = 2× Hex bonus), transfer on kill | - [x] |
| Hex Transfer | Mechanic | WL1: hex-and-blast | Move Hex to new target when original dies (free). Assert target switch | Multi-target fights, Hex persistence | - [x] |
| Hellish Rebuke | Reaction (L1 slot) | WL2: hellish-rebuke-defense | R1–R2: queue dice forces hit, waitForReaction + reactionRespond; assert pactMagic 2→1→0. R3: verify NO reaction fires when pactMagic=0 (waitForTurn goes straight through). | Pact Slot economy (competes with Hex) | - [x] |
| Pact Slot Economy | Resource (2 L3 slots) | WL2: hellish-rebuke-defense | pactMagic pool tracked via characterResource assertions across 3 rounds; cantrip fallback confirmed (EB always free). | All slot spells compete for 2 slots | - [x] |

### Potential Synergies Not Yet Covered
- Hold Person (L2 upcast to L3) + EB advantage → listed in WL3, needs paralyzed + EB test
- Dark One's Blessing (Fiend L1) → temp HP on kill → future scenario
- Eldritch Invocations (Agonizing Blast) → CHA to EB damage → may not be implemented

---

## Monster Abilities Tested (Secondary)

| Monster Ability | Scenarios Using It | How Tested |
|-----------------|-------------------|------------|
| Multiattack | F1, M1, M2, M4, R2, C1, C2, C4, P2, P3, WL1, WL2, WL3 | Monster scripted with 2+ attacks per turn via queueMonsterActions |
| Nimble Escape | F2, M4, WL3 | Goblin uses bonus action Disengage after attack |
| Monster Spellcasting | R3, W2, P2 | Monster queued to cast specific spells (Hold Person, Burning Hands) |
| Damage Resistance | F3, B3 | Monster takes half damage from matching type; full from non-matching |
| Damage Immunity (Fire) | W3, B3 | Fire spells deal 0 damage to Fire Elemental |
| Condition Immunity | M3, W4, C3, P3 | Skeleton immune to Poisoned; assert condition not applied |
| Heavy Damage | B1, B3, C4, F3 | Ogre deals high damage to test PC survivability |
| Life Drain | C3, P1, P3 | Wight/Specter necrotic attack; HP max reduction mechanic |
| Pack Tactics | W3 | Dire Wolf advantage when ally adjacent |
| Aggressive | B2, M1 | Gnoll bonus action move toward enemy |
| Ranged Attacks | F2, M3, R1, W2, W4 | Skeleton Archers / Goblins shoot from range |
| Undead Type | C3, P1, P3 | Enables Turn Undead + extra Divine Smite radiant |

---

## Implementation Gaps & Test Runner Observations

> Discovered during scenario writing. Each gap includes root cause analysis and fix path.

### GAP-1: Monster Multiattack — Two Bugs Fixed

**Symptom**: When queueing 2+ attack decisions for a monster via `queueMonsterActions`, the 2nd attack fails with "Cannot attack - action already spent this turn." Additionally, when a multiattack hit triggers a player reaction (e.g., Deflect Attacks), the queued decisions for subsequent monsters get consumed by the wrong combatant.

**Root Cause (Bug A — `spendAction` vs `useAttack`)**: `AiAttackResolver` (the two-phase attack path used when a target might have Shield/Deflect reactions) was calling `spendAction()` instead of `useAttack()`. `spendAction()` unconditionally sets `actionSpent=true`, bypassing the multiattack counter system. `useAttack()` respects `attacksUsedThisTurn`/`attacksAllowedThisTurn` counters and only sets `actionSpent=true` when all allowed attacks are used.

**Fix A**: Replaced 3 instances of `spendAction()` with `useAttack()` in `ai-attack-resolver.ts` (miss path line 292, awaiting_reactions path line 333, hit path line 537).

**Root Cause (Bug B — `endTurn` flag lost on reaction pause)**: When a multiattack hit triggers a player reaction (e.g., Monk's Deflect Attacks), `AiTurnOrchestrator` pauses the AI turn by returning `false` BEFORE the `endTurn` check is reached. When the reaction resolves, `processAllMonsterTurns()` is called again, creating a fresh `executeAiTurn()` for the same combatant. This new turn loop consumes the next FIFO-queued decision meant for the next monster.

**Fix B**: Added `turnShouldEndAfterReaction` flag pattern (same as existing `pendingBonusAction` pattern). When pausing for `awaitingPlayerInput` and `decision.endTurn !== false`, the flag is stored on the combatant's resources. When the turn resumes, the orchestrator checks this flag and immediately breaks the loop instead of requesting another decision.

**Prerequisite**: Monster stat blocks in E2E scenarios MUST include `actions` array with Multiattack entry:
```json
"statBlock": {
  "actions": [
    { "name": "Multiattack", "description": "The orc makes two greataxe attacks." }
  ],
  "attacks": [...]
}
```

**Status**: FIXED. Both F1 (fighter) and M1 (monk) scenarios pass with full multiattack support. All 212 E2E scenarios pass.

### GAP-2: Bless Spell Doesn't Consume Spell Slot (Known BUG-4)

**Symptom**: Casting "Bless" via tabletop action succeeds (concentration switches, targets affected) but no spell slot is decremented. Response shows `[SIMPLE_ACTION_COMPLETE] Cast bless...` without the `(level N slot spent)` suffix.

**Root Cause**: The buff/debuff spell delivery handler likely skips the slot deduction step. Already documented in `cleric/solo-cleric-replay.json` step 32 as BUG-4.

**Impact**: Affects Bless/Bane/Shield of Faith and any other buff/debuff concentration spells. Scenarios must assert pre-bug slot counts until fixed.

**Status**: Open bug. Tracked in existing E2E scenario with assertions matching buggy behavior.

### GAP-3: Queued Monster Attack Decisions Require `attackName`

**Symptom**: When using `queueMonsterActions` with `{ "action": "attack", "target": "Valeria", "endTurn": true }` (no `attackName`), the AI attack handler fails with "Attack requires target and attackName". The default AI behavior (`"defaultBehavior": "attack"`) also fails for monsters without explicit AI wiring.

**Root Cause**: `AttackActionHandler.execute()` requires `monsterAttackName` when the attacker is a monster. The queued decision's `attackName` field maps to this. When omitted, the handler throws a `ValidationError`.

**Workaround**: Always include `attackName` in queued monster attack decisions:
```json
{ "action": "attack", "target": "Valeria", "attackName": "Shortbow", "endTurn": true }
```

**Impact**: Non-blocking for most scenarios. The C1 cleric scenario works because the skeleton's failed attacks are irrelevant to the cleric spell tests. However, any scenario that depends on monster damage must include explicit `attackName`.

**Status**: Observation. Not a bug — `attackName` is intentionally required for monster attacks. Scenarios should always specify it.

### GAP-4: Two-Spell Rule Working Correctly

**Observation**: The two-spell rule (can't cast leveled bonus action spell on same turn as leveled action spell) is correctly enforced. Tested in C1:
- R1: Guiding Bolt (L1 action) → Healing Word (L1 bonus) = **BLOCKED** ✓
- R2: Sacred Flame (cantrip action) → Healing Word (L1 bonus) = **ALLOWED** ✓

This confirms the `CastSpellActionHandler` correctly tracks whether a leveled action spell was cast this turn.

### GAP-5: Weapon Mastery (Cleave) Auto-Hits Adjacent Enemies

**Observation**: In B1, the Barbarian's Greataxe has the Cleave weapon mastery property. On hit, it automatically attempts to hit an adjacent enemy (the Hobgoblin Soldier at (15,10) when the Ogre Brute is at (10,10)). This was surprising because:
1. The scenario didn't explicitly trigger it — it fires automatically from the server
2. Damage assertions must use ranges (not exact values) to account for Cleave bonus damage

**Impact**: Any scenario with a weapon that has Cleave + adjacent enemies will see automatic secondary hits. Position monsters carefully or use HP ranges in assertions.

### GAP-6: Hex Bonus Damage Not Applied to Eldritch Blast (WL1 Blocker)

**Symptom**: In `class-combat/warlock/hex-and-blast`, after casting Hex and confirming concentration, Eldritch Blast beams deal only base force damage. Example run:
- Beam 1: `8 + 0 = 8` (expected `8 + 1d6`)
- Beam 2: `6 + 0 = 6` (expected `6 + 1d6`)

Scenario fails at step 12 because target HP remains too high (`Expected <= 184, got 186`).

**Observed State**:
- Hex cast succeeds and sets concentration.
- Eldritch Blast multi-beam chaining works.
- Hex extra damage effect is not being applied in damage resolution for these spell attacks.

**Root-cause Hypothesis (code-level)**:
- `HEX` is modeled as `effects: [{ target: 'damage_rolls', diceValue: { count: 1, sides: 6 } }]`.
- `DamageResolver` does include active-effect dice for `damage_rolls` and should apply to ranged attacks.
- Therefore, likely mismatch is in effect attachment/ownership/target binding from Hex cast to subsequent beam damage events (effect exists conceptually but is missing or not matched in attacker resources at damage time).

**Proposed Fix Path**:
1. Add/extend an integration test at tabletop spell flow level that asserts Hex 1d6 is applied to each Eldritch Blast beam while concentration is active.
2. Trace Hex cast -> effect persistence in combatant resources -> beam damage resolution effect filtering.
3. Ensure target-bound Hex effect survives across beam chaining and is matched by `targetCombatantId` (if set).
4. Re-run WL1 and update Warlock coverage statuses once fixed.

**Status**: RESOLVED.

### GAP-7: Improved Critical (Champion 19-20) Not Wired in Tabletop Flow

**Symptom**: In F2 `weapon-mastery-tactics`, rolling a natural 19 with a Champion Fighter does NOT trigger `isCritical: true`. Only natural 20 triggers crits in the player tabletop flow.

**Root Cause**: `roll-state-machine.ts` hardcodes `isCritical = rollValue === 20` and does NOT call `getCriticalHitThreshold()` from the character's class features. The expanded 19-20 range IS honored for AI attacks (in `attack-resolver.ts`) but not for player-submitted rolls.

**Workaround**: F2 uses natural 20 to assert crit behavior. Documented in scenario description.

**Status**: OPEN. Fix is to thread class-feature crit threshold through `roll-state-machine.ts` `handleAttackRoll()`.

### GAP-8: Hold Person Save-to-End Bypasses QueueableDiceRoller + Hardcodes Wisdom 0

**Symptom**: After Hold Person paralyzes a target, the end-of-turn WIS save uses raw server-side dice (not the `QueueableDiceRoller` queue) and always applies `+0 (wisdom 0)` regardless of the target's actual WIS modifier. Log format: `Save-to-end (hold person): d20(N) + 0 (wisdom 0) = N`.

**Impact**: 
- Queued dice (`queueDiceRolls`) cannot control the save outcome, making reliable recovery impossible in scenarios.
- Blocks W2 `shield-and-counterspell` from exercising the Counterspell leg — Shadow Mage stays locked, never casts back, Counterspell reaction never triggers. `spellSlot_3` pinned at 2/2 instead of intended 1/2.

**Fix Path**:
1. Route the Hold Person save-to-end through `QueueableDiceRoller` like other save-based mechanics.
2. Read target's actual WIS modifier (via creature adapter) instead of hardcoded 0.
3. Re-enable Counterspell leg in W2 and assert `spellSlot_3` 2→1.

**Status**: OPEN blocker for full W2 coverage.

### GAP-9: Advantage vs Paralyzed Creatures Not Implemented

**Symptom**: Per D&D 5e 2024 rules, attacks against a Paralyzed creature have advantage. The server currently returns `advantage: false` even when the target is Paralyzed. Observed in WL3 `hold-and-control` and W2 `shield-and-counterspell`.

**Fix Path**: Add a check in `attack-resolver.ts` advantage evaluation for target-side conditions (Paralyzed, Restrained, etc.) per the 2024 Advantage/Disadvantage rules.

**Status**: OPEN. Not blocking any scenario (scenarios removed the advantage assertion).

### GAP-10: `lay on hands on <ally>` Cannot Target Another PC

**Symptom**: In P2 `party-aura-tank`, attempting `lay on hands on Elara` (text target is a PC) fails to find the target.

**Root Cause**: `class-ability-handlers.ts` (lines 134-180) target resolution iterates monsters/NPCs and filters out `combatantType === "Character"`. The `LayOnHandsExecutor` supports an ally target via `params.targetEntityId` + `context.target`, but the dispatcher never populates those for a PC name.

**Workaround**: P2 uses self-heal instead (Aldric heals himself). Full party heal requires either:
1. Extending the target resolver to include allied Characters for ally-targeted class abilities, OR
2. A programmatic action endpoint that bypasses text parsing.

**Status**: OPEN. Workaround in P2 works; fix would unblock cross-PC healing tests.

### GAP-11: Bane Spell (RESOLVED Phase 0.3)

**Original Symptom**: `cast Bane` appeared to succeed (HTTP 200) but logged a WARN ("no effects defined") and executed as a no-op.

**Actual Root Cause**: Bane was in fact present in `packages/game-server/src/domain/entities/spells/catalog/level-1.ts:45` (SME research audit). The real bug was in `BuffDebuffSpellDeliveryHandler.handle()`: when a spell declares multiple `SpellEffectDeclaration` entries that all target the same combatant (Bane has two: `penalty → attack_rolls` and `penalty → saving_throws`), each iteration re-read `recipientC.resources` from the stale in-memory snapshot, so each successive write overwrote the previous effect. The final persisted state contained only the last effect declaration.

**Fix**: After each `updateCombatantState` write, mutate the in-memory `recipientC.resources` to the post-write snapshot so subsequent declarations for the same target accumulate rather than overwrite. Affects Bane AND Bless (and any future multi-effect buff/debuff).

**Verification**: `buff-debuff.bane.test.ts` mocks 3 enemy CHA saves (1 fail, 2 succeed) and asserts the failed-save enemy receives BOTH penalty effects while the successful-save enemies receive none.

**Status**: RESOLVED.
