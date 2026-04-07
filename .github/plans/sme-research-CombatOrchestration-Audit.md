# CombatOrchestration Deep Dive Audit Report

**Date**: 2025-04-06
**Scope**: Full audit of CombatOrchestration flow — facades, parser chain, roll state machine, two-phase reactions, action handlers, tactical view, combat service lifecycle.

---

## 1. Missing Combat Orchestration Features

### 1.1 Readied Action Trigger Execution — INCOMPLETE (Medium)
**Files**: `dispatch/social-handlers.ts`, `two-phase/move-reaction-handler.ts`, `helpers/opportunity-attack-resolver.ts`

The Ready action can be **stored** (SocialHandlers.handleReadyAction stores `readiedAction` in resources) and **triggered during movement** (MoveReactionHandler detects `creature_moves_within_range` triggers and creates `readied_action` reaction opportunities). However:

- **Only `creature_moves_within_range` trigger type is checked during movement.** The `creature_attacks` trigger is never checked. Readied actions with "when X attacks" triggers will never fire.
- **Readied spell concentrations** are not handled — D&D 5e 2024 states if you Ready a spell, you must concentrate on it until the trigger fires. No concentration tracking for readied spells.
- **Readied actions from non-attack response types** (`dash`, `move`, `disengage`) store correctly but `opportunity-attack-resolver.ts` only resolves `readied_action` as if it were always an attack (line 427-428). Non-attack readied responses are silently ignored.
- **Readied action expiry** at start-of-next-turn: `resetTurnResources()` clears `readiedAction: undefined` (resource-utils.ts:198), which is correct. But there's no event/notification when a readied action expires unused.

### 1.2 Mounted Combat — NOT IMPLEMENTED (Low)
No references to mount, dismount, riding, or mounted combat anywhere in the orchestration flow. This is a significant D&D 5e feature set but is understandably a lower priority for a basic combat engine.

### 1.3 Environmental Interactions Beyond Items — PARTIAL (Low)
Item interactions (pickup, drop, draw, sheathe, use) are fully implemented. Zone effects (Spirit Guardians, Cloud of Daggers) and terrain modifiers are implemented. However:
- **Destroying objects** (doors, walls, etc.) is not supported as a combat action
- **Environmental hazards** beyond zones (falling, lava, etc.) are not modeled

### 1.4 Legendary Actions — PARTIAL (Medium)
**Files**: `combat-service.ts`, `helpers/resource-utils.ts`

