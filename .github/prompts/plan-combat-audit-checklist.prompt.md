# Combat Engine Audit — Master Checklist
> Generated: 2026-03-26 | Synthesized from 6 SME deep-dive audits (188 total findings)
> Sources: sme-research-CombatRules.md, sme-research-CombatOrchestration.md, sme-research-ClassAbilities.md, sme-research-SpellSystem.md, sme-research-EntityManagement.md, sme-research-AIBehavior.md

Use this document to track implementation. Check off items as they are completed.
Priority: 🔴 CRITICAL (bugs / data loss) → 🟠 HIGH (wrong mechanics) → 🟡 MEDIUM (gaps) → ⚪ LOW (cleanup / nice-to-have)

---

## 🔴 CRITICAL — Bugs & Data Loss

These are active correctness bugs or production data-loss issues that affect real gameplay.

- [x] **[ENT-C1]** `PendingActionRepository` has no Prisma implementation — production app uses in-memory repo directly. All in-flight reactions (Counterspell, Shield, Deflect, OA) are lost on server restart. Implement `PrismaPendingActionRepository` and add to `PrismaUnitOfWork`.
  - Files: `infrastructure/api/app.ts:199,382`, `application/repositories/pending-action-repository.ts`, `infrastructure/db/`

- [x] **[ENT-C2]** Unarmored Defense fires while wearing armor — `hydrateCharacter()` never sets `equipment` on `CharacterData`. `Character.getAC()` always sees `getEquipment()?.armor === undefined`, so Unarmored Defense AC applies to armored Barbarians/Monks.
  - File: `application/services/combat/helpers/creature-hydration.ts:87`

- [x] **[ENT-C3]** `subclass`/`subclassLevel` never hydrated from sheet — Open Hand Technique always fails for DB-loaded monks. `getSubclass()` returns `undefined`.
  - File: `application/services/combat/helpers/creature-hydration.ts:130`

- [ ] **[AI-C1]** AI spell casting is a no-op — `cast-spell-handler.ts` spends the slot and emits an event but applies zero mechanical effects (no damage, healing, conditions, zones). Affects all AI/monster spellcasters.
  - File: `application/services/combat/ai/handlers/cast-spell-handler.ts:131`

- [x] **[RULES-C1]** Exhaustion d20 penalty is double the correct value — code gives −(level × 2) instead of −level. Level 1 Exhaustion should be −1 to all d20 rolls, not −2.
  - File: `domain/entities/combat/conditions.ts:469-476`

- [x] **[CLASS-C1]** Bard `resourcesAtLevel` not defined — Bardic Inspiration pool is silently skipped at combat start. Only `resourcePoolFactory` exists; `buildCombatResources()` calls `resourcesAtLevel?.()` which is `undefined`.
  - File: `domain/entities/classes/bard.ts`

---

## 🟠 HIGH — Wrong Mechanics / Broken Features

### Entity / Hydration

- [ ] **[ENT-H1]** Temp HP not persisted — `CombatantStateRecord` has no `hpTemp` field. Temp HP gained mid-combat is lost on server restart / re-hydration.
  - File: `application/types.ts`, `application/services/combat/helpers/creature-hydration.ts:253`

- [ ] **[ENT-H2]** Monster/NPC damage resistances not on domain entity — `Creature` base class has no `getDamageResistances()`/`getDamageImmunities()` methods. All callers must side-channel through `extractDamageDefenses(statBlock)`. Easy to miss in new combat paths.
  - File: `domain/entities/creatures/`, `application/services/combat/helpers/creature-hydration.ts`

- [ ] **[ENT-H3]** Magic armor equip via inventory PATCH doesn't update sheet AC — `enrichSheetArmor()` only runs at character creation. Equipping `+1 Breastplate` post-creation has no effect on numeric AC.
  - File: `infrastructure/api/routes/sessions/session-inventory.ts`

- [ ] **[ENT-H4]** Monsters cannot be deleted — `IMonsterRepository` has no `delete()` method (unlike `INPCRepository`). A monster added by mistake cannot be removed.
  - File: `application/repositories/monster-repository.ts`, `infrastructure/db/`

### Combat Conditions

- [ ] **[RULES-H1]** Charmed condition has zero mechanical enforcement — can't attack charmer, charmer social advantage — neither enforced. `ConditionEffects` has no field to express "cannot target creature X."
  - File: `domain/entities/combat/conditions.ts:173-175`

- [x] **[RULES-H2]** Petrified condition missing resistance to all damage + poison/disease immunity. Interface `ConditionEffects` has no `resistsAllDamage` field.
  - File: `domain/entities/combat/conditions.ts:188-196`

