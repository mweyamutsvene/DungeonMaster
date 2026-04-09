# Comprehensive Audit Checklist — April 2026

Cross-domain deep dive across all 6 flows. Items grouped by priority tier, then by domain. Each item references the originating SME audit and affected files.

---

## TIER 1 — CRITICAL (Runtime Failures / Incorrect Rules)

### Spell System
- [x] **SS-C1: Hold Person / Cause Fear — no end-of-turn saving throw repeat.** Targets stay Paralyzed/Frightened until concentration drops. D&D 5e 2024 requires repeating the save each turn. Needs a `turnEndSaveRepeat` field on spell catalog + turn-end processing step in `CombatService.processActiveEffectsAtTurnEvent()`.
  - Files: `domain/entities/spells/catalog/level-1.ts`, `domain/entities/spells/catalog/level-2.ts`, `application/services/combat/combat-service.ts`
  - Rule: PHB 2024 Hold Person, Cause Fear

- [x] **SS-C2: Inflict Wounds misclassified as CON save spell.** D&D 5e 2024 Inflict Wounds is a melee spell attack (`attackType: 'melee_spell'`), not a saving throw.
  - Files: `domain/entities/spells/catalog/level-1.ts`
  - Rule: PHB 2024 Inflict Wounds

### Class Abilities
- [x] **CA-C1: 6 text profile action mappings point to non-existent executors (RUNTIME ERROR).** Warlock (eldritch-blast), Bard (bardic-inspiration), Druid (wild-shape), Ranger (hunters-mark), Sorcerer (quickened-spell, twinned-spell). Text matching → `AbilityRegistry.execute()` → `UNREGISTERED_ABILITY` error. Fix: create stub executors or remove mappings.
  - Files: `warlock.ts`, `bard.ts`, `druid.ts`, `ranger.ts`, `sorcerer.ts`, `infrastructure/api/app.ts`

- [x] **CA-C2: Berserker Frenzy — subclass feature defined + feature key exists but NO executor, NO text mapping, NO capability entry.** Core subclass combat feature (bonus action extra attack while raging) is fully gated but completely unwired.
  - Files: `domain/entities/classes/barbarian.ts`, `feature-keys.ts`, `abilities/executors/`
  - Rule: PHB 2024 Path of the Berserker level 3

### AI Behavior
- [x] **AI-C1: AI spell delivery cannot create zone spells.** `AiSpellDelivery` handles attack-roll, healing, save-based, buff/debuff but has zero zone-placement code. Spirit Guardians, Spike Growth, Cloud of Daggers, Wall of Fire are silently no-ops when cast by AI.
  - Files: `application/services/combat/ai/handlers/ai-spell-delivery.ts`

- [x] **AI-C2: Deterministic AI never generates `useFeature` decisions.** The handler exists, types support it, but `DeterministicAiDecisionMaker` has no code path for it. Class features like Turn Undead, Lay on Hands (main action) are LLM-only and unavailable in mock/no-LLM play.
  - Files: `application/services/combat/ai/deterministic-ai.ts`

### Entity Management
- [x] **EM-C1: `findActiveEncounter` Prisma vs Memory behavioral divergence.** Prisma falls back to `encounters[0]` if no "Active" encounter (returns completed/cancelled). Memory returns `null` strictly. Tests pass but production could return wrong encounter.
  - Files: `infrastructure/db/combat-repository.ts`, `infrastructure/testing/memory-repos.ts`

---

## TIER 2 — HIGH (Significant Feature Gaps)

### Combat Rules
- [x] **CR-H1: Missing unit tests for `weapon-mastery.ts`.** 8 mastery types, 34 weapon mappings, eligibility logic — zero unit tests.
  - Files: New test file needed for `domain/rules/weapon-mastery.ts`

- [x] **CR-H2: Missing unit tests for `feat-modifiers.ts`.** (already done) 18+ feat flags, GWF/Dueling application — no dedicated test file.
  - Files: New test file needed for `domain/rules/feat-modifiers.ts`

