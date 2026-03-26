# SME Research — EntityManagement
**Scope**: Deep dive across ALL entity management code.  
**Files covered**: 45+ files across services/entities, domain entities, repositories, infrastructure/db, infrastructure/testing, and application/types.

---

## Category 1: TODO / FIXME Comments (2 found)

| # | File | Line | Priority | Description |
|---|------|------|----------|-------------|
| 1 | `application/services/entities/spell-lookup-service.ts` | 10-17 | Medium | 7-item TODO block: slot consumption, concentration tracking, save DC calc, TwoPhaseActionService integration for reaction spells, ActionService integration for spell attacks, AoE targeting. These are documented aspirations — some are NOW actually implemented elsewhere (concentration in `concentration-helper.ts`, TwoPhase reactions in `two-phase/spell-reaction-handler.ts`). The comment is stale/misleading about what's done vs not done. |
| 2 | `domain/entities/items/magic-item-catalog.ts` | 428 | Low | Potion of Speed's Haste "extra action" not implemented — comment says "implement extra action via separate work." A real functional gap in Potion of Speed mechanics. |

---

## Category 2: Repository Interface Parity Gaps — **3 gaps, 1 critical**

### 2A. `PendingActionRepository` has NO Prisma implementation — CRITICAL
- **Interface**: `application/repositories/pending-action-repository.ts` (11 methods)
- **Only implementation**: `InMemoryPendingActionRepository` in `infrastructure/testing/memory-repos.ts:474`
- **Used in production**: `infrastructure/api/app.ts:199` and `:382` — `new InMemoryPendingActionRepository()` is instantiated directly in the production app factory.
- **Impact**: ALL pending actions (reaction prompts, Counterspell, Shield, Deflect Attacks, Opportunity Attacks) are LOST on server restart. A production server that restarts mid-reaction always orphans those pending actions.
- **Not in UoW**: `PrismaUnitOfWork.run()` (`infrastructure/db/unit-of-work.ts`) does NOT include a `pendingActionsRepo` in its `RepositoryBundle`. Reaction resolution is therefore non-transactional: pendingAction + combatantState + event writes can be split across a crash.
- **Not exported from barrel**: `application/repositories/index.ts` — all OTHER repo interfaces are exported; `PendingActionRepository` is not, which is an inconsistency.

### 2B. `ICharacterRepository` and `IMonsterRepository` missing `delete()`
- **Interface**: `application/repositories/character-repository.ts` — no `delete()`
- **Interface**: `application/repositories/monster-repository.ts` — no `delete()`
- **Compare**: `INPCRepository` (`application/repositories/npc-repository.ts`) HAS `delete(id: string)`; Prisma and memory impls both implement it.
- **Impact**: Characters and monsters added to a session cannot be removed. If a DM accidentally adds a wrong monster, the only fix is recreating the session.
- Priority: Medium

### 2C. `ICharacterRepository` and `IMonsterRepository` missing `updateFaction()` / `updateAiControlled()`
- Neither `ICharacterRepository` nor `IMonsterRepository` has methods to update `faction` or `aiControlled` post-creation; only `updateSheet` exists. Changing a monster's faction mid-session is impossible without re-creating it.
- Priority: Low

---

## Category 3: Dead Prisma DB Tables with No Repository (3 orphaned tables)

All three exist in `prisma/schema.prisma` but have ZERO application-layer code reading from them. No repository interface, no Prisma implementation, no service usage.

| Table | Schema Lines | Comment in catalog | Priority |
|-------|-------------|-------------------|----------|
| `ClassFeatureDefinition` | ~31-38 | No reference in any app code | Low (likely planned) |
| `ItemDefinition` | ~40-47 | `magic-item-catalog.ts:7` references it: _"or loaded from the database via the ItemDefinition table"_ but never does | Medium — StaticCatalog vs DB split is half-done |
| `ConditionDefinition` | ~49-55 | No reference anywhere | Low (likely stale) |

`ItemDefinition` is the most impactful because the comment implies intent to use it, but all magic items are currently served from the static in-code catalog. If a DM wants custom magic items, there's no path.

---

## Category 4: Creature Hydration Gaps — **3 confirmed gaps, 1 potential bug**

### 4A. [BUG — HIGH] Character `equipment` not hydrated → Unarmored Defense incorrectly fires for Barbarians/Monks wearing armor

`hydrateCharacter()` (`application/services/combat/helpers/creature-hydration.ts:87-145`) never reads `equippedArmor` or `equippedShield` from the sheet. The `CharacterData` passed to `new Character(...)` has no `equipment` field.

```ts
// hydrateCharacter() does NOT include:
equipment: sheet.equippedArmor ? { armor: ..., shield: ... } : undefined,
```

