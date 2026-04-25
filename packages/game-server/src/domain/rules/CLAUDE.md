# CombatRules — Quick Constraints

Speak caveman. Keep short.

## Scope
`domain/rules/`, `domain/combat/`, `domain/effects/`

## Laws
1. `domain/rules/` stay pure. `domain/combat/` and `domain/effects/` can hold state or mutate creature, but still no repo, DB, API, event bus, or LLM stuff.
2. Keep imports inside domain only. Rules can read entities. Some entities already read shared rule helpers too. Do not pull app or infra into this flow, and do not make cycle.
3. Use D&D 5e 2024 rules, not 2014.
4. `class-resources.ts` is coupling hub; class resource shape changes ripple there.
5. Combat map modules are high fanout; map changes require downstream tests (path, cover, zone, movement).

6. Movement state live in `rules/movement.ts` now. `combat/movement.ts` dead. Do not bring dead file back.