- [ ] **[RULES-H3]** Unconscious condition does not auto-apply Prone or drop items when applied.
  - File: `domain/entities/combat/conditions.ts:233-244`

### Combat Orchestration

- [ ] **[ORCH-H1]** ActionService OA damage uses rough `1d6+strMod` estimate for all weapons — programmatic move path computes OA with wrong weapon stats. Real weapon should be looked up.
  - File: `application/services/combat/action-service.ts:550`

- [ ] **[ORCH-H2]** Ready action trigger never fires — `handleReadyAction()` stores `{ condition, action }` in `resources.readiedAction` but no lifecycle hook in `combat-service.ts`, `nextTurn()`, or `TwoPhaseActionService` ever evaluates the trigger. Ready mechanic is permanently dormant.
  - File: `application/services/combat/tabletop/dispatch/social-handlers.ts`, `combat-service.ts`

- [ ] **[ORCH-H3]** Absorb Elements / Hellish Rebuke unreachable from tabletop dice flow — `TwoPhaseActionService.initiateDamageReaction()` exists but no tabletop route (`session-tabletop.ts`) calls it after damage is dealt. Player damage reactions can never fire.
  - File: `application/services/combat/two-phase-action-service.ts`, `infrastructure/api/routes/sessions/session-tabletop.ts`

- [ ] **[ORCH-H4]** Uncanny Dodge not implemented anywhere — Rogue 7 reaction (halve damage from one attack) has no presence in `TwoPhaseActionService`, no `ClassCombatTextProfile`, no executor.
  - File: `domain/entities/classes/rogue.ts`, `application/services/combat/two-phase/`

- [ ] **[ORCH-H5]** LLM fallback handles only 3 of 19 action types — when text parser fails and falls back to LLM, only `move`, `moveToward`, and `attack` are handled. All other types (hide, grapple, castSpell, shove, etc.) throw `ValidationError("not yet implemented")`.
  - File: `application/services/combat/tabletop/action-dispatcher.ts:131-162`

- [ ] **[ORCH-H6]** Death save auto-roll uses stale combatant index — `nextTurn()` advances `turn` via `endTurn()` then looks up death save target using old index. Could resolve the wrong combatant.
  - File: `application/services/combat/combat-service.ts:727`

- [ ] **[ORCH-H7]** Friendly NPC faction "party" not counted in victory check — `CombatVictoryPolicy` only checks `faction === "player"`. An enemy victory fires even when a `faction: "party"` NPC ally survives.
  - File: `application/services/combat/combat-victory-policy.ts`

- [ ] **[ORCH-H8]** ActionService has no `INarrativeGenerator` injection — three related TODOs. All programmatic API actions (`POST /sessions/:id/actions`) produce no narrative text.
  - File: `application/services/combat/action-service.ts:69,175,550`

### Spell System

- [ ] **[SPELL-H1]** Player-cast spells cannot be Counterspelled — `SpellActionHandler` resolves spells immediately with no `initiateSpellCast()` call. Only AI-cast spells and explicit `/initiate` endpoint trigger counterspell opportunities.
  - File: `application/services/combat/tabletop/spell-action-handler.ts`

- [ ] **[SPELL-H2]** No canonical `PreparedSpellDefinition` catalog — spell mechanics (damage dice, save ability, AoE shape, effects) live only as ad-hoc JSON in character sheets. Two characters with Fireball can have different mechanics. No server-side validation or canonical lookup.
  - File: `domain/entities/spells/`, `application/services/entities/spell-lookup-service.ts`

### AI Behavior

- [ ] **[AI-H1]** Monster/NPC spell slots never deducted — `prepareSpellCast()` is gated behind `isCharacterCaster`. Monsters can cast leveled spells unlimited times per combat.
  - File: `application/services/combat/helpers/spell-slot-manager.ts`, `application/services/combat/ai/handlers/cast-spell-handler.ts`

- [ ] **[AI-H2]** Deterministic AI never uses Extra Attack — always sets `endTurn: true` after first attack. Fighters/Monks with Extra Attack only attack once.
  - File: `application/services/combat/ai/deterministic-ai.ts`

- [ ] **[AI-H3]** Deterministic AI has no spell-casting path at all — monsters/NPCs with spells only ever melee/ranged attack.
  - File: `application/services/combat/ai/deterministic-ai.ts`

- [ ] **[AI-H4]** AI range check skipped for Character/NPC attackers — `attack-handler.ts` only loads `monsterAttacks` for Monsters. Characters/NPCs can attack from any range without validation.
  - File: `application/services/combat/ai/handlers/attack-handler.ts:95`

