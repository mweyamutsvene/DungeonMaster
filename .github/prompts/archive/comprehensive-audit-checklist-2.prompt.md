# Comprehensive Audit Checklist v2 — April 2026

Cross-domain deep audit across all 6 flows. Items grouped by priority tier, then by domain.

---

## TIER 1 — CRITICAL (Runtime Bugs / Incorrect Rules)

### Combat Rules
- [ ] **CR2-C1: Saving throws ignore nat 20 auto-success and nat 1 auto-fail.** `d20Test()` returns `natural20`/`natural1` flags but `success` is purely `total >= dc`. Every saving throw (concentration, grapple, spells) is affected.
  - Files: `domain/rules/advantage.ts`, `domain/rules/ability-checks.ts`
  - Rule: PHB 2024 Rules Glossary — D20 Test: nat 20 = auto-success for saves, nat 1 = auto-fail
  - Fix: Create `savingThrowTest()` wrapper that overrides `success = natural20 || (!natural1 && total >= dc)`.

### Spell System
- [ ] **SS2-C1: Save-based cantrips never scale damage.** `SaveSpellDeliveryHandler` uses raw `spellDamage.diceCount` without calling `getCantripDamageDice()`. Sacred Flame / Toll the Dead deal 1d8 at all levels; should scale at 5/11/17.
  - Files: `spell-delivery/save-spell-delivery-handler.ts`
  - Fix: Add cantrip scaling check matching the pattern in `SpellAttackDeliveryHandler`.

- [ ] **SS2-C2: Toll the Dead `damageDiceSidesOnDamaged: 12` never consumed.** Spell always uses d8 regardless of target HP.
  - Files: `spell-delivery/save-spell-delivery-handler.ts`, `domain/entities/spells/catalog/cantrips.ts`
  - Rule: PHB 2024 — Toll the Dead: d12 if target is missing HP.
  - Fix: Check `damageDiceSidesOnDamaged` + target's current vs max HP.

- [ ] **SS2-C3: Bless has `appliesTo: 'self'` making it self-only instead of 3-creature party buff.**
  - Files: `domain/entities/spells/catalog/level-1.ts`
  - Rule: PHB 2024 — Bless targets up to 3 creatures.
  - Fix: Change `appliesTo: 'allies'`.

### Class Abilities
- [ ] **CA2-C1: Divine Smite dice overflow — `divineSmiteDice(5)` returns 6d8 instead of max 5d8.** `Math.min(1 + slotLevel, 6)` should be `Math.min(1 + slotLevel, 5)`.
  - Files: `domain/entities/classes/paladin.ts`
  - Rule: PHB 2024 — Divine Smite max 5d8.

- [ ] **CA2-C2: ChannelDivinityExecutor `canExecute` has typo — executor is dead.** Checks `"classpaladinidivinesense"` (extra `i`) instead of `"classpaladindivinesense"`. Executor never matches.
  - Files: `application/services/combat/abilities/executors/paladin/channel-divinity-executor.ts`

### AI Behavior
- [ ] **AI2-C1: Counterspell reaction reads wrong data shape (`resources.spellSlots` instead of `resourcePools`).** AI never counterspells low-level spells.
  - Files: `ai-turn-orchestrator.ts`
  - Fix: Read from `getResourcePools()` and sum `spellSlot_*` pools with `current > 0`.

- [ ] **AI2-C2: Legendary action handler reads non-existent `boss.monster?.faction`.** `CombatantStateRecord` has flat fields, not nested objects. Faction detection breaks for multi-faction encounters.
  - Files: `ai/legendary-action-handler.ts`
  - Fix: Use `FactionService` or pass `allyIds: Set<string>`.

---

## TIER 2 — HIGH (Significant Bugs / Feature Gaps)

### Combat Rules
- [ ] **CR2-H1: attack-resolver uses 4 `as unknown` casts to probe Creature methods.** Brittle — should extend Creature interface or pass data via AttackSpec.
  - Files: `domain/combat/attack-resolver.ts`

