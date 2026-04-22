# SME Research — ClassAbilities — L1-5 Feature Audit (All 12 Classes)

As you wish Papi....

## Scope
- Read all 12 class domain files in `domain/entities/classes/` (barbarian/bard/cleric/druid/fighter/monk/paladin/ranger/rogue/sorcerer/warlock/wizard)
- Read `feature-keys.ts`, `registry.ts`, and all 10 executor folders under `abilities/executors/`
- Cross-referenced `class-combat/COVERAGE.md` (GAP-1 through GAP-11) and executor registration in `app.ts`
- Verified spell-catalog presence (Hex, Hunter's Mark, Spiritual Weapon)

## Legend
- **I** = IMPLEMENTED (feature-map entry + executor/profile wired + exercised in tests)
- **IU** = IMPLEMENTED-BUT-UNTESTED (code exists, no E2E scenario)
- **P** = PARTIAL (feature-map key only, no executor/profile logic)
- **M** = MISSING (no code at all)
- **§** = GAP documented in COVERAGE.md

---

## Per-Class L1-5 Inventory

### Barbarian (Berserker)
| L | Feature | Status | Scenario | Notes |
|---|---------|--------|----------|-------|
| 1 | Rage | **I** | B1–B3 | `RageExecutor`, profile |
| 1 | Unarmored Defense | **I** | passive | `barbarianUnarmoredDefenseAC` |
| 1 | Weapon Mastery (Cleave) | **I** | B1 §GAP-5 | auto-fires adjacent |
| 2 | Reckless Attack | **I** | B1, B3 | `RecklessAttackExecutor` |
| 2 | Danger Sense | **IU** | — | domain helper only (`isDangerSenseNegated`); advantage-on-DEX-save not wired |
| 3 | Primal Path (Berserker) — Frenzy | **I** | B2 | `FrenzyExecutor` |
| 5 | Extra Attack | **I** | B1–B3 | generic |

### Bard (pick: **Lore**) ⚠ class-combat coverage MISSING
| L | Feature | Status | Scenario | Notes |
|---|---------|--------|----------|-------|
| 1 | Spellcasting (CHA) | **IU** | — | slot progression via `spell-progression` |
| 1 | Bardic Inspiration | **IU** | — | `BardicInspirationExecutor` + profile wired, die/uses helpers OK |
| 2 | Jack of All Trades | **P** | — | feature-map only, no half-prof application in skill checks |
| 2 | Expertise | **M** | — | NOT in features map (feature-keys.ts has no EXPERTISE) |
| 2 | Magical Inspiration (2024) | **M** | — | not modeled |
| 3 | Bard Subclass (Lore/Valor) | **M** | — | `Bard.subclasses` undefined; no Lore/Valor definitions exist |
| 3 | Cutting Words (Lore) | **M** | — | reaction not implemented |
| 3 | Combat Inspiration (Valor) | **M** | — | not implemented |
| 4 | ASI | N/A | — | generic |
| 5 | Font of Inspiration | **I** (data) | — | short-rest refresh in `restRefreshPolicy` |

### Cleric (pick: **Life**)
| L | Feature | Status | Scenario | Notes |
|---|---------|--------|----------|-------|
| 1 | Spellcasting (WIS) | **I** | C1–C4 | |
| 1 | Divine Order (Protector/Thaumaturge, 2024) | **M** | — | not in features map |
| 2 | Channel Divinity pool | **I** | C3 | shared pool `channelDivinity:cleric` |
| 2 | Turn Undead | **I** | C3 | `TurnUndeadExecutor` + queued CON saves |
| 3 | Divine Domain (Life) — Disciple of Life | **M** | — | subclass not defined; bonus heal (2 + slot level) not applied |
| 3 | Life Domain Spells (prepared) | **M** | — | subclass spell list not modeled |
| 5 | Destroy Undead (CR ≤ 1/2) | **I** | C3 | `getDestroyUndeadCRThreshold` |
| 5 | Sear Undead (2024 CD option) | **M** | — | not implemented |
| — | Spiritual Weapon bonus-action attack | **P** §GAP-12 | — | spell in L2 catalog but there's **no bonus-action spell-attack loop** each turn |
| — | Bless slot consumption | **I** §GAP-2 fixed | C2 | slot now decrements |
| — | Bane | **M** §GAP-11 | C2 | spell missing from catalog |

### Druid (pick: **Circle of the Land**) ⚠ class-combat coverage MISSING
| L | Feature | Status | Scenario | Notes |
|---|---------|--------|----------|-------|
| 1 | Spellcasting (WIS) | **IU** | — | |
| 1 | Druidic | N/A | — | RP-only |
| 2 | Wild Shape (2024 standardized forms) | **IU** | — | `WildShapeExecutor`, beast stat-block helpers; never exercised in E2E; attack/HP swap semantics likely untested |
| 2 | Wild Companion | **M** | — | not modeled |
| 3 | Druid Subclass (Circle of the Land/Moon/Sea/Stars) | **M** | — | `Druid.subclasses` undefined |
| 3 | Land's Aid (Circle of the Land) | **M** | — | AoE damage/heal CD option not implemented |
| 3 | Circle Forms (Circle of the Moon) | **M** | — | combat-form CR scaling not implemented |
| 5 | — (3rd-level spells unlocked) | **IU** | — | generic slot progression |

### Fighter (Champion)
| L | Feature | Status | Scenario | Notes |
|---|---------|--------|----------|-------|
| 1 | Fighting Style | **P** | — | feature-map entry; only Protection/Interception reactions have stubbed detect (TODO CO-L5/L6, never wired). Defense/Dueling/GWF/TWF/Archery passives **not mechanically applied** |
| 1 | Weapon Mastery | **I** | F2 | Graze wired |
| 1 | Second Wind | **I** | F1, X1 | |
| 2 | Action Surge | **I** | F1 | |
| 3 | Fighter Subclass (Champion) — Improved Critical | **I** §GAP-7 | F2 | works in AI path; player tabletop hardcodes nat 20 |
| 3 | Remarkable Athlete (Champion) | **P** | — | feature-key defined, no mechanical wiring (STR/DEX/CON check half-prof bonus) |
| 4 | ASI / Feat | N/A | — | |
| 5 | Extra Attack | **I** | F1–F3 | |

### Monk (Way of the Open Hand)
| L | Feature | Status | Scenario | Notes |
|---|---------|--------|----------|-------|
| 1 | Martial Arts | **I** | M1, M4 | |
| 1 | Unarmored Defense | **I** | passive | |
| 2 | Flurry / Patient Defense / Step of the Wind | **I** | M1, M3, M4 | |
| 2 | Uncanny Metabolism (2024) | **IU** | — | resource pool tracked; refresh-ki-on-initiative effect NOT wired in orchestrator |
| 3 | Deflect Attacks | **I** | M1, M3, M4 | |
| 3 | Subclass (Open Hand) — Open Hand Technique | **I** | M1 | attack enhancement |
| 4 | Slow Fall | **M** | — | reaction not implemented |
| 5 | Extra Attack | **I** | M1–M4 | |
| 5 | Stunning Strike | **I** | M2, M4 | |

### Paladin (Oath of Devotion)
| L | Feature | Status | Scenario | Notes |
|---|---------|--------|----------|-------|
| 1 | Lay on Hands | **I** §GAP-10 | P1, P2, X1 | can't target another PC |
| 1 | Spellcasting | **I** | P2 | |
| 1 | Weapon Mastery | **I** | passive | |
| 2 | Fighting Style | **P** | — | same status as Fighter |
| 2 | Divine Smite | **I** | P1, P3 | |
| 3 | Channel Divinity pool | **I** | P3 | Divine Sense only |
| 3 | Paladin Subclass (Devotion) — Sacred Weapon | **M** | — | no executor; CD options: only Divine Sense exists |
| 3 | Devotion Oath Spells | **M** | — | |
| 3 | Divine Sense | **I** | P3 | |
| 4 | ASI | N/A | — | |
| 5 | Extra Attack | **I** | P1–P3 | |
| 5 | Faithful Steed (2024) | **M** | — | summon not modeled |

### Ranger (pick: **Hunter**) ⚠ class-combat coverage MISSING
| L | Feature | Status | Scenario | Notes |
|---|---------|--------|----------|-------|
| 1 | Favored Enemy (free Hunter's Mark, 2024) | **P** | — | `favoredEnemy` pool created but **no spend path** — Hunter's Mark cast still consumes spell slot; no "use FE free" branch |
| 1 | Weapon Mastery | **I** | (via Fighter suite) | generic |
| 1 | Spellcasting (WIS, half-caster from L1 in 2024) | **IU** | — | slot table wired |
| 2 | Deft Explorer / Expertise | **P** | — | feature-map only, no skill check wiring |
| 2 | Fighting Style | **P** | — | same as Fighter |
| 3 | Subclass (Hunter) — Hunter's Lore | **M** | — | `Hunter` subclass defined but features have no executors |
| 3 | Hunter's Prey (Colossus Slayer / Horde Breaker) | **M** | — | bonus damage / extra attack rider not implemented |
| 4 | ASI | N/A | — | |
| 5 | Extra Attack | **I** | — data wiring | |
| — | Hunter's Mark spell | **I** (data) | — | spell in L1 catalog; damage rider works (L1019 damage-resolver) |

### Rogue (Thief)
| L | Feature | Status | Scenario | Notes |
|---|---------|--------|----------|-------|
| 1 | Expertise | **M** | — | not in feature-keys; skill-check DC not boosted |
| 1 | Sneak Attack | **I** | R1–R3 | |
| 1 | Weapon Mastery | **I** | passive | |
| 1 | Thieves' Cant | N/A | — | RP |
| 2 | Cunning Action | **I** | R1–R3 | |
| 3 | Rogue Subclass (Thief) — Fast Hands | **P** | — | feature-map; no Magic Action wiring |
| 3 | Second-Story Work | **P** | — | passive not applied |
| 4 | ASI | N/A | — | |
| 5 | Uncanny Dodge | **I** | R1–R3 | |
| 5 | Cunning Strike (2024) | **M** | — | SA trade-off (Poison/Trip/Withdraw) **not modeled** — NEW 2024 feature |

### Sorcerer (pick: **Draconic Sorcery**) ⚠ class-combat coverage MISSING
| L | Feature | Status | Scenario | Notes |
|---|---------|--------|----------|-------|
| 1 | Spellcasting (CHA) | **IU** | — | |
| 1 | Innate Sorcery (2024) | **M** | — | L1 feature per 2024 — no flag/buff implemented |
| 2 | Sorcery Points | **I** (data) | — | pool created; cannot be converted to slots |
| 2 | Metamagic (Quickened) | **IU** | — | `QuickenedSpellExecutor`, but integration with spell-cast routing likely untested |
| 2 | Metamagic (Twinned) | **IU** | — | `TwinnedSpellExecutor`; probably no multi-target dispatch path |
| 2 | Other Metamagic options (Careful/Distant/Empowered/Extended/Heightened/Subtle) | **M** | — | only 2 of 8 implemented |
| 3 | Sorcerer Subclass (Draconic/Wild Magic/Aberrant/Clockwork) | **M** | — | `Sorcerer.subclasses` undefined |
| 3 | Draconic Resilience (HP+1/level, AC=13+DEX) | **M** | — | |
| 3 | Elemental Affinity | **M** | — | damage-type bonus on cantrip not wired |
| 4 | ASI | N/A | — | |
| 5 | Sorcerous Restoration (regain 4 SP on short rest) | **M** | — | |

### Warlock (Pact of the Fiend)
| L | Feature | Status | Scenario | Notes |
|---|---------|--------|----------|-------|
| 1 | Pact Magic | **I** | WL1–WL3 | |
| 1 | Eldritch Invocations (2024: gain at L1) | **P** | — | features-map entry at L2; actual invocation effects (Agonizing Blast, Repelling Blast, Devil's Sight) **not implemented** |
| 2 | Magical Cunning (2024) | **M** | — | 1-minute slot recover not implemented |
| 3 | Pact Boon (Blade/Chain/Tome/Talisman) | **P** | — | feature-key only, no mechanical effect |
| 3 | Warlock Subclass (Fiend) — Dark One's Blessing | **M** | — | `Warlock.subclasses` undefined; temp HP on kill not implemented |
| 3 | Fiend Expanded Spell List | **M** | — | |
| 5 | — (3rd-level Pact slots) | **I** | WL3 | `pactMagicSlotsForLevel` |
| — | Hex | **I** §GAP-6 | WL1 (failing) | damage rider attachment to beams broken |
| — | Hellish Rebuke | **I** | WL2 | |

### Wizard (Evocation — "School of Evocation")
| L | Feature | Status | Scenario | Notes |
|---|---------|--------|----------|-------|
| 1 | Spellcasting (INT) | **I** | W1–W4 | |
| 1 | Arcane Recovery | **P** | — | pool tracked, **no short-rest spend path** that actually refunds slot levels |
| 1 | Ritual Adept (2024) | **M** | — | ritual casting flag not modeled |
| 2 | Wizard Subclass (Evocation) — Sculpt Spells | **M** | — | `Wizard.subclasses` undefined; ally-exclusion in AoE not implemented |
| 2 | Scholar (2024) | **M** | — | expertise on one INT skill |
| 3 | — (2nd-level spells) | **I** | W2 | |
| 4 | ASI | N/A | — | |
| 5 | — (3rd-level spells: Fireball, Counterspell) | **I** §GAP-8 | W1, W2 | Counterspell blocked by Hold Person save bug |

---

## MISSING Features (no code)
1. **Bard**: Lore/Valor subclasses, Cutting Words, Combat Inspiration, Expertise, Magical Inspiration
2. **Druid**: All subclasses (Land/Moon/Sea/Stars), Wild Companion, Circle forms
3. **Sorcerer**: All subclasses, Innate Sorcery, 6 of 8 Metamagic options, Sorcery Points → slot conversion, Sorcerous Restoration
4. **Warlock**: All patron subclasses (Fiend/Archfey/Great Old One/Celestial), Dark One's Blessing, Pact Boon mechanics, Eldritch Invocation effects (Agonizing Blast in particular blocks GAP-6 workaround), Magical Cunning
5. **Wizard**: All arcane tradition subclasses (Evoker/Abjurer/Diviner/Illusionist), Sculpt Spells, Ritual Adept
6. **Cleric**: All divine domain subclasses (Life/Light/Trickery/War), Divine Order, Disciple of Life, Sear Undead
7. **Paladin**: All sacred oath subclasses (Devotion/Glory/Ancients/Vengeance), Sacred Weapon, Oath spells, Faithful Steed
8. **Ranger**: Hunter subclass feature executors (Hunter's Prey variants), Deft Explorer expertise
9. **Rogue**: **Cunning Strike** (new 2024 feature — high priority), Expertise, Thief subclass Fast Hands/SSW mechanics
10. **Fighter**: Fighting Style mechanical effects (Defense/Dueling/GWF/TWF/Archery), Remarkable Athlete
11. **Barbarian**: Danger Sense DEX-save advantage
12. **Monk**: Slow Fall

## PARTIAL (feature-map only, no executor / no mechanical effect)
- Fighter/Paladin/Ranger: **Fighting Style** (map entry only; Protection/Interception reactions are TODO per fighter.ts comments)
- Fighter: **Remarkable Athlete**
- Bard: **Jack of All Trades**
- Ranger: **Favored Enemy** (pool exists but no free-cast branch), **Deft Explorer**
- Rogue Thief: **Fast Hands**, **Second-Story Work**
- Warlock: **Eldritch Invocations**, **Pact Boon**
- Wizard: **Arcane Recovery** (spend path incomplete)
- Cleric: **Spiritual Weapon bonus-action attack loop** (see §GAP-12 below)

## IMPLEMENTED-BUT-UNTESTED (no E2E scenario)
- **Bard**: Bardic Inspiration (executor wired, Font of Inspiration rest policy) — whole class needs scenario
- **Druid**: Wild Shape L2–L4 beast-form transformation — whole class needs scenario
- **Ranger**: Spell slot casting, Favored Enemy pool tracking, Hunter's Mark damage rider — whole class needs scenario
- **Sorcerer**: Sorcery Points pool, Quickened Spell, Twinned Spell — whole class needs scenario
- **Monk**: Uncanny Metabolism refresh-ki-on-initiative (exists as pool, initiative hook likely missing)
- **Paladin**: Aura of Protection save bonus at L6 (out of L5 scope but getAuraBonus helper exists untested)

## Recommended Subclass Pick for New E2E Scenarios
| Class | Recommended L3 Subclass | Rationale |
|-------|------------------------|-----------|
| Bard | **Lore** | Cutting Words reaction fits existing reaction-system tests; Magical Secrets at L10 (out of scope) |
| Druid | **Circle of the Land (Grassland)** | Simpler than Moon (no combat form CR scaling); Land's Aid CD is discrete to test |
| Ranger | **Hunter → Colossus Slayer** | Single-target bonus damage rider parallels Sneak Attack; no summoning complexity of Beast Master |
| Sorcerer | **Draconic Sorcery (Red)** | Fire-affinity + Draconic Resilience are both single-stat passive tests; avoids Wild Magic RNG |

**Caveat**: For all 4 untested classes, the subclass definitions **do not exist yet** (`.subclasses` is undefined). The scenario plan must include creating `SubclassDefinition` constants + feature-map entries **before** writing scenarios that rely on L3 subclass features.

## New Gaps Discovered Beyond COVERAGE.md §GAP-6..§GAP-11

- **§GAP-12 (NEW)**: **Spiritual Weapon persistent bonus-action attack** — spell is in catalog but there's no per-turn bonus-action loop to attack with the summoned weapon; it casts as no-op-like buff.
- **§GAP-13 (NEW)**: **Favored Enemy free Hunter's Mark** — `favoredEnemy` pool exists but Hunter's Mark cast path doesn't decrement it before spell slot; cast always uses a slot.
- **§GAP-14 (NEW)**: **Fighting Style mechanical effects** — Defense (+1 AC), Dueling (+2 dmg), GWF (reroll 1s/2s), Archery (+2 attack), TWF (ability mod to offhand) all unimplemented; only Protection/Interception have stubbed `detect()`, not wired into reaction handler.
- **§GAP-15 (NEW)**: **Arcane Recovery spend path** — `arcaneRecovery` pool exists, no endpoint/action to consume it and refund slots on short rest.
- **§GAP-16 (NEW)**: **Cunning Strike (Rogue L5, 2024)** — new 2024 feature to trade SA dice for Poison/Trip/Withdraw effects; not modeled at all.
- **§GAP-17 (NEW)**: **Subclass definitions missing for 7 classes** — Cleric, Druid, Paladin, Sorcerer, Warlock, Wizard, Bard have no `SubclassDefinition` exports. Only Barbarian (Berserker), Fighter (Champion), Monk (Open Hand), Ranger (Hunter), Rogue (Thief) define subclasses.
- **§GAP-18 (NEW)**: **Expertise** — missing from `feature-keys.ts` entirely; Rogue L1, Bard L2, Ranger L2 all reference it but no mechanical doubling of proficiency bonus on skill checks.

## Key Risks / Blockers

1. **Subclass framework gap is the largest single blocker.** 7 of 12 classes lack any `SubclassDefinition` exports. Adding subclass features requires extending the class-definition flow + registry lookups, which touches `getSubclassDefinition()` and the `requiresSubclass` capability path already used by Barbarian/Monk.
2. **§GAP-6 (Hex damage rider)** must be fixed before any Warlock Fiend scenarios — Dark One's Blessing relies on Hex+EB interplay.
3. **Bonus-action spell-attack loop** (§GAP-12) is needed for both Spiritual Weapon and (at higher levels) Bigby's Hand / Spiritual Guardians persistence — deeper architectural fix required in the pending-action state machine to support "per-round caster-triggered bonus action".
4. **Metamagic dispatch** must thread through `SpellActionHandler` — Quickened Spell needs to rewrite casting-time gating, Twinned needs multi-target dispatch. Current executors set a flag but the downstream consumption is untested; likely the `cast` pipeline doesn't read the flag.
5. **Fighting Style passives** (§GAP-14) need a creature-hydration / attack-resolver pass since they modify damage/attack/AC formulas — cross-cuts into CreatureHydration and CombatRules SMEs.
6. **Cunning Strike (§GAP-16)** requires SA-die-spending UI + save-effect application; large surface area in damage-resolver + condition system.

## Recommendations (ordered by priority)

1. **Fix §GAP-6 (Hex rider)** — unlocks Warlock multi-scenario coverage and validates the effect-attachment pattern needed for Hunter's Mark parity.
2. **Add Bard, Druid, Ranger, Sorcerer "L1-L5 happy path" scenarios** exercising *only currently implemented* features (Bardic Inspiration, Wild Shape transform, Hunter's Mark slot cast, Quickened Spell). Defer subclass features to follow-up scenarios.
3. **Create missing `SubclassDefinition` exports** for Life (Cleric), Devotion (Paladin), Fiend (Warlock), Evocation (Wizard) — at least empty shells — so scenarios can pass `subclassId` without runtime errors.
4. **Implement Cunning Strike** — high-value 2024 feature for existing Rogue scenarios.
5. **Implement Fighting Style passives** — broadly affects Fighter/Paladin/Ranger damage and AC math.
6. **Defer**: full Metamagic coverage, Warlock Mystic Arcanum, Druid Moon combat forms — post-MVP scope.