- [x] **CR-H3: Missing unit tests for `damage-defenses.ts`.** Immunity/resistance/vulnerability interactions untested.
  - Files: New test file needed for `domain/rules/damage-defenses.ts`

### Class Abilities
- [x] **CA-H1: Barbarian Brutal Strike — domain functions exist but not wired to combat.** (already done) `canUseBrutalStrike()`, `getBrutalStrikeBonusDice()` are complete and tested. Missing: `AttackEnhancementDef` in `BARBARIAN_COMBAT_TEXT_PROFILE`, executor, text mapping.
  - Files: `domain/entities/classes/barbarian.ts`, profile + executor needed
  - Rule: PHB 2024 Barbarian level 9

- [x] **CA-H2: Rogue Cunning Action Hide returns `NOT_IMPLEMENTED`.** (already done) Dash and Disengage work. Hide is critical for Sneak Attack eligibility via Hidden condition.
  - Files: `abilities/executors/rogue/cunning-action-executor.ts`

- [x] **CA-H3: Wizard has NO `capabilitiesForLevel()`.** Only implemented spellcasting class without it. AI/tactical view shows no wizard-specific abilities.
  - Files: `domain/entities/classes/wizard.ts`

- [x] **CA-H4: Wholeness of Body pool + capability shown for ALL monks, not just Open Hand subclass.** Phantom resource pool in tactical display; AI may waste actions on non-Open-Hand monks.
  - Files: `domain/entities/classes/monk.ts`

- [x] **CA-H5: Ranger has no resource pools, no `restRefreshPolicy`.** Missing when subclasses are added.
  - Files: `domain/entities/classes/ranger.ts`

- [x] **CA-H6: 12+ feature strings in class definitions not in `feature-keys.ts`.** No compile-time safety; typos are silent bugs. Includes: `jack-of-all-trades`, `font-of-inspiration`, `countercharm`, `eldritch-invocations`, `pact-boon`, `favored-enemy`, `remarkable-athlete`, `additional-fighting-style`, `second-story-work`, `supreme-sneak`, `mindless-rage`, `intimidating-presence`.
  - Files: `domain/entities/classes/feature-keys.ts`, various class files

### Spell System
- [x] **SS-H1: 5 catalog spells have metadata but ZERO mechanical fields.** Misty Step (no teleportation), Dispel Magic (no effect removal), Absorb Elements (no resistance/damage boost), Mage Armor (no AC change), Booming Blade (no melee effect). They silently do nothing when cast.
  - Files: `domain/entities/spells/catalog/level-1.ts`, `level-2.ts`, `level-3.ts`

- [x] **SS-H2: Missing E2E test scenarios for healing spells, zone spells, buff spells, repeat-save spells.** Only attack/damage/counterspell/concentration scenarios exist.
  - Files: `scripts/test-harness/scenarios/wizard/` (new scenarios needed)

---

## TIER 3 — MEDIUM (Incomplete Rules / Missing Features)

### Combat Rules
- [x] **CR-M1: Savage Attacker fires every hit instead of once-per-turn.** D&D 5e 2024 says once per turn. No turn-tracking state in `resolveAttack()`.
  - Files: `domain/combat/attack-resolver.ts`

- [ ] **CR-M2: Multiple damage types per attack not supported.** `AttackSpec` has single `damageType`. Flame Tongue (slashing + fire), Divine Smite (weapon + radiant) need separate resistance checks per type.
  - Files: `domain/combat/attack-resolver.ts`

- [x] **CR-M3: Incapacitated/death doesn't break concentration in domain layer.** Only damage triggers checks. D&D 5e 2024 also ends concentration on Incapacitated or death.
  - Files: `domain/rules/concentration.ts`

- [x] **CR-M4: Grapple/Shove ignores natural 1/20 on attack roll.** Nat 1 should auto-miss, nat 20 should auto-hit the initial strike.
  - Files: `domain/rules/grapple-shove.ts`

