# Plan: NPC Class Support
## Round: 2
## Status: IN_REVIEW
## Affected Flows: EntityManagement, CombatOrchestration, ClassAbilities, AIBehavior, SpellSystem, Testing

## Objective
Allow session NPCs and player-cli scenarios to define an NPC either as a traditional stat-block creature or as a class-backed creature with `className`, `level`, and a Character-like `sheet`. Preserve existing stat-block NPC behavior while making class-backed NPCs participate in class resource initialization, combat stat resolution, class ability execution, and AI execution paths without manually duplicating every attack and mechanic into a stat block.

Class-backed NPCs will remain `combatantType === "NPC"` for KO/death behavior in this change. They gain Character-like mechanics data, not Character identity.

## Changes
### EntityManagement
#### File: packages/game-server/prisma/schema.prisma
- [ ] Make NPC persistence representation-aware with nullable stat-block and class-backed fields that support an exact-one-representation invariant.

#### File: packages/game-server/src/application/types.ts
- [ ] Extend `SessionNPCRecord` to support either stat-block-backed or class-backed NPC persistence data, including the mechanics fields class abilities rely on.

#### File: packages/game-server/src/application/repositories/npc-repository.ts
- [ ] Replace the stat-block-only NPC contract with a discriminated union that supports both NPC representations and remove or generalize stat-block-only update APIs.

#### File: packages/game-server/src/infrastructure/db/npc-repository.ts
- [ ] Persist the expanded NPC record shape without breaking existing stat-block NPC behavior.

#### File: packages/game-server/src/infrastructure/testing/memory-repos.ts
- [ ] Mirror the updated NPC repository contract in the in-memory test repository.

#### File: packages/game-server/src/infrastructure/api/app.test.ts
- [ ] Update local test doubles that implement the NPC repository contract.

#### File: packages/game-server/src/application/services/combat/combat-service-domain.integration.test.ts
- [ ] Update local test doubles that implement the NPC repository contract.

#### File: packages/game-server/src/infrastructure/api/routes/sessions/session-creatures.ts
- [ ] Accept either stat-block NPC payloads or class-backed NPC payloads and enforce an exact-one-representation invariant.

#### File: packages/player-cli/src/types.ts
- [ ] Add a union `NPCSetup` type so CLI scenarios can express stat-block or class-backed NPCs.

#### File: packages/player-cli/src/game-client.ts
- [ ] Update the client NPC payload type to support either stat-block or class-backed NPC creation.

#### File: packages/player-cli/src/scenario-loader.ts
- [ ] Send the correct NPC payload shape to the session NPC API for both setup styles.

#### File: packages/game-server/scripts/test-harness/scenario-runner.ts
- [ ] Update scenario-runner NPC setup to support both representations for deterministic combat scenarios.

### CombatOrchestration
#### File: packages/game-server/src/application/services/combat/helpers/creature-hydration.ts
- [ ] Hydrate class-backed NPCs from a Character-like mechanics sheet while preserving stat-block NPC hydration.

#### File: packages/game-server/src/application/services/combat/helpers/combatant-resolver.ts
- [ ] Resolve class-backed NPC combat stats, attacks, class identity, and save/equipment metadata from sheet data.

#### File: packages/game-server/src/application/services/combat/tabletop/action-dispatcher.ts
- [ ] Sweep Character-only actor/combatant lookups in class-mechanics branches for class-backed NPC actors, including offhand/Nick and metamagic resource-spend paths.

#### File: packages/game-server/src/application/services/combat/tabletop/rolls/initiative-handler.ts
- [ ] Build combat resources for class-backed NPCs from their NPC sheet instead of assuming class metadata only lives in `statBlock`.

#### File: packages/game-server/src/application/services/combat/tabletop/dispatch/class-ability-handlers.ts
- [ ] Allow class-backed NPC actors to execute class abilities using the same registry/executor path as Characters.

#### File: packages/game-server/src/application/services/combat/tabletop/dispatch/attack-handlers.ts
- [ ] Generalize Character-only class-mechanics lookups so class-backed NPC attacks can use the same attack-side rules.

#### File: packages/game-server/src/application/services/combat/tabletop/roll-state-machine.ts
- [ ] Route pending attack and damage resolution through class-backed actor data instead of Character-only lookups.

#### File: packages/game-server/src/application/services/combat/tabletop/rolls/damage-resolver.ts
- [ ] Preserve class-backed NPC hit-side mechanics and resource tracking during damage resolution.

#### File: packages/game-server/src/application/services/combat/tabletop/rolls/hit-rider-resolver.ts
- [ ] Preserve class-backed NPC feature riders that currently depend on Character-only attacker lookups.