In `Character.getAC()`:
```ts
const wearingArmor = !!this.getEquipment()?.armor;  // ALWAYS false for hydrated chars
if (!wearingArmor && classId && classHasFeature(classId, UNARMORED_DEFENSE, level)) {
  // This FIRES even for Barbarians/Monks wearing armor!
```

A Barbarian in Chain Mail (AC 16) hydrated from DB would incorrectly get Unarmored Defense (10 + DEX + CON) applied instead of 16. In practice this only bites if Barbarians/Monks ever enter combat while wearing armor, which is unusual but possible.

### 4B. [CONFIRMED GAP — MEDIUM] Character `subclass`/`subclassLevel` NOT read during hydration

`hydrateCharacter()` does not read `subclass` or `subclassLevel` from sheet JSON. The hydrated `Character` will always have `subclass = undefined`.

**Impact**: `hasOpenHandTechnique()` in `ClassFeatureResolver` checks `character.getSubclass()?.toLowerCase().includes("open hand")`. For a hydrated monk with Open Hand subclass, this check would fail — Open Hand Technique would not work after the character is loaded from DB. Other future subclass-gated features would share this bug.

### 4C. [CONFIRMED GAP — HIGH] Monster/NPC damage resistances NOT on domain entity

`hydrateMonster()` creates a `Monster` domain object with no `damageResistances`/`damageImmunities`/`damageVulnerabilities`. The `Monster` and `NPC` domain classes (and the base `Creature` class) have NO fields for these.

Damage defenses are handled via a SEPARATE code path: `extractDamageDefenses(statBlock)` reads from raw JSON in combat services. This creates a dual-tracking issue:
- `character.getSpeciesDamageResistances()` works for Characters
- Monsters/NPCs require the caller to call `extractDamageDefenses(statBlock)` separately
- If a new combat code path forgets to call `extractDamageDefenses()`, monsters/NPCs silently get no resistances

The `Creature` base class has no `getDamageResistances()` / `getDamageImmunities()` methods, making the polymorphic API incomplete for this concern.

### 4D. [CONFIRMED GAP — MEDIUM] `tempHP` not in `CombatantStateRecord` — lost on re-hydration

`CombatantStateRecord` (`application/types.ts`) has no `hpTemp` field. Temp HP is tracked in memory on the domain `Creature` object but is NOT persisted to DB. If a character gains Temp HP mid-combat and the server restarts (or the hydration function is called again), the Temp HP is lost.

Temp HP changes are not in `extractCombatantState()` (`creature-hydration.ts:253-260`) either — it only extracts `hpCurrent` and `conditions`.

---

## Category 5: Character Sheet Fields Consumed vs Ignored During Combat Hydration

Fields in character sheet JSON that are read during `hydrateCharacter()`:
- ✅ `abilityScores`
- ✅ `maxHP` / `hitPoints`
- ✅ `currentHP` (overridden by combatantState.hpCurrent)
- ✅ `armorClass` / `ac`
- ✅ `speed` (also overridden by species)
- ✅ `level`
- ✅ `classId`
- ✅ `featIds` / `feats`
- ✅ `resourcePools` (initial state from sheet)
- ✅ `fightingStyle`
- ✅ `species` / `race` (species trait lookup)

Fields in sheet that are **NOT** read during hydration (some are gaps, some by design):
- ❌ `subclass` / `subclassLevel` — **Gap** (see 4B above)
- ❌ `equippedArmor` / `equippedShield` → `equipment` — **Gap** (see 4A above)
- ❌ `armorTraining` — never hydrated; defaults to all-trained
- ❌ `hitDiceRemaining` — only used by `takeSessionRest()`, not hydrated to domain entity
- ❌ `className` as `CharacterData.characterClass` starts from `record.className` (not sheet), which is correct
- ❌ `damageResistances`/`damageImmunities` on Sheet — these ARE merged into `speciesDamageResistances` during hydration via `mergedResistances`, which is correct
- ❌ `darkvisionRange` — set from species but not from sheet directly (could miss manual overrides)

---

## Category 6: Inventory System Completeness

### What's working:
- ✅ CRUD API: GET/POST/DELETE/PATCH in `session-inventory.ts`
- ✅ Domain helpers: `addInventoryItem`, `removeInventoryItem`, `findInventoryItem`, `useConsumableItem`, `getAttunedCount`, `canAttune`
- ✅ Attunement slot cap (3) enforced at API layer
- ✅ `getWeaponMagicBonuses()` computes attack/damage bonuses from equipped magic weapons

### Gaps:

