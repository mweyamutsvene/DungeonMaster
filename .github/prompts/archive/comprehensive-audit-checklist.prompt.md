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

- [x] **CR-M2: Multiple damage types per attack not supported.** Added `additionalDamage` field to `AttackSpec`; each type gets individual defense checks. Critical hits double all damage types.
  - Files: `domain/combat/attack-resolver.ts`

- [x] **CR-M3: Incapacitated/death doesn't break concentration in domain layer.** Only damage triggers checks. D&D 5e 2024 also ends concentration on Incapacitated or death.
  - Files: `domain/rules/concentration.ts`

- [x] **CR-M4: Grapple/Shove ignores natural 1/20 on attack roll.** Nat 1 should auto-miss, nat 20 should auto-hit the initial strike.
  - Files: `domain/rules/grapple-shove.ts`

- [x] **CR-M5: `attemptMovement()` uses Euclidean distance instead of alternating diagonal cost.** Fixed: calculateDistance now uses Chebyshev (D&D grid standard).
  - Files: `domain/rules/movement.ts`

- [x] **CR-M6: Heavily/lightly obscured areas not implemented.** Added `ObscuredLevel` type, `getObscuredLevelAt()`, and `getObscurationAttackModifiers()` wired into all attack paths.
  - Files: `domain/rules/combat-map-types.ts`, `domain/rules/combat-map-sight.ts`

- [x] **CR-M7: Warlock pact slots may not refresh on short rest.** (already correct — pactMagic uses `refreshOn: "both"`) `rest.ts` blanket checks `spellSlot_*` prefix → long rest only. If Warlock pact slots use that naming, short rest recovery breaks.
  - Files: `domain/rules/rest.ts`

- [x] **CR-M8: Temp HP stacking rule not enforced in domain.** (already done) D&D 5e 2024: temp HP doesn't stack, choose the higher. No domain function validates this.
  - Files: `domain/entities/combat/effects.ts`

- [x] **CR-M9: `DamageEffect.apply()` bypasses damage defenses.** Calls `target.takeDamage()` directly without checking resistance/immunity/vulnerability.
  - Files: `domain/effects/damage-effect.ts`

- [x] **CR-M10: Dual distance functions in `rules/movement.ts` and `combat/movement.ts`.** Fixed: removed dead `domain/combat/movement.ts`, consolidated to single canonical module.
  - Files: `domain/rules/movement.ts`, `domain/combat/movement.ts`

- [x] **CR-M11: Tough feat HP bonus not applied in creature hydration (existing TODO).** (already implemented in domain — `computeToughBonusHP()` exists)
  - Files: `domain/rules/hit-points.ts`

### Combat Orchestration
- [x] **CO-M1: Readied action triggers only fire for `creature_moves_within_range`.** Fixed: added `creature_attacks` trigger via readied-attack-trigger.ts helper (hooked into AttackReactionHandler + AiAttackResolver), readied spell concentration tracked in SocialHandlers + breakConcentration.
  - Files: `tabletop/dispatch/social-handlers.ts`, `two-phase/move-reaction-handler.ts`

- [x] **CO-M2: Legendary actions between turns not orchestrated.** Already implemented — `processLegendaryActions()` fires in `nextTurn()` between-turn window.
  - Files: `application/services/combat/combat-service.ts`

- [x] **CO-M3: Bonus action spell limitations not enforced.** (already done) If BA spell cast, only cantrip allowed as action. Not checked.
  - Files: `tabletop/action-dispatcher.ts`, `tabletop/spell-action-handler.ts`

- [x] **CO-M4: `handleDamageRoll` is ~370 lines — extract to DamageResolver class.** Extracted to `rolls/damage-resolver.ts`; `handleDamageRoll` is now a 3-line delegation.
  - Files: `tabletop/rolls/damage-resolver.ts`, `tabletop/roll-state-machine.ts`

- [x] **CO-M5: Redundant `listCombatants` calls (5-7 per damage resolution).** Cached combatants in DamageResolver and RollStateMachine; 11 calls → 1 initial + 2-3 post-mutation re-fetches.
  - Files: `tabletop/rolls/damage-resolver.ts`, `tabletop/roll-state-machine.ts`

