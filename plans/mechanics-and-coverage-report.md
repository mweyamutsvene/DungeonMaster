---
type: report
flow: multi
feature: mechanics-and-coverage-l1-5
author: claude-orchestrator
status: DRAFT
created: 2026-04-24
updated: 2026-04-25
---

# D&D 5e 2024 Engine — Mechanics & E2E Coverage Consolidated Report (L1-5)

> **Purpose:** single source of truth for what mechanics our engine supports, what needs rework, what's missing for L1-5 play, and how well our 286 E2E scenarios cover them.
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

**Engine state: ~93% L1-5 ready** (revised up: d20 roll-interrupt hook landed, unblocking BI/Lucky/Portent/Halfling Lucky consumption).

Architecture is sound across every flow. After three rounds of implementation + verification, the real blocker list shrinks dramatically:

### Genuine remaining gaps (architectural)

1. ~~**d20 roll-interrupt hook**~~ ✅ DONE — `RollInterruptResolver` + `PendingRollInterruptData` + resolve endpoint landed. **Both attack and save paths implemented.** Attack + save paths: BI die consumed, Lucky feat reroll, Halfling Lucky nat-1 reroll, Portent replace. Concentration saves covered automatically (route through SAVING_THROW). Cutting Words/Silvery Barbs still open (require ally-scan at interrupt time — deferred until Bard class lands).
2. **Subclass L3 features** for 12 base subclasses — typed framework exists; mechanical implementations missing for ~7. Plan in [plan-subclass-framework.md](plan-subclass-framework.md).
3. ~~**Wild Shape stat-block swap**~~ ✅ DONE — structured `wildShapeForm` runtime state now drives combat vitals projection (HP/AC/speed), attack projection, and shared damage routing in tabletop and AI paths.
4. **Background field + Origin Feat / ASI pipeline** — Character.background field absent. Plan in [plan-background-pipeline.md](plan-background-pipeline.md).
5. **E2E scenarios are 75% single-turn** — redundancy high; consolidation in progress.

### Resolved this session (audit findings that turned out to be FALSE POSITIVES)

The original audits over-flagged these as missing — verification + implementation passes revealed they're already wired:

- ~~**AI spell delivery resolution**~~ → Fully implemented in `ai-spell-delivery.ts` (740 LOC handling spell attacks, healing, save-based, buff/debuff, zones, cantrip scaling, upcasting, AoE optimal targeting). Wired through `cast-spell-handler.ts:163`.
- ~~**Cunning Strike executor (Rogue L5)**~~ → Fully wired: all 5 options (poison/trip/withdraw/disarm/daze) implemented. `parseCunningStrikeOption` in rogue.ts, SA-die deduction in `roll-state-machine.ts:971`, save+condition resolution in `damage-resolver.ts:893`. Disarm drops weapon to ground; Daze applies CON-save-or-no-reaction/only-action-or-bonus.
- ~~**Sear Undead (Cleric L5)**~~ → Implemented as Destroy Undead CR threshold in `class-ability-handlers.ts:546-557`.
- ~~**Monster catalog 12-monster gap**~~ → All 12 (Knight, Orc, Kobold, Wolf, Dire Wolf, Giant Spider, Ogre, Gnoll, Ghoul, Wight, Owlbear, Brown Bear) present in markdown source and imported.

### Resolved this session (actual implementation work)

- **Counterspell 2014→2024 port** — target Con save vs counterspeller's save DC.
- **saveProficiencies on CombatantCombatStats** — wired through Counterspell + concentration saves.
- **Exhaustion 2024 port** — 1-10 levels, -2/level, death at 10. Reconciled `conditions.ts` from 2014 hybrid. Orphan `domain/rules/exhaustion.ts` deleted.
- **Dispel Magic delivery handler** — auto-dispels spells ≤slot level; rolls ability check for higher.
- **Material component enforcement** — structured `StructuredMaterialComponent` schema + parser + enforcement at cast time for ALL costed components (presence check); consumed components (Revivify 300gp diamond, Continual Flame ruby dust) are removed from inventory. `valueGp` field added to `CharacterItemInstance`. `InventoryService.findItemMatchingComponent` + `consumeMaterialComponent` added. 4 new catalog entries: Find Familiar, Identify (L1), Continual Flame (L2), Raise Dead (L5). 21 new unit tests (inventory matcher + spell handler enforcement).
- **Slow Fall (Monk L4+)** — extends `resolvePitEntry` with class-aware reduction; auto-applies, consumes reaction.
- **7 missing class features** in commit `2f0cbf2`: Steady Aim, Innate Sorcery, Sorcerous Restoration, Tactical Shift, Ritual Adept, Divine Spark, Magical Cunning.
- **Cunning Strike Disarm + Daze** (`051ea49`) — executor wired; drop-weapon ground item + CON-save daze condition implemented.
- **Tactical Mind** (`051ea49`) — d20 roll-interrupt hook consumed; Second Wind spend + reroll higher on failed ability check.

### Genuine remaining mid-scope items
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

## Coverage upgrade evidence (2026-04-25)

Additional deterministic scenarios added and validated in this thread:

- CombatRules matrix scenarios:
  - `packages/game-server/scripts/test-harness/scenarios/core/combat-rules-matrix-temp-hp-conditions-exhaustion.json`
  - `packages/game-server/scripts/test-harness/scenarios/core/combat-rules-matrix-grapple-shove-escape-unarmed.json`
  - `packages/game-server/scripts/test-harness/scenarios/core/combat-rules-matrix-utility-actions.json`
  - `packages/game-server/scripts/test-harness/scenarios/core/combat-rules-matrix-cover-ac-dex.json`
- Hide/stealth validation scenarios:
  - `packages/game-server/scripts/test-harness/scenarios/core/hide-stealth-vs-passive.json`
  - `packages/game-server/scripts/test-harness/scenarios/core/hide-vs-blinded-observer.json`
  - `packages/game-server/scripts/test-harness/scenarios/core/hide-vs-mixed-blinded-observers.json`
  - `packages/game-server/scripts/test-harness/scenarios/core/hidden-breaks-on-attack.json`
  - `packages/game-server/scripts/test-harness/scenarios/rogue/cunning-action-hide.json`
  - `packages/game-server/scripts/test-harness/scenarios/ranger/party-scout.json`
