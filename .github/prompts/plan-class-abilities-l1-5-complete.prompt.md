# Plan: Complete Class Abilities L1-5 + E2E Test Coverage
## Round: 1
## Status: IN_PROGRESS — Phase 0 complete (238/238 E2E, 1876 unit tests passing)
## Affected Flows: ClassAbilities, SpellSystem, CombatRules, CombatOrchestration, Testing

## Objective
Deliver full implementation + E2E coverage of every D&D 5e 2024 class ability (and class-essential spell) for levels 1-5 across all 12 classes. Tests MUST fail when a feature is broken or missing, so the suite doubles as a regression net. The plan is built from three SME research briefs:

- [sme-research-ClassAbilities.md](../plans/sme-research-ClassAbilities.md)
- [sme-research-SpellSystem-catalog-audit.md](../plans/sme-research-SpellSystem-catalog-audit.md)
- [sme-research-CombatRules.md](../plans/sme-research-CombatRules.md)

## Current Baseline (from `class-combat/COVERAGE.md`)
- **Covered (8 classes, 27 scenarios)**: Fighter, Monk, Rogue, Wizard, Barbarian, Cleric, Paladin, Warlock
- **Uncovered (4 classes)**: **Bard, Druid, Ranger, Sorcerer** — all have executors wired but zero E2E scenarios
- **Known GAPs 6-11** from COVERAGE.md (Hex-on-EB, Improved Crit, Hold Person save-to-end, Advantage vs Paralyzed, LoH on ally, Bane spell)
- **7 new GAPs discovered** in research: 12-18 (Spiritual Weapon loop, Favored Enemy free-cast, Fighting Style passives, Arcane Recovery spend, Cunning Strike 2024, Subclass framework gap, Expertise missing)

## Top-Level Strategy
1. **Fix the foundation first** — rules-layer + dispatcher bugs that class scenarios would trip over (save-to-end primitive, ally-target dispatch, auto-crit casing, tabletop crit threshold, Hex rider).
2. **Fill the subclass framework gap** — 7 classes have no `SubclassDefinition` exports; add at least shell definitions so scenarios can set `subclassId`.
3. **Implement missing class features in priority order** — start with features that are either NEW in 2024 (Cunning Strike) or part of an already-tested class (Fighting Style, Arcane Recovery) so existing scenarios gain depth.
4. **Add the 4 missing-class E2E suites** (Bard, Druid, Ranger, Sorcerer) — 3 scenarios each = 12 new scenarios, mirroring the existing solo + party + resource-depletion pattern.
5. **Extend scenarios for the NEW features** — add one scenario per new feature (Fighting Style aura, Cunning Strike, Spiritual Weapon loop, etc.) to the matching existing class folder.

---

## Phased Execution

### Phase 0 — Foundations (blocks everything else)
Bugs/gaps in this phase must ship before any new class scenario to avoid brittle workarounds.

#### 0.1 Rules-layer primitives (CombatRules flow)
- [x] Add generic `ActiveEffect.saveToEnd` primitive + end-of-turn processor — primitive shipped at `domain/rules/save-to-end.ts` with 8 unit tests. End-of-turn hook already exists at `combat-service.ts::processActiveEffectTiming` using `this.diceRoller`; migration deferred.
- [x] Fix `isAutoCriticalHit` casing bug — title-case `"Paralyzed"`/`"Unconscious"` + regression test.
- [x] Wire Danger Sense ActiveEffect creation — installed at combat start via new `domain/rules/class-startup-effects.ts` for Barbarian L2+.
- [x] Movement speed stacking — Monk L2 Unarmored Movement (+10 ft) + Barbarian L5 Fast Movement (+10 ft) wired via `class-startup-effects.ts`, consumed by existing `getEffectiveSpeed()`. Armor gating noted as follow-up.
  - **Note**: Fix 4 armor-gating (Barb Fast Movement requires no heavy armor, Monk Unarmored Movement requires no armor/shield) is not enforced — follow-up when a heavy-armor Barbarian scenario surfaces.

