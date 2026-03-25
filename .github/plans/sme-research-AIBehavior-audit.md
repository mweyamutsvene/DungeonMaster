# AIBehavior SME Research — Comprehensive Audit

## 1. AI Decision Making

### Implemented
- **LLM-based decision making** via `IAiDecisionMaker` port ([ai-types.ts](packages/game-server/src/application/services/combat/ai/ai-types.ts)) with `LlmAiDecisionMaker` adapter ([ai-decision-maker.ts](packages/game-server/src/infrastructure/llm/ai-decision-maker.ts))
- **Multi-step turn loop** in `AiTurnOrchestrator.executeAiTurn()` ([ai-turn-orchestrator.ts](packages/game-server/src/application/services/combat/ai/ai-turn-orchestrator.ts#L340)): up to 5 iterations per turn, refreshes combatant state after each action
- **14 action handlers** in registry pattern ([handlers/](packages/game-server/src/application/services/combat/ai/handlers/)): attack, move, moveToward, moveAwayFrom, dash, dodge, disengage, help, castSpell, shove, grapple, escapeGrapple, hide, search, useObject, endTurn
- **Action economy enforcement** server-side in `AiActionExecutor.execute()` — rejects actions when actionSpent is true
- **Failure tracking**: 2 consecutive failures → end turn (~line 476 orchestrator)
- **JSON retry**: one retry with explicit JSON-only instruction on parse failure ([ai-decision-maker.ts](packages/game-server/src/infrastructure/llm/ai-decision-maker.ts#L96))

### Missing
- **No deterministic AI brain** — when LLM fails to parse or returns null, the AI just ends its turn. No heuristic-based fallback decision engine. Severity: **Critical**
- **No evaluation of multiple options** — LLM produces one decision per call; no branching/scoring of alternatives. Severity: **Nice-to-have** (LLM handles this internally)
- **No difficulty scaling** — no way to make AI play optimally vs. suboptimally based on a difficulty setting. Severity: **Nice-to-have**

---

## 2. Battle Plan Generation

### Implemented
- **`BattlePlanService`** ([battle-plan-service.ts](packages/game-server/src/application/services/combat/ai/battle-plan-service.ts)): faction-level battle plans with 5 priorities (offensive/defensive/retreat/protect/ambush)
- **`LlmBattlePlanner`** ([battle-planner.ts](packages/game-server/src/infrastructure/llm/battle-planner.ts)): LLM-backed plan generation with creature roles, focus targets, retreat conditions
- **Replan heuristics** (4 triggers): stale plan (≥2 rounds), ally died, HP crisis (>25% loss), new threat reinforcements
- **Battlefield snapshot** captured at plan generation for replan heuristics
- **Plan view scoping** — each combatant sees only its own role via `getPlanViewForCombatant()`
- **Plan integrated into context** — `battlePlan` section in LLM prompt includes priority, focusTarget, yourRole, tacticalNotes, retreatCondition

### Missing
- **No deterministic battle plan fallback** — if LLM is unavailable, `ensurePlan()` returns null. No heuristic-based planning. Severity: **Important**
- **No multi-step turn planning** — battle plan is strategic (focus target, priority), but doesn't plan specific multi-step sequences (e.g., "Dash + Move" or "Move then Attack then Move away"). LLM decides step-by-step. Severity: **Nice-to-have**
- **No plan quality evaluation** — no validation that the LLM-generated plan makes tactical sense. Severity: **Nice-to-have**

---

## 3. Tactical Context

### Implemented (Very Thorough)
- **Self context**: HP/AC/speed/size/abilityScores/spellSaveDC/spellAttackBonus, conditions, position, action economy (actionSpent/bonusActionSpent/reactionSpent/movementSpent/movementRemaining), resource pools (ki/spell slots/rage/etc.), active buffs, concentration spell, damage resistances/immunities/vulnerabilities, traits, attacks, actions, bonusActions, reactions, spells, abilities, features, classAbilities
- **Allies**: HP/AC/speed/class/level, conditions, position, distance, knownAbilities, damage defenses, deathSaves, concentrationSpell
- **Enemies**: HP/AC/speed/class/level, conditions, position, distance, spellSaveDC, knownAbilities, damage defenses, concentrationSpell, deathSaves
- **Battlefield**: ASCII grid rendering with legend via `renderBattlefield()`
- **Zones**: center, radius, shape, source, type, effects with trigger/damage/save info
- **Recent narrative**: last 10 NarrativeText events for continuity
- **Action history & turn results**: previous steps in current turn
- **Battle plan view**: faction strategy, focus target, creature role
- **Potion availability**: `hasPotions` flag for pre-filtering useObject
- **Pre-computed distances**: `distanceFeet` on all allies/enemies

### Missing
- **No cover information** — terrain cover bonuses not included in context. Severity: **Important**
- **No threat assessment scores** — enemies are listed but not ranked by danger. Severity: **Nice-to-have** (LLM can infer)
- **No initiative order** — while `initiative` value is included, turn order isn't explicit. Severity: **Nice-to-have**

---

## 4. Monster AI Behavior

### Implemented
- **Uniform AI pipeline** — all combatant types (Monster/NPC/Character) go through the same `AiTurnOrchestrator` pipeline
- **Stat block awareness** — full stat block data (traits, attacks, actions, bonusActions, reactions, spells, abilities, features) passed to LLM
- **LLM personality guidance** in system prompt: "Act in character based on the combatant's type, traits, and style"
- **Monster bonus actions** supported (e.g., Goblin's Nimble Escape)
- **Multiattack** mentioned in prompt as single-action multiple attacks

### Missing
- **No behavioral archetypes** — no system for tagging monsters as aggressive/defensive/support/ranged/cowardly. LLM must infer from stat block. Severity: **Important**
- **No legendary actions** — no support for legendary actions (3 per round, between other turns). Severity: **Important** (for boss monsters)
- **No lair actions** — no support for lair actions on initiative count 20. Severity: **Important** (for boss encounters)
- **No pack tactics / swarm behavior** — no special coordination for wolf-like creatures. Severity: **Nice-to-have** (LLM may handle)
- **No Multiattack execution** — system prompt mentions it but there's no handler that dispatches multiple attacks in one action. The loop handles it via `endTurn: false` which is fragile. Severity: **Important**

---

## 5. Spell AI

### Implemented
- **`CastSpellHandler`** ([cast-spell-handler.ts](packages/game-server/src/application/services/combat/ai/handlers/cast-spell-handler.ts)): handles spell casting with slot validation via `prepareSpellCast()`
- **Counterspell reaction detection** — uses `twoPhaseActions.initiateSpellCast()` for reaction opportunities
- **Concentration tracking** — checks for existing concentration via `findPreparedSpellInSheet()`, warns LLM about auto-drop in prompt
- **Spell context** — full spells array passed to LLM, resource pools include spellSlot_1 through spellSlot_9
- **Resource validation prompt** — LLM instructed to check `current > 0` before casting leveled spells
- **Cantrip awareness** — prompt notes cantrips don't consume slots

### Missing
- **No spell target selection intelligence** — LLM picks targets, but no server-side validation of spell range, number of targets, or area coverage before attempting. Severity: **Important**
- **No AoE optimization** — no calculation of how many enemies a Fireball would hit at a given position. Severity: **Important**
- **No spell priority/value assessment** — no guidance on which spells are best in which situations. Severity: **Nice-to-have** (LLM handles)
- **No upcasting logic** — `spellLevel` field exists but no guidance in prompts about when upcasting is worthwhile. Severity: **Nice-to-have**

---

## 6. Reaction AI

### Implemented
- **`aiDecideReaction()`** in `AiTurnOrchestrator` (~line 100): simple heuristic for OA and Shield/Counterspell
  - OA: decline if below 25% HP, otherwise always use
  - Shield/Counterspell: always attempt
  - Default: always use reaction
- **OA trigger detection** — `MoveHandler`, `MoveTowardHandler`, `MoveAwayFromHandler` all use `resolveAiMovement()` which triggers OA checks
- **Shield/Deflect Attacks** — `AttackHandler` detects `hasShieldPrepared` and `hasReactionAvailable` on targets, routes through `AiAttackResolver` two-phase flow
- **Counterspell** — `CastSpellHandler` initiates spell cast through two-phase service for counterspell opportunities

### Missing
- **No LLM-based reaction decisions** — reaction logic is pure heuristic, not LLM-driven. The TODO comment says "can be enhanced with LLM later". Severity: **Important**
- **No reaction priority** — AI doesn't weigh "save Shield for the big hit" vs. "use it now". Severity: **Important**
- **No Absorb Elements** — while `detectDamageReactions` is imported in `AiAttackResolver`, AI-controlled casters don't get prompted to use Absorb Elements. Severity: **Nice-to-have**
- **No Hellish Rebuke / other reaction spells** for AI casters. Severity: **Nice-to-have**

---

## 7. Morale / Tactical Retreat

### Implemented
- **LLM prompt guidance**: "Consider morale: flee if badly wounded and outnumbered, fight to death if cornered"
- **Battle plan retreat conditions** — `retreatCondition` field in `BattlePlan`, prompt says "If this condition is met, use Disengage and move away from enemies"
- **`moveAwayFrom` action** — full retreat pathfinding via `findRetreatPosition()` Dijkstra flood-fill
- **MockAiDecisionMaker "flee" behavior** for testing retreat scenarios

### Missing
- **No deterministic morale check** — no D&D-style morale rules (e.g., flee when below 50% HP and leader is dead). Entirely LLM-driven. Severity: **Important**
- **No morale tracking state** — no persistent "morale level" on combatants. Severity: **Nice-to-have**
- **No surrender/flee AI decision** — AI can move away but never surrenders or calls for parley. Severity: **Nice-to-have**

---

## 8. Multi-creature Coordination

### Implemented
- **Faction-level battle plans** with creature roles and focus targets
- **Focus fire guidance** — `focusTarget` in battle plan, mock AI prioritizes concentration casters
- **Replan on significant events** — ally death, HP crisis, new threats trigger new plan
- **LLM prompt** includes "GROUP TACTICS" section: coordinate with allies, focus fire, role diversity

### Missing
- **No explicit flanking coordination** — no system for placing creatures on opposite sides for flanking advantage. Severity: **Important**
- **No formation awareness** — no concept of front-line/back-line positioning strategy. Severity: **Important**
- **No communication between turns** — each creature decides independently with only the battle plan as shared context. No "creature A will hold, creature B will flank". Severity: **Nice-to-have**
- **No focus fire enforcement** — `focusTarget` is advisory; the LLM may ignore it. Severity: **Nice-to-have**

---

## 9. LLM Fallback

### Implemented
- **`fallbackSimpleTurn()`** in `AiTurnOrchestrator` (~line 597): activates when `aiDecisionMaker` is undefined
  - Only works for monsters with stat blocks
  - Targets first alive Character combatant
  - Uses first available attack
  - Single attack then ends turn — no movement, no bonus actions
- **Mock AI** (`MockAiDecisionMaker` in [mocks/index.ts](packages/game-server/src/infrastructure/llm/mocks/index.ts#L724)): 9 behaviors (attack, endTurn, flee, castSpell, approach, grapple, escapeGrapple, hide, usePotion), smart Prone handling, concentration caster targeting

### Missing
- **Fallback is minimal** — no movement, no bonus actions, no spell casting, no retreating, no multiattack. Just hits the first player with the first attack. Severity: **Critical**
- **No rules-based AI alternative** — when LLM fails mid-combat (returns null), the turn just ends. No "at least try to attack the nearest enemy". Severity: **Critical**
- **No fallback for NPC/Character AI** — fallback only handles monsters with stat blocks. NPCs and AI characters get skipped. Severity: **Important**

---

## 10. Target Selection

### Implemented
- **LLM prompt guidance**: focus fire wounded enemies, protect allies, pick soft targets, prefer concentration casters
- **Battle plan focus target** — faction-level target priority
- **Mock AI**: prioritizes concentration casters, falls back to first living enemy
- **Death save awareness** — context includes dying ally/enemy death saves for triage decisions
- **Damage defense awareness** — LLM instructed to avoid immune/resistant targets, prefer vulnerable targets

### Missing
- **No deterministic target scoring** — no server-side "threat assessment" or "target priority" calculation. Severity: **Important**
- **No threat ranking in context** — enemies are listed flat; no computed danger score or DPR estimate. Severity: **Nice-to-have**
- **No healing target prioritization** — for healer AI, no guidance on which ally is most worth healing. Severity: **Nice-to-have**

---

## 11. Positioning AI

### Implemented
- **A* pathfinding** in `MoveTowardHandler` via `findPath()` / `findAdjacentPosition()`
- **Dijkstra retreat** in `MoveAwayFromHandler` via `findRetreatPosition()`
- **Zone avoidance** — A* pathfinding penalizes zone cells, prompt warns about damaging zones
- **Prone stand-up** — both LLM prompt and MockAiDecisionMaker handle standing up before attacking
- **Opportunity attack awareness** — movement triggers OA checks; Disengage mentioned in prompt
- **Dash mechanics** — correctly handled: Dash doubles speed, then must move

### Missing
- **No cover-seeking behavior** — no system for identifying cover positions on the map. Severity: **Important**
- **No range maintenance** — ranged attackers don't specifically try to maintain optimal range (e.g., stay at 30ft, never enter melee). Severity: **Important**
- **No off-turn positioning** — after attacking, no guidance to move away if still having movement. The prompt mentions "PRIORITIZE movement after attacking" but enforcement is LLM-dependent. Severity: **Important**
- **No chokepoint awareness** — no identification of narrow passages for defensive positioning. Severity: **Nice-to-have**

---

## 12. AI Use of Class Features

### Implemented
- **Bonus actions** via `executeBonusAction()` in `AiActionExecutor`: supports AbilityRegistry executors + legacy string matching
- **Nimble Escape** (Goblin): disengage/hide as bonus action
- **Cunning Action** (Rogue): dash/disengage/hide as bonus action
- **Class abilities in context** — `classAbilities` array with name, economy, resourceCost, effect
- **Resource pool tracking** — ki, spell slots, rage, actionSurge, secondWind, channelDivinity, layOnHands, pactMagic
- **Rage tracking** — `rageAttackedThisTurn` flag set during attack resolution

### Missing
- **No Action Surge execution** by AI — no handler triggers Action Surge (an extra action). The LLM could request it but there's no specific support. Severity: **Important**
- **No Rage initiation** by AI barbarians — no trigger for starting Rage on first turn. Severity: **Important**
- **No Divine Smite** by AI paladins — no mechanism for deciding to smite on hit. Severity: **Important**
- **No Sneak Attack awareness** — AI rogues don't get guidance about Sneak Attack conditions (advantage or ally adjacent). Severity: **Important**
- **No Lay on Hands** by AI paladins — listed in classAbilities but unclear if executor works for AI healing. Severity: **Nice-to-have**
- **No Second Wind** by AI fighters — missing explicit trigger. Severity: **Nice-to-have**
- **No Flurry of Blows** by AI monks — listed as bonus action but unclear if AI knows when to use it. Severity: **Nice-to-have**

---

## Summary: Priority Items

### Critical (AI is broken/useless without these)
1. **No deterministic fallback AI** — when LLM is unavailable or fails, AI barely functions
2. **Minimal fallback behavior** — single attack, no movement, no bonus/class features

### Important (AI makes notably bad decisions)
3. No behavioral archetypes for monster types
4. No legendary/lair actions for boss monsters
5. No Multiattack as first-class handler
6. No LLM-based reaction decisions (Shield/Counterspell priority)
7. No deterministic morale system
8. No flanking/formation coordination
9. No cover-seeking or range maintenance positioning
10. No AoE spell optimization
11. No AI use of key class features (Action Surge, Rage, Smite)
12. No deterministic battle plan fallback
13. No deterministic target scoring
14. No cover information in tactical context
15. No spell range/target validation before attempting

### Nice-to-have (Edge cases, polish)
16. Difficulty settings, multi-option evaluation
17. Morale state persistence, surrender behavior
18. Chokepoint awareness, initiative order in context
19. Upcasting guidance, healing priority
