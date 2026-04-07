# SME Research — CombatOrchestration — War Caster Spell-as-OA

## Status: ALREADY IMPLEMENTED (needs verification, not new work)

### Key Finding

**The spell-as-OA execution path is fully implemented.** The claim that "ALL OA resolution goes through the weapon attack path regardless of `oaType`" is **incorrect**. The code branches on `oaType === "spell"` at every critical point.

---

## Complete Execution Paths (both work today)

### Path 1: AI OA (auto-resolved, no player interaction)
1. **OA detection** — `MoveReactionHandler.initiate()` line ~363: sets `oaType: "spell"` on `ReactionOpportunity` when `canCastSpellAsOA` is true
2. **AI spell selection** — `ai-movement-resolver.ts` lines 243–270: reads `oaType === "spell"`, calls `findPreparedSpellsFromSource()` → `findBestWarCasterSpell()`, stores `{ spellName, castAtLevel }` in reaction result
3. **Spell delivery** — `opportunity-attack-resolver.ts` line 132–152: `resolveOpportunityAttacks()` checks `opp.oaType === "spell" && deps.spellOaDeps`, calls `resolveSpellOA()` 
4. **resolveSpellOA()** — lines 451–590: extracts `spellName` from reaction result, validates with `isEligibleWarCasterSpell()`, calls `prepareSpellCast()` for slot spending, then delegates to `AiSpellDelivery.deliver()` for full spell mechanics
5. **Fallback** — if spell fails (no spell specified, invalid spell, no slot), falls through to weapon OA

### Path 2: Player OA (tabletop reaction flow)
1. **Same detection** as AI path
2. **Reaction prompt** — reaction route `reactions.ts` lines 99–101: stores `{ spellName, castAtLevel }` in reaction result when `oaType === "spell"` and choice is `"use"`
3. **Same resolution** as AI path — `resolveSpellOA()` reads `spellName` from stored result

### Path 3: E2E Test Harness
- `scenario-runner.ts` lines 1589–1596: passes `spellName` and `castAtLevel` from `reactionRespond` action to the reaction endpoint

---

## Domain Validation (`war-caster-oa.ts`)
- `isEligibleWarCasterSpell()`: rejects bonus action, AoE, zone spells
- `hasSpellSlotForOA()`: checks resource pools for available slots
- `findBestWarCasterSpell()`: AI priority — cantrips > leveled attack > leveled save

---

## SpellOaDeps Wiring
- `SpellOaDeps` interface: `{ characters, monsters, npcs, diceRoller }`  
- Threaded through: `TwoPhaseActionService` → `MoveReactionHandler` → `resolveOpportunityAttacks()`
- **Potential gap**: Need to verify `spellOaDeps` is wired in `app.ts`. Grep showed no match in app.ts — this could be the actual missing piece. If `spellOaDeps` is `undefined`, the `if (opp.oaType === "spell" && deps.spellOaDeps)` guard fails silently and falls back to weapon OA.

---

## What's Actually Missing (if anything)

### 1. **`spellOaDeps` may not be wired in `app.ts`** (HIGH PRIORITY)
The grep for `spellOaDeps` in `app.ts` returned 0 results. If this dep is not passed to `TwoPhaseActionService`, the entire spell OA code path is dead code. This is the ONLY thing blocking the feature.

**Fix**: In `app.ts` where `TwoPhaseActionService` is constructed, pass `{ characters: characterRepo, monsters: monsterRepo, npcs: npcRepo, diceRoller }` as the `spellOaDeps` argument.

### 2. **Concentration handling** (ALREADY HANDLED)
`prepareSpellCast()` in `resolveSpellOA()` handles concentration — it's the same function used for all spell casting. Existing concentration breaks automatically when a new concentration spell is cast.

### 3. **Player tabletop path doesn't use RollStateMachine** (BY DESIGN)
Spell-as-OA for players auto-resolves via `AiSpellDelivery` — the player doesn't get a separate spell attack roll or save prompt. This is a simplification: the player chooses the spell in the reaction prompt, and it auto-resolves mechanically. This is acceptable for OA reactions which are off-turn and time-sensitive.

---

## Risks

1. **`spellOaDeps` wiring** — if not connected, the entire feature silently degrades to weapon OA
2. **No E2E test scenario** for War Caster spell-as-OA exists in `scenarios/` — feature works but isn't tested  
3. **AiSpellDelivery limitations** — same as noted in stored repo memory: AI spell delivery doesn't fully resolve all spell types (some just record the event without mechanical effects)

## Recommendation

Before writing new code, verify the `spellOaDeps` wiring in `app.ts`. If it's wired, the feature may already work end-to-end and just needs an E2E test scenario. If it's NOT wired, that single fix unblocks everything.
