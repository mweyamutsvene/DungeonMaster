# SME Research — CombatOrchestration Docs Accuracy

## Scope
- Docs read: `.github/instructions/combat-orchestration.instructions.md`, `packages/game-server/src/application/services/combat/CLAUDE.md`, `packages/game-server/src/application/services/combat/tabletop/CLAUDE.md`
- Source checked: `tabletop-combat-service.ts`, `tabletop/action-dispatcher.ts`, `tabletop/action-parser-chain.ts`, `tabletop/roll-state-machine.ts`, `tabletop/tabletop-types.ts`, `tabletop/pending-action-state-machine.ts`, `combat-service.ts`, `action-service.ts`, `tactical-view-service.ts`, `combat-victory-policy.ts`
- Goal: verify doc statements against current code and call out stale or misleading guidance only.

## Current Truth
- `TabletopCombatService` is still a thin facade with 4 public entry points: `initiateAction`, `processRollResult`, `parseCombatAction`, `completeMove`. `completeMove` delegates into `twoPhaseActions.completeMove(...)`, so tabletop owns the text-and-roll facade but not the full reaction subsystem.
- `ActionDispatcher` is registry-driven and short-circuits on first parse match, but the parser chain is larger than the instruction doc says. Current chain includes compound move+attack, quickened-spell metamagic, give-item, and administer-item routes in addition to the older parsers.
- `RollStateMachine` now covers `INITIATIVE_SWAP` in both `PENDING_ACTION_TYPES` and the exhaustive handler map. The pending-action model is not just `initiate -> pending -> resolved`; valid chained states include `INITIATIVE -> INITIATIVE_SWAP`, `ATTACK -> ATTACK`, `DAMAGE -> ATTACK`, and `SAVING_THROW -> SAVING_THROW`.
- `ActionService` is not a single `executeAction()` facade anymore. It exposes explicit methods such as `attack`, `dodge`, `dash`, `disengage`, `hide`, `search`, `help`, `castSpell`, `shove`, `grapple`, `escapeGrapple`, and `move`.
- `TacticalViewService` has 2 public methods, not 3: `getTacticalView()` and `buildCombatQueryContext()`. `predictOpportunityAttacks()` is private.
- `TacticalViewService` reports per-combatant action economy as `actionAvailable`, `bonusActionAvailable`, `reactionAvailable`, and `movementRemainingFeet`. `attacksUsed` and `attacksAllowed` are exposed only in `buildCombatQueryContext().actor.resources`, not in each combatant's tactical snapshot.
- `TabletopCombatServiceDeps` still requires `abilityRegistry`; that statement is accurate.

## Drift Findings
- `.github/instructions/combat-orchestration.instructions.md`: the flow boundary is too broad. The doc says this flow manages reaction resolution and documents `TwoPhaseActionService` internals, but the file's own `applyTo` does not include `two-phase/**` or `two-phase-action-service.ts`. Current code shows tabletop only touches reactions through `deps.twoPhaseActions.completeMove(...)`.
- `.github/instructions/combat-orchestration.instructions.md`: the Mermaid/class tables describe an older `ActionService` API (`executeAction()`) and an older parser-chain size/order (`21` entries). Current code has explicit action methods and a 25-entry parser chain.
- `.github/instructions/combat-orchestration.instructions.md`: the `Damage Reaction Detection` section is misplaced for this flow. It describes `AttackReactionHandler.completeAttackReaction()` details that belong to ReactionSystem, not CombatOrchestration.
- `.github/instructions/combat-orchestration.instructions.md`: the `TacticalViewService` section says there are 3 public methods and implies attacks-used data is part of each combatant's action-economy payload. Both are inaccurate.
- `packages/game-server/src/application/services/combat/CLAUDE.md`: `Three-facade architecture` is incomplete shorthand now. The folder also contains `combat-service.ts` as combat lifecycle owner and `tactical-view-service.ts` as query/view builder, so the note can mislead readers into treating the whole scope as only three facades.
- `packages/game-server/src/application/services/combat/tabletop/CLAUDE.md`: the state-machine law is too simple. Current legal transitions include `INITIATIVE_SWAP` and attack/save chaining.
- `packages/game-server/src/application/services/combat/tabletop/CLAUDE.md`: `Two-phase turn flow: move -> action -> bonus -> end` is misleading in tabletop scope. That is broader turn/reaction orchestration, not the local tabletop law this file is supposed to anchor.

## Recommended Doc Edits

### `.github/instructions/combat-orchestration.instructions.md`

Replace the `Purpose` paragraph with:

