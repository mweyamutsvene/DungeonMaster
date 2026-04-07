# Plan: War Caster Spell-as-Opportunity-Attack Execution
## Round: 1
## Status: APPROVED
## Affected Flows: CombatOrchestration, SpellSystem, AIBehavior

## Objective
Implement the execution path for War Caster spell-type OAs. The detection/routing foundations are already in place (`oaType: "spell"` on ReactionOpportunity, `canCastSpellAsOA` on OA results). What's missing is: when a spell-type OA is accepted, the system needs to execute the spell instead of a weapon attack.

## Changes

### Domain — War Caster OA Spell Validation
#### [File: domain/rules/war-caster-oa.ts] (NEW)
- [x] `isEligibleWarCasterSpell(spell: PreparedSpellDefinition): boolean` — validates D&D 5e 2024 constraints:
  - Not a bonus action spell (`!spell.isBonusAction`)
  - Single-target only (no `spell.area`, no zone spells)
  - Casting time = 1 action (implicit — all non-bonus-action spells are action-cast)
- [x] `findBestWarCasterSpell(spells, targetCombatant, casterResources)` — for AI: pick highest-damage eligible spell with available slot

### CombatOrchestration — OA Resolver Spell Branching
#### [File: application/services/combat/helpers/opportunity-attack-resolver.ts]
- [x] In `resolveOpportunityAttacks()`, after finding a `choice: "use"` reaction:
  - Check if corresponding `ReactionOpportunity.oaType === "spell"`
  - If spell-type: branch to spell OA resolution instead of weapon attack
  - Spell OA resolution:
    1. Look up spell from reaction result's `spellName`
    2. Validate via `isEligibleWarCasterSpell()`
    3. Resolve spell from catalog (via `resolveSpell`)
    4. Spend spell slot via `prepareSpellCast()`
    5. Deliver spell effects via `AiSpellDelivery.deliver()` (reuse AI spell delivery - it handles all delivery modes)
    6. Track damage dealt, apply to moving creature

#### [File: application/services/combat/helpers/opportunity-attack-resolver.ts]
- [x] Add `AiSpellDelivery`-related deps to `ResolveOAInput` deps interface
- [x] Add character/monster/NPC repos + diceRoller to deps for spell lookups

### Reactions Route — Accept Spell Selection
#### [File: infrastructure/api/routes/reactions.ts]
- [x] Extend the `POST /respond` body to accept optional `spellName` and `castAtLevel`
- [x] When a spell-type OA reaction is responded to with `choice: "use"`, store `spellName`/`castAtLevel` in the reaction result

### Scenario Runner — Support Spell OA in E2E
#### [File: scripts/test-harness/scenario-runner.ts]
- [x] Extend `ReactionRespondAction` input to accept optional `spellName` and `castAtLevel`
- [x] Pass those values in the reaction respond POST body

### AI Path — Auto-Select Spell for OA
#### [File: application/services/combat/ai/ai-movement-resolver.ts]
- [x] When AI decides to use a spell-type OA, auto-select a spell using `findBestWarCasterSpell()`
- [x] Store selected `spellName` in the reaction response

### E2E Scenario
#### [File: scripts/test-harness/scenarios/feats/war-caster-spell-oa.json] (NEW)
- [x] Scenario: Wizard with War Caster casts Fire Bolt (cantrip) as OA when monster moves away
- [x] Setup: Wizard with War Caster feat, prepared spells including Fire Bolt
- [x] Verify: Spell damage applied, reaction consumed

## Cross-Flow Risk Checklist
- [x] Do changes in one flow break assumptions in another? — No, spell OA is additive to existing weapon OA path
- [x] Does the pending action state machine still have valid transitions? — Yes, no new states added
- [x] Is action economy preserved? — Yes, spell OA uses the caster's reaction (already tracked)
- [x] Do both player AND AI paths handle the change? — Yes, both get spell selection
- [x] Are repo interfaces + memory-repos updated if entity shapes change? — No entity shape changes
- [x] Is `app.ts` registration updated if adding executors? — No new executors
- [x] Are D&D 5e 2024 rules correct? — Yes: casting time 1 action, single-target only, targets provoking creature

## Risks
- Spell slot spending during OA resolution could fail if caster has no slots — handle gracefully (fall back to weapon OA or skip)
- Concentration management during OA spell — if the OA spell requires concentration, need to break existing concentration
- `AiSpellDelivery` deps need to be threaded into `resolveOpportunityAttacks` — manageable since this is an internal helper

## Test Plan
- [x] Unit test: `war-caster-oa.test.ts` — validate `isEligibleWarCasterSpell` with various spell types
- [x] E2E scenario: `feats/war-caster-spell-oa.json` — War Caster wizard casts Fire Bolt as OA