- [ ] **CR-M5: `attemptMovement()` uses Euclidean distance instead of alternating diagonal cost.** May be legacy — verify if still called.
  - Files: `domain/rules/movement.ts`

- [ ] **CR-M6: Heavily/lightly obscured areas not implemented.** No obscuration terrain types. Heavy obscuration should grant Blinded condition.
  - Files: `domain/rules/combat-map-types.ts`, `domain/rules/hide.ts`

- [x] **CR-M7: Warlock pact slots may not refresh on short rest.** (already correct — pactMagic uses `refreshOn: "both"`) `rest.ts` blanket checks `spellSlot_*` prefix → long rest only. If Warlock pact slots use that naming, short rest recovery breaks.
  - Files: `domain/rules/rest.ts`

- [x] **CR-M8: Temp HP stacking rule not enforced in domain.** (already done) D&D 5e 2024: temp HP doesn't stack, choose the higher. No domain function validates this.
  - Files: `domain/entities/combat/effects.ts`

- [x] **CR-M9: `DamageEffect.apply()` bypasses damage defenses.** Calls `target.takeDamage()` directly without checking resistance/immunity/vulnerability.
  - Files: `domain/effects/damage-effect.ts`

- [ ] **CR-M10: Dual distance functions in `rules/movement.ts` and `combat/movement.ts`.** Different signatures, maintenance risk.
  - Files: `domain/rules/movement.ts`, `domain/combat/movement.ts`

- [x] **CR-M11: Tough feat HP bonus not applied in creature hydration (existing TODO).** (already implemented in domain — `computeToughBonusHP()` exists)
  - Files: `domain/rules/hit-points.ts`

### Combat Orchestration
- [ ] **CO-M1: Readied action triggers only fire for `creature_moves_within_range`.** Other triggers (creature_attacks) silently ignored. Readied spell concentration not tracked.
  - Files: `tabletop/dispatch/social-handlers.ts`, `two-phase/move-reaction-handler.ts`

- [ ] **CO-M2: Legendary actions between turns not orchestrated.** Charges tracked but no trigger point for AI to spend them between turns.
  - Files: `application/services/combat/combat-service.ts`

- [x] **CO-M3: Bonus action spell limitations not enforced.** (already done) If BA spell cast, only cantrip allowed as action. Not checked.
  - Files: `tabletop/action-dispatcher.ts`, `tabletop/spell-action-handler.ts`

- [ ] **CO-M4: `handleDamageRoll` is ~370 lines — extract to DamageResolver class.**
  - Files: `tabletop/roll-state-machine.ts`

- [ ] **CO-M5: Redundant `listCombatants` calls (5-7 per damage resolution).** Each call is a DB read.
  - Files: `tabletop/roll-state-machine.ts`

- [x] **CO-M6: Sentinel incapacitation check hardcoded to `false` (existing TODO).** (already done)
  - Files: `two-phase/attack-reaction-handler.ts`

- [ ] **CO-M7: `CombatService.nextTurn()` at ~280 lines — growing unwieldy.**
  - Files: `application/services/combat/combat-service.ts`

- [ ] **CO-M8: Duplicated combatant-by-entity-ID lookup pattern across many files.** Should be shared utility.
  - Files: Multiple

- [ ] **CO-M9: Dual OA resolution paths (ActionService.move vs MoveReactionHandler).** Maintenance risk — OA rule changes must be applied in both places.
  - Files: `combat/action-service.ts`, `two-phase/move-reaction-handler.ts`

- [ ] **CO-M10: `completeMove` has ~135 lines of inline OA roll resolution in facade.** Should be delegated.
  - Files: `tabletop-combat-service.ts`

### Spell System
- [x] **SS-M1: Guiding Bolt missing advantage-on-next-attack effect.**
  - Files: `domain/entities/spells/catalog/level-1.ts`

- [x] **SS-M2: Sacred Flame should ignore cover.** Cover bonus still applied in save resolution.
  - Files: `domain/entities/spells/catalog/cantrips.ts`, save delivery handler