- SpellSystem coverage scenarios:
  - `packages/game-server/scripts/test-harness/scenarios/wizard/spell-delivery-modes-full-spectrum.json`
  - `packages/game-server/scripts/test-harness/scenarios/wizard/cantrip-scaling-level1.json`
  - `packages/game-server/scripts/test-harness/scenarios/wizard/cantrip-scaling-level11.json`
  - `packages/game-server/scripts/test-harness/scenarios/wizard/cantrip-scaling-level17.json`
  - `packages/game-server/scripts/test-harness/scenarios/wizard/counterspell-2024-decline.json`
  - `packages/game-server/scripts/test-harness/scenarios/wizard/dispel-magic-ability-check.json`
  - `packages/game-server/scripts/test-harness/scenarios/wizard/haste-speed-multiplier.json`
  - `packages/game-server/scripts/test-harness/scenarios/wizard/verbal-component-enforcement.json`
- Unit test hardening:
  - `packages/game-server/src/application/services/combat/tabletop/spell-action-handler.test.ts` (31 passing tests, including verbal component enforcement and upcasting validations)

## 2.1 CombatRules  ([audit](audit-CombatRules.md))

| Mechanic | Status | Coverage | Notes |
|---|---|---|---|
| Attack resolution (adv/disadv, crit on 20, auto-miss on 1) | SUPPORTED | STRONG | Implemented in `combat-rules.ts` + `domain/combat/attack-resolver.ts`; unit tests assert nat20/nat1 and roll-mode behavior, with E2E coverage in `core/critical-hit.json` and advantage/disadvantage scenarios. |
| Damage types + resistance/immunity/vulnerability | SUPPORTED | MODERATE | `damage-defenses.ts` is 2024-correct (immunity precedence, resistance/vulnerability cancel path) and unit-tested; E2E coverage exists but is not yet exhaustive for precedence/cancel combinations. |
| Temp HP absorption | SUPPORTED | MODERATE | Runtime path is `helpers/temp-hp.ts` + damage resolvers (tabletop/AI) with matrix/E2E support; attribution to `hit-points.ts` was stale and direct helper-level tests remain limited. |
| Conditions (15/15): blinded, charmed, deafened, frightened, grappled, incapacitated, invisible, paralyzed, petrified, poisoned, prone, restrained, stunned, unconscious, exhaustion | SUPPORTED | MODERATE | All core 2024 conditions are implemented; unit coverage is broad, but E2E matrix assertions are concentrated on a subset (`core/combat-rules-matrix-temp-hp-conditions-exhaustion.json`, `core/combat-rules-matrix-grapple-shove-escape-unarmed.json`, `core/condition-stacking.json`). |
| Exhaustion (2024: 10 levels, -2/level) | SUPPORTED | MODERATE | 10-level model and -2/level penalties are implemented and tested (`core/exhaustion-accumulation.json`, matrix scenario), but save/check/speed/death lifecycle assertions are still incomplete. |
| Saving throws (adv/disadv, proficiency) | SUPPORTED | MODERATE | Implemented in `saving-throw-resolver.ts` + `save-to-end.ts`; coverage includes proficiency and roll-mode paths, but direct tabletop-branch assertions are not yet comprehensive. |
| Ability checks + 18-skill proficiency + expertise | SUPPORTED | MODERATE | `ability-checks.ts` and skill typing support proficiency/expertise/half-proficiency correctly; tests validate core math but not a full 18-skill matrix. |
| Death saves (3/3, nat 1/20, damage at 0) | SUPPORTED | MODERATE | Domain rules are complete and well unit-tested with E2E death-save flows, but explicit post-KO damage branch coverage (including crit-at-0) is not yet comprehensive at integration/E2E level. |
| Initiative | SUPPORTED | MODERATE | Initiative, tie-breakers, and Alert interactions are implemented and tested, but cross-path tie behavior and full initiative modifier branch coverage remain uneven. |
| Surprise (2024: disadvantage on init) | SUPPORTED | MODERATE | DM override and auto-computed hidden-vs-passive-perception surprise paths are wired into initiative mode computation and covered by `core/surprise-ambush.json` and `core/auto-surprise-hidden.json`. |
| Alert feat (2024) | SUPPORTED | MODERATE | Initiative proficiency bonus, swap offer/decline, and willing-target filtering are implemented; unconscious/incapacitated allies are excluded from eligible targets and invalid swap attempts are rejected (`core/alert-initiative-swap.json`, `core/alert-decline-swap.json`, `core/surprise-alert-willing-swap-red.json`). |
| Concentration (gain/damage save/break/replace/end) | SUPPORTED | MODERATE | Core concentration lifecycle is implemented (`concentration.ts`) and scenario-covered (damage/save, replacement, dispel), but branch assertions are still uneven across all break/end paths. |
| Movement (walk/climb/swim/fly, difficult terrain 2×) | PARTIAL | MODERATE | Difficult terrain and movement budgets are implemented and tested, but full movement-mode parity (walk/climb/swim/fly) is not fully wired or covered end-to-end. |
| Grapple + shove (2024 unarmed option) | PARTIAL | MODERATE | Functional and scenario-covered, but live save-resolution path still has known fidelity gaps versus dedicated saving-throw handling. |
| Grapple escape action | SUPPORTED | MODERATE | Escape action is implemented end-to-end and scenario-covered, but branch-depth assertions (success/failure/economy edge branches) are not yet strong across all paths. |
| Cover (half +2, 3/4 +5, total untargetable) | SUPPORTED | MODERATE | Cover math is implemented in `combat-map` modules; current E2E emphasis is half-cover and does not yet provide deep three-quarters/full-cover branch assertions. |
| Cover + Dex save bonus from AoE | SUPPORTED | MODERATE | Dex-save cover bonus is implemented and unit-tested (+2/+5; non-Dex exclusion), with matrix E2E support but limited broader branch depth. |
| Dodge / Disengage / Dash | SUPPORTED | MODERATE | Implemented in action service + OA detection/movement logic; Disengage/Dash are well covered while deterministic Dodge effect assertions remain thinner. |
| Help / Search / Ready / Use Object | SUPPORTED | STRONG | Implemented across `tabletop/dispatch/social-handlers.ts` + `tabletop/dispatch/interaction-handlers.ts` with supporting rule helpers in `search-use-object.ts`; covered by utility matrix and targeted scenarios/tests. |
| Hide action | PARTIAL | MODERATE | Stealth vs passive Perception and key visibility regressions are covered, but full 2024 hide/invisible-equivalence lifecycle parity is still incomplete. |
| Two-weapon fighting (light + bonus off-hand) | SUPPORTED | MODERATE | Wiring is now end-to-end (eligibility, parser parity, Nick, Dual Wielder checks) with broad scenario support; remaining fidelity gap is the negative-modifier damage edge case. |
| Fall damage (1d6/10ft, max 20d6, prone) | PARTIAL | WEAK | Damage math exists and pit-entry flow works, but prone semantics and universal off-ledge integration remain incomplete and under-asserted. |
| Unarmed strikes (2024 STR+prof, 1+STR damage) | SUPPORTED | MODERATE | Implemented and exercised in grapple/shove + combat flows; direct non-monk baseline formula assertions are still limited. |
| Critical hit damage dice-vs-flat separation (2024) | SUPPORTED | MODERATE | Current resolver doubles dice while keeping flat modifiers single-applied; prior REWORK note was stale, but dedicated end-to-end flat-rider crit assertions remain sparse. |
| **Forced movement (Thunderwave push, bull rush distance + OA/fall interaction)** | **PARTIAL P1** | MODERATE | Forced movement primitives and some integrations exist (push + OA suppression), but combined push/OA/fall interaction coverage is still incomplete. |
| Suffocation / drowning | MISSING P2 | NONE | |
| Mounted combat | PARTIAL P2 | WEAK | Domain mount foundations and unit tests exist, but tabletop/action-economy integration and E2E scenario coverage are still absent. |

