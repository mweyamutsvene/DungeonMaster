# Plan: Deferred Items — Grapple Escape, AI Potion Use, Hit Dice, Rest Interruption

## Status: COMPLETE (Phases 1-3), DEFERRED (Phase 4)

## TL;DR
Five deferred features from the AI-actions and rest-mechanics plans. Three are low-medium effort (grapple escape, AI potion use, hit dice spending); one is large (rest interruption). Recommended approach: tackle in order of effort — grapple escape first (mirrors existing grapple pattern), then AI potion use (bridge to existing item-use handler), then hit dice (new domain model), deferring rest interruption.

## Phase 1: Grapple Escape (Low effort)

**What:** Allow grappled creatures to spend their action to attempt escaping a grapple via contested check. D&D 5e 2024 rule: target uses action, Athletics or Acrobatics vs grappler's Athletics.

**Steps:**
1. [x] Add `tryParseEscapeGrappleText()` to `combat-text-parser.ts` — match patterns like `"escape grapple"`, `"break free"`, `"break grapple"` *(parallel with 2)*
2. [x] Add `escapeGrapple()` method to `action-service.ts` — contested check using same `resolveGrapple()` from `grapple-shove.ts`, remove Grappled condition on success using `removeCondition()` *(parallel with 1)*
3. [x] Add `handleEscapeGrappleAction()` to `action-dispatcher.ts` — route parsed text to `action-service.escapeGrapple()` *(depends on 1, 2)*
4. [x] Add `"escapeGrapple"` to `AiDecision.action` union in `ai-types.ts` *(parallel with 5)*
5. [x] Add `executeEscapeGrapple()` to `ai-action-executor.ts` — AI bridge to `action-service.escapeGrapple()` *(parallel with 4)*
6. [x] Update AI system prompt in `ai-decision-maker.ts` — add `escapeGrapple` to available actions with description *(depends on 4)*
7. [x] Add mock behavior for `escapeGrapple` in `MockAiDecisionMaker` *(depends on 4)*
8. [x] Create E2E scenario `core/grapple-escape.json` — player grapples monster, monster attempts escape *(depends on 3)*

**Relevant files:**
- `packages/game-server/src/application/services/combat/tabletop/combat-text-parser.ts` — add `tryParseEscapeGrappleText()` (mirror `tryParseGrappleText()` at L388)
- `packages/game-server/src/application/services/combat/action-service.ts` — add `escapeGrapple()` mirroring `grapple()` at L1161 but with reversed contest + `removeCondition()` on success
- `packages/game-server/src/application/services/combat/tabletop/action-dispatcher.ts` — add routing + `handleEscapeGrappleAction()` (mirror `handleGrappleAction()` at L1340)
- `packages/game-server/src/domain/rules/grapple-shove.ts` — reuse `resolveGrapple()` (same contested check)
- `packages/game-server/src/application/services/combat/ai/ai-types.ts` — add `"escapeGrapple"` to action union
- `packages/game-server/src/application/services/combat/ai/ai-action-executor.ts` — add `executeEscapeGrapple()` method
- `packages/game-server/src/infrastructure/llm/ai-decision-maker.ts` — update system prompt
- `packages/game-server/src/infrastructure/llm/mocks/index.ts` — add mock behavior
- `packages/game-server/scripts/test-harness/scenario-runner.ts` — add `"escapeGrapple"` to behavior types

**Verification:**
1. Run `pnpm -C packages/game-server typecheck`
2. Run `pnpm -C packages/game-server test` — all unit tests pass
3. Run E2E scenario `core/grapple-escape.json` (grappled creature escapes)
4. Run `pnpm -C packages/game-server test:e2e:combat:mock -- --all` — 149+ pass, 0 fail

---

## Phase 2: AI Potion Use (Low-Medium effort)

**What:** Wire AI `useObject` decision to the existing `handleUseItemAction()` potion handler. Currently the AI gets "no usable objects" but the player-side potion use infrastructure already exists (parser, handler, inventory consumption, healing formulas).

**Steps:**
1. [x] In `ai-action-executor.ts`, replace the `useObject` stub with logic that: queries combatant inventory, finds healing potions, calls `actionService` with the potion name *(depends on nothing)*
2. [x] Add `usePotion()` or route through existing `handleUseItemAction()` pattern in `action-service.ts` — may need a new method that takes combatant ID + item name and performs: inventory lookup → potion formula → healing roll → HP update → inventory consumption → action economy spend *(depends on step 1 design)*
3. [x] Update AI system prompt — re-add `useObject` as available action with specific guidance: "use only when you have healing potions and HP is low" *(depends on 1)*
4. [x] Add mock behavior for `useObject` potion use in `MockAiDecisionMaker` *(parallel with step 3)*
5. [x] Create E2E scenario `core/ai-use-potion.json` — monster/NPC with potion in inventory uses it when low HP *(depends on 2)*
6. [x] Add inventory initialization for monsters/NPCs from `statBlock.inventory` in `roll-state-machine.ts`