#### 0.2 Dispatcher / orchestration fixes (CombatOrchestration flow)
- [x] GAP-7 — Tabletop crit threshold already implemented in `roll-state-machine.ts#L472-L488`. Added 9-case test `roll-state-machine.improved-crit.test.ts` to lock it in.
- [x] GAP-10 — Ally-target flow was mostly wired; fixed one residual gap (hostile-name falling through to monster scan). 3-case test `class-ability-handlers.ally-target.test.ts`.
- [x] GAP-6 — Hex-on-EB works end-to-end. `warlock/hex-and-blast.json` scenario passes 20/20. Locked in with 3-case `buff-debuff.hex.test.ts`.

#### 0.3 Spell catalog fixes (SpellSystem flow)
- [x] GAP-11/GAP-BANE — Real root cause found: `BuffDebuffHandler` write was overwriting effects between declarations because it re-read stale state. Fixed by mutating in-memory `recipientC.resources` after each write. Test: `buff-debuff.bane.test.ts` (1 case). COVERAGE.md updated: GAP-11 marked RESOLVED.
- [x] `on_next_weapon_hit` rider extension — `ActiveEffect.triggerAt` + `SpellEffectDeclaration.triggerAt` extended; `hit-rider-resolver.ts::assembleOnHitEnhancements` consumes caster riders, emits synthetic `HitRiderEnhancement` with bonusDice + optional save-on-damage. Test: `hit-rider-resolver.next-hit-rider.test.ts` (4 cases). Co-exists with Divine Smite keyword path.
  - **Limitation noted**: Bane handler still supports only single target name via `castInfo.targetName` — multi-target (up to 3, 2024 RAW) requires scenario/CLI parser work; flagged as Phase 4 follow-up.

---

### Phase 1 — Subclass Framework Fill (GAP-17)
7 classes have no `SubclassDefinition` exports. Add shells so `subclassId` in scenarios doesn't silently fall back to a non-subclassed character.

- [ ] Cleric → **Life Domain** shell (`disciple-of-life`, `preserve-life` CD option, L3/5 domain spells list)
- [ ] Paladin → **Oath of Devotion** shell (`sacred-weapon` CD, `holy-nimbus` future, L3/5 oath spells)
- [ ] Warlock → **The Fiend** shell (`dark-ones-blessing` temp HP, L3/5 patron spells)
- [ ] Wizard → **School of Evocation** shell (`sculpt-spells`, `potent-cantrip-L6`, L3/5 school spells)
- [ ] Bard → **College of Lore** shell (`cutting-words` reaction, `additional-magical-secrets-L6`)
- [ ] Druid → **Circle of the Land** shell (`lands-aid` CD, terrain spell list — Grassland)
- [ ] Sorcerer → **Draconic Sorcery (Red)** shell (`draconic-resilience` +HP/+AC13, `elemental-affinity` fire)

Each shell registers in `registry.ts` and may be mostly data + feature-map with executors deferred to Phase 3.

---

### Phase 2 — New E2E Suites for Uncovered Classes
Each class gets 3 scenarios following the established pattern (solo core loop + party synergy + resource depletion). Use `queueMonsterActions` + `queueDiceRolls` for determinism. Target HP bumped to 100-150 on heroes/monsters.

#### Bard (College of Lore) — 3 scenarios
- [ ] `bard/inspiration-support.json` — **party** (Bard + Fighter + Rogue) vs Orc Warchief + Bandit. Tests Bardic Inspiration dice handed out, consumed on ally attacks, Font of Inspiration (L5) refresh on short rest.
- [ ] `bard/cutting-words-control.json` — solo vs Hobgoblin Captain + Gnoll. Tests Cutting Words reaction (subtract Bardic Inspiration die from attack/check/damage) + Vicious Mockery cantrip disadvantage.
- [ ] `bard/spell-suite.json` — solo vs Skeleton Archer + Bandit. Tests Healing Word / Heroism / Hold Person / Suggestion (pending catalog) / Dispel Magic awareness.