| # | Priority | Description |
|---|----------|-------------|
| 1 | HIGH | **Equip magic armor doesn't update sheet AC**: PATCH inventory sets `equipped: true` on the item, but does NOT re-run `enrichSheetArmor()` to update `sheet.armorClass`, `sheet.equippedArmor`, `sheet.equippedShield`. A `+1 Breastplate` equipped via inventory would NOT change the character's numeric AC. The armor enrichment only runs at character creation time. |
| 2 | MEDIUM | **Magic item charges not decremented via API**: `CharacterItemInstance.currentCharges` tracks remaining charges, but there is no HTTP endpoint or `CharacterService` method to decrement charges after item use (except potions that call `useConsumableItem()`). Actively using a Staff of Fire in combat will never reduce its charges through the standard flow. |
| 3 | MEDIUM | **No "use item" HTTP endpoint**: `useConsumableItem()` is a domain function but there is no API surface to trigger it outside combat (e.g., drinking a potion before combat starts). The combat tabletop flow routes potion use, but there's no out-of-combat `/sessions/:id/characters/:charId/inventory/:itemName/use` endpoint. |
| 4 | LOW | **No item transfer API**: can't move items between characters or drop to ground via API |
| 5 | LOW | **Inventory not synced to combatant resources at combat start**: the initialization path that copies `sheet.inventory` into `combatantState.resources.inventory` should be verified — if it's missing, combat-time item lookups for magic weapon bonuses would fail |

---

## Category 7: Event System Completeness

### Currently emitted (29 event types in union):
`SessionCreated`, `CharacterAdded`, `RestStarted`, `RestCompleted`, `CombatStarted`, `CombatEnded`, `TurnAdvanced`, `DeathSave`, `AttackResolved`, `DamageApplied`, `ActionResolved`, `OpportunityAttack`, `Move`, `HealingApplied`, `NarrativeText`, `ConcentrationMaintained`, `ConcentrationBroken`, `ReactionPrompt`, `ReactionResolved`, `Counterspell`, `ShieldCast`, `DeflectAttacks`, `DeflectAttacksRedirect`, `UncannyDodge`, `AbsorbElements`, `HellishRebuke`, `AiDecision`, `LegendaryAction`, `LairAction`

### Missing events:

| Event | Priority | Justification |
|-------|----------|---------------|
| `MonsterAdded` | Medium | `CharacterAdded` exists but there's no equivalent for monsters added to a session. SSE clients can't subscribe to monster roster changes. |
| `NPCAdded` | Medium | Same gap for NPCs. |
| `InventoryChanged` | Medium | No event fired when inventory is mutated (GET/POST/DELETE/PATCH in `session-inventory.ts`). SSE clients (player-cli) have no way to react to inventory changes in real-time. |
| `ConditionApplied` / `ConditionRemoved` | Low | Conditions are silently written to DB; no individual event per condition change. Makes the event log incomplete for narration/replay. |
| `ItemUsed` | Low | No event for consuming a potion or using an item in combat. The `ActionResolved` event generically covers it but doesn't specialize for item consumption. |
| `SpellCast` | Low | Spell casts surface as `ActionResolved { action: "CastSpell" }`. A dedicated `SpellCast` event would improve narration context and replay fidelity. |
| `LevelUp` | Low | No event when a character levels up. |

---

## Category 8: NPC vs Monster Handling Asymmetries

| Dimension | Monster | NPC | Notes |
|-----------|---------|-----|-------|
| Default faction | `"enemy"` | `"party"` | Consistent and intentional |
| `delete()` support | ❌ Missing from `IMonsterRepository` | ✅ `INPCRepository.delete()` | Gap — monsters can't be removed |
| CR / Proficiency scaling | CR-based formula in `Monster.getProficiencyBonus()` | Fixed via `data.proficiencyBonus ?? 2` in `NPC` | NPCs used as enemies don't get CR-based scaling |
| `monsterDefinitionId` | Has it — links to `MonsterDefinition` for stat block lookup | None | NPCs always hand-rolled; no definition catalog |
| Damage resistances on entity | Neither has fields on domain entity | Neither has fields | Both use `extractDamageDefenses()` side-channel |
| Species traits | Not applicable | Not applicable | Only Characters get species enrichment |
| `statBlock` vs `sheet` naming | `statBlock` JSON column | `statBlock` JSON column | Consistent, but differs from Character's `sheet` |

The key asymmetry is **`delete()` missing on Monsters but present on NPCs**. A monster added to a session by mistake cannot be removed without rebuilding the session.

---

## Category 9: Character Generation Gaps

`CharacterService.addCharacter()` (`application/services/entities/character-service.ts:32-74`):
- ✅ Validates name (non-empty) and level (integer 1-20)
- ✅ Enriches sheet with weapon catalog + armor catalog properties
- ❌ **No validation of `className`**: any string accepted, including invalid class IDs. A character with `className: "Spaceship"` will be created without error. The `classId` normalization silently fails and the character gets no resource pools.
- ❌ **No validation that sheet has required fields** (`abilityScores`, `maxHp`): an empty `{}` sheet will be stored and will fail at hydration time with silent defaults (all 10 ability scores, 10 HP).
- ❌ **`hitDiceRemaining` not initialized**: `takeSessionRest()` reads `sheet.hitDiceRemaining as number` with fallback to `totalHitDice`, but a freshly created character never has this field set explicitly. Correct by fallback, but fragile.

