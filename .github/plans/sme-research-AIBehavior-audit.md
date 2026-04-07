# AIBehavior Flow — Comprehensive Audit Report

**SME**: AIBehavior  
**Date**: April 6, 2026  
**Scope**: `application/services/combat/ai/**`, `infrastructure/llm/**`  
**Files Reviewed**: 30+ source files, all handlers, all LLM providers, all test files

---

## 1. Missing AI Combat Behaviors

### 1.1 Spell Casting AI — Partially Implemented

| Issue | File | Severity |
|-------|------|----------|
| **AI spell delivery does NOT handle zone/area-placement spells** (Spirit Guardians, Spike Growth, Cloud of Daggers, Wall of Fire). `AiSpellDelivery.deliver()` only handles: attack-roll, healing, save-based, buff/debuff. No handler creates zone entries on the combat map. | [ai-spell-delivery.ts](packages/game-server/src/application/services/combat/ai/handlers/ai-spell-delivery.ts) | **CRITICAL** |
| **AI cannot cast bonus-action spells separately** — deterministic AI's `pickSpell()` returns a decision with `endTurn: true` for most spells, but D&D 5e allows a bonus-action spell (Healing Word, Misty Step) plus a cantrip as the action. The `isBonusAction` field is parsed but not properly routed through the bonus action economy. | [deterministic-ai.ts](packages/game-server/src/application/services/combat/ai/deterministic-ai.ts#L280-L310) | **MEDIUM** |
| **AI doesn't evaluate multi-target spells** — `pickSpell()` only considers single-target spells. No evaluation of AoE value (how many enemies would be caught in a Fireball, for instance). | [deterministic-ai.ts](packages/game-server/src/application/services/combat/ai/deterministic-ai.ts#L275) | **MEDIUM** |
| **AI concentrating casters don't evaluate concentration replacement** — if already concentrating, deterministic AI simply filters out concentration spells. A better heuristic would compare the value of the current concentration spell vs. a new one. | [deterministic-ai.ts](packages/game-server/src/application/services/combat/ai/deterministic-ai.ts#L290) | **LOW** |

### 1.2 Tactical Positioning — Partially Implemented