**Relevant files:**
- `packages/game-server/src/application/services/combat/ai/ai-action-executor.ts` — replace `useObject` stub (L247) with inventory-aware potion logic
- `packages/game-server/src/application/services/combat/action-service.ts` — possibly add `useItem(sessionId, input)` method (or reuse tabletop handler pattern)
- `packages/game-server/src/application/services/combat/tabletop/action-dispatcher.ts` — existing `handleUseItemAction()` at L2876 as reference implementation
- `packages/game-server/src/domain/entities/items/magic-item-catalog.ts` — `POTION_HEALING_FORMULAS` (4 potions defined)
- `packages/game-server/src/domain/entities/items/inventory.ts` — `useConsumableItem()`, `findInventoryItem()`, `getInventory()`
- `packages/game-server/src/infrastructure/llm/ai-decision-maker.ts` — update system prompt

**Decisions:**
- AI should only attempt `useObject` when combatant inventory actually contains usable items (potions). The executor should check inventory first.
- If no potions found, return the existing graceful rejection.

**Verification:**
1. Run typecheck
2. E2E scenario: AI creature with Potion of Healing at low HP drinks it
3. Run full E2E suite — all pass

---

## Phase 3: Hit Dice Spending on Short Rest (Medium effort)

**What:** D&D 5e 2024: during a short rest, a character can spend Hit Dice to recover HP. Roll hit die + CON modifier per die spent (minimum 1 HP recovered per die). On long rest, recover half your total Hit Dice (rounded down, minimum 1).

**Steps:**
1. [x] Add `hitDiceRemaining` field to character sheet data model — initialize as `level` (total HD = character level) *(no dependencies)*
2. [x] Add `hitDie` to character sheet from class definition during character creation/import — needed so rest logic knows which die size *(parallel with 1)*
3. [x] Add `spendHitDice()` pure function to `domain/rules/rest.ts` — input: hitDiceRemaining, hitDie, conModifier, count; output: { hpRecovered, hitDiceRemaining, rolls[] } *(depends on 1)*
4. [x] Add `recoverHitDice()` pure function to `domain/rules/rest.ts` — input: hitDiceRemaining, totalHitDice; output: hitDiceRemaining after long rest recovery (half rounded down, min 1) *(parallel with 3)*
5. [x] Extend `CharacterService.takeSessionRest()` to accept optional `hitDiceToSpend` parameter — on short rest, calls `spendHitDice()` and applies HP healing; on long rest, calls `recoverHitDice()` *(depends on 3, 4)*
6. [x] Extend API request body for `POST /sessions/:id/rest` — add optional `hitDiceSpending?: Record<string, number>` (characterId → dice count) *(depends on 5)*
7. [x] Add domain unit tests for `spendHitDice()` and `recoverHitDice()` *(parallel with 3, 4)*
8. [x] Update CLI `rest short` command to prompt for hit dice spending *(depends on 6)*
9. [ ] Create E2E scenarios: short rest with hit dice spending, long rest half-HD recovery *(depends on 6)*
10. [x] Update SESSION_API_REFERENCE.md *(depends on 6)*

**Relevant files:**
- `packages/game-server/src/domain/rules/rest.ts` — add `spendHitDice()` and `recoverHitDice()`
- `packages/game-server/src/domain/rules/rest.test.ts` — add unit tests
- `packages/game-server/src/application/services/entities/character-service.ts` — extend `takeSessionRest()`
- `packages/game-server/src/infrastructure/api/routes/sessions/session-characters.ts` — extend request body
- `packages/game-server/src/domain/entities/classes/class-definition.ts` — `HitDie` type already exists (6|8|10|12)
- `packages/game-server/src/domain/entities/classes/registry.ts` — `getClassDefinition()` to look up hitDie
- `packages/player-cli/src/combat-repl.ts` — extend `handleRestCommand()`
- `packages/game-server/SESSION_API_REFERENCE.md` — update rest endpoint docs

**Decisions:**
- Hit Dice tracking: use `hitDiceRemaining` on character sheet (not as ResourcePool) — simpler; HD are not class resource pools, they're a character-level stat
- Server rolls hit dice deterministically (like all other rolls); no player-roll flow for HD
- `HitDie` type already exists in `class-definition.ts` as `6 | 8 | 10 | 12`

