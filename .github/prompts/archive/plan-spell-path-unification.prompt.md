# Plan: Spell Path Unification — Extract Shared Spell Resolution Logic

## Round: 2 (Implementation — pragmatic scope after blocker analysis)
## Status: COMPLETE ✅
## Affected Flows: SpellSystem, AIBehavior
## Baseline: 599 unit tests, 153/153 E2E, typecheck clean

## ⚠️ Blocker Discovered: SpellAttackDeliveryHandler is interactive

`SpellAttackDeliveryHandler.handle()` returns `requiresPlayerInput: true` and stores an `ATTACK` pending action — it requires the player to roll the attack dice. This means full delivery unification into a `SpellResolutionService` is NOT feasible without substantially changing the pending action state machine for AI contexts.

**Decision**: Implement **partial unification only**:
- ✅ Extract spell slot spending + concentration management into shared `helpers/spell-slot-manager.ts` helper functions
- ✅ AI path calls these helpers → AI casters now spend slots + track concentration (fixing resource bookkeeping bugs)
- ❌ Defer full `SpellResolutionService` (delivery unification) — too high regression risk for a LOW priority item
- 📝 Document delivery gap clearly in both files

## Outcome Summary
- Before: AI casters cast spells for free, ignore concentration tracking (resource bookkeeping bugs)
- After: AI casters spend slots, manage concentration. Mechanics (damage/healing/effects) remain tabletop-only and documented.



## Evidence of Divergence

### Path 1: SpellActionHandler (tabletop flow)
- Entry: `ActionDispatcher.dispatch()` → `SpellActionHandler.handleCastSpell()`
- **Spell slot spending**: ✅ Checks and spends from `spellSlot_{level}` resource pool
- **Concentration management**: ✅ Breaks old concentration, sets new `concentrationSpellName`
- **Spell delivery**: ✅ 5 delivery handlers (SpellAttack, Healing, Save, Zone, BuffDebuff) + simple fallback
- **Action economy**: ✅ Via `ActionService.castSpell()` at the end of each delivery handler

### Path 2: AiActionExecutor (AI/programmatic flow)
- Entry: `AiActionExecutor.executeCastSpell()` → `TwoPhaseActionService.initiateSpellCast()`
- **Counterspell detection**: ✅ Via TwoPhaseActionService
- **Spell slot spending**: ❌ Not implemented
- **Concentration management**: ❌ Not implemented
- **Spell delivery (damage/healing/saves/zones/buffs)**: ❌ Not implemented
- **Action economy**: ✅ Via `ActionService.castSpell()`

### ActionService.castSpell() — shared bookkeeping
- Just calls `performSimpleAction("CastSpell", { spellName })` 
- Marks action spent (or bonus action), emits generic `ActionResolved` event
- Does NOT do any spell mechanics — it's a cosmetic step used by BOTH paths

## Architecture Decision

**Extract a `SpellResolutionService`** that encapsulates the shared pre-resolution mechanics (slot spending + concentration management) PLUS dispatches to the existing delivery handlers. Both SpellActionHandler and AiActionExecutor will delegate to it.

### What goes into SpellResolutionService:
1. **Spell lookup** — find PreparedSpellDefinition from character sheet
2. **Slot spending** — validate and spend spell slot for leveled spells
3. **Concentration management** — break old concentration, set new
4. **Delivery dispatch** — route to the right delivery handler based on spell type
5. **Simple fallback** — for spells without a matching handler

### What stays where:
- **SpellActionHandler** becomes a thin adapter that resolves tabletop-specific context (actor, roster, characters) and delegates to SpellResolutionService
- **AiActionExecutor.executeCastSpell()** adds Counterspell detection then delegates to SpellResolutionService for actual spell effects
- **ActionService.castSpell()** stays as the cosmetic action economy step (called by delivery handlers)
- **Delivery handlers** stay as-is — SpellResolutionService uses them

## Changes

### SpellSystem
#### [File: NEW — `application/services/combat/spell-resolution-service.ts`]
- [ ] Create `SpellResolutionService` class that handles:
  - `resolveSpell(params)` — main entry point: spell lookup + slot spending + concentration + delivery dispatch
  - Accepts deps bag matching SpellActionHandler's needs (combatRepo, diceRoller, monsters, npcs, actions, etc.)
  - Returns `ActionParseResult` (same as SpellActionHandler.handleCastSpell)
- [ ] Extract spell lookup logic (find PreparedSpellDefinition from character sheet) into a reusable method
- [ ] Extract slot spending logic into a reusable method
- [ ] Extract concentration management logic into a reusable method
- [ ] Initialize delivery handlers (same set as SpellActionHandler currently creates)

#### [File: `application/services/combat/tabletop/spell-action-handler.ts`]
- [ ] Refactor to delegate to SpellResolutionService instead of inline logic
- [ ] Keep only the thin tabletop-specific adapter layer (resolveEncounterContext, etc.)

### CombatOrchestration
#### [File: `application/services/combat/tabletop/action-dispatcher.ts`]
- [ ] No changes needed — still calls SpellActionHandler which now delegates to SpellResolutionService

### AIBehavior
#### [File: `application/services/combat/ai/ai-action-executor.ts`]
- [ ] Update `executeCastSpell()` to use SpellResolutionService for spell effects after Counterspell resolution
- [ ] Pass character sheet context so SpellResolutionService can look up the spell

### Infrastructure
#### [File: `infrastructure/api/app.ts`]
- [ ] Wire SpellResolutionService into the dependency graph

## Cross-Flow Risk Checklist
- [x] Do changes in one flow break assumptions in another? — No, SpellActionHandler's public API stays the same
- [x] Does the pending action state machine still have valid transitions? — Yes, untouched
- [x] Is action economy preserved (1 action, 1 bonus, 1 reaction, 1 movement)? — Yes, ActionService.castSpell() stays as action economy step
- [x] Do both player AND AI paths handle the change? — Yes, that's the point
- [x] Are repo interfaces + memory-repos updated if entity shapes change? — N/A, no shape changes
- [x] Is `app.ts` registration updated if adding executors? — Yes, SpellResolutionService wiring
- [x] Are D&D 5e 2024 rules correct (not 2014)? — Yes, preserving existing rules logic

## Risks
- **Regression in tabletop spell flow**: Mitigated by keeping delivery handlers unchanged and running all E2E wizard/cleric/spell scenarios
- **AI spell effects now actually apply**: This is intentional — but may reveal test gaps. AI-cast spells will now do damage/healing/etc. Monitor for unexpected AI behavior in E2E tests.
- **SpellResolutionService needs encounter context**: Both paths need encounter + combatants. The service takes them as parameters.

## Test Plan
- [ ] Existing E2E scenarios must pass (wizard/cast, wizard/concentration, wizard/spell-slots, wizard/spell-attacks, wizard/counterspell, cleric/cure-wounds, core/bless-*, core/bane-*, core/cloud-of-daggers)
- [ ] Unit tests for SpellResolutionService: slot spending, concentration management
- [ ] Existing unit tests must pass (action-service.narrative.test, ai-action-executor.test)
- [ ] Typecheck clean
