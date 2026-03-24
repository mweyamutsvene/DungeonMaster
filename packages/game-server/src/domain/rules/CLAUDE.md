# CombatRules — Architectural Constraints

## Scope
`domain/rules/`, `domain/combat/`, `domain/effects/`

## Laws
1. **Rules are pure functions** — take inputs, return outputs. Never read from repositories, never emit events, no side effects.
2. **Dependency direction** — rules import from `domain/entities/` (creature/item types) but entities NEVER import from rules (sole exception: `character.ts` imports rest/hp rules).
3. **D&D 5e 2024 edition** — always validate against 2024 rules, not 2014.
4. **`class-resources.ts` is a coupling hub** — it imports all class files to build resource pools. Changes to class resource shapes propagate there.
5. **`combat-map.ts` is a high-fanout module** — changes affect pathfinding, cover, zone damage, and movement simultaneously. Test all downstream consumers.
