# Combat — Architectural Constraints

## Scope
`application/services/combat/` — the entire combat subsystem.

## Directory Structure

| Directory | Owner Facade | Purpose |
|-----------|-------------|---------|
| `tabletop/` | `tabletop-combat-service.ts` | Text-based dice flow: parser chain, roll resolution, spell delivery |
| `tabletop/dispatch/` | `action-dispatcher.ts` | 6 ActionDispatcher-private handler classes (movement, attack, class ability, grapple, social, interaction) |
| `tabletop/rolls/` | `roll-state-machine.ts` | Roll resolvers (initiative, hit-rider, weapon mastery, damage, saving throw) |
| `tabletop/spell-delivery/` | `spell-action-handler.ts` | Per-effect delivery: buff/debuff, healing, attack, save-based, zone |
| `action-handlers/` | `action-service.ts` | Programmatic action execution: attack, grapple, skill |
| `two-phase/` | `two-phase-action-service.ts` | Reaction resolution: move, attack, spell, damage reactions |
| `helpers/` | (shared) | Shared utilities: hydration, resource utils, combatant resolution |
| `ai/` | `ai-turn-orchestrator.ts` | AI decision making, battle planning, context building |
| `ai/handlers/` | `ai-action-executor.ts` | Per-action AI handlers (attack, move, cast spell, grapple, hide, etc.) |
| `abilities/` | — | AbilityRegistry + per-class executors |

## Root-level files
`tabletop-combat-service.ts`, `action-service.ts`, `two-phase-action-service.ts`, `combat-service.ts` (lifecycle), `tactical-view-service.ts` (battlefield views), `combat-victory-policy.ts` (end-condition checks), `index.ts`.

## Laws
1. **Three-facade architecture** — `TabletopCombatService`, `ActionService`, and `TwoPhaseActionService` are thin facades that delegate to their respective handler directories. Keep facades under ~600 lines.
2. **Handler directories are private** — `action-handlers/` is only imported by `action-service.ts`; `two-phase/` is only imported by `two-phase-action-service.ts`; `tabletop/` dispatch handlers are only imported by `action-dispatcher.ts`.
3. **`helpers/` is shared infrastructure** — any module in the combat subtree may import from `helpers/`. Helpers must remain stateless (no constructor deps, pure functions or simple classes).
4. **`combat-service.ts` is the lifecycle owner** — turn advancement, combat start/end, combatant management. Other facades handle action resolution within a turn.
5. **New handler extractions** follow the constructor pattern: `(deps, eventEmitter, debugLogsEnabled)` for tabletop handlers; session/combat/combatant repos for action-service handlers.