| Issue | File | Severity |
|-------|------|----------|
| **No cover-seeking behavior** — the context provides `coverFromMe` data to the LLM, and the deterministic AI knows about zones via pathfinding, but neither actively seeks cover positions. Ranged AI should position behind half/three-quarters cover when possible. | [deterministic-ai.ts](packages/game-server/src/application/services/combat/ai/deterministic-ai.ts#L430-L450), [ai-decision-maker.ts](packages/game-server/src/infrastructure/llm/ai-decision-maker.ts) | **MEDIUM** |
| **No flanking-seeking behavior** — `AiAttackResolver` detects flanking for advantage but the deterministic AI doesn't try to position for flanking when moving. | [deterministic-ai.ts](packages/game-server/src/application/services/combat/ai/deterministic-ai.ts#L435) | **LOW** |
| **Ranged AI repositioning is simplistic** — backs away if <10ft, moves closer if >60ft, but doesn't consider optimal range bands (normal vs disadvantage range) or kiting patterns. | [deterministic-ai.ts](packages/game-server/src/application/services/combat/ai/deterministic-ai.ts#L440-L455) | **LOW** |

### 1.3 Retreat Behavior — Implemented (Basic)

| Issue | File | Severity |
|-------|------|----------|
| **Retreat threshold is hard-coded** — retreats only at <25% HP with >1 enemy. No retreat on morale failure, no evaluation of "can I survive one more hit?" | [deterministic-ai.ts](packages/game-server/src/application/services/combat/ai/deterministic-ai.ts#L520-L530) | **LOW** |
| **No Disengage-before-retreat logic in deterministic AI** — the deterministic AI uses `moveAwayFrom` which provokes OAs. Should use `disengage` + `moveAwayFrom` when adjacent to enemies. The LLM prompt explains this but deterministic AI doesn't implement it. | [deterministic-ai.ts](packages/game-server/src/application/services/combat/ai/deterministic-ai.ts#L525) | **MEDIUM** |

### 1.4 Healing Priority — Implemented (Basic)

| Issue | File | Severity |
|-------|------|----------|
| **No triage for dying allies** — deterministic AI's `pickSpell()` checks for allies <50% HP for healing, but doesn't prioritize dying allies (0 HP with death saves). The context includes `deathSaves` data on allies. | [deterministic-ai.ts](packages/game-server/src/application/services/combat/ai/deterministic-ai.ts#L300-L320) | **MEDIUM** |
| **No Spare the Dying / Help action for dying allies** — AI never considers Help action (stabilize) or Spare the Dying cantrip for dying allies, despite having death save data in context. | [deterministic-ai.ts](packages/game-server/src/application/services/combat/ai/deterministic-ai.ts) | **MEDIUM** |
| **Healing potion usage doesn't consider allies** — `useObject` handler only heals self; no logic to use a potion on an adjacent dying ally. | [use-object-handler.ts](packages/game-server/src/application/services/combat/ai/handlers/use-object-handler.ts) | **LOW** |

### 1.5 Buff/Debuff Usage — Partially Implemented

| Issue | File | Severity |
|-------|------|----------|
| **Deterministic AI doesn't evaluate buff spells** — `pickSpell()` only considers healing and damage spells. Buff spells (Bless, Shield of Faith, Haste) and debuff spells (Hold Person, Bane) are ignored unless they have `damage` or `healing` fields. | [deterministic-ai.ts](packages/game-server/src/application/services/combat/ai/deterministic-ai.ts#L275-L370) | **MEDIUM** |
| **AiSpellDelivery handles buff/debuff** but deterministic AI never selects these spells, so the delivery code path is effectively dead for non-LLM play. | [ai-spell-delivery.ts](packages/game-server/src/application/services/combat/ai/handlers/ai-spell-delivery.ts#L330) | **MEDIUM** |

### 1.6 Environmental Awareness — Implemented (Good)

| Issue | File | Severity |
|-------|------|----------|
| Zone awareness is well-implemented: contexts include zones, pathfinding penalizes zones, LLM prompt includes detailed zone guidance. | N/A | ✅ OK |
| Cover detection is provided in context builder (`coverFromMe` on enemies). | [ai-context-builder.ts](packages/game-server/src/application/services/combat/ai/ai-context-builder.ts) | ✅ OK |
| **Difficult terrain is not explicitly surfaced to AI context** — pathfinding handles it, but the AI doesn't know which cells are difficult terrain for strategic planning. | [ai-context-builder.ts](packages/game-server/src/application/services/combat/ai/ai-context-builder.ts) | **LOW** |

### 1.7 Multi-target Prioritization — Well Implemented

| Issue | File | Severity |
|-------|------|----------|
| `scoreTargets()` in `ai-target-scorer.ts` is solid: considers HP, AC, concentration, conditions (stunned/paralyzed/prone/restrained/frightened/incapacitated), and proximity. Weights are tunable. | [ai-target-scorer.ts](packages/game-server/src/application/services/combat/ai/ai-target-scorer.ts) | ✅ OK |
| **Missing: spellcaster priority** — scorer doesn't boost priority for known spellcasters (beyond concentration). A Wizard with no active concentration is still a high-value target. | [ai-target-scorer.ts](packages/game-server/src/application/services/combat/ai/ai-target-scorer.ts) | **LOW** |
| **Missing: threat assessment** — scorer doesn't factor in the enemy's offensive capability (high attack bonus, multiattack, remaining spell slots). | [ai-target-scorer.ts](packages/game-server/src/application/services/combat/ai/ai-target-scorer.ts) | **LOW** |

### 1.8 Flanking — Implemented in AiAttackResolver

The `AiAttackResolver` correctly checks `mapData.flankingEnabled` and calls `checkFlanking()` with ally positions to grant advantage. This is solid.

---

## 2. AI Decision Quality Issues

| Issue | File | Severity |
|-------|------|----------|
| **Deterministic AI doesn't use Disengage before retreating** — retreats with `moveAwayFrom` which provokes OAs. Should check if adjacent to enemy and use `disengage` first if action isn't spent. | [deterministic-ai.ts](packages/game-server/src/application/services/combat/ai/deterministic-ai.ts#L520) | **MEDIUM** |
| **Deterministic AI doesn't consider Dodge** — never selects `dodge` action, even when it would be optimal (e.g., surrounded by enemies, can't escape, allies are coming next turn). | [deterministic-ai.ts](packages/game-server/src/application/services/combat/ai/deterministic-ai.ts) | **LOW** |
| **Attack target selection doesn't factor in melee reach for Extra Attack** — when multiple attacks are allowed, the AI always targets the same enemy. Should re-evaluate targets between attacks (first might have died). The orchestrator refreshes combatants, but deterministic AI generates all attacks targeting the same enemy in one decision. | [deterministic-ai.ts](packages/game-server/src/application/services/combat/ai/deterministic-ai.ts#L470-L500) | **MEDIUM** |
| **Legendary attack doesn't use ActiveEffects** — `executeLegendaryAttack()` is a simplified attack resolution that skips advantage/disadvantage, ActiveEffects (Bless, Rage damage), damage defenses, and flanking. It's a much simpler path than `AiAttackResolver`. | [ai-turn-orchestrator.ts](packages/game-server/src/application/services/combat/ai/ai-turn-orchestrator.ts#L850-L930) | **MEDIUM** |
| **Legendary action charges don't refuel properly** — `chooseLegendaryAction()` has a pacing heuristic that distributes charges across the round, but `boss.monster?.faction` lookup on CombatantStateRecord may be `undefined` (these sub-properties don't exist on the flat record). The faction check falls back to `"enemy"` which likely works but is fragile. | [legendary-action-handler.ts](packages/game-server/src/application/services/combat/ai/legendary-action-handler.ts#L110-L115) | **LOW** |
| **Bonus action stashing on reaction pause doesn't re-check economy** — when attack is paused for Shield reaction, the bonus action is stored as `pendingBonusAction`. When resumed, it's executed without re-checking if bonus action is still available (edge case: another effect consumed it). | [ai-turn-orchestrator.ts](packages/game-server/src/application/services/combat/ai/ai-turn-orchestrator.ts#L440-L455) | **LOW** |

---

## 3. LLM Integration Gaps

| Issue | File | Severity |
|-------|------|----------|
| **OpenAI provider is a stub** — throws at construction time. Listed in factory as a valid option but immediately errors. | [openai-provider.ts](packages/game-server/src/infrastructure/llm/openai-provider.ts) | **LOW** (documented limitation) |
| **Factory doesn't log which provider it selected** — when `createLlmProviderFromEnv()` returns `undefined` (no model configured), there's no diagnostic log. Users may not realize the LLM is unconfigured. | [factory.ts](packages/game-server/src/infrastructure/llm/factory.ts) | **LOW** |
| **LLM retry on JSON parse failure uses temperature increase** — increases temperature by 0.15 on retry, which may produce even less parseable output. A better strategy is to lower temperature for structured JSON output. | [ai-decision-maker.ts](packages/game-server/src/infrastructure/llm/ai-decision-maker.ts#L100-L110) | **LOW** |
| **No token/context limit awareness** — `AiContextBuilder.build()` can produce very large JSON payloads (full stat blocks, all spells, all features). No truncation or summarization for context-limited models. | [ai-context-builder.ts](packages/game-server/src/application/services/combat/ai/ai-context-builder.ts) | **MEDIUM** |
| **Intent parser is very generic** — `IntentParser` has minimal schema guidance. It's described as "intentionally generic" with a comment about specializing later. Works but produces unpredictable output shapes. | [intent-parser.ts](packages/game-server/src/infrastructure/llm/intent-parser.ts) | **LOW** |
| **Narrative generator doesn't receive actor/target refs** — narration only gets raw events JSON. Doesn't have structured awareness of which combatant is which faction. This could lead to inappropriate narration tone. | [narrative-generator.ts](packages/game-server/src/infrastructure/llm/narrative-generator.ts) | **LOW** |

---

## 4. AI Handler Completeness

### 4.1 Registered Handlers (15 total)

| Handler | Action | Status |
|---------|--------|--------|
| AttackHandler | `attack` | ✅ Full two-phase |
| MoveHandler | `move` | ✅ Full |
| MoveTowardHandler | `moveToward` | ✅ Full with A* pathfinding |
| MoveAwayFromHandler | `moveAwayFrom` | ✅ Full with Dijkstra retreat |
| BasicActionHandler | `disengage`, `dash`, `dodge` | ✅ Full |
| HelpHandler | `help` | ✅ Basic |
| CastSpellHandler | `castSpell` | ⚠️ See spell issues above |
| ShoveHandler | `shove` | ✅ Basic |
| GrappleHandler | `grapple` | ✅ Basic |
| EscapeGrappleHandler | `escapeGrapple` | ✅ Basic |
| HideHandler | `hide` | ✅ Basic |
| SearchHandler | `search` | ✅ Basic |
| UseObjectHandler | `useObject` | ✅ Good (potions + effects) |
| UseFeatureHandler | `useFeature` | ✅ Good (delegates to AbilityRegistry) |
| EndTurnHandler | `endTurn` | ✅ Full |

### 4.2 Missing Actions

| Missing Action | Severity | Notes |
|---------------|----------|-------|
| **`useFeature` in deterministic AI** — the `AiDecision` type includes `useFeature` and `featureId` fields, `UseFeatureHandler` is registered, but `DeterministicAiDecisionMaker` NEVER generates a `useFeature` decision. Class features like Turn Undead, Lay on Hands (as main action) are only triggered via LLM. | **CRITICAL** |
| **Bonus action class abilities** — deterministic AI's `pickBonusAction()` handles: Second Wind, Rage, Patient Defense, Flurry of Blows, Step of the Wind, Cunning Action. But doesn't handle: Wholeness of Body, Divine Smite (paladin bonus smite), Bardic Inspiration, Healing Word (bonus action spell). | **MEDIUM** |
| **Lair Actions** — `processLairActionsIfNeeded()` is called in `processAllMonsterTurns()` but the method implementation isn't visible in the read code. May be incomplete. | **LOW** (needs verification) |

---

## 5. Tactical Context Building

### 5.1 What's Provided (Comprehensive)

The `AiContextBuilder.build()` is one of the strongest parts of the AI system:

- ✅ Full entity hydration (character sheets, monster stat blocks, NPC stat blocks)
- ✅ All ability scores, AC, speed, size
- ✅ Spell save DC and spell attack bonus
- ✅ Resource pools (ki, spell slots, rage, action surge, etc.)
- ✅ Active conditions on self, allies, enemies
- ✅ Active buffs (Raging, Dashed, Disengaged, ActiveEffect sources)
- ✅ Concentration spell tracking
- ✅ Death save state for allies/enemies
- ✅ Pre-computed distances (feet) to all allies and enemies
- ✅ Cover levels from self to each enemy
- ✅ Battlefield ASCII visualization with legend
- ✅ Zone context (Spirit Guardians, Spike Growth, etc.)
- ✅ Potion detection and inventory scanning
- ✅ Action economy state
- ✅ Battle plan view (faction strategy)
- ✅ Prepared spells enriched from canonical catalog
- ✅ Class abilities with economy and resource cost
- ✅ Damage resistances/immunities/vulnerabilities for self, allies, enemies
- ✅ Attacks per action (Extra Attack / Multiattack)
- ✅ Action history and turn results for feedback loop
- ✅ Recent narrative context

### 5.2 Missing Context Items

| Missing | Severity | Notes |
|---------|----------|-------|
| **Saving throw proficiencies/bonuses of enemies** — AI knows enemy ability scores but not their save proficiencies. This would help spell selection (target LOW saves). | **MEDIUM** |
| **Terrain type per cell** — pathfinding handles difficult terrain but AI doesn't know which areas are difficult terrain for strategic positioning decisions. | **LOW** |
| **Initiative order** — `combat.turn` gives current turn index, but AI doesn't see the full initiative order to predict who goes next. This would help with action economy planning (e.g., "enemy healer goes next, better kill them now"). | **LOW** |
| **Temporary HP** — not surfaced in context. AI might waste healing on a target with high temp HP. | **LOW** |

---

## 6. Code Quality / Architecture Issues

| Issue | File | Severity |
|-------|------|----------|
| **Heavy use of `as any`** — resources are typed as `Record<string, unknown>` throughout, requiring extensive `as any` casts. This is a systemic issue (not AI-specific) but particularly prevalent in AI code. | Multiple files | **LOW** (systemic) |
| **`console.log` in production code** — `CastSpellHandler` has `console.log("[CastSpellHandler] initiateSpellCast result:")` which should use `aiLog` instead. | [cast-spell-handler.ts](packages/game-server/src/application/services/combat/ai/handlers/cast-spell-handler.ts#L97-L102) | **LOW** |
| **AiAttackResolver is 550+ lines** — While well-structured, it handles too many responsibilities (advantage/disadvantage from effects, conditions, flanking, damage defenses, retaliatory damage, KO effects, damage reactions). Some could be extracted to shared helpers already used by the tabletop flow. | [ai-attack-resolver.ts](packages/game-server/src/application/services/combat/ai/ai-attack-resolver.ts) | **LOW** |
| **Duplicate `buildActorRef` methods** — Both `AiTurnOrchestrator` and `AiActionExecutor` have identical `buildActorRef()` methods. Should be a shared utility. | [ai-turn-orchestrator.ts](packages/game-server/src/application/services/combat/ai/ai-turn-orchestrator.ts#L207), [ai-action-executor.ts](packages/game-server/src/application/services/combat/ai/ai-action-executor.ts#L100) | **LOW** |
| **Legendary action faction detection is fragile** — `chooseLegendaryAction()` reads `boss.monster?.faction` and `boss.npc?.faction` from `CombatantStateRecord`, but these sub-objects may not exist on the flat record schema. Falls back to `"enemy"` which works but is technically incorrect. | [legendary-action-handler.ts](packages/game-server/src/application/services/combat/ai/legendary-action-handler.ts#L112) | **LOW** |
| **LLM system prompt is very long (~400+ lines)** — The `buildSystemPrompt()` in `ai-decision-maker.ts` is massive. Every detail is useful, but smaller models may struggle with this much instruction. Could benefit from conditional sections based on creature capabilities. | [ai-decision-maker.ts](packages/game-server/src/infrastructure/llm/ai-decision-maker.ts#L120-L400+) | **LOW** |
| **AiSpellDelivery `resolveTargets` uses faction heuristic** — For AoE spells, it assumes monsters target non-monsters and vice versa. This doesn't use FactionService, which could lead to incorrect targeting in scenarios with multiple factions. | [ai-spell-delivery.ts](packages/game-server/src/application/services/combat/ai/handlers/ai-spell-delivery.ts#L490-L500) | **LOW** |

---

## 7. Summary of Critical / Medium Findings

### Critical (3)
1. **AI spell delivery cannot create zone spells** — Spirit Guardians, Spike Growth, etc. have no zone-placement code in AiSpellDelivery
2. **Deterministic AI never generates `useFeature` decisions** — Turn Undead, Lay on Hands (main action) are LLM-only
3. *(Documented in repo memory)* AI spell casting doesn't resolve full spell mechanics in some paths — `CastSpellHandler` now has `AiSpellDelivery` but zone creation is still missing

### Medium (10)
1. AI can't cast bonus-action spells separately from action spells
2. No multi-target/AoE spell evaluation in deterministic AI
3. No cover-seeking positioning behavior
4. No Disengage-before-retreat logic in deterministic AI  
5. No triage priority for dying allies (0 HP with death saves)
6. No Spare the Dying / Help action for dying allies
7. Deterministic AI ignores buff/debuff spells entirely
8. Legendary attack bypasses ActiveEffects (simplified resolution)
9. Attack target selection doesn't re-evaluate between Extra Attacks  
10. No token/context limit awareness for LLM payloads

### Low (15)
1. No concentration replacement evaluation
2. No flanking-seeking movement
3. Simplistic ranged repositioning
4. Hard-coded retreat threshold  
5. Missing spellcaster priority in target scorer
6. Missing threat assessment in target scorer
7. Difficult terrain not surfaced to AI context
8. OpenAI provider is a stub
9. Factory doesn't log provider selection
10. LLM retry increases temperature (counterproductive for JSON)
11. Intent parser is very generic
12. Narrative generator lacks faction context
13. Saving throw proficiencies not in AI context
14. Temp HP not surfaced in context
15. Various code quality issues (console.log, duplicate methods, as any)

---

## 8. Positive Observations

The AI system is architecturally sound:

- **Clean strategy pattern** — AiActionRegistry + handler-per-action is extensible and well-documented
- **Two-phase support** — Reactions (Shield, OA, Counterspell, damage reactions) are properly handled
- **Deterministic fallback** — Always works without LLM via `DeterministicAiDecisionMaker`
- **Battle planning** — Faction-level strategy with LLM + deterministic fallback
- **Target scoring** — Reusable `scoreTargets()` with tunable weights
- **Context building** — Extremely comprehensive tactical context
- **Zone awareness** — Full integration with pathfinding and AI prompts
- **Flanking** — Properly implemented in AiAttackResolver
- **Legendary actions** — Dedicated handler with charge-spreading heuristics
- **Spell delivery** — `AiSpellDelivery` handles 4 of 5 delivery types (attack, heal, save, buff)