#### Druid (Circle of the Land) — 3 scenarios
- [ ] `druid/wild-shape-combat.json` — solo vs 2× Gnoll. Tests Wild Shape transform (beast form HP override, attack swap) + revert on HP=0 / bonus action.
- [ ] `druid/nature-control.json` — solo vs 3× Goblin. Tests Entangle (Restrained, STR save-to-end) + Spike Growth (difficult terrain damage) + Moonbeam (concentration zone + repeat CON save).
- [ ] `druid/party-support.json` — **party** (Druid + Fighter + Ranger) vs Ogre + Bandit. Tests Pass Without Trace aura + Healing Word + Call Lightning.

#### Ranger (Hunter, Colossus Slayer) — 3 scenarios
- [ ] `ranger/hunters-mark-colossus.json` — solo vs Ogre + Thug. Tests Hunter's Mark rider + Colossus Slayer bonus damage on wounded target + mark transfer on kill (2024 rule).
- [ ] `ranger/favored-enemy-slot-economy.json` — solo vs Orc + Gnoll. Tests Favored Enemy pool spent for free Hunter's Mark (GAP-13 fix) vs slot-cast fallback.
- [ ] `ranger/party-scout.json` — **party** (Ranger + Rogue + Cleric) vs Hobgoblin Captain + 2× Hobgoblin. Tests Ensnaring Strike on-hit rider + Pass Without Trace + Extra Attack.

#### Sorcerer (Draconic Red) — 3 scenarios
- [ ] `sorcerer/metamagic-burst.json` — solo vs 3× Skeleton. Tests Quickened Spell (Fireball as bonus) + Twinned Scorching Ray + Sorcery Point spend.
- [ ] `sorcerer/draconic-resilience.json` — solo vs Ogre + Bandit. Tests Draconic Resilience (AC 13 + DEX, +HP per level) + Elemental Affinity (fire cantrip +CHA damage).
- [ ] `sorcerer/slot-sp-conversion.json` — solo vs Hobgoblin + Goblin. Tests Sorcery Points ↔ Spell Slots conversion (Flexible Casting) across rounds.

---

### Phase 3 — New-Feature Implementation + Scenarios

Each sub-item is a feature implementation AND a scenario (or assertion addition to an existing scenario) that fails until the feature lands.

#### 3.1 Fighting Style passives (GAP-14)
- [ ] Implement Defense (+1 AC), Dueling (+2 dmg one-handed melee), GWF (reroll 1s/2s on two-handed weapon dice), Archery (+2 attack ranged), TWF (ability mod to offhand), Protection (reaction), Interception (reaction).
  - Location: `domain/entities/classes/fighting-style.ts` + hit-rider-resolver + AC computation pipeline.
- [ ] Extend `fighter/tank-vs-resistance.json` to assert AC 20 from Defense formula (not hardcoded).
- [ ] New scenario `fighter/fighting-style-comparison.json` — 4-round setup using each style variant in succession.

#### 3.2 Cunning Strike (Rogue L5, 2024 GAP-16)
- [ ] Implement SA-die-for-effect trade-off: Poison (CON save or Poisoned), Trip (DEX save or Prone), Withdraw (bonus Disengage).
  - Location: new executor + damage-resolver SA-dice spend hook.
- [ ] New scenario `rogue/cunning-strike.json` — solo vs Bandit + Thug, tests all 3 variants across rounds.

#### 3.3 Spiritual Weapon persistent attack (GAP-12)
- [ ] Implement summoned-entity lite: on cast, install a "bonus-action spell attack" rider on caster; each subsequent turn, `bonus: spiritual weapon attack` consumes the bonus action and rolls a spell attack.
- [ ] New scenario `cleric/spiritual-weapon-loop.json` — solo vs Ogre + Thug, 4 rounds exercising attack each round.

#### 3.4 Arcane Recovery spend path (GAP-15)
- [ ] Implement short-rest action `wizard arcane recovery` that refunds slot levels up to `ceil(level/2)` using `arcaneRecovery` pool.
- [ ] Extend `wizard/spell-slot-economy.json` to include mid-fight short rest + arcane recovery, then more casting.

#### 3.5 Cleric Life-Domain Disciple of Life
- [ ] Implement `+2 + slot level` bonus HP on heal spells when caster has Life subclass.
- [ ] Extend `cleric/party-healer.json` to assert boosted healing magnitude.