- [ ] **SS-M3: Eldritch Blast multi-beam not implemented.** At levels 5/11/17, should create additional beams (separate attack rolls).
  - Files: `domain/entities/spells/catalog/cantrips.ts`, `tabletop/spell-delivery/`

- [ ] **SS-M4: Scorching Ray multi-ray not implemented.** Should be 3 separate attack rolls, +1 per upcast level.
  - Files: `domain/entities/spells/catalog/level-2.ts`, `tabletop/spell-delivery/`

- [x] **SS-M5: Thunderwave missing push-on-fail.** Save delivery supports `outcome.movement.push` but catalog entry lacks movement data.
  - Files: `domain/entities/spells/catalog/level-1.ts`

- [x] **SS-M6: Spiritual Weapon incorrectly requires concentration.** D&D 5e 2024 Spiritual Weapon does NOT require concentration. Also missing "bonus action move + attack" on subsequent turns.
  - Files: `domain/entities/spells/catalog/level-2.ts`

- [x] **SS-M7: Heroism temp HP placeholder (0) never filled with caster's spellcasting modifier.**
  - Files: `domain/entities/spells/catalog/level-1.ts`

- [x] **SS-M8: Arcane Recovery (Wizard) not implemented.** (already implemented; corrected level gate to 2) Short rest spell slot recovery.
  - Files: New feature for `domain/entities/classes/wizard.ts`
  - Rule: PHB 2024 Wizard "Arcane Recovery"

- [ ] **SS-M9: Spell components stored but never enforced.** Silenced/Stunned creatures can still cast verbal spells. No free hand check for somatic.
  - Files: `tabletop/spell-action-handler.ts`, `domain/entities/combat/conditions.ts`

- [x] **SS-M10: No range validation on spell targets.** Caster can target anyone regardless of distance.
  - Files: `tabletop/spell-action-handler.ts`

- [x] **SS-M11: Zone saveDC not populated from caster's spell save DC at creation time.**
  - Files: `tabletop/spell-delivery/zone-spell-delivery-handler.ts`

- [ ] **SS-M12: Missing important spells from catalog.** Detect Magic, Command, Faerie Fire, Hunter's Mark, Hex, Sleep, Aid, Darkness, Invisibility, Lesser Restoration, Silence, Web, Haste, Slow, Lightning Bolt, Fly.
  - Files: `domain/entities/spells/catalog/`

### AI Behavior
- [ ] **AI-M1: AI can't cast bonus-action spells separately from action spells.** D&D 5e allows BA spell + cantrip action.
  - Files: `application/services/combat/ai/deterministic-ai.ts`

- [ ] **AI-M2: No multi-target/AoE spell evaluation in deterministic AI.** Only single-target considered.
  - Files: `application/services/combat/ai/deterministic-ai.ts`

- [x] **AI-M3: No Disengage-before-retreat logic in deterministic AI.** Retreats provoke OAs needlessly.
  - Files: `application/services/combat/ai/deterministic-ai.ts`

- [x] **AI-M4: No triage for dying allies.** Ignores allies at 0 HP with death saves. No Help/Spare the Dying consideration.
  - Files: `application/services/combat/ai/deterministic-ai.ts`

- [ ] **AI-M5: Deterministic AI ignores buff/debuff spells entirely.** Only considers healing and damage spells. Bless, Hold Person, etc. are dead code for non-LLM play.
  - Files: `application/services/combat/ai/deterministic-ai.ts`

- [ ] **AI-M6: Legendary attack bypasses ActiveEffects.** Uses simplified attack resolution — skips advantage/disadvantage from effects, Bless, Rage damage, flanking, damage defenses.
  - Files: `application/services/combat/ai/ai-turn-orchestrator.ts`

- [ ] **AI-M7: No cover-seeking positioning for ranged combatants.**
  - Files: `application/services/combat/ai/deterministic-ai.ts`

- [x] **AI-M8: Extra Attack doesn't re-evaluate targets between swings.** First target might die but AI sends all attacks to same target.
  - Files: `application/services/combat/ai/deterministic-ai.ts`