**Verification:**
1. Unit tests: `spendHitDice()` rolls correct die + CON mod, `recoverHitDice()` returns half rounded down (min 1)
2. E2E: short rest with HD spending heals character
3. E2E: long rest recovers half HD
4. Full E2E suite passes

---

## Phase 4: Rest Interruption — DEFER

**What:** D&D 5e 2024: rest can be interrupted by combat, casting non-cantrip spells, or taking damage. Interrupted short rest grants no recovery. Long rest interrupted after <1 hour grants no benefit; after 1+ hours grants partial benefit (DM discretion).

**Recommendation:** Defer. Requires session-level state tracking ("in rest" flag), timer/clock concept, combat-start hooks that check rest state, and partial recovery rules. High complexity for low gameplay impact in the current system (rest is applied instantly, no time tracking exists).

---

## Further Considerations

1. **Grapple escape: who applied it?** `ActiveCondition` has a `source` string field but no `appliedBy` combatant ID. Escape doesn't need this — just remove the Grappled condition. However, if we ever want "grappler also loses grapple state" or drag mechanics, we'd need to store the grappler's ID. **Recommendation:** Add `source: grapplerCombatantId` when applying grapple for future use, but escape just removes the condition regardless.

2. **AI potion use: action economy.** In D&D 5e 2024, drinking a potion costs an action. The existing `handleUseItemAction()` already enforces `actionSpent` — the AI executor should respect this (only attempt potion before spending action).

3. **Hit Dice: multiclass.** In 5e, different classes contribute different-sized Hit Dice. Current system is single-class only. The `hitDiceRemaining` field should be sufficient even for future multiclass (just track total remaining, die type comes from primary class for now). **Recommendation:** Keep it simple — single die type for now.

---

## Completion Notes

### Phase 1: Grapple Escape — COMPLETE
- Parser: `tryParseEscapeGrappleText()` added with regex `/\b(?:escape\s+grapple|break\s+(?:free|grapple))\b/`
- Service: `escapeGrapple()` added to `action-service.ts`, reuses `resolveGrapple()` with reversed roles
- Also updated `grapple()` to store `source: actorState.id` on the Grappled condition for escape lookup
- AI: Full pipeline (types → executor → system prompt → mock behavior)
- E2E: `core/grapple-escape.json` — 13/13 steps passing

### Phase 2: AI Potion Use — COMPLETE
- Executor: `executeUseObject()` in `ai-action-executor.ts` — finds healing potions in combatant inventory, rolls dice, applies healing, consumes item, spends action
- Monster/NPC inventory: Added `statBlock.inventory` initialization in `roll-state-machine.ts` for both monsters and NPCs (mirrors character sheet inventory pattern)
- Mock: `usePotion` behavior returns `action: "useObject"` with `endTurn: true`
- E2E: `core/ai-use-potion.json` — 11/11 steps passing (monster drinks 2 potions across 2 turns)

### Phase 3: Hit Dice Spending — COMPLETE
- Domain: `spendHitDice()` and `recoverHitDice()` pure functions in `rest.ts`
- Unit tests: 10 new tests (5 for spend, 5 for recover) — all passing 
- Service: `CharacterService.takeSessionRest()` extended with optional `hitDiceSpending` param
  - Short rest: spends HD using DiceRoller, recovers HP (roll + CON mod, min 1 per die)
  - Long rest: recovers half total HD (rounded down, min 1) in addition to existing full HP restore
- API: `POST /sessions/:id/rest` body now accepts optional `hitDiceSpending: { [charId]: count }`
- CLI: `rest short` now prompts for hit dice spending (shows remaining/total)
- Docs: SESSION_API_REFERENCE.md updated with new request/response fields
- DiceRoller passed to CharacterService from app.ts
- `hitDiceRemaining` defaults to `level` (full) when not previously tracked on character sheet

### Phase 4: Rest Interruption — DEFERRED (as planned)

### Assumptions
- Hit Dice: single die type from primary class (no multiclass HD tracking yet)
- `hitDiceRemaining` stored on character sheet JSON blob, not as a ResourcePool
- Server rolls hit dice deterministically — no player-roll flow for HD
- E2E scenarios for hit dice rest not created (rest is not combat E2E — tested via unit tests)

### Test Results
- Unit tests: 585 passed (20 in rest.test.ts including 10 new)
- E2E scenarios: 151 passed, 0 failed (up from 149 baseline)
