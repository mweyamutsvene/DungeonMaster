# SME Research — CombatOrchestration — Phase 3.1 Fighting Styles (Protection + Interception)

## Scope
- Files read:
  - [roll-state-machine.ts](packages/game-server/src/application/services/combat/tabletop/roll-state-machine.ts) — `handleAttackRoll` ~L400–650
  - [damage-resolver.ts](packages/game-server/src/application/services/combat/tabletop/rolls/damage-resolver.ts) — damage apply pipeline
  - [session-tabletop.ts](packages/game-server/src/infrastructure/api/routes/sessions/session-tabletop.ts) — `tryInitiateDamageReaction` L44–175
  - [attack-reaction-handler.ts](packages/game-server/src/application/services/combat/two-phase/attack-reaction-handler.ts) — `initiate()` + `complete()`
  - [ai-attack-resolver.ts](packages/game-server/src/application/services/combat/ai/ai-attack-resolver.ts) — L220–320 (d20 roll → `initiateAttack`)
  - [combat-text-profile.ts](packages/game-server/src/domain/entities/classes/combat-text-profile.ts) — `AttackReactionDef` contract
  - [fighter.ts](packages/game-server/src/domain/entities/classes/fighter.ts) — `PROTECTION_REACTION` + `INTERCEPTION_REACTION` stubs L170–260 (TODO CO-L5/L6)
  - [wizard.ts](packages/game-server/src/domain/entities/classes/wizard.ts) — `SHIELD_REACTION` prior art
  - [pending-action.ts](packages/game-server/src/domain/entities/combat/pending-action.ts) — `ReactionType` already includes `"protection"` and `"interception"`

## Current State

