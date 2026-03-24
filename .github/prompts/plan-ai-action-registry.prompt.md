# Plan: AI Action Extensibility — Registry/Strategy Pattern
## Round: 1
## Status: IN_PROGRESS
## Affected Flows: AIBehavior

## Objective
Replace the large `if/else` dispatch chain in `AiActionExecutor.execute()` with a registry/strategy pattern, mirroring `AbilityRegistry`. Each AI action handler becomes a standalone class implementing `AiActionHandler`, registered in a central `AiActionRegistry`. Adding a new AI action = create one file and register — no if/else touching required.

## Analysis
`ai-action-executor.ts` (~2,200 lines) currently:
- `execute()` has 14 `if/else` branches routing to private handler methods
- `executeBonusAction()` already tries registry first (via `AbilityRegistry`), then falls back to legacy string matching
- Shared helpers: `findCombatantByName`, `normalizeName`, `toCombatantRef`, `buildActorRef`, `isActionConsuming`, `getEconomy`, `getMovementDeps`, `executeBonusAction`
- Constructor deps: `actionService, twoPhaseActions, combat, pendingActions, combatantResolver, abilityRegistry, aiDecideReaction, aiLog, diceRoller, events, characters`

**14 action handlers in the if/else chain:**
| Action | Handler |
|--------|---------|
| `attack` | `executeAttack()` |
| `move` | `executeMove()` |
| `moveToward` | `executeMoveToward()` |
| `moveAwayFrom` | `executeMoveAwayFrom()` |
| `disengage` / `dash` / `dodge` | `executeBasicAction()` |
| `help` | `executeHelp()` |
| `castSpell` | `executeCastSpell()` |
| `shove` | `executeShove()` |
| `grapple` | `executeGrapple()` |
| `escapeGrapple` | `executeEscapeGrapple()` |
| `hide` | `executeHide()` |
| `search` | `executeSearch()` |
| `useObject` | `executeUseObject()` |
| `endTurn` | `executeEndTurn()` |

## Changes

### AIBehavior Flow

#### File: `ai/ai-action-handler.ts` (NEW)
- [x] Define `AiHandlerResult = Omit<TurnStepResult, "step">`
- [x] Define `AiActionHandlerContext` — runtime data bundle: `{ sessionId, encounterId, aiCombatant, decision, allCombatants, actorRef }`
- [x] Define `AiActionHandlerDeps` — services + bound helpers from executor
- [x] Define `AiActionHandler` interface: `handles(action: string): boolean` + `execute(ctx, deps): Promise<AiHandlerResult>`

#### File: `ai/ai-action-registry.ts` (NEW)
- [x] Define `AiActionRegistry` with `register(handler)`, `findHandler(action)`, `execute(ctx, deps)`, `getHandlers()`, `clear()` methods

#### File: `ai/handlers/attack-handler.ts` (NEW)
- [x] Extract `executeAttack()` logic

#### File: `ai/handlers/move-handler.ts` (NEW)
- [x] Extract `executeMove()` logic

#### File: `ai/handlers/move-toward-handler.ts` (NEW)
- [x] Extract `executeMoveToward()` logic

#### File: `ai/handlers/move-away-from-handler.ts` (NEW)
- [x] Extract `executeMoveAwayFrom()` logic

#### File: `ai/handlers/basic-action-handler.ts` (NEW)
- [x] Extract `executeBasicAction()` logic (handles disengage/dash/dodge)

#### File: `ai/handlers/help-handler.ts` (NEW)
- [x] Extract `executeHelp()` logic

#### File: `ai/handlers/cast-spell-handler.ts` (NEW)
- [x] Extract `executeCastSpell()` logic

#### File: `ai/handlers/shove-handler.ts` (NEW)
- [x] Extract `executeShove()` logic

#### File: `ai/handlers/grapple-handler.ts` (NEW)
- [x] Extract `executeGrapple()` logic

#### File: `ai/handlers/escape-grapple-handler.ts` (NEW)
- [x] Extract `executeEscapeGrapple()` logic

#### File: `ai/handlers/hide-handler.ts` (NEW)
- [x] Extract `executeHide()` logic

#### File: `ai/handlers/search-handler.ts` (NEW)
- [x] Extract `executeSearch()` logic

#### File: `ai/handlers/use-object-handler.ts` (NEW)
- [x] Extract `executeUseObject()` logic

#### File: `ai/handlers/end-turn-handler.ts` (NEW)
- [x] Extract `executeEndTurn()` logic

#### File: `ai/handlers/index.ts` (NEW)
- [x] Barrel export all handlers

#### File: `ai/ai-action-executor.ts` (MODIFIED)
- [x] Add `private readonly registry: AiActionRegistry` field
- [x] Add `private buildDeps(): AiActionHandlerDeps` method that bundles all services + bound helpers
- [x] Add `private setupRegistry(): void` method that instantiates + registers all 14 handlers
- [x] Replace 14-branch if/else in `execute()` with registry lookup + dispatch (~15 lines instead of ~50)
- [x] Keep constructor signature identical (no change to orchestrator or tests)
- [x] Keep `executeBonusAction()` on executor (bonus action handling stays centralized)
- [x] Keep all shared helpers (`findCombatantByName`, `normalizeName`, `toCombatantRef`, etc.)

#### File: `ai/index.ts` (MODIFIED)
- [x] Add exports for `AiActionHandler`, `AiActionHandlerContext`, `AiActionHandlerDeps`, `AiActionRegistry`

## Cross-Flow Risk Checklist
- [x] Do changes in one flow break assumptions in another? NO — pure internal refactor, public API unchanged
- [x] Does the pending action state machine still have valid transitions? YES — `castSpell` and `attack` handlers preserve all pending action logic
- [x] Is action economy preserved? YES — economy guard stays in `execute()` before registry dispatch
- [x] Do both player AND AI paths handle the change? AI path only
- [x] Are repo interfaces + memory-repos updated if entity shapes change? NO entity shape changes
- [x] Is `app.ts` registration updated if adding executors? NO — registry is self-contained in executor constructor
- [x] Are D&D 5e 2024 rules correct? YES — no rule logic changes

## Risks
- **Handler dependency access**: Each handler needs `executeBonusAction` from executor — solved via `AiActionHandlerDeps` which includes bound `executeBonusAction` method
- **Test backward compat**: Existing tests call `executor.execute()`, `executor.buildActorRef()`, `executor.executeBonusAction()` — all public API preserved
- **Circular imports**: Handlers must NOT import from `ai-action-executor.ts` directly — they receive deps via context injection

## Test Plan
- [x] Existing unit tests in `ai-action-executor.test.ts` continue to pass (no API changes)
- [x] Run `pnpm test:e2e:combat:mock` — all 14 AI action paths covered by E2E scenarios

## Implementation Notes
- `AiActionHandlerDeps` extends all constructor deps + 4 bound helpers
- `BasicActionHandler` handles `disengage`, `dash`, `dodge` (3 actions, 1 class — same as original)
- Handler files are self-contained — each imports only what it needs
- Adding a new action in future: 1 new handler file + 1 line in `setupRegistry()`