- [ ] **CR2-H2: Large+ creature pathfinding ignores cell footprint.** `getCreatureCellFootprint()` exists but A* treats all creatures as single-cell.
  - Files: `domain/rules/pathfinding.ts`, `domain/rules/combat-map-core.ts`

### Spell System
- [ ] **SS2-H1: Faerie Fire effects silently dropped.** Save handler resolves save but doesn't apply `effects[]` (advantage on attacks). The effect array is ignored.
  - Files: `spell-delivery/save-spell-delivery-handler.ts`, `domain/entities/spells/catalog/level-1.ts`

- [ ] **SS2-H2: Auto-hit spells (Magic Missile) skip damage defenses.** Force-immune creatures take full damage.
  - Files: `tabletop/spell-action-handler.ts`

- [ ] **SS2-H3: Zone spells missing `on_entry` trigger.** Cloud of Daggers, Moonbeam only damage `on_start_turn`, not on movement entry.
  - Files: `domain/entities/spells/catalog/level-2.ts`, zone processing in `combat-service.ts`
  - Rule: PHB 2024 — "enters the area for the first time on a turn or starts its turn there"

- [ ] **SS2-H4: Duplicate `isConcentrationBreakingCondition` with case mismatch.** Domain version is case-insensitive, application version is case-sensitive. Wrong import could miss conditions.
  - Files: `domain/rules/concentration.ts`, `application/services/combat/helpers/concentration-helper.ts`

- [ ] **SS2-H5: No level 4–9 spell catalogs.** Major combat spells missing: Wall of Fire, Banishment, Polymorph, Cone of Cold, Disintegrate, etc.
  - Files: `domain/entities/spells/catalog/` — only cantrips thru level-3

### Class Abilities
- [ ] **CA2-H1: Wizard Arcane Recovery feature at level 2, should be level 1.** Features map says `"arcane-recovery": 2`, PHB 2024 says level 1.
  - Files: `domain/entities/classes/wizard.ts`

- [ ] **CA2-H2: Barbarian unlimited rage at level 20 not implemented.** `rageUsesForLevel(20)` returns 6 instead of Infinity.
  - Files: `domain/entities/classes/barbarian.ts`
  - Rule: PHB 2024 — Primal Champion: unlimited rages.

- [ ] **CA2-H3: Barbarian Brutal Strike regex has duplicate `hamstringblow`.** Harmless but sloppy.
  - Files: `domain/entities/classes/barbarian.ts`

- [ ] **CA2-H4: Berserker subclass missing level 14 Retaliation.** Features stop at level 10.
  - Files: `domain/entities/classes/barbarian.ts`
  - Rule: PHB 2024 — Berserker Retaliation at level 14.

### Combat Orchestration
- [ ] **CO2-H1: Duplicate `resolveActiveActorOrThrow` across 3 action handler files.**
  - Files: `action-service.ts`, `grapple-action-handler.ts`, `skill-action-handler.ts`
  - Fix: Extract to shared helper.

- [ ] **CO2-H2: `completeMove` has ~120 lines inline OA resolution that skips feats/effects.**
  - Files: `tabletop-combat-service.ts`
  - Fix: Delegate to shared OA resolver.

- [ ] **CO2-H3: `markActionSpent` only finds Characters, silently ignores Monsters/NPCs.**
  - Files: `tabletop/tabletop-event-emitter.ts`
  - Fix: Use `findCombatantByEntityId()`.

### AI Behavior
- [ ] **AI2-H1: `deterministic-ai.ts` is ~1300 lines — needs decomposition.** 15+ functions mixing spell eval, targeting, movement, bonus actions.
  - Files: `deterministic-ai.ts`
  - Fix: Extract to `ai-spell-evaluator.ts`, `ai-bonus-action-picker.ts`, `ai-movement-planner.ts`.

