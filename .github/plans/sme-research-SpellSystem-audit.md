# SME Research — SpellSystem Audit vs D&D 5e 2024 Rules

## 1. Spell Delivery Modes

### Implemented (5 handlers + 1 inline fallback)
| Handler | File | Gate Field | Spells Covered |
|---------|------|-----------|----------------|
| `SpellAttackDeliveryHandler` | [spell-attack-delivery-handler.ts](packages/game-server/src/application/services/combat/tabletop/spell-delivery/spell-attack-delivery-handler.ts) | `attackType` | Fire Bolt, Guiding Bolt, Inflict Wounds, Scorching Ray |
| `HealingSpellDeliveryHandler` | [healing-spell-delivery-handler.ts](packages/game-server/src/application/services/combat/tabletop/spell-delivery/healing-spell-delivery-handler.ts) | `healing` | Cure Wounds, Healing Word |
| `SaveSpellDeliveryHandler` | [save-spell-delivery-handler.ts](packages/game-server/src/application/services/combat/tabletop/spell-delivery/save-spell-delivery-handler.ts) | `saveAbility` | Burning Hands, Hold Person, Thunderwave |
| `ZoneSpellDeliveryHandler` | [zone-spell-delivery-handler.ts](packages/game-server/src/application/services/combat/tabletop/spell-delivery/zone-spell-delivery-handler.ts) | `zone` | Spirit Guardians, Spike Growth, Cloud of Daggers, Web, Moonbeam |
| `BuffDebuffSpellDeliveryHandler` | [buff-debuff-spell-delivery-handler.ts](packages/game-server/src/application/services/combat/tabletop/spell-delivery/buff-debuff-spell-delivery-handler.ts) | `effects[]` | Bless, Shield of Faith, Faerie Fire, Bane |
| Inline simple (facade) | [spell-action-handler.ts](packages/game-server/src/application/services/combat/tabletop/spell-action-handler.ts) | fallback | Magic Missile, unknown spells |

### Missing Delivery Types
- **Summoning spells** (Conjure Animals, Spiritual Weapon) — no handler for creating summoned creatures/objects — **Important**
- **Teleportation spells** (Misty Step, Dimension Door) — no handler for position-changing spells — **Important**
- **Utility/non-combat spells** (Detect Magic, Identify, Mage Hand) — not needed for combat engine — **Nice-to-have**
- **Multi-target attack-roll spells** (Scorching Ray, Eldritch Blast multi-beam) — attack handler only supports single target — **Important**

## 2. Spell Definitions

Spells are NOT defined centrally. They exist as `preparedSpells[]` entries on character sheets, declared per-scenario in E2E JSON files. There is a `SpellDefinition` Prisma table with `name, level, school, ritual, data` fields, but the spell pipeline reads from `sheet.preparedSpells[]` directly.

### Spells seen in E2E scenarios (canonical set):
| Spell | Level | Type | Delivery Handler |
|-------|-------|------|-----------------|
| Fire Bolt | 0 | Cantrip | Attack |
| Magic Missile | 1 | Simple | Inline fallback |
| Shield | 1 | Reaction | Two-phase (attack reaction) |
| Burning Hands | 1 | Save | Save |
| Cure Wounds | 1 | Healing | Healing |
| Healing Word | 1 | Healing (BA) | Healing |
| Bless | 1 | Buff (conc) | BuffDebuff |
| Bane | 1 | Debuff (conc) | BuffDebuff |
| Shield of Faith | 2 | Buff (conc) | BuffDebuff |
| Faerie Fire | 1 | Debuff (conc) | BuffDebuff |
| Hold Person | 2 | Save (conc) | Save |
| Scorching Ray | 2 | Attack | Attack (single target only) |
| Cloud of Daggers | 2 | Zone (conc) | Zone |
| Thunderwave | 1 | Save | Save |
| Moonbeam | 2 | Zone (conc) | Zone |
| Spirit Guardians | 3 | Zone (conc) | Zone |
| Spike Growth | 2 | Zone (conc) | Zone |
| Web | 2 | Zone (conc) | Zone |
| Counterspell | 3 | Reaction | Two-phase (spell reaction) |
| Absorb Elements | 1 | Reaction | Two-phase (damage reaction) |
| Hellish Rebuke | 1 | Reaction | Two-phase (damage reaction) |
| Booming Blade | 0 | Cantrip | Special (melee cantrip) |

