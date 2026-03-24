# Plan: Unimplemented AI Actions (Grapple, Hide, Search, UseObject, Jump)

> **STATUS: COMPLETED** — All phases implemented and verified.

## Problem

The AI system prompt in `ai-decision-maker.ts` tells the LLM about 14 available actions, including examples for some unimplemented ones. However, the `ai-action-executor.ts` only handles 8 of them. The remaining 5 fall through to a generic "not yet implemented" error response, which:

1. **Wastes AI turn steps** — the LLM picks an action it believes is valid, gets a failure, then must pick something else (up to 2 consecutive failures = forced turn end)
2. **Includes misleading examples** — the system prompt has grapple (example #4) and hide (example #5) that will always fail
3. **`jump` exists in `AiDecision` type** but isn't mentioned in the prompt OR handled in the executor

### Affected Actions (Pre-Implementation)

| Action | In Prompt | In Type | In Executor | Status |
|--------|-----------|---------|-------------|--------|
| `grapple` | ✅ + example | ✅ | ~~❌~~ ✅ | **IMPLEMENTED** |
| `hide` | ✅ + example | ✅ | ~~❌~~ ✅ | **IMPLEMENTED** |
| `search` | ✅ | ✅ | ~~❌~~ ✅ | **IMPLEMENTED** |
| `useObject` | ✅ | ✅ | ~~❌~~ ✅ | **Graceful rejection** (returns "no usable objects") |
| `jump` | ❌ | ~~✅~~ ❌ | ❌ | **Removed from type** (dead code) |

### Current Executor Behavior (ai-action-executor.ts ~line 238)

```typescript
default:
  return { ok: false, summary: `Action ${decision.action} not yet implemented` };
```

After 2 consecutive failures, the turn is force-ended by `AiTurnOrchestrator`.

---

## Analysis Per Action

### Grapple
- **D&D 5e 2024 Rules:** Replaces one attack. Contested check: attacker's Athletics vs target's Athletics or Acrobatics (target's choice). On success, target gets Grappled condition (speed 0, can't benefit from bonuses to speed). Grappler can drag/move the target.
- **Current State:** `shove` IS implemented in the executor (`handleShoveAction`). Grapple uses the same contested-check mechanic but applies a different condition.
- **Implementation Path:** Mirror the shove handler — contested Athletics check, apply Grappled condition on success.
- **Dependencies:** Need Grappled condition in the condition system; need escape mechanic (target uses action to attempt escape).

### Hide
- **D&D 5e 2024 Rules:** Requires cover or heavy obscurement. Make a Stealth check vs passive Perception of observers. On success, gain Invisible condition (for combat purposes: unseen attacker advantage, can't be targeted by spells requiring sight).
- **Current State:** Not implemented at all. Would need:
  - Cover/obscurement detection (does the map support this?)
  - Stealth check mechanic
  - Hidden/Invisible condition tracking
  - Attack advantage when attacking while hidden
  - Revealing on attack or loud action
- **Implementation Path:** Complex — requires map features (cover), new condition tracking, and stealth detection. **Recommend deferring** to a dedicated stealth/cover feature plan.
- **Interim Fix:** Remove from prompt examples and add a note: "hide requires cover and is not yet supported by the combat system."

### Search
- **D&D 5e 2024 Rules:** Make a Perception check to find hidden creatures or objects.
- **Current State:** Not implemented. Dependent on Hide being implemented first (nothing to search for if no creatures can hide).
- **Implementation Path:** Tied to Hide implementation. **Recommend deferring** alongside Hide.
- **Interim Fix:** Remove from available actions list in prompt OR keep it but have the executor return a meaningful message like "No hidden creatures detected."

### UseObject
- **D&D 5e 2024 Rules:** Interact with an object (open door, pull lever, drink potion, use item).
- **Current State:** Potions are handled through the inventory system. Other object interactions are not modeled.
- **Implementation Path:** Broad scope — would need an object/interactive model on the map. Potions specifically could be connected to the existing inventory system.
- **Interim Fix:** For potions, route through existing inventory/healing system. For other objects, return "no usable objects available."

### Jump
- **D&D 5e 2024 Rules:** Part of movement. Long jump = STR score feet (running) or half that (standing). High jump = 3 + STR mod feet (running). Used to cross gaps, obstacles.
- **Current State:** In the `AiDecision` type but not in the prompt or executor.
- **Implementation Path:** Would need terrain gaps/obstacles on the map. Not useful without map obstacle features.
- **Interim Fix:** Remove from `AiDecision` type (dead code) or keep as future placeholder.

---

## Proposed Solution

### Phase 1: Quick Wins — Honest Prompt + Grapple Implementation

- [x] **Step 1: Update system prompt to be honest about available actions**
- [x] **Step 2: Implement grapple in ai-action-executor.ts**
- [x] **Step 3: Implement grapple escape mechanic** (implemented in a later pass — see grapple-handlers.ts, ai-action-executor.ts, grapple-escape.json scenario)

### Phase 2: useObject — Potion Support

- [x] **Step 4: `useObject` graceful rejection** (returns "no usable objects" instead of generic error)

### Phase 3: Hide + Search — FULLY IMPLEMENTED

- [x] **Step 5: Hide + Search** — Discovered these were already fully implemented in `ActionService` (domain rules, stealth checks, Hidden condition, Search/reveal). Only the AI executor bridge was missing. Added `executeHide()` and `executeSearch()` methods.

### Phase 4: Jump — Removed

- [x] **Step 6: Jump** — Removed `jump` from `AiDecision` type (dead code, no terrain obstacles)

---

## Relevant Files

**Files modified:**
- `src/application/services/combat/ai/ai-action-executor.ts` — Added `executeGrapple()`, `executeHide()`, `executeSearch()` methods + `useObject` graceful rejection + improved unknown action message
- `src/application/services/combat/ai/ai-types.ts` — Removed `jump` from `AiDecision` type
- `src/infrastructure/llm/ai-decision-maker.ts` — Updated system prompt: honest hide/search/useObject descriptions, removed useObject from action list, updated hide example
- `src/infrastructure/llm/mocks/index.ts` — Added `grapple` and `hide` behaviors to `MockAiDecisionMaker`
- `scripts/test-harness/scenario-runner.ts` — Added `grapple` and `hide` to `ConfigureAiAction` behavior types
- `scripts/test-harness/combat-e2e.ts` — Updated behavior type union

**New E2E scenarios:**
- `scripts/test-harness/scenarios/core/ai-grapple.json` — Ogre grapples player via AI
- `scripts/test-harness/scenarios/core/ai-grapple-condition.json` — Ogre grapples weak character, asserts Grappled condition on player
- `scripts/test-harness/scenarios/core/ai-hide-search.json` — Goblin hides via AI, player searches

---

## Verification

1. ✅ `pnpm -C packages/game-server typecheck` passes
2. ✅ AI prompt no longer includes misleading examples for unimplemented actions
3. ✅ AI choosing `grapple` successfully resolves (contested check, Grappled condition applied or resisted)
4. ✅ AI choosing `hide` fully resolves (Stealth check, Hidden condition applied/rejected)
5. ✅ AI choosing `search` fully resolves (Perception check, finds/reveals Hidden creatures)
6. ✅ AI choosing `useObject` gets graceful rejection ("no usable objects")
7. ✅ `jump` removed from AiDecision type (dead code)
8. ✅ 509 unit tests pass, 0 failed
9. ✅ 141 E2E combat scenarios pass (138 existing + 3 new), 0 failed

---

## Implementation Notes

### Discovery: Hide + Search Already Existed
The plan originally assumed Hide and Search were unimplemented and should be deferred. However, during implementation, we discovered that `ActionService.hide()` and `ActionService.search()` were **already fully implemented** in the domain layer — including stealth checks, Hidden condition tracking, and Search reveal mechanics. Only the AI executor bridge was missing. All three (grapple, hide, search) were added to `AiActionExecutor` in one pass.

### useObject Decision
Rather than routing `useObject` to the potion/inventory system (which would require significant work to map LLM-chosen item names to inventory items), we opted for a graceful rejection message that guides the LLM to use other actions instead. The potion system can be connected later if needed.

### Grapple Escape
The grapple escape mechanic (target using action to contest and break free) was not implemented in this pass. The Grappled condition's `cannotMove: true` effect already prevents movement. Escape would require a new action type ("escapeGrapple") which can be added separately.