- [ ] **AI2-H2: Duplicated multiattack parsing in context-builder and orchestrator.**
  - Files: `ai-context-builder.ts`, `ai-turn-orchestrator.ts`
  - Fix: Extract to shared `domain/combat/multiattack.ts`.

- [ ] **AI2-H3: AI never uses Action Surge deterministically.** Most powerful fighter feature unavailable without LLM.
  - Files: `deterministic-ai.ts`

- [ ] **AI2-H4: AI context builder loads entities N×M times per turn loop.** No caching.
  - Files: `ai-context-builder.ts`

### Entity Management
- [ ] **EM2-H1: `MemoryEventRepository` missing `listByEncounter` — Prisma↔Memory gap.**
  - Files: `infrastructure/testing/memory-repos.ts`

- [ ] **EM2-H2: `as any` casts for ability scores in `CharacterService.takeSessionRest`.** 3 occurrences.
  - Files: `application/services/entities/character-service.ts`

- [ ] **EM2-H3: `ICharacterRepository` lacks `update()` method — dual source of truth for level/className.**
  - Files: `application/repositories/character-repository.ts`

---

## TIER 3 — MEDIUM (Incomplete Rules / Missing Features / Refactors)

### Combat Rules
- [ ] **CR2-M1: No Exhaustion rules module.** D&D 5e 2024 revamped exhaustion (each level: -2 d20 penalty, -5ft speed; 10 = death).
  - Files: New `domain/rules/exhaustion.ts` needed
- [ ] **CR2-M2: Sentinel feat effect #3 modeled in domain but not wired to reaction system.**
  - Files: `domain/rules/opportunity-attack.ts`, `domain/rules/feat-modifiers.ts`
- [ ] **CR2-M3: `spell-slots.ts` uses unsafe `Object.keys()` cast to `SpellSlotLevel[]`.**
  - Files: `domain/rules/spell-slots.ts`
- [ ] **CR2-M4: Short rest interruption missing damage trigger (only checks combat start).**
  - Files: `domain/rules/rest.ts`
  - Rule: PHB 2024 — short rest interrupted by damage OR combat
- [ ] **CR2-M5: Mounted combat stub has 6 TODOs, zero functional wiring.**
  - Files: `domain/combat/mount.ts`

### Spell System
- [ ] **SS2-M1: Ranger cantrip progression returns 0 — should scale like half caster (2 at level 1).**
  - Files: `domain/entities/spells/spell-progression.ts`
- [ ] **SS2-M2: Magic Missile `upcastScaling` field is misleading (says add dice, actually adds darts).**
  - Files: `domain/entities/spells/catalog/level-1.ts`
- [ ] **SS2-M3: Multiple DB round-trips per spell cast — `resolveEncounterContext()` called 4x.**
  - Files: `tabletop/spell-action-handler.ts`
- [ ] **SS2-M4: Several catalog spells have no mechanical implementation (Absorb Elements, Lesser Restoration, Shield, Silvery Barbs).**
  - Files: `domain/entities/spells/catalog/level-1.ts`, `level-2.ts`
- [ ] **SS2-M5: Ritual casting foundation exists but not wired into spell flow.**
  - Files: `helpers/spell-slot-manager.ts`, `domain/entities/spells/catalog/types.ts`

### Class Abilities
- [ ] **CA2-M1: `resourcesAtLevel`/`resourcePoolFactory` duplication across 10+ classes.** Legacy `resourcePoolFactory` should be removed.
  - Files: All class definition files
- [ ] **CA2-M2: 4 stub executors registered but return NOT_IMPLEMENTED (QuickenedSpell, TwinnedSpell, BardicInspiration, WildShape).**
  - Files: `abilities/executors/sorcerer/`, `bard/`, `druid/`