### Two parallel attack pipelines
1. **Player-attacks-monster (tabletop)**: `attack-handlers.ts` → `REQUEST_ROLL` → player d20 → `RollStateMachine.handleAttackRoll` → hit/miss → `DamagePendingAction` → player damage roll → `DamageResolver.resolve`. **No `detectAttackReactions` call** (monster targets don't Shield/Deflect).
2. **Monster-attacks-player (AI)**: `ai-attack-resolver.ts` server-rolls d20 → `twoPhaseActions.initiateAttack({ attackRoll })` → `AttackReactionHandler.initiate()` calls `detectAttackReactions(target, …)` → if reactions: `"awaiting_reactions"` + `reaction_pending` → player responds via `/reactions/:id/respond` → `completeAttack()` recomputes hit w/ adjusted AC, rolls damage, applies Deflect Attacks reduction.

### Protection/Interception placement
- Both reaction defs **already exist** in `fighter.ts` with correct eligibility gates (flags `hasProtectionStyle`, `hasInterceptionStyle`, `hasShieldEquipped`, `hasWeaponEquipped` via `ReactionResources`).
- Both are registered in `FIGHTER_COMBAT_TEXT_PROFILE.attackReactions`.
- `ReactionType` union already lists both.
- **Gap**: `detectAttackReactions()` is invoked only on the TARGET (see `attack-reaction-handler.ts:153` — `detect(detectionInput)` with target's class/resources). The def files explicitly flag this as TODO CO-L5/L6: _"Detection needs to scan nearby allies, not just the target itself."_

### Shield timing (prior art)
- `initiate()` runs AFTER d20 is rolled (`input.attackRoll` is a computed total).
- Shield adjusts AC post-hoc in `completeAttack()`: `finalAC = originalAC + 5`. If `attackRoll < finalAC`, hit becomes miss.
- `completeAttack()` also houses damage-reduction prior art: **Deflect Attacks** (monk) and **Cutting Words** (bard, mutates `attackData.attackRoll`), **Uncanny Dodge** (rogue, halves damage).

### AI hit-determination flow
```
ai-attack-resolver.decideAttack()
  → server rolls d20 (QueueableDiceRoller)         ← no pause hook in AI flow
  → initiateAttack({ attackRoll })                 ← FIRST pause point
    → wouldHit shortcut: if roll < targetAC → "miss" (no reactions offered)
    → detectAttackReactions(target) + Sentinel scan of allies
    → "awaiting_reactions" / "hit"
  → completeAttack() — recompute hit w/ adjusted AC → roll damage → apply reductions → write HP
```

## Answers to Research Questions

### Q1 — Can Protection use the same hook as Shield (post-d20)?
**Yes**, with caveat. Shield is a post-roll AC bump; Protection is a disadvantage-impose. The mechanically-equivalent way to impose disadvantage after-the-fact is to **roll a second d20 in `completeAttack()` and take min**. If attacker had advantage, the set becomes {d20a, d20b, d20c} take min — which is 5e 2024 RAW for cancelling advantage + adding disadvantage source.

Alternative: pre-roll pause by restructuring `ai-attack-resolver` — substantially more invasive (Option C below). Post-roll "second d20 + min" is clean and reuses the existing pending-action plumbing.

### Q2 — Pre-roll Protection trace
There is **no hook to pause *before* the d20 in the AI flow** without splitting `ai-attack-resolver` into two phases. The AI d20 is rolled server-side before `initiateAttack` is called. Proposed path (post-roll reroll):
```
ai-attack-resolver rolls d20 (store it on attackData.originalD20)
  → initiateAttack(attackRoll)
    → [new] ally-scan within 5ft of TARGET → Protection/Interception opportunities
  → player: "use Protection"
  → completeAttack()
    → [new] if Protection used → reroll d20, attackRoll = min(orig+bonus, new+bonus)
    → existing Shield/Deflect/Uncanny paths
```
For player-attacks-player (tabletop flow) pre-roll Protection would require extending `attack-handlers.ts` to emit a reaction-prompt before `REQUEST_ROLL` — **out of scope** unless PvP is supported.

### Q3 — Interception pause point
**Easier than Protection** — damage reduction is already a first-class concept in `completeAttack()`. Deflect Attacks uses `deflectReaction` context to subtract dice from `damageApplied` (see `attack-reaction-handler.ts` ~L550). Interception follows the same pattern: `if (interceptionReaction) damageApplied -= rollDie(10) + profBonus` right before HP write.

**No new pause needed** — offer Interception in the same `reaction_pending` window as Shield/Deflect. Context carries `{ profBonus, damageReduction: "1d10+N" }` already.

Note: `tryInitiateDamageReaction` in `session-tabletop.ts` is a DIFFERENT hook — it fires post-damage-apply for Hellish Rebuke / Absorb Elements. **Interception must NOT use this hook** — it must fire BEFORE HP is written (RAW: reduces damage, doesn't refund). Use the `initiateAttack` hook.

### Q4 — Nested pauses
**Yes, supported.** The pending-action queue (`setPendingAction`/`getPendingAction`/`clearPendingAction`) already handles stacked reactions — `tryInitiateDamageReaction` uses the "save queued follow-up → clear → push `reaction_pending` at HEAD → re-push follow-up" pattern to allow Extra-Attack + Hellish-Rebuke coexistence.

**Simpler approach**: offer Protection + Interception in ONE `reaction_pending` window via `ReactionOpportunity[]`. Player picks which (or neither). Resolution in `completeAttack()` processes them sequentially: Protection first (may turn hit→miss), then Interception (skipped if Protection already caused a miss).

### Q5 — Prior art
| Reaction | Timing | Mechanic | Site |
|---|---|---|---|
| Shield | Post-d20, pre-hit | AC +5 | `completeAttack()` recomputes hit |
| Deflect Attacks | Post-hit, pre-damage-apply | Damage −1d10+mod | `completeAttack()` subtracts |
| Cutting Words | Post-d20, pre-hit | Attack roll −BI die | `completeAttack()` mutates `attackRoll` |
| Uncanny Dodge | Post-hit, pre-damage-apply | Damage ÷ 2 | `completeAttack()` halves |
| Lucky (attacker) | Post-miss | Reroll d20 | Separate `lucky_reroll` pending |

**Direct prior art for disadvantage-impose**: _none_. Cutting Words is closest (attack-roll subtraction). Rolling a second d20 and taking min is a new but minimally-invasive pattern.

## Impact Analysis

| File | Change | Risk | Why |
|---|---|---|---|
| `attack-reaction-handler.ts` `initiate()` | Scan `combatants` within 5ft of TARGET for ally characters; call `detect()` per ally with their resources; push onto `reactionOpportunities` | med | New loop, but Sentinel scan at L193+ is a near-perfect template |
| `attack-reaction-handler.ts` `complete()` | Handle `protection`: reroll d20 via `input.diceRoller`, take min, recompute hit. Handle `interception`: roll `1d10+profBonus`, subtract from `damageApplied`. Set `reactionUsed` on the ally, not target | med | Must preserve advantage/disadvantage semantics and ally-reaction-economy |
| `creature-hydration.ts` / `combatant-resolver.ts` | **Verify** `hasProtectionStyle` / `hasInterceptionStyle` / `hasShieldEquipped` / `hasWeaponEquipped` flow from sheet → combatant resources | low | Flags declared in `ReactionResources`; silent null detect if missing |
| `attack-handlers.ts` (tabletop) | No change for MVP (monsters don't have fighting styles) | n/a | |
| Reaction prompt payload | Verify ally-reactor prompts render (Sentinel already does this — same shape) | low | |
| Test harness | `queueDiceRolls` supports FIFO for Protection reroll d20 and Interception 1d10 | none | Per repo memory |

## Constraints & Invariants

1. **Ally scan uses TARGET position, radius 5ft**.
2. **Ally ≠ target** (can't Protection yourself).
3. **Ally must see attacker** (RAW line-of-sight). MVP may skip, flag TODO.
4. **One reaction per ally per round** — `reactionUsed` on the ally, not target.
5. **Protection fires before damage roll**. Damage is rolled in `completeAttack()` AFTER reaction resolution — ordering is correct.
6. **Interception clamps damage ≥ 0**.
7. **`ReactionType` union already includes both** — no domain type change.
8. **Fighter def files' eligibility gates are correct** — do not regress.
9. **Ally-reactor prompts**: the reactor is NOT the target. Sentinel already has this shape (`opp.context.sentinelName`, `context.attackerId`) — follow that convention.

## Options & Tradeoffs

| Option | Approach | Pros | Cons | Rec |
|---|---|---|---|---|
| **A: Ally-scan in `initiate()`** | Mirror Sentinel block: iterate combatants within 5ft of TARGET; for each ally-character call `detect()` on each registered `AttackReactionDef` with that ally's resources. Resolve in `complete()` | Minimal surface; reuses pending-action queue, reaction-prompt plumbing, and Sentinel pattern | AI flow only (no PvP) | ✓ **Preferred** |
| **B: Separate ally-reaction detection layer** | Split target vs ally detection into two helpers | Cleaner type boundary | Over-ceremony for 2 abilities | ✗ Over-engineered |
| **C: Pre-roll pause for Protection** | Split `ai-attack-resolver` into "roll-d20" and "resolve" phases | RAW-accurate, no synthetic 3rd die | Major AI refactor; breaks deterministic dice queue ordering; duplicates pending-action infra | ✗ Avoid |
| **D: Post-damage hook for Interception** | Reuse `tryInitiateDamageReaction` (like Hellish Rebuke) and refund HP | Reuses damage-reaction infra | **Wrong timing** — breaks concentration/KO/death-save triggers tied to damage event | ✗ Avoid — semantically wrong |
| **E: Collapse Interception into Deflect path** | Conditional rider on existing `deflectReaction` code | Small patch | Conflates self-only vs ally reactions; hard to reason about | ✗ Avoid |

## Risks

1. **Flag population gap** — if sheet → resource wiring doesn't set `hasProtectionStyle` etc, `detect()` silently returns null. **Mitigation**: verify in `creature-hydration.ts`; add E2E scenario with fighter ally to prove `awaiting_reactions` fires.
2. **Advantage + Protection interaction** — reroll d20 with min-of-all preserves RAW (advantage cancels), but narration/events must explain it.
3. **Sequential resolution in `complete()`** — if Protection causes miss, Interception must be skipped (nothing to reduce). If both used simultaneously, need conditional logic or a second reaction window post-reroll.
4. **Sentinel + Protection double-scan** — same ally-neighbour loop. Cheap, but consolidate into one pass.
5. **Multiattack** — after first strike triggers Protection and consumes ally reaction, subsequent strikes in same action must not re-offer (verify `reactionUsed` flag checked via `hasReactionAvailable` in ally-scan loop).
6. **Reaction consumption site** — Shield spends target's reaction; Protection/Interception must spend the **ally's** reaction. Be careful in `complete()` — current Shield/Deflect code path updates `target.resources` with `reactionUsed: true`; ally path must update the ally's combatant record via a fresh lookup.

## Recommendations

1. **Go with Option A.** Extend `AttackReactionHandler.initiate()` with an ally-scan mirroring Sentinel (L193+). For each combatant within 5ft of TARGET, call `detect()` on every registered `AttackReactionDef` with that ally's class/resources.
2. **Resolution in `complete()`**: two new branches parallel to Shield/Deflect:
   - Protection: `const newD20 = input.diceRoller.rollDie(20)`; `attackData.attackRoll = Math.min(originalTotal, newD20 + attackBonus)`; re-check hit against `finalAC`.
   - Interception: post-damage-roll, pre-HP-write: `damageApplied = Math.max(0, damageApplied - (rollDie(10) + profBonus))`.
3. **Sequential resolution**: Protection first; if result is miss, skip Interception.
4. **Flag-population verification** as step 0 — grep `creature-hydration.ts` / `combatant-resolver.ts` for `hasProtectionStyle` wiring.
5. **Reaction consumption on the ally combatant** — update the ally's resources with `reactionUsed: true`, not the target's.
6. **Tests**: E2E scenarios `fighter/protection-ally.json` (ally imposes disadvantage → miss) and `fighter/interception-ally.json` (ally reduces damage). Unit tests on `initiate()` ally-scan radius. Use `queueDiceRolls` for reroll d20 and 1d10.
7. **Out of scope for MVP**: line-of-sight check, player-attacks-player tabletop path, monster-using-Protection. Flag as TODOs.


## Symptom
`lay on hands on Elara` (ally PC) fails — caller gets "Already at full HP" or the HP update lands on the paladin. Self-heal works.

---

## Root Cause (4 bugs, all in `handleBonusAbility`)

File: [packages/game-server/src/application/services/combat/tabletop/dispatch/class-ability-handlers.ts](packages/game-server/src/application/services/combat/tabletop/dispatch/class-ability-handlers.ts)

### Bug 1 — Target resolver only scans monsters
Lines **611–644**: first loop iterates `monsters` only; fallback picks nearest hostile filtered by `combatantType === "Monster"`. Characters are never searched, so "Elara" never matches.

### Bug 2 — `params.targetEntityId` is never passed
Lines **687–697**: params bag includes `target` and `targetName` but omits `targetEntityId`. Executor ([lay-on-hands-executor.ts#L55](packages/game-server/src/application/services/combat/abilities/executors/paladin/lay-on-hands-executor.ts#L55)) requires both `targetEntityId` **and** `target` to route to ally; otherwise falls through to `actor` (self). Compare to `handleClassAbility` at line **219** which correctly passes `targetId: combatantRefToEntityId(targetRef)`.

### Bug 3 — `buildTargetActor` stubs HP as 0
Lines **61–78**: stub actor returns `getCurrentHP: () => 0, getMaxHP: () => 0`. Even if a Character were resolved, executor computes `missingHP = 0 − 0 = 0` → returns `"Already at full HP — no healing needed"`.

### Bug 4 — HP update is always written to the actor combatant
Lines **895–899**: `updateData.hpCurrent` is applied to `actorCombatant.id`. Executor returns `targetEntityId` in `result.data` for ally heals (executor line **127**), but handler ignores it — would heal the paladin instead of Elara even after bugs 1–3 are fixed.

---

## Files
- Handler (all bugs): [class-ability-handlers.ts#L598-L820](packages/game-server/src/application/services/combat/tabletop/dispatch/class-ability-handlers.ts#L598-L820) (`handleBonusAbility`)
- Actor stub: [class-ability-handlers.ts#L61-L78](packages/game-server/src/application/services/combat/tabletop/dispatch/class-ability-handlers.ts#L61-L78) (`buildTargetActor`)
- Executor (already ally-capable): [lay-on-hands-executor.ts#L52-L128](packages/game-server/src/application/services/combat/abilities/executors/paladin/lay-on-hands-executor.ts#L52-L128)
- Reference — spell delivery ally resolution: [save-spell-delivery-handler.ts#L431-L486](packages/game-server/src/application/services/combat/tabletop/spell-delivery/save-spell-delivery-handler.ts#L431-L486)
- Reference — `handleClassAbility` passes `targetId`: [class-ability-handlers.ts#L219](packages/game-server/src/application/services/combat/tabletop/dispatch/class-ability-handlers.ts#L219)

---

## Proposed Fix (minimal, opt-in flag — option b)

### 1. Extend `AbilityExecutor` interface
[packages/game-server/src/domain/abilities/ability-executor.ts](packages/game-server/src/domain/abilities/ability-executor.ts):
```ts
export interface AbilityExecutor {
  canExecute(abilityId: string): boolean;
  execute(ctx: AbilityExecutionContext): Promise<AbilityExecutionResult>;
  /** Handler will resolve ally Characters as valid targets when true. */
  allowsAllyTarget?: boolean;
}
```
Set `allowsAllyTarget = true` on `LayOnHandsExecutor`. Add `AbilityRegistry.allowsAllyTarget(abilityId): boolean` convenience method.

### 2. Fix target resolver in `handleBonusAbility` (lines 611–644)
Before scanning monsters, when `allowsAllyTarget`:
- Scan `characters` for name match (excluding self → falls through to self heal)
- If match, build `targetRef = { type: "Character", characterId }`

### 3. Pass real HP to ally target actor
Modify `buildTargetActor` to accept `hpCurrent`/`hpMax`. At call site, look up target combatant via `findCombatantByEntityId(combatantStates, ...)` and pass real values.

### 4. Pass `targetEntityId` to executor params (line 687)
```ts
params: {
  ...,
  targetEntityId: targetRef ? combatantRefToEntityId(targetRef) : undefined,
}
```

### 5. Route `hpUpdate` to the correct combatant (line 895)
When `result.data.targetEntityId` is set, write `hpCurrent` to that combatant, not `actorCombatant`. Keep the resources write on actor (bonus action + pool). Two repo calls.

---

## Other Class Abilities That Could Target Allies
Of 14 registered executors, **Lay on Hands is the only ally-target ability today**. Others are self-buff (SecondWind, PatientDefense, WholenessOfBody, Rage, ActionSurge, RecklessAttack), self-utility (CunningAction, StepOfTheWind, MartialArts, NimbleEscape, OffhandAttack), or enemy-target (FlurryOfBlows, TurnUndead). Future candidates: Help-style bonus actions, Channel Divinity: Preserve Life. Opt-in `allowsAllyTarget` flag scales cleanly.

Healing Word / Cure Wounds are **spells**, not ability executors — they go through `SpellActionHandler` / `HealingSpellDeliveryHandler` and already resolve allied Characters correctly. Not affected.

---

## Risks

1. **Name collisions** between monster and character on substring match — iterate characters FIRST when `allowsAllyTarget` (ally intent implies ally resolution, same convention as spell delivery). Low risk.
2. **Self-targeting via own name** — if text match equals actor, set `targetRef = null` so executor's self branch fires (no range check). Must handle explicitly.
3. **Touch-range check is a no-op today** — `mockCombat.getPosition` at line 674 returns `undefined`, so executor's range check at [lay-on-hands-executor.ts#L60-L72](packages/game-server/src/application/services/combat/abilities/executors/paladin/lay-on-hands-executor.ts#L60-L72) never fails. Ally heal across the map will "succeed". Flag as follow-up — fix requires wiring position from encounter state into `mockCombat`, affects all bonus abilities.
4. **Interface change ripple** — `allowsAllyTarget?` is optional, no existing executors need edits. New registry method is additive.
5. **Two repo writes on ally heal** — resources to actor, HP to target. Acceptable; matches spell-delivery pattern.

## Recommendation
Implement fixes 1–5 in one changeset. Track touch-range wiring (risk 3) as a separate plan — it's a cross-cutting bonus-ability fix, not GAP-10 scope.

---
---
# (ARCHIVE — prior task content below, do not use)

## Q1: AI Turn Execution Flow

**Player `endTurn` → AI Loop → Back to Player:**
1. Scenario runner POSTs `{ kind: "endTurn", actor: { type: "Character", characterId } }` to `/sessions/:id/actions`
2. Route calls `combat.endTurn()` → `combat.nextTurn()` (advances `encounter.turn` pointer)
3. Fire-and-forget: `void deps.aiOrchestrator.processAllMonsterTurns(sessionId, encounterId).catch(...)`
4. `processAllMonsterTurns()` loops calling `processMonsterTurnIfNeeded()` until a player turn
5. `processMonsterTurnIfNeeded()`: dead→skip, stunned→skip, `isAIControlled`→true → `executeAiTurn()`
6. `executeAiTurn()`: context build → `IAiDecisionMaker.decide()` → `AiActionExecutor.execute()` → loops up to 5 iterations → `nextTurn()` at end
7. Scenario runner uses `waitForTurn` polling `GET .../tactical` until active combatant is a player

**Key**: AI loop is fully autonomous. `MockAiDecisionMaker` provides coarse behavior ("attack","flee","endTurn") but not exact action sequences.

## Q2: Programmatic `POST /sessions/:id/actions` — Monster Support?

**Yes.** Schema explicitly accepts Monster actors for `attack` and `endTurn`:
```ts
attacker: { type: "Character"; characterId } | { type: "Monster"; monsterId }
actor: { type: "Character"; characterId } | { type: "Monster"; monsterId }
```
`classAbility` is Character-only. `endTurn` validates `actorCombatantId === active.id` — monster must be the active combatant (correct behavior).

## Q3: Tabletop Endpoints — Monster actorId?

All three endpoints accept `actorId: string` with **no type restriction**:
- `POST /combat/initiate`, `/combat/roll-result`, `/combat/action`

Downstream Character-biased code:
- `initiateAction()`: `characters.find(c => c.id === actorId)` for narrative → falls back to "The adventurer". **Not a blocker.**
- `handleAttackRoll()`: `characters.find(c => c.id === actorId)` for feat modifiers → returns empty for monsters. **Fine — monsters don't have feats.**
- Lucky feat path: hardcodes `{ type: "Character", characterId: actorId }`. **Not triggered for monsters.**
- `ActionDispatcher.dispatch()`: uses `findCombatantByEntityId` matching `characterId||monsterId||npcId`. **Works for monsters.**

**Bottom line**: Tabletop endpoints work with `monsterId` as `actorId` for moves, attacks, end turn. Initiative has Character-biased lookups but degrades gracefully.

## Q4: Changes Needed

### Recommended: Option A — Suppress AI, Control Monster Turns Manually

**1. AI suppression in `MockAiDecisionMaker` / `combat-e2e.ts`:**
Add a `"manual"` behavior mode. When active, `processAllMonsterTurns` becomes a no-op. The `_inFlight` guard already exists; add a `manualMode` flag that makes the method return immediately. ALL 5+ fire-and-forget call sites (`session-actions.ts`, `reactions.ts` ×4) are covered because they all call the same method.

**2. New scenario action types in `scenario-runner.ts`:**
- `monsterAction` — like `action` but resolves actorId from monster name: `{ type: "monsterAction", actor: "Goblin", input: { text: "attack Thorin" } }`
- `monsterEndTurn` — sends `{ kind: "endTurn", actor: { type: "Monster", monsterId } }`
- `monsterRollResult` — like `rollResult` but with monster actorId
- `waitForMonsterTurn` — polls tactical until active combatant is the named monster

**3. Monster ID resolution:** `monsterIds[]` already tracks monster entity IDs by creation order. Add `resolveMonsterActorId(name)` similar to `resolveActorId` for characters — look up by name in the monster creation map.

**4. Turn advancement:** After player `endTurn`, AI is suppressed → turn advances to monster but nobody processes it. Test harness detects monster turn via `waitForMonsterTurn`, then sends `monsterAction`/`monsterRollResult`/`monsterEndTurn` to control it step-by-step.

### Alternative: Option B — Script the Mock AI Decisions
Queue exact `AiDecision` objects per monster. AI loop executes normally but decisions are predetermined.
**Pros**: No route/service changes. **Cons**: No dice control, no reaction interaction, doesn't replicate CLI flow.

## Q5: Risks & Blockers

| Risk | Severity | Mitigation |
|------|----------|------------|
| AI loop races with manual commands | HIGH | `manualMode` flag makes `processAllMonsterTurns` a complete no-op. All 5+ call sites converge on the same method |
| `RollStateMachine` Character-biased lookups | MEDIUM | Degrade gracefully (null → defaults). One hardcoded `actorRef = { type: "Character" }` at ~L555 only triggers for Lucky feat — monsters won't hit it |
| `endTurn` requires matching actor type | LOW | Scenario runner currently hardcodes `{ type: "Character" }`. New `monsterEndTurn` sends `{ type: "Monster", monsterId }` |
| Monster Multiattack vs Extra Attack | MEDIUM | AI path sets `attacksAllowedThisTurn` via `computeAttacksPerAction`. Manual path needs the harness to send multiple attack actions (one per Multiattack strike) or initialize the resource |
| Turn ordering | LOW | `waitForMonsterTurn` pattern ensures monster is active before sending commands |
| `initiateAction` not needed for monsters | LOW | Monsters skip initiative (already rolled). Manual monster turns start at the `action` phase |

### Key Implementation Detail
When manual mode is ON and a player calls `endTurn`, `processAllMonsterTurns` is a no-op, so `nextTurn()` advances the turn but nobody auto-processes it. The harness must explicitly advance through ALL monster turns. If there are 3 goblins in a row, the harness must control all 3 (or selectively enable AI for some via per-monster config).

### Where victory is checked (3 places)

**1. `damage-resolver.ts` line 529** — after `hpAfter <= 0` in tabletop dice flow:
```ts
// Re-fetches combatants AFTER HP update then evaluates
combatants = await this.deps.combatRepo.listCombatants(encounter.id);
victoryStatus = await this.deps.victoryPolicy.evaluate({ combatants }) ?? undefined;
if (victoryStatus) {
  combatEnded = true;
  await this.deps.combatRepo.updateEncounter(encounter.id, { status: victoryStatus });
  // emit CombatEnded
}
```

**2. `combat-service.ts` `nextTurn()` line 505** — before advancing turn (called by player `endTurn`, AI dead-skip, death save):
```ts
const victoryStatus = await this.victoryPolicy.evaluate({ combatants: combatantRecords });
if (victoryStatus) {
  const updated = await this.combat.updateEncounter(encounter.id, { status: victoryStatus });
  // emit CombatEnded
  return updated; // EARLY RETURN — turn does NOT advance
}
```

**3. `combat-service.ts` `makeDeathSavingThrow()` line 829** — after character death (3 failures).

### Root cause: `nextTurn()` has no guard against already-completed encounters

`resolveEncounterOrThrow()` (encounter-resolver.ts) returns encounters regardless of `status`. When `damage-resolver.ts` sets status to "Victory" and then `nextTurn()` is called again (by AI dead-skip or by CLI `endTurn`), it **re-evaluates victory and re-emits `CombatEnded` a second time**. Duplicate events can confuse the CLI's SSE handler.

`combat-service.ts` `nextTurn()` line 482 — **missing guard**:
```ts
async nextTurn(sessionId, input?) {
  const encounter = await resolveEncounterOrThrow(...); // NO status check
  // Runs full victory check even if encounter.status === "Victory"
  // → second CombatEnded event fires → CLI combat loop may re-enter
```

### Secondary issue: programmatic AI attack path has NO victory check

`attack-action-handler.ts` updates HP in DB (line 304) but **never calls victoryPolicy**:
```ts
const updatedTarget = await this.combat.updateCombatantState(targetState.id, { hpCurrent: newHp });
// No victoryPolicy.evaluate() — relies entirely on the subsequent nextTurn() call
```

In AI-vs-AI scenarios, all goblin kills go through `AttackActionHandler`. Victory is deferred to the `nextTurn()` call after the AI's turn ends. If `nextTurn()` is racing with another invocation or the encounter status is stale, victory slips through.

### Victory policy logic (verified correct for standard scenario)

- `isDying()`: returns `false` for monsters (only characters dying at 0 HP count as dying)
- Goblin faction defaults to `"enemy"`, player defaults to `"party"`
- `getRelationship("party", "enemy")` → `"enemy"` ✓
- `enemies.total > 0 && enemies.alive === 0` → `"Victory"` ✓
- **Exception**: if goblins stored with `faction: "neutral"` in DB → `getRelationship("party", "neutral")` = `"neutral"` → skipped → `enemies.total === 0` → **victory never fires**. Verify faction data in test scenario.

### Proposed fixes

**Fix 1 — `combat-service.ts` `nextTurn()` line ~487**: guard against already-ended encounters:
```ts
async nextTurn(sessionId, input?) {
  const encounter = await resolveEncounterOrThrow(...);
  // Add this guard:
  if (encounter.status !== "Active" && encounter.status !== "Pending") {
    return encounter; // already ended, nothing to do
  }
```

**Fix 2 — `attack-action-handler.ts`**: add victory check after killing a target (defense in depth):
```ts
if (newHp <= 0 && this.deps.victoryPolicy) {
  const allCombatants = await this.combat.listCombatants(encounter.id);
  const victory = await this.deps.victoryPolicy.evaluate({ combatants: allCombatants });
  if (victory) {
    await this.combat.updateEncounter(encounter.id, { status: victory });
    // emit CombatEnded
  }
}
```

---

## Bug 2: Dead combatant pathfinding — Dead bodies block movement

### File-by-file analysis

**All 4 files build `occupiedPositions` without filtering out dead combatants (HP ≤ 0).**

#### 1. `move-toward-handler.ts` line ~149
```ts
const occupiedPositions = allCombatants
  .filter((c) => c.id !== aiCombatant.id && c.id !== targetCombatant.id)
  .map((c) => (c.resources as Record<string, unknown>)?.position as { x: number; y: number })
  .filter((p): p is { x: number; y: number } => !!p && typeof p.x === "number" && typeof p.y === "number");
```
- HP accessed via: `allCombatants` are `CombatantStateRecord[]` → use `c.hpCurrent`
- **Fix**: Add `.filter((c) => c.hpCurrent > 0)` before `.map()`

#### 2. `move-away-from-handler.ts` line ~122
```ts
const occupiedPositions = allCombatants
  .filter((c) => c.id !== aiCombatant.id)
  .map((c) => (c.resources as Record<string, unknown>)?.position as { x: number; y: number })
  .filter((p): p is { x: number; y: number } => !!p && typeof p.x === "number" && typeof p.y === "number");
```
- HP accessed via: `allCombatants` are `CombatantStateRecord[]` → use `c.hpCurrent`
- **Fix**: Add `.filter((c) => c.hpCurrent > 0)` before `.map()`

#### 3. `movement-handlers.ts` line ~291
```ts
const occupiedPositions = combatantStates
  .filter(c => {
    const p = getPosition(c.resources ?? {});
    return p && !(c.characterId === (actorRef as any).characterId && actorRef.type === "Character")
               && !(c.monsterId === (actorRef as any).monsterId && actorRef.type === "Monster")
               && !(c.npcId === (actorRef as any).npcId && actorRef.type === "NPC");
  })
  .map(c => getPosition(c.resources ?? {})!)
  .filter(Boolean);
```
- HP accessed via: `combatantStates` are `CombatantStateRecord[]` → use `c.hpCurrent`
- **Fix**: Add `&& c.hpCurrent > 0` to the existing filter condition

#### 4. `session-tactical.ts` line ~213
```ts
const occupiedPositions = combatants
  .map((c) => {
    const res = (c.resources as Record<string, unknown>) ?? {};
    const pos = res.position as { x: number; y: number } | undefined;
    return pos && typeof pos.x === "number" && typeof pos.y === "number" ? pos : null;
  })
  .filter((p): p is Position => p !== null)
  .filter((p) => !(p.x === from.x && p.y === from.y));
```
- HP accessed via: `combatants` are `CombatantStateRecord[]` → use `c.hpCurrent`
- **Fix**: Add `.filter((c) => c.hpCurrent > 0)` before `.map()`, or filter in the `.map()` callback

### Proposed Fix (all 4)
Add `c.hpCurrent > 0` filter to exclude dead combatants from `occupiedPositions`. Per D&D 5e: dead creatures don't occupy space for movement blocking purposes.

---

## Bug 3: BUG-H3/H4/H5 — Combat loop auto-resolves player turns

### ⚠️ Correction to prior analysis

`AiTurnOrchestrator` already has a **per-encounter `_inFlight` concurrency guard** (line 67):
```ts
private readonly _inFlight = new Set<string>();
// processAllMonsterTurns:
if (this._inFlight.has(encounterId)) return;
this._inFlight.add(encounterId);
```
This prevents concurrent overlapping calls. The race condition theory is **incorrect** as the primary cause.

### Current turn flow for player `endTurn`

`session-actions.ts` line 51-73:
```ts
const result = await deps.combat.endTurn(sessionId, input); // awaits nextTurn()
void deps.aiOrchestrator.processAllMonsterTurns(sessionId, encounterId).catch(...); // fire-and-forget
return result;
```

`processAllMonsterTurns` → `processMonsterTurnIfNeeded` in a while loop:

```ts
// ai-turn-orchestrator.ts line ~247 — FIRST: 0 HP handling
if (currentCombatant.hpCurrent <= 0) {
  // for dying characters: set DEATH_SAVE pending, return false (stop loop)
  // for dead/stabilized: call nextTurn() then return true (continue loop)
}

// SECOND: condition handling (line ~326) — runs BEFORE isAI check
if (combatantConditions.includes("stunned") || "incapacitated" || "paralyzed") {
  await this.combatService.nextTurn(sessionId, ...); // AUTO-SKIPS ANY COMBATANT
  return true; // loop continues
}

// THIRD: isAI check (line ~354)
const isAI = await this.factionService.isAIControlled(currentCombatant);
if (!isAI) return false; // stop loop for player chars
```

### Root cause: condition skip runs BEFORE the isAI guard

**A stunned or paralyzed player character's turn is auto-skipped by the AI orchestrator** — `nextTurn()` is called for them before `isAI` is checked. This is a confirmed bug.

### Secondary cause: `isAIControlled` can return `true` for player characters

`faction-service.ts` line ~147:
```ts
async isAIControlled(combatant) {
  if (combatant.combatantType === "Character" && combatant.characterId) {
    const character = await this.deps.characters.getById(combatant.characterId);
    return character?.aiControlled ?? false; // <-- if aiControlled: true in DB, AI takes player's turn
  }
}
```
If the test scenario creates the character with `aiControlled: true`, the AI orchestrator will execute their turn and emit attacks against whatever targets are available (including dead goblins if `AttackActionHandler`'s guard `hpCurrent <= 0` somehow doesn't prevent targeting them).

**Verify**: does the test's character creation call set `aiControlled: true`?

### Dead goblin skip calling `nextTurn()` — this IS correct

The dead-goblin skip in `processMonsterTurnIfNeeded` calls `nextTurn()` and `nextTurn()` detects victory. The outer loop then checks `encAfter.status !== "Active"` and breaks. This path works correctly.

### `advanceTurnOrder` correctly lands on player after skipping dead goblins

`combat-service.ts` line 629 — verified: the loop calls `combat.endTurn()` for each dead non-character monster until reaching an alive combatant or a character, then breaks. If all 4 goblins are dead, Thorin (alive character) is the next active combatant.

### Proposed fixes

**Fix 1 — `ai-turn-orchestrator.ts` `processMonsterTurnIfNeeded()`**: move `isAIControlled` check BEFORE the condition skip:
```ts
// After 0 HP handling, BEFORE condition check:
const isAI = await this.factionService.isAIControlled(currentCombatant);
if (!isAI) return false; // player chars exit immediately regardless of conditions

// THEN: condition check (only for AI combatants)
if (combatantConditions.includes("stunned") || ...) {
  await this.combatService.nextTurn(...);
  return true;
}
```

**Fix 2 — Test scenario data**: verify the character's `aiControlled` flag is `false` (or absent). If the faction test creates Thorin as AI-controlled, the server correctly runs his turn — the fix is in the scenario data, not the code.

---

## Impact Summary

| File | Change | Risk |
|------|--------|------|
| `combat-service.ts` `nextTurn()` | Add `status !== Active/Pending` early return | Low — prevents duplicate CombatEnded events |
| `attack-action-handler.ts` | Add victory check after HP drop to 0 | Low — defense in depth, no behavioral change when policy already runs |
| `ai-turn-orchestrator.ts` `processMonsterTurnIfNeeded` | Move `isAIControlled` check before condition skip | Low — only affects AI flow, no change for non-AI combatants |
| `movement-handlers.ts` | Add `c.hpCurrent > 0` filter | Low — pure filter, no state mutation |
| `move-toward-handler.ts` | Add `c.hpCurrent > 0` filter | Low |
| `move-away-from-handler.ts` | Add `c.hpCurrent > 0` filter | Low |
| `session-tactical.ts` | Add `c.hpCurrent > 0` filter before `.map()` | Low |

## Risks

1. **`nextTurn()` guard**: Must allow `"Pending"` encounters through (pre-combat state). Use `status !== "Active" && status !== "Pending"` not just `status !== "Active"`.
2. **Pathfinding filter**: `session-tactical.ts` filter adds `.filter((c) => c.hpCurrent > 0)` on the `combatants` array before `.map()`. The combatants type is `CombatantStateRecord[]` from `listCombatants()` — `hpCurrent` is always present.
3. **Condition skip reorder**: After moving `isAI` check before conditions, AI orchestrator will NO LONGER auto-skip stunned player characters. The CLI must display "you are stunned" and let the player end their own turn — this is actually correct D&D behavior.
4. **Bug H6 data root cause**: If goblins in the faction test have `faction: "neutral"` in DB, no code fix helps — the scenario data must be corrected. Verify monster faction values in the test setup.