> Combat orchestration covers the thin facades and routing/state modules that turn player or AI intent into deterministic combat execution. In this flow, `TabletopCombatService` owns text-to-action parsing, pending tabletop roll state, and move completion handoff; `ActionService` owns programmatic action execution; `CombatService` owns turn advancement and lifecycle; `TacticalViewService` builds tactical snapshots and query context. Reaction handler internals live in `reaction-system.instructions.md`.

Replace the `Three Facade Services` table with:

> Key services in this flow:
>
> - `TabletopCombatService` (`tabletop-combat-service.ts`): thin facade for text-based/manual-roll combat. Public methods: `initiateAction()`, `processRollResult()`, `parseCombatAction()`, `completeMove()`.
> - `ActionService` (`action-service.ts`): programmatic combat actions. Exposes explicit action methods such as `attack()`, `move()`, `dodge()`, `dash()`, `disengage()`, `hide()`, `search()`, `help()`, `castSpell()`, `shove()`, `grapple()`, and `escapeGrapple()`.
> - `CombatService` (`combat-service.ts`): combat lifecycle, turn advancement, effect processing, and AI turn trigger.
> - `TacticalViewService` (`tactical-view-service.ts`): tactical snapshot and combat-query context builder.
>
> Adjacent cross-flow dependency:
>
> - `TwoPhaseActionService` (`two-phase-action-service.ts`): reaction-resolution subsystem used by `TabletopCombatService.completeMove()`. Internal behavior is documented in `reaction-system.instructions.md`.

Replace the `ActionDispatcher Parser Chain` opening paragraph with:

> `ActionDispatcher.dispatch()` uses a registry-based parser chain and returns the first non-null parse match. The chain is intentionally ordered by specificity before broad matches. As of the current code, the chain includes compound move+attack, direct movement, jump, simple actions, quickened-spell metamagic, profile-driven class actions, stealth/search/help/grapple actions, spell casting, item interactions (pickup/drop/draw/sheathe/give/administer/use), legendary actions, end turn, and broad attack parsing.

Replace the `Adding a new action type` list with:

> 1. Add or extend a pure parser in `combat-text-parser.ts`.
> 2. Register it in `buildParserChain()` at the right priority relative to broader matches.
> 3. Route execution to the owning handler class (`MovementHandlers`, `AttackHandlers`, `ClassAbilityHandlers`, `InteractionHandlers`, `SocialHandlers`, `GrappleHandlers`, or `SpellActionHandler`).
> 4. If the new action creates or chains a pending tabletop roll, update pending-action types and transition rules as needed.

Replace the `Tactical View Service` section with:

> `TacticalViewService` has 2 public methods:
>
> - `getTacticalView()` returns the encounter snapshot used by clients: combatant positions, HP, conditions, basic action economy, movement state, resource pools, zones, ground items, and pending-action summary.
> - `buildCombatQueryContext()` returns enriched query context for LLM or UX helpers: actor capabilities, attack options, distances, nearby items, and OA prediction.
>
> `predictOpportunityAttacks()` is a private helper used by `buildCombatQueryContext()`.
>
> Per-combatant tactical action economy currently includes `actionAvailable`, `bonusActionAvailable`, `reactionAvailable`, and `movementRemainingFeet`. Attack-count data (`attacksUsed`, `attacksAllowed`) is exposed in the query-context actor payload, not in every combatant snapshot.

Delete the `Damage Reaction Detection` section from this file and replace it with:

> Reaction timing details, attack-reaction handlers, and damage-reaction chaining are owned by `reaction-system.instructions.md`. In CombatOrchestration, the only important contract is that tabletop move completion can hand off into `TwoPhaseActionService` when movement triggers a reaction flow.

### `packages/game-server/src/application/services/combat/CLAUDE.md`

Replace law 1 with caveman wording:

> 1. `tabletop`, `action`, `two-phase` facades stay thin. `combat-service` own turn life. `tactical-view-service` build view/query data.

### `packages/game-server/src/application/services/combat/tabletop/CLAUDE.md`

Replace law 3 with caveman wording:

> 3. Pending state machine strict. Valid jumps only. Not just `initiate -> pending -> resolved`; swap and chained attack/save states exist too.

Replace law 4 with caveman wording:

> 4. Tabletop own text parse + roll flow. If move needs reaction handling, tabletop hand off to `twoPhaseActions`; reaction rules live elsewhere.

### Mermaid
- Mermaid would not materially help this doc in its current form. The existing diagram is already more detailed than the stable contracts and has drifted. A smaller diagram would help only if reduced to 4 boxes: `TabletopCombatService`, `ActionDispatcher`, `RollStateMachine`, and `CombatService`, plus one dashed cross-reference edge to `TwoPhaseActionService`.