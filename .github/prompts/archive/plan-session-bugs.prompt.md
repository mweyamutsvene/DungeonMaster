# Plan: Fix Session Bugs (Monk vs Monk Playtest)
## Round: 2
## Status: APPROVED
## Affected Flows: CombatOrchestration, CombatRules (application layer), AIBehavior

## Objective
Fix 9 bugs identified during a live monk-vs-monk playtest session. All domain/rules functions are correct — every bug is in the application/infrastructure layer: stale state overwrites, hardcoded constants, missing state tracking, missing direct parsers, and missing LLM prompt anchoring.

---

## Changes

### Flow: CombatOrchestration

#### File: `src/application/services/combat/tabletop/pending-action-state-machine.ts`
- [ ] **BUG 2** — `assertValidTransition(null, action.type)` in `roll-state-machine.ts:358` passes `null` as `from` unconditionally. This means reading a DAMAGE pending action warns `null → DAMAGE`. **Challenger identified the correct fix**: Do NOT add DAMAGE to `null`'s valid targets (that would corrupt the semantic model). Instead, document the limitation with a comment. The real fix is to call `assertValidTransition()` at the site where a new pending action is SET (not where it's read), but that's a larger refactor beyond this scope. For now:
  - In `roll-state-machine.ts:processRollResult()`, replace the call with a comment:
  ```ts
  // NOTE: assertValidTransition is called here with null as the "from" state because
  // we don't track the previous state in processRollResult — we only know the current action.
  // The actual transition validation belongs at the setPendingAction() call sites.
  // TODO: move assertValidTransition to the call site that *sets* pending action type.
  assertValidTransition(null, action.type);
  ```
  This stops the false warnings without corrupting the transition model.

#### File: `src/application/services/combat/tabletop/combat-text-parser.ts`  
- [ ] **BUG 3** — Add "unarmed strike" patterns to `tryParseAttackText`. The pattern should match "unarmed strike", "unarmed attack", "punch", "kick", "fist", "my unarmed" variants. These should be recognized as an attack with no weapon hint. Add before the existing `attackVerb` regex check.

#### File: `src/application/services/combat/tabletop/tabletop-event-emitter.ts`
- [ ] **BUG 4 (partial)** — Add `actorName` and character list to `storyFramework` in `generateNarration`. This gives the LLM explicit context about who is acting, preventing hallucinated names. Pass `storyFramework: { genre: "fantasy", tone: "heroic", actorName: payload.actorName ?? "" }` when available.

### Flow: CombatOrchestration (application layer — OA in tabletop flow)

#### File: `src/application/services/combat/tabletop-combat-service.ts`
- [ ] **BUG 6a** — `completeMove()`: Fix hardcoded `let attackMod = 2` proficiency bonus. Use `charStats.proficiencyBonus` for all attacker types (Character, Monster, NPC). **Challenger identified**: the previous plan only fixed Characters but would have left monsters at `+0`. Must handle all three branches:
  ```ts
  // Before:
  let attackMod = 2; // Default: proficiency bonus
  if (attacker?.characterId) {
    const charStats = await this.deps.combatants.getCombatStats(...);
    attackMod += Math.max(strMod, dexMod);  // += adds on top of 2
  }
  // After:
  let attackMod = 0;
  if (attacker?.characterId) {
    const charStats = await this.deps.combatants.getCombatStats({ type: "Character", characterId: attacker.characterId });
    const strMod = Math.floor((charStats.abilityScores.strength - 10) / 2);
    const dexMod = Math.floor((charStats.abilityScores.dexterity - 10) / 2);
    attackMod = charStats.proficiencyBonus + Math.max(strMod, dexMod);
  } else if (attacker?.monsterId) {
    const monStats = await this.deps.combatants.getCombatStats({ type: "Monster", monsterId: attacker.monsterId });
    const strMod = Math.floor((monStats.abilityScores.strength - 10) / 2);
    const dexMod = Math.floor((monStats.abilityScores.dexterity - 10) / 2);
    attackMod = monStats.proficiencyBonus + Math.max(strMod, dexMod);
  } else if (attacker?.npcId) {
    const npcStats = await this.deps.combatants.getCombatStats({ type: "NPC", npcId: attacker.npcId });
    const strMod = Math.floor((npcStats.abilityScores.strength - 10) / 2);
    const dexMod = Math.floor((npcStats.abilityScores.dexterity - 10) / 2);
    attackMod = npcStats.proficiencyBonus + Math.max(strMod, dexMod);
  }
  ```

- [ ] **BUG 6b** — `completeMove()`: Fix target AC using `resources.armorClass` (always 10 since never populated). Resolve target AC from `getCombatStats()` instead:
  ```ts
  // Before:
  const targetAC = target?.resources && typeof (target.resources as any).armorClass === "number"
    ? (target.resources as any).armorClass : 10;
  // After:
  let targetAC = 10;
  if (target) {
    const targetRef = target.characterId ? { type: "Character" as const, characterId: target.characterId }
      : target.monsterId ? { type: "Monster" as const, monsterId: target.monsterId }
      : { type: "NPC" as const, npcId: target.npcId! };
    const targetStats = await this.deps.combatants.getCombatStats(targetRef);
    targetAC = targetStats.armorClass;
  }
  ```

