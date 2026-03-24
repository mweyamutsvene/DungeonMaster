# Plan: Wave 5 — Testing & Polish
## Round: 2
## Status: COMPLETED
## Affected Flows: SpellSystem, AIBehavior, CombatRules, CombatOrchestration, EntityManagement

---

## Objective
Complete Wave 5 of the clean code audit: add unit tests for `SpellActionHandler` and `AiActionExecutor`, rewrite grapple/shove to D&D 5e 2024 rules (DC-based save replaces contested check), and close §10 cleanup items. §8.3 (MockAiDecisionMaker) is **already done** — skip.

---

## Changes

### SpellSystem — §8.1: SpellActionHandler Unit Tests
#### File: `packages/game-server/src/application/services/combat/tabletop/spell-action-handler.test.ts` (NEW)
- [x] Use **direct instantiation** — `new SpellActionHandler(mockedDeps)` — NOT `buildApp + app.inject()` (unit test, not integration test)
- [x] Actual entry point: `handleCastSpell(sessionId, encounterId, actorId, castInfo, characters, roster)` (6 params — confirmed by SME)
- [x] Mock `DiceRoller`, `ISpellRepository`, combat repos, `TabletopEventEmitter` (as `Partial<...> as any`). `SavingThrowResolver` constructed internally from `diceRoller` — mock dice, not resolver.
- [x] Use `MemoryCombatRepository`, `MemoryCharacterRepository`, `MemoryMonsterRepository` from `infrastructure/testing/memory-repos.ts`
- [x] **Test coverage** — one test per delivery handler:
  - Direct-damage spell (e.g., Magic Missile — no save, applied directly)
  - SpellAttack delivery (e.g., Fire Bolt — returns `REQUEST_ROLL` pending action)
  - DC-based save spell (e.g., Burning Hands — target makes DEX save; half damage on success)
  - Healing spell (e.g., Cure Wounds)
  - BuffDebuff delivery (e.g., Bless — applies effects array `[...]`)
  - Zone delivery (e.g., zone AOE spell)
  - Concentration mechanic: casting second concentration spell drops first
  - Spell slot spending: error when no slots available
  - `canHandle()` fallthrough: no delivery handler matches (not "unknown delivery type") → graceful response, no crash

---

### AIBehavior — §8.2: AiActionExecutor Unit Tests
#### File: `packages/game-server/src/application/services/combat/ai/ai-action-executor.test.ts` (NEW)
- [x] Test `buildActorRef()` — pure function, no mocks needed (×4: Monster/Character/NPC/null)
- [x] Test `execute()` economy guard: actor with used action → returns "no action available" result
- [x] Test `executeAttack()` missing target → graceful error result (no crash)
- [x] Test target not found in roster → graceful error result
- [x] Test unknown action type → graceful error result
- [x] Stub `combatantResolver` and `diceRoller`; leave pathfinding/movement to E2E

#### File: `packages/game-server/src/infrastructure/llm/mocks/index.ts`
- [x] **SKIP §8.3** — `MockAiDecisionMaker` already fully implemented (confirmed by SME)

---

### AIBehavior — §10: LLM Context Duplication Fix
#### File: `packages/game-server/src/infrastructure/llm/ai-decision-maker.ts`
- [x] Remove battlefield de-duplication using: `const { battlefield: _bf, ...contextWithoutBattlefield } = input.context;`
- [x] Pass `contextWithoutBattlefield` to the `"combat-state"` PromptBuilder section (NOT `input.context`)
- [x] **Do NOT** use `{ grid, legend, ...rest }` — `grid`/`legend` are nested under `context.battlefield`, not top-level on `AiCombatContext` (TypeScript strict mode would reject this)
- [x] Remove/update the existing `// NOTE:` comment to mark it resolved

---

### CombatRules — §4.1: Grapple/Shove 2024 Rules Rewrite
#### File: `packages/game-server/src/domain/rules/grapple-shove.ts`
- [x] Replace 2014 contested check with 2024 DC-based saving throw:
  - Domain function receives `attackerStrMod`, `attackerProfBonus`, `targetStrMod`, `targetDexMod` (flat params, not entity objects). Domain picks the better target ability and records `abilityUsed`.
  - **Attacker's DC**: `8 + attackerStrMod + attackerProfBonus`
  - **Target's save**: `Math.max(targetStrMod, targetDexMod)` + d20; records `abilityUsed: "strength" | "dexterity"`
  - `grappleTarget(attackerStrMod, attackerProfBonus, targetStrMod, targetDexMod, diceRoller)` → on fail: target gains Grappled condition
  - `shoveTarget(attackerStrMod, attackerProfBonus, targetStrMod, targetDexMod, shoveType, diceRoller)` → on fail: prone or pushed 5ft
  - `escapeGrapple(grapplerStrMod, grapplerProfBonus, escapeeStrMod, escapeeAcrobMod, diceRoller)` → DC = 8 + grapplerStrMod + grapplerProfBonus; escapee rolls max(escapeeStrMod, escapeeAcrobMod)