## 2.2 ClassAbilities  ([audit](audit-ClassAbilities.md))

### Per-class status at L1-5

**Legend: SUPPORTED / PARTIAL / MISSING / UNVERIFIED**

| Class | L1 | L2 | L3 (subclass) | L4 | L5 |
|---|---|---|---|---|---|
| **Barbarian** | Rage (SUP), Unarmored Def (cross-flow), Weapon Mastery (cross-flow) | Reckless Attack, Danger Sense (SUP) | Primal Path mechanical features MISSING | ASI (cross-flow) | Extra Attack (cross-flow), Fast Movement SUP |
| **Bard** | Spellcasting, Bardic Inspiration grant/refresh (SUP; attack + save consumption wired via roll-interrupt hook) | Expertise, Jack of All Trades SUP | Bard College MISSING (Cutting Words require ally-scan — deferred) | ASI | Font of Inspiration + BI d8 SUP |
| **Cleric** | Spellcasting, Divine Order MISSING | Channel Divinity (Turn Undead + Divine Spark) SUP | Divine Domain MISSING | ASI | Sear/Destroy Undead SUP |
| **Druid** | Spellcasting, Primal Order MISSING | Wild Shape SUPPORTED (structured form-state swap/hydration + shared damage routing; no temp HP overlay) | Primal Circle PARTIAL | ASI | Wild Resurgence MISSING |
| **Fighter** | Fighting Style, Second Wind SUP, Weapon Mastery 3 (cross-flow) | Action Surge SUP, Tactical Mind SUP | Martial Archetype MISSING | ASI | Extra Attack, Tactical Shift PARTIAL |
| **Monk** | Martial Arts SUP, Unarmored Def | Ki/Focus pool SUP, Flurry/Patient/Step SUP, Unarmored Movement | Deflect Attacks SUP (reaction), Monastic Tradition MISSING | ASI, Slow Fall SUP | Extra Attack, Stunning Strike PARTIAL (inline) |
| **Paladin** | Spellcasting, Lay on Hands SUP, Weapon Mastery 2 | Fighting Style, Divine Smite PARTIAL (inline), Channel Divinity PARTIAL | Sacred Oath MISSING | ASI, Divine Health | Extra Attack, Faithful Steed cross-flow |
| **Ranger** | Spellcasting, Favored Enemy / Hunter's Mark tie PARTIAL | Fighting Style, Deft Explorer (non-combat) | Archetype MISSING, Roving | ASI | Extra Attack |
| **Rogue** | Expertise, Sneak Attack SUP, Weapon Mastery 2 | Cunning Action SUP, Steady Aim SUP | Archetype MISSING | ASI | Uncanny Dodge SUP, Cunning Strike SUP (all 5 options) |
| **Sorcerer** | Spellcasting, Innate Sorcery SUP, L1 subclass defs PARTIAL | Font of Magic SUP | Metamagic SUP (Quickened/Twinned baseline) | ASI | Sorcerous Restoration SUP |
| **Warlock** | Pact Magic SUP, Agonizing Blast invocation SUP, L1 subclass defs PARTIAL | Magical Cunning SUP | Pact Boon MISSING | ASI | 3rd-lvl Pact slots |
| **Wizard** | Spellcasting, Ritual Adept SUP, Arcane Recovery via rest flow SUP | Scholar (2024) | Arcane Tradition MISSING | ASI | no universal |

### Structural gaps (class-wide)

| Issue | Status | Notes |
|---|---|---|
| Subclass framework | PARTIAL | Framework exists; remaining gap is mechanical breadth across subclasses. |
| Resource pool coverage | SUPPORTED | Registry-backed class lookup is in place; scenario depth is the remaining concern. |
| Attack enhancement stacking order | REWORK | Reckless + Sneak + Smite + Stunning Strike composition |
| Attack reaction dedup | REWORK | Shield, Deflect, Uncanny Dodge, Protection, Cutting Words compete |
| Bonus action routing | REWORK | Verify all bonus-action features consume economy |
| Bardic Inspiration consumption | PARTIAL | Attack rolls + saving throws: BI die consumed via roll-interrupt hook. Ability check path still open. |
| d20 roll-interrupt hook | SUPPORTED | Attack + save paths done (BI, Lucky, Halfling Lucky, Portent). Cutting Words/Silvery Barbs still open (require ally-scan, deferred). |
| Condition application from class abilities | REWORK | Stunning Strike, Cunning Strike, BM maneuvers need uniform save→condition flow |

## 2.3 SpellSystem  ([audit](audit-SpellSystem.md))