- [ ] **AI-M9: No token/context limit awareness for LLM payloads.** `AiContextBuilder.build()` can produce very large payloads.
  - Files: `application/services/combat/ai/ai-context-builder.ts`

- [ ] **AI-M10: Bonus action class abilities missing from deterministic AI.** Missing: Wholeness of Body, Divine Smite (paladin bonus), Bardic Inspiration, Healing Word (BA spell).
  - Files: `application/services/combat/ai/deterministic-ai.ts`

### Entity Management
- [ ] **EM-M1: No multiclassing support.** Character stores single `characterClass`. `hasFeature(classLevels, feature)` exists as multi-class-ready but Character entity doesn't support it.
  - Files: `domain/entities/creatures/character.ts`, `application/services/entities/character-service.ts`

- [ ] **EM-M2: No Ability Score Improvement (ASI) system.** No feat selection post-creation, no ASI at levels 4/8/12/16/19.
  - Files: `domain/entities/creatures/character.ts`

- [ ] **EM-M3: No skill proficiency system on Character entity.** Skills extracted ad-hoc from sheet JSON.
  - Files: `domain/entities/creatures/character.ts`

- [ ] **EM-M4: No spell preparation / known-spells management API.** `SpellLookupService` is read-only. No CRUD for prepared spells.
  - Files: `application/services/entities/spell-lookup-service.ts`

- [x] **EM-M5: `listCombatants` hydration difference between Prisma and Memory.** Prisma includes relations, Memory doesn't. Code relying on `combatant.character?.faction` silently gets `undefined` in tests.
  - Files: `infrastructure/db/combat-repository.ts`, `infrastructure/testing/memory-repos.ts`

- [x] **EM-M6: `armorTraining` not extracted from class during hydration.** A Wizard wearing heavy armor gets no penalty because hydration defaults to `all: true`.
  - Files: `application/services/combat/helpers/` (hydration code)

- [x] **EM-M7: Species save advantages hydrated but not consumed.** `speciesTraits.saveAdvantages` data exists in domain but is lost during hydration (not passed to CharacterData constructor), never checked in saving throw resolution.
  - Files: `domain/entities/creatures/species-registry.ts`, hydration code

- [x] **EM-M8: `PendingActionRepository` not exported from barrel.** Must be imported directly, inconsistent with other repos.
  - Files: `application/repositories/index.ts`

### Class Abilities
- [ ] **CA-M1: Paladin Channel Divinity pool tracked but nothing spends it.** No executor, no `abilityId` in capabilities.
  - Files: `domain/entities/classes/paladin.ts`

- [x] **CA-M2: LayOnHands executor only heals self, not allies.** D&D 5e 2024: "touch a willing creature (which can be yourself)."
  - Files: `abilities/executors/paladin/lay-on-hands-executor.ts`

- [x] **CA-M3: Warlock `pactMagic` pool name diverges from `spellSlot_N` convention.** Spell system code checking `spellSlot_N` won't find Warlock's slots.
  - Files: `domain/entities/classes/warlock.ts`

- [x] **CA-M4: Barbarian rage text pattern too restrictive (anchored `^rage$`).** "I want to rage" → no match. Compare Monk's partial matching.
  - Files: `domain/entities/classes/barbarian.ts`

- [x] **CA-M5: Warlock missing `spellcasting` in features map.** `classHasFeature("warlock", SPELLCASTING, level)` returns false. Generic checks miss Warlocks.
  - Files: `domain/entities/classes/warlock.ts`

- [ ] **CA-M6: Cleric missing Destroy Undead upgrade (level 5).** When Undead fails Turn save and has CR below threshold, it's instantly destroyed.
  - Files: `domain/entities/classes/cleric.ts`, `abilities/executors/`
  - Rule: PHB 2024 Cleric level 5

- [x] **CA-M7: Barbarian missing post-level-9 features in features map.** Relentless Rage (11), Persistent Rage (15), Indomitable Might (18), Primal Champion (20).
  - Files: `domain/entities/classes/barbarian.ts`