- [ ] **[AI-H5]** Battle plan LLM never receives enemy AC/speed — both hardcoded `undefined` in enemy list build.
  - File: `application/services/combat/ai/battle-plan-service.ts`

- [ ] **[AI-H6]** Faction creature abilities not sent to LLM battle planner — `factionCreatures` never calls `listCreatureAbilities()`. LLM plans without knowing own faction's spells or abilities.
  - File: `application/services/combat/ai/battle-plan-service.ts`

- [ ] **[AI-H7]** `escapeGrapple` not in `isActionConsuming()` — action economy guard doesn't prevent AI from attempting escape twice in one turn.
  - File: `application/services/combat/ai/ai-action-executor.ts`

### Class Abilities

- [ ] **[CLASS-H1]** Monk `restRefreshPolicy` missing `uncanny_metabolism` and `wholeness_of_body` — these pools are built at combat start but never refreshed on long rest.
  - File: `domain/entities/classes/monk.ts:130-134`

- [ ] **[CLASS-H2]** Rogue Cunning Action: Hide returns `NOT_IMPLEMENTED` error — one of three core Cunning Action uses throws immediately.
  - File: `application/services/combat/abilities/executors/rogue/cunning-action-executor.ts:104`

- [ ] **[CLASS-H3]** Evasion declared but not enforced in saving throw path — both Monk and Rogue have feature key + features map entry but `SavingThrowResolver` doesn't convert "half on success" → "no damage on success."
  - File: `application/services/combat/tabletop/rolls/saving-throw-resolver.ts`, `domain/entities/classes/monk.ts`, `domain/entities/classes/rogue.ts`

- [ ] **[CLASS-H4]** `UNCANNY_DODGE` reaction uses raw string `input.className !== "rogue"` instead of `classHasFeature()` — breaks multiclass characters.
  - File: `domain/entities/classes/rogue.ts:120`

- [ ] **[CLASS-H5]** Monk `DeflectAttacks` reaction uses raw `className === "monk"` check — same anti-pattern as H4, breaks multiclass.
  - File: `domain/entities/classes/monk.ts`

- [ ] **[CLASS-H6]** Initiative tie-breaking uses alphabetical ID, not DEX score — D&D 2024 ties should break on DEX score (higher DEX first).
  - File: `domain/combat/initiative.ts:18`

---

## 🟡 MEDIUM — Missing Features / Gaps / Partial Implementations

### Missing Combat Rules

- [ ] **[RULES-M1]** Expert skills (Rogue Expertise / Bard Expertise) not modeled — `AbilityCheckOptions` only has `proficient: boolean`. No `expertise: boolean` that doubles proficiency. All Rogue/Bard skill rolls compute wrong modifier.
  - File: `domain/rules/ability-checks.ts:34-37`

- [ ] **[RULES-M2]** Creature-based cover not computed — `getCoverLevel()` only ray-marches terrain cells, never consults the `MapEntity[]` list. Intervening Large creatures should grant half cover (+2 AC).
  - File: `domain/rules/combat-map-sight.ts`

- [ ] **[RULES-M3]** Teleportation/involuntary movement has no OA exception flag — `OpportunityAttackTrigger` has no `isTeleporting` or `isCarried` field. These movement types should not provoke OAs.
  - File: `domain/rules/opportunity-attack.ts:17-30`

- [ ] **[RULES-M4]** War Caster feat entirely missing — no `FEAT_WAR_CASTER` constant, no advantage on CON concentration saves pathway, no spell-as-OA reaction handler.
  - File: `domain/rules/feat-modifiers.ts`

- [ ] **[RULES-M5]** Savage Attacker feat tracked but never applied — `savageAttackerEnabled` is in `FeatModifiers` but `attack-resolver.ts` never reads it (reroll damage once per turn, use higher).
  - File: `domain/rules/feat-modifiers.ts:70`, `domain/combat/attack-resolver.ts`

- [ ] **[RULES-M6]** Grappler feat tracked but never applied — `grapplerEnabled` is in `FeatModifiers` but `grapple-shove.ts` never grants attack advantage vs grappled target.
  - File: `domain/rules/feat-modifiers.ts:72`, `domain/rules/grapple-shove.ts`