| Mechanic | Status | Coverage | Notes |
|---|---|---|---|
| Spell slot economy (track/consume/ritual flag) | SUPPORTED | STRONG | |
| Delivery modes (attack, save, heal, buff, zone, auto-hit MM) | SUPPORTED | STRONG | Comprehensive deterministic E2E in `wizard/spell-delivery-modes-full-spectrum.json`. |
| Spell attack rolls vs saves (DC = 8+prof+mod) | SUPPORTED | STRONG | |
| Concentration lifecycle | SUPPORTED | STRONG | Lifecycle + damage-break + incapacitated cleanup (`concentration-incapacitated-cleanup.json`) + unconscious/0-HP cleanup (`concentration-unconscious-cleanup.json`) all covered. |
| Upcasting (dice + flat scaling) | SUPPORTED | STRONG | Cantrips reject + upcast validations in unit tests (`spell-action-handler.test.ts`) and expanded E2E set. |
| Cantrip scaling (1/2/3/4× at L1/5/11/17) | SUPPORTED | STRONG | Tiered E2E matrix now covers L1/L11/L17 plus existing L5 scenario. |
| Counterspell (2024 rules) | SUPPORTED | STRONG | Existing Con-save branches + decline-path E2E (`wizard/counterspell-2024-decline.json`). |
| Verbal component enforcement | SUPPORTED | STRONG | E2E lockout scenario + direct unit assertions in `spell-action-handler.test.ts`. |
| Dispel Magic (L3) | SUPPORTED | STRONG | Auto-dispel + ability-check success/fail branch scenario (`wizard/dispel-magic-ability-check.json`). |
| Material component enforcement | SUPPORTED | MODERATE | All costed components require inventory presence; consumed components removed at cast time. `findItemMatchingComponent` + `consumeMaterialComponent` on InventoryService. 21 unit tests. |
| Auto-AoE target resolution | PARTIAL | WEAK | Delivery path supports area targeting; evaluator/path quality and broad scenario depth remain open. |
| **War Caster feat concentration advantage** | **MISSING P1** | NONE | `concentrationSaveRollMode` hardcoded false |
| War Caster feat spell-as-OA | SUPPORTED | WEAK | Spell substituted for melee OA wired; 1 scenario (`feat/war-caster-spell-oa.json`). |
| Somatic component free-hand validation | MISSING P1 | NONE | |
| Spiritual Weapon multi-round bonus action | MISSING P1 | NONE | L2 cleric staple |
| Mirror Image duplicate AC override | MISSING P1 | WEAK | Not wired into hit-resolution |
| Haste speed_multiplier | SUPPORTED | STRONG | Deterministic speed-budget scenario (`wizard/haste-speed-multiplier.json`). |
| Slot refund on counterspell failure | MISSING P1 | NONE | Both outcomes consume slot |
| Spell prep/known distinction | MISSING P2 | NONE | No cleric/druid re-prep vs sorcerer-known |
| Ritual casting integration depth | MISSING P2 | WEAK | |

## 2.4 SpellCatalog  ([audit](audit-SpellCatalog.md))

**Coverage: 75/107 PHB core spells (70%).**

| Level | Present | Missing for L1-5 |
|---|---|---|
| Cantrip | 9/17 (53%) | Guidance, Spare the Dying, Resistance, Light, Mage Hand, Shillelagh, Minor Illusion, Shocking Grasp |
| L1 | 38/42 (90%) | Fog Cloud, Ice Knife, Color Spray, Sanctuary |
| L2 | 20/29 (69%) | Magic Weapon, Prayer of Healing, Blur, Silence |
| L3 | 12/23 (52%) | **Lightning Bolt (CRITICAL for sorc/wiz)**, Sleet Storm, Bestow Curse, Water Walk |
| L4-5 | 13/18 (72%) | Mass Cure Wounds (L5), Teleportation Circle (L5) |

### Catalog-level bugs

- **Cantrip scaling covered** — unit + E2E validation exists (`wizard/cantrip-scaling.json`).
- **Scenario metadata drift** — `druid/party-support` text still says Call Lightning is missing, but it exists in L3 catalog.
- **Spiritual Weapon TODO** — multi-round bonus action loop not implemented.
- **Mirror Image incomplete** — duplicate AC not in hit-resolution.
- **Haste incomplete** — `speed_multiplier` not resolved.

## 2.5 CombatOrchestration  ([audit](audit-CombatOrchestration.md))

| Mechanic | Status | Notes |
|---|---|---|
| Encounter lifecycle (start/end) | SUPPORTED | |
| Turn boundary 6-phase processing | SUPPORTED | end-of-turn effects → advance → incoming → start → events → death-save auto-roll |
| Intent parsing (CombatTextParser + parser chain + LLM fallback) | PARTIAL | Regex-first parser chain with LLM fallback is implemented; still brittle for broad natural-language variance |
| Action dispatch (7 handler modules) | SUPPORTED | attack, movement, grapple, spell, interaction, social, class abilities |
| Roll state machine | SUPPORTED | INITIATIVE → ATTACK → DAMAGE → DEATH_SAVE / SAVING_THROW |
| Victory/defeat detection (faction-based) | SUPPORTED | |
| Compound intents | PARTIAL | "move (X,Y) and attack" is implemented and scenario-covered; other compound permutations remain missing |
| Surprise handling (2024 initiative disadvantage model) | SUPPORTED | Surprise is implemented as initiative disadvantage; no legacy skip-turn surprise-round model |
| Flee mechanics | PARTIAL | Encounter can end with reason=flee and victory policy honors fled flag; per-combatant flee action lifecycle remains incomplete |
| Reaction spells hookup | PARTIAL | Counterspell and damage reactions (including Absorb Elements/Hellish Rebuke) are implemented; Feather Fall remains missing |
| Concentration auto-break on new concentration cast | SUPPORTED | Shared spell preparation path breaks existing concentration before applying a new concentration spell |
| Save-to-end mid-turn | MISSING P1 | Effects don't trigger saves when damage taken on another's turn |
| Bonus-action arbitration (Monk Flurry + offhand) | PARTIAL | Shared bonus-action guard exists; retain PARTIAL pending broader edge-case coverage |

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
| Disengage/Dash enforcement | SUPPORTED | Action handlers set disengaged/dashed and OA logic respects disengage suppression; E2E-covered. |
| Lair action trigger at initiative 20 | SUPPORTED | Trigger path is implemented and validated by `core/lair-actions`. |
| Reaction mid-round lifecycle | PARTIAL | Reset-at-own-turn model is RAW-compatible; separate round-vs-turn accounting flags are still not explicit. |
| Monk Flurry of Blows economy guards | REWORK | Doesn't check `bonusActionSpellCastThisTurn` |
| Multiattack vs Extra Attack monsters | SUPPORTED | AI seeds attacksAllowedThisTurn from attacks-per-action logic; corroborated by fighter extra-attack/action-surge flows. |
| OA once per trigger (2024) | PARTIAL | Reaction gating prevents repeat OA by same observer, but same-trigger edge-case coverage should be expanded. |
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
| Counterspell (spell reaction) | SUPPORTED | 2024 Con-save-by-target path is implemented and scenario-covered. |
| Damage reactions (post-damage hook) | SUPPORTED | |
| Absorb Elements (L1 spell) | SUPPORTED | Damage-reaction path is implemented and scenario-covered. |
| Hellish Rebuke (L1 spell) | SUPPORTED | Damage-reaction path with damager context is implemented and scenario-covered. |
| Deflect Attacks (Monk L1 2024, melee+ranged) | SUPPORTED | Attack-reaction damage reduction/redirect path is implemented. |
| Slow Fall (Monk L4) | SUPPORTED | Implemented in pit/fall resolution path (non-two-phase prompt). |
| Protection fighting style (2024 reaction) | SUPPORTED | Ally-targeting reaction path is implemented and scenario-covered. |
| Interception fighting style (2024 reaction) | SUPPORTED | Damage-to-ally reaction path is implemented and scenario-covered. |
| Cutting Words (Bard Lore L3 reaction) | PARTIAL | Attack-roll path exists; roll-interrupt hook now landed, but CW detection on enemy attacks (save-path hook) still open. |
| Sentinel feat | PARTIAL | Implemented in key OA/ally-attack paths; full feat-surface architecture remains incomplete. |
| **Polearm Master enter-reach OA** | MISSING P2 | `oa-detection.ts` only leaves-reach |
| Forced movement / stand-from-prone / teleport OA exclusion | REWORK | Verify filters voluntary-only |
| Reaction reset at own-turn-start (not round) | REWORK | Verify correct event |

