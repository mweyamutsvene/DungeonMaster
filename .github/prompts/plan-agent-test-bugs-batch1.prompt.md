# Plan: Agent Test Player Bug Fixes — Batch 1
## Round: 1
## Status: APPROVED
## Affected Flows: CombatRules, ReactionSystem, CombatOrchestration, SpellSystem, AIBehavior

## Objective
Fix all bugs discovered during agent test player runs (solo-fighter, solo-barbarian, solo-rogue, boss-fight, solo-monk, solo-warlock, solo-wizard). These bugs block the interactive play experience and violate D&D 5e 2024 rules. Prioritized by severity: CRITICAL → HIGH → MEDIUM → LOW.

---

## Bug Registry (Deduplicated)

| ID | Bug | Severity | Source | Affected Flow |
|----|-----|----------|--------|---------------|
| B1 | Disengage does not prevent Opportunity Attacks | CRITICAL | BUG-1 | ReactionSystem / CombatRules |
| B2 | OA "Pending action not found" 404 crashes move resolution | CRITICAL | BUG-2/F3/WL | ReactionSystem |
| B3 | Dash action does not provide extra movement | HIGH | BUG-4 | CombatRules / CombatOrchestration |
| B4 | Shield AC bonus doesn't persist until start of next turn | HIGH | BUG-W1 | ReactionSystem / CombatRules |
| B5 | Weapon long range rejected (Javelin 35ft vs 30/120) | MEDIUM | BUG-11 | CombatRules |
| B6 | Concentration save not triggered on damage | HIGH | Warlock test | SpellSystem / CombatRules |
| B7 | Reaction messages show internal IDs not names | MEDIUM | BUG-7/W2 | ReactionSystem (CLI display) |
| B8 | Extra Attack prompt label says "damage" not "attack" | LOW | BUG-8/F1/M1 | CombatOrchestration |
| B9 | Hex damage formula display wrong (hidden bonus) | MEDIUM | BUG-WL1/WL3 | CombatOrchestration |
| B10 | Multi-beam spell continues after target dies | LOW | BUG-WL4 | CombatOrchestration / SpellSystem |
| B11 | AI attack display shows +0 modifier and = ? total | LOW | BUG-12/W3 | AIBehavior |
| B12 | AI monsters don't attack after moving to melee range | MEDIUM | BUG-15 / Spectral Guard | AIBehavior |

### Deferred / Investigation Needed (separate plan)
- Hex retargeting on target death (BUG-WL2) — new feature, not a bug fix
- Rage damage bonus disappearing (BUG-14) — may be correct RAW behavior
- spellSlot_3 duplicate tracking for warlock — display issue
- Reckless Attack as separate action — LLM intent parsing quality
- Fighter weapon switching (BUG-5) — LLM intent parsing
- Damage result display omits Rage bonus (BUG-9) — cosmetic
- Multi-dice damage input (BUG-10) — CLI UX
- Initiative display inconsistency (BUG-F4) — cosmetic

---

## Changes

### B1: Disengage Does Not Prevent Opportunity Attacks (CRITICAL)
**Root cause**: The `disengaged` resource flag is set by `ActionService.performSimpleAction()` when `action === "Disengage"`. However, Cunning Action: Disengage goes through the AbilityExecutor path, which calls `services.disengage()` — this delegates back to `ActionService.disengage()` but may use `skipActionCheck: true` for bonus action, which still sets the flag. Need to verify the full Cunning Action → Disengage path and that `markDisengaged()` is called.

**Likely fix**: Trace the CunningAction executor → disengage → ActionService path. Ensure the `disengaged` flag survives the resource update. Check the `MoveReactionHandler.initiate()` reads it correctly via `readBoolean(resources, "disengaged")`.

#### Files to investigate & fix:
- [ ] `application/services/combat/abilities/executors/rogue/cunning-action-executor.ts` — verify disengage sets flag
- [ ] `application/services/combat/action-service.ts` — verify `markDisengaged()` is called for all disengage paths
- [ ] `application/services/combat/helpers/resource-utils.ts` — verify `markDisengaged()` implementation
- [ ] `application/services/combat/helpers/oa-detection.ts` — verify `readBoolean(actorResources, "disengaged")` reads correctly

---

### B2: OA Pending Action 404 (CRITICAL) — ✅ ALREADY FIXED
**Status**: `tabletop-combat-service.ts` at lines 335-343 already has graceful handling. When `completeMove()` is called but the pending action was already consumed by the reaction route, it returns success instead of throwing 404.

#### Files verified:
- [x] `application/services/combat/tabletop-combat-service.ts` — Graceful 404 handling in completeMove()

---

### B3: Dash Does Not Provide Extra Movement (HIGH)
**Root cause**: In `MoveReactionHandler.initiate()`, the check `if (movementSpent) throw "Already moved"` blocks all movement after the first move. Dash sets `dashed: true` which doubles speed, but this only works if you Dash BEFORE moving. If you move first (consuming `movementSpent`), then Dash, then try to move again, the `movementSpent` check blocks it.