- [ ] **CA2-M3: ~20 `as any` casts in reaction detection (wizard, warlock, rogue).**
  - Files: `wizard.ts`, `warlock.ts`
  - Fix: Type `AttackReactionInput.resources` properly.
- [ ] **CA2-M4: Fighter Protection/Interception reactions are dead stubs (always return null).**
  - Files: `domain/entities/classes/fighter.ts`
- [ ] **CA2-M5: Champion subclass missing Heroic Warrior (10) and Survivor (18).**
  - Files: `domain/entities/classes/fighter.ts`
- [ ] **CA2-M6: Thief subclass missing Use Magic Device (13) and Thief's Reflexes (17).**
  - Files: `domain/entities/classes/rogue.ts`
- [ ] **CA2-M7: Monk features map stops at level 7 — missing Diamond Soul (14), Acrobatic Movement (9), Self-Restoration (10).**
  - Files: `domain/entities/classes/monk.ts`
- [ ] **CA2-M8: Open Hand subclass missing Quivering Palm (11) and Perfect Focus (17).**
  - Files: `domain/entities/classes/monk.ts`
- [ ] **CA2-M9: Missing feature-key constants for sorcery-points, metamagic, evasion, fighting-style.**
  - Files: `domain/entities/classes/feature-keys.ts`

### Combat Orchestration
- [ ] **CO2-M1: Zone damage passes empty defense arrays — fire-immune creatures take full zone damage.**
  - Files: `combat-service.ts` (processZoneTurnTriggers)
- [ ] **CO2-M2: `resolveAttackTarget` uses wrong HP field (`currentHp` vs `hpCurrent`), dead creatures not filtered.**
  - Files: `tabletop/dispatch/attack-handlers.ts`
- [ ] **CO2-M3: Pending action state machine non-blocking — invalid transitions only log in dev, silently pass in prod.**
  - Files: `tabletop/pending-action-state-machine.ts`
- [ ] **CO2-M4: `loadRoster()` called 6-9 times per turn — 3 DB queries each time.**
  - Files: `roll-state-machine.ts`, `action-dispatcher.ts`, `tabletop-combat-service.ts`
- [ ] **CO2-M5: No incapacitated check before routing actions in tabletop flow.**
  - Files: `tabletop/action-dispatcher.ts`
- [ ] **CO2-M6: Legendary actions not dispatchable in tabletop text flow (no parser, no between-turn mechanism).**
  - Files: `action-dispatcher.ts`, `combat-text-parser.ts`
- [ ] **CO2-M7: Victory policy only recognizes "player"/"party" factions as allies.**
  - Files: `combat-victory-policy.ts`

### AI Behavior
- [ ] **AI2-M1: `pickBestAttack` only considers toHit, ignores damage output.**
  - Files: `deterministic-ai.ts`
- [ ] **AI2-M2: AI never generates grapple/shove actions deterministically.**
  - Files: `deterministic-ai.ts`
- [ ] **AI2-M3: AoE spell targeting ignores positions — hits ALL enemies regardless of distance.**
  - Files: `ai/handlers/ai-spell-delivery.ts`
- [ ] **AI2-M4: LLM system prompt ~10K+ chars (~2500 tokens) — too large for small models.**
  - Files: `infrastructure/llm/ai-decision-maker.ts`
- [ ] **AI2-M5: No damage-type-aware attack/spell selection (ignores target resistances/immunities).**
  - Files: `deterministic-ai.ts`
- [ ] **AI2-M6: Pervasive `as any` casts throughout AI module (~20+ occurrences).**
  - Files: `ai-action-executor.ts`, `ai-attack-resolver.ts`, `ai-context-builder.ts`, `ai-turn-orchestrator.ts`
- [ ] **AI2-M7: No Divine Smite / on-hit enhancement handling in AI attack path.**
  - Files: `ai-attack-resolver.ts`

### Entity Management
- [ ] **EM2-M1: No `updateCharacter`/`deleteCharacter` service methods with validation + events.**
  - Files: `application/services/entities/character-service.ts`