- [ ] **BUG 8 (partial)** — After `completeMove()` resolves OA damage in `two-phase-action-service.ts`, the target's death is processed. Verify that the tabletop-combat-service properly emits a death event and stops combat if the target reaches 0 HP from the OA. (Details below in two-phase-action-service fix.)

### Flow: CombatOrchestration (application layer — OA auto-resolve for monster OAs)

#### File: `src/application/services/combat/two-phase-action-service.ts`
- [ ] **NEW (Challenger)** — `completeMove()`: Monster OAs are **silently skipped** during player-character movement because `resolvedReactions` is never populated for monster OA opportunities. Unlike AI-driven movement (which auto-accepts via `resolveAiMovement`), there's no auto-accept mechanism for monster OAs during player-driven moves. Add auto-accept logic before the `usedReactions` loop:
  ```ts
  // Auto-accept unresolved Monster/NPC OA opportunities before processing
  for (const opp of pendingAction.reactionOpportunities) {
    if (opp.reactionType !== "opportunity_attack" && opp.reactionType !== "readied_action") continue;
    const alreadyResolved = pendingAction.resolvedReactions.some(r => r.opportunityId === opp.id);
    if (alreadyResolved) continue;
    const combatant = combatants.find(c => c.id === opp.combatantId);
    if (combatant?.combatantType === "Monster" || combatant?.combatantType === "NPC") {
      pendingAction.resolvedReactions.push({
        opportunityId: opp.id,
        combatantId: opp.combatantId,
        choice: "use",
        respondedAt: new Date(),
      });
    }
  }
  ```

- [ ] **BUG 8 (primary)** — `completeMove()`: The monster auto-roll path (lines ~560–640) already uses `getCombatStats` correctly with proper proficiency. The player OA path correctly uses stored results. However the AC on the AUTO-ROLL path for monsters ALSO has the `actorResources.armorClass` bug at line ~639. Fix it: resolve the target (actor) AC via `getCombatStats` for the actor when auto-rolling for monsters too.
  ```ts
  // In the auto-roll branch:
  const actorRef: CombatantRef = actor.characterId ? { type: "Character", characterId: actor.characterId }
    : actor.monsterId ? { type: "Monster", monsterId: actor.monsterId }
    : { type: "NPC", npcId: actor.npcId! };
  const actorStats = await this.combatants.getCombatStats(actorRef);
  const baseTargetAC = actorStats.armorClass;
  // Remove: const actorResources = normalizeResources(actor.resources);
  // Remove: const baseTargetAC = typeof actorResources.armorClass === "number" ? actorResources.armorClass : 10;
  ```
  (Keep the `acBonusFromEffects` calculation using `targetActiveEffects` as-is.)

- [x] **BUG 8 (combat end — already works)** — *Challenger confirmed*: `tabletop-combat-service.ts:completeMove()` already calls `nextTurn()` for killed actors, which invokes `victoryPolicy.evaluate()` and emits `CombatEnded` if all enemies are down. **No additional work needed here.** The root cause of BUG 8 was (a) AC=10 causing wrong outcomes and (b) monster OAs silently skipping. Both addressed above.

### Flow: AIBehavior

#### File: `src/application/services/combat/ai/ai-action-executor.ts`
- [ ] **BUG 1** — After `StepOfTheWindExecutor` (or any disengage-based executor) succeeds and returns `{ success: true, data: { spendResource: { ... } } }`, the ki-spending code overwrites DB state with stale `aiCombatant.resources`. Fix: re-read combatant state from DB before applying the resource spend.
  ```ts
  // After executor returns with spendResource:
  const freshCombatants = await this.combat.listCombatants(encounterId);
  const freshCombatant = freshCombatants.find(c => c.id === aiCombatant.id);
  const freshResources = freshCombatant?.resources ?? aiCombatant.resources;
  const updatedResources = spendResourceFromPool(
    freshResources, spendResource.poolName, spendResource.amount
  );
  await this.combat.updateCombatantState(aiCombatant.id, { resources: updatedResources });
  ```