- [ ] **CA-M8: Paladin/Cleric Channel Divinity naming collision.** Identical function names in both files. Multiclass would share pool key with different max-uses formulas.
  - Files: `domain/entities/classes/paladin.ts`, `domain/entities/classes/cleric.ts`

- [x] **CA-M9: Open Hand Technique enhancement in base Monk profile, not subclass profile.** `SubclassDefinition` supports `combatTextProfile` — OHT should use it.
  - Files: `domain/entities/classes/monk.ts`

---

## TIER 4 — LOW (Quality / Non-Blocking)

### Combat Rules
- [ ] **CR-L1: Creature size never used in movement/cover/pathfinding.** `MapEntity.size` exists but is never consumed. Large+ creatures should occupy multiple cells.
- [ ] **CR-L2: No mounted combat rules.**
- [ ] **CR-L3: No falling damage rules (1d6 per 10ft).**
- [ ] **CR-L4: Help action has no range limit check (should be within 5ft).**
- [ ] **CR-L5: Protection fighting style — flag only, no domain function.**
- [ ] **CR-L6: Two-Weapon Fighting base mechanic lives only in application layer executor, not domain.**
- [ ] **CR-L7: `isOnMap()` uses `<=` instead of `<` — potential off-by-one.**
- [x] **CR-L8: No `index.ts` barrel for `domain/combat/`.**
- [ ] **CR-L9: Mutable action economy objects inconsistent with immutable patterns elsewhere.**

### Combat Orchestration
- [ ] **CO-L1: No "end turn" / "pass" text parser.**
- [ ] **CO-L2: "Dash toward goblin" incorrectly parsed as Dash action.**
- [ ] **CO-L3: No ABILITY_CHECK pending action type for player-rolled contested checks.**
- [ ] **CO-L4: Silvery Barbs reaction not supported.**
- [ ] **CO-L5: Interception fighting style reaction not implemented.**
- [ ] **CO-L6: Protection fighting style reaction not implemented.**
- [ ] **CO-L7: Two parallel pending action state machines not unified.**
- [ ] **CO-L8: Pervasive `as any` casts on resources throughout codebase.**