- [ ] **EM2-M2: Monster/NPC repos have no `updateStatBlock` method.**
  - Files: `application/repositories/monster-repository.ts`, `npc-repository.ts`
- [ ] **EM2-M3: `MemoryCharacterRepository` hardcodes `faction="party"`, `aiControlled=false` — no override.**
  - Files: `infrastructure/testing/memory-repos.ts`
- [ ] **EM2-M4: No session deletion event emitted.**
  - Files: `application/services/entities/game-session-service.ts`
- [ ] **EM2-M5: Character hydration skips `damageImmunities`/`damageVulnerabilities`.**
  - Files: `application/services/combat/helpers/creature-hydration.ts`
- [ ] **EM2-M6: `MemoryItemDefinitionRepository.findByName` is case-sensitive (inconsistent with static catalog).**
  - Files: `infrastructure/testing/memory-repos.ts`

---

## TIER 4 — LOW (Quality / Polish / Non-Blocking)

### Combat Rules
- [ ] **CR2-L1: `Combat.endTurn()` double-resets action economy on new round.** Harmless but wasteful.
  - Files: `domain/combat/combat.ts`
- [ ] **CR2-L2: `getAbilityModifier`/`getProficiencyBonus` duplicated between `proficiency.ts` and `ability-checks.ts`.**
  - Files: `domain/rules/ability-checks.ts`, `domain/rules/proficiency.ts`
- [ ] **CR2-L3: `HealingEffect` doesn't verify `Creature.heal()` resets death saves.**
  - Files: `domain/effects/healing-effect.ts`
- [ ] **CR2-L4: War Caster somatic component exception not modeled (low priority until components enforced).**
  - Files: `domain/rules/feat-modifiers.ts`
- [ ] **CR2-L5: `death-saves.test.ts` uses 6 `as any` for discriminated union access.**
  - Files: `domain/rules/death-saves.test.ts`

### Spell System
- [ ] **SS2-L1: Guiding Bolt on-hit advantage effect never applied (post-attack `effects[]` ignored).**
  - Files: `domain/entities/spells/catalog/level-1.ts`, `spell-delivery/spell-attack-delivery-handler.ts`
- [ ] **SS2-L2: ~40+ `as any` casts across delivery handlers.**
  - Files: All spell delivery handlers, spell-action-handler.ts
- [ ] **SS2-L3: `SpellCastingContext.sheet` typed as `any` (TODO).**
  - Files: `spell-delivery/spell-delivery-handler.ts`

### Class Abilities
- [ ] **CA2-L1: Ranger extremely sparse — 5 features, no subclass, empty combat text profile.**
  - Files: `domain/entities/classes/ranger.ts`
- [ ] **CA2-L2: Bard `resourcePoolFactory` throws on missing CHA modifier (others default to 0).**
  - Files: `domain/entities/classes/bard.ts`
- [ ] **CA2-L3: FrenzyExecutor uses extensive `any` for actorRef/targetRef.**
  - Files: `application/services/combat/abilities/executors/barbarian/frenzy-executor.ts`
- [ ] **CA2-L4: Druid Wild Shape uses 2014-style CR limits instead of 2024 standardized stat blocks.**
  - Files: `domain/entities/classes/druid.ts`

### Combat Orchestration
- [ ] **CO2-L1: `as any` casts throughout CombatService turn lifecycle (~30 occurrences).**
  - Files: `combat-service.ts`
- [ ] **CO2-L2: DamageResolver ~500 lines handles too many concerns.**
  - Files: `tabletop/rolls/damage-resolver.ts`
- [ ] **CO2-L3: `tabletop-types.ts` uses string-based roll type discrimination instead of branded types.**
  - Files: `tabletop/tabletop-types.ts`

### AI Behavior
- [ ] **AI2-L1: AI never picks Dodge action strategically.**
  - Files: `deterministic-ai.ts`