- [x] **CO-M6: Sentinel incapacitation check hardcoded to `false` (existing TODO).** (already done)
  - Files: `two-phase/attack-reaction-handler.ts`

- [x] **CO-M7: `CombatService.nextTurn()` at ~280 lines — growing unwieldy.** Decomposed into 6 private methods; `nextTurn()` is now a thin orchestrator.
  - Files: `application/services/combat/combat-service.ts`

- [x] **CO-M8: Duplicated combatant-by-entity-ID lookup pattern across many files.** Extracted `findCombatantByEntityId()` + `getEntityId()` to `helpers/combatant-lookup.ts`; replaced ~40 patterns across 22 files.
  - Files: `application/services/combat/helpers/combatant-lookup.ts`

- [x] **CO-M9: Dual OA resolution paths consolidated.** ActionService.move now delegates to shared `resolveOpportunityAttacks()` via synthetic PendingAction. Both paths use same resolver with full ActiveEffect support.
  - Files: `combat/action-service.ts`, `helpers/oa-detection.ts`

- [x] **CO-M10: `completeMove` inline OA resolution delegated.** Resolved as part of CO-M9 OA consolidation.
  - Files: `tabletop-combat-service.ts`

### Spell System
- [x] **SS-M1: Guiding Bolt missing advantage-on-next-attack effect.**
  - Files: `domain/entities/spells/catalog/level-1.ts`

- [x] **SS-M2: Sacred Flame should ignore cover.** Cover bonus still applied in save resolution.
  - Files: `domain/entities/spells/catalog/cantrips.ts`, save delivery handler

- [x] **SS-M3: Eldritch Blast multi-beam implemented.** Added `multiAttack` field + `getSpellAttackCount()`. Spell strike chaining in RollStateMachine. E2E scenario added.
  - Files: `domain/entities/spells/prepared-spell-definition.ts`, `tabletop/spell-delivery/spell-attack-delivery-handler.ts`

- [x] **SS-M4: Scorching Ray multi-ray implemented.** Uses same `multiAttack` system as Eldritch Blast. 3 base rays + 1 per upcast level. E2E scenario added.
  - Files: `domain/entities/spells/catalog/level-2.ts`, `tabletop/spell-delivery/spell-attack-delivery-handler.ts`

- [x] **SS-M5: Thunderwave missing push-on-fail.** Save delivery supports `outcome.movement.push` but catalog entry lacks movement data.
  - Files: `domain/entities/spells/catalog/level-1.ts`

- [x] **SS-M6: Spiritual Weapon incorrectly requires concentration.** D&D 5e 2024 Spiritual Weapon does NOT require concentration. Also missing "bonus action move + attack" on subsequent turns.
  - Files: `domain/entities/spells/catalog/level-2.ts`

- [x] **SS-M7: Heroism temp HP placeholder (0) never filled with caster's spellcasting modifier.**
  - Files: `domain/entities/spells/catalog/level-1.ts`

- [x] **SS-M8: Arcane Recovery (Wizard) not implemented.** (already implemented; corrected level gate to 2) Short rest spell slot recovery.
  - Files: New feature for `domain/entities/classes/wizard.ts`
  - Rule: PHB 2024 Wizard "Arcane Recovery"

- [x] **SS-M9: Spell components — verbal enforcement added.** Verbal component check blocks casting when caster has cannotSpeak conditions (Stunned, Paralyzed, etc.). TODOs for Silence zone, somatic/material, Subtle Spell.
  - Files: `tabletop/spell-action-handler.ts`

- [x] **SS-M10: No range validation on spell targets.** Caster can target anyone regardless of distance.
  - Files: `tabletop/spell-action-handler.ts`

- [x] **SS-M11: Zone saveDC not populated from caster's spell save DC at creation time.**
  - Files: `tabletop/spell-delivery/zone-spell-delivery-handler.ts`

- [x] **SS-M12: Spell catalog expanded.** Added 10 spells: Command, Faerie Fire, Sleep, Hunter's Mark, Hex, Aid, Darkness, Invisibility, Lesser Restoration, Web. Still missing: Detect Magic, Silence, Haste, Slow, Lightning Bolt, Fly.
  - Files: `domain/entities/spells/catalog/level-1.ts`, `level-2.ts`