- [x] **Remove `attackerRoll` from return type** — attacker does not roll in 2024
- [x] New return shape: `{ success: boolean; dc: number; saveRoll: number; total: number; abilityUsed: "strength" | "dexterity" | "athletics" | "acrobatics" }`
- [x] Update JSDoc to reference 2024 PHB rules
- [x] Ensure `GrappleResult` / `ShoveResult` type exports are updated

#### File: `packages/game-server/src/application/services/combat/tabletop/grapple-handlers.ts`
- [x] Update grapple/shove message formatting to use new return shape (remove `attackerRoll` references)
- [x] Display in combat log: "Sets Grapple DC {dc}. Target rolls {abilityUsed}: {saveRoll} vs DC {dc}"

#### File: `packages/game-server/src/application/services/combat/action-service.ts`
- [x] Wire `proficiencyBonus` from `getCombatStats()` into ALL grapple/shove/escapeGrapple calls
- [x] Update all callers to use new return shape (remove `attackerRoll`/`grapplerRoll`, use `dc`/`saveRoll`/`abilityUsed`)
- [x] Add TODO: "escapeGrapple uses raw ability mod without skill proficiency (Athletics/Acrobatics). Fix when getCombatStats() exposes per-skill proficiency."
- [x] Add TODO: "Grapple uses spendAction() which marks the full action used. 2024 PHB: grapple uses one attack on a multi-attack action. Fix when multi-attack interleaving is implemented."

#### File: `packages/game-server/src/application/services/combat/ai/ai-action-executor.ts`
- [x] Update `executeGrapple()`: replace `attackerRoll`/`grapplerRoll` field references with `dc`/`saveRoll`/`abilityUsed` in result consumption and AI log messages
- [x] Update `executeEscapeGrapple()`: same update

#### Files fixed for TypeScript compile errors after return-type change:
- [x] `grapple-shove.test.ts` — rewritten with 14 tests for new DC-based API
- [x] `ai-actions.llm.test.ts` — updated `attackerRoll`/`grapplerRoll` references
- [x] `character-abilities.llm.test.ts` — updated same

---

### CombatRules — §10: Minor Cleanups
#### File: `packages/game-server/src/domain/rules/ability-checks.ts` + `domain/combat/attack-resolver.ts`
- [ ] Remove duplicate `D20ModeProvider` local type definition from whichever file has the copy; import from the canonical source (find which one is the authority) — **DEFERRED** (low risk, both define identical type)

#### File: `packages/game-server/src/domain/rules/index.ts`
- [x] Add missing barrel exports: `grapple-shove`, `opportunity-attack` + 9 more (`movement`, `pathfinding`, `death-saves`, `search-use-object`, `battlefield-renderer`, `combat-map`, `weapon-mastery`, `martial-arts-die`)

---

