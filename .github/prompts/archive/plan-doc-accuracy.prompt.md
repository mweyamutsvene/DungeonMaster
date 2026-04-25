# Plan: Documentation Accuracy Refresh
## Round: 1
## Status: COMPLETE
## Affected Flows: ActionEconomy, AIBehavior, AISpellEvaluation, ClassAbilities, CombatMap, CombatOrchestration, CombatRules, CreatureHydration, EntityManagement, InventorySystem, ReactionSystem, SpellCatalog, SpellSystem

## Objective
Refresh the flow instruction files and scoped CLAUDE quick-reference files so they match the current architecture, mechanics, and ownership boundaries in source. Keep instruction files in regular English for human maintainers and scoped CLAUDE files in caveman wording for low-token agent guidance.

## Changes
### Research
- [x] Dispatch all flow SMEs to verify matching instruction docs, nearby CLAUDE docs, and live source.
- [x] Synthesize the research into targeted doc edits only where drift is verified.

### Instruction Files
- [x] Update ActionEconomy instruction wording for the domain/resources split and real turn-reset path.
- [x] Update AIBehavior and AISpellEvaluation instruction wording for current fallback, provider, context, and spell-routing behavior.
- [x] Update ClassAbilities and CombatMap instruction wording for subclass/resource-builder and map ownership drift.
- [x] Update CombatOrchestration and CombatRules instruction wording for current service boundaries and state/model ownership.
- [x] Update CreatureHydration, EntityManagement, and InventorySystem instruction wording for real service contracts and hydration boundaries.
- [x] Update ReactionSystem, SpellCatalog, and SpellSystem instruction wording for current lifecycle, catalog, and delivery behavior.

### CLAUDE Files
- [x] Update scoped CLAUDE quick references only where the current wording is inaccurate.
- [x] Keep CLAUDE updates caveman-short and avoid adding flow details that belong only in instruction docs.

### Validation
- [x] Review changed markdown for accuracy and consistency against the research briefs.
- [x] Run workspace diagnostics on changed docs when available.

## Cross-Flow Risk Checklist
- [x] Do changes in one flow break assumptions in another?
- [x] Does the pending action state machine still have valid transitions?
- [x] Is action economy preserved (1 action, 1 bonus, 1 reaction, 1 movement)?
- [x] Do both player AND AI paths handle the change?
- [x] Are repo interfaces + memory-repos updated if entity shapes change?
- [x] Is `app.ts` registration updated if adding executors?
- [x] Are D&D 5e 2024 rules correct (not 2014)?

## Risks
- Research briefs may recommend optional clarifications that would add noise without correcting real drift. Keep edits limited to verified inaccuracies or high-value omissions.
- Several instruction files contain diagrams or detailed tables that can drift faster than prose. Prefer smaller, more durable wording where possible.

## Test Plan
- [x] Author no runtime tests; validate this task by doc-to-source verification and changed-file diagnostics.

## SME Approval (Complex only)
- [x] ActionEconomy-SME
- [x] AIBehavior-SME
- [x] AISpellEvaluation-SME
- [x] ClassAbilities-SME
- [x] CombatMap-SME
- [x] CombatOrchestration-SME
- [x] CombatRules-SME
- [x] CreatureHydration-SME
- [x] EntityManagement-SME
- [x] InventorySystem-SME
- [x] ReactionSystem-SME
- [x] SpellCatalog-SME
- [x] SpellSystem-SME

## Verification
- [x] Spot-check final spell-related docs after the last patch batch.
- [x] Run workspace diagnostics on the final edited doc batches via `get_errors`.
- [x] Review changed files to confirm the task stayed limited to doc/instruction updates.