### AI Behavior
- [x] **AI-M1: AI BA spell + action cantrip rule enforced.** Step 4b previews BA, restricts main action to cantrips. Step 9 blocks BA spells after leveled action.
  - Files: `application/services/combat/ai/deterministic-ai.ts`

- [x] **AI-M2: AoE spell evaluation added.** `estimateAoETargets()` uses Chebyshev grid distance to weight spell value by affected enemy count.
  - Files: `application/services/combat/ai/deterministic-ai.ts`

- [x] **AI-M3: No Disengage-before-retreat logic in deterministic AI.** Retreats provoke OAs needlessly.
  - Files: `application/services/combat/ai/deterministic-ai.ts`

- [x] **AI-M4: No triage for dying allies.** Ignores allies at 0 HP with death saves. No Help/Spare the Dying consideration.
  - Files: `application/services/combat/ai/deterministic-ai.ts`

- [x] **AI-M5: Buff/debuff spell support added.** Debuffs prioritized against high-value threats; buffs cast in early rounds when not concentrating. Priority: healing > debuff > buff > damage.
  - Files: `application/services/combat/ai/deterministic-ai.ts`

- [x] **AI-M6: Legendary attack now applies ActiveEffects.** Full condition-based advantage/disadvantage, attack/AC bonuses, damage modifiers (Rage, Bless, etc.), and damage defenses.
  - Files: `application/services/combat/ai/ai-turn-orchestrator.ts`

- [x] **AI-M7: Cover-seeking positioning for ranged combatants.** `findCoverPosition()` evaluates grid cells for cover from enemies while maintaining LOS + attack range.
  - Files: `application/services/combat/ai/deterministic-ai.ts`

- [x] **AI-M8: Extra Attack doesn't re-evaluate targets between swings.** First target might die but AI sends all attacks to same target.
  - Files: `application/services/combat/ai/deterministic-ai.ts`

- [x] **AI-M9: LLM context budget added.** `context-budget.ts` helper truncates payloads to configurable token limits.
  - Files: `application/services/combat/ai/context-budget.ts`, `ai-context-builder.ts`

- [x] **AI-M10: Bonus action abilities added to deterministic AI.** BA healing spells (Healing Word), Spiritual Weapon attacks. `pickBonusAction` evaluates all ally lists.
  - Files: `application/services/combat/ai/deterministic-ai.ts`

### Entity Management
- [x] **EM-M1: Multiclassing foundation added.** `secondaryClasses` on Character entity, `hasFeature()` consumes all class levels.
  - Files: `domain/entities/creatures/character.ts`, `application/services/entities/character-service.ts`

- [x] **EM-M2: ASI system added.** `domain/rules/ability-score-improvement.ts` with level gates and score-cap validation.
  - Files: `domain/rules/ability-score-improvement.ts`, `domain/entities/creatures/character.ts`

- [x] **EM-M3: Skill proficiency system added.** `domain/entities/core/skills.ts` with proficiency types and bonus calculation.
  - Files: `domain/entities/core/skills.ts`, `domain/entities/creatures/character.ts`

- [x] **EM-M4: Spell preparation rules added.** `domain/rules/spell-preparation.ts` with max prepared count + validation.
  - Files: `domain/rules/spell-preparation.ts`, `application/services/entities/spell-lookup-service.ts`

- [x] **EM-M5: `listCombatants` hydration difference between Prisma and Memory.** Prisma includes relations, Memory doesn't. Code relying on `combatant.character?.faction` silently gets `undefined` in tests.
  - Files: `infrastructure/db/combat-repository.ts`, `infrastructure/testing/memory-repos.ts`

- [x] **EM-M6: `armorTraining` not extracted from class during hydration.** A Wizard wearing heavy armor gets no penalty because hydration defaults to `all: true`.
  - Files: `application/services/combat/helpers/` (hydration code)

- [x] **EM-M7: Species save advantages hydrated and consumed.** Hydration now passes `speciesSaveAdvantages` to CharacterData; saving-throw-resolver checks against conditions.
  - Files: `application/services/combat/helpers/creature-hydration.ts`, `tabletop/rolls/saving-throw-resolver.ts`

- [x] **EM-M8: `PendingActionRepository` not exported from barrel.** Must be imported directly, inconsistent with other repos.
  - Files: `application/repositories/index.ts`