### CombatOrchestration — §10: ActionParseResult Type Narrowing (Tier A only)
#### File: `packages/game-server/src/application/services/combat/tabletop/tabletop-types.ts`
- [x] Ran grep to discover all actual `type:` values — found 7 unique values (no `ATTACK` — that's `TabletopPendingAction.type`, not `ActionParseResult.type`)
- [x] Added `ACTION_RESULT_TYPES` as-const array with 7 members: `"move"`, `"move_towards"`, `"MOVE_COMPLETE"`, `"JUMP_COMPLETE"`, `"REACTION_CHECK"`, `"REQUEST_ROLL"`, `"SIMPLE_ACTION_COMPLETE"`
- [x] Added `ActionResultType` derived type
- [x] Narrowed `ActionParseResult.type: string` to `ActionParseResult.type: ActionResultType`
- [x] **Deferred Tier B** (SSE event type narrowing on `IEventRepository.append()`) — entity services emit non-combat strings that would break. Left as `string`.

---

### EntityManagement — §10: Cleanups
#### File: `packages/game-server/src/application/services/combat/helpers/creature-hydration.ts`
- [x] Remove unused `EquippedItems` import (line ~12)
- [x] Check for any other stale imports introduced by Wave 4.20 — none found

#### File: `packages/game-server/src/application/repositories/pending-action-repository.ts`
- [x] Move `InMemoryPendingActionRepository` class OUT of this file INTO `packages/game-server/src/infrastructure/testing/memory-repos.ts`
- [x] Interface is named `PendingActionRepository` (no `I` prefix) — already exported from `application/repositories/index.ts`
- [x] Updated ALL 4 import sites:
  - `packages/game-server/src/infrastructure/api/app.ts`
  - `packages/game-server/src/application/services/combat/ai/ai-actions.llm.test.ts`
  - `packages/game-server/src/application/services/combat/abilities/character-abilities.llm.test.ts`
  - `packages/game-server/src/application/repositories/pending-action-repository.test.ts`

---

## Cross-Flow Risk Checklist
- [x] §4.1 return type change (`attackerRoll` removed) — ALL callers covered: `grapple-handlers.ts`, `action-service.ts`, `ai-action-executor.ts` (~lines 1430–1565), 3 test files
- [x] `ai-action-executor.ts` explicitly in §4.1 change list with line ranges called out
- [x] `action-service.ts` wires `proficiencyBonus` (confirmed available from `getCombatStats()`)
- [x] Pending action state machine: grapple resolves synchronously — no new pending states needed
- [x] Action economy: `spendAction()` unchanged; multi-attack gap documented as TODO
- [x] LLM battlefield dedup: correct destructure `{ battlefield: _bf, ...contextWithoutBattlefield }` (not `{ grid, legend, ...rest }`)
- [x] `ACTION_RESULT_TYPES`: implementer must grep `type: "` to discover all real values before writing const; exclude phantom `CLASS_ABILITY`, `INITIATIVE`; Tier B SSE deferred
- [x] Tier B SSE events deferred — entity services emit non-combat strings that would break narrowing
- [x] `PendingActionRepository` interface name is `PendingActionRepository` (no `I` prefix)
- [x] All 4 import sites for the PendingActionRepository move are listed
- [x] Nat-20/1 on saves: 2024 PHB — nat-20/1 does NOT auto-succeed/fail saving throws (only attacks). Document as TODO if `SavingThrowResolver` incorrectly applies this.

---

## Known Limitations (document as TODOs, do NOT fix in Wave 5)
1. **Grapple + multi-attack**: grapple uses `spendAction()` — Fighter can't grapple + attack in same turn. Fix when multi-attack interleaving is implemented.
2. **escapeGrapple skill proficiency**: escapee roll uses raw ability modifier without Athletics/Acrobatics proficiency. Fix when `getCombatStats()` exposes per-skill proficiency.
3. **Tier B SSE event types**: `IEventRepository.append()` stays `string`. Non-combat events block narrowing.
4. **§4.2 nat-20/1 on saves**: Verify `SavingThrowResolver` does NOT apply nat-20 auto-success/nat-1 auto-fail (2024: nat-20/1 only applies to attack rolls, not saves). File as bug if incorrect.

## Risks
- **§4.1 is the most disruptive** — 5 source files + 3 test files updated. TypeScript will surface all breakage. CombatRules-Implementer must fix all callers atomically.
- **SpellActionHandler circular deps**: if direct instantiation fails due to circular deps, fallback to `buildApp + app.inject()` but note the performance tradeoff.

---

## Test Plan
- [x] `spell-action-handler.test.ts` — 9 tests (direct instantiation; one per delivery handler + concentration + slots + fallthrough)
- [x] `ai-action-executor.test.ts` — 9 tests (buildActorRef ×4, economy guard ×2, missing target, target not found, unknown action)
- [x] Update existing grapple E2E scenarios — grapple scenarios pass with 2024 rules (E2E happy-path verified)
- [x] Fix `grapple-shove.test.ts`, `ai-actions.llm.test.ts`, `character-abilities.llm.test.ts` compile errors from §4.1

---

## Implementation Order (dependency-safe)
1. **Parallel Batch A** (fully independent):
   - CombatRules-Implementer: §4.1 grapple/shove rewrite + §10 CombatRules cleanups
   - EntityManagement-Implementer: §10 EntityManagement cleanups
   - AIBehavior-Implementer: §10 LLM context dedup
   - CombatOrchestration-Implementer: §10 ActionParseResult type narrowing (Tier A only)
2. **After Batch A typecheck + tests pass — Parallel Batch B**:
   - VitestWriter: `spell-action-handler.test.ts`
   - VitestWriter: `ai-action-executor.test.ts`
   - E2EScenarioWriter: update grapple E2E scenarios for 2024 rules

---

## SME Approval (Round 2)
- [x] SpellSystem-SME — APPROVED
- [x] AIBehavior-SME — APPROVED
- [x] CombatRules-SME — APPROVED
- [x] CombatOrchestration-SME — APPROVED
- [x] EntityManagement-SME — APPROVED

---

## Completion Summary
**Final verification**: 581 tests pass, 0 failed, 36 skipped, 65 test files. Typecheck clean. E2E happy-path passes.

**Deferred items** (documented as TODOs, not in scope):
1. D20ModeProvider dedup (low risk — identical types in two files)
2. Grapple + multi-attack economy interleaving
3. escapeGrapple skill proficiency (Athletics/Acrobatics)
4. Tier B SSE event type narrowing
5. §4.2 nat-20/1 on saves verification
