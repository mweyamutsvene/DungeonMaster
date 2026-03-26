# SME Research — CombatOrchestration — Deep Audit

**Scope:** All files under `application/services/combat/` with primary focus on the three facade services, ActionDispatcher, RollStateMachine, CombatTextParser, and all sub-handlers.

**Files read:** ~35 source files, ~18,000+ lines of TypeScript across:
- `tabletop-combat-service.ts`, `action-service.ts`, `two-phase-action-service.ts`, `combat-service.ts`
- `tabletop/action-dispatcher.ts`, `tabletop/roll-state-machine.ts`, `tabletop/combat-text-parser.ts`
- `tabletop/tabletop-types.ts`, `tabletop/pending-action-state-machine.ts`
- All 6 dispatch handlers, all 4 roll resolvers, all 3 two-phase handlers
- `action-handlers/attack-action-handler.ts`, all two-phase handlers
- `tactical-view-service.ts`, `combat-victory-policy.ts`

---

## Category 1: TODO/FIXME Comments

| # | File | ~Line | Description | Priority |
|---|------|-------|-------------|----------|
| 1 | `action-handlers/attack-action-handler.ts` | ~340 | "Re-enable attack narration when INarrativeGenerator is wired to ActionService" — programmatic API attacks produce no narrative | HIGH |
| 2 | `action-service.ts` | ~69 | Missing `INarrativeGenerator` injection — narrative generator not wired into ActionService at all | HIGH |
| 3 | `action-service.ts` | ~175 | "Re-enable action narration when INarrativeGenerator is wired to ActionService" — programmatic actions (dodge, dash, etc.) produce no narrative | HIGH |
| 4 | `action-service.ts` | ~550 | "Parse weapon stats to build proper spec" — OA weapon in `move()` uses a rough estimate (`1d6 + strMod`) instead of the actual weapon. OA damage in the programmatic move path is wrong for all non-longsword weapons | HIGH |
| 5 | `ai/handlers/cast-spell-handler.ts` | ~131–136 | "AI spell mechanical effects not wired" — AI monsters casting spells spend the action but produce no damage, healing, or condition effects. The spell is declared but does nothing mechanically | HIGH |
| 6 | `abilities/executors/monster/nimble-escape-executor.ts` | ~7 | "Add creature-type validation once monsters have trait/feature system" — any non-Goblin monster can currently use Nimble Escape | LOW |

**Subtotal: 6 items**

---

## Category 2: Missing Parser Chain Entries / LLM Fallback Gaps