#### 3.6 Paladin smite spell kit (depends on Phase 0.3 rider extension)
- [ ] Add Searing Smite, Thunderous Smite, Wrathful Smite, Divine Favor, Branding Smite to spell catalog as `nextHitRider` spells.
- [ ] New scenario `paladin/smite-spell-kit.json` — solo vs Fiend + Zombie, casts each smite spell across rounds.

#### 3.7 Warlock Fiend subclass + Hex rider fix (depends on Phase 0.2 GAP-6)
- [ ] Implement Dark One's Blessing (temp HP on kill = CHA+warlockLevel).
- [ ] Implement Agonizing Blast invocation (+CHA to each EB beam damage).
- [ ] Revive `warlock/hex-and-blast.json` — assert Hex bonus damage applied + Agonizing Blast adds CHA + Dark One's Blessing temp HP on kill.

#### 3.8 Ranger Hunter's Lore + Colossus Slayer
- [ ] Implement Colossus Slayer bonus 1d8 damage vs wounded targets once/turn.
- [ ] Covered by `ranger/hunters-mark-colossus.json` from Phase 2.

#### 3.9 Bard Cutting Words + Magical Inspiration
- [ ] Implement Cutting Words as a reaction that subtracts a Bardic Inspiration die from an enemy's attack roll / damage / ability check within 60ft.
- [ ] Covered by `bard/cutting-words-control.json` from Phase 2.

#### 3.10 Sorcerer Metamagic breadth
- [ ] Implement Careful/Distant/Empowered/Extended/Heightened/Subtle (add 6 missing options). Quickened + Twinned already exist.
- [ ] Extend `sorcerer/metamagic-burst.json` to assert each option's effect on cast payload.

---

### Phase 4 — Spell Catalog Expansion
Add spells that multiple classes need but are absent.

- [ ] Paladin smite-spell family (Searing, Thunderous, Wrathful, Branding, Divine Favor) — Phase 3.6 prerequisite
- [ ] Druid: Entangle, Pass Without Trace, Goodberry, Call Lightning, Summon Beast (scoped summon)
- [ ] Wizard/Sorcerer: Mirror Image, Haste, Fly, Hypnotic Pattern
- [ ] Warlock: Armor of Agathys (temp HP + retaliation)
- [ ] Bard: Suggestion, Hypnotic Pattern, Mass Healing Word
- [ ] Ranger: Ensnaring Strike, Hail of Thorns, Pass Without Trace (shared with Druid)

Each spell gets catalog entry + unit test + one scenario assertion.

---

### Phase 5 — Deferred / Out of Scope (document but don't build now)
- Spiritual Weapon full summon-entity architecture (Phase 3.3 uses lite version)
- Counterspell / Silvery Barbs / Absorb Elements generalised reaction-spell routing (existing case-by-case implementations suffice for L1-5)
- Druid Wild Shape full CR-scaled beast forms (L5 uses 2024 fixed forms)
- Paladin Aura of Protection (L6)
- Sorcerer Mystic Arcanum (L11+)
- Warlock Mystic Arcanum (L11+)
- Bard Magical Secrets (L10)

---

## Cross-Flow Risk Checklist
- [ ] Does adding `saveToEnd` primitive break existing Hold Person / Stunned end-of-turn hooks? — audit current stun-end path and migrate.
- [ ] Does fixing `isAutoCriticalHit` casing break existing auto-crit tests? — verify stubs use title-case conditions.
- [ ] Does the crit-threshold change in tabletop flow affect existing F2 `weapon-mastery-tactics` nat-20 assertion? — F2 keeps a nat-20 step; add nat-19 step for Champion.
- [ ] Does the `on_next_weapon_hit` rider extension interact with existing Divine Smite pipeline? — smite uses explicit keyword; new rider type separate. Co-existence required; unit test both active.
- [ ] Does Bard Cutting Words reaction integrate with two-phase reaction system? — must use `attackReactions` on ClassCombatTextProfile pattern.
- [ ] Subclass shells must register in `registry.ts` → `getAllCombatTextProfiles()` automatic pickup.
- [ ] Repo interfaces + memory-repos updated? — N/A (no new entity shapes).
- [ ] `app.ts` executor registration updated? — YES for every new executor (Cunning Strike, Fighting Style reaction handlers, Spiritual Weapon loop, Arcane Recovery, Metamagic variants, Cutting Words).
- [ ] D&D 5e 2024 rules correct? — Ranger Favored Enemy = free Hunter's Mark uses (2024 change from 2014 bonus damage), Cunning Strike is 2024-new, Paladin smite is 2024 bonus-action.

