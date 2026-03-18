---
description: "Architecture and conventions for the CombatRules flow: movement, pathfinding, damage, grapple, conditions, death saves, attack resolution, initiative, concentration."
applyTo: "packages/game-server/src/domain/rules/**,packages/game-server/src/domain/combat/**,packages/game-server/src/domain/effects/**"
---

# CombatRules Flow

## Purpose
Pure D&D 5e 2024 rules engine — deterministic game mechanics with no Fastify, Prisma, or LLM dependencies. Takes inputs, returns outputs. Never reads repositories or emits events.

## Architecture

```mermaid
classDiagram
    class AttackResolver {
        +getAdjustedMode()
        +resolveAttack()
    }
    class CombatMap {
        +getCoverLevel()
        +getCoverACBonus()
        +calculateDistance()
        +isWithinRange()
        +getTerrainAt()
    }
    class Movement {
        +Position (x, y)
        +MovementAttempt
        +MovementResult
    }
    class Pathfinding {
        +findPath()
        +getReachableCells()
    }
    class DamageDefenses {
        +DamageType (13 types)
        +applyDamageDefenses()
    }
    class DiceRoller {
        <<interface>>
        +roll()
    }
    class Concentration {
        +ConcentrationState
        +createConcentrationState()
        +concentrationCheckOnDamage()
    }
    class GrappleShove {
        +resolveGrapple()
        +resolveShove()
    }
    class DeathSaves {
        +resolveDeathSave()
        +DeathSaveState
    }

    AttackResolver --> DiceRoller
    AttackResolver --> DamageDefenses
    AttackResolver --> CombatMap
    Movement --> CombatMap
    Pathfinding --> CombatMap
    GrappleShove --> DiceRoller
    Concentration --> DiceRoller
```

## Key Contracts

| Type/Function | File | Purpose |
|---------------|------|---------|
| `DiceRoller` interface | `dice-roller.ts` | Abstraction for all randomness — enables deterministic testing |
| `DamageDefenses` / `DamageType` | `damage-defenses.ts` | 13 damage types + resistance/immunity/vulnerability |
| `CoverLevel` / `getCoverLevel()` | `combat-map.ts` | Cover detection between attacker and target |
| `Position` / `MovementAttempt` | `movement.ts` | Grid coordinates and movement validation |
| `ConcentrationState` | `concentration.ts` | Spell concentration state machine |
| `DeathSaveState` | `death-saves.ts` | Death save success/failure tracking |
| `TerrainType` (12 types) | `combat-map.ts` | Grid cell terrain classification |

## Dependencies
**Internal imports**: `domain/entities/` (creature types, item types, class definitions)
**External SDKs**: None — pure TypeScript

## Known Gotchas
1. **combat-map.ts is the largest file** (~480 lines, 35+ exports) — changes ripple to pathfinding, cover, zone damage, and movement
2. **class-resources.ts** imports all 10 class files to build resource pools — changes to class resource shapes propagate here
3. **Rules are pure functions** — if you need state, you're probably in the wrong layer
4. **D&D 5e 2024 rules** — not 2014. Verify against 2024 edition for any mechanic
5. **Dependency direction**: Rules → entities (never reversed, except `character.ts` → rest/hp rules)
