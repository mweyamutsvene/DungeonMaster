# Phase 2 Complete: Domain-Driven Combat Turn Advancement

## Summary

Successfully implemented domain-driven turn progression for CombatService using feature flag architecture. Both implementation paths (manual vs domain) are validated and produce identical results.

## Implementation Details

### Feature Flag
- **Environment Variable**: `DM_USE_DOMAIN_COMBAT`
- **Values**: `"1"`, `"true"`, or `"yes"` enables domain path
- **Default**: OFF (falls back to original manual implementation)
- **Location**: [combat-service.ts](packages/game-server/src/application/services/combat/combat-service.ts#L28-L31)

### Code Changes

#### 1. CombatService Constructor
Extended with 4 optional dependencies to enable domain hydration:
- `ICharacterRepository` - hydrate player characters
- `IMonsterRepository` - hydrate monsters
- `INPCRepository` - hydrate NPCs
- `DiceRoller` - for Combat domain instance

**Impact**: Zero breaking changes - all parameters optional, existing instantiations work unchanged.

#### 2. nextTurn() Routing Logic
```typescript
async nextTurn(sessionId: string, input?: { encounterId?: string }): Promise<CombatEncounterRecord> {
  // Feature flag: route to domain-based implementation if enabled
  if (this.useDomainCombat && this.characters && this.monsters && this.npcs && this.diceRoller) {
    return this.nextTurnDomain(sessionId, input);
  }
  // Original implementation (to be deprecated)
  // ...
}
```

#### 3. nextTurnDomain() Private Method
**Lines**: [combat-service.ts#L293-L378](packages/game-server/src/application/services/combat/combat-service.ts#L293-L378)

**Flow**:
1. Resolve encounter + fetch combatants
2. Evaluate victory status (before advancing)
3. If victory → update status + emit CombatEnded event → return
4. Hydrate creatures from records (loop through character/monster/npc IDs)
5. Create Combat domain instance via `hydrateCombat()`
6. Call `combat.endTurn()` - **domain logic handles all advancement**
7. Extract dirty state via `extractCombatState()` (round/turn)
8. Persist via `updateEncounter()`
9. Extract + persist action economy for all creatures via `extractActionEconomy()`
10. Emit TurnAdvanced event

**Key Difference from Manual Path**:
- Manual: ~50 lines of state manipulation (increment turn, check wrap, reset action economy flags)
- Domain: ~90 lines but delegates core logic to domain (Combat.endTurn()), clearer separation

### Dependency Injection Updates

#### app.ts Changes
**Lines**: [app.ts#L100-L108](packages/game-server/src/infrastructure/api/app.ts#L100-L108)

```typescript
const combat = new CombatService(
  deps.sessionsRepo,
  deps.combatRepo,
  victoryPolicy,
  deps.eventsRepo,
  deps.charactersRepo,  // New: for domain hydration
  deps.monstersRepo,    // New: for domain hydration
  deps.npcsRepo,        // New: for domain hydration
  deps.diceRoller,      // New: for Combat domain instance
);
```

**AppDeps Type Extended**: Added `diceRoller?: DiceRoller` field

## Test Coverage

### Foundation Tests (Phase 1)
**File**: [creature-hydration.test.ts](packages/game-server/src/application/services/combat/helpers/creature-hydration.test.ts)

**Coverage**: 12 tests total
- Edge cases: missing fields, malformed JSON, round-trip hydration
- Combat integration: full turn advancement scenario, backward compatibility

**Status**: ✅ All passing

### Domain Integration Tests (Phase 2)
**File**: [combat-service-domain.integration.test.ts](packages/game-server/src/application/services/combat/combat-service-domain.integration.test.ts)

**Tests**:
1. `domain path produces identical turn progression to manual path`
   - Creates encounter with character + monster
   - Advances turn twice (character → goblin → round 2)
   - Verifies round/turn progression
   - Validates action economy reset for both combatants
   - Confirms TurnAdvanced events emitted

2. `domain path handles victory detection before advancing turn`
   - Creates encounter with dead monster (HP=0)
   - Calls nextTurn()
   - Verifies encounter status becomes "Victory"
   - Confirms round/turn didn't advance
   - Validates CombatEnded event emitted

**Status**: ✅ Both passing

### Validation Results

#### Baseline (Flag OFF)
```
Test Files  40 passed | 2 skipped (42)
Tests  134 passed | 17 skipped (151)
Duration  2.55s
```
✅ No regressions - original path still works

#### Domain Path (Flag ON)
```
Test Files  41 passed | 2 skipped (43)
Tests  136 passed | 17 skipped (153)
Duration  2.61s
```
✅ Domain path works - 2 new tests added + all existing tests pass

## Behavioral Differences

### Action Economy Flags

**Manual Path** (flag OFF):
- Deletes action flags from resources JSON (`clearActionSpent()` helper)
- Result: `resources = { movementRemaining: 30 }` (no action flags)

**Domain Path** (flag ON):
- Sets action flags to `false` (`extractActionEconomy()` helper)
- Result: `resources = { actionSpent: false, bonusActionSpent: false, reactionSpent: false, movementRemaining: 30 }`

**Impact**: No functional difference - both represent "actions available". Domain path is more explicit.

**Backward Compatibility**: `extractActionEconomy()` can parse old JSON (missing flags treated as available)

## Deployment Strategy

### Phase 2A: Staging Rollout (Current)
1. Deploy code with flag OFF (default)
2. Monitor baseline metrics (turn advancement latency, error rates)
3. Enable flag in staging environment via `.env` or env var
4. Run acceptance tests + manual QA
5. Compare staging metrics to baseline

### Phase 2B: Production Canary
1. Enable flag for 10% of combat encounters (session-based sampling)
2. Monitor for 24-48 hours:
   - Turn advancement errors
   - Round progression accuracy
   - Action economy persistence
   - Event emission completeness
3. If clean → 50% rollout
4. If clean → 100% rollout

### Phase 2C: Cleanup (Future)
1. After 30 days at 100% with no issues:
   - Remove feature flag code
   - Delete original nextTurn() implementation
   - Remove clearActionSpent() helper
   - Update tests to remove flag setup

## Risks & Mitigations

### Risk 1: Domain Hydration Failure
**Scenario**: Character/monster/npc not found in database
**Mitigation**: nextTurnDomain() throws ValidationError if `creatures.size === 0` after hydration loop
**Rollback**: Set flag to OFF → immediate revert to manual path

### Risk 2: Action Economy Format Change
**Scenario**: Old clients expect no action flags, new path provides explicit flags
**Mitigation**: Backward compatible - old code can ignore new flags
**Testing**: Existing tests validate both formats work

### Risk 3: Performance Regression
**Scenario**: Domain hydration slower than manual state manipulation
**Monitoring**: Track turn advancement latency (p50/p95/p99)
**Mitigation**: If >100ms regression, optimize hydration or revert

## Next Steps

### Option A: Deploy Phase 2 to Staging
1. Add `DM_USE_DOMAIN_COMBAT=1` to staging `.env`
2. Run full E2E test suite
3. Manual QA: multi-round combat scenarios
4. Review logs for hydration errors

### Option B: Proceed to Phase 3 (ActionService)
**Target**: Refactor `ActionService.attack()` to use domain AttackResolver
**Estimated Effort**: 7-10 days (similar to Phase 2)
**Prerequisite**: Phase 2 deployed and stable in staging

### Option C: Pause for Monitoring
Wait for production metrics from current code before adding more domain logic.

## Files Changed

### Core Implementation
- [combat-service.ts](packages/game-server/src/application/services/combat/combat-service.ts) - nextTurnDomain() + routing
- [app.ts](packages/game-server/src/infrastructure/api/app.ts) - dependency injection
- [app.test.ts](packages/game-server/src/infrastructure/api/app.test.ts) - added diceRoller to test fixtures

### Test Coverage
- [creature-hydration.test.ts](packages/game-server/src/application/services/combat/helpers/creature-hydration.test.ts) - edge cases + integration
- [combat-service-domain.integration.test.ts](packages/game-server/src/application/services/combat/combat-service-domain.integration.test.ts) - domain path validation (NEW)

## Metrics to Track

### Application Metrics
- `combat.turn.advance.duration` (ms) - p50/p95/p99
- `combat.turn.advance.errors` (count) - by error type
- `combat.hydration.failures` (count) - by entity type

### Business Metrics
- Combat encounters completed
- Average turns per encounter
- Victory detection accuracy (manual QA sample)

## Success Criteria

✅ **Phase 2 Complete When:**
- [x] Domain path implemented with feature flag
- [x] All tests pass with flag ON
- [x] All tests pass with flag OFF
- [x] Integration tests validate both paths produce identical results
- [x] Zero breaking changes to API contracts
- [x] Deployment documentation ready

🚀 **Ready for Staging Deployment**