## Risks
- **Scope risk** — 12 scenarios + 15+ implementations + rules-layer primitive = multi-week effort. Mitigation: explicit phase gates, user direction on phase ordering before execution.
- **Subclass framework churn** — 7 new subclass definitions may expose registry/normalization edge cases. Mitigation: start with one (Life Cleric), run full test suite, then parallelise.
- **`saveToEnd` primitive regression** — migrating Stunned/Paralyzed end-of-turn logic risks breaking M2/WL3. Mitigation: keep old code path active behind feature flag until new one passes all scenarios, then remove.
- **Hex rider (GAP-6) root cause unlocalised** — need runtime trace. Mitigation: failing unit test first, bisect between patch sites.
- **E2E scenario complexity growth** — multi-PC 5-round party scenarios are fragile. Mitigation: per-round `assertState` + existing determinism primitives (queueDiceRolls, queueMonsterActions).

## Test Plan
<!-- IMPORTANT: Each item below is a TEST CODE AUTHORSHIP task. Dispatch VitestWriter / E2EScenarioWriter or write directly. -->

### Phase 0 tests
- [ ] Unit: `save-to-end.test.ts` — save-to-end primitive with QueueableDiceRoller
- [ ] Unit: `attack-resolver.test.ts` — add cases for title-case `Paralyzed`/`Unconscious` triggering auto-crit
- [ ] Unit: `danger-sense.test.ts` — ActiveEffect creation at L2 Barbarian rage activation
- [ ] Unit: `hex-rider.test.ts` — cast Hex, assert caster activeEffects contains diceValue{1,6}
- [ ] Unit: `bane-save-on-cast.test.ts` — Bane on 3 targets with forced mixed saves

### Phase 1 tests
- [ ] Unit: `subclass-framework.test.ts` — add cases for each of 7 new subclass shells

### Phase 2 tests (E2E scenarios)
- [ ] E2E: `bard/inspiration-support.json` (party)
- [ ] E2E: `bard/cutting-words-control.json`
- [ ] E2E: `bard/spell-suite.json`
- [ ] E2E: `druid/wild-shape-combat.json`
- [ ] E2E: `druid/nature-control.json`
- [ ] E2E: `druid/party-support.json` (party)
- [ ] E2E: `ranger/hunters-mark-colossus.json`
- [ ] E2E: `ranger/favored-enemy-slot-economy.json`
- [ ] E2E: `ranger/party-scout.json` (party)
- [ ] E2E: `sorcerer/metamagic-burst.json`
- [ ] E2E: `sorcerer/draconic-resilience.json`
- [ ] E2E: `sorcerer/slot-sp-conversion.json`

### Phase 3 tests (feature scenarios)
- [ ] E2E: `fighter/fighting-style-comparison.json`
- [ ] E2E: `rogue/cunning-strike.json`
- [ ] E2E: `cleric/spiritual-weapon-loop.json`
- [ ] Scenario update: `wizard/spell-slot-economy.json` (arcane recovery)
- [ ] Scenario update: `cleric/party-healer.json` (Disciple of Life bonus)
- [ ] E2E: `paladin/smite-spell-kit.json`
- [ ] E2E: `warlock/hex-and-blast.json` (revive, fully passing)
- [ ] Scenario update: `sorcerer/metamagic-burst.json` (all 8 metamagic options)

### Phase 4 tests (catalog)
- [ ] Per-spell catalog unit test for each new spell in Phase 4.

## SME Approval
- [ ] ClassAbilities-SME
- [ ] SpellSystem-SME
- [ ] CombatRules-SME
- [ ] CombatOrchestration-SME
