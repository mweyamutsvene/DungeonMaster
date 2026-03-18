# Plan: Refactor TabletopCombatService into Focused Modules + Legacy Cleanup

**STATUS: ✅ COMPLETE** — All 4 phases implemented. 3,679-line monolith → 330-line thin facade + 7 focused modules under `tabletop/`. 328 tests pass, typecheck clean.

**TL;DR:** Broke the 3,679-line monolith into 7 focused modules under `tabletop/` subfolder. The 4 public methods remain on a thin `TabletopCombatService` facade (~330 lines). Phase 1 cleaned up all legacy dead code (~300 lines removed). Phase 2 extracted types and pure functions. Phase 3 extracted stateful handlers. Phase 4 wired the facade and updated exports. Monk-specific post-hit resolution lives in a temporary module with a documented seam for the planned System 1/2 architecture (per `plan-architecture-systems.prompt.md`). No external API or test changes.

---

## Phase 1 — Legacy Cleanup (shrink before extraction)

### Step 1. Make `abilityRegistry` required in `TabletopCombatServiceDeps`

Change `abilityRegistry?: AbilityRegistry` → `abilityRegistry: AbilityRegistry` at `tabletop-combat-service.ts L240`. Safe because the single construction site in `app.ts L258` always provides it.

### Step 2. Delete the 5 dead `!this.deps.abilityRegistry` guard blocks

Remove unreachable guard + throw/fallback at:
- L541–543 (Action Surge guard)
- L549–551 (Second Wind guard)
- L562–564 (Off-hand attack guard)
- L1921–1923 in `handleClassAbility`
- L2482–2484 in `handleBonusAbility`

### Step 3. Delete the legacy `handleFlurryOfBlows` method + its fallback call

- Remove the entire method at L2709–2843 (~134 lines)
- Remove the fallback block at L583–587 that calls it
- Remove the generic bonus error at L587 (no longer needed when registry is required)

### Step 4. Remove unused import `needsDeathSave`

At L56, remove `needsDeathSave` from the death-saves import.

### Step 5. Gate all bare `console.log` calls behind `this.debugLogsEnabled`

Wrap 20+ bare `console.log` statements (e.g. L1196, L1320, L1420, L1435, L1457, L1472, L1501, L1510, L1524, L2230, L2342, L3032, L3048, L3179, L3186, L3245, L3265, L3286, L3313, L3406) in `if (this.debugLogsEnabled)`. The flag already exists at L317.

### Step 6. Fix executor drift in `app.ts` inner registry

In `app.ts L335–339`, `abilityRegistryInner` only registers 4 executors vs 14 in the outer one at L201–214. Register the same full set to prevent silent failures.

### Step 7. Extract shared `parseOpenHandTechnique` to a shared util

The same parse logic exists in both `tabletop-combat-service.ts L3141` and `flurry-of-blows-executor.ts L260`. Extract to `combat/helpers/monk-parse-utils.ts` and import from both.

---

## Phase 2 — Folder Structure & Pure Extractions

### Step 8. Create the `tabletop/` subfolder

```
application/services/combat/tabletop/
  index.ts                          ← barrel re-exports facade + all types
  tabletop-combat-service.ts        ← thin facade (~200 lines), 4 public methods
  tabletop-types.ts                 ← all exported types/interfaces
  combat-text-parser.ts             ← all tryParse* + pure utility functions
  roll-state-machine.ts             ← 4 roll handlers + parseRollValue + loadRoster
  action-dispatcher.ts              ← parseCombatAction dispatch + all action handlers
  spell-action-handler.ts           ← handleCastSpellAction (~250 lines)
  monk-technique-resolver.ts        ← resolveOpenHandTechnique + resolveStunningStrike (temporary — see Step 13)
  tabletop-event-emitter.ts         ← emitAttackEvents, emitDamageEvents, markActionSpent, generateNarration
```

### Step 9. Extract types to `tabletop/tabletop-types.ts`

