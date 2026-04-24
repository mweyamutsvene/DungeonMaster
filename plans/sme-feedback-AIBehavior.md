# SME Feedback — AIBehavior — Round 1
## Verdict: NEEDS_WORK

## Issues

1. **Incomplete `hasPotions` removal — two consumer sites missing from plan.**
   The plan only lists `ai-types.ts`, `ai-context-builder.ts`, and `use-object-handler.ts`.
   Grep confirms two additional call sites that read `ctx.hasPotions` and will
   fail typecheck/behavior once the field is replaced:
   - `application/services/combat/ai/deterministic-ai.ts:375` — the **Step 4 gate**
     (`if (!actionSpent && ctx.hasPotions && combatant.hp.percentage < 40)`).
     This is the priority-preserving decision point. Plan D9 says "Existing
     UseObjectHandler decision branch stays at priority 5 (Step 4, HP < 40%)"
     but doesn't say what expression replaces `ctx.hasPotions` here.
     Must become `ctx.usableItems.some(i => i.effectKind === 'healing')`
     (or similar) — please spell this out. Otherwise priority semantics silently
     change from "healing-only gate at <40% HP" to "any-usable-item gate".
   - `infrastructure/llm/ai-decision-maker.ts:79` — the LLM-path
     `useObjectAvailable` pre-filter. Same field, same fix needed. Not in
     plan's "Changes by Flow".

2. **Test fixtures not enumerated.**
   `application/services/combat/ai/deterministic-ai.test.ts:53,306` and
   `infrastructure/llm/context-budget.test.ts:37` both construct
   `AiCombatContext` literals with `hasPotions`. Plan risk item #5 says "grep
   scenarios" but omits unit test fixtures. These will hard-fail TS compile —
   add them to the Changes list, don't rely on VitestWriter to discover them.

3. **LLM prompt snapshot regeneration not called out.**
   `hasPotions` appears in the AI decision prompt via `ai-decision-maker.ts`.
   Changing the field shape will churn `scripts/test-harness/llm-snapshots/`
   (see `SpyLlmProvider` / `test:llm:e2e:snapshot-update` per copilot-
   instructions). Add an explicit checkbox: "Run `pnpm -C packages/game-server
   test:llm:e2e:snapshot-update` and review diff".

4. **`canUseItems` default source is underspecified — regression risk for
   existing E2E scenarios.**
   Plan D9 says "default true for humanoids; false for beast-companion /
   familiar / most monsters unless opted in." But:
   - `ai-use-potion.json` and `ai-use-buff-potion.json` (the only two live
     AI-potion E2E scenarios) both use a `Wounded Goblin` / goblin with a
     raw `statBlock` that has **no `creatureType` field** in the scenario
     fixture. Goblin is humanoid RAW, but the plan doesn't specify where the
     type comes from (hydration? catalog lookup? statBlock default?).
   - If `canUseItems` defaults to `false` when creature type is absent/unknown,
     both scenarios regress silently (AI stops drinking potions → assertions
     fail). If it defaults to `true`, the "beast companion shouldn't drink"
     invariant is not enforced.
   - Required: plan must specify (a) the exact field consulted
     (`statBlock.type`? `monster.creatureType`?), (b) the default when
     unspecified (recommend: `true` to preserve existing scenarios), and
     (c) how the new "beast companion" E2E negative test *explicitly* sets
     `canUseItems: false` rather than relying on inference. Coordinate with
     CreatureHydration-SME.

5. **`actionCosts.use !== 'none'` filter is too permissive for non-consumables.**
   A `+1 longsword` is a magic item; if its `actionCosts.use` is left
   `undefined` (category default for weapons = `{equip:'free-object-
   interaction'}` with no `use` specified), `!== 'none'` includes it →
   `usableItems` surfaces a sword, and `UseObjectHandler` crashes on
   `itemDef.potionEffects` being undefined (see
   `use-object-handler.ts:91-96`). Filter must be stricter: either
   `actionCosts.use === 'bonus' | 'action' | 'utilize'` explicitly, OR
   retain the current `potionEffects !== undefined` guard in the builder
   until spell-scroll / other use-kinds land. Document which.

## Suggested Changes

1. Add `deterministic-ai.ts` and `infrastructure/llm/ai-decision-maker.ts` to
   the AIBehavior "Changes by Flow" section with the exact replacement
   expression for the gate.
2. Add `deterministic-ai.test.ts` and `context-budget.test.ts` fixture updates
   to the list.
3. Add a Test Plan checkbox: "regenerate LLM prompt snapshots and review
   diff for `hasPotions` → `usableItems` / `canUseItems` field rename".
4. Pin down `canUseItems` source: recommend `statBlock.type ?? 'humanoid'`
   default `true`, with an allow-list of
   `beast | undead | construct | ooze | plant` → `false`. Document in D9.
   Explicitly set `canUseItems: true` on goblins in the two existing
   scenarios if hydration inference is not added simultaneously.
5. Tighten the `usableItems` filter to `actionCosts.use ∈ {'action','bonus','utilize'}`
   AND `potionEffects !== undefined` (union, not just one), so non-consumable
   magic items don't leak into the AI's candidate list.
6. Add regression assertion to `ai-use-potion.json` / `ai-use-buff-potion.json`
   in the test plan to confirm goblins still drink potions post-migration.