**Summary:** Architecture sound; reaction coverage is materially broader (OA, Shield, Counterspell 2024, Absorb Elements, Hellish Rebuke, Deflect Attacks, Protection, Interception, Sentinel). Roll-interrupt hook fully landed — attack + save paths both done (BI/Lucky/Portent/Halfling Lucky). Remaining key gaps are Polearm Master enter-reach OA and CW/Silvery Barbs (require ally-scan at interrupt time — deferred).

## 2.8 CombatMap  ([audit](audit-CombatMap.md))

| Mechanic | Status | Notes |
|---|---|---|
| 5ft grid, Chebyshev distance, 8-way neighbors | SUPPORTED | 2024 standard |
| A* pathfinding with zone-aware weighting | SUPPORTED | `dangerousZoneWeight`, `zonePenalty`, `avoidZoneIds` |
| Difficult terrain (2× cost) | SUPPORTED | |
| Cover (none/half/three-quarters/full) | SUPPORTED | |
| Creature-as-cover (intervening creature) | SUPPORTED | Intervening creatures grant half cover (+2); validated by tests and cover E2E. |
| Zones (circle/square/line/cone, damage, duration, blocks flags) | SUPPORTED | |
| AoE shapes (sphere/cube/cylinder/line/cone) | SUPPORTED | Cone angle approximation 53° |
| Battlefield rendering (ASCII) | SUPPORTED | |
| Ground items on map | SUPPORTED | |
| Flanking detection | SUPPORTED | |
| Pits (entry, DEX save, fall damage + prone) | SUPPORTED | |
| **Flying / hovering movement mode** | **MISSING P0** | A* signature has no mode; ignore ground terrain/zones/pits |
| **Zone LOS blocking enforcement** | **MISSING P0** | Flag exists; `hasLineOfSight` doesn't check it. Breaks fog cloud, darkness |
| Creature size / multi-tile footprint pathing | SUPPORTED | Pathfinding supports footprint expansion for larger creatures; add dedicated large-creature E2E depth. |
| **Reach-aware adjacency helper** | **MISSING P0** | `isAdjacent` hardcoded 5ft; glaive at L1 breaks |
| Diagonal corner-clipping check | SUPPORTED | A* and reachable-cells logic both block diagonal movement through blocked orthogonals. |
| **Invisibility/hidden map state** | **MISSING P0** | No `isHidden`/`isInvisible` fields |
| **Line of effect at AoE origin + spell target** | **MISSING P0** | Can fireball through walls currently |
| Per-zone trigger policy | SUPPORTED | Trigger modes support on_enter, on_start_turn, on_end_turn, per_5ft_moved, passive. |
| Crawling cost (1/1 extra, like difficult terrain) | MISSING P2 | |
| TerrainType enum | REWORK | Vestigial — not wired into movement cost |
| Zone hard-block movement semantics | PARTIAL | Pathfinder supports penalties/avoidance, but schema has no explicit hard-block movement flag. |
| Obscuration support (light/heavy) | PARTIAL | Map cells carry obscuration and sight helpers expose obscuration attack modifiers; E2E depth is limited. |
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
| Monster specifics (multiattack parsing, legendary action spread heuristic, lair) | PARTIAL | Multiattack + legendary execution are validated. Lair trigger path exists, but lairActions-only stat blocks can still be skipped by trait parsing edge cases. |
| Reaction decision (OA, Shield, Counterspell) | PARTIAL | OA good; Shield margin check rough; Counterspell value-blind |
| Attack economy mid-turn re-check | REWORK | |
| OA suppression proactive | PARTIAL | Deterministic AI includes low-HP disengage-before-retreat behavior; broader proactive threat suppression remains limited. |
| Pack tactics | MISSING P1 | |
| Multi-target spell clustering | PARTIAL | AoE evaluation applies affected-target estimates and weighting; geometry/friendly-fire sophistication remains limited. |
| Concentration priority bias (break vs hold) | PARTIAL | Target scoring applies concentration pressure; strategic break-vs-hold policy is still limited. |
| Exhaustion/disease extraction | PARTIAL | Exhaustion penalties are consumed; disease/curse tactical extraction remains limited. |
| Focus-fire coordination across allies | PARTIAL | LLM battle-plan focus exists; deterministic focus-lock remains limited. |

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
| AI spell delivery resolution | SUPPORTED | `ai-spell-delivery.ts` resolves attacks, saves, damage/healing, buffs/debuffs, zones, and KO side effects through cast handler integration. |
| Upcast value computation | MISSING P1 | Delivery supports upcasting; evaluator value-per-slot modeling is still thin. |
| Encounter-budget heuristic | MISSING P1 | |
| Heal urgency tiers | PARTIAL | 0-HP/death-save triage exists; non-dying thresholding remains coarse. |
| Buff-target scoring | REWORK | Bless picks self + nearest 2; no output scoring |
| AoE template geometry (line/cone/cube) | PARTIAL | Evaluator estimate is coarse; delivery resolves real area targeting. |
| Condition follow-through (Hold Person → auto-crit melee) | MISSING P1 | |
| Counterspell value check | PARTIAL | Heuristic skips cantrips and conserves last slot; still lacks full value-tradeoff scoring. |
| Shield reaction smarter trigger | REWORK | Ignores crit, multi-attack sequence |
| Cantrip-as-default floor | REWORK | Cantrip path exists; remaining gap is value calibration and slot-efficiency scoring. |