Move all exported types/interfaces (L62–L243 post-cleanup): `PendingActionType`, `InitiatePendingAction`, `AttackPendingAction`, `DamagePendingAction`, `DeathSavePendingAction`, `TabletopPendingAction`, `WeaponSpec`, `RollRequest`, `CombatStartedResult`, `AttackResult`, `DamageResult`, `ActionParseResult`, `TabletopCombatServiceDeps`.

### Step 10. Extract pure text parsers to `tabletop/combat-text-parser.ts`

Move all 15+ pure/stateless functions (none use `this.deps`):
- `tryParseMoveText`, `tryParseSimpleActionText`, `tryParseBonusActionText`
- `parseOpenHandTechnique`, `parseStunningStrike` (import from shared `monk-parse-utils.ts` created in Step 7)
- `tryParseHideText`, `tryParseActionSurgeText`, `tryParseSecondWindText`, `tryParseOffhandAttackText`
- `tryParseHelpText`, `tryParseShoveText`, `tryParseGrappleText`, `tryParseCastSpellText`
- `inferActorRef`, `parseDamageModifier`, `findCombatantByName`, `getActorNameFromRoster`
- Module-level: `doubleDiceInFormula`, `deriveRollModeFromConditions`

All become named exports (plain functions, no class).

---

## Phase 3 — Extract Stateful Handlers

### Step 11. Extract event/narration helpers to `tabletop/tabletop-event-emitter.ts`

Create `TabletopEventEmitter` class with:
- `generateNarration()` — needs `narrativeGenerator`
- `emitAttackEvents()` — needs `events`
- `emitDamageEvents()` — needs `events`
- `markActionSpent()` — needs `combatRepo`

Deps: `{ events?: IEventRepository; combatRepo: ICombatRepository; narrativeGenerator?: INarrativeGenerator; debugLogsEnabled: boolean }`.

### Step 12. Extract monk technique resolution to `tabletop/monk-technique-resolver.ts`

Create `MonkTechniqueResolver` class with:
- `resolveOpenHandTechnique()` (~140 lines)
- `resolveStunningStrike()` (~90 lines)

Deps: `combatRepo`, `diceRoller`, `events`.

**This module is explicitly temporary.** Add a header comment:
```typescript
/**
 * TEMPORARY: Monk-specific post-hit resolution for the tabletop dice flow.
 *
 * These methods will be replaced by the general Hit-Rider system (System 2)
 * and Saving Throw Resolution (System 1) described in:
 *   .github/prompts/plan-architecture-systems.prompt.md
 *
 * When Systems 1+2 are built, this module should be absorbed into:
 * - SavingThrowPendingAction (for STR/DEX/CON saves)
 * - HitRiderCheck + enhancement declaration (for declaring OHT/Stunning Strike)
 */
```

### Step 13. Refactor `handleDamageRoll` post-hit section with a documented seam

In the extracted `roll-state-machine.ts`, the post-hit section of `handleDamageRoll` (currently ~L1517–1570) calls into `MonkTechniqueResolver` with a clear future hook point:

```typescript
// ── Post-hit enhancements (hit-riders) ──────────────────────────
// TODO [System 2]: Replace with generic Hit-Rider dispatch.
// See .github/prompts/plan-architecture-systems.prompt.md § System 2
// Future: iterate pendingAction.declaredEnhancements[] → resolver.resolve(each)
if (pendingAction.openHandTechnique) {
  ohtResult = await this.monkResolver.resolveOpenHandTechnique(...);
}
if (pendingAction.stunningStrike) {
  ssResult = await this.monkResolver.resolveStunningStrike(...);
}
```

### Step 14. Extract roll handlers to `tabletop/roll-state-machine.ts`

Create `RollStateMachine` class with:
- `handleInitiativeRoll()` (~260 lines)
- `handleAttackRoll()` (~240 lines)
- `handleDamageRoll()` (~190 lines, with seam from Step 13)
- `handleDeathSaveRoll()` (~130 lines)
- `parseRollValue()` helper
- `loadRoster()` helper