#### File: packages/game-server/src/application/services/combat/tabletop/rolls/weapon-mastery-resolver.ts
- [ ] Resolve weapon mastery DCs and attacker mechanics for class-backed NPCs through the same representation-aware actor path.

#### File: packages/game-server/src/application/services/combat/combat-service.ts
- [ ] Use a representation-aware NPC mechanics source where combat startup and shared combat paths currently assume `npc.statBlock`.

### ClassAbilities
#### File: packages/game-server/src/domain/entities/creatures/npc.ts
- [ ] Expose Character-like mechanics getters for class-backed NPCs without changing NPC identity.

#### File: packages/game-server/src/domain/entities/classes/combat-resource-builder.ts
- [ ] Verify class-backed NPC sheets can reuse the existing combat resource builder contract without NPC-specific branching.

### AIBehavior
#### File: packages/game-server/src/application/services/combat/ai/ai-context-builder.ts
- [ ] Read class-backed NPC mechanics data from the new NPC representation instead of stat-block-only fields.

#### File: packages/game-server/src/application/services/combat/ai/ai-turn-orchestrator.ts
- [ ] Compute class-backed NPC attacks-per-action and turn execution data from the new mechanics source.

#### File: packages/game-server/src/application/services/combat/ai/ai-action-executor.ts
- [ ] Pass class-backed NPC sheet/class data into AI bonus-action execution paths.

#### File: packages/game-server/src/application/services/combat/ai/handlers/use-feature-handler.ts
- [ ] Supply class-backed NPC sheets to the ability registry instead of stat-block-only data.

### SpellSystem
#### File: packages/game-server/src/application/services/combat/ai/handlers/cast-spell-handler.ts
- [ ] Source NPC spellcasting data from the class-backed NPC sheet so AI spellcasting stays aligned with the new representation.

### Testing
#### File: packages/game-server/src/infrastructure/api/app.test.ts
- [ ] Add session NPC route coverage for stat-block NPC creation, class-backed NPC creation, and invalid mixed NPC payloads.

#### File: packages/game-server/src/application/services/combat/helpers/creature-hydration.test.ts
- [ ] Add hydration coverage for class-backed NPC sheet parsing and mechanics metadata exposure.

#### File: packages/game-server/src/application/services/combat/tabletop/rolls/initiative-handler.test.ts
- [ ] Add targeted coverage proving class-backed NPCs enter combat with the expected class resource pools and derived flags.

#### File: packages/game-server/src/application/services/combat/tabletop/dispatch/class-ability-handlers.test.ts
- [ ] Add targeted coverage showing a class-backed NPC can execute a class ability through the tabletop dispatcher.

#### File: packages/game-server/src/application/services/combat/tabletop/rolls/weapon-mastery-resolver.test.ts
- [ ] Add targeted coverage showing a class-backed NPC attack applies a mastery effect with the correct DC/effect resolution.

#### File: packages/player-cli/scenarios/party-dungeon.json
- [ ] Convert the allied wizard NPC scenario to the new class-backed NPC shape as a real client-facing example.

## Cross-Flow Risk Checklist
- [ ] Do changes in one flow break assumptions in another?
- [ ] Does the pending action state machine still have valid transitions?
- [ ] Is action economy preserved (1 action, 1 bonus, 1 reaction, 1 movement)?
- [ ] Do both player AND AI paths handle the change?
- [ ] Are repo interfaces + memory-repos updated if entity shapes change?
- [ ] Is app.ts registration updated if adding executors?
- [ ] Are D&D 5e 2024 rules correct (not 2014)?

## Risks
- Several combat paths still branch on `combatantType === "Character"` or re-read only Character records. If the persistence/API work lands without the downstream combat sweep, class-backed NPCs will partially initialize but still fail during action execution.
- NPC KO/death-save behavior is still keyed on `combatantType`, not on class-backed capability. This plan intentionally preserves existing NPC death behavior.
- Class-backed NPCs still need either explicit sheet attacks or sufficient equipment data for fallback attack derivation. This change removes stat-block duplication, not all combat-sheet authoring.
- AI and tabletop paths share some but not all class-mechanics adapters. Focused targeted validation is required after each slice to avoid creating tabletop-only support.

## Test Plan
- [ ] Unit tests for the new NPC route/persistence union validation and class-backed NPC hydration/resolver logic.
- [ ] Initiative-time validation proving a class-backed NPC receives expected class resource pools and derived flags.
- [ ] Targeted combat test proving a class-backed NPC can execute a class ability without being a Character record.
- [ ] AI-focused validation proving a class-backed NPC can source feature or spell data from sheet-backed mechanics state.
- [ ] Player-cli and scenario-runner coverage updated to the new NPC shape and validated via focused tests.

## SME Approval (Complex only)
- [ ] EntityManagement-SME
- [ ] CombatOrchestration-SME
- [ ] ClassAbilities-SME