---

## Category 10: Unit of Work Consistency

- ✅ `PrismaUnitOfWork` includes 7 repos: sessions, characters, monsters, npcs, combat, events, spells
- ❌ `PendingActionRepository` is NOT in UoW — reaction resolution writes (pendingAction + combatantState + event) are non-transactional
- ❌ `createInMemoryRepos()` returns `InMemoryRepos` which does NOT include `pendingActionsRepo` — tests that need reactions must separately instantiate `InMemoryPendingActionRepository`. This inconsistency creates test setup boilerplate and risks tests that forget to create it.
- ❌ Character sheet updates in `CharacterService.takeSessionRest()` do multiple `characters.updateSheet()` calls in a `for` loop — no UoW transaction. If the server dies partway through a rest, some characters get updated and some don't.

---

## Category 11: Dead Code / Unused Entity Types

| Entity / Type | File | Status | Notes |
|---------------|------|--------|-------|
| `ClassFeatureDefinition` | Prisma schema only | Orphaned table | No read/write path exists |
| `ItemDefinition` | Prisma schema only | Orphaned table | Comment in catalog implies intent; never used |
| `ConditionDefinition` | Prisma schema only | Orphaned table | All condition logic lives in `conditions.ts` |
| `InventoryItem` (legacy) | `domain/entities/items/inventory.ts:18-40` | Legacy type kept for ammo/thrown tracking | Comment says "legacy for backward compat" — may be able to unify with `CharacterItemInstance` |
| `proficiencyBonus` computed in `hydrateCharacter` | `creature-hydration.ts:96` | Computed but not used | `const proficiencyBonus = readNumber(sheet, 'proficiencyBonus') ?? ...` — this variable is set but not passed into `CharacterData` (Character derives proficiency from level). Dead code inside hydration. |

---

## Category 12: Missing Entity Validators at System Boundaries

| Location | Missing Validation | Priority |
|----------|--------------------|----------|
| `CharacterService.addCharacter()` | `className` not validated against class registry | Medium |
| `CharacterService.addCharacter()` | Sheet structure not validated (required fields) | Low |
| `session-creatures.ts` POST /monsters | Monster stat block not validated for required fields | Low |
| `session-creatures.ts` POST /npcs | NPC stat block not validated | Low |
| `PendingActionRepository` | No expiry cleanup scheduled — `cleanupExpired()` defined but never called by a background task | Medium |

---

## Summary Table

| Category | Count | Highest Priority Finding |
|----------|-------|--------------------------|
| TODO/FIXME | 2 | Stale TODO in spell-lookup-service |
| Repo parity gaps | 3 | No Prisma impl for PendingActionRepository (CRITICAL) |
| Dead Prisma tables | 3 | ItemDefinition orphaned despite catalog comment |
| Hydration gaps | 4 | `equipment` not hydrated → Unarmored Defense fires while armored (BUG) |
| Sheet fields unused in combat | ~5 | `subclass` and `equipment` never hydrated |
| Inventory completeness | 5 | Magic armor equip doesn't update AC |
| Event system gaps | 7 | MonsterAdded, NPCAdded, InventoryChanged missing |
| NPC vs Monster asymmetries | 6 | Monsters can't be deleted |
| Character generation gaps | 3 | No className validation |
| Unit of Work | 3 | Rest operation not transactional |
| Dead code | 5 | Legacy InventoryItem type, unused proficiencyBonus in hydration |
| Missing validators | 4 | cleanupExpired() never scheduled |
| **TOTAL** | **50** | |

---

## Top 5 Actionable Priorities

1. **[CRITICAL][Correctness Bug]** Hydrate `equipment` (from sheet `equippedArmor`/`equippedShield`) into `CharacterData` in `hydrateCharacter()` — prevents Unarmored Defense miscalculation for Barbarians/Monks wearing armor.

2. **[CRITICAL][Durability]** Implement `PrismaPendingActionRepository` and add it to `PrismaUnitOfWork`. The production server currently loses all in-flight reactions on restart.

3. **[HIGH][Correctness Bug]** Add `subclass`/`subclassLevel` reading to `hydrateCharacter()` — Open Hand Technique silently breaks for DB-persisted monks.

4. **[HIGH][Correctness Gap]** `tempHP` needs a column in `CombatantStateRecord` (or stored in `resources` JSON with a known key) and restored during `hydrateCharacter()`.

5. **[MEDIUM][Feature Completeness]** Add `delete()` to `IMonsterRepository`/`ICharacterRepository` and re-run `enrichSheetArmor()` when equipping armor via inventory PATCH.
