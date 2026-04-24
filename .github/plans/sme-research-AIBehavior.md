# SME Research — AIBehavior — Item-use integration in deterministic AI

As you wish Papi....

## Scope
- Files read:
  - `application/services/combat/ai/deterministic-ai.ts` (decision tree, ~770 lines)
  - `application/services/combat/ai/ai-context-builder.ts` (context assembly, ~800 lines)
  - `application/services/combat/ai/ai-types.ts` (AiCombatContext, AiDecision shapes)
  - `application/services/combat/ai/ai-bonus-action-picker.ts` (triage + BA healing)
  - `application/services/combat/ai/handlers/use-object-handler.ts` (item execution)
  - `application/services/combat/ai/deterministic-ai.test.ts` (potion test coverage)
- Task context: item-use (potions, goodberry, pass-item) is being promoted to a first-class combat action; confirm how deterministic AI can weigh it.

## Current State

**Item-use is already wired end-to-end for potions.** This is not a greenfield integration.

1. **Decision tree** (`deterministic-ai.ts`, lines ~18 priority comment, ~374 implementation):
   Step order per turn is: stand up → triage dying ally → target/move → disengage → **Step 3c dodge** → **Step 4 useObject (potion @ <40% HP)** → Step 4b spells → Step 4c feature healing (Second Wind, etc.) → attack → bonus action → endTurn.
   Non-attack branches today: `dodge`, `disengage`, `dash`, `useObject`, `castSpell`, `grapple`, `shove`, `useFeature`, plus bonus-action spells (`Healing Word`), class features, and dying-ally triage in `pickHealingForDyingAlly()`.

2. **Attack vs cast vs ability ordering**: Spells are evaluated BEFORE basic attacks (Step 4b); bonus actions previewed first so a BA spell can force cantrip-only main action (2024 rule). Feature actions (`pickFeatureAction`) are checked after spells. Potion use is inserted **before** spellcasting when HP < 40% — i.e. potion beats casting Healing Word on self.

3. **Emergency heal logic exists**:
   - `findDyingAlly` + `pickHealingForDyingAlly` in `ai-bonus-action-picker.ts:58` — prefers BA heals (Healing Word) to save 0-HP allies with death saves; runs at priority Step 1b (before targeting).
   - Self-heal potion at Step 4 (`combatant.hp.percentage < 40`).
   - Second Wind via `pickFeatureAction` (self-heal bonus action fighter).
   - Bonus-action healing spells at `ai-bonus-action-picker.ts:190` (priority 7 for hurt allies, threshold < 50%).

4. **Inventory visibility from AI's perspective**: The AI does **NOT** see a full item list. `ai-context-builder.ts:718-724` derives a single boolean `hasPotions` by iterating `getInventory(aiCombatant.resources)` and checking `lookupMagicItem(item.name).potionEffects`. `AiCombatContext` exposes only that flag (`ai-types.ts:233`). Selection of WHICH potion is deferred to `UseObjectHandler.findBestUsableItem()` (low HP → healing potion preference; else first potion). The decision maker cannot distinguish Goodberry vs Potion of Healing vs Potion of Speed — they would all collapse into `hasPotions=true` unless the flag is split.

5. **Tests for AI action selection**:
   - `deterministic-ai.test.ts:299` — "drinks healing potion when low HP and potion available" uses `hasPotions: true` + hp.percentage=26.
   - `ai-context-builder.test.ts` — context assembly.
   - `use-object-handler` — no dedicated test currently (add one for item picking heuristics).
   - Any expansion to multi-category items will require new test cases for each `hasX` flag and precedence between them.

## Impact Analysis
| File | Change Required | Risk | Why |
|------|----------------|------|-----|
| `ai-types.ts` (`AiCombatContext`) | Split `hasPotions` into granular flags (`hasHealingPotion`, `hasBuffPotion`, `hasGoodberries`, `canPassItems`) OR add a typed `usableItems` summary array | med | Single boolean collapses distinct tactical options; AI cannot choose buff vs heal |
| `ai-context-builder.ts:718` | Broaden detection past `potionEffects` to any consumable-with-combat-effect; emit granular flags | med | Goodberry is a spell output, not a magic item — needs new pathway |
| `deterministic-ai.ts:374` | Split Step 4 into sub-steps: heal-potion (HP<40), buff-potion (pre-engagement round 1), goodberry (HP<60 and not low-urgency); add "give item to ally" branch gated on adjacency + ally HP | med | Priority ordering matters — potion-buffing must not preempt actual attacks in later rounds |
| `deterministic-ai.ts` (new guard) | Skip all item-use for pet/companion/familiar combatants (`combatantType === "Monster"` summoned by player, or new `canUseItems: false` flag) | high | No existing guard; an animal companion would happily "drink a potion" today. See Risks. |
| `use-object-handler.ts` | Expand `findBestUsableItem` to score buff potions, goodberry charges, and target-selection for pass-item | med | Currently only two-tier (heal vs first-available) |
| `deterministic-ai.test.ts` | Add cases: goodberry-at-low-hp, buff-pre-fight, companion-rejects-potion, heal vs buff precedence | low | Straightforward extensions |

## Constraints & Invariants
- **Deterministic rules**: AI decisions are advisory; rules engine must still validate `useObject` (action economy, item availability). Do not let the AI layer bypass `actionSpent` checks — handler already enforces at line ~68.
- **Pre-combat Goodberry**: Druid casting Goodberry "pre-fight" happens OUTSIDE combat encounter. AI turn orchestrator only runs in-combat. This is a **session-level action**, not a combat AI concern — flag it to EntityManagement/SpellSystem SMEs.
- **D&D 2024**: Drinking a potion = Magic action (full action) OR Bonus Action for self (Optional rule: DMG/player choice). Current handler treats it as a main action only — check `application/services/combat/action-handlers/` for the authoritative rule.
- **FIFO queue**: `MockAiDecisionMaker` queues decisions in order; any new branch must produce a deterministic decision given identical context (no `Math.random()` in selection).
- **Companion/pet gate**: No existing `isPlayerControlled` / `isCompanion` flag on `AiCombatContext.combatant`. Introducing one requires coordination with CreatureHydration SME.

## Options & Tradeoffs
| Option | Pros | Cons | Recommendation |
|--------|------|------|---------------|
| A: Extend `hasPotions` into multiple booleans | Minimal type churn, compatible with current tests | Explodes combinatorially as more item categories land | ✓ Preferred short-term |
| B: Replace `hasPotions` with `usableItems: Array<{category, count, bestForSelf, bestForAlly}>` | Future-proof; handler can stop duplicating item lookup | Touches every test fixture + LLM prompt format (snapshot churn) | ✓ Long-term target |
| C: Let handler pick item and just add more AI branches (heal/buff/give) without type changes | No fixture churn | AI can't preview what's available → wasteful decisions rejected by handler | ✗ Avoid |

## Risks
1. **Animal companion / familiar drinking potions**: No guard exists. Mitigation — add `canUseItems` (or `isCompanion`) on `AiCombatContext.combatant` and gate Step 4 + any pass-item branch on it. Coordinate with CreatureHydration SME.
2. **E2E determinism for potion choice**: Today `hasPotions=true` + HP<40 deterministically yields `useObject`, and `UseObjectHandler.findBestUsableItem` is deterministic (first-match iteration order). To *prevent* potion use in an E2E: either (a) omit potions from the seeded `inventory` so `hasPotions=false`, (b) keep combatant HP ≥ 40%, or (c) add a scenario-level `forbidItemUse` flag. To *force* use: seed a healing potion in inventory + queue damage to drop HP below threshold, OR use `queueMonsterActions` to inject a literal `{action:"useObject",...}` decision bypassing heuristics. Both work with existing harness — no new plumbing needed.
3. **Priority inversion**: Inserting buff-potion pre-combat at Step 4 may cause AI to waste round 1 drinking instead of engaging. Suggest gating buff-potion branch on `combat.round === 1 && noEnemyInRange`.
4. **Spell/potion double-heal**: Today potion (Step 4) fires before Healing Word (Step 4b via spells). If self-heal potion count is low (1 charge), AI may burn potion when a free-slot spell would do. Consider computing expected-heal per resource and picking max.

## Recommendations
1. **Don't treat this as greenfield** — item-use handler, action executor registration (`ai-action-executor.ts:200`), AI decision branch, and test coverage already exist for potions. Plan should position the work as "extend granularity," not "introduce."
2. **Prerequisite**: add `canUseItems` flag to combatant context before broadening item categories — otherwise summoned creatures regress.
3. **Start with Option A** (split `hasPotions` into `hasHealingPotion` / `hasBuffPotion` / `hasGoodberry`) to unblock druid + potion scenarios with minimal churn; schedule Option B after the 3rd new category lands.
4. **Add regression E2E scenarios** under `scripts/test-harness/scenarios/` for: (a) NPC ally drinks potion at low HP, (b) druid pre-cast goodberry then uses charge in combat at low HP, (c) animal companion does NOT attempt potion use. Use `queueMonsterActions` for deterministic reproduction.
5. **Flag to SpellSystem + InventorySystem SMEs**: Goodberry charges are a hybrid (spell-origin, inventory-stored) — confirm storage model before AI reads them.