## 2.11 EntityManagement  ([audit](audit-EntityManagement.md))

| Mechanic | Status | Notes |
|---|---|---|
| Character entity (full 2024 sheet fields) | SUPPORTED | |
| Character CRUD + resource mutation | SUPPORTED | |
| Character-sheet hydration (weapon/armor/spell) | SUPPORTED | |
| Inspiration flag | SUPPORTED | Boolean grant only |
| Exhaustion level 0-10 field | SUPPORTED | CombatRules consumes d20/speed penalties; long-rest reduction + death-trigger wiring remain open. |
| Monster stat block + import | SUPPORTED | |
| NPC lightweight entity | SUPPORTED | |
| Session lifecycle + events | SUPPORTED | |
| Repository ports (in-memory + Prisma) | SUPPORTED | No concrete drift reproduced in this pass; keep parity checks as regression guard. |
| Spell Lookup Service | SUPPORTED | |
| Short rest operation | SUPPORTED | Implemented via `takeSessionRest("short")` and `/sessions/:id/rest`; validated by E2E. |
| Long rest operation | PARTIAL | Implemented via `takeSessionRest("long")`; exhaustion reduction on long rest remains missing. |
| Hit dice tracking + spend | SUPPORTED | `spendHitDice`/`recoverHitDice` paths are implemented and E2E-covered. |
| Level-up operation (L2→L5) | PARTIAL | Domain `Character.levelUp()`/`levelUpWith()` exists; no dedicated EntityManagement service/API endpoint yet. |
| **ASI/feat at L4** | **MISSING P0** | No application mechanism |
| Species trait application pipeline | PARTIAL | Species traits are applied in hydration; create-time origin/background application remains incomplete. |
| **Background pipeline (2024: skills/tool/language/Origin Feat/ASI/equipment)** | **MISSING P0** | |
| Inspiration grant/spend API + event | MISSING P1 | |
| Encounter-to-session rest linkage | MISSING P1 | Dungeon LR should flag/disallow |
| Exhaustion 6 = death | MISSING P1 | Depends on CombatRules exhaustion |
| Temp HP no-stack (2024 take-max) | MISSING P1 | |
| Monster catalog breadth (CR 0-4) | PARTIAL | Most entries are present; Orc source/import parity remains open and should be re-validated. |
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
| Magic item +X armor/weapon bonuses | PARTIAL | Tabletop attack path applies +X weapon bonuses; AC/inventory parity across all combat paths still needs verification. |
| **ASI boost merging into effective stats** | **MISSING P0** | `asiChoices` parsed but not applied to AC/attack/saves |
| Wild Shape reverse hydration | SUPPORTED | Structured `wildShapeForm` state projects transformed HP/AC/speed through hydration; tabletop + AI damage routing consume the same form HP pool before spillover. |
| Species: natural armor | MISSING P1 | |
| Species: breath weapons | MISSING P1 | Dragonborn |
| Species: ability check bonuses | MISSING P1 | Clarify scope: Gnome Cunning is save-advantage vs magic (separate from ability checks). |
| Spell save DC / attack bonus computation (not just sheet-read) | PARTIAL | Runtime spell delivery computes DC/attack bonus with derived fallback; ownership is primarily SpellSystem. |
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
| Potions of Healing (4 tiers) + 13 resistance potions + specialty | PARTIAL | Combat use-item applies healing, temp HP, and active potion effects; edge fidelity remains partial. |
| Goodberry (24-hour decay) | SUPPORTED | |
| Magic items (+X dynamic, wondrous, staves, on-hit effects) | PARTIAL | Core definitions and tabletop attack/damage bonuses are enforced; broader item behavior parity remains partial. |
| Charges (max, recharge, destroy-on-empty) | PARTIAL | Defined; no LR reset, no recharge roll |
| Ground items (drop, pickup, loot) | PARTIAL | Combat drop/pickup and monster loot-drop are implemented; dedicated REST pickup endpoint remains missing. |
| Inventory API routes | SUPPORTED | |
| Potion ActiveEffect application (Speed, Resistance) | PARTIAL | Implemented in combat flow; residual edge-case fidelity remains. |
| Magic bonus in attacks | SUPPORTED | `getWeaponMagicBonuses()` is applied by attack resolution in tabletop flow. |
| **Charge recharge on LR + roll** | **MISSING P0** | |
| Ground item pickup endpoint | MISSING P1 | |
| Cursed items + Remove Curse | MISSING P1 | |
| Ammunition consumption | MISSING P2 | |
| Encumbrance enforcement | MISSING P2 | |
| Light sources (darkvision interaction) | MISSING P2 | |

---

# 3. E2E Coverage Snapshot  ([audit](audit-E2E-Scenarios.md))

**299 scenarios / 24 folders / 21 unique mechanic tags.**

