# SME Research — EntityManagement Audit vs D&D 5e 2024 Rules

## 1. Character Creation

### Implemented
- `CharacterService.addCharacter()` accepts name, level, className, sheet JSON ([character-service.ts](packages/game-server/src/application/services/entities/character-service.ts#L32-L66))
- LLM-based `CharacterGenerator` produces sheets with ability scores, background, species, skills, proficiencies, equipment, personality ([character-generator.ts](packages/game-server/src/infrastructure/llm/character-generator.ts#L5-L35))
- LLM generator references standard array (15,14,13,12,10,8) and point buy in its system prompt
- All 12 PHB classes registered as `CharacterClassId` ([class-definition.ts](packages/game-server/src/domain/entities/classes/class-definition.ts#L5-L17))

### Missing
- **No deterministic ability score generation** — no point buy validator, no standard array enforcer, no dice rolling method. LLM generates scores ad-hoc. | **Important**
- **No deterministic character creation pipeline** — no server-side function validates class/level/race/background combinations. Sheet is opaque JSON blob. | **Critical**
- **No starting equipment rules** — no server-side logic to assign correct starting gear per class/background. LLM fills this in. | **Important**

## 2. Character Sheet

### Implemented
- `CharacterData` tracks: level, characterClass, classId, subclass, subclassLevel, XP, resourcePools, featIds ([character.ts](packages/game-server/src/domain/entities/creatures/character.ts#L28-L67))
- `CreatureData` tracks: id, name, maxHP, currentHP, armorClass, speed, abilityScores (6 scores), equipment, armorTraining ([creature.ts](packages/game-server/src/domain/entities/creatures/creature.ts#L8-L30))
- Proficiency bonus computed from level (correct D&D 5e formula) ([character.ts](packages/game-server/src/domain/entities/creatures/character.ts#L170-L176))
- Conditions tracked as `Set<string>` on Creature
- `CharacterSheet` typed interface in [hydration-types.ts](packages/game-server/src/application/services/combat/helpers/hydration-types.ts) with skills, size, damageResistances/Immunities/Vulnerabilities
- Skills defined as 18 standard skills with ability mappings ([skills.ts](packages/game-server/src/domain/entities/core/skills.ts))
- Feats tracked via `featIds[]` with 10 feat modifiers implemented ([feat-modifiers.ts](packages/game-server/src/domain/rules/feat-modifiers.ts))
- Hit Dice tracking (`hitDiceRemaining` on sheet), spend on short rest, recover on long rest

### Missing
- **No languages tracked** on character or creature entities | **Nice-to-have**
- **No senses (darkvision, blindsight, etc.)** tracked on creature entities | **Important**
- **No saving throw proficiencies on creature entity** — class definitions declare them but they don't get stored on Character. Combat reads `saveProficiencies` from sheet JSON ad-hoc | **Important**
- **No skill proficiencies tracked structurally** — sheet has `skills` as `Record<string, number>` (modifier values) but no distinction between proficient/expertise/none | **Important**
- **No temp HP** tracked on creature | **Important**

## 3. Monster Stat Blocks

### Implemented
- `Monster` entity extends `Creature` with CR and XP value ([monster.ts](packages/game-server/src/domain/entities/creatures/monster.ts))
- Proficiency bonus computed from CR (correct D&D 5e formula)
- Monster parser in [monsters-parser.ts](packages/game-server/src/content/rulebook/monsters-parser.ts) parses abilities, actions, legendary actions
- `import:monsters` script loads stat blocks from markdown
- Stat blocks stored as JSON blob in `SessionMonsterRecord.statBlock`
- Hydration extracts abilityScores, maxHP, AC, speed, CR, XP from JSON ([creature-hydration.ts](packages/game-server/src/application/services/combat/helpers/creature-hydration.ts#L107-L146))

### Missing
- **No hit dice on Monster entity** — only maxHP, no tracking of hit dice formula (e.g., "6d8+12") | **Nice-to-have**
- **No legendary resistances** tracked or implemented | **Important**
- **No lair actions** — parser handles legendary actions but no lair action concept | **Nice-to-have**
- **No multiattack** as a structured concept — handled via AI behavior/text parsing, not domain | **Nice-to-have**
- **Monster actions not structured** — stored in JSON blob, not typed domain entities. Combat resolves them from sheet attacks array | **Important**
- **No creature type/size/alignment** on Monster domain entity — `CreatureKind`, `CreatureSize`, `Alignment` types exist ([types.ts](packages/game-server/src/domain/entities/core/types.ts)) but not wired into Monster | **Nice-to-have**

## 4. NPC System

### Implemented
- `NPC` entity extends `Creature` with optional `role` and configurable `proficiencyBonus` ([npc.ts](packages/game-server/src/domain/entities/creatures/npc.ts))
- `SessionNPCRecord` in DB with statBlock JSON, faction, aiControlled
- `INPCRepository` interface with CRUD operations
- Hydration via `hydrateNPC()` in creature-hydration.ts

### Missing
- **NPCs are effectively thin monsters** — no NPC-specific features (social attitudes, quest flags, dialogue). This is probably fine for a combat-focused engine | **Nice-to-have**

## 5. Inventory/Equipment

### Implemented
- Full inventory API routes: GET/POST/DELETE/PATCH ([session-inventory.ts](packages/game-server/src/infrastructure/api/routes/sessions/session-inventory.ts))
- `CharacterItemInstance` with equipped, attuned, quantity, slot, magicItemId ([magic-item.ts](packages/game-server/src/domain/entities/items/magic-item.ts))
- Equip/unequip and attune/unattune via PATCH endpoint
- Max 3 attunement slots enforced ([inventory.ts](packages/game-server/src/domain/entities/items/inventory.ts#L44))
- Magic item bonuses apply to attack/damage rolls for equipped weapons ([inventory.ts](packages/game-server/src/domain/entities/items/inventory.ts#L149-L199))
- Ground items for dropped/thrown weapons on battlefield ([ground-item.ts](packages/game-server/src/domain/entities/items/ground-item.ts))
- Magic item catalog: bonus weapons (+1/+2/+3), Flame Tongue, Frost Brand, Cloak of Protection, Amulet of Health, potions ([magic-item-catalog.ts](packages/game-server/src/domain/entities/items/magic-item-catalog.ts))

### Missing
- **Equipping armor doesn't dynamically recompute AC on the character sheet** — armor → AC derivation happens at enrichment time via `enrichSheetArmor()`, not on equip toggle | **Important**
- **No weight/encumbrance tracking** — `weightLb` exists on catalog entries but no carrying capacity or encumbrance rules | **Nice-to-have**
- **Don/doff time not enforced** — armor catalog has don/doff times but no mechanic to require time to change armor | **Nice-to-have**

## 6. Armor Class Calculation

### Implemented
- Base formula: `Creature.getAC()` computes 10 + DEX or uses equipment-derived formula ([creature.ts](packages/game-server/src/domain/entities/creatures/creature.ts#L98-L117))
- Light armor: base + full DEX (Padded 11, Leather 11, Studded 12) ✓
- Medium armor: base + DEX (max +2) (Hide 12, Chain Shirt 13, Scale 14, Breastplate 14, Half Plate 15) ✓
- Heavy armor: flat base, no DEX (Ring 14, Chain 16, Splint 17, Plate 18) ✓
- Shield: +2 AC bonus, respects armor training ✓
- Armor training penalties: untrained armor → disadvantage on STR/DEX tests, can't cast spells ✓
- Barbarian Unarmored Defense: `10 + DEX + CON` ([barbarian.ts](packages/game-server/src/domain/entities/classes/barbarian.ts#L51))
- Defense feat: +1 AC while wearing armor ([feat-modifiers.ts](packages/game-server/src/domain/rules/feat-modifiers.ts#L47))
- Magic armor/shield bonuses via `ItemStatModifier` system

### Missing
- **Monk Unarmored Defense (10 + DEX + WIS) not automatically applied** — feature key exists but no AC computation override on Character for monks. Barbarian has `barbarianUnarmoredDefenseAC()` but it's only used in the mock LLM character generator, not in the domain entity | **Critical**
- **Natural armor** — no structured concept for monsters with natural armor (e.g., "13 + DEX"). Monster AC is stored as flat number from stat block | **Nice-to-have**
- **STR requirement penalty for heavy armor** — `strengthRequirement` in catalog but no speed penalty enforcement | **Nice-to-have**

## 7. Proficiency

### Implemented
- Class proficiency declarations: savingThrows, skills (choose N from list), armor, weapons, tools on every class definition ([class-definition.ts](packages/game-server/src/domain/entities/classes/class-definition.ts#L43-L53))
- Saving throw proficiencies read from sheet JSON in combat (`saveProficiencies` field)
- Weapon proficiency categories declared per class (e.g., Monk: simple + shortsword)
- Armor proficiency categories declared per class

### Missing
- **Proficiencies are not enforced at character creation** — class definitions declare them but `addCharacter()` doesn't validate or auto-apply | **Important**
- **Weapon proficiency not checked in attack resolution** — system doesn't verify the character is proficient with the weapon before adding proficiency bonus to attack roll | **Critical**
- **Tool proficiency not used anywhere** — declared on classes but no tool check mechanic | **Nice-to-have**

## 8. Multi-classing

### Implemented
- `hasFeature(classLevels, feature)` accepts array of `{classId, level}` — multi-class ready ([registry.ts](packages/game-server/src/domain/entities/classes/registry.ts#L52-L54))
- Comment in creature-abilities.ts mentions multiclass support as future

### Missing
- **No multi-class support implemented** — Character entity has single `classId`/`level`, no multi-class level tracking | **Nice-to-have** (intentionally deferred)

## 9. Leveling Up

### Implemented
- `Character.levelUp()` / `levelUpWith()` with HP recomputation (average or rolled) ([character.ts](packages/game-server/src/domain/entities/creatures/character.ts#L225-L256))
- HP calculation: max die at level 1, average or roll for subsequent levels, CON modifier per level ([hit-points.ts](packages/game-server/src/domain/rules/hit-points.ts))
- Resource pool reconciliation on level up (new resources start full, existing pools keep current values capped to new max)
- Level cap at 20 enforced

### Missing
- **No API endpoint for leveling up** — `levelUp()` exists on domain entity but no route/service method | **Important**
- **No new feature grants on level up** — features are checked by level at runtime, so this is implicitly handled | N/A
- **No ASI/feat selection at level 4/8/12/16/19** — feats are stored as `featIds[]` but no level-up prompt to choose | **Important**
- **No spell slot progression** — `SpellSlotsState` exists with levels 1-9 but no auto-computation of slots per class/level | **Important**

## 10. Species/Race

### Implemented
- `GeneratedCharacterSheet` has `species: string` field ([character-generator.ts](packages/game-server/src/infrastructure/llm/character-generator.ts#L15))
- LLM generator references 8 species: Human, Elf, Dwarf, Halfling, Dragonborn, Gnome, Orc, Tiefling

### Missing
- **No species traits in domain** — no darkvision, resistance, speed modifiers, or racial abilities. Species is a string label only | **Critical**
- **No species definitions** — no structured data for what each species provides (darkvision range, damage resistance, etc.) | **Critical**

## 11. Background

### Implemented
- `GeneratedCharacterSheet` has `background: string` field
- LLM references Acolyte, Criminal, Sage, Soldier

### Missing
- **No background definitions in domain** — no structured data for skill proficiencies from background | **Important**
- **No origin feat from background** — 2024 rules give an origin feat at level 1 based on background. Not implemented | **Critical**
- **No tool/language proficiencies from background** | **Important**

## 12. Equipment Catalog

### Implemented
- **38 weapons** — all PHB simple + martial weapons including firearms (Musket, Pistol) ([weapon-catalog.ts](packages/game-server/src/domain/entities/items/weapon-catalog.ts)). Covers all 2024 PHB weapons ✓
- **12 armor types** — all PHB light/medium/heavy armor ([armor-catalog.ts](packages/game-server/src/domain/entities/items/armor-catalog.ts)) ✓
- Shields as +2 AC bonus ✓
- Weapon mastery properties on all weapons (2024 rule) ✓
- Weapon properties: ammunition, finesse, heavy, light, loading, reach, thrown, two-handed, versatile ✓

### Missing
- **No adventuring gear catalog** — rope, torches, thieves' tools, etc. not cataloged | **Nice-to-have**
- **No cost/price tracking** — catalog has no GP values | **Nice-to-have**

## 13. Spells Known/Prepared

### Implemented
- `PreparedSpellDefinition` interface for `sheet.preparedSpells[]` ([prepared-spell-definition.ts](packages/game-server/src/domain/entities/spells/prepared-spell-definition.ts))
- `SpellSlotsState` with levels 1-9, create/spend/restore functions ([spell-slots.ts](packages/game-server/src/domain/rules/spell-slots.ts))
- `SpellLookupService` for definition retrieval from DB ([spell-lookup-service.ts](packages/game-server/src/application/services/entities/spell-lookup-service.ts))
- `ISpellRepository` with getById, getByName, listByLevel
- Concentration tracking exists in `domain/rules/concentration.ts`
- Spell slots refresh on long rest via rest system

### Missing
- **No spell progression tables** — no auto-computation of known/prepared spells per class/level | **Critical**
- **No spell list per class** — no data for which spells each class can learn | **Important**
- **No rest-based spell preparation** — no mechanic to change prepared spells on long rest | **Important**
- **No cantrips** tracked separately from leveled spells | **Important**
- **Warlock Pact Magic** — short rest slot recovery exists in resource pool system but no validation that warlock slots follow different progression | **Important**

## 14. Creature Hydration

### Implemented
- `hydrateCharacter()` → Character from SessionCharacterRecord + optional CombatantStateRecord ([creature-hydration.ts](packages/game-server/src/application/services/combat/helpers/creature-hydration.ts#L81-L125))
- `hydrateMonster()` → Monster from SessionMonsterRecord + optional CombatantStateRecord
- `hydrateNPC()` → NPC from SessionNPCRecord + optional CombatantStateRecord
- Robust JSON extraction with fallback defaults (10 for ability scores, 30 for speed, etc.)
- Combat state overlay (HP, conditions from CombatantStateRecord)
- Resource pools extracted from sheet
- `hydrateCombat()` builds Combat domain from encounter + combatant records ([combat-hydration.ts](packages/game-server/src/application/services/combat/helpers/combat-hydration.ts))
- Action economy restored from persisted resources
- Sheet enrichment at add-time: `enrichSheetAttacks()` + `enrichSheetArmor()` ([character-service.ts](packages/game-server/src/application/services/entities/character-service.ts#L52-L54))

### Missing
- **Equipment not hydrated onto Creature** — `hydrateCharacter()` doesn't extract `equipment` from sheet into `CharacterData.equipment`. AC is read as flat number, not derived from equipped armor | **Important**
- **Armor training not hydrated from class** — defaults to all-trained. Should derive from class proficiencies | **Important**
- **Feat IDs hydrated** but **feat effects not applied during hydration** beyond AC and initiative | **Nice-to-have**

---

## Summary by Severity

### Critical (blocks correct gameplay)
1. No deterministic character creation pipeline (sheet is opaque JSON)
2. Monk Unarmored Defense not applied in domain AC computation
3. Weapon proficiency not checked in attack resolution
4. No species/race traits (darkvision, resistances, etc.)
5. No origin feat from background (2024 rule)
6. No spell progression tables (known/prepared per class/level)

### Important (degraded accuracy)
1. No deterministic ability score generation
2. No starting equipment rules
3. No senses (darkvision, etc.) on creatures
4. No saving throw proficiencies on Character entity (ad-hoc from sheet)
5. No structured skill proficiency tracking
6. No temp HP
7. Proficiencies not enforced at character creation
8. Equipping armor doesn't recompute AC
9. No level-up API endpoint
10. No ASI/feat selection at appropriate levels
11. No spell slot auto-progression
12. Background definitions missing (skill proficiencies, tools, languages)
13. No spell list per class / rest-based preparation
14. No cantrip tracking
15. Equipment/armor training not hydrated onto creature
16. Monster actions not structured as domain types
17. Legendary resistances not tracked

### Nice-to-have (completeness)
1. Languages, adventuring gear, costs, encumbrance, don/doff time, natural armor
2. Multi-classing, NPC social features, creature type/size on Monster
3. Hit dice formula on monsters, lair actions, tool proficiency checks
