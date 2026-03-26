# Plan: Phase 9 — Subclass Framework
## Round: 1
## Status: DRAFT
## Affected Flows: ClassAbilities, EntityManagement

## Objective
Build a generic subclass framework and implement the most commonly used subclasses from D&D 5e 2024 Basic Rules. Currently only Monk (Open Hand) has any subclass-gated logic. This framework enables Champion Fighter, Berserker Barbarian, Life Cleric, Thief Rogue, and other popular subclass choices.

## Changes

### ClassAbilities — Subclass Framework

#### [File: domain/entities/classes/class-definition.ts]
- [ ] Add `SubclassDefinition` interface: `{ id: string, name: string, classId: string, features: Record<string, number>, combatTextProfile?: ClassCombatTextProfile, resourcePools?: ... }`
- [ ] Add `subclasses?: SubclassDefinition[]` to `CharacterClassDefinition`
- [ ] Subclass features map works the same as class features map — `classHasFeature` should check both class AND active subclass features

#### [File: domain/entities/classes/registry.ts]
- [ ] Add `getSubclassDefinition(classId, subclassId)` getter
- [ ] Modify `classHasFeature()` to accept optional `subclassId` and check both class and subclass feature maps
- [ ] Register subclass combat text profiles alongside class profiles in `getAllCombatTextProfiles()`

#### [File: domain/entities/classes/fighter.ts]
- [ ] **Champion subclass** (level 3):
  - `improvedCritical: 3` — critical hit on 19 or 20 (instead of only 20)
  - `remarkableAthlete: 3` — add half proficiency (rounded up) to STR/DEX/CON checks that don't already use proficiency
  - `additionalFightingStyle: 7` — second Fighting Style choice
  - `superiorCritical: 15` — critical hit on 18-20

#### [File: domain/entities/classes/barbarian.ts]
- [ ] **Path of the Berserker** (level 3):
  - `frenzy: 3` — while raging, can make one extra melee weapon attack as bonus action (like Flurry but for barbarian)
  - `mindlessRage: 6` — can't be charmed or frightened while raging
  - `intimidatingPresence: 10` — frighten as action

#### [File: domain/entities/classes/rogue.ts]
- [ ] **Thief subclass** (level 3):
  - `fastHands: 3` — Use Object as bonus action (Cunning Action: Use Object)
  - `secondStoryWork: 3` — climb speed = walking speed, extra jump distance
  - `supremeSneak: 9` — advantage on Stealth if moved no more than half speed

#### [File: domain/entities/classes/cleric.ts]
- [ ] **Life Domain** (level 3):
  - `discipleOfLife: 3` — healing spells heal extra 2 + spell level HP
  - `preserveLife: 3` — Channel Divinity: restore up to 5×cleric level HP split among creatures within 30ft

#### [File: domain/entities/classes/paladin.ts]
- [ ] **Oath of Devotion** (level 3):
  - `sacredWeapon: 3` — Channel Divinity: +CHA mod to attack rolls for 10 minutes
  - `turnTheUnholy: 3` — Channel Divinity: turn undead AND fiends

### EntityManagement — Subclass on Character

#### [File: domain/entities/creatures/character.ts]
- [ ] Ensure `subclass` and `subclassLevel` fields on CharacterData are actively used
- [ ] On `levelUp()`, if reaching subclass level (usually 3), prompt for subclass selection

#### [File: application/services/combat/helpers/creature-hydration.ts]
- [ ] During hydration, load subclass features and apply them (subclass feature keys, combat text profiles)

### Combat Integration — Champion Improved Critical

#### [File: domain/combat/attack-resolver.ts]
- [ ] Check for `improvedCritical` or `superiorCritical` feature when determining if an attack is a critical hit
- [ ] Champion level 3: nat 19-20 = crit. Level 15: nat 18-20 = crit.
- [ ] Use `classHasFeature(classId, 'improved-critical', level, subclassId)` pattern

## Cross-Flow Risk Checklist
- [ ] Do changes in one flow break assumptions in another? — Champion crit range changes attack-resolver behavior
- [x] Does the pending action state machine still have valid transitions? — Not affected
- [x] Is action economy preserved? — Berserker Frenzy is a bonus action, fits existing economy
- [ ] Do both player AND AI paths handle the change? — AI needs to know about subclass abilities
- [ ] Are repo interfaces + memory-repos updated if entity shapes change? — subclass/subclassId already on CharacterData
- [ ] Is `app.ts` registration updated if adding executors? — May need executor for Berserker Frenzy, Disciple of Life
- [x] Are D&D 5e 2024 rules correct? — Verified against 2024 PHB subclass features

## Risks
- **Scope creep**: Subclasses have many features at many levels. Keep to levels 1-7 features only for initial pass.
- **Existing Open Hand guard**: Monk's Open Hand Technique uses `hasOpenHandTechnique()` with a subclass guard in ClassFeatureResolver. Ensure the new framework supersedes this pattern.
- **Champion crit range**: Changes damage math significantly for Fighters. Verify E2E scenarios.

## Test Plan
- [ ] Unit test: Champion Fighter crits on natural 19
- [ ] Unit test: Berserker Frenzy allows bonus action melee attack while raging
- [ ] Unit test: Thief can Use Object as bonus action
- [ ] Unit test: Life Domain healing adds 2 + spell level HP
- [ ] Unit test: Subclass feature keys are found by classHasFeature with subclassId
- [ ] Unit test: Registry finds subclass definition by classId + subclassId
- [ ] E2E scenario: champion-improved-critical.json
- [ ] E2E scenario: berserker-frenzy.json