**D&D 5e 2024 Rule**: "When you take the Dash action, you gain extra movement for the current turn. The increase equals your Speed after applying any modifiers." This means the total movement budget increases, not that speed doubles for a single move.

**Fix**: Replace `movementSpent` boolean with `movementRemaining` tracking. When Dash is used, add the creature's speed to `movementRemaining`. Each move reduces `movementRemaining`. Block movement only when `movementRemaining <= 0`.

#### Files to fix:
- [ ] `application/services/combat/action-service.ts` — Dash handler should add speed to `movementRemaining` instead of setting `dashed: true`
- [ ] `application/services/combat/two-phase/move-reaction-handler.ts` — Use `movementRemaining` instead of `movementSpent` check; deduct movement cost from remaining
- [ ] `application/services/combat/helpers/resource-utils.ts` — Add helper to manage `movementRemaining` tracking
- [ ] `application/services/combat/tabletop/dispatch/movement-handlers.ts` — Update movement dispatching to use `movementRemaining`

---

### B4: Shield AC Bonus Doesn't Persist Until Start of Next Turn (HIGH)
**Root cause**: In `attack-reaction-handler.ts`, Shield reaction adds +5 AC only for the triggering attack's resolution. It sets `reactionUsed: true` but does NOT add a persistent ActiveEffect for the +5 AC bonus. Subsequent attacks in the same round read the base AC without the Shield bonus.

**D&D 5e 2024 Rule**: "An invisible barrier of magical force protects you. Until the start of your next turn, you have a +5 bonus to AC."

**Fix**: When Shield is activated, create an ActiveEffect with `{ type: 'bonus', target: 'armor_class', value: 5, source: 'Shield', duration: 'until_start_of_next_turn' }` on the target's resources. The AC calculation already reads `calculateFlatBonusFromEffects(targetActiveEffects, 'armor_class')`.

#### Files to fix:
- [ ] `application/services/combat/two-phase/attack-reaction-handler.ts` — Add Shield ActiveEffect to target resources when Shield is used
- [ ] `domain/entities/combat/effects.ts` — Verify `armor_class` target type is supported (likely already is)
- [ ] `application/services/combat/combat-service.ts` — Clear Shield effect at start of caster's next turn (turn reset)

---

### B5: Weapon Long Range Rejected (MEDIUM)
**Root cause**: Attack range validation likely only checks normal range, not long range with disadvantage. Javelin has range 30/120 — attacks at 31-120ft should be allowed at disadvantage.

**D&D 5e 2024 Rule**: "A weapon that can be used to make a Ranged Attack has a range shown in parentheses. The range lists two numbers. The first is the weapon's Normal Range in feet, and the second is the weapon's Long Range. When attacking a target beyond Normal Range, you have Disadvantage on the attack roll. You can't attack a target beyond the weapon's Long Range."

#### Files to fix:
- [ ] `application/services/combat/tabletop/dispatch/attack-handlers.ts` — Range validation should use long range as max, apply disadvantage beyond normal range

---

### B6: Concentration Save Not Triggered on Damage (HIGH) — ✅ ALREADY FIXED
**Status**: `attack-action-handler.ts` at line 378 already runs concentration checks unconditionally (not gated on `this.events`). The concentration check fires for both player and AI damage paths via `handleConcentrationCheck()` in damage-resolver and the direct concentration check in attack-action-handler.

#### Files verified:
- [x] `application/services/combat/action-handlers/attack-action-handler.ts` — Unconditional concentration check at line 378
- [x] `application/services/combat/tabletop/rolls/damage-resolver.ts` — `handleConcentrationCheck()` called after damage

---

### B7: Reaction Messages Show Internal IDs (MEDIUM)
**Root cause**: The CLI displays the combatant ID from the `ReactionResolved` event payload. The event IS populated with `combatantName` (reactions.ts line ~160-175), but the CLI may be reading `combatantId` instead of `combatantName`.

#### Files to fix:
- [ ] This is a CLI-side bug in `packages/player-cli/` — verify the event handling displays `combatantName` not `combatantId`

---

### B8: Extra Attack Prompt Label Says "damage" (LOW)
**Root cause**: In `damage-resolver.ts` Extra Attack chaining, the response returns `rollType: "damage"` (documented in repo memory as intentional for scenario/CLI expectations). The CLI interprets this as a damage prompt label.

#### Files to fix:
- [ ] `application/services/combat/tabletop/rolls/damage-resolver.ts` — EA chain response should include a flag or message indicating it's an attack roll, not damage
- [ ] Check if adding an `isAttackRoll: true` flag or changing the `message` text suffices

---