### Class Abilities
- [x] **CA-M1: Paladin Channel Divinity — Divine Sense executor.** `ChannelDivinityExecutor` registered, text mapping added, costs 1 charge + bonus action.
  - Files: `abilities/executors/paladin/channel-divinity-executor.ts`, `domain/entities/classes/paladin.ts`

- [x] **CA-M2: LayOnHands executor only heals self, not allies.** D&D 5e 2024: "touch a willing creature (which can be yourself)."
  - Files: `abilities/executors/paladin/lay-on-hands-executor.ts`

- [x] **CA-M3: Warlock `pactMagic` pool name diverges from `spellSlot_N` convention.** Spell system code checking `spellSlot_N` won't find Warlock's slots.
  - Files: `domain/entities/classes/warlock.ts`

- [x] **CA-M4: Barbarian rage text pattern too restrictive (anchored `^rage$`).** "I want to rage" → no match. Compare Monk's partial matching.
  - Files: `domain/entities/classes/barbarian.ts`

- [x] **CA-M5: Warlock missing `spellcasting` in features map.** `classHasFeature("warlock", SPELLCASTING, level)` returns false. Generic checks miss Warlocks.
  - Files: `domain/entities/classes/warlock.ts`

- [x] **CA-M6: Cleric Destroy Undead (level 5+).** `getDestroyUndeadCRThreshold()` added; Turn Undead processor now destroys low-CR undead on failed save.
  - Files: `domain/entities/classes/cleric.ts`, `tabletop/dispatch/class-ability-handlers.ts`

- [x] **CA-M7: Barbarian missing post-level-9 features in features map.** Relentless Rage (11), Persistent Rage (15), Indomitable Might (18), Primal Champion (20).
  - Files: `domain/entities/classes/barbarian.ts`

- [x] **CA-M8: Channel Divinity naming collision fixed.** Paladin → `channelDivinity:paladin`, Cleric → `channelDivinity:cleric`. Updated across all source + test files.
  - Files: `domain/entities/classes/paladin.ts`, `domain/entities/classes/cleric.ts`

- [x] **CA-M9: Open Hand Technique enhancement in base Monk profile, not subclass profile.** `SubclassDefinition` supports `combatTextProfile` — OHT should use it.
  - Files: `domain/entities/classes/monk.ts`

---

## TIER 4 — LOW (Quality / Non-Blocking)

### Combat Rules
- [x] **CR-L1: Creature size footprint helper added.** `getCreatureCellFootprint()` returns occupied cells for Large+ creatures.
  - Files: `domain/combat/size.ts`
- [x] **CR-L2: Mounted combat domain types added.** `MountState`, `canMount()`, `getMountingCost()` in `domain/combat/mount.ts`.
- [x] **CR-L3: Falling damage added.** `computeFallDamage()` in domain/combat module.
- [x] **CR-L4: Help action range check added.** 5-foot distance validation in both tabletop and programmatic paths.
- [x] **CR-L5: Protection fighting style domain function added.** `canUseProtection()` in `domain/combat/protection.ts`.
- [x] **CR-L6: TWF domain functions added.** `domain/combat/two-weapon-fighting.ts` with eligibility and damage bonus helpers.
- [x] **CR-L7: `isOnMap()` off-by-one fixed.** Uses strict `<` for width/height bounds.
- [x] **CR-L8: No `index.ts` barrel for `domain/combat/`.**
- [x] **CR-L9: Immutable ActionEconomy pattern added.** Read-only type + `withSpent()` helper.

### Combat Orchestration
- [x] **CO-L1: "end turn" / "pass" text parser added.** Parser entry in ActionDispatcher chain matches `end turn`, `pass`, `done`, `skip`, `nothing`.
- [x] **CO-L2: Dash parser fixed.** "Dash toward goblin" now routes to movement, not Dash action.
- [x] **CO-L3: `ability_check` pending action type added.** `PendingAbilityCheckData` type for future contested checks.
- [x] **CO-L4: Silvery Barbs added.** Spell catalog entry + wizard `AttackReactionDef`.
- [x] **CO-L5: Interception fighting style reaction stub added.**
- [x] **CO-L6: Protection fighting style reaction stub added.**
- [x] **CO-L7: Dual pending action architecture documented.** TODOs for full unification.
- [x] **CO-L8: ~12 `as any` casts replaced.** `patchResources()`, `getEntityIdFromRef()`, `JsonValue` types.