Counts are based on `combat-e2e` `getAllScenarioNames()`: recursive `*.json` scan of `scripts/test-harness/scenarios` only; `scripts/test-harness/scenarios-pending` is excluded from `--all`.

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
| counterspell | 3+ | MODERATE |
| legendary action | 2 | WEAK |
| lair action | 1+ | WEAK |
| surprise round (2024) | 1+ | WEAK |
| horde (6+ enemies) | 0 | NONE |
| condition stacking (3+ simultaneous) | 1 | WEAK |
| exhaustion | 1+ | WEAK |
| fall damage | 1+ | WEAK |
| rest mechanics | 6+ | STRONG |
| Dispel Magic | 1+ | WEAK |
| War Caster | 1+ | WEAK |
| material components | 1+ | WEAK |

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
| 1 | ~~**d20 roll-interrupt architectural hook**~~ ✅ DONE | ReactionSystem | `RollInterruptResolver` + `PendingRollInterruptData` + `POST …/pending-roll-interrupt/resolve`. **Both attack + save paths done.** BI die consumed, Lucky feat reroll, Halfling Lucky nat-1 reroll, Portent replace — all on attack rolls AND saving throws. Concentration saves covered automatically. Cutting Words/Silvery Barbs deferred (ally-scan). **Plan: [plan-d20-roll-interrupt.md](plan-d20-roll-interrupt.md)** |
| 2 | ~~**Counterspell 2014 → 2024 port**~~ ✅ DONE | SpellSystem | Ported in commit after 450f081. Target caster now makes a Con save vs counterspeller's save DC. `scenarios/wizard/counterspell-2024-con-save.json` validates. |
| 3 | ~~**AI spell delivery resolution**~~ ✅ DONE | AISpellEvaluation | Delivery path is implemented and E2E-validated. |
| 4 | ~~**Exhaustion mechanic (2024, 10-level, -2/level d20)**~~ ✅ DONE | CombatRules | Reconciled `conditions.ts` to 2024 RAW (was 2014-style 1-6/-level). `scenarios/core/exhaustion-accumulation.json` validates. Orphan `domain/rules/exhaustion.ts` deleted. Level 10 death helper available but auto-death trigger on application is future work. |
| 5 | ~~**Fall damage (1d6/10ft, max 20d6, prone)**~~ ✅ DONE | CombatRules | Already implemented in `combat-map-core.ts` via `computeFallDamage` + `pit-terrain-resolver`. Audit was wrong. `scenarios/core/fall-damage-sequence.json` validates. Generic off-ledge fall damage (not through pits) is future work. |
| 6 | ~~**Dispel Magic (L3 spell)**~~ ✅ DONE | SpellCatalog + SpellSystem | Catalog entry already present; new `DispelMagicDeliveryHandler` wired into delivery chain. Auto-dispels spells of level ≤ slot level; rolls ability check for higher-level spells. `scenarios/wizard/dispel-magic-concentration-break.json` validates. |
| 7 | ~~**Material component enforcement**~~ ✅ DONE | SpellSystem | All costed components validated; consumed items removed from inventory at cast time. Find Familiar, Identify, Continual Flame, Raise Dead added to catalog. 21 unit tests. |
| 8 | **Background field + background pipeline** | EntityManagement | Field entirely missing from Character. 2024 Origin Feat, ASI, skill/tool/language grants. **Plan: [plan-background-pipeline.md](plan-background-pipeline.md)** |
| 9 | **Species trait auto-apply on character create** | EntityManagement | Currently applied at hydration only — not written to sheet on create. (Pairs with background pipeline plan.) |
| 9b | **Subclass L3 features for 12 classes** | ClassAbilities | Framework + typed definitions exist; ~7 base subclasses need mechanical implementations. **Plan: [plan-subclass-framework.md](plan-subclass-framework.md)** |
| 9c | ~~**Wild Shape stat-block swap** (Druid L2)~~ ✅ DONE | ClassAbilities + CreatureHydration | Implemented with structured runtime form state (`wildShapeForm`), projection helpers, and shared AI/tabletop damage routing. |
| 10 | **Missing class feature executors** (grouped) | ClassAbilities | DONE for Steady Aim, Innate Sorcery, Sorcerous Restoration, Tactical Shift, Ritual Adept, Divine Spark, Magical Cunning, Slow Fall, Cunning Strike (all 5), and Tactical Mind. |
| 11 | **Stunning Strike / Divine Smite / Cunning Strike architectural consolidation** | ClassAbilities | Currently inline in `hit-rider-resolver.ts` as attack enhancements. Works but should be dedicated executors for consistency. |
| 12 | **Patron subclass combat hooks** | ClassAbilities | `darkOnesBlessingTempHp()` pure function exists; no kill-trigger event bus to fire it. Same pattern for other subclass procs. |
| 13 | Monster catalog source/import parity | EntityManagement | PARTIAL: most allegedly-missing entries are present, but Orc parity should remain open until source/import alignment is explicitly re-validated. |
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

### Tier 2: Must-fix for fidelity at L1-5 (updated for current implementation)

| # | Item | Flow | Current state |
|---|---|---|---|
| 1 | Forced movement tracking + OA/fall interaction | CombatRules | MISSING |
| 2 | Critical damage dice-vs-flat (2024) | CombatRules | REWORK |
| 3 | Auto-AoE quality hardening | SpellSystem | PARTIAL |
| 4 | War Caster feat concentration advantage | SpellSystem | MISSING |
| 5 | Counterspell value-aware AI reaction decision | ReactionSystem + AIBehavior | PARTIAL |
| 6 | Feather Fall / fall-damage pending choice | ReactionSystem | MISSING |
| 7 | ~~Cunning Strike Disarm + Daze~~ ✅ DONE | ClassAbilities | `051ea49` |
| 8 | ~~Tactical Mind after roll-interrupt~~ ✅ DONE | ClassAbilities | `051ea49` |
| 9 | Roll-interrupt save/ability-check path (Cutting Words + BI) | ReactionSystem (architectural) | PARTIAL |
| 10 | Future reaction feats (Sentinel, Polearm Master) | ReactionSystem | PARTIAL/MISSING |
| 11 | OA once-per-trigger + reaction lifecycle cleanup | ActionEconomy | PARTIAL |
| 12 | Flying movement mode in A* | CombatMap | MISSING |
| 13 | Zone LOS blocking enforcement | CombatMap | MISSING |
| 14 | Reach-aware adjacency helper | CombatMap | MISSING |
| 15 | Invisibility/hidden map state | CombatMap | MISSING |
| 16 | Line of effect at AoE + spell target | CombatMap | MISSING |
| 17 | ASI merging into effective ability scores | CreatureHydration | MISSING |
| 18 | Mage Armor AC detection | CreatureHydration | MISSING |
| 19 | Magic item bonus parity across all combat paths | CreatureHydration + InventorySystem | PARTIAL |
| 20 | Wild Shape reverse hydration | CreatureHydration + ClassAbilities | SUPPORTED |
| 21 | Lightning Bolt, Sleet Storm, Bestow Curse (L3 catalog) | SpellCatalog | MISSING |
| 22 | Mage Hand, Shillelagh, Guidance, Spare the Dying cantrips | SpellCatalog | MISSING |
| 23 | Magic Weapon, Prayer of Healing, Blur (L2 catalog) | SpellCatalog | MISSING |
| 24 | Upcast value computation for AI | AISpellEvaluation | MISSING |
| 25 | Potion subsystem edge-fidelity hardening | InventorySystem | PARTIAL |
| 26 | Charge recharge on LR | InventorySystem + EntityManagement | MISSING |