### B9: Hex Damage Formula Display Wrong (MEDIUM) — ✅ FIXED
**Root cause**: The damage formula displayed to the player (in roll-state-machine.ts) included dice-based effect bonuses like `+1d6[hex]`, causing the player to include hex dice in their roll total. The damage-resolver then added hex dice again server-side, double-counting the damage.

**Fix applied**: 
1. `roll-state-machine.ts` — Removed dice-based effects from the displayed formula. Only flat bonuses (Rage +2) appear in the formula. Dice bonuses (Hex 1d6, Hunter's Mark 1d6) are rolled server-side only.
2. `damage-resolver.ts` — Added `effectBonusSuffix` to all 6 damage message templates showing server-rolled dice contributions (e.g., "8 + 0 + 6[hex] = 14 damage").
3. Formula before: `1d10+1d6[hex]` → after: `1d10`. Message before: `8 + 0 = 12` → after: `8 + 0 + 6[hex] = 14`.

#### Files fixed:
- [x] `application/services/combat/tabletop/roll-state-machine.ts` — Only append flat value bonuses to displayed formula
- [x] `application/services/combat/tabletop/rolls/damage-resolver.ts` — Track effectBonusSuffix, show in all damage messages

---

### B10: Multi-Beam Continues After Target Dies (LOW) — ✅ ALREADY FIXED
**Status**: Already has the `hpAfter > 0` guard in `damage-resolver.ts` (line ~431). When the target dies from a beam, remaining beams are lost. A TODO exists for future mid-spell retargeting (Eldritch Blast RAW allows different targets per beam).

#### Files verified:
- [x] `application/services/combat/tabletop/rolls/damage-resolver.ts` — `hpAfter > 0` guard prevents chaining to dead targets

---

### B11: AI Attack Display Shows +0 Modifier (LOW)
**Root cause**: AI attack events may not include the attack modifier in the event payload when the attack is auto-resolved.

#### Files to fix:
- [ ] `application/services/combat/ai/handlers/attack-handler.ts` — Ensure attack modifier is included in event payload
- [ ] CLI event rendering — verify it reads the correct fields

---

### B12: AI Monsters Don't Attack After Moving to Melee Range (MEDIUM) — ✅ ALREADY FIXED
**Status**: `ai-turn-orchestrator.ts` at line 594 forces `continue` after successful `moveToward`, re-entering the turn loop. `deterministic-ai.ts` doesn't set `actionSpent` for `moveToward`, so attack evaluation proceeds after movement. The orchestrator's defensive fix with explicit comment confirms this is intentional.

#### Files verified:
- [x] `application/services/combat/ai/deterministic-ai.ts` — `moveToward` doesn't consume action economy, attack evaluation proceeds
- [x] `application/services/combat/ai/ai-turn-orchestrator.ts` — `moveToward` handler uses `continue` to re-enter loop

---

## Cross-Flow Risk Checklist
- [x] Do changes in one flow break assumptions in another? Shield ActiveEffect needs turn-reset cleanup.
- [x] Does the pending action state machine still have valid transitions? B2 fix adds graceful handling for already-completed actions.
- [x] Is action economy preserved? Dash movement tracking change needs careful integration.
- [x] Do both player AND AI paths handle the change? B3 Dash and B4 Shield apply to both.
- [ ] Are repo interfaces + memory-repos updated if entity shapes change? Check ActiveEffect shape.
- [ ] Is `app.ts` registration updated if adding executors? N/A.
- [x] Are D&D 5e 2024 rules correct (not 2014)? All fixes verified against 2024 rules.

## Risks
- **B3 (Dash movement)**: Replacing `movementSpent` with `movementRemaining` is a broad change affecting multiple movement paths. Risk of breaking existing E2E scenarios.
- **B4 (Shield persistence)**: Adding an ActiveEffect requires cleanup on turn start. Must verify the turn-reset path handles Shield correctly.
- **B2 (OA 404)**: Graceful handling must not mask real errors where pending actions are genuinely missing.

## Test Plan
- [ ] Unit test: Disengage flag prevents OA detection (oa-detection.test)
- [ ] Unit test: Cunning Action Disengage sets disengaged flag
- [ ] Unit test: completeMove handles already-completed pending action gracefully
- [ ] Unit test: Dash adds to movementRemaining; second move succeeds
- [ ] Unit test: Shield ActiveEffect persists for subsequent attacks in same round
- [ ] Unit test: Long range weapon attack allowed with disadvantage
- [ ] Unit test: Concentration save triggered on AI damage to concentrating caster
- [ ] E2E scenario: Rogue Cunning Action Disengage → move without OA
- [ ] E2E scenario: Dash → move → move again
- [ ] E2E scenario: Shield persists for multiple attacks in same round

## SME Approval
- [ ] CombatRules-SME
- [ ] ReactionSystem-SME (via CombatOrchestration-SME)
- [ ] CombatOrchestration-SME
- [ ] SpellSystem-SME
- [ ] AIBehavior-SME