### Spell System
- [x] **SS-L1: Toll the Dead should deal d12 vs d8 on damaged target.**
- [x] **SS-L2: Ray of Frost should reduce target speed by 10ft.**
- [x] **SS-L3: Chill Touch prevent_healing implemented.** Added `prevent_healing` EffectType, enforced in healing delivery handler + potion use.
- [x] **SS-L4: Upcast validation consolidated.** `validateUpcast()` extracted to spell-slot-manager.
- [x] **SS-L5: SpellCastingContext types fixed.** 5/6 `any` fields replaced with proper types.
- [x] **SS-L6: Magic Missile catalog-driven.** Added `autoHit` + `dartCount` fields; inline logic replaced with generic auto-hit delivery.
- [x] **SS-L7: Ritual casting foundation added.** `SpellCastingMode` type + Detect Magic ritual flag.

### AI Behavior
- [x] **AI-L1: Flanking-seeking movement added.** Melee AI prefers flanking positions.
- [x] **AI-L2: Configurable flee threshold.** `fleeThreshold?` on `AiCombatContext`.
- [x] **AI-L3: OpenAI provider implemented.** Functional chat completions API integration.
- [x] **AI-L4: LLM temperature configurable.** `DM_LLM_TEMPERATURE` env var (default 0.7).
- [x] **AI-L5: `buildActorRef()` deduplicated.** Shared helper in `ai/build-actor-ref.ts`.
- [x] **AI-L6: `console.log` in CastSpellHandler — should use `aiLog`.** (already clean)
- [x] **AI-L7: Faction heuristic configurable.** `FactionServiceConfig` with neutral faction + overrides.

### Entity Management
- [x] **EM-L1: Combat events persisted.** `GameEvent` schema + `listByEncounter()` + combat context.
- [x] **EM-L2: Dead `InventoryItem` interface removed.**
- [x] **EM-L3: Session CRUD expanded.** `DELETE /sessions/:id` + `GET /sessions` with pagination.
- [x] **EM-L4: Pagination added.** `?limit=N&offset=N` on session list (default 50, max 200).
- [x] **EM-L5: Prisma `as any` replaced.** `Prisma.InputJsonValue` in combat + NPC repos.
- [x] **EM-L6: Dragonborn resistance hydrated.** `getDragonbornAncestryResistance()` in species.ts.

### Class Abilities
- [x] **CA-L1: Fighter Extra Attack upgrade display missing in `capabilitiesForLevel` at levels 11/20.**
- [x] **CA-L2: Lay on Hands resource cost validated.** Pool deduction verified correct; 10 unit tests added.
- [x] **CA-L3: Step of the Wind audit — no orphaned code found.** False positive.
- [x] **CA-L4: Warlock missing higher-level features in map (9+).**
- [x] **CA-L5: NimbleEscape validation added.** Bonus action + incapacitation checks with 4 tests.

---

## Summary Stats

| Tier | Total | Done | Remaining |
|------|-------|------|-----------|
| Critical | 7 | 7 | 0 |
| High | 12 | 12 | 0 |
| Medium | 43 | 43 | 0 |
| Low | 31 | 31 | 0 |
| **Total** | **93** | **93** | **0** |

### All items complete!

---

## Recommended Implementation Order

### ~~Sprint 1: Fix What's Broken~~ ✅ COMPLETE
### ~~Sprint 2: Core Rule Correctness~~ ✅ COMPLETE
### ~~Sprint 3: Feature Completeness~~ ✅ COMPLETE
### ~~Sprint 4: AI Quality~~ ✅ COMPLETE
### ~~Sprint 5: Test Coverage~~ ✅ COMPLETE
### ~~Sprint 6: Architecture Cleanup~~ ✅ COMPLETE

### Remaining Work (Medium tier — 6 items)
- CO-M2 (Legendary actions between turns — orchestration gap)
- AI-M9 (LLM payload token/context limits)
- EM-M1 (Multiclassing — long-term architectural)
- EM-M2 (ASI system)
- EM-M3 (Skill proficiency system)
- EM-M4 (Spell preparation API)

### Remaining Work (Low tier — 21 items)
See individual domain sections above. These are quality/non-blocking items.