### Missing — No formal spell catalog
- **Severity: Important** — Spells are defined ad-hoc per scenario with no central registry to validate correctness. The `SpellDefinition` DB table exists but is not used by the pipeline.
- No `school`, `components`, `castingTime`, `range`, `duration` fields on `PreparedSpellDefinition` — **Important**

## 3. Spell Slot Management

### Implemented ✅
- Spell slots initialized from `sheet.spellSlots` via `buildCombatResources()` in [combat-resource-builder.ts](packages/game-server/src/domain/entities/classes/combat-resource-builder.ts) as `spellSlot_N` resource pools
- Slot validation + spending in `prepareSpellCast()` in [spell-slot-manager.ts](packages/game-server/src/application/services/combat/helpers/spell-slot-manager.ts) — throws `ValidationError` for no slots
- Cantrips (level 0) skip slot spending ✅
- Warlock `pactMagic` pool exists as a separate resource. Domain functions in `warlock.ts`: `pactMagicSlotsForLevel`, `spendPactMagicSlot`, `resetPactMagicOnShortRest`

### Missing
- **Warlock Pact Magic integration with spell-slot-manager** — `prepareSpellCast()` only checks `spellSlot_N`, never `pactMagic`. Warlock slots would fail validation unless also mapped to `spellSlot_N` on the sheet — **Critical**
- **Arcane Recovery (Wizard)** — no short-rest slot recovery mechanic — **Nice-to-have**
- **Long rest slot recovery** — a `long-rest-spellcaster.json` E2E exists, but rest is handled generically; full slot refresh needs verification — **Important**
- **Spell slot level auto-selection** — currently uses `spellMatch.level` directly; no support for choosing which slot level to use (always lowest matching) — **Important**

## 4. Concentration

### Implemented ✅
- DC formula: `max(10, floor(damage/2))` in [concentration.ts](packages/game-server/src/domain/rules/concentration.ts) ✅
- CON save check on damage in `concentrationCheckOnDamage()` — used in both [roll-state-machine.ts](packages/game-server/src/application/services/combat/tabletop/roll-state-machine.ts) and [attack-action-handler.ts](packages/game-server/src/application/services/combat/action-handlers/attack-action-handler.ts) ✅
- One-concentration-at-a-time: `prepareSpellCast()` detects existing concentration and calls `breakConcentration()` before starting new one ✅
- `breakConcentration()` in [concentration-helper.ts](packages/game-server/src/application/services/combat/helpers/concentration-helper.ts): removes concentration field, strips concentration-duration effects from all combatants, removes concentration zones from map ✅
- Conditions that break concentration: `isConcentrationBreakingCondition()` checks Incapacitated, Paralyzed, Petrified, Stunned, Unconscious ✅
- E2E scenarios: `concentration.json`, `concentration-damage-break.json`, `concentration-replacement.json` ✅

### Missing
- **Unconscious auto-fail** — the comment says "auto-fail on unconscious" but `concentrationCheckOnDamage()` doesn't check for unconscious state; it just does a CON save. The calling code may handle this, but the domain function doesn't enforce it — **Important** (verify callers)
- **Multiple damage sources in single turn** — each hit triggers a separate concentration check, which is correct per 5e 2024. Appears handled ✅

## 5. Spell Targeting

### Implemented ✅
- Single target: attack and save spells resolve against one named target ✅
- Self-targeting: buff/debuff handler supports `appliesTo: 'self'` ✅
- Allies/enemies: buff/debuff handler supports `appliesTo: 'allies' | 'enemies'`, resolves by faction ✅
- AoE zones: `SpellZoneDeclaration` with `radiusFeet`, `shape` (circle, cone, line, cube), `direction`, `width` ✅
- Zone positioned at caster (aura), target, or default to caster ✅