Deps: repos, `combat`, `pendingActions`, `intentParser`, `victoryPolicy`, `abilityRegistry`, `diceRoller` + delegates to `TabletopEventEmitter` and `MonkTechniqueResolver`.

### Step 15. Extract spell handling to `tabletop/spell-action-handler.ts`

Create `SpellActionHandler` class with:
- `handleCastSpellAction()` (~250 lines)

Deps: `combatRepo`, `combat`, `pendingActions`, `events`, `diceRoller`, + `TabletopEventEmitter`.

### Step 16. Extract action dispatching to `tabletop/action-dispatcher.ts`

Create `ActionDispatcher` class with:
- `dispatch()` — the `tryParse*` → `handle*` chain (core of `parseCombatAction`)
- `handleMoveAction`, `handleSimpleAction`, `handleClassAbility`, `handleBonusAbility`
- `handleHelpAction`, `handleShoveAction`, `handleGrappleAction`, `handleHideAction`
- `handleAttackAction`

Delegates to `SpellActionHandler` for spell casting. Uses functions from `combat-text-parser.ts` for parsing. Widest deps consumer.

---

## Phase 4 — Wire Facade & Update Exports

### Step 17. Rewrite `tabletop/tabletop-combat-service.ts` as thin facade

The facade constructs internal modules in its constructor and delegates:
- `initiateAction()` → `RollStateMachine.loadRoster()` + pending action creation + narration
- `processRollResult()` → `RollStateMachine.handle*Roll()`
- `parseCombatAction()` → `ActionDispatcher.dispatch()`
- `completeMove()` → stays inline (already delegates to `TwoPhaseActionService`)

Target: ~200–300 lines. Same public API — zero breaking changes.

### Step 18. Create `tabletop/index.ts` barrel

Re-export `TabletopCombatService` + all types from `tabletop-types.ts`.

### Step 19. Update `combat/index.ts`

Replace `export * from "./tabletop-combat-service.js"` with `export * from "./tabletop/index.js"`.

### Step 20. Delete the old `combat/tabletop-combat-service.ts`

### Step 21. Update `app.ts` import path

Update the import to pull from the new barrel. The `new TabletopCombatService(deps)` call stays identical.

---

## Verification

- `pnpm -C packages/game-server typecheck` — all imports resolve, `abilityRegistry` now required, no unused imports
- `pnpm -C packages/game-server test` — all unit/integration tests pass
- `pnpm -C packages/game-server test:e2e:combat:mock` — all 41 E2E scenarios pass
- `pnpm lint` — no unused imports, no bare `console.log` outside debug gate
- Confirm barrel re-export: `import { TabletopCombatService, RollRequest, ... }` from route handlers and app.ts works unchanged

---

## Decisions

- **`abilityRegistry` made required** — the single construction site always provides it; eliminates ~30 lines of dead guards + 134-line legacy `handleFlurryOfBlows`
- **Subfolder `tabletop/`** over flattening at `combat/` — prevents further clutter (combat/ already has 12 files)
- **`MonkTechniqueResolver` is explicitly temporary** — it isolates `resolveOpenHandTechnique` / `resolveStunningStrike` for now but is documented as the future target for System 2 (Hit-Riders) + System 1 (Saving Throws) from `plan-architecture-systems.prompt.md`. No new interfaces on `AbilityExecutor` — that's System 2's job
- **`handleDamageRoll` has a documented seam** — the post-hit section explicitly marks where System 2 will plug in, making the future refactor trivial
- **Debug gating over removal** — `console.log` statements are useful for dev; wrapping in `debugLogsEnabled` makes them opt-in via `DM_DEBUG_LOGS=1`
- **Inner registry sync in app.ts** — fixes the executor drift bug where `createServicesForRepos` only registers 4 of 14 executors
- **Shared `parseOpenHandTechnique`** — deduplicate between tabletop service and flurry executor into `combat/helpers/monk-parse-utils.ts`
