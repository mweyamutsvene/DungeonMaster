# Plan: Complete Class Abilities L1-5 + E2E Test Coverage
## Round: 1
## Status: IN_PROGRESS — Phase 0 ✅, Phase 1 ✅, Phase 2 ✅, Phase 3 PARTIAL
## Affected Flows: ClassAbilities, SpellSystem, CombatRules, CombatOrchestration, Testing

## 🔖 Resume Checkpoint (last update: session paused after Phase 3 rate limit)

**Last verified (post Phase-3b session)**: typecheck clean · 1931 unit tests passing · **241/250 E2E passing** (9 failing) — up from 238/250.

**Newly fixed this session (Phase 3b)**:
- ✅ druid/wild-shape-combat — Wild Shape temp HP write, revert-wildshape executor + parser ordering (commit fbe4254)
- ✅ sorcerer/draconic-resilience — Elemental Affinity hook in damage-resolver + ancestry helper (commit c06e6a6)
- ✅ ranger/hunters-mark-colossus — Colossus Slayer once/turn rider + move-hunters-mark executor/parser (commit c06e6a6)
- ➕ sorcerer Quickened Spell chains into cast as bonus action, bypasses two-spell rule (commit 69d607f)
- ➕ ranger Favored Enemy pool is spent in place of L1 slot when casting Hunter's Mark (commit 61d292d)
- ➕ bard Bardic Inspiration executor flagged `allowsAllyTarget` (commit 61d292d)

**Still failing (9)**:
- `bard/cutting-words-control` (6/17) → 3.9 Cutting Words reaction (NOT STARTED)
- `bard/inspiration-support` (10/35) → ally-target resolved; next block is multi-PC `waitForTurn`
- `bard/spell-suite` (11/22) → Heroism timing + Hold Person tick
- `core/party-vs-goblins` (6/10)
- `druid/nature-control` (9/31) → Entangle / Spike Growth / Moonbeam
- `druid/party-support` (8/44) → Pass Without Trace aura + Call Lightning
- `ranger/favored-enemy-slot-economy` (11/33) → partial; remaining blocked by EA auto-chain on dead target
- `ranger/party-scout` (34/39) → Ensnaring Strike rider + Pass Without Trace
- `sorcerer/metamagic-burst` (10/37) → still needs Scorching Ray multi-ray + Twinned
- `sorcerer/slot-sp-conversion` (14/26) → Flexible Casting parser (NOT STARTED)

**Completed this session**:
- Phase 0: saveToEnd primitive + casing fix + Danger Sense + speed stacking + GAP-6/7/10 lock-in tests + GAP-11 Bane fix + `on_next_weapon_hit` rider mechanism (+9 test files, +45 cases).
- Phase 1: 7 subclass shells (Life Cleric, Oath of Devotion, Fiend Warlock, Evocation Wizard, Lore Bard, Circle of Land Druid, Draconic Red Sorcerer) + 19 feature-keys + INNATE_SORCERY at L1 + 32 new tests.
- Phase 2: 12 E2E scenarios authored (Bard/Druid/Ranger/Sorcerer × 3), all intentionally failing at specific feature gaps that drive Phase 3.
- Phase 3 partial (one agent, rate-limited mid-batch):
  - 3.1 Fighting Styles: Archery/Defense/Dueling/TWF offhand done; GWF + Protection/Interception deferred.
  - 3.2 Cunning Strike: groundwork only (feature-key + L5 gate).
  - 3.5 Disciple of Life: COMPLETE.
  - 3.11 Draconic Resilience: `class-feature-enrichment.ts` created (needs wire-in verification).
  - 3.12 Catalog expansion: partial (cantrips + L1/L2/L3 expansion + Wild Shape + buff-debuff + ranger + healing handler edits present, need verification).

**Next actions in order** (when resuming):
1. Commit current uncommitted state.
2. Run `test:e2e:combat:mock -- --all` to snapshot current pass count and identify which Phase 2 scenarios now pass.
3. Dispatch remaining Phase 3 work in priority order:
   - 3.12 VERIFY: Wild Shape temp HP write, Ranger Favored Enemy pool, catalog stubs (Entangle, Pass Without Trace, Ensnaring Strike, Vicious Mockery, Heroism, Moonbeam, Spike Growth, Call Lightning).
   - 3.2 Cunning Strike executor + SA-die deduction.
   - 3.8 Colossus Slayer (once/turn +1d8 wounded).
   - 3.3 Spiritual Weapon loop.
   - 3.4 Arcane Recovery.
   - 3.6 Paladin smite kit (needs `on_next_weapon_hit` rider from Phase 0.3).
   - 3.7 Fiend Warlock Dark One's Blessing + Agonizing Blast.
   - 3.9 Bard Cutting Words reaction.
   - 3.10 Sorcerer Metamagic breadth (6 missing).
   - 3.11 finish: Elemental Affinity + Flexible Casting.
4. Phase 4 remaining spell catalog.
5. Final verify + cleanup of `.github/plans/sme-research-*.md` + `sme-feedback-*.md`.

**Files modified (uncommitted at checkpoint)**: see `git status` \u2014 roll-state-machine, damage-resolver, healing-spell-delivery-handler, buff-debuff-spell-delivery-handler, wild-shape-executor, character-service, feature-keys, fighting-style, ranger, rogue, spells catalog/cantrips/level-1/-2/-3, prepared-spell-definition, new file `class-feature-enrichment.ts`.