### Missing
- **Multi-target single-target spells** — Save handler processes only ONE target (finds first `targetRef`). Spells like Hold Person (which can target multiple at higher levels) only hit one — **Important**
- **AoE save spells (non-zone)** — Burning Hands is handled as single-target save, but per 5e it's a 15ft cone hitting all creatures in the area. No area targeting logic — **Critical**
- **Line/cone/cube targeting for save-based instant damage** — zone handler creates persistent zones, but one-shot AoEs (Fireball, Shatter, Lightning Bolt) have no area-of-effect targeting — **Critical**
- **Range validation** — no check that target is within spell range — **Important**

## 6. Spell Components

### Implemented
- `cannotSpeak` condition flag exists in [conditions.ts](packages/game-server/src/domain/entities/combat/conditions.ts) with comment "Cannot speak or cast spells with verbal components" — but no enforcement logic found

### Missing
- **Verbal/somatic/material component checking** — not implemented at all. `PreparedSpellDefinition` has no component fields. No free-hand check for somatic/material components — **Nice-to-have** (low priority for combat engine)
- **Silence effect** — no check that prevents V-component spell casting in silenced areas — **Nice-to-have**

## 7. Counterspell

### Implemented ✅
- Full two-phase flow in [spell-reaction-handler.ts](packages/game-server/src/application/services/combat/two-phase/spell-reaction-handler.ts)
- Phase 1: `initiate()` detects counterspell opportunities for Characters within range with reaction + spell slot available
- Phase 2: `complete()` resolves CON save by original caster vs counterspeller's spell save DC
- Spell slot consumption (level 3) for counterspeller ✅
- Reaction marking ✅
- Detection via `detectSpellReactions()` from `ClassCombatTextProfile` system ✅
- `hasCounterspellPrepared` flag tracked in combat resources ✅
- E2E scenario: `counterspell.json` ✅

### Issues
- **Counterspell DC mechanic is WRONG** — Per 5e 2024, Counterspell (3rd level) automatically counters 3rd level or lower spells. For 4th+ level spells, the caster makes an ABILITY CHECK (spellcasting ability check), NOT a CON save by the original caster. Current implementation has the original caster make a CON save — **Critical**
- **Counterspell at higher levels** — no support for casting Counterspell at a higher slot level to auto-counter higher-level spells — **Important**

## 8. Ritual Casting

### Implemented
- `SpellDefinitionRecord` has a `ritual: boolean` field in Prisma schema
- `PreparedSpellDefinition` does NOT have a ritual field

### Missing
- **No ritual casting support** — no way to cast a spell as a ritual (10 minutes, no slot consumed). Not relevant for combat encounters, but the field structure is incomplete — **Nice-to-have**

## 9. Upcasting

### Missing Entirely
- `PreparedSpellDefinition` has no `castAtLevel` field
- `prepareSpellCast()` always spends `spellSlot_${spellMatch.level}` — the spell's base level
- No mechanism to choose a higher slot level
- No damage/healing scaling for higher-level casting (e.g., Cure Wounds +1d8 per level above 1st)
- **Severity: Critical** — this is a core 5e mechanic

## 10. Cantrip Scaling

### Missing Entirely
- Fire Bolt is defined as `{ diceCount: 1, diceSides: 10 }` regardless of character level
- Per 5e 2024, cantrip damage scales at levels 5 (2d10), 11 (3d10), 17 (4d10)
- No character-level-based dice scaling logic anywhere
- **Severity: Critical** — cantrips are the primary at-will damage source

## 11. Specific Spell Mechanics

| Spell | Correct? | Issue |
|-------|----------|-------|
| Fire Bolt | Partial | No cantrip scaling, otherwise correct attack roll flow ✅ |
| Magic Missile | Partial | Goes through inline fallback — no actual damage application. Just calls `castSpell` cosmetically — **Critical** |
| Burning Hands | Wrong | Treated as single-target save, but it's a 15ft cone AoE — **Critical** |
| Shield | ✅ | Reaction flow works via attack-reaction-handler, +5 AC, slot spent |
| Counterspell | Wrong | DC mechanic incorrect (see §7) |
| Cure Wounds | ✅ | Healing dice + modifier, revival at 0 HP, slot consumption all correct |
| Healing Word | ✅ | Bonus action handling, healing dice correct |
| Bless | ✅ | +1d4 to attacks/saves via ActiveEffect, concentration tracked |
| Bane | ✅ | -1d4 debuff, concentration tracked |
| Hold Person | Partial | Save + Paralyzed condition ✅, but single-target only (should allow multi at higher level) |
| Cloud of Daggers | ✅ | Placed zone, start-of-turn damage, no save, concentration |
| Spirit Guardians | ✅ | Aura zone, moves with caster, save-based damage |
| Absorb Elements | ✅ | Damage reaction, halves damage, slot consumption |
| Hellish Rebuke | ✅ | Damage reaction |

