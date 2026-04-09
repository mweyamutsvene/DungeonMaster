# Plan: SS-M3 + SS-M4: Multi-Attack Spell Mechanics (Eldritch Blast & Scorching Ray)
## Round: 1
## Status: IN_PROGRESS
## Affected Flows: SpellSystem, CombatOrchestration

## Objective
Implement multi-beam (Eldritch Blast) and multi-ray (Scorching Ray) spell mechanics. Both spells create multiple independent attack rolls. Eldritch Blast scales by caster level (1/2/3/4 beams at levels 1/5/11/17). Scorching Ray has 3 base rays +1 per upcast level above 2. Uses the existing flurry-of-blows chaining pattern in RollStateMachine.

## Changes

### SpellSystem

#### [File: domain/entities/spells/prepared-spell-definition.ts]
- [x] Add `multiAttack?: { baseCount: number; scaling: 'cantrip' | 'perLevel' }` field to `PreparedSpellDefinition`
- [x] Add `getSpellAttackCount(spell, characterLevel, castAtLevel)` pure function
- [x] Eldritch Blast: `multiAttack: { baseCount: 1, scaling: 'cantrip' }` — uses cantrip scaling (1/2/3/4 at 1/5/11/17)
- [x] Scorching Ray: `multiAttack: { baseCount: 3, scaling: 'perLevel' }` — 3 base, +1 per level above spell's base level
- [x] Eldritch Blast cantrip damage scaling MUST NOT use `getCantripDamageDice()` — always 1d10 per beam

#### [File: domain/entities/spells/catalog/cantrips.ts]
- [x] Add `multiAttack: { baseCount: 1, scaling: 'cantrip' }` to ELDRITCH_BLAST
- [x] Verify EB damage stays 1d10 (scaling is beams, not dice)

#### [File: domain/entities/spells/catalog/level-2.ts]
- [x] Add `multiAttack: { baseCount: 3, scaling: 'perLevel' }` to SCORCHING_RAY

### CombatOrchestration

#### [File: application/services/combat/tabletop/tabletop-types.ts]
- [x] Add `spellStrike?: number` and `spellStrikeTotal?: number` to `AttackPendingAction`
- [x] Add same fields to `DamagePendingAction` (for chaining through damage)

#### [File: application/services/combat/tabletop/spell-delivery/spell-attack-delivery-handler.ts]
- [x] Detect `multiAttack` on spell definition
- [x] Compute total attack count via `getSpellAttackCount()`
- [x] For multi-attack spells, skip `getCantripDamageDice()` scaling (scaling IS the extra attacks)
- [x] Set `spellStrike: 1, spellStrikeTotal: N` on the first AttackPendingAction

#### [File: application/services/combat/tabletop/roll-state-machine.ts]
- [x] In `handleAttackRoll` miss path: if `spellStrike < spellStrikeTotal`, chain to next attack (like flurry)
- [x] In `handleDamageRoll` completion: if `spellStrike < spellStrikeTotal`, chain to next attack
- [x] Propagate `spellStrike`/`spellStrikeTotal` through DAMAGE pending action

## Cross-Flow Risk Checklist
- [x] Do changes in one flow break assumptions in another? — No, additive fields only
- [x] Does the pending action state machine still have valid transitions? — Yes, same ATTACK→DAMAGE→ATTACK chain as flurry
- [x] Is action economy preserved? — Yes, all beams/rays are part of the same Cast a Spell action
- [x] Do both player AND AI paths handle the change? — AI path doesn't use delivery handlers (no dice), so no AI changes needed
- [x] Are repo interfaces + memory-repos updated if entity shapes change? — No entity shape changes
- [x] Is `app.ts` registration updated if adding executors? — No new executors
- [x] Are D&D 5e 2024 rules correct? — Yes, verified beam/ray scaling

## Risks
- The flurry pattern chains 2 strikes. Multi-attack spells can chain 3-4. Same logic, just more iterations.
- Eldritch Blast at level 17 = 4 beams = 8 rolls (4 attack + 4 damage). Long but mechanically correct.
- Action spending should only happen after the LAST beam/ray is resolved.

## Test Plan
- [x] Unit test: `getSpellAttackCount()` for EB at levels 1/5/11/17 and SR at levels 2/3/4/5
- [x] E2E scenario: `wizard/scorching-ray-multi-attack.json` — 3 rays, 3 attack+damage cycles
- [x] E2E scenario: `warlock/eldritch-blast-multi-beam.json` — level 5, 2 beams, 2 attack+damage cycles