---

## Affected Flows Detail

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
- [x] Druid → **Circle of the Land** shell (`lands-aid` CD, terrain spell list — Grassland)
- [x] Sorcerer → **Draconic Sorcery (Red)** shell (`draconic-resilience` +HP/+AC13, `elemental-affinity` fire)

Phase 1 complete: 7 subclass shells + 19 new `feature-keys` constants + 32 new tests (1908 total passing). INNATE_SORCERY added to base Sorcerer L1.

---

### Phase 2 — New E2E Suites for Uncovered Classes
Each class gets 3 scenarios following the established pattern (solo core loop + party synergy + resource depletion). Use `queueMonsterActions` + `queueDiceRolls` for determinism. Target HP bumped to 100-150 on heroes/monsters.

#### Bard (College of Lore) — 3 scenarios
- [x] `bard/inspiration-support.json` — fails at step 11 (BI target parsing bug + Vicious Mockery stub). Drives fix.
- [x] `bard/cutting-words-control.json` — fails at step 7 (Cutting Words reaction not implemented). Drives Phase 3.9.
- [x] `bard/spell-suite.json` — fails at step 6 (Heroism temp HP RAW timing — applies at start of turn not on cast).

#### Druid (Circle of the Land) — 3 scenarios
- [x] `druid/wild-shape-combat.json` — fails at step 7 (Wild Shape executor logs "25 temp HP" but doesn't write resources).
- [x] `druid/nature-control.json` — fails at step 8 (Entangle catalog stub — no effects).
- [x] `druid/party-support.json` — fails at step 7 (Pass Without Trace catalog stub).

#### Ranger (Hunter, Colossus Slayer) — 3 scenarios
- [x] `ranger/hunters-mark-colossus.json` — fails at step 25 (mark-transfer-on-kill parser missing + Colossus Slayer bonus damage not firing).
- [x] `ranger/favored-enemy-slot-economy.json` — fails at step 8 (Favored Enemy pool not routed as free Hunter's Mark).
- [x] `ranger/party-scout.json` — fails at step 6 (Pass Without Trace stub + Ensnaring Strike blocked behind it).

#### Sorcerer (Draconic Red) — 3 scenarios
- [x] `sorcerer/metamagic-burst.json` — fails at step 9 (Quickened doesn't chain inner cast).
- [x] `sorcerer/draconic-resilience.json` — fails at step 5 (Draconic Resilience +HP not applied to sheet hydration).
- [x] `sorcerer/slot-sp-conversion.json` — fails at step 15 (Flexible Casting parser missing).

Phase 2 complete: 12 scenarios, all failing at intended feature gaps per user directive — drives Phase 3 implementation.

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

#### 3.6 Paladin smite spell kit (depends on Phase 0.3 rider extension) — NOT STARTED
- [ ] Add Searing, Thunderous, Wrathful, Branding, Divine Favor smite spells using `on_next_weapon_hit` rider (Phase 0.3 mechanism).
- [ ] New scenario `paladin/smite-spell-kit.json`.

#### 3.7 Warlock Fiend subclass + Hex rider fix — NOT STARTED
- [ ] Dark One's Blessing (temp HP on kill).
- [ ] Agonizing Blast (+CHA to each EB beam).
- [ ] Revive `warlock/hex-and-blast.json` assertions.

#### 3.8 Ranger Colossus Slayer — NOT STARTED
- [ ] Implement Colossus Slayer bonus 1d8 once/turn vs wounded.
- [ ] Coverage by `ranger/hunters-mark-colossus.json` (already authored in Phase 2).

#### 3.9 Bard Cutting Words + Magical Inspiration — NOT STARTED
- [ ] Implement Cutting Words reaction (attack/check/damage subtract BI die).
- [ ] Coverage by `bard/cutting-words-control.json`.

#### 3.10 Sorcerer Metamagic breadth — NOT STARTED
- [ ] Implement Careful/Distant/Empowered/Extended/Heightened/Subtle.
- [ ] Extend `sorcerer/metamagic-burst.json`.

#### 3.11 Sorcerer subclass mechanics (Draconic Red) — PARTIAL
- [x] `class-feature-enrichment.ts` created — applies Draconic Resilience +1 HP/sorcerer-level + unarmored AC = 13 + DEX to sheet at creation time.
- [ ] Wire `enrichSheetClassFeatures` into `character-service.ts` create path (may already be wired — needs verification).
- [ ] Elemental Affinity (L5 fire +CHA once/round).
- [ ] Flexible Casting SP↔slot parser + handler.

#### 3.12 Spell catalog stubs filled in (surfaced by Phase 2) — PARTIAL
- [x] Some expansion in `cantrips.ts`, `level-1.ts`, `level-2.ts`, `level-3.ts` (catalog.test.ts updated). **Verify coverage**: Vicious Mockery, Entangle, Pass Without Trace, Ensnaring Strike, Heroism, Moonbeam, Spike Growth, Call Lightning.
- [ ] Wild Shape executor: write temp HP to caster resources (currently logs without applying). File: `executors/druid/wild-shape-executor.ts` (modified but needs verification).
- [ ] Buff-debuff spell delivery handler modifications (`buff-debuff-spell-delivery-handler.ts` modified — verify behavior).
- [ ] Ranger spells (`ranger.ts` modified — verify Favored Enemy pool spends for HM).

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
