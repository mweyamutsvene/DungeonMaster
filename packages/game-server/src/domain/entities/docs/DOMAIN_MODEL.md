# Domain Model (Phase 2 — 1.2)

Goal: define the deterministic, testable OOP “core types” the rules engine will operate on. These are **domain types** only; persistence (Prisma) and transport (Fastify routes/events) come later.

## Class Hierarchy (as planned)

- `Creature` (abstract)
  - `Character`
  - `Monster`
  - `NPC`

- `Action` (abstract)
  - `AttackAction`
  - `SpellcastAction`
  - `SkillCheckAction`
  - `MovementAction`

- `Item` (abstract)
  - `Weapon`
  - `Armor`
  - `Equipment`

- `Effect` (abstract)
  - `DamageEffect`
  - `HealingEffect`
  - `ConditionEffect`

## Key Interfaces / Value Objects

- `AbilityScores` + `abilityModifier(score)`
- `ActionEconomy` (action/bonus/reaction + remaining movement)
- `ResourcePool` (named current/max)
- `Condition` (typed condition names)

## Notes / Boundaries

- Domain types are intentionally small “shape” definitions right now.
- Applying effects and mutating combat state will be implemented in the rules/state layer (later stages).
- We’re keeping things deterministic and unit-test friendly (no randomness embedded here).

## Naming Conventions (Repo)

- **Files/folders**: `kebab-case` (e.g. `ability-scores.ts`, `attack-action.ts`)
- **Types/classes**: `PascalCase` (e.g. `AbilityScores`, `AttackAction`)
- **Imports**: NodeNext ESM style with explicit `.js` extensions in TS source (e.g. `"../core/ability-scores.js"`)
- **Organization**: `entities/` is split into subfolders (`core/`, `creatures/`, `actions/`, `items/`, `effects/`, `combat/`)