Legendary action charges are initialized at combat start and reset at start-of-legendary-creature's-turn (combat-service.ts line ~645). However:
- **Legendary action spending between turns** (the core mechanic — legendary creatures take legendary actions at END of OTHER creatures' turns) is not orchestrated in `nextTurn()`. The charges are tracked but there's no trigger point for AI to spend them between turns.
- Lair actions at initiative count 20 are tracked in resources but not triggered.

### 1.5 Bonus Action Spell Limitations — NOT ENFORCED (Medium)
D&D 5e 2024 rule: If you cast a spell with a bonus action, the only other spell you can cast that turn is a cantrip with a casting time of one action. This restriction is not enforced anywhere in the orchestration layer. A player could cast Healing Word (bonus action spell) and then Fireball (action spell) in the same turn.

---

## 2. Incomplete State Machine Flows

### 2.1 Pending Action State Machine — Well-Structured but Soft (Low)
**File**: `tabletop/pending-action-state-machine.ts`

The state machine is **observability-only** — `assertValidTransition()` logs a `console.warn` in non-production but never throws. This is intentionally soft. However:
- `VALID_PENDING_TRANSITIONS` does NOT include transitions from pending actions to `reaction_pending` state. The two-phase pending action system (`PendingActionRepository`) runs in parallel with the encounter-level `setPendingAction/clearPendingAction`. These two state machines are **not unified**.
- When a damage reaction is initiated from the route layer (post-roll-result), the encounter's `pendingAction` is set to `reaction_pending` but this isn't modeled in `VALID_PENDING_TRANSITIONS`. This is a conceptual gap rather than a bug.

### 2.2 INITIATIVE_SWAP State — Well-Implemented (No Issues)
The Alert feat swap is properly handled: INITIATIVE → INITIATIVE_SWAP → null. Text parsing for "swap with X" / "decline" is clean.

### 2.3 Flurry of Blows Multi-Strike — Correct (No Issues)
ATTACK(flurryStrike=1) → DAMAGE → ATTACK(flurryStrike=2) → DAMAGE → null. Both strike-1-miss and strike-1-hit paths correctly chain to strike 2.

### 2.4 Death Save → Turn Advance — POTENTIAL RACE (Low)
**File**: `roll-state-machine.ts` (handleDeathSaveRoll)

After a death save, the handler calls `this.deps.combat.nextTurn()` and then fire-and-forgets `aiOrchestrator.processAllMonsterTurns()`. If the next combatant is also a character needing death saves, the nested `nextTurn()` call could hit re-entrant state. In practice this works because `nextTurn` auto-rolls death saves (unless `skipDeathSaveAutoRoll`), but the fire-and-forget pattern could cause issues with concurrent requests.

---

## 3. ActionDispatcher Parser Chain Gaps

### 3.1 Parser Chain — Comprehensive (19 entries, well-ordered)
The chain covers: move, moveToward, jump, simpleAction (dash/dodge/disengage/ready), classAction, hide, search, offhand, help, shove, escapeGrapple, grapple, castSpell, pickup, drop, drawWeapon, sheatheWeapon, useItem, attack.

### 3.2 Missing Parser: "End Turn" / "Pass" (Low)
There's no parser for "end turn", "pass", "skip turn", or "do nothing". Players must use the explicit `POST /combat/next` endpoint. This is arguably by design (turn advancement is a lifecycle action, not a text action), but a convenience parser could route to `endTurn`.

### 3.3 Missing Parser: "Throw Weapon" as Distinct Action (Low)
Thrown weapon attacks are handled within `handleAttackAction()` when a weapon has the Thrown property. There's no distinct `tryParseThrowText()`. The current approach (attack + thrown weapon detection) works fine but means "throw my javelin at the goblin" requires the attack verb, not just "throw".

### 3.4 Parser Priority: `useItem` vs `classAction` Disambiguation — HANDLED (No Issues)
Entry #18 (useItem) explicitly checks `tryMatchClassAction(stripped, profiles)` to avoid stealing "use flurry of blows" as an item use. This is a good guard.

### 3.5 Parser: `tryParseSimpleActionText` too Greedy (Low)
**File**: `combat-text-parser.ts`

`tryParseSimpleActionText` uses `\b(dash)\b` which matches "dash" anywhere in the text. "I dash toward the goblin" would match as "dash" but the player's intent is move-toward + dash. Since simpleAction (priority 4) comes before moveToward (priority 2... wait, no — moveToward is priority 2, simpleAction is priority 4, so moveToward gets tried first). Actually this is fine — moveToward at priority 2 would catch "dash toward the goblin" if it had a pattern for it. But `tryParseMoveTowardText` doesn't match "dash toward" — it only matches "move toward", "approach", "advance on", etc. So "dash toward the goblin" would incorrectly match as "dash" (simple action), not "move toward + auto-dash".

**Severity: Low** — edge case, but worth noting.

### 3.6 "Dodge" vs "Uncanny Dodge" Confusion (Low)
`tryParseSimpleActionText` matches `\b(dodge)\b`. If a player says "uncanny dodge", this would parse as "dodge" (the action). Uncanny Dodge is a reaction, not an action, so it should never be text-parsed in the action flow — but a player typing it could get confused.

---

## 4. RollStateMachine Issues

### 4.1 RollStateMachine Size — 1556 Lines (Medium)
The module has been well-decomposed with `InitiativeHandler`, `HitRiderResolver`, `WeaponMasteryResolver`, and `SavingThrowResolver` extracted into `rolls/`. The remaining ~1556 lines handle: `processRollResult`, `handleAttackRoll`, `handleDamageRoll`, `handleDeathSaveRoll`, `handleSavingThrowAction`, `resolveWeaponMastery`, `resolvePostDamageEffect`, `dropThrownWeaponOnGround`, `dropMonsterLoot`, and `parseRollValue`.

The `handleDamageRoll` method alone is ~370 lines — it handles damage application, resistance/immunity, concentration checks, retaliatory damage, KO effects, Sneak Attack, weapon mastery, hit-rider enhancements, loot drops, victory checks, flurry chaining. This is the densest method in the codebase and a candidate for further decomposition.

**Recommendation**: Extract `handleDamageRoll` into a `DamageResolver` class in `rolls/`, similar to how initiative was extracted.

### 4.2 Redundant `listCombatants` Calls (Medium)
**File**: `roll-state-machine.ts` (handleAttackRoll, handleDamageRoll)

Both methods make **multiple** `this.deps.combatRepo.listCombatants(encounter.id)` calls within a single execution — sometimes 5-7 calls in handleDamageRoll alone (for rage tracking, condition checks, sneak attack, enhancements, defenses, retaliatory damage, loot). Each call is a database read. These should be consolidated into a single fetch with the result threaded through.

### 4.3 Missing Roll Type: Ability Check (Low)
The pending action types handle: INITIATIVE, INITIATIVE_SWAP, ATTACK, DAMAGE, DEATH_SAVE, SAVING_THROW. There's no ABILITY_CHECK type for contested checks (Grapple contests, certain skill checks). Currently, grapple/shove are auto-resolved by the server. If tabletop mode ever needs player-rolled skill checks, a new pending action type would be needed.

### 4.4 `parseRollValue` Fallback Chain — Fragile (Low)
**File**: `roll-state-machine.ts`

The roll parsing chain tries: regex number extraction → LLM intent → fallback to extracted number. When the LLM is configured, it's called even for simple "I rolled 15" inputs. The early `looksLikeARoll` check helps, but the LLM fallback is expensive for what's usually a simple number.

---

## 5. Two-Phase Action (Reaction) Gaps

### 5.1 Attack Reactions — Comprehensive
**File**: `two-phase/attack-reaction-handler.ts`

Currently handles:
- **Shield** (spell reaction, +5 AC)
- **Deflect Attacks** (Monk reaction, damage reduction + ki redirect)
- **Uncanny Dodge** (Rogue reaction, halve damage)
- **Sentinel** (feat, ally-defense reaction attack)
- **Damage reactions** (Absorb Elements, Hellish Rebuke) via DamageReactionHandler

### 5.2 Move Reactions — Comprehensive
**File**: `two-phase/move-reaction-handler.ts`

Handles:
- **Opportunity Attacks** (standard + War Caster spell OAs)
- **Readied Actions** triggered by movement
- **Zone damage** on movement (Spike Growth, Spirit Guardians)
- **Voluntary move triggers** (Booming Blade)
- **Grapple drag** during movement
- **Prone stand-up** cost

### 5.3 Spell Reactions — Partial (Medium)
**File**: `two-phase/spell-reaction-handler.ts`

Handles **Counterspell** only. Missing:
- **Silvery Barbs** (1st-level reaction spell to force a reroll) — not implemented
- **Absorb Elements** as a pre-cast reaction to spell damage (currently only handles post-damage via DamageReactionHandler)

### 5.4 TODO: Incapacitation Check in Sentinel (Medium)
**File**: `attack-reaction-handler.ts:214`

```typescript
observerIncapacitated: false, // TODO: check incapacitation from conditions
```

The Sentinel reaction opportunity always reports `observerIncapacitated: false`, skipping the actual condition check. An incapacitated creature with Sentinel could still make a reaction attack, which is incorrect per D&D rules.

### 5.5 Missing Reaction: Interception Fighting Style (Low)
D&D 5e 2024 Interception fighting style: "When a creature you can see hits a target, other than you, within 5 feet of you with an attack, you can use your reaction to reduce the damage." Not implemented.

### 5.6 Missing Reaction: Protection Fighting Style (Low)
D&D 5e 2024 Protection fighting style: "When a creature you can see attacks a target other than you within 5 feet, you can use your reaction to impose disadvantage." Not implemented.

---

## 6. Code Quality / Architecture Issues

### 6.1 CombatService at ~1083 Lines — Growing (Medium)
**File**: `combat-service.ts`

CombatService handles: getEncounterState, startEncounter, addCombatantsToEncounter, endCombat, nextTurn, endTurn, makeDeathSavingThrow, processActiveEffectsAtTurnEvent, processZoneTurnTriggers, cleanupExpiredZones, updateCombatantPatch. The `nextTurn` method alone is ~280 lines.

`processActiveEffectsAtTurnEvent` is ~200 lines of zone/effect processing logic that could be extracted to a dedicated `TurnEffectProcessor` helper.

### 6.2 Duplicated Combatant Lookup Patterns (Medium)
Throughout the codebase, the pattern `combatants.find((c: any) => c.characterId === id || c.monsterId === id || c.npcId === id)` appears dozens of times. This should be a shared utility (`findCombatantByEntityId`). The `findCombatantStateByRef` helper exists but requires a `CombatantRef` — there's no single-string entity ID lookup.

### 6.3 ActionService is 568 Lines — Acceptable But Dense
**File**: `action-service.ts`

The `move()` method at ~170 lines contains its own OA detection loop that duplicates logic from `MoveReactionHandler`. The comment block explains this is the "programmatic path" (AI/server-driven) vs the "tabletop path" (player-facing two-phase). While the duplication is documented, it's a maintenance risk — changes to OA rules must be applied in both places.

### 6.4 Type Safety: Widespread `as any` Casts (Low)
**Files**: Throughout all modules

Resources are typed as `JsonValue` in the repository layer, leading to pervasive `as any` casts when accessing typed properties (`.position`, `.actionSpent`, `.raging`, etc.). The `normalizeResources()` function provides some safety but the intermediate reads still use `as any`. A typed `CombatantResources` interface would reduce runtime errors.

### 6.5 Thin Facade Pattern — Well Maintained
All three facades (TabletopCombatService, ActionService, TwoPhaseActionService) stay thin and delegate properly:
- TabletopCombatService: 4 public methods, ~435 lines (including the lengthy initiateAction)
- ActionService: delegates to AttackActionHandler, GrappleActionHandler, SkillActionHandler
- TwoPhaseActionService: delegates to MoveReactionHandler, AttackReactionHandler, SpellReactionHandler, DamageReactionHandler

### 6.6 TabletopCombatService.completeMove — Has Inline OA Resolution (Medium)
**File**: `tabletop-combat-service.ts` (lines ~335-470)

The `completeMove` method contains ~135 lines of inline player OA roll processing (attack roll → damage roll → recurse). This is complex two-phase roll resolution that lives in the facade rather than being delegated. Should be extracted to a dedicated handler or moved into `MoveReactionHandler.complete()`.

---

## 7. Summary Severity Table

| # | Finding | Severity | File(s) |
|---|---------|----------|---------|
| 1.1 | Readied action triggers incomplete (only movement trigger works) | **Medium** | social-handlers.ts, move-reaction-handler.ts |
| 1.4 | Legendary actions between turns not orchestrated | **Medium** | combat-service.ts |
| 1.5 | Bonus action spell limitations not enforced | **Medium** | action-dispatcher.ts, spell-action-handler.ts |
| 4.1 | handleDamageRoll is ~370 lines, candidate for extraction | **Medium** | roll-state-machine.ts |
| 4.2 | Redundant listCombatants calls (5-7 per damage resolution) | **Medium** | roll-state-machine.ts |
| 5.4 | TODO: Incapacitation not checked for Sentinel reactions | **Medium** | attack-reaction-handler.ts:214 |
| 6.1 | CombatService at 1083 lines, nextTurn ~280 lines | **Medium** | combat-service.ts |
| 6.2 | Duplicated combatant-by-entity-ID lookup pattern | **Medium** | Multiple files |
| 6.3 | Dual OA paths (ActionService.move vs MoveReactionHandler) | **Medium** | action-service.ts, move-reaction-handler.ts |
| 6.6 | completeMove has inline OA roll logic in facade | **Medium** | tabletop-combat-service.ts |
| 1.2 | Mounted combat not implemented | **Low** | — |
| 1.3 | Environmental interactions limited to zones/items | **Low** | — |
| 2.1 | Two parallel pending action state machines not unified | **Low** | pending-action-state-machine.ts |
| 2.4 | Death save → turn advance fire-and-forget race potential | **Low** | roll-state-machine.ts |
| 3.2 | No "end turn" / "pass" text parser | **Low** | combat-text-parser.ts |
| 3.5 | "dash toward goblin" incorrectly parsed as Dash action | **Low** | combat-text-parser.ts |
| 4.3 | No ABILITY_CHECK pending action type | **Low** | tabletop-types.ts |
| 4.4 | parseRollValue LLM fallback expensive for simple rolls | **Low** | roll-state-machine.ts |
| 5.3 | Silvery Barbs reaction not supported | **Low** | spell-reaction-handler.ts |
| 5.5 | Interception fighting style not implemented | **Low** | — |
| 5.6 | Protection fighting style not implemented | **Low** | — |
| 6.4 | Pervasive `as any` casts on resources/conditions | **Low** | Multiple files |

---

## 8. Positive Observations

1. **Parser chain architecture is excellent** — clean, extensible, well-documented priority ordering
2. **Exhaustive handler maps** using `Record<PendingActionType, ...>` provide compile-time safety — adding a new pending action type forces all handlers to be updated
3. **Two-phase reaction system is thorough** — Shield, Deflect Attacks + Ki Redirect, Counterspell, Sentinel, Absorb Elements, Hellish Rebuke, Uncanny Dodge, War Caster OAs all working
4. **Concentration checks on damage** are properly implemented (auto-CON-save, auto-break on KO)
5. **Weapon mastery system** (Graze, Vex, Topple, etc.) is cleanly separated in WeaponMasteryResolver
6. **Hit-rider enhancement pipeline** (Stunning Strike, Divine Smite, OHT) is generic and extensible via ClassCombatTextProfile
7. **Zone damage resolution** for movement and turn triggers is comprehensive
8. **Grapple drag mechanics** during movement are well-implemented with size-based speed modifiers
