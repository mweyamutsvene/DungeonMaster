# Plan: Phase 5 — Entity Foundation (Species Traits, Origin Feats, Proficiency Enforcement)
## Round: 1
## Status: DRAFT
## Affected Flows: EntityManagement, CombatRules

## Objective
Build the missing entity data foundations: species/race traits (darkvision, resistances), origin feats from backgrounds (D&D 2024 signature rule), Monk Unarmored Defense AC computation, weapon proficiency enforcement in attacks, and spell slot progression tables. These are critical for D&D 2024 character correctness.

## Changes

### EntityManagement — Species Traits

#### [File: domain/entities/creatures/species.ts — NEW]
- [ ] Define `SpeciesDefinition` interface with: name, size, speed, darkvision range, damage resistances, special traits
- [ ] Define the 8 Basic Rules species: Human, Elf, Dwarf, Halfling, Dragonborn, Gnome, Orc, Tiefling
- [ ] D&D 2024 species traits (simplified):
  - Human: Heroic Inspiration, Resourceful, Skillful (1 extra skill)
  - Elf: Darkvision 60ft, Fey Ancestry (advantage vs Charmed), Trance (4hr long rest)
  - Dwarf: Darkvision 60ft, Dwarven Resilience (poison resistance, advantage on poison saves), speed 30ft
  - Halfling: Brave (advantage vs Frightened), Halfling Nimbleness (move through larger creatures), Lucky (reroll nat 1 on d20)
  - Dragonborn: Breath Weapon (damage type by ancestry), Damage Resistance (by ancestry), Darkvision 60ft
  - Gnome: Darkvision 60ft, Gnome Cunning (advantage on INT/WIS/CHA saves vs magic)
  - Orc: Darkvision 120ft, Relentless Endurance (drop to 1 HP instead of 0, 1/long rest), Adrenaline Rush (bonus action Dash + temp HP)
  - Tiefling: Darkvision 60ft, Fiendish Legacy (fire resistance + innate spellcasting)

#### [File: domain/entities/creatures/species-registry.ts — NEW]
- [ ] Registry to look up species by name
- [ ] `getSpeciesTraits(speciesName)` returns the SpeciesDefinition

#### [File: application/services/combat/helpers/creature-hydration.ts]
- [ ] During character hydration, look up species from sheet and apply: darkvision, damage resistances, speed overrides, special traits
- [ ] Store species-derived data on the Character entity

### EntityManagement — Origin Feats

#### [File: domain/entities/creatures/background.ts — NEW]
- [ ] Define `BackgroundDefinition` with: name, skillProficiencies (2), toolProficiency, language, originFeat
- [ ] D&D 2024 basic backgrounds with origin feats:
  - Acolyte → Magic Initiate (Cleric)
  - Criminal → Alert
  - Sage → Magic Initiate (Wizard)
  - Soldier → Savage Attacker
  - (Add more as needed: Noble, Entertainer, etc.)

#### [File: application/services/entities/character-service.ts]
- [ ] On character creation/generation, validate and apply origin feat from background
- [ ] Auto-add the feat to `sheet.featIds[]`

### CombatRules — Monk Unarmored Defense

#### [File: domain/entities/creatures/creature.ts]
- [ ] In `getAC()` computation, check if the character is a Monk with no armor equipped
- [ ] Apply Monk Unarmored Defense: `10 + DEX modifier + WIS modifier`
- [ ] Existing `barbarianUnarmoredDefenseAC()` should be a model for this — but needs to be wired into the actual AC calculation, not just the mock generator

### CombatRules — Weapon Proficiency Enforcement

#### [File: domain/combat/attack-resolver.ts]
- [ ] Before adding proficiency bonus to attack roll, check if the creature is proficient with the weapon
- [ ] `isWeaponProficient(creature, weapon)`: check creature's class weapon proficiencies against the weapon's category (simple/martial) and specific weapon name
- [ ] If not proficient, do NOT add proficiency bonus to the attack roll
- [ ] Note: monsters are always proficient with their listed weapons

### EntityManagement — Spell Slot Progression

#### [File: domain/entities/spells/spell-progression.ts — NEW]
- [ ] Define spell slot tables per full-caster level (Cleric, Wizard, Bard, Druid, Sorcerer): standard PHB table
- [ ] Define half-caster table (Paladin, Ranger): half level rounded up for slot access
- [ ] Define third-caster table (Eldritch Knight, Arcane Trickster): third level rounded up
- [ ] Define Warlock Pact Magic table: slots per level, slot level per level
- [ ] `getSpellSlots(classId, level)` returns `Record<number, number>` (slot level → count)
- [ ] `getCantripsKnown(classId, level)` returns number of cantrips

#### [File: application/services/entities/character-service.ts]
- [ ] During character creation, compute and set `sheet.spellSlots` from class spell progression table
- [ ] During level up, recompute spell slots

## Cross-Flow Risk Checklist
- [ ] Do changes in one flow break assumptions in another? — AC computation change affects all combat resolution
- [x] Does the pending action state machine still have valid transitions? — Not affected
- [x] Is action economy preserved? — Not affected
- [ ] Do both player AND AI paths handle the change? — Weapon proficiency affects AI attack resolution equally
- [ ] Are repo interfaces + memory-repos updated if entity shapes change? — Species/background data stored on sheet JSON
- [x] Is `app.ts` registration updated if adding executors? — No new executors
- [x] Are D&D 5e 2024 rules correct? — Verified: species traits, origin feats, spell progression all from 2024 PHB

## Risks
- **Species traits** are extensive — keep initial implementation focused on combat-relevant traits (darkvision, resistances, advantage on saves). Skip non-combat racial features.
- **Monk AC** change could break existing E2E scenarios that set AC manually. Verify hydration path.
- **Weapon proficiency** enforcement could break existing scenarios where non-proficient weapons are used. Need to ensure all test characters have correct proficiencies.
- **Spell progression** tables are well-defined in PHB — straightforward data entry.

## Test Plan
- [ ] Unit test: Elf gets Darkvision 60ft and Fey Ancestry
- [ ] Unit test: Dwarf gets poison resistance
- [ ] Unit test: Acolyte background grants Magic Initiate feat
- [ ] Unit test: Monk with no armor has AC = 10 + DEX + WIS
- [ ] Unit test: Barbarian Unarmored Defense = 10 + DEX + CON (already passes, verify)
- [ ] Unit test: Non-proficient weapon does not add proficiency bonus
- [ ] Unit test: Proficient weapon adds proficiency bonus (existing behavior)
- [ ] Unit test: Wizard level 3 has 4/2 spell slots (level 1/2)
- [ ] Unit test: Warlock level 3 has 2 Pact Magic slots at level 2
- [ ] E2E scenario: species-traits.json (verify darkvision/resistance in combat)
