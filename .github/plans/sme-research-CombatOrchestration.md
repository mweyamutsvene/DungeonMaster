# SME Research — CombatOrchestration — Monster Action Queueing

## Scope
- Files read: `combat-service.ts` (endTurn ~L844-877, nextTurn ~L482), `ai-turn-orchestrator.ts` (~L1-830), `session-actions.ts` (~L1-170), `session-tabletop.ts` (~L1-350), `tabletop-combat-service.ts` (~L1-400), `action-dispatcher.ts` (~L110-170), `roll-state-machine.ts` (~L430-560), `scenario-runner.ts` (endTurn, configureAi, action types), `combat-e2e.ts` (~L50-170)
- Task: Enable E2E test harness to script exact monster actions step-by-step instead of relying on AI decision maker

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