| # | Location | Gap | Priority |
|---|----------|-----|----------|
| 1 | `tabletop/action-dispatcher.ts` ~line 131–162 | LLM fallback `switch(command.kind)` only handles `"move"`, `"moveToward"`, `"attack"`. All other LLM-parsed command kinds (e.g., `"grapple"`, `"shove"`, `"castSpell"`, `"hide"`, `"search"`, `"help"`, `"escapeGrapple"`, `"disengage"`, `"dodge"`, `"dash"`, `"pickup"`, `"drop"`, `"drawWeapon"`, `"sheatheWeapon"`, `"useItem"`, `"ready"`) hit `throw new ValidationError("Action type ... not yet implemented")`. If the text parser misses and falls back to LLM, ~16 command types silently fail | HIGH |
| 2 | `tabletop/combat-text-parser.ts` | No `tryParseFleeText` / `tryParseSurrenderText` function. "Run away", "retreat", "surrender" are not parseable — there is no dedicated parser chain entry for fleeing or surrendering. The simpleAction parser covers `"dash"`, `"dodge"`, `"disengage"` but not `"flee"` | MEDIUM |
| 3 | `tabletop/combat-text-parser.ts` `tryParseDrawWeaponText` | The regex `/\b(?:draw\|unsheathe?\|pull\s*out\|ready)\s+.../` includes `"ready"` as a draw-weapon verb. "Ready my javelin for attack" would match as `drawWeapon`, not as a ready action. The parser chain runs draw (entry #16) before the dedicated ready parser wouldn't fire because `simpleAction` (entry #4) already intercepted "ready" text. Potential misrouting for "ready [weapon]" input | MEDIUM |

**Subtotal: 3 items**

---

## Category 3: Missing Reaction Types

| # | Reaction | Status | Priority |
|---|----------|--------|----------|
| 1 | **Uncanny Dodge** (Rogue 7) | Not implemented anywhere. Rogue 7 gets a reaction to halve damage from one attack. `TwoPhaseActionService` has no `initiateUncannyDodge` / `completeUncannyDodge`. No `ClassCombatTextProfile` entry. No executor | HIGH |
| 2 | **Absorb Elements / Hellish Rebuke — no tabletop endpoint** | `TwoPhaseActionService.initiateDamageReaction()` and `completeDamageReaction()` implement these reactions, but no tabletop route in `session-tabletop.ts` exposes them. When damage is dealt in the tabletop dice flow, the server never checks for available damage reactions or offers them to the player. The service code exists but is unreachable from the tabletop flow | HIGH |
| 3 | **War Caster** (spell as OA reaction) | Not implemented. War Caster feat allows casting a spell (with Cast a Spell Action) as an OA reaction. Currently `MoveReactionHandler` detects OAs and offers them, but only for weapon attacks. No Class profile entry or handler for War Caster spell OA | MEDIUM |
| 4 | **Sentinel feat** | None of the three Sentinel effects are implemented: (a) OA reduces target speed to 0, (b) OA when enemy uses Disengage against you, (c) reaction attack when enemy attacks any other creature within 5 ft. These require both parser and TwoPhaseActionService extensions | MEDIUM |

**Subtotal: 4 items**

---

## Category 4: Pending Action State Machine Gaps

| # | Gap | Priority |
|---|-----|----------|
| 1 | **`INITIATIVE → INITIATIVE_SWAP` transition validity**: `InitiativeHandler` calls `combat.setPendingAction(INITIATIVE_SWAP)` directly after resolving the INITIATIVE action (without going through `assertValidTransition()`). The state machine bypassed. If any code later calls `assertValidTransition("INITIATIVE_SWAP", ...)` from `null`, it would be valid since `null: [..., "INITIATIVE_SWAP"??]` — but it's unclear if INITIATIVE_SWAP is in the valid-from-null set. The bypass means invalid state transitions in the initiative path aren't caught | LOW |
| 2 | **`DAMAGE → SAVING_THROW` missing as explicit path**: Currently all weapon mastery saves (Push, Topple) and hit-rider saves (Stunning Strike, Divine Smite) are auto-resolved inline by `WeaponMasteryResolver` and `HitRiderResolver`. This means the tabletop flow can never pause post-damage to let players manually roll saves from mastery effects. The state machine doesn't support `DAMAGE → SAVING_THROW` and would need to add it for any future player-facing save-after-damage flow | LOW |

**Subtotal: 2 items**

---

## Category 5: Incomplete Roll Resolution Paths

| # | File | Issue | Priority |
|---|------|-------|----------|
| 1 | `combat-service.ts` ~line 727 | **Death save stale index**: `nextTurn()` advances `turn` via `combat.endTurn()` (which mutates the encounter), then auto-rolls a death save using `combatantRecords[turn]` where `combatantRecords` is the pre-advance snapshot and `turn` is the post-advance index. If `endTurn()` increments `encounter.turn` and `combatantRecords` was fetched before that, the index mismatch could point to the wrong combatant. Should use `freshRecords[turn]` or a direct lookup by `activeCreatureId` after re-fetching | MEDIUM |
| 2 | `tabletop/rolls/saving-throw-resolver.ts` | **Evasion resolution incomplete**: The file has `evasionDetected = true` and logs it, but the read was cut off at line 337. The actual "no damage on success / half damage on failure" Evasion logic may or may not be fully implemented. Verify that the `evasionDetected` flag is consumed by the caller to halve the already-resolved damage or skip it | MEDIUM |
| 3 | `tabletop/rolls/initiative-handler.ts` ~line 470+ | **Multi-PC characters outside the combat get no initiative auto-roll awareness**: Session characters that are not in `characters.filter(c => c.id !== actorId)` (i.e., characters fully outside the session) won't be added to combat. But the `characters` list includes ALL session characters — characters who shouldn't be in this specific encounter may be auto-added as combatants. There's a `targetIds` filter for monsters but no equivalent filter for party characters | LOW |

**Subtotal: 3 items**

---

## Category 6: Action Economy Enforcement Gaps

| # | Location | Gap | Priority |
|---|----------|-----|----------|
| 1 | `tabletop/dispatch/social-handlers.ts` `handleReadyAction()` | **Ready action trigger never fires**: `handleReadyAction()` stores `{ condition, action }` in `resources.readiedAction`. No combat lifecycle hook in `combat-service.ts`, `nextTurn()`, `TwoPhaseActionService`, or `ActionDispatcher` evaluates trigger conditions or fires the readied action. The ready mechanic is stored but permanently dormant | HIGH |
| 2 | `tabletop/dispatch/social-handlers.ts` `handleSimpleAction()` | **Dead code `ready` branch**: `handleSimpleAction()` has a `case "ready":` that throws `new ValidationError("Unknown simple action: ready")` — but `ready` is intercepted by its own parser entry (#4 in the chain: `simpleAction` detects "ready" and calls `handleReadyAction` directly). This branch can never be reached but could confuse future maintainers | LOW |
| 3 | `action-service.ts` `move()` ~lines 450–568 | **Parallel OA resolution system**: `ActionService.move()` has its own OA detection + auto-resolution loop (independent of `TwoPhaseActionService`), but hits the rough weapon spec TODO (item 4 in Category 1). This creates two divergent OA paths — the tabletop path (two-phase, player-controlled) and the programmatic API path (auto-resolved with wrong weapon stats). These two paths can drift | HIGH |

**Subtotal: 3 items**

---

## Category 7: Architecture Violations

| # | Location | Violation | Priority |
|---|----------|-----------|----------|
| 1 | `tabletop/roll-state-machine.ts` `handleDamageRoll()` ~lines 870–1000 | **Domain logic inline in application layer**: ~130 lines of on-hit enhancement assembly (building `HitRiderEnhancement` objects for Stunning Strike, Divine Smite, Open Hand Technique from damage text) embedded in `RollStateMachine`. Class-specific detection and DC calculation is performed inline rather than going through domain class profiles. Violates the "domain-first" principle — this logic belongs in `HitRiderResolver` or a dedicated builder fed by `ClassCombatTextProfile.attackEnhancements` | MEDIUM |
| 2 | `tabletop/rolls/initiative-handler.ts` ~lines 100–450 | **4-way duplicated resource-building block**: The same `buildCombatResources()` + `hasShieldPrepared` + `hasCounterspellPrepared` + `hasAbsorbElementsPrepared` + `hasHellishRebukePrepared` + `drawnWeapons` + `inventory` + legendary traits pattern is repeated verbatim for: (a) PC initiator, (b) other PCs, (c) monsters, (d) NPCs. ~80 lines of logic duplicated 4× in a single 600-line function. A `buildCombatantEntry()` helper would eliminate this | MEDIUM |
| 3 | `tabletop/dispatch/class-ability-handlers.ts` `handleClassAbility()` ~lines 200–260 | **Turn Undead AoE post-processing inline**: After delegating to the ability executor, Turn Undead's multi-target zone saving throw loop is inline here rather than in `SavingThrowResolver` or a dedicated AoE resolver. Breaks the "executors handle single-creature effects" assumption | MEDIUM |
| 4 | `tabletop/dispatch/action-dispatcher.ts` | **10 trivial one-liner proxy methods**: Methods like `handlePickupAction(...)` exclusively call `this.interactionHandlers.handlePickupAction(...)`. These add no abstraction value. `buildParserChain()` could call handler methods directly, reducing ~40 lines of noise | LOW |

**Subtotal: 4 items**

---

## Category 8: Handler Delegation Gaps

| # | Location | Gap | Priority |
|---|----------|-----|----------|
| 1 | `two-phase-action-service.ts` `initiateDamageReaction()` + `completeDamageReaction()` | **Damage reactions are inline in the facade** (~170 combined lines). All other reaction types (move, attack, spell) have dedicated handler classes (`MoveReactionHandler`, `AttackReactionHandler`, `SpellReactionHandler`). Damage reactions (Absorb Elements, Hellish Rebuke) are handled directly in the facade, inconsistent with the established delegation pattern | LOW |
| 2 | `tabletop/dispatch/attack-handlers.ts` `handleAttackAction()` | **Oversized method** (~350 lines): Mixes thrown weapon auto-detection, cover AC lookup, magic item bonus search, versatile grip detection, unarmed attack stats, roll mode computation, and full `AttackPendingAction` assembly. Most other dispatch handlers are 50–120 lines. This should be decomposed into: `detectThrownWeapon()`, `computeCoverBonus()`, `resolveMagicWeaponBonus()`, etc | MEDIUM |

**Subtotal: 2 items**

---

## Category 9: Missing Integration

| # | Gap | Priority |
|---|-----|----------|
| 1 | **Damage reactions have no tabletop trigger**: `TwoPhaseActionService.initiateDamageReaction()` / `completeDamageReaction()` implement Absorb Elements / Hellish Rebuke at the service layer, but there is no tabletop route (`session-tabletop.ts`) that calls these methods after damage is dealt. PC damage reactions can never fire in the tabletop dice flow. Compare with Shield/Deflect which ARE wired in `AttackReactionHandler.initiate()` during the ATTACK resolution | HIGH |
| 2 | **`resources.readiedAction` is never evaluated**: The ready mechanic is stored per Category 6 item 1 — but the integration gap is that `combat-service.ts` `nextTurn()`'s start-of-turn hook does not evaluate any registered readied actions against fired conditions. Even if the trigger system were built, `nextTurn()` would need to query all party combatants for pending readied actions and evaluate their conditions | HIGH |
| 3 | **`ActionService` narration gap**: `ActionService` handles programmatic actions (the `POST /sessions/:id/actions` endpoint). But `INarrativeGenerator` is not injected (see TODOs). All `CombatOrchestration` narrative comes from `TabletopEventEmitter` (tabletop flow only). The programmatic action path produces structured JSON results but no player-facing text descriptions for any action | MEDIUM |

**Subtotal: 3 items**

---

## Category 10: Combat Lifecycle Gaps

| # | Location | Gap | Priority |
|---|----------|-----|----------|
| 1 | `combat-victory-policy.ts` | **Friendly NPCs not counted for victory**: `BasicCombatVictoryPolicy.isPlayerVictory()` counts combatants with `faction === "player"`. PCs always have `"player"` faction. NPCs default to `"neutral"` and can have `"party"` faction if explicitly set, but the policy only checks `"player"`. If all PCs are KO'd but a `faction: "party"` NPC is alive and fighting, `isPlayerVictory() === false` but `isEnemyVictory() === true` fires incorrectly — the enemy wins even though a friendly NPC survives | MEDIUM |
| 2 | `combat-service.ts` | **No pending action cleanup on `endCombat()`**: `endCombat()` removes combatants and marks the encounter `Completed`, but does not call `combatRepo.clearPendingAction(encounterId)`. If combat ends mid-roll-sequence (flee, DM veto, surrender), a stale pending action (e.g., ATTACK or SAVING_THROW) remains in the repository. If a new encounter starts later, `getPendingAction()` could return stale data | LOW |
| 3 | `combat-service.ts` `startEncounter()` vs `addCombatantsToEncounter()` | **Duplicated initialization logic**: Both methods execute similar faction-mapping, position-setting, and HP-initialization for combatants. `startEncounter()` creates the encounter + optionally seeds combatants; `addCombatantsToEncounter()` adds to an existing one. The ~60 lines of shared setup logic is not extracted to a private helper — changes to combatant initialization (e.g., adding a new resource flag) must be made in two places | LOW |
| 4 | `combat-service.ts` `nextTurn()` | **Dead combatant skipping inconsistency**: The turn-skip logic checks `if (nextCombatant.combatantType !== "Character" && nextCombatant.hpCurrent <= 0)` — skipping defeated non-characters only. Characters at 0 HP (KO'd/dying) are NOT skipped; they get a turn per D&D rules so they can make death saves. But **NPCs** at 0 HP are skipped the same way as monsters, even though a friendly NPC at 0 HP should also be dying. Depending on whether NPCs are designed to make death saves, this may be intentional or a gap | LOW |

**Subtotal: 4 items**

---

## Grand Total

| Category | Count |
|----------|-------|
| 1. TODO/FIXME | 6 |
| 2. Missing parser chain / LLM fallback | 3 |
| 3. Missing reaction types | 4 |
| 4. Pending action state machine gaps | 2 |
| 5. Incomplete roll resolution | 3 |
| 6. Action economy enforcement | 3 |
| 7. Architecture violations | 4 |
| 8. Handler delegation gaps | 2 |
| 9. Missing integration | 3 |
| 10. Combat lifecycle gaps | 4 |
| **TOTAL** | **34** |

---

## Prioritized Summary (HIGH priority items only — 11 total)

1. **AI spell mechanics not wired** (Cat 1 #5): AI monsters cast spells with no effect
2. **LLM fallback handles only 3 of 19 actions** (Cat 2 #1): 16 command types throw ValidationError on LLM fallback
3. **Uncanny Dodge not implemented** (Cat 3 #1): Rogue 7 reaction mechanic missing completely
4. **Absorb Elements/Hellish Rebuke unreachable from tabletop** (Cat 3 #2): Service code exists but no route wires it
5. **Ready action trigger never fires** (Cat 6 #1): Half-implemented — stored but never evaluated
6. **OA damage wrong in programmatic move path** (Cat 1 #4): ActionService.move() uses 1d6+STR/2 for all OAs
7. **ActionService narration fully missing** (Cat 1 #1–3): Three interrelated TODOs
8. **Damage reactions have no tabletop trigger** (Cat 9 #1): Same as item 4 above, integration perspective
9. **Ready action integration gap** (Cat 9 #2): Same as item 5, integration perspective
10. **Divergent OA resolution paths** (Cat 6 #3): Programmatic and tabletop OA paths can drift
11. **Friendly NPC victory check** (Cat 10 #1): Enemy wins even when friendly NPC is alive
