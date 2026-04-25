---
type: sme-research
flow: CombatRules
feature: combatrules-doc-accuracy
author: CombatRules-SME
status: COMPLETE
round: 1
created: 2026-04-25
updated: 2026-04-25
---

# SME Research — CombatRules — Doc Accuracy

## Scope
- Docs read: `.github/instructions/combat-rules.instructions.md`, `packages/game-server/src/domain/rules/CLAUDE.md`
- Flow files verified: `domain/rules/movement.ts`, `pathfinding.ts`, `combat-map.ts`, `combat-map-sight.ts`, `combat-rules.ts`, `damage-defenses.ts`, `feat-modifiers.ts`, `hide.ts`, `rest.ts`, `weapon-mastery.ts`, `class-resources.ts`
- Adjacent confirmation files: `domain/combat/combat.ts`, `attack-resolver.ts`, `initiative.ts`, `domain/entities/combat/effects.ts`, `domain/effects/effect.ts`, `condition-effect.ts`, `damage-effect.ts`, plus import checks across `domain/entities/**`

## Current Truth
- The CombatRules flow is broader than “pure rules only”. `domain/rules/*` is mostly pure and deterministic, but `domain/combat/*` includes a stateful `Combat` class and `attack-resolver.ts` mutates the target via `target.takeDamage()`. `domain/effects/*` contains in-memory effect classes such as `DamageEffect` and `ConditionEffect` that also mutate creatures.
- Movement consolidation is real: `Position`, `MovementState`, `createMovementState`, jump helpers, and `applyForcedMovement()` all live in `domain/rules/movement.ts`. There is no live `domain/combat/movement.ts` file.
- The combat map is now a module family behind the `domain/rules/combat-map.ts` barrel. `combat-map-sight.ts` owns cover, line of sight, faction/radius queries, and obscuration helpers.
- The current import boundary is domain-only, not one-way rules-to-entities only. Multiple entity files import rule helpers today, including class, spell, combat-zone, item, and character modules.

## Drift Findings
1. `.github/instructions/combat-rules.instructions.md` overstates purity for the full flow. Its Purpose section says the flow is a pure rules engine that only takes inputs and returns outputs, but `domain/combat/combat.ts`, `domain/combat/attack-resolver.ts`, and `domain/effects/*` are not pure in that sense.
2. The instruction doc’s Mermaid architecture is materially stale. It models modules as classes, includes a deleted `CombatMovement` surface, and hides the real split between pure rule modules, the stateful `Combat` holder, and the effect classes.
3. The instruction doc contradicts itself on movement ownership. The “Movement File” section correctly says `combat/movement.ts` was deleted, but the later Key Contracts table still points `MovementState` at `combat/movement.ts`, and Known Gotcha 8 still claims there are two active `Position` types.
4. The instruction doc is incomplete about the current map/effect surface. `combat-map-sight.ts` now exports obscuration helpers, and the flow doc does not mention the `domain/effects/*` abstraction family at all even though it is inside the applyTo scope.
5. `packages/game-server/src/domain/rules/CLAUDE.md` has two stale laws for the current flow scope. “Rules are pure functions only” is false once `domain/combat/*` is included, and the “entities do not read rules except character.ts” note is no longer true.

## Recommended Doc Edits
- Instruction doc: replace the current Purpose paragraph with this regular-English text:

  "CombatRules spans three related domain surfaces. Most files in `domain/rules/` are pure deterministic rule helpers. `domain/combat/` adds combat-specific state and resolution, such as initiative ordering, turn progression, and attack application. `domain/effects/` provides reusable in-memory effect models. None of these files depend on Fastify, Prisma, repositories, or LLM adapters."

- Instruction doc: replace the Mermaid class diagram with this regular-English summary:

  "This flow is module-oriented, not class-oriented. `rules/movement.ts` owns grid math, jump rules, forced movement, and the shared `MovementState` type. `rules/pathfinding.ts` performs A* pathfinding and reachable-cell search over the `combat-map` module family. `combat/combat.ts` is the stateful combat holder for initiative, action economy, active effects, positions, and movement state. `combat/attack-resolver.ts` is the full attack pipeline, while `rules/combat-rules.ts` remains the low-level to-hit and damage primitive layer. `rules/hide.ts`, `rules/rest.ts`, `rules/weapon-mastery.ts`, `rules/feat-modifiers.ts`, and `rules/damage-defenses.ts` remain pure helper modules. `domain/effects/*` contains reusable effect classes such as damage, condition, and healing effects."

- Instruction doc: replace the Key Contracts row for movement with this regular-English text:

  "`Position` / `MovementAttempt` / `MovementState` | `rules/movement.ts` | Shared grid coordinates, movement validation, and turn-scoped movement state used by `Combat`."

- Instruction doc: replace Known Gotcha 8 with this regular-English text:

  "Movement state was consolidated into `rules/movement.ts`. Do not reference or recreate `combat/movement.ts`; the live shared `Position` and `MovementState` types for this flow are in `rules/movement.ts`."

- Instruction doc: add this regular-English sentence to the Combat Map Module Family section:

  "`combat-map-sight.ts` also exports obscuration helpers: `getObscuredLevelAt` and `getObscurationAttackModifiers`."

- Instruction doc: add this regular-English paragraph near the effects section:

  "This flow also includes the `domain/effects/` abstraction family. `Effect` is the base class, with concrete effects such as `DamageEffect`, `ConditionEffect`, and `HealingEffect`. These mutate creatures in memory but stay inside the domain layer."

- CLAUDE doc: replace Law 1 with this caveman wording:

  "1. `domain/rules/` stay pure. `domain/combat/` and `domain/effects/` can hold state or mutate creature, but still no repo, DB, API, event bus, or LLM stuff."

- CLAUDE doc: replace Law 2 with this caveman wording:

  "2. Keep imports inside domain only. Rules can read entities. Some entities already read shared rule helpers too. Do not pull app or infra into this flow, and do not make cycle."

- CLAUDE doc: optional add after current Law 5 with this caveman wording:

  "6. Movement state live in `rules/movement.ts` now. `combat/movement.ts` dead. Do not bring dead file back."

- Mermaid note: Mermaid would not materially help this doc unless it is simplified to a small module dependency sketch. The current pseudo-class diagram is more misleading than helpful. For this flow, short contract bullets are higher value than a large diagram.