# Plan: Grapple Escape Proficiency Fix + Potion/UseObject Improvements
## Round: 1
## Status: COMPLETE
## Affected Flows: CombatRules, AIBehavior, EntityManagement

## Objective
Fix grapple escape to use skill checks (Athletics/Acrobatics with proficiency) per D&D 5e 2024 rules, and improve the AI's useObject action to pre-filter when no potions are available. Optionally extend potion support beyond healing potions.

---

## Changes

### 1. Grapple Escape Proficiency Bug (CombatRules + CombatOrchestration)

**Problem:** The `escapeGrapple()` domain function in `grapple-shove.ts` uses raw ability modifiers only. Per D&D 5e 2024 rules, the escapee makes a **Strength (Athletics) or Dexterity (Acrobatics) check** — a skill check that includes proficiency bonus if the creature is proficient in the chosen skill.

**Current code** (`domain/rules/grapple-shove.ts:82`):
```typescript
export function escapeGrapple(
  grapplerStrMod: number,
  grapplerProfBonus: number,
  escapeeStrMod: number,
  escapeeDexMod: number,
  diceRoller: DiceRoller,
): GrappleShoveResult {
  const dc = 8 + grapplerStrMod + grapplerProfBonus;
  const useDex = escapeeDexMod > escapeeStrMod;
  const mod = useDex ? escapeeDexMod : escapeeStrMod;
  const saveCheck = abilityCheck(diceRoller, { dc, abilityModifier: mod, mode: "normal" });
  // ...
}
```

**Fix:** The `escapeGrapple()` function should accept proficiency info for both Athletics and Acrobatics. Use `skillCheck()` or equivalent logic to add proficiency when applicable. The caller in `action-service.ts` needs to look up skill proficiencies from combat stats.

#### [File: `packages/game-server/src/domain/rules/grapple-shove.ts`]
- [x] Extend `escapeGrapple()` signature to accept skill proficiency info (e.g., `escapeeAthleticsProficient?: boolean`, `escapeeAcrobaticsProficient?: boolean`, `escapeeProfBonus?: number`)
- [x] When choosing between STR (Athletics) and DEX (Acrobatics), factor in proficiency bonus for whichever skill the creature is proficient in — pick the one with higher total modifier
- [x] Use the proficiency-adjusted modifier in the `abilityCheck()` call
- [x] Remove the TODO comment in `action-service.ts` once fixed

#### [File: `packages/game-server/src/domain/rules/grapple-shove.test.ts`]
- [x] Add test: escapee proficient in Acrobatics with lower DEX still benefits from proficiency (may choose Acrobatics over Athletics)
- [x] Add test: escapee with no proficiency in either skill uses raw ability modifier (backward compatible)
- [x] Add test: escapee proficient in both picks the higher total

#### [File: `packages/game-server/src/application/services/combat/action-service.ts` (~line 1325)]
- [x] Look up escapee's skill proficiencies (Athletics, Acrobatics) from combat stats
- [x] Pass proficiency info to `escapeGrapple()` domain function
- [x] Remove the TODO comment

#### [File: `packages/game-server/src/application/services/combat/ai/ai-action-executor.ts`]
- [x] Verify AI escape grapple path also passes proficiency info (likely delegates to action-service, so should be automatic)

---

### 2. AI UseObject Pre-Filtering (AIBehavior)

**Problem:** The AI LLM may pick `useObject` when the combatant has no healing potions in inventory, wasting a turn step. After 2 consecutive failures, the turn is force-ended.

**Current behavior:** The system prompt says "Only use when you have healing potions and HP is low" but the LLM doesn't always obey. The executor returns `{ ok: false, summary: "No usable objects available" }` which counts as a failure.

#### [File: `packages/game-server/src/infrastructure/llm/ai-decision-maker.ts`]
- [x] In the system prompt builder / context section, if the combatant has no healing potions in inventory, either:
  - (a) Omit `useObject` from the available actions list entirely, OR
  - (b) Add a note: `"useObject is NOT available — no healing potions in inventory"` to the context
- [x] Check if the AI tactical context already includes inventory info. `hasPotions: boolean` already present in `AiCombatContext`.

#### [File: `packages/game-server/src/application/services/combat/ai/ai-context-builder.ts`]
- [x] `hasPotions` computed via `potionEffects` check already present and wired up

---

### 3. Non-Healing Potion Support → Separate Plan

**See:** [plan-potion-support.prompt.md](.github/prompts/plan-potion-support.prompt.md) for the full plan covering all 18 D&D 5e 2024 Basic Rules potions, the `PotionEffect` data model, generic applicator, and AI awareness.

---

## Cross-Flow Risk Checklist
- [ ] Do changes in one flow break assumptions in another? — Low risk. `escapeGrapple()` signature change requires updating callers (action-service, possibly grapple-handlers). All are in application layer.
- [ ] Does the pending action state machine still have valid transitions? — N/A. No state machine changes.
- [ ] Is action economy preserved (1 action, 1 bonus, 1 reaction, 1 movement)? — Yes. Escape grapple still spends 1 action.
- [ ] Do both player AND AI paths handle the change? — Yes. Both delegate to `CombatActionService.escapeGrapple()`.
- [ ] Are repo interfaces + memory-repos updated if entity shapes change? — N/A. No entity shape changes.
- [ ] Is `app.ts` registration updated if adding executors? — N/A. No new executors.
- [ ] Are D&D 5e 2024 rules correct (not 2014)? — Yes. 2024 rules: escape grapple uses Athletics or Acrobatics skill check vs DC = 8 + grappler's STR mod + prof.

## Risks
- **Skill proficiency data availability:** `getCombatStats()` must return skill proficiencies. If it doesn't, need to check what data is available (e.g., `skillProficiencies` on creature stats). Mitigation: fall back to raw ability modifier if skill data unavailable (backward-compatible).
- **AI context bloat:** Adding inventory info to AI context increases prompt token count. Mitigation: single boolean `hasPotions`, not the full inventory.

## Test Plan
- [x] Unit tests for `escapeGrapple()` with proficiency (4 new cases in `grapple-shove.test.ts`) — 24/24 grapple tests pass
- [x] Existing E2E scenario `grapple-escape.json` continues to pass — 160/160 E2E scenarios pass
- [x] AI with no potions doesn't pick `useObject` — already double-gated in `ai-decision-maker.ts`