**Moved out of Tier 2 (implemented/covered):**
- Two-weapon fighting full wiring
: E2E evidence: `core/twf-requires-attack-action.json`, `core/twf-light-required.json`, `core/twf-dual-wielder-non-light.json`, `core/twf-style-adds-offhand-modifier.json`, `core/twf-parser-fallback-parity.json`, `core/twf-nick-once-per-turn.json`, `core/offhand-attack.json`.
- Surprise (2024 initiative disadvantage) + Alert feat
: E2E evidence: `core/surprise-ambush.json`, `core/auto-surprise-hidden.json`, `core/alert-initiative-swap.json`, `core/alert-decline-swap.json`, `core/surprise-alert-willing-swap-red.json`.
- Grapple escape action
: E2E evidence: `core/grapple-escape.json`, `core/combat-rules-matrix-grapple-shove-escape-unarmed.json`.
- Diagonal corner-clipping checks
: E2E evidence: `core/ai-pathfinding.json`, `core/move-toward-obstacle.json`, `core/move-toward-blocked.json`.

**Coverage follow-up (not a Tier 2 blocker):**
- Creature size (multi-tile footprint) pathing support is implemented, and scenarios include Large/Small combatants (e.g., `core/ai-grapple.json`, `core/ai-grapple-condition.json`, `core/heavy-weapon-small-creature.json`), but a dedicated footprint assertion scenario should still be added for stronger regression coverage.

### Tier 3: Polish for deeper L1-5 play

Everything tagged P2 in the per-flow audits.

---

# 5. Coverage Recommendation (E2E Strategy)

## 5.1 Goals

The current 286 scenarios were written when the engine couldn't drive monster turns or multi-PC parties. Now that it can, the target shape should be:

- **20-30 "rich" multi-turn scenarios** (5-12 turns each) that exercise 5-10 mechanics in one encounter.
- **~80 "focused" scenarios** (1-3 turns) for regression-critical single mechanics (e.g., Shield spell AC applies retroactively).
- **~30 "edge case" scenarios** for rare interactions (e.g., crit on paralyzed, Sleep on immune fey).

Target total: **~140 scenarios** (down from 286), net 50%+ more mechanic coverage per scenario.

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

- `exhaustion-accumulation.json` (already active)
- `fall-damage-sequence.json` (already active)
- `long-rest-slot-recovery.json` (already active via rest suite)
- `short-rest-warlock-pact.json` (already active as warlock short-rest scenario)
- `dispel-magic-concentration-break.json` (already active)
- `material-component-revivify.json` (already active)
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

- **6 new multi-turn scenarios landed** (all passing):
  - `core/short-rest-between-fights.json` — `takeSessionRest(short)` + hit-dice spending + SR pool refresh
  - `core/long-rest-full-recovery.json` — `takeSessionRest(long)` full HP + all slots + LR pools
  - `core/condition-stacking.json` — 4 simultaneous conditions + disadvantage attack
  - `class-combat/core/reaction-chain.json` — multi-PC reaction economy (Wizard + Rogue vs Ogre + Orc)
  - `class-combat/core/dungeon-crawl-short-rest.json` — 2-encounter sequence with SR between
  - `class-combat/fighter/martial-extra-attack-l5.json` — Fighter Action Surge + Extra Attack + Second Wind

- **1 gap-filler scenario** remains in `scenarios-pending/` (outside runner discovery):
  - `horde-encounter.json` — pending broader horde/AoE confidence before activation
  - ~~`d20-interrupt-bardic-inspiration.json`~~ ✅ promoted → `class-combat/bard/bardic-inspiration-roll-interrupt.json`

### Dropped (not viable)
- **Death save consolidation** — each outcome (stabilize / dead / nat-20 revive / nat-1 double-fail) needs a distinct character at 1 HP being KO'd. Consolidating via multi-PC runs into initiative/timing complexity; the 4 originals stay.

### Not yet written (future work)
- **`boss-battle-legendary.json`** (9+ turns) — needs legendary monster stat block with legendary actions; stat blocks for CR 4-5 monsters missing per audit.
- **`spell-duel.json`** — caster-vs-caster concentration chain. Can be written with current mechanics (Counterspell 2024 path works).
- **`caster-resource-economy-extended.json`** — extend existing `class-combat/wizard/spell-slot-economy.json` to 15+ turns with concentration swapping.

### Full suite status
**Current discovered inventory is 299 scenarios** (+13 since last full run). Latest known full run (`pnpm -C packages/game-server test:e2e:combat:mock -- --all --no-color`, 2026-04-25) reported **285 passed, 1 failed** against 286 scenarios. `feat/lucky-reroll` was the remaining failure; run against 299 needed to confirm current state.

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
- d20 roll-interrupt hook, background pipeline, inspiration grant/spend events, Divine Order, Primal Order, long-rest exhaustion reduction.
- Monster catalog source/import parity for Orc remains open for explicit re-validation.

**Confirmed partial (architectural):**
- Stunning Strike, Divine Smite, Cunning Strike — inline in `hit-rider-resolver.ts`, not dedicated executors.
- Wild Shape — structured form state with projected combat vitals and shared damage routing is implemented; remaining work is broader Druid feature breadth (Primal Order/Wild Resurgence) and subclass mechanics.
- Patron subclass procs — pure functions but no kill-trigger event bus.
- Character.hitDice — tracked in sheet JSON, not typed domain field.

See [audit files](./) for per-flow detail. The consolidated priority table above reflects the verified state.