- [ ] **AI2-L2: `extractFirstJsonObject` uses naive brace matching — fragile for verbose LLM output.**
  - Files: `infrastructure/llm/json.ts`
- [ ] **AI2-L3: Battle Plan deterministic fallback assigns same role to all creatures.**
  - Files: `battle-plan-service.ts`
- [ ] **AI2-L4: No retry/backoff in Ollama and OpenAI providers (only GitHub Models has it).**
  - Files: `infrastructure/llm/ollama-provider.ts`, `openai-provider.ts`
- [ ] **AI2-L5: Spiritual Weapon bonus action check returns token that no handler resolves.**
  - Files: `deterministic-ai.ts`, `ai-action-executor.ts`

### Entity Management
- [ ] **EM2-L1: No batch/bulk monster or NPC creation.**
  - Files: `application/repositories/monster-repository.ts`, `npc-repository.ts`
- [ ] **EM2-L2: `ItemLookupService` only supports magic items, not unified equipment lookup.**
  - Files: `application/services/entities/item-lookup-service.ts`
- [ ] **EM2-L3: No weight/encumbrance system.**
  - Files: `domain/entities/items/inventory.ts`
- [ ] **EM2-L4: Species registry missing Aasimar and Goliath.**
  - Files: `domain/entities/creatures/species.ts`
- [ ] **EM2-L5: `PendingActionRepository.updateReactionResult` uses `any` type.**
  - Files: `application/repositories/pending-action-repository.ts`

---

## Summary Stats

| Tier | Total | Done | Remaining |
|------|-------|------|-----------|
| Critical | 7 | 0 | 7 |
| High | 18 | 0 | 18 |
| Medium | 30 | 0 | 30 |
| Low | 22 | 0 | 22 |
| **Total** | **77** | **0** | **77** |

### Items by Domain

| Domain | Critical | High | Medium | Low | Total |
|--------|----------|------|--------|-----|-------|
| Combat Rules | 1 | 2 | 5 | 5 | 13 |
| Spell System | 3 | 5 | 5 | 3 | 16 |
| Class Abilities | 2 | 4 | 9 | 4 | 19 |
| Combat Orchestration | 0 | 3 | 7 | 3 | 13 |
| AI Behavior | 2 | 4 | 7 | 5 | 18 |
| Entity Management | 0 | 3 | 6 | 5 | 14 |

---

## Recommended New SME Agents

Based on audit findings, these subsystems are complex enough to warrant dedicated agents:

| Agent Name | Scope | Rationale |
|------------|-------|-----------|
| **CombatMap-SME** | `combat-map-*.ts`, `pathfinding.ts`, `battlefield-renderer.ts` | 7 files, 1200+ lines. A*/geometry/zone/cover subsystem. Highest bug surface in domain. |
| **SpellCatalog-SME** | `domain/entities/spells/catalog/**` | Spell data accuracy vs PHB 2024. Currently levels 0-3 only, many spells with wrong/missing fields. |
| **ReactionSystem-SME** | Two-phase handlers, reaction defs, `completeMove` OA | Cross-cuts SpellSystem + CombatOrchestration. 4+ handler files + route hooks. |
| **ActionEconomy-SME** | Resource flags, economy tracking, turn resets | 15+ flags spread across `resource-utils.ts`, `extractActionEconomy`, `resetTurnResources`. |
| **CreatureHydration-SME** | `creature-hydration.ts` + species/armor/class bridging | Critical 400-line bridge layer with many fallback paths. |
| **AISpellEvaluation-SME** | `deterministic-ai.ts` spell functions, `ai-spell-delivery.ts` | Most complex AI subsystem. Slot economy + targeting + D&D rules. |
| **InventorySystem-SME** | Items, equip/unequip, potions, ground items, magic bonuses | Cross-cuts EM + Combat. 7+ files across domain + infra. |

---