### Spell System
- [x] **SS-L1: Toll the Dead should deal d12 vs d8 on damaged target.**
- [x] **SS-L2: Ray of Frost should reduce target speed by 10ft.**
- [x] **SS-L3: Chill Touch should prevent HP regeneration.** (catalog effect placeholder exists but healing handler doesn't enforce it)
- [ ] **SS-L4: Duplicate upcast validation in handler + slot manager.**
- [ ] **SS-L5: `any` types in SpellCastingContext (6 fields).**
- [ ] **SS-L6: Magic Missile hardcoded inline instead of catalog-driven.**
- [ ] **SS-L7: Ritual casting not implemented (low impact in combat).**

### AI Behavior
- [ ] **AI-L1: No flanking-seeking movement behavior.**
- [ ] **AI-L2: Hard-coded retreat threshold (25% HP).**
- [ ] **AI-L3: OpenAI provider is a stub (throws on construction).**
- [ ] **AI-L4: LLM retry increases temperature (counterproductive for JSON).**
- [ ] **AI-L5: Duplicate `buildActorRef()` methods in orchestrator and executor.**
- [x] **AI-L6: `console.log` in CastSpellHandler — should use `aiLog`.** (already clean)
- [ ] **AI-L7: AiSpellDelivery resolveTargets uses faction heuristic instead of FactionService.**

### Entity Management
- [ ] **EM-L1: No `CharacterUpdated` / `CharacterRemoved` events.**
- [ ] **EM-L2: Deprecated `InventoryItem` type still exists (dead code).**
- [ ] **EM-L3: No session listing/update/delete API.**
- [ ] **EM-L4: No pagination on repository list methods.**
- [ ] **EM-L5: Several Prisma repos use `as any` for JSON fields.**
- [ ] **EM-L6: Dragonborn ancestry resistance never resolved from sheet.**

### Class Abilities
- [x] **CA-L1: Fighter Extra Attack upgrade display missing in `capabilitiesForLevel` at levels 11/20.**
- [ ] **CA-L2: Paladin Lay on Hands `resourceCost: 5` misleads AI (should be variable).**
- [ ] **CA-L3: Monk `step-of-the-wind-dash` ability ID orphaned from features map.**
- [x] **CA-L4: Warlock missing higher-level features in map (9+).**
- [ ] **CA-L5: NimbleEscapeExecutor TODO: creature-type validation.**

---

## Summary Stats

| Tier | Count |
|------|-------|
| Critical | 7 |
| High | 12 |
| Medium | 43 |
| Low | 31 |
| **Total** | **93** |

### By Domain

| Domain | Critical | High | Medium | Low | Total |
|--------|----------|------|--------|-----|-------|
| Combat Rules | 0 | 3 | 11 | 9 | 23 |
| Class Abilities | 2 | 6 | 9 | 5 | 22 |
| Spell System | 2 | 2 | 12 | 7 | 23 |
| Combat Orchestration | 0 | 0 | 10 | 8 | 18 |
| AI Behavior | 2 | 0 | 10 | 7 | 19 |
| Entity Management | 1 | 0 | 8 | 6 | 15 |

---

## Recommended Implementation Order

### Sprint 1: Fix What's Broken
1. SS-C2 (Inflict Wounds classification) — 5 min fix
2. CA-C1 (stub executors for 6 orphaned profiles) — prevent runtime errors
3. EM-C1 (fix findActiveEncounter divergence) — prevent production bugs
4. EM-M8 (PendingActionRepository barrel export) — 1 line fix

### Sprint 2: Core Rule Correctness
5. SS-C1 (end-of-turn save repeats) — foundational mechanic for many spells
6. CR-M3 (concentration breaks on incapacitated/death)
7. CR-M1 (Savage Attacker once-per-turn)
8. CR-M4 (Grapple/Shove nat 1/20)
9. SS-M6 (Spiritual Weapon — remove concentration, add BA mechanic)
10. SS-M1 (Guiding Bolt advantage effect)
11. SS-M5 (Thunderwave push)

### Sprint 3: Feature Completeness
12. SS-H1 (mechanical fields for Misty Step, Mage Armor, etc.)
13. CA-H2 (Rogue Hide implementation)
14. CA-H1 (Barbarian Brutal Strike wiring)
15. CA-C2 (Berserker Frenzy executor)
16. AI-C1 (AI zone spell delivery)
17. AI-C2 (deterministic AI useFeature)
18. CO-M3 (bonus action spell limitation enforcement)

### Sprint 4: AI Quality
19. AI-M3 (Disengage before retreat)
20. AI-M4 (dying ally triage)
21. AI-M5 (buff/debuff spell AI)
22. AI-M8 (re-evaluate targets between Extra Attacks)
23. AI-M10 (bonus action class abilities in deterministic AI)
24. AI-M6 (legendary attack ActiveEffects)

### Sprint 5: Test Coverage
25. CR-H1, CR-H2, CR-H3 (weapon mastery, feat modifiers, damage defense tests)
26. SS-H2 (E2E scenarios for healing, zone, buff, repeat-save)

### Sprint 6: Architecture Cleanup
27. CO-M4 (extract DamageResolver from handleDamageRoll)
28. CO-M5 (consolidate listCombatants calls)
29. CO-M7 (decompose CombatService.nextTurn)
30. CO-M8 (shared combatant lookup utility)
31. CA-H6 (feature-keys.ts constants for raw strings)
32. CO-L8 / EM-L5 (typed resources, remove `as any`)

### Ongoing / As-Needed
- SS-M12 (expand spell catalog)
- CR-M2 (multiple damage types per attack)
- CA-M6 (Cleric Destroy Undead)
- EM-M1 (multiclassing — long-term)
- CR-L1 (creature size — systemic)