- [ ] **BUG 7** — When `attackOutcome.status === "awaiting_reactions"`, the function returns early WITHOUT saving the pending `decision.bonusAction`. The bonus action is permanently lost when the AI turn resumes via `processAllMonsterTurns`.

  **Fix Part 1** — in `ai-action-executor.ts`: before returning `awaitingPlayerInput: true`, store `decision.bonusAction` in combatant resources:
  ```ts
  if (decision.bonusAction) {
    const currentResources = normalizeResources(aiCombatant.resources);
    await this.combat.updateCombatantState(aiCombatant.id, {
      resources: { ...currentResources, pendingBonusAction: decision.bonusAction } as any,
    });
  }
  ```

  **Fix Part 2** — in `ai-turn-orchestrator.ts:executeAiTurn()`: at the **top** of the decision loop (before calling `aiDecisionMaker.decide()`), check and execute deferred bonus actions:
  ```ts
  // Check for deferred bonus action (set when turn was paused mid-turn by a reaction)
  const currentRes = normalizeResources(currentAiCombatant.resources);
  if (typeof currentRes.pendingBonusAction === "string" && currentRes.pendingBonusAction) {
    const deferredBonus = currentRes.pendingBonusAction;
    // Clear the deferred action first to avoid re-execution
    await this.combat.updateCombatantState(aiCombatantId, {
      resources: { ...currentRes, pendingBonusAction: undefined } as any,
    });
    const syntheticDecision: AiDecision = { action: "endTurn", bonusAction: deferredBonus, endTurn: true };
    await this.actionExecutor.executeBonusAction(sessionId, encounter.id, currentAiCombatant, syntheticDecision, actorRef!);
    break; // Main action was already spent; end turn after bonus
  }
  ```

  The addition is:
  - `ai-action-executor.ts` (await_reactions early-return path)
  - `ai-turn-orchestrator.ts` (top of decision loop in `executeAiTurn`)

- [ ] **ISSUE 9** — In `AiContextBuilder` or the AI decision prompt, add guidance that a Prone combatant should prioritize standing up (half movement, free) before attacking or moving away. Add to the system prompt: "If you are Prone, standing up costs half your movement speed. You should stand up before attacking."

### Flow: AIBehavior (LLM narration)

#### File: `src/infrastructure/llm/narrative-generator.ts`
- [ ] **BUG 4 (primary)** — The `storyFramework` is `{ genre: "fantasy", tone: "heroic" }` — no character names. The LLM hallucinates names. Add stronger instructions to the system prompt to use ONLY names from the event payload. Also emphasize: "CRITICAL: Use ONLY the actorName and targetName from the event payload. Do not use any other names."

- [ ] **BUG 5** — Narration says "initiative of 21" when actual is 23. This is an LLM generation issue — the narration prompt receives the raw initiative roll, not the final computed value. Ensure the initiative event payload includes the `finalInitiative` value explicitly so the LLM uses the right number.

---

## Cross-Flow Risk Checklist
- [x] Do changes in one flow break assumptions in another? — No: all fixes are additive or replace wrong values with correct ones. The OA AC fix may affect existing E2E scenarios if monsters were relying on wrong AC=10.
- [x] Does the pending action state machine still have valid transitions? — BUG 2 fix is observability-only, transitions still non-blocking.
- [x] Is action economy preserved? — Yes, fixes add state read but don't change economy consumption.
- [x] Do both player AND AI paths handle the change? — Yes: BUG 6 fixes both player tabletop path (tabletop-combat-service) and AI auto-roll path (two-phase-action-service).
- [x] Are repo interfaces updated if entity shapes change? — BUG 7 requires either pending action schema change or combatant resources change. If using resources, memory-repos must support it.
- [x] Is `app.ts` registration updated? — Not needed for these fixes.
- [x] Are D&D 5e 2024 rules correct? — Yes: BUG 1 enforces Disengage prevents OA; BUG 6 enforces correct AC/prof; BUG 7 enforces bonus actions not being silently dropped.

## Risks
- **BUG 7 design choice**: Storing pending bonus action in combatant resources is simpler but slightly surprising. Alternative: store in encounter state. Risk is low either way since it's cleared after use.
- **OA AC fix (BUG 6b)**: This will change existing test scenarios where OA was previously always hitting (AC=10). Need to update E2E scenario expectations.
- **BUG 8 combat end**: The current code already calls `applyKoEffectsIfNeeded` — it's possible death IS processed but the CLI doesn't show it because the SSE event is emitted but the tabletop-combat-service response doesn't include death info. Need to verify with a test.

## Test Plan
- [ ] Unit test: OA attack roll uses correct proficiency bonus and target AC
- [ ] Unit test: "unarmed strike" parser matches correctly
- [ ] Unit test: Stale resources fix in ai-action-executor (disengage flag preserved)
- [ ] Unit test: PendingActionStateMachine DAMAGE transition no longer warns after ATTACK
- [ ] E2E scenario: monk-vs-monk with Step of the Wind disengage — verify OA not offered
- [ ] E2E scenario: monk attack with bonus action Flurry — verify bonus persists through reaction
- [ ] E2E scenario: OA kills target — verify combat ends properly

## Implementation Order (dependency-aware)
1. **BUG 3** (combat-text-parser): Independent, quick, no dependencies.
2. **BUG 2** (state machine): Independent, observability only.
3. **BUG 6** (OA AC + prof bonus): Must do both files together. No other bugs depend on this — but E2E tests may need updating.
4. **BUG 8** (OA death + monster auto-resolve): Depends on BUG 6 being correct first.
5. **BUG 1** (stale resources): Independent of above.
6. **BUG 7** (lost bonus action): Design choice needed first (resources vs pending action).
7. **BUG 4, 5** (narration): LLM prompt changes, independent.
8. **ISSUE 9** (AI prone): Prompt change, independent.