## 12. Spell Preparation/Known

### Implemented
- Spells are placed on `sheet.preparedSpells[]` at character creation/setup time
- No in-combat spell preparation changes

### Missing
- **No spell preparation system** — spells are statically defined on the sheet. No mechanism to change prepared spells on long rest — **Nice-to-have** (out of combat)
- **No class spell list validation** — any spell can be put on any character's sheet — **Nice-to-have**
- **No "spells known" vs "spells prepared" distinction** — relevant for Wizard (spellbook), Sorcerer (known), Cleric (full list) — **Nice-to-have**

## 13. Bonus Action Spell Rules

### Implemented (Partial)
- `isBonusAction` field on `PreparedSpellDefinition` ✅
- `HealingSpellDeliveryHandler` checks `isBonusAction`, marks bonus action used on resources ✅

### Missing
- **Bonus action spell restriction NOT enforced** — Per 5e 2024, if you cast a bonus action spell, you can only cast a cantrip with your action (not a leveled spell). No enforcement anywhere — **Critical**
- **No tracking of "has cast a leveled action spell this turn"** to block bonus action leveled spells — **Critical**

## 14. Zone/AoE Duration

### Implemented ✅
- Zones persist on the combat map via `CombatZone` in `mapData.zones[]` ✅
- Start-of-turn processing: `processZoneTurnTriggers()` in [combat-service.ts](packages/game-server/src/application/services/combat/combat-service.ts) handles `on_start_turn` and `on_end_turn` triggers ✅
- Movement through zones: `resolveZoneDamageForPath()` in [zone-damage-resolver.ts](packages/game-server/src/application/services/combat/helpers/zone-damage-resolver.ts) handles `on_enter` and `per_5ft_moved` triggers ✅
- Concentration zones cleaned up via `breakConcentration()` ✅
- Zone shapes: circle, cone, line, cube supported ✅

### Missing
- **Aura zone movement tracking** — when caster with an aura (Spirit Guardians) moves, the zone moves. But creatures entering the zone MID-MOVEMENT of the caster don't take on_enter damage — **Important**
- **Zone duration in rounds** — `durationType: 'rounds'` is supported in zone creation, but no expiration logic found for non-concentration round-limited zones — **Important**

---

## Priority Summary

### Critical (blocks correct 5e play)
1. **Cantrip scaling** — cantrips deal wrong damage at levels 5+
2. **Upcasting** — no mechanism to cast spells at higher levels
3. **Magic Missile has no damage application** — fallback path is cosmetic only
4. **AoE targeting for instant spells** — Burning Hands, Fireball, etc. only hit single target
5. **Bonus action spell restriction** — no enforcement of cantrip-only-with-action rule
6. **Counterspell DC mechanic wrong** — uses CON save instead of ability check
7. **Warlock Pact Magic not integrated** — `prepareSpellCast()` doesn't check `pactMagic` pool

### Important (noticeable gaps)
8. Multi-target save spells (Hold Person at higher levels)
9. Spell range validation
10. Multi-beam attack spells (Scorching Ray, Eldritch Blast)
11. Summoning/teleportation spell handlers
12. Zone round-duration expiration
13. No central spell catalog — spells defined ad-hoc
14. Long rest spell slot recovery verification
15. Unconscious auto-fail on concentration saves

### Nice-to-have (low priority for combat)
16. Spell components (V/S/M) enforcement
17. Ritual casting
18. Spell preparation/known system
19. Class spell list validation
20. Arcane Recovery
