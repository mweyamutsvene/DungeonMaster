---
type: report
flow: multi
feature: mechanics-and-coverage-l1-5
author: claude-orchestrator
status: DRAFT
created: 2026-04-24
updated: 2026-04-24
---

# D&D 5e 2024 Engine — Mechanics & E2E Coverage Consolidated Report (L1-5)

> **Purpose:** single source of truth for what mechanics our engine supports, what needs rework, what's missing for L1-5 play, and how well our 260 E2E scenarios cover them.
>
> **Method:** 13 per-flow audits in `plans/audit-{Flow}.md` + E2E audit in `plans/audit-E2E-Scenarios.md`. This document synthesizes across them. Every row links back to the source audit.

## Legend

| Status | Meaning |
|---|---|
| SUPPORTED | Implemented + wired + tested |
| PARTIAL | Present but rough edges / bugs / incomplete |
| REWORK | Exists but diverges from 2024 RAW or has known bug |
| MISSING | Not implemented, required for L1-5 |
| OUT | Out of scope for L1-5 (document but don't fix) |

| Coverage | Meaning |
|---|---|
| STRONG | 5+ scenarios, multi-turn, cross-mechanic |
| MODERATE | 1-4 scenarios, mostly single-turn |
| WEAK | Exists but untested or tested only trivially |
| NONE | Zero scenarios exercise this mechanic |

---

# 1. Executive Summary

**Engine state: ~90% L1-5 ready** (revised up from 80% after multiple implementation rounds + extensive false-positive verification).

Architecture is sound across every flow. After three rounds of implementation + verification, the real blocker list shrinks dramatically:

### Genuine remaining gaps (architectural)

1. **d20 roll-interrupt hook** — Bardic Inspiration effect is created but never consumed by roll resolvers. Blocks BI consumption, Lucky feat, Cutting Words, Tactical Mind reroll, Diviner Portent. Plan in [plan-d20-roll-interrupt.md](plan-d20-roll-interrupt.md). Estimated 2-3 days.
2. **Subclass L3 features** for 12 base subclasses — typed framework exists; mechanical implementations missing for ~7. Plan in [plan-subclass-framework.md](plan-subclass-framework.md).
3. **Wild Shape stat-block swap** — current implementation is temp-HP overlay, not real form swap. Plan in [plan-wild-shape-stat-swap.md](plan-wild-shape-stat-swap.md).
4. **Background field + Origin Feat / ASI pipeline** — Character.background field absent. Plan in [plan-background-pipeline.md](plan-background-pipeline.md).
5. **E2E scenarios are 75% single-turn** — redundancy high; consolidation in progress.

### Resolved this session (audit findings that turned out to be FALSE POSITIVES)

The original audits over-flagged these as missing — verification + implementation passes revealed they're already wired:

- ~~**AI spell delivery resolution**~~ → Fully implemented in `ai-spell-delivery.ts` (740 LOC handling spell attacks, healing, save-based, buff/debuff, zones, cantrip scaling, upcasting, AoE optimal targeting). Wired through `cast-spell-handler.ts:163`.
- ~~**Cunning Strike executor (Rogue L5)**~~ → Fully wired: `parseCunningStrikeOption` in rogue.ts, SA-die deduction in `roll-state-machine.ts:971`, save+condition resolution in `damage-resolver.ts:893`. Poison/trip/withdraw all working. Disarm/Daze options remain genuinely missing (different subsystems).
- ~~**Sear Undead (Cleric L5)**~~ → Implemented as Destroy Undead CR threshold in `class-ability-handlers.ts:546-557`.
- ~~**Monster catalog 12-monster gap**~~ → All 12 (Knight, Orc, Kobold, Wolf, Dire Wolf, Giant Spider, Ogre, Gnoll, Ghoul, Wight, Owlbear, Brown Bear) present in markdown source and imported.

### Resolved this session (actual implementation work)

- **Counterspell 2014→2024 port** — target Con save vs counterspeller's save DC.
- **saveProficiencies on CombatantCombatStats** — wired through Counterspell + concentration saves.
- **Exhaustion 2024 port** — 1-10 levels, -2/level, death at 10. Reconciled `conditions.ts` from 2014 hybrid. Orphan `domain/rules/exhaustion.ts` deleted.
- **Dispel Magic delivery handler** — auto-dispels spells ≤slot level; rolls ability check for higher.
- **Material component enforcement** — structured `StructuredMaterialComponent` schema + parser + enforcement at cast time for consumed costed components (Revivify 300gp diamond, Continual Flame ruby dust, etc.).
- **Slow Fall (Monk L4+)** — extends `resolvePitEntry` with class-aware reduction; auto-applies, consumes reaction.
- **7 missing class features** in commit `2f0cbf2`: Steady Aim, Innate Sorcery, Sorcerous Restoration, Tactical Shift, Ritual Adept, Divine Spark, Magical Cunning.

### Genuine remaining mid-scope items

- **Tactical Mind** (Fighter L2) — blocked on d20 roll-interrupt hook.
- **Cunning Strike Disarm + Daze** options — need drop-weapon-to-ground (Disarm) and custom-effect (Daze) subsystems. Functional Cunning Strike (3 of 5 options) already works.
- **Divine Order** (Cleric L1 Protector/Thaumaturge) and **Primal Order** (Druid L1) — completely absent.
- **Lightning Bolt + Sleet Storm** (L3 catalog).
- **Exhaustion reduction on long rest** — once auto-death rule lands, also need LR reducing exhaustion by 1.

## What's actually working (verified in post-audit pass)

- **Rest operations**: `CharacterService.takeSessionRest(sessionId, "short"|"long", hitDiceSpending?)` — HP, hit dice, resource pools refresh. (Missing exhaustion reduction on long rest.)
- **Level-up**: `Character.levelUp()` / `levelUpWith(options)` domain method — increments level, recomputes HP from class hit die, reconciles resource pools, applies ASI choices.
- **Subclass framework**: Typed `SubclassDefinition` per class with features map; `getSubclassDefinition()` with normalized ID matching in `registry.ts`. Choice stored as string on sheet, resolved to typed definition at lookup.
- **Creature-as-cover**: Returns half (+2), not three-quarters. Already 2024-RAW compliant.
- **Shield spell persistence**: `until_start_of_next_turn` with activeEffects lookup on every subsequent attack. Correct.
- **Reaction reset timing**: Fires at start of own turn via `freshActionEconomy`. 2024-correct.
- **Rage end-condition** (`shouldRageEnd`), **Danger Sense** ActiveEffect, **Fast Movement** ActiveEffect, **Reckless Attack** (both self-advantage and attacker-advantage effects): all fully wired.
- **Jack of All Trades**, **Font of Inspiration (SR at L5)**, **BI d8 scaling**: all implemented.
- **Channel Divinity pool + Turn Undead executor**: implemented.
- **Sneak Attack**: `isSneakAttackEligible()` + consumption in `damage-resolver.ts` with once-per-turn flag.
- **Cunning Action, Uncanny Dodge reaction, Font of Magic conversion, Quickened/Twinned Metamagic, Agonizing Blast, Pact slot model, Second Wind, Action Surge, Lay on Hands**: all implemented.

## What's inline-partial (works but not as dedicated executors)

- **Stunning Strike**: inline in `hit-rider-resolver.ts` as attack enhancement, not dedicated executor.
- **Divine Smite (2024 spell)**: inline in `hit-rider-resolver.ts`, same pattern.
- **Cunning Strike (Rogue L5 2024)**: types + DC compute + damage-resolver tracking exist; no dedicated executor.
- **Arcane Recovery**: `validateArcaneRecovery()` + pool + capability ID declared, but no `ArcaneRecoveryExecutor` file to handle the ability at runtime.
- **Patron subclass kill-triggers** (e.g., Fiend's Dark One's Blessing): pure functions (`darkOnesBlessingTempHp()`) exist but no combat event hook.

Aside from those, the deterministic rules engine is a competent implementation of 2024 combat.

---

# 2. Mechanics Catalog (by flow)

## 2.1 CombatRules  ([audit](audit-CombatRules.md))

| Mechanic | Status | Coverage | Notes |
|---|---|---|---|
| Attack resolution (adv/disadv, crit on 20, auto-miss on 1) | SUPPORTED | STRONG | attack-resolver.ts + attack.ts |
| Damage types + resistance/immunity/vulnerability | SUPPORTED | STRONG | damage.ts |
| Temp HP absorption | SUPPORTED | MODERATE | hit-points.ts |
| Conditions (13/15): blinded, charmed, deafened, frightened, grappled, incapacitated, paralyzed, poisoned, prone, restrained, stunned, unconscious, invisible + petrified | SUPPORTED | MODERATE | conditions.ts |
| **Exhaustion (2024: 10 levels, -2/level)** | **MISSING P0** | NONE | Completely absent |
| Saving throws (adv/disadv, proficiency) | SUPPORTED | STRONG | saving-throw.ts |
| Ability checks + 18-skill proficiency + expertise | SUPPORTED | STRONG | ability-check.ts |
| Death saves (3/3, nat 1/20, damage at 0) | SUPPORTED | STRONG | death-saves.ts |
| Initiative | SUPPORTED | STRONG | initiative.ts |
| **Surprise (2024: disadvantage on init)** | **MISSING P1** | NONE | |
| **Alert feat (2024)** | **MISSING P1** | NONE | |
| Concentration (gain/damage save/break/replace/end) | SUPPORTED | STRONG | concentration.ts |
| Movement (walk/climb/swim/fly, difficult terrain 2×) | SUPPORTED | STRONG | movement.ts |
| Grapple + shove (2024 unarmed option) | SUPPORTED | MODERATE | grapple-shove.ts |
| **Grapple escape action** | **MISSING P1** | NONE | Initial grapple exists; escape not wired |
| Cover (half +2, 3/4 +5, total untargetable) | SUPPORTED | MODERATE | combat-map.ts |
| Cover + Dex save bonus from AoE | REWORK | WEAK | AC works; Dex save consumption unverified |
| Dodge / Disengage / Dash | SUPPORTED | MODERATE | actions.ts |
| Help / Search / Ready / Use Object | SUPPORTED | MODERATE | actions.ts |
| Hide action | REWORK | WEAK | Likely stub; needs Stealth vs passive Perception + Invisible application |
| Two-weapon fighting (light + bonus off-hand) | REWORK | MODERATE | Wiring incomplete; 2024 mod-only-if-negative rule |
| **Fall damage (1d6/10ft, max 20d6, prone)** | **MISSING P0** | NONE | |
| Unarmed strikes (2024 STR+prof, 1+STR damage) | SUPPORTED | MODERATE | |
| Critical hit damage dice-vs-flat separation (2024) | REWORK | WEAK | Currently doubles all dice |
| **Forced movement (Thunderwave push, bull rush distance + OA/fall interaction)** | **MISSING P1** | NONE | |
| Suffocation / drowning | MISSING P2 | NONE | |
| Mounted combat | MISSING P2 | NONE | |

## 2.2 ClassAbilities  ([audit](audit-ClassAbilities.md))

### Per-class status at L1-5

**Legend: SUPPORTED / PARTIAL / MISSING / UNVERIFIED**

| Class | L1 | L2 | L3 (subclass) | L4 | L5 |
|---|---|---|---|---|---|
| **Barbarian** | Rage (SUP), Unarmored Def (cross-flow), Weapon Mastery (cross-flow) | Reckless Attack (PARTIAL — "attackers have adv vs you" tracking UNVERIFIED), Danger Sense (MISSING) | Primal Path MISSING | ASI (cross-flow) | Extra Attack (cross-flow), Fast Movement MISSING |
| **Bard** | Spellcasting (cross-flow), Bardic Inspiration (PARTIAL — consumption hook UNVERIFIED) | Expertise (cross-flow), Jack of All Trades MISSING | Bard College MISSING (Cutting Words needs reaction hook) | ASI | Font of Inspiration UNVERIFIED, BI d8 upgrade PARTIAL |
| **Cleric** | Spellcasting, Divine Order UNVERIFIED | Channel Divinity UNVERIFIED (Turn Undead, Divine Spark) | Divine Domain MISSING | ASI | Sear Undead UNVERIFIED |
| **Druid** | Spellcasting, Primal Order UNVERIFIED | **Wild Shape MISSING** (stat-block swap), Wild Companion depends on Wild Shape | Primal Circle MISSING | ASI | no universal |
| **Fighter** | Fighting Style PARTIAL, Second Wind UNVERIFIED/PARTIAL, Weapon Mastery 3 (cross-flow) | Action Surge PARTIAL, **Tactical Mind MISSING** (2024) | Martial Archetype MISSING (Champion crit range, BM maneuvers) | ASI | Extra Attack, **Tactical Shift MISSING** (2024) |
| **Monk (outlier)** | Martial Arts SUP, Unarmored Def | Ki/Focus pool SUP, Flurry/Patient/Step SUP, Unarmored Movement | Deflect Attacks SUP (reaction), Monastic Tradition MISSING | ASI, Slow Fall MISSING | Extra Attack, **Stunning Strike UNVERIFIED/PARTIAL** |
| **Paladin** | Spellcasting, **Lay on Hands UNVERIFIED/MISSING**, Weapon Mastery 2 | Fighting Style, **Divine Smite (2024 spell) UNVERIFIED/PARTIAL**, Channel Divinity UNVERIFIED | Sacred Oath MISSING (oath spells + CD) | ASI, Divine Health | Extra Attack, Faithful Steed cross-flow |
| **Ranger** | Spellcasting, Favored Enemy (Hunter's Mark tie) UNVERIFIED | Fighting Style, Deft Explorer (non-combat) | Archetype MISSING, Roving | ASI | Extra Attack |
| **Rogue** | Expertise, **Sneak Attack PARTIAL** (needs attack-hit hook + advantage detection), Weapon Mastery 2 | Cunning Action UNVERIFIED, **Steady Aim UNVERIFIED/MISSING** (2024 base) | Archetype MISSING (Assassinate auto-crit) | ASI | **Uncanny Dodge MISSING** (reaction), **Cunning Strike MISSING** (2024 dice-spend) |
| **Sorcerer** | Spellcasting, **Innate Sorcery MISSING** (2024), **L1 Subclass MISSING** (Draconic Resilience etc.) | Font of Magic PARTIAL (points + conversion) | **Metamagic MISSING** (Quickened, Twinned minimum) | ASI | Sorcerous Restoration UNVERIFIED |
| **Warlock (weakest-covered class)** | Pact Magic (SR slots — cross-flow), **Eldritch Invocations MISSING** (Agonizing Blast+), **L1 Subclass MISSING** | Magical Cunning MISSING | Pact Boon MISSING | ASI | 3rd-lvl Pact slots |
| **Wizard** | Spellcasting, Ritual Adept (2024), **Arcane Recovery UNVERIFIED** | Scholar (2024) | Arcane Tradition MISSING (Sculpt Spells, Portent) | ASI | no universal |

### Structural gaps (class-wide)

| Issue | Status | Notes |
|---|---|---|
| **Subclass framework** | **MISSING P0** | No subclass registry. Sorc/Warlock lose L1 identity; others lose L3. |
| Resource pool coverage | PARTIAL | `class-resources.ts` imports 10 of 12 classes |
| Attack enhancement stacking order | REWORK | Reckless + Sneak + Smite + Stunning Strike composition |
| Attack reaction dedup | REWORK | Shield, Deflect, Uncanny Dodge, Protection, Cutting Words compete |
| Bonus action routing | REWORK | Verify all bonus-action features consume economy |
| Bardic Inspiration consumption | MISSING P0 | If not wired to d20 rolls, BI is cosmetic |
| d20 roll-interrupt hook | MISSING P0 | Blocks Cutting Words, Silvery Barbs, Portent, Lucky, BI consumption |
| Condition application from class abilities | REWORK | Stunning Strike, Cunning Strike, BM maneuvers need uniform save→condition flow |

## 2.3 SpellSystem  ([audit](audit-SpellSystem.md))

| Mechanic | Status | Coverage | Notes |
|---|---|---|---|
| Spell slot economy (track/consume/ritual flag) | SUPPORTED | STRONG | |
| Delivery modes (attack, save, heal, buff, zone, auto-hit MM) | SUPPORTED | MODERATE | |
| Spell attack rolls vs saves (DC = 8+prof+mod) | SUPPORTED | STRONG | |
| Concentration lifecycle | SUPPORTED | STRONG | |
| Upcasting (dice + flat scaling) | SUPPORTED | MODERATE | Cantrips reject, validated |
| Cantrip scaling (1/2/3/4× at L1/5/11/17) | SUPPORTED | WEAK | Scaling present, tests thin |
| Counterspell (2024 rules) | SUPPORTED | MODERATE | Verify Con-save-by-target implementation |
| Verbal component enforcement | SUPPORTED | WEAK | `cannotSpeak` blocks |
| **Dispel Magic (L3)** | **MISSING P0** | NONE | Completely absent — blocks L3+ wizard/cleric/druid/bard |
| **Material component enforcement** | **MISSING P0** | NONE | Declared in catalog, zero inventory checks (Revivify 300gp diamond) |
| **Auto-AoE target resolution** | **MISSING P0** | NONE | Burning Hands / Thunderwave / Fireball require manual target names |
| **War Caster feat concentration advantage** | **MISSING P1** | NONE | `concentrationSaveRollMode` hardcoded false |
| Somatic component free-hand validation | MISSING P1 | NONE | |
| Spiritual Weapon multi-round bonus action | MISSING P1 | NONE | L2 cleric staple |
| Mirror Image duplicate AC override | MISSING P1 | WEAK | Not wired into hit-resolution |
| Haste speed_multiplier | MISSING P1 | WEAK | |
| Slot refund on counterspell failure | MISSING P1 | NONE | Both outcomes consume slot |
| Spell prep/known distinction | MISSING P2 | NONE | No cleric/druid re-prep vs sorcerer-known |
| Ritual casting integration depth | MISSING P2 | WEAK | |

## 2.4 SpellCatalog  ([audit](audit-SpellCatalog.md))

**Coverage: 71/107 PHB core spells (66%).**

| Level | Present | Missing for L1-5 |
|---|---|---|
| Cantrip | 9/17 (53%) | Guidance, Spare the Dying, Resistance, Light, Mage Hand, Shillelagh, Minor Illusion, Shocking Grasp |
| L1 | 34/42 (81%) | Fog Cloud, Ice Knife, Color Spray, Sanctuary, Find Familiar (ritual) |
| L2 | 19/29 (66%) | Magic Weapon, Prayer of Healing, Blur, Silence |
| L3 | 12/23 (52%) | **Lightning Bolt (CRITICAL for sorc/wiz)**, Sleet Storm, Bestow Curse, Water Walk |
| L4-5 | 12/18 (67%) | Mass Cure Wounds (L5), Teleportation Circle (L5) |

### Catalog-level bugs

- **Cantrip scaling untested** — Fire Bolt, Eldritch Blast, Vicious Mockery have scaling comments but no L5/11/17 assertions.
- **Spiritual Weapon TODO** — multi-round bonus action loop not implemented.
- **Mirror Image incomplete** — duplicate AC not in hit-resolution.
- **Haste incomplete** — `speed_multiplier` not resolved.

## 2.5 CombatOrchestration  ([audit](audit-CombatOrchestration.md))

| Mechanic | Status | Notes |
|---|---|---|
| Encounter lifecycle (start/end) | SUPPORTED | |
| Turn boundary 6-phase processing | SUPPORTED | end-of-turn effects → advance → incoming → start → events → death-save auto-roll |
| Intent parsing (CombatTextParser, 20+ parsers) | PARTIAL | Regex-based, brittle; no LLM fallback |
| Action dispatch (7 handler modules) | SUPPORTED | attack, movement, grapple, spell, interaction, social, class abilities |
| Roll state machine | SUPPORTED | INITIATIVE → ATTACK → DAMAGE → DEATH_SAVE / SAVING_THROW |
| Victory/defeat detection (faction-based) | SUPPORTED | |
| Compound intents | PARTIAL | Only "move (X,Y) and attack" supported; no move-toward-attack, attack-then-move, three-part |
| Surprise round | MISSING P1 | Surprised creatures don't skip/disadv |
| Flee mechanics | MISSING P2 | `hasFled()` flag exists but nothing sets it |
| Reaction spells hookup | PARTIAL | OAs partial; Counterspell/Feather Fall/Absorb Elements missing |
| Concentration auto-break on new cast | REWORK | Spells while concentrating don't auto-break |
| Save-to-end mid-turn | MISSING P1 | Effects don't trigger saves when damage taken on another's turn |
| Action economy collision (Monk Flurry + Offhand bonus) | REWORK | No arbitration |

## 2.6 ActionEconomy  ([audit](audit-ActionEconomy.md))

| Mechanic | Status | Notes |
|---|---|---|
| Action/bonus/reaction tracking | SUPPORTED | |
| Movement tracking (speed pool, terrain cost) | SUPPORTED | |
| Turn reset (23+ fields per turn) | SUPPORTED | `resetTurnResources()` |
| Extra Attack (L5 martials) | SUPPORTED | Via `ClassFeatureResolver.getAttacksPerAction()` |
| Action Surge (Fighter L2) | SUPPORTED | SR resource, resets `actionSpent` |
| Legendary action charges | SUPPORTED | `spendLegendaryAction()`, `resetLegendaryActions()` |
| Bonus action spell restrictions (2024: action-slot + bonus-slot same turn) | SUPPORTED | Both flags tracked |
| Ready action persistence | SUPPORTED | Cleared at start of next turn |
| Class resource pools (rage, ki, sorcery, BI, CD) | SUPPORTED | |
| **Disengage/Dash enforcement** | **MISSING P0** | `markDisengaged()` exists but never called; movement handlers don't check disengage before OA |
| **Lair action trigger at initiative 20** | **MISSING P0** | Parsed but not fired |
| Reaction mid-round lifecycle | REWORK | No `reactionSpentThisRound` vs `reactionAvailableThisTurn` distinction |
| Monk Flurry of Blows economy guards | REWORK | Doesn't check `bonusActionSpellCastThisTurn` |
| Multiattack vs Extra Attack monsters | REWORK | AI multiattack doesn't populate pool at encounter start |
| OA once per trigger (2024) | REWORK | Doesn't prevent multiple OAs per trigger |
| Difficult terrain cost audit per turn | MISSING P1 | No total-vs-pool validation |
| Ritual + action spell same turn | MISSING P1 | No validator |
| AC recalc timing (Unarmored Defense stat change) | MISSING P1 | |
| Domain `Combat.endTurn()` vs application `resetTurnResources()` drift | REWORK | Duplicate logic risk |

## 2.7 ReactionSystem  ([audit](audit-ReactionSystem.md))

| Mechanic | Status | Notes |
|---|---|---|
| Two-phase pending-action pipeline | SUPPORTED | Clean facade, state machine enforces transitions |
| OA detection (leaves reach, Disengage suppresses) | SUPPORTED | `oa-detection.ts` |
| Shield spell (attack reaction, +5 AC persistence) | SUPPORTED | Verify persistence until start of caster's next turn |
| Counterspell (spell reaction) | PARTIAL | Verify 2024 Con-save-by-target (not 2014 check) |
| Damage reactions (post-damage hook) | SUPPORTED | |
| **Absorb Elements (L1 spell)** | **MISSING P0** | Needs damage-reaction-handler wiring |
| **Hellish Rebuke (L1 spell)** | **MISSING P0** | Needs damager reference on damage event |
| **Deflect Attacks (Monk L1 2024, melee+ranged)** | **MISSING P0** | Attack-reaction wiring |
| **Slow Fall (Monk L4)** | **MISSING P1** | Needs NEW trigger kind (fall damage not currently pending-action) |
| **Protection fighting style (2024 reaction)** | **MISSING P1** | Needs ally-targeting reaction kind |
| **Interception fighting style (2024 reaction)** | **MISSING P1** | Needs damage-to-ally reaction kind |
| **Cutting Words (Bard Lore L3 reaction)** | **MISSING P1** | **Needs roll-interrupt reaction kind — architectural gap** |
| **Sentinel feat** | MISSING P2 | OA even on Disengage, trigger on ally-adjacent-attack |
| **Polearm Master enter-reach OA** | MISSING P2 | `oa-detection.ts` only leaves-reach |
| Forced movement / stand-from-prone / teleport OA exclusion | REWORK | Verify filters voluntary-only |
| Reaction reset at own-turn-start (not round) | REWORK | Verify correct event |

**Summary:** Architecture sound; content thin. Only 3 of ~12 canonical L1-5 reactions wired.

## 2.8 CombatMap  ([audit](audit-CombatMap.md))

| Mechanic | Status | Notes |
|---|---|---|
| 5ft grid, Chebyshev distance, 8-way neighbors | SUPPORTED | 2024 standard |
| A* pathfinding with zone-aware weighting | SUPPORTED | `dangerousZoneWeight`, `zonePenalty`, `avoidZoneIds` |
| Difficult terrain (2× cost) | SUPPORTED | |
| Cover (none/half/three-quarters/full) | SUPPORTED | |
| **Creature-as-cover bug** | **REWORK P0** | Returns three-quarters (+5); RAW says half (+2). Inflates every ranged attack's AC by +3. |
| Zones (circle/square/line/cone, damage, duration, blocks flags) | SUPPORTED | |
| AoE shapes (sphere/cube/cylinder/line/cone) | SUPPORTED | Cone angle approximation 53° |
| Battlefield rendering (ASCII) | SUPPORTED | |
| Ground items on map | SUPPORTED | |
| Flanking detection | SUPPORTED | |
| Pits (entry, DEX save, fall damage + prone) | SUPPORTED | |
| **Flying / hovering movement mode** | **MISSING P0** | A* signature has no mode; ignore ground terrain/zones/pits |
| **Zone LOS blocking enforcement** | **MISSING P0** | Flag exists; `hasLineOfSight` doesn't check it. Breaks fog cloud, darkness |
| **Creature size / multi-tile footprint** | **MISSING P0** | Large treated as 1×1 |
| **Reach-aware adjacency helper** | **MISSING P0** | `isAdjacent` hardcoded 5ft; glaive at L1 breaks |
| **Diagonal corner-clipping check** | **MISSING P0** | Can move diagonally through corner touching wall |
| **Invisibility/hidden map state** | **MISSING P0** | No `isHidden`/`isInvisible` fields |
| **Line of effect at AoE origin + spell target** | **MISSING P0** | Can fireball through walls currently |
| Per-zone trigger policy | MISSING P1 | spike-growth-per-5ft vs moonbeam-on-entry one-size-fits-all |
| Crawling cost (1/1 extra, like difficult terrain) | MISSING P2 | |
| TerrainType enum | REWORK | Vestigial — not wired into movement cost |
| `blocksMovement` zone enforcement in A* | MISSING P1 | Flag exists, pathfinder ignores |
| 3D elevation | MISSING P1 | Blocks aerial combat at L5 |
| Swim/climb speed integration | MISSING P2 | |
| Occupancy rules (move through ally, incapacitated) | MISSING P2 | All-or-nothing currently |

## 2.9 AIBehavior  ([audit](audit-AIBehavior.md))

| Mechanic | Status | Notes |
|---|---|---|
| LLM + deterministic fallback | SUPPORTED | Full feedback loop |
| Battle planning (faction tactical context) | SUPPORTED | Stale/HP/threat re-plan triggers |
| Rich context building (entities, positions, distances, cover, grid) | SUPPORTED | |
| 9-step decision hierarchy (prone → triage → target → move → economy → attack → bonus → end) | SUPPORTED | |
| 14+ non-spell action types (attack, move, grapple, hide, dash, dodge, disengage, useObject, useFeature, help, castSpell) | SUPPORTED | |
| Target scoring (HP%, AC, concentration bias +40, condition weights, distance penalty) | SUPPORTED | |
| Positioning heuristics (cover-seek ranged, flank melee, damage-type aware) | SUPPORTED | |
| Monster specifics (multiattack parsing, legendary action spread heuristic, lair) | PARTIAL | Multiattack parsing works; lair action trigger missing (cross-flow ActionEconomy) |
| Reaction decision (OA, Shield, Counterspell) | PARTIAL | OA good; Shield margin check rough; Counterspell value-blind |
| Attack economy mid-turn re-check | REWORK | |
| OA suppression proactive | MISSING P1 | Reactive only |
| Pack tactics | MISSING P1 | |
| Multi-target spell clustering | MISSING P1 | |
| Concentration priority bias (break vs hold) | MISSING P1 | |
| Exhaustion/disease extraction | MISSING P2 | |
| Focus-fire coordination across allies | MISSING P2 | |

## 2.10 AISpellEvaluation  ([audit](audit-AISpellEvaluation.md))

| Mechanic | Status | Notes |
|---|---|---|
| Spell value computation (damage + save-probability + condition weights) | PARTIAL | Magic numbers hardcoded; not calibrated |
| Slot accounting (validate + spend + event) | SUPPORTED | |
| Cantrip fallback | SUPPORTED | L5 scaling from definition array |
| Single-target enemy selection | SUPPORTED | |
| Bonus-action spell path | SUPPORTED | Healing Word, Spiritual Weapon, Misty Step |
| Concentration drop on new cast (naive) | REWORK | No value comparison; drops Bless for Hold Person |
| AoE friendly-fire awareness | PARTIAL | Circle only; ignores elevation; flat ally weight |
| **AI spell delivery resolution** | **MISSING P0** | `ai-spell-delivery.ts` records event but doesn't resolve damage/saves/conditions/concentration. AI spellcasters cosmetic in mock combat. |
| **Upcast value computation** | **MISSING P0** | `computeSpellValue` doesn't compute value-per-slot |
| Encounter-budget heuristic | MISSING P1 | |
| Heal urgency tiers | REWORK | Binary threshold; missing 0-HP prioritization |
| Buff-target scoring | REWORK | Bless picks self + nearest 2; no output scoring |
| AoE template geometry (line/cone/cube) | MISSING P1 | Treats all as circle |
| Condition follow-through (Hold Person → auto-crit melee) | MISSING P1 | |
| Counterspell value check | MISSING P1 | Counters any spell regardless of value |
| Shield reaction smarter trigger | REWORK | Ignores crit, multi-attack sequence |
| Cantrip-as-default floor | REWORK | Capped too low; slots always preferred |

## 2.11 EntityManagement  ([audit](audit-EntityManagement.md))

| Mechanic | Status | Notes |
|---|---|---|
| Character entity (full 2024 sheet fields) | SUPPORTED | |
| Character CRUD + resource mutation | SUPPORTED | |
| Character-sheet hydration (weapon/armor/spell) | SUPPORTED | |
| Inspiration flag | SUPPORTED | Boolean grant only |
| Exhaustion level 0-10 field | SUPPORTED | (CombatRules doesn't consume it) |
| Monster stat block + import | SUPPORTED | |
| NPC lightweight entity | SUPPORTED | |
| Session lifecycle + events | SUPPORTED | |
| Repository ports (in-memory + Prisma) | PARTIAL | Memory repos drift from Prisma |
| Spell Lookup Service | SUPPORTED | |
| **Short rest operation** | **MISSING P0** | No `shortRest(characterId)`; blocks SR class features (Warlock slots, 2nd Wind, AS, Ki, BI L5+, BM dice, CD, Pact slots) |
| **Long rest operation** | **MISSING P0** | No `longRest(characterId)`; blocks slot refill, exhaustion reduction, HP full, hit dice half, temp HP clear, concentration end |
| **Hit dice tracking + spend** | **MISSING P0** | Likely not on entity |
| **Level-up operation (L2→L5)** | **MISSING P0** | Can't advance programmatically |
| **ASI/feat at L4** | **MISSING P0** | No application mechanism |
| **Species trait application pipeline** | **MISSING P0** | Species is a string; no trait apply |
| **Background pipeline (2024: skills/tool/language/Origin Feat/ASI/equipment)** | **MISSING P0** | |
| Inspiration grant/spend API + event | MISSING P1 | |
| Encounter-to-session rest linkage | MISSING P1 | Dungeon LR should flag/disallow |
| Exhaustion 6 = death | MISSING P1 | Depends on CombatRules exhaustion |
| Temp HP no-stack (2024 take-max) | MISSING P1 | |
| Monster catalog breadth (CR 0-4) | UNVERIFIED | Audit needed |
| NPC template library | MISSING P2 | |
| Multiclassing | MISSING P2 | Scalar `class` field; L1-5 can mono-class |

## 2.12 CreatureHydration  ([audit](audit-CreatureHydration.md))

| Mechanic | Status | Notes |
|---|---|---|
| Character ability scores / HP / AC / speed hydration | SUPPORTED | |
| 10 species registered with some traits | PARTIAL | Darkvision, resistances, speed, save advantages present |
| Base Creature.getAC() (armor + DEX + shield) | SUPPORTED | |
| Unarmored Defense (Barb, Monk) | SUPPORTED | Feature gate |
| Defense Fighting Style (+1 AC armored) | SUPPORTED | |
| Monster / NPC hydration | SUPPORTED | |
| Proficiency bonus (character level / monster CR+4) | PARTIAL | Monster is heuristic |
| **AC with Mage Armor (13 + DEX)** | **MISSING P0** | Not detected; no `mageArmorActive` hydration |
| **Magic item +X armor/weapon bonuses** | **MISSING P0** | Not parsed; not called in attack resolver |
| **ASI boost merging into effective stats** | **MISSING P0** | `asiChoices` parsed but not applied to AC/attack/saves |
| **Wild Shape reverse hydration** | **MISSING P0** | Beast form lost on reload mid-wild-shape |
| Species: natural armor | MISSING P1 | |
| Species: breath weapons | MISSING P1 | Dragonborn |
| Species: ability check bonuses | MISSING P1 | Gnome Cunning INT/WIS/CHA magic saves |
| Spell save DC / attack bonus computation (not just sheet-read) | MISSING P1 | |
| Skill check unification (duplicated logic) | REWORK | |
| Feat traits beyond Alert/Defense/Dueling/GWF/Protection/TWF/Archery | PARTIAL | Lucky, Resilient, Grappler, Skilled, Interception are placeholders |
| Condition immunities (Elf charmed, etc.) | MISSING P1 | |
| Multiclass spellcasting slot pooling | MISSING P2 | |

## 2.13 InventorySystem  ([audit](audit-InventorySystem.md))

| Mechanic | Status | Notes |
|---|---|---|
| Item entity + magic item definition | SUPPORTED | |
| Weapon catalog (28 PHB 2024 weapons) | SUPPORTED | Full mastery fields |
| Armor catalog (12 pieces) | SUPPORTED | |
| Shields | SUPPORTED | +2, Utilize mid-combat |
| Equip/unequip + AC sync | SUPPORTED | |
| Attunement (cap 3) | SUPPORTED | |
| Potions of Healing (4 tiers) + 13 resistance potions + specialty | PARTIAL | Healing works; ActiveEffect potions not applied |
| Goodberry (24-hour decay) | SUPPORTED | |
| Magic items (+X dynamic, wondrous, staves, on-hit effects) | PARTIAL | Definitions solid; bonuses not enforced in attack |
| Charges (max, recharge, destroy-on-empty) | PARTIAL | Defined; no LR reset, no recharge roll |
| Ground items (drop, pickup endpoint missing, no auto-loot) | PARTIAL | |
| Inventory API routes | SUPPORTED | |
| **Potion ActiveEffect application (Speed, Resistance)** | **MISSING P0** | Routes only apply healing + tempHP |
| **Magic bonus in attacks** | **MISSING P0** | `getWeaponMagicBonuses()` not called by resolver |
| **Charge recharge on LR + roll** | **MISSING P0** | |
| Ground item pickup endpoint | MISSING P1 | |
| Cursed items + Remove Curse | MISSING P1 | |
| Ammunition consumption | MISSING P2 | |
| Encumbrance enforcement | MISSING P2 | |
| Light sources (darkvision interaction) | MISSING P2 | |

---

# 3. E2E Coverage Snapshot  ([audit](audit-E2E-Scenarios.md))

**260 scenarios / 24 folders / 21 unique mechanic tags.**

### Turn-depth

| Bucket | % |
|---|---|
| 0 turns (setup only) | 33-37% |
| 1 turn | 10-38% |
| 2 turns | 30% |
| 3-4 turns | 10-22% |
| 5-9 turns | 14% |
| 10+ turns | 3% |

**~75% are ≤1 turn.** Only 7 scenarios (~3%) hit 5+ turns. 21 multi-PC, 7 with NPCs.

### Redundancy candidates

| Group | Count | Consolidation |
|---|---|---|
| `barbarian/rage-*` | 7 | → 1 `rage-full-lifecycle.json` |
| `rogue/` + `core/sneak-*` | 6 | → 1 `sneak-attack-conditions.json` |
| `core/death-save-*` | 4 | → 1 `death-save-full-cycle.json` |
| `core/cover-*` (AC + Dex) | 2 | → 1 `cover-ac-and-dex.json` |
| `core/dash-*` | 2 | → 1 |
| healing scattered | 8+ | → 2 grouped by type |
| advantage / disadvantage scattered | 6 | → 1 `advantage-disadvantage-unified.json` |

### Coverage heatmap

| Mechanic cluster | Scenarios | Coverage |
|---|---|---|
| attack, damage, movement, initiative | 50+ | STRONG |
| spell casting (single-target) | 30+ | STRONG |
| condition application | 15+ | MODERATE |
| reaction (OA, Shield) | 10+ | MODERATE |
| AoE | 8 | MODERATE |
| grapple / shove | 4 | MODERATE |
| death save | 4 | MODERATE |
| concentration | 2 | MODERATE |
| cover | 2 | MODERATE |
| multi-PC coordination | 7-21 | WEAK |
| counterspell | 1 | WEAK |
| legendary action | 2 | WEAK |
| lair action | 0 | NONE |
| surprise round (2024) | 0 | NONE |
| horde (6+ enemies) | 0 | NONE |
| condition stacking (3+ simultaneous) | 1 | WEAK |
| exhaustion | 0 | NONE (mechanic unimplemented) |
| fall damage | 0 | NONE (mechanic unimplemented) |
| rest mechanics | 0 | NONE (mechanic unimplemented) |
| Dispel Magic | 0 | NONE (spell missing) |
| War Caster | 0 | NONE |
| material components | 0 | NONE |

### Deepest existing scenarios (candidates to extend)

| Scenario | Turns |
|---|---|
| `class-combat/paladin/party-aura-tank.json` | 9-18 |
| `class-combat/wizard/spell-slot-economy.json` | 9-18 |
| `class-combat/core/healing-dice-regression.json` | 14 |
| `bless-and-bane-party.json` | 7 |

---

# 4. Cross-Flow Priority Table

**All P0/P1 items across every flow, ranked by dependency pressure. (Updated with verification-pass findings.)**

### Tier 1: Must-fix to make L1-5 playable at all

| # | Item | Flow | Notes |
|---|---|---|---|
| 1 | **d20 roll-interrupt architectural hook** | ReactionSystem | Unblocks Bardic Inspiration consumption, Lucky feat, Diviner Portent, future Silvery Barbs, Tactical Mind, Cutting Words. BI effect is created but never consumed — currently cosmetic. **Plan: [plan-d20-roll-interrupt.md](plan-d20-roll-interrupt.md)** |
| 2 | ~~**Counterspell 2014 → 2024 port**~~ ✅ DONE | SpellSystem | Ported in commit after 450f081. Target caster now makes a Con save vs counterspeller's save DC. `scenarios/wizard/counterspell-2024-con-save.json` validates. |
| 3 | **AI spell delivery resolution** | AISpellEvaluation | `ai-spell-delivery.ts` records event but doesn't resolve damage/saves/conditions. Blocks AI-vs-AI and mock combat. **Plan: [plan-ai-spell-delivery.md](plan-ai-spell-delivery.md)** |
| 4 | ~~**Exhaustion mechanic (2024, 10-level, -2/level d20)**~~ ✅ DONE | CombatRules | Reconciled `conditions.ts` to 2024 RAW (was 2014-style 1-6/-level). `scenarios/core/exhaustion-accumulation.json` validates. Orphan `domain/rules/exhaustion.ts` deleted. Level 10 death helper available but auto-death trigger on application is future work. |
| 5 | ~~**Fall damage (1d6/10ft, max 20d6, prone)**~~ ✅ DONE | CombatRules | Already implemented in `combat-map-core.ts` via `computeFallDamage` + `pit-terrain-resolver`. Audit was wrong. `scenarios/core/fall-damage-sequence.json` validates. Generic off-ledge fall damage (not through pits) is future work. |
| 6 | ~~**Dispel Magic (L3 spell)**~~ ✅ DONE | SpellCatalog + SpellSystem | Catalog entry already present; new `DispelMagicDeliveryHandler` wired into delivery chain. Auto-dispels spells of level ≤ slot level; rolls ability check for higher-level spells. `scenarios/wizard/dispel-magic-concentration-break.json` validates. |
| 7 | **Material component enforcement** | SpellSystem | Declared in catalog, zero inventory checks at cast time (Revivify 300gp). **Plan: [plan-material-components.md](plan-material-components.md)** |
| 8 | **Background field + background pipeline** | EntityManagement | Field entirely missing from Character. 2024 Origin Feat, ASI, skill/tool/language grants. **Plan: [plan-background-pipeline.md](plan-background-pipeline.md)** |
| 9 | **Species trait auto-apply on character create** | EntityManagement | Currently applied at hydration only — not written to sheet on create. (Pairs with background pipeline plan.) |
| 9b | **Subclass L3 features for 12 classes** | ClassAbilities | Framework + typed definitions exist; ~7 base subclasses need mechanical implementations. **Plan: [plan-subclass-framework.md](plan-subclass-framework.md)** |
| 9c | **Wild Shape stat-block swap** (Druid L2) | ClassAbilities + CreatureHydration | Current implementation is a temp-HP hack — beast stats aren't actually applied. **Plan: [plan-wild-shape-stat-swap.md](plan-wild-shape-stat-swap.md)** |
| 10 | **Missing class feature executors** (grouped) | ClassAbilities | ✅ **DONE (7)**: Steady Aim (Rogue L2), Innate Sorcery (Sorc L1), Sorcerous Restoration (Sorc L5, SR policy), Tactical Shift (Fighter L5, via Second Wind), Ritual Adept (Wizard L1, feature-flag), Divine Spark (Cleric L2 CD option), Magical Cunning (Warlock L2). **STILL OPEN**: Slow Fall (Monk L4) + Cunning Strike (Rogue L5) + Tactical Mind (Fighter L2) — see **[plan-cunning-strike-and-friends.md](plan-cunning-strike-and-friends.md)**. **FALSE POSITIVES**: Sear Undead (already implemented as Destroy Undead threshold), Arcane Recovery executor file (works via rest endpoint). |
| 11 | **Stunning Strike / Divine Smite / Cunning Strike architectural consolidation** | ClassAbilities | Currently inline in `hit-rider-resolver.ts` as attack enhancements. Works but should be dedicated executors for consistency. |
| 12 | **Patron subclass combat hooks** | ClassAbilities | `darkOnesBlessingTempHp()` pure function exists; no kill-trigger event bus to fire it. Same pattern for other subclass procs. |
| 13 | ~~**Monster catalog gap fill**~~ ✅ FALSE POSITIVE | EntityManagement | Verified: all 12 allegedly-missing monsters (Knight, Orc, Kobold, Wolf, Dire Wolf, Giant Spider, Ogre, Gnoll, Ghoul, Wight, Owlbear, Brown Bear) are present in `RuleBookDocs/markdown/creature-stat-blocks.md` and imported by the parser. Audit verification was incomplete. |
| 14 | **Divine Order (Cleric Protector/Thaumaturge)** | ClassAbilities | Completely absent — blocks Cleric L1 identity in 2024. |
| 15 | **Primal Order (Druid Magician/Warden)** | ClassAbilities | Completely absent — blocks Druid L1 identity in 2024. |
| 16 | **Exhaustion reduction on long rest** | EntityManagement | `takeSessionRest("long")` doesn't reduce exhaustion by 1. Needed once exhaustion is consumed. |
| 17 | **Lightning Bolt + Sleet Storm (L3 catalog)** | SpellCatalog | Sorcerer/Wizard staples missing. |
| 18 | ~~**Sear Undead (Cleric L5)**~~ ✅ FALSE POSITIVE | ClassAbilities | Already implemented as Destroy Undead threshold in `class-ability-handlers.ts:546-557` via `getDestroyUndeadCRThreshold` from cleric.ts. |

**Already working (removed from blocker list after verification):**
- ~~Short rest + long rest operations~~ → implemented as `takeSessionRest`
- ~~Level-up operation~~ → implemented as `Character.levelUp()`
- ~~Subclass framework~~ → typed `SubclassDefinition`, registry, string-on-sheet pattern
- ~~Creature-as-cover bug~~ → already returns half (2024-RAW)
- ~~Sneak Attack wiring~~ → `isSneakAttackEligible()` + `damage-resolver.ts`
- ~~Bardic Inspiration duration/refresh~~ → `restRefreshPolicy` with L5 SR recovery
- ~~Danger Sense, Fast Movement, Reckless Attack~~ → all ActiveEffect-wired
- ~~Jack of All Trades~~ → wired in `ability-checks.ts`
- ~~Channel Divinity pool + Turn Undead~~ → implemented
- ~~Sneak Attack, Cunning Action, Uncanny Dodge, Font of Magic, Quickened/Twinned Metamagic, Agonizing Blast, Pact slot, Second Wind, Action Surge, Lay on Hands~~ → all implemented

### Tier 2: Must-fix for fidelity at L1-5

| # | Item | Flow |
|---|---|---|
| 16 | Surprise (2024 disadv on init) + Alert feat | CombatRules |
| 17 | Two-weapon fighting full wiring | CombatRules |
| 18 | Hide action implementation (Stealth vs passive) | CombatRules |
| 19 | Grapple escape action | CombatRules |
| 20 | Forced movement tracking + OA/fall interaction | CombatRules |
| 21 | Critical damage dice-vs-flat (2024) | CombatRules |
| 22 | Auto-AoE target resolution | SpellSystem |
| 23 | War Caster feat concentration advantage | SpellSystem |
| 24 | Counterspell 2024 Con-save verification | ReactionSystem |
| 25 | Absorb Elements (L1) | ReactionSystem |
| 26 | Hellish Rebuke (L1) | ReactionSystem |
| 27 | Deflect Attacks (Monk L1 2024) | ReactionSystem |
| 28 | Roll-interrupt reaction kind (Cutting Words + BI) | ReactionSystem (architectural) |
| 29 | Ally-targeting reaction kind (Protection, Interception) | ReactionSystem (architectural) |
| 30 | Lair action trigger at initiative 20 | ActionEconomy |
| 31 | Disengage/Dash action flags wired | ActionEconomy |
| 32 | Flying movement mode in A* | CombatMap |
| 33 | Zone LOS blocking enforcement | CombatMap |
| 34 | Creature size (multi-tile footprint) | CombatMap |
| 35 | Reach-aware adjacency helper | CombatMap |
| 36 | Diagonal corner-clipping | CombatMap |
| 37 | Invisibility/hidden map state | CombatMap |
| 38 | Line of effect at AoE + spell target | CombatMap |
| 39 | ASI merging into effective ability scores | CreatureHydration |
| 40 | Mage Armor AC detection | CreatureHydration |
| 41 | Magic item bonuses in attack/AC | CreatureHydration + InventorySystem |
| 42 | Wild Shape reverse hydration | CreatureHydration + ClassAbilities |
| 43 | Lightning Bolt, Sleet Storm, Bestow Curse (L3 catalog) | SpellCatalog |
| 44 | Mage Hand, Shillelagh, Guidance, Spare the Dying cantrips | SpellCatalog |
| 45 | Magic Weapon, Prayer of Healing, Blur (L2 catalog) | SpellCatalog |
| 46 | Upcast value computation for AI | AISpellEvaluation |
| 47 | Potion ActiveEffect application | InventorySystem |
| 48 | Magic bonus called by attack resolver | InventorySystem + CombatRules |
| 49 | Charge recharge on LR | InventorySystem + EntityManagement |

### Tier 3: Polish for deeper L1-5 play

Everything tagged P2 in the per-flow audits.

---

# 5. Coverage Recommendation (E2E Strategy)

## 5.1 Goals

The current 260 scenarios were written when the engine couldn't drive monster turns or multi-PC parties. Now that it can, the target shape should be:

- **20-30 "rich" multi-turn scenarios** (5-12 turns each) that exercise 5-10 mechanics in one encounter.
- **~80 "focused" scenarios** (1-3 turns) for regression-critical single mechanics (e.g., Shield spell AC applies retroactively).
- **~30 "edge case" scenarios** for rare interactions (e.g., crit on paralyzed, Sleep on immune fey).

Target total: **~140 scenarios** (down from 260), net 50%+ more mechanic coverage per scenario.

## 5.2 Proposed scenario set (new + consolidated)

### Long-form multi-turn (new) — exercise Tier 1/2 mechanics in combination

| Scenario | Turns | Exercises |
|---|---|---|
| `horde-encounter.json` | 8+ | AoE + zone + multi-target + concentration + resource depletion (party of 4 vs 6 goblins + hobgoblin captain) |
| `boss-battle-legendary.json` | 9+ | Legendary actions + lair actions + concentration (party of 4 vs CR4 legendary creature) |
| `spell-duel.json` | 7+ | Counterspell + Dispel + concentration chains (Wizard vs Wizard) |
| `dungeon-crawl-short-rest.json` | 12+ | Two encounters with SR between; tests slot/pool recovery (party of 3, 2 fights, 1 SR) |
| `condition-stacking.json` | 5+ | Grappled + prone + poisoned + frightened simultaneously |
| `martial-extra-attack-l5.json` | 5+ | Fighter L5 Extra Attack + Action Surge + weapon mastery |
| `caster-resource-economy.json` | 10+ | Wizard L5 full spell slot depletion + cantrip scaling + concentration swap |
| `reaction-chain.json` | 5+ | OA + Shield + Counterspell + Absorb Elements in one encounter |
| `grapple-drag-ledge.json` | 4+ | Grapple + shove + fall damage + OA (once fall damage implemented) |
| `surprise-round.json` | 3+ | Surprise init disadvantage + stealth + first-round only (once surprise implemented) |

### Consolidations (replace 30+ scenarios with 10)

| New | Replaces |
|---|---|
| `rage-full-lifecycle.json` | 7 rage variants |
| `sneak-attack-conditions.json` | 6 sneak attack variants |
| `death-save-full-cycle.json` | 4 death save variants |
| `advantage-disadvantage-unified.json` | 6 advantage/disadvantage variants |
| `cover-ac-and-dex.json` | 2 cover variants |
| `dash-unified.json` | 2 dash variants |
| `healing-instant.json` + `healing-over-time.json` | 8 scattered healing |

### Gap-fillers

New scenarios to cover holes once underlying mechanics are implemented:

- `exhaustion-accumulation.json` (once CombatRules exhaustion implemented)
- `fall-damage-sequence.json` (once fall damage implemented)
- `long-rest-slot-recovery.json` (once rest ops implemented)
- `short-rest-warlock-pact.json` (once SR + pact slots work)
- `dispel-magic-concentration-break.json` (once Dispel implemented)
- `material-component-revivify.json` (once enforcement implemented)
- `subclass-cleric-life-heal.json` (once subclass framework implemented)
- `multi-pc-coordination-help.json` (4-PC cooperative encounter using Help, Dodge, Ready)

### Keep as-is

The unit-style `core/*` scenarios that test a genuinely independent mechanic (e.g., `concentration-damage-break.json`, `critical-hit.json`, `condition-immunity.json`) stay — they serve as regression anchors.

## 5.3 Phase 4 Status (actual execution)

### Completed
- **Consolidations landed** (7 deletions, 2 replacements):
  - `rage-full-lifecycle.json` replaces `rage.json` + `rage-ends.json` + `rage-resistance.json`
  - `cover-unified.json` replaces `cover-ac-bonus.json` + `cover-dex-save-bonus.json`
  - `dash-movement.json` + `dash-extra-movement.json` removed (redundant)

- **5 new multi-turn scenarios landed** (all passing):
  - `core/short-rest-between-fights.json` — `takeSessionRest(short)` + hit-dice spending + SR pool refresh
  - `core/long-rest-full-recovery.json` — `takeSessionRest(long)` full HP + all slots + LR pools
  - `core/condition-stacking.json` — 4 simultaneous conditions + disadvantage attack
  - `class-combat/core/reaction-chain.json` — multi-PC reaction economy (Wizard + Rogue vs Ogre + Orc)
  - `class-combat/core/dungeon-crawl-short-rest.json` — 2-encounter sequence with SR between
  - `class-combat/fighter/martial-extra-attack-l5.json` — Fighter Action Surge + Extra Attack + Second Wind

- **6 gap-filler scenarios** in `scenarios-pending/` (outside runner discovery):
  - `exhaustion-accumulation.json` — needs CombatRules exhaustion consumption
  - `fall-damage-sequence.json` — needs CombatRules fall damage
  - `counterspell-2024-con-save.json` — needs 2024 Counterspell rules port
  - `d20-interrupt-bardic-inspiration.json` — needs roll-interrupt architectural hook
  - `dispel-magic-concentration-break.json` — needs Dispel Magic spell + handler
  - `horde-encounter.json` — needs SpellSystem auto-AoE target resolution

### Dropped (not viable)
- **Death save consolidation** — each outcome (stabilize / dead / nat-20 revive / nat-1 double-fail) needs a distinct character at 1 HP being KO'd. Consolidating via multi-PC runs into initiative/timing complexity; the 4 originals stay.

### Not yet written (future work)
- **`boss-battle-legendary.json`** (9+ turns) — needs legendary monster stat block with legendary actions; stat blocks for CR 4-5 monsters missing per audit.
- **`spell-duel.json`** — caster-vs-caster concentration chain. Can be written with current mechanics (Counterspell 2014-style works).
- **`caster-resource-economy-extended.json`** — extend existing `class-combat/wizard/spell-slot-economy.json` to 15+ turns with concentration swapping.

### Full suite status
**260 → 263 scenarios, 263/263 passing, 0 flaky** (the previously-flaky `core/party-vs-goblins` also now passes).

---

# 6. Appendix — Audit Source Files

| Flow | File |
|---|---|
| CombatRules | [audit-CombatRules.md](audit-CombatRules.md) |
| ClassAbilities | [audit-ClassAbilities.md](audit-ClassAbilities.md) |
| SpellSystem | [audit-SpellSystem.md](audit-SpellSystem.md) |
| SpellCatalog | [audit-SpellCatalog.md](audit-SpellCatalog.md) |
| CombatOrchestration | [audit-CombatOrchestration.md](audit-CombatOrchestration.md) |
| ActionEconomy | [audit-ActionEconomy.md](audit-ActionEconomy.md) |
| ReactionSystem | [audit-ReactionSystem.md](audit-ReactionSystem.md) |
| CombatMap | [audit-CombatMap.md](audit-CombatMap.md) |
| AIBehavior | [audit-AIBehavior.md](audit-AIBehavior.md) |
| AISpellEvaluation | [audit-AISpellEvaluation.md](audit-AISpellEvaluation.md) |
| EntityManagement | [audit-EntityManagement.md](audit-EntityManagement.md) |
| CreatureHydration | [audit-CreatureHydration.md](audit-CreatureHydration.md) |
| InventorySystem | [audit-InventorySystem.md](audit-InventorySystem.md) |
| E2E Scenarios | [audit-E2E-Scenarios.md](audit-E2E-Scenarios.md) |

---

## Verification-Pass Notes (post-audit spot-checks)

After the initial 14 audits, a verification pass checked every UNVERIFIED item against source. Results:

**Confirmed-implemented (initial audits wrong):**
- `takeSessionRest(sessionId, restType, hitDiceSpending?)` in `character-service.ts:193-368` — short AND long rest with resource pool refresh, hit dice spend.
- `Character.levelUp()` / `levelUpWith()` in `character.ts:455-491`.
- Typed `SubclassDefinition` per class + `getSubclassDefinition()` in `registry.ts`.
- `Character.experiencePoints` (not `experience`).
- "RestCompleted" event type emitted in `character-service.ts:361`.
- Creature-as-cover returns `"half"` at `combat-map-sight.ts:184` (RAW-compliant).
- Shield +5 AC persists via ActiveEffect `until_start_of_next_turn` in `attack-reaction-handler.ts:646-661`.
- Reaction reset fires via `freshActionEconomy` at start of own turn (`combat.ts:185`).

**Confirmed missing (audits correct):**
- d20 roll-interrupt hook (no `interruptRoll`, `onD20Roll`, `rollInterrupt` pattern).
- Counterspell 2024 rules — `spell-reaction-handler.ts:283-308` uses 2014 mechanic.
- Background field on Character.
- Inspiration grant/spend events (grantInspiration, spendInspiration).
- Innate Sorcery executor, Sorcerous Restoration, Magical Cunning, Slow Fall, Divine Spark, Sear Undead, Divine Order, Primal Order, Tactical Mind, Tactical Shift, Steady Aim, Ritual Adept, Arcane Recovery executor file.
- Monster catalog: Knight, Orc, Kobold, Wolf, Dire Wolf, Giant Spider, Ogre (living), Gnoll, Ghoul, Wight, Owlbear, Brown Bear.

**Confirmed partial (architectural):**
- Stunning Strike, Divine Smite, Cunning Strike — inline in `hit-rider-resolver.ts`, not dedicated executors.
- Wild Shape — temp HP grant + stat resource flags, not full stat-block replacement.
- Patron subclass procs — pure functions but no kill-trigger event bus.
- Character.hitDice — tracked in sheet JSON, not typed domain field.

See [audit files](./) for per-flow detail. The consolidated priority table above reflects the verified state.