- [ ] **[RULES-M7]** Resilient feat entirely missing — no save proficiency modeling (`savingThrowProficiencies` field doesn't exist in `FeatModifiers`). Very common feat that affects concentration and death saves.
  - File: `domain/rules/feat-modifiers.ts`

- [ ] **[RULES-M8]** Jump landing skill checks — two explicit TODO comments. DC 10 Acrobatics if landing in Difficult Terrain; DC 10 Athletics for clearing low obstacles.
  - File: `domain/rules/movement.ts:193-194`

### Missing Spell System Features

- [ ] **[SPELL-M1]** Concentration not cleared on long/short rest — `breakConcentration()` is never called during rest processing. Active concentration persists into next session.
  - File: `application/services/entities/character-service.ts` (rest handling)

- [ ] **[SPELL-M2]** Pact Magic slot level validation absent — `prepareSpellCast()` only checks `hasResourceAvailable(resources, "pactMagic", 1)` without verifying slot level ≥ required spell level.
  - File: `application/services/combat/helpers/spell-slot-manager.ts:115-125`

- [ ] **[SPELL-M3]** AoE cover bonus not applied per-target — single-target path applies `getCoverSaveBonus(coverLevel)` to DEX saves; AoE `handleAoE()` path skips per-target cover checks entirely.
  - File: `application/services/combat/tabletop/spell-delivery/save-spell-delivery-handler.ts`

- [ ] **[SPELL-M4]** `spellSaveDC` is a static sheet field with no server-side computation or enforcement — defaults to 13 if missing. No formula enforced across Cleric (WIS), Bard (CHA), Sorcerer (CHA), Druid (WIS), Ranger (WIS), Paladin (CHA).
  - File: `application/services/combat/tabletop/spell-delivery/save-spell-delivery-handler.ts:96`

- [ ] **[SPELL-M5]** `spellAttackBonus` is a static sheet field — defaults to +5 if missing. Same enforcement gap as M4.
  - File: `application/services/combat/tabletop/spell-delivery/spell-attack-delivery-handler.ts:59`

- [ ] **[SPELL-M6]** AoE healing not implemented — `HealingSpellDeliveryHandler` can't handle spells with both `healing` and `area` set (Mass Cure Wounds, Prayer of Healing). Throws `ValidationError` for missing `targetName`.
  - File: `application/services/combat/tabletop/spell-delivery/healing-spell-delivery-handler.ts`

- [ ] **[SPELL-M7]** Monsters excluded as counterspellers — `SpellReactionHandler` checks `other.combatantType !== "Character"` and skips all monsters. Archmage, Lich, etc. cannot counter enemy spells.
  - File: `application/services/combat/two-phase/spell-reaction-handler.ts:79`

- [ ] **[SPELL-M8]** Self-buff spells without `effects[]` array are silently no-ops — no guard or warning emitted when a buff/debuff spell is cast with no effects defined.
  - File: `application/services/combat/tabletop/spell-action-handler.ts`, `application/services/combat/tabletop/spell-delivery/buff-debuff-spell-delivery-handler.ts`

### Missing Class Features

- [ ] **[CLASS-M1]** Paladin Aura of Protection entirely absent (level 6) — add CHA modifier to all saving throws for self + allies in 10 ft. No feature key, no executor, not in `capabilitiesForLevel`.
  - File: `domain/entities/classes/paladin.ts`

- [ ] **[CLASS-M2]** Fighter Indomitable in `capabilitiesForLevel` but no implementation — shows in tactical view but cannot be activated (no ability ID, no resource pool, no executor).
  - File: `domain/entities/classes/fighter.ts:162`

- [ ] **[CLASS-M3]** Barbarian Brutal Strike entirely absent (level 9, replaces Brutal Critical in 2024) — no feature key, no executor, no text profile entry.
  - File: `domain/entities/classes/barbarian.ts`, `feature-keys.ts`

- [ ] **[CLASS-M4]** Warlock missing features map and `capabilitiesForLevel` — only `pact-magic: 1` in features. No invocations, no pact boon, no combat text profile action mappings (copilot instructions incorrectly says eldritch blast mapping exists — update docs too).
  - File: `domain/entities/classes/warlock.ts`, `.github/copilot-instructions.md:214`

- [ ] **[CLASS-M5]** Ranger fully missing in-combat implementation — no resource pools, no executors, no combat text profile, no `capabilitiesForLevel`. Hunter's Mark (level 1) is the most critical gap.
  - File: `domain/entities/classes/ranger.ts`

- [ ] **[CLASS-M6]** Bard fully missing in-combat implementation — no combat text profile, no executor for Bardic Inspiration, not registered in `COMBAT_TEXT_PROFILES`. Pool exists (see C1 fix) but can't be activated.
  - File: `domain/entities/classes/bard.ts`

- [ ] **[CLASS-M7]** Sorcerer has no implementation — no executors, no text profile, no resource pools for Sorcery Points / Metamagic.
  - File: `domain/entities/classes/`

- [ ] **[CLASS-M8]** Druid has no implementation — no executors, no Wild Shape mechanic, no text profile.
  - File: `domain/entities/classes/`

- [ ] **[CLASS-M9]** Open Hand Technique enhancement offered to all Monks in tactical view — not gated on Open Hand subclass. Any monk gets the option regardless of subclass.
  - File: (tactical view assembly)

### AI Behavior Gaps

- [ ] **[AI-M1]** `counterspell` AI decision is always `true` — no context-awareness. Goblin with 1 slot counters cantrips; never saves reaction for high-value spells.
  - File: `application/services/combat/ai/ai-turn-orchestrator.ts`

- [ ] **[AI-M2]** Deterministic battle plan `priority` always `"offensive"` — reads `combatant.resources.challengeRating` which doesn't exist in resource type, always `undefined`, always defaults to `"offensive"`.
  - File: `application/services/combat/ai/battle-plan-service.ts`

- [ ] **[AI-M3]** Deterministic AI `pickBonusAction()` missing several bonus actions — no Patient Defense, Step of the Wind, Divine Smite, Bardic Inspiration, Action Surge.
  - File: `application/services/combat/ai/deterministic-ai.ts`

- [ ] **[AI-M4]** No AI handler for primary-action class features — Turn Undead, Channel Divinity, Lay on Hands have no `"useFeature"` AI action type. AI can't trigger these.
  - File: `application/services/combat/ai/`, `ai-action-registry.ts`

- [ ] **[AI-M5]** Legacy bonus action string matching in `ai-action-executor.ts` — `if/else` chain for `nimble_escape_disengage`, `cunning_action_dash`, etc. bypasses `AbilityRegistry`. New abilities require new `if` branch.
  - File: `application/services/combat/ai/ai-action-executor.ts`

- [ ] **[AI-M6]** Unconditional `console.log` calls in production — 13 calls in `attack-handler.ts` and `ai-attack-resolver.ts` bypass the `aiLog` debug gate. Fire on every AI attack in production.
  - File: `application/services/combat/ai/handlers/attack-handler.ts`, `application/services/combat/ai/ai-attack-resolver.ts`

- [ ] **[AI-M7]** Mock LLM `setDefaultBehavior()` union missing action types — `shove`, `dodge`, `dash`, `disengage`, `help`, `search` can't be scripted as defaults in test scenarios.
  - File: `application/services/combat/ai/mocks/index.ts`

- [ ] **[AI-M8]** AI `castSpell` option shown when creature has no spells — LLM prompt lists `castSpell` unconditionally, not gated on `spells.length > 0`.
  - File: (AI context builder / system prompt)

### Combat Orchestration Gaps

- [ ] **[ORCH-M1]** War Caster: spell as Opportunity Attack reaction — no handler. `MoveReactionHandler` offers weapon OAs only.
  - File: `application/services/combat/two-phase/move-reaction-handler.ts`

- [ ] **[ORCH-M2]** Sentinel feat — none of the three effects implemented (OA reduces speed to 0, OA on Disengage against you, reaction when enemy attacks nearby creature).
  - File: `domain/rules/feat-modifiers.ts`, `application/services/combat/two-phase/`

- [ ] **[ORCH-M3]** Divergent OA resolution paths — `ActionService.move()` has its own OA detection loop (in addition to `TwoPhaseActionService`). Both paths can drift; programmatic path has wrong weapon stats (see H1).
  - File: `application/services/combat/action-service.ts:450-568`

- [ ] **[ORCH-M4]** `handleDamageRoll()` contains ~130 lines of on-hit enhancement assembly inline — class-specific detection (Stunning Strike, Divine Smite, Open Hand Technique) belongs in domain `HitRiderResolver` / `ClassCombatTextProfile.attackEnhancements`, not hard-coded in the state machine.
  - File: `application/services/combat/tabletop/roll-state-machine.ts:870-1000`

- [ ] **[ORCH-M5]** `handleAttackAction()` dispatch handler is ~350 lines — too large. Should be decomposed: `detectThrownWeapon()`, `computeCoverBonus()`, `resolveMagicWeaponBonus()`, etc.
  - File: `application/services/combat/tabletop/dispatch/attack-handlers.ts`

- [ ] **[ORCH-M6]** `InitiativeHandler` has 4-way duplicated resource-building block — same ~80-line pattern repeated for PC initiator, other PCs, monsters, and NPCs. Extract `buildCombatantEntry()` helper.
  - File: `application/services/combat/tabletop/rolls/initiative-handler.ts:100-450`

- [ ] **[ORCH-M7]** Evasion resolution — verify `evasionDetected` flag is actually consumed to apply half/no damage. Possible incomplete implementation.
  - File: `application/services/combat/tabletop/rolls/saving-throw-resolver.ts:337`

### Entity Management Gaps

- [ ] **[ENT-M1]** `PendingActionRepository.cleanupExpired()` defined but never called — expired pending actions accumulate in the in-memory repo. No scheduled cleanup.
  - File: `infrastructure/testing/memory-repos.ts`, application startup

- [ ] **[ENT-M2]** `ICharacterRepository` and `IMonsterRepository` missing `delete()` — characters and monsters added to a session cannot be removed. Only NPCs support deletion.
  - File: `application/repositories/character-repository.ts`, `application/repositories/monster-repository.ts`

- [ ] **[ENT-M3]** `className` not validated against class registry in `CharacterService.addCharacter()` — any string accepted. Characters with invalid class IDs get no resource pools at combat start.
  - File: `application/services/entities/character-service.ts:32-74`

- [ ] **[ENT-M4]** Rest operation not transactional — `takeSessionRest()` loops with multiple `characters.updateSheet()` calls. Crash mid-rest leaves some characters restored and others not.
  - File: `application/services/entities/character-service.ts`

- [ ] **[ENT-M5]** Missing SSE events: `MonsterAdded`, `NPCAdded`, `InventoryChanged` — clients can't subscribe to roster/inventory changes in real-time.
  - File: `application/services/entities/`, event type union

- [ ] **[ENT-M6]** Magic item charges not decremented via API — no HTTP endpoint or `CharacterService` method to decrement `currentCharges` after item use (except potions). Staff of Fire casts unlimited times.
  - File: `infrastructure/api/routes/sessions/session-inventory.ts`

- [ ] **[ENT-M7]** No out-of-combat "use item" HTTP endpoint — `useConsumableItem()` exists as domain function but no `POST /sessions/:id/characters/:charId/inventory/:itemName/use` route.
  - File: `infrastructure/api/routes/sessions/session-inventory.ts`

- [ ] **[ENT-M8]** `ItemDefinition` Prisma table orphaned — comment in `magic-item-catalog.ts:7` implies intent to use it for catalog storage, but all items served from static code catalog. No write path.
  - File: `prisma/schema.prisma`, `domain/entities/items/magic-item-catalog.ts`

- [ ] **[SPELL-M9]** `SpellLookupService` TODO is stale/misleading — lists 6 "future" features most of which are already implemented elsewhere. Misleads future developers.
  - File: `application/services/entities/spell-lookup-service.ts:10-16`

---

## ⚪ LOW — Cleanup, Architecture, Nice-to-Have

### Code Cleanup

- [ ] **[CLEAN-L1]** `ConditionEffects` field naming inconsistency — `attackRollsHaveAdvantage` means "attacks against this creature have advantage" but `attackRollsHaveDisadvantage` means "this creature's attacks have disadvantage." Rename `attackRollsHaveAdvantage` → `incomingAttackAdvantage` to match `incomingAttackDisadvantage`.
  - File: `domain/entities/combat/conditions.ts:63-83`

- [ ] **[CLEAN-L2]** `ConditionEffects` missing `resistsAllDamage?: boolean` and `damageImmunities?: DamageType[]` fields — required to properly model Petrified and similar conditions (see H2).
  - File: `domain/entities/combat/conditions.ts`

- [ ] **[CLEAN-L3]** `computeSpellSaveDC()` should be a shared domain function — currently duplicated inline in `wizard.ts:142` and `warlock.ts:101`. Extract to `domain/rules/`.
  - File: `domain/entities/classes/wizard.ts:142`, `domain/entities/classes/warlock.ts:101`

- [ ] **[CLEAN-L4]** 13 unconditional `console.log` calls in AI production code bypass debug gate — replace with `this.aiLog(...)`.
  - File: `application/services/combat/ai/handlers/attack-handler.ts`, `application/services/combat/ai/ai-attack-resolver.ts`

- [ ] **[CLEAN-L5]** Damage reactions in `TwoPhaseActionService` not delegated — Absorb Elements / Hellish Rebuke handlers are inline in the facade (~170 lines) instead of using dedicated handler classes like all other reaction types.
  - File: `application/services/combat/two-phase-action-service.ts`

- [ ] **[CLEAN-L6]** 10 trivial one-liner proxy methods in `ActionDispatcher` add no abstraction — `handlePickupAction()` etc. exclusively forward to handler classes. Remove them; call handler methods directly from `buildParserChain()`.
  - File: `application/services/combat/tabletop/action-dispatcher.ts`

- [ ] **[CLEAN-L7]** `InventoryItem` legacy type in `inventory.ts` — comment says "legacy for backward compat." Investigate if it can be unified with `CharacterItemInstance`.
  - File: `domain/entities/items/inventory.ts:18-40`

- [ ] **[CLEAN-L8]** `proficiencyBonus` computed but not used in `hydrateCharacter()` — `const proficiencyBonus = readNumber(...)` is set but never passed into `CharacterData`. Dead code.
  - File: `application/services/combat/helpers/creature-hydration.ts:96`

- [ ] **[CLEAN-L9]** `Turn Undead` AoE post-processing inline in `ClassAbilityHandlers` — after executor runs, the multi-target zone saving throw loop is inline in the handler, not in `SavingThrowResolver` or a dedicated AoE resolver.
  - File: `application/services/combat/tabletop/dispatch/class-ability-handlers.ts`

- [ ] **[CLEAN-L10]** Dead code `ready` branch in `handleSimpleAction()` — `case "ready": throw ValidationError(...)` can never be reached as  `ready` is intercepted by its own parser entry.
  - File: `application/services/combat/tabletop/dispatch/social-handlers.ts`

- [ ] **[CLEAN-L11]** 4 PromptBuilder migration TODOs — `battle-planner.ts`, `character-generator.ts`, `intent-parser.ts`, `narrative-generator.ts`, `story-generator.ts` all have TODO to migrate to `PromptBuilder`.
  - File: `infrastructure/llm/battle-planner.ts:70`, etc.

- [ ] **[CLEAN-L12]** AI LLM retry uses same parameters — retry `options` (model/temp/seed) are identical to initial call. Retry won't produce different results. Consider temperature increase on retry.
  - File: `application/services/combat/ai/llm/ai-decision-maker.ts:77`

- [ ] **[CLEAN-L13]** `INITIATIVE → INITIATIVE_SWAP` transition bypasses `assertValidTransition()` — `InitiativeHandler` calls `combat.setPendingAction(INITIATIVE_SWAP)` directly, skipping the state machine guard.
  - File: `application/services/combat/tabletop/rolls/initiative-handler.ts`

### Missing Rules (Lower Impact)

- [ ] **[RULES-L1]** Lucky feat entirely missing — 3 luck points, reroll d20 on attack/check/save or impose reroll on attacker.
  - File: `domain/rules/feat-modifiers.ts`

- [ ] **[RULES-L2]** Tough feat entirely missing — +2 max HP per level. Very common feat.
  - File: `domain/rules/feat-modifiers.ts`, `domain/rules/hit-points.ts`

- [ ] **[RULES-L3]** `elevated` and `pit` terrain types exist in `TerrainType` but have no mechanical function — no elevation attack bonus, no pit fall effect.
  - File: `domain/rules/combat-map-types.ts:15-16`, `domain/rules/combat-map-core.ts`

- [ ] **[RULES-L4]** Stabilization via Medicine check — no `attemptStabilize()` function. DC 10 WIS (Medicine) check by another creature stabilizes a dying creature without HP.
  - File: `domain/rules/death-saves.ts`

- [ ] **[RULES-L5]** Forced movement not grid-aligned, no obstacle collision — `pushAwayFrom()` / `pullToward()` compute continuous vector offset without snapping to 5ft grid or stopping at walls.
  - File: `domain/combat/movement.ts:152-198`

- [ ] **[RULES-L6]** Exhaustion level 6 speed reduction incomplete — `getExhaustionSpeedReduction(6) = 30`. Creatures with speed > 30ft (Monk with Unarmored Movement) may not reach 0 speed at level 6 before death fires separately.
  - File: `domain/entities/combat/conditions.ts:487-494`

- [ ] **[RULES-L7]** Long rest interrupted by spellcasting not tracked — acknowledged in code comment. `SpellCast` event type doesn't exist; only `DamageApplied` triggers rest interruption.
  - File: `domain/rules/rest.ts:153`

- [ ] **[RULES-L8]** Flanking entirely absent — optional rule; worth a design decision: implement as encounter toggle or document as intentionally omitted.

- [ ] **[RULES-L9]** Jack of All Trades (Bard) — `AbilityCheckOptions.proficient: boolean` is binary. No half-proficiency (`proficiencyMultiplier: 0.5`) for non-proficient skill checks.
  - File: `domain/rules/ability-checks.ts`

- [ ] **[RULES-L10]** Alert feat `initiativeSwapEnabled` has no domain-level `swapInitiative()` function. Application layer handles it but domain support is incomplete.
  - File: `domain/rules/feat-modifiers.ts`, `domain/combat/initiative.ts`

### AI / Performance

- [ ] **[AI-L1]** N+M DB queries per AI context build — one repo call per ally + one per enemy in `buildAllyDetails()`/`buildEnemyDetails()`. 10-combatant encounter × 5 iterations = 50+ DB queries per AI turn.
  - File: `application/services/combat/ai/ai-context-builder.ts`

- [ ] **[AI-L2]** Multiple encounter loads per AI turn loop — `getEncounterById()` + `listCombatants()` called 3+ times at outer loop level. Should be batched or cached per turn.
  - File: `application/services/combat/ai/ai-turn-orchestrator.ts`

- [ ] **[AI-L3]** `listCreatureAbilities()` silently swallows all exceptions in AI context build — `catch { // Ignore errors }` hides performance and logic issues.
  - File: `application/services/combat/ai/ai-context-builder.ts`

- [ ] **[AI-L4]** Counterspell default INT ability for non-Wizard casters — Warlock/Cleric Counterspell uses wrong ability modifier for the optional Arcana check.
  - File: `application/services/combat/two-phase/spell-reaction-handler.ts:295`

- [ ] **[AI-L5]** OpenAI provider is a stub that throws on first call — `DM_LLM_PROVIDER=openai` config silently fails.
  - File: `infrastructure/llm/openai-provider.ts`

### Entity / Infrastructure

- [ ] **[ENT-L1]** 3 orphaned Prisma tables with no application code — `ClassFeatureDefinition`, `ItemDefinition`, `ConditionDefinition`. Either implement or drop.
  - File: `prisma/schema.prisma`

- [ ] **[ENT-L2]** `createInMemoryRepos()` doesn't include `pendingActionsRepo` — tests needing reactions must instantiate it separately, creating boilerplate and risk of missing it.
  - File: `infrastructure/testing/memory-repos.ts`

- [ ] **[ENT-L3]** NPC profession bonus scaling — NPCs used as enemies use `data.proficiencyBonus ?? 2` (fixed), not CR-based formula like monsters. High-CR NPCs get wrong proficiency.
  - File: `domain/entities/creatures/`

- [ ] **[ENT-L4]** `darkvisionRange` set from species only, never from sheet override — manual darkvision overrides on character sheet are ignored.
  - File: `application/services/combat/helpers/creature-hydration.ts`

- [ ] **[ENT-L5]** 4 MockCharacterGenerator templates missing — Bard, Sorcerer, Ranger, Druid have no mock templates. Limits AI character behavior test coverage.
  - File: `application/services/combat/ai/mocks/index.ts`

---

## Summary Statistics

| Priority | Count |
|----------|-------|
| 🔴 CRITICAL | 6 |
| 🟠 HIGH | 30 |
| 🟡 MEDIUM | 36 |
| ⚪ LOW | 34 |
| **TOTAL** | **106** |

---

## Recommended Implementation Order

### Sprint 1 — Fix Critical Bugs (all 🔴 items)
1. ENT-C1: PrismaPendingActionRepository
2. ENT-C2: Hydrate equipment (Unarmored Defense AC bug)
3. ENT-C3: Hydrate subclass (Open Hand Technique)
4. AI-C1: AI spell mechanical effects
5. RULES-C1: Exhaustion penalty formula
6. CLASS-C1: Bard resourcesAtLevel

### Sprint 2 — Core High Priority
Focus on items with the widest impact:
- ORCH-H1: OA weapon stats
- ORCH-H2: Ready action trigger system
- ORCH-H3+ORCH-H4: Damage reactions + Uncanny Dodge
- ORCH-H5: LLM fallback action coverage
- SPELL-H1: Player spell counterspell opportunity
- AI-H1: Monster spell slot deduction
- AI-H2+AI-H3: Deterministic Extra Attack + spells
- CLASS-H1: Monk rest refresh policy
- CLASS-H2: Cunning Action Hide
- CLASS-H3: Evasion enforcement

### Sprint 3 — Architecture & Major Classes
- SPELL-H2: Canonical spell definition catalog
- CLASS-M1 through CLASS-M8: Missing class implementations
- ORCH-M4 through ORCH-M6: Code structure cleanup
- ENT-H1: Temp HP persistence
- ENT-H2: Creature damage resistance on domain entity

### Sprint 4 — Missing Rules & Polish
- Remaining RULES-M and RULES-L items (feats, cover, conditions)
- AI tactical improvements
- Event system completeness
- Inventory management gaps
