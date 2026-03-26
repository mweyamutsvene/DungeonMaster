# SME Research — AIBehavior Flow

**Scope:** `packages/game-server/src/application/services/combat/ai/**` + `packages/game-server/src/infrastructure/llm/**`
**Total findings:** 45 across 13 categories  
**Summary:** Critical spell delivery gap; multiple high-priority resource/economy bugs; significant clean-up needed (console.logs, missing monster slot deduction); several medium-priority tactical gaps.

---

## CATEGORY 1: TODO/FIXME Comments

| # | File | Line | Priority | Description |
|---|------|------|----------|-------------|
| 1 | `handlers/cast-spell-handler.ts` | 131 | CRITICAL | `TODO: [SpellDelivery]` AI spell mechanical effects NOT applied. Tracked in `plan-spell-path-unification.prompt.md` |
| 2 | `infrastructure/llm/battle-planner.ts` | 70 | LOW | Migrate `buildSystemPrompt`+`buildUserMessage` to `PromptBuilder` |
| 3 | `infrastructure/llm/character-generator.ts` | 54 | LOW | Migrate inline system prompt to `PromptBuilder` |
| 4 | `infrastructure/llm/intent-parser.ts` | 24 | LOW | Migrate inline messages construction to `PromptBuilder` |
| 5 | `infrastructure/llm/narrative-generator.ts` | 23 | LOW | Migrate inline messages construction to `PromptBuilder` |
| 6 | `infrastructure/llm/story-generator.ts` | 60 | LOW | Migrate inline messages construction to `PromptBuilder` |

---

## CATEGORY 2: Unhandled / Partially Handled AI Actions

| # | Gap | Priority | Details |
|---|-----|----------|---------|
| 1 | `escapeGrapple` not in `isActionConsuming()` | HIGH | `ai-action-executor.ts` economy guard does NOT block `escapeGrapple` when action already spent. AI could attempt escape twice in one turn. |
| 2 | `castSpell` shown even with no spells | MEDIUM | LLM system prompt `AVAILABLE ACTIONS` section lists `castSpell` unconditionally. Creatures with no `spells[]` still get the option offered. Contrast with `useObject` which is correctly gated on `useObjectAvailable` flag. |
| 3 | No "Ready" action | MEDIUM | Hold action / reaction-trigger is absent from AI entirely. Not urgent but a tactical gap. |
| 4 | No "LoseConcentration" proactive drop | LOW | AI can't deliberately end concentration to cast a new concentration spell. System auto-drops on `prepareSpellCast()` so not broken, but LLM is never told it can do this proactively. |
| 5 | Registry error message missing action types | LOW | `ai-action-registry.ts` error guidance lists `attack, move, dodge, dash…` but omits `moveToward`, `moveAwayFrom`, `escapeGrapple`, `useObject`. LLM retry feedback loop can't suggest these corrected names. |

---

## CATEGORY 3: Tactical Decision-Making Gaps

| # | Gap | Priority | Details |
|---|-----|----------|---------|
| 1 | Deterministic AI never uses Extra Attack | HIGH | `deterministic-ai.ts` always sets `endTurn: true` on attack decision. Fighters/Monks with Extra Attack never get their second attack in deterministic mode. |
| 2 | Deterministic AI never casts spells | HIGH | `DeterministicAiDecisionMaker` has no path to choose `castSpell` as a primary action. Monsters/NPCs with spells only ever melee/ranged attack. |
| 3 | Range check skipped for Character/NPC attackers | HIGH | `attack-handler.ts` ~line 95: `monsterAttacks = actorRef.type === "Monster" ? await ... : []`. Empty array means range validation block is never entered for AI-controlled Characters/NPCs. They can attack from any distance. |
| 4 | `pickBonusAction()` missing several bonus actions | MEDIUM | `deterministic-ai.ts`: only handles Second Wind, Flurry of Blows, Cunning Action disengage (<30% HP), and Rage. Missing: Patient Defense, Step of the Wind, Divine Smite, Bardic Inspiration, Action Surge. |
| 5 | LLM `castSpell` always shown but Deterministic AI never picks it | MEDIUM | Creates asymmetry: LLM-backed AI may attempt spells (which don't resolve mechanically — see Cat 4); deterministic AI ignores them entirely. Both paths are wrong for different reasons. |
| 6 | Counterspell always used without context-awareness | MEDIUM | `ai-turn-orchestrator.ts` `aiDecideReaction()`: `reactionType === "counterspell"` always returns `true`. Wastes reaction countering cantrips; never saves it for high-value opponent spells. |
| 7 | Deterministic battle plan `priority` always `"offensive"` | MEDIUM | `battle-plan-service.ts` reads `combatant.resources.challengeRating` — this field doesn't exist in the standard resource type. Always `undefined → defaults to 1 → always "offensive"`. |
| 8 | OA threshold is HP-only | LOW | `aiDecideReaction()`: OA skipped at <25% HP regardless of context. Doesn't consider whether the OA would KO the fleeing target. |
| 9 | Step numbering wrong in deterministic-ai.ts | LOW | Comments say "Step 8" before "Step 7". Confusing to read but functionally correct execution order. |

---

## CATEGORY 4: LLM / Spell Integration Issues

| # | Gap | Priority | Details |
|---|-----|----------|---------|
| 1 | **Full Spell Casting Gap — no delivery** | CRITICAL | `cast-spell-handler.ts` line ~135: `actionService.castSpell()` records the event and spends the slot but applies **zero mechanical effects**. Damage, healing, conditions, zone creation, saving throws — none happen for AI-cast spells. The TODO at line 131 tracks this. |
| 2 | Monster/NPC spell slots NOT deducted | HIGH | `prepareSpellCast()` is gated behind `if (isCharacterCaster)`. Monster/NPC casters can cast unlimited leveled spells per combat. A Fireball 1/day boss can cast Fireball every AI turn. |
| 3 | Spell targeting not resolved | HIGH | `CastSpellHandler` never resolves `decision.target` into a `CombatantRef`. Targeted damage spells (Magic Missile, Scorching Ray) are cast "at no one". |
| 4 | OpenAI provider is stub-only | MEDIUM | `infrastructure/llm/openai-provider.ts` exists but throws `new Error("OpenAI provider not implemented yet")` immediately. Not wired in factory. Any `DM_LLM_PROVIDER=openai` config silently gets no LLM. |
| 5 | LLM retry uses same prompt parameters | LOW | `ai-decision-maker.ts` ~line 77: retry `options` (model/temp/seed) are identical to initial call. Retry is unlikely to produce a different result when the parameters don't change. |

---

## CATEGORY 5: Mock vs Real LLM Parity Gaps

| # | Gap | Priority | Details |
|---|-----|----------|---------|
| 1 | `setDefaultBehavior()` union incomplete | MEDIUM | `mocks/index.ts` type union missing `"shove"`, `"dodge"`, `"dash"`, `"disengage"`, `"help"`, `"search"`. Can't script these behaviors via default for tests. |
| 2 | Mock `castSpell` bypasses resource check | MEDIUM | Mock picks `spells[0]` without consulting `resourcePools` for available slots. Real LLM is instructed to check `resourcePools[].current > 0`. Mock may produce decisions that would fail on slot exhaustion. |
| 3 | Mock `bonusAction` only attached on `attack` default | LOW | `mocks/index.ts` ~line 831: `this.defaultBonusAction` only attached to `attack` decisions. Test scenarios using `endTurn` default can't test bonus actions without `queueDecision`. |
| 4 | Mock `flee` distance-unaware | LOW | Picks `enemies[0]` as flee target regardless of distance. Harmless but unrealistic. |

---

## CATEGORY 6: Battle Plan Generation Quality Gaps

| # | Gap | Priority | Details |
|---|-----|----------|---------|
| 1 | Enemy AC/speed not sent to LLM planner | HIGH | `battle-plan-service.ts` enemy list built with `ac: undefined, speed: undefined` hardcoded. LLM plans without knowing how hard enemies are to hit or how mobile they are. |
| 2 | Faction creature abilities not sent to LLM planner | HIGH | `factionCreatures` array never calls `listCreatureAbilities()`. LLM plans without knowing own faction's spells or abilities. |
| 3 | `yourRole` lookup fragile on name mismatch | LOW | `getPlanViewForCombatant()` looks up `plan.creatureRoles[combatantName]`. Casing differences or duplicate names within a faction lose role guidance silently. |
| 4 | Replan every 2 rounds adds latency | LOW | `REPLAN_STALE_ROUNDS = 2` triggers full LLM call on rounds 3, 5, 7… With slow Ollama, adds 5-10+ seconds of latency per re-plan. |

---

## CATEGORY 7: AI Reaction Handling

| # | Gap | Priority | Details |
|---|-----|----------|---------|
| 1 | Counterspell always used (see Cat 3 #6) | MEDIUM | `aiDecideReaction()` — no context-awareness: spell level, remaining reaction uses, or whether the spell is worth countering. A Goblin with a 1st-level slot will counter a cantrip. |
| 2 | Deflect Attacks not AI-decision-controlled | LOW | Deflect Attacks (Monk) triggers via `targetHasDeflectReaction` flag in `AttackHandler` — any character with reaction available automatically enters two-phase flow. AI never consciously decides whether to deflect. |
| 3 | Absorb Elements / Hellish Rebuke as retaliatory damage | INFO | These reactions are implemented as AiAttackResolver retaliatory damage (auto-applied) rather than player-prompted two-phase reactions. Functionally works but bypasses reaction economy. |

---

## CATEGORY 8: AI Bonus Action Usage

| # | Gap | Priority | Details |
|---|-----|----------|---------|
| 1 | Legacy bonus action string matching fragile | MEDIUM | `ai-action-executor.ts` executeBonusAction fallback: handles `"nimble_escape_disengage"`, `"cunning_action_dash"`, etc. via raw `if/else` chain, bypassing AbilityRegistry. New abilities will need their own `if` branch. |
| 2 | `escapeGrapple` not in `isActionConsuming()` (also Cat 2 #1) | HIGH | Repeated from Cat 2 — action economy guard won't block a second `escapeGrapple`. |
| 3 | Bonus action actor stub has hardcoded speed | LOW | `ai-action-executor.ts` AbilityRegistry call sends stub actor with `getSpeed: () => 30` hardcoded. Doesn't reflect actual combatant stats. |

---

## CATEGORY 9: AI Resource Management

| # | Gap | Priority | Details |
|---|-----|----------|---------|
| 1 | Monster/NPC spell slots never deducted (also Cat 4 #2) | HIGH | Repeated from Cat 4. |
| 2 | Warlock Pact Magic pool name potentially inconsistent | MEDIUM | System prompt mentions `"pactMagic"` pool; standard slot logic uses `spellSlot_1`–`spellSlot_9`. If Warlock stores pact slots under a different key, the LLM resource check will always pass falsely, bypassing slot limits. Needs verification against actual Warlock definition. |
| 3 | Action Surge not pre-validated | LOW | No server-side guard on whether Fighter has `actionSurge.current > 0` before permitting second action loop. Relies entirely on LLM instruction to self-check. If LLM ignores it, the AI gets a free action. |

---

## CATEGORY 10: Handler Coverage Gaps

| # | Gap | Priority | Details |
|---|-----|----------|---------|
| 1 | No `"useFeature"` / `"activateAbility"` AI action | MEDIUM | Class features used as a **primary action** (Turn Undead, Channel Divinity, Lay on Hands) have no AI action handler. AI has no path to trigger these. DeterministicAI never picks them. LLM isn't offered them. |
| 2 | Four classes missing from MockCharacterGenerator | MEDIUM | Templates exist for Fighter/Monk/Wizard/Rogue/Barbarian/Cleric/Paladin. Missing: Bard, Sorcerer, Ranger, Druid. Limits AI character behavior test coverage. |
| 3 | Lair action execution implementation | INFO | `processLairActionsIfNeeded()` at line 903 exists in `ai-turn-orchestrator.ts` and is called. Lair actions are tracked and narrative events emitted. Actual mechanical execution type (`attack`, `move`, `special`) is partial — attack & move appear to only emit narrative for non-attack types. Needs dedicated audit if lair-action-heavy scenarios exist. |

---

## CATEGORY 11: AI Fall-Through Behavior

| # | Gap | Priority | Details |
|---|-----|----------|---------|
| 1 | Consecutive failure limit is global | LOW | `maxConsecutiveFailures = 2` across all action types. A move failure + attack failure ends the turn even if the AI had valid remaining options (`endTurn` or bonus action). Failure counter should reset on action-type change. |

---

## CATEGORY 12: Performance/Scalability Concerns

| # | Gap | Priority | Details |
|---|-----|----------|---------|
| 1 | N+M DB queries per context build | MEDIUM | `ai-context-builder.ts`: one repo call per ally + one per enemy in `buildAllyDetails()`/`buildEnemyDetails()`. 10-combatant encounter × 5 AI iterations = up to 50 DB queries per AI turn. |
| 2 | Multiple encounter loads per AI turn loop | LOW | `processAllMonsterTurns()` calls `getEncounterById()` + `listCombatants()` 3+ times at the outer loop level (for legendary action detection, lair actions, and the main turn loop). These should be batched or cached. |
| 3 | `listCreatureAbilities()` called per-combatant per-iteration | LOW | Called in `buildAllyDetails()` and `buildEnemyDetails()` for every combatant. Silently swallowed exceptions (`catch { // Ignore errors }`) can hide performance or logic issues without any logging. |

---

## CATEGORY 13: Unconditional `console.log` in Production Code

These bypass the `aiLog` debug gate and will appear in every deployment regardless of `DM_AI_DEBUG` setting.

| # | File | Lines | Priority |
|---|------|-------|----------|
| 1 | `handlers/attack-handler.ts` | 22, 28, 38, 49, 60, 132, 213, 223 | MEDIUM — fire on every AI attack, including damage/target details |
| 2 | `ai-attack-resolver.ts` | 178, 215, 246, 283, 507 | MEDIUM — attack resolution details on every resolve call |
| 3 | `handlers/cast-spell-handler.ts` | 68, 75 | LOW — fire on every AI spell cast attempt |

Fix: replace with `this.aiLog(...)` or a passed-in `log` function.  
Note: `ai-turn-orchestrator.ts` line 64 is **correctly** debug-gated (`if (this.aiDebugEnabled)`).

---

## Priority Summary

| Priority | Count | Items |
|----------|-------|-------|
| CRITICAL | 2 | Spell delivery gap (Cat 4 #1), Monster slot deduction (Cat 4 #2) |
| HIGH | 8 | escapeGrapple economy (Cat 2 #1), Extra Attack (Cat 3 #1), Deterministic spells (Cat 3 #2), Range skipped for PC/NPC (Cat 3 #3), Spell targeting (Cat 4 #3), Enemy AC/speed in plans (Cat 6 #1), Faction abilities in plans (Cat 6 #2), Monster spell slots (Cat 9 #1) |
| MEDIUM | 19 | castSpell gating, No Ready, Counterspell context, Plan priority bug, OpenAI stub, Mock parity, Legacy bonus strings, Warlock pool name, useFeature handler, missing mock classes, console.logs in attack-handler, Ranged melee disadvantage |
| LOW | 16 | PromptBuilder TODOs, OA context, Retry params, Mock flee, Role lookup, Replan latency, Deflect control, Retaliatory reactions, Stub speed, No Action Surge validation, Lair actions, Consecutive failures, DB query count, listCreatureAbilities exceptions |

---

## Files Audited

| File | Status |
|------|--------|
| `ai/ai-turn-orchestrator.ts` | Fully read (~1300 lines) |
| `ai/ai-action-executor.ts` | Fully read |
| `ai/ai-action-registry.ts` | Fully read |
| `ai/ai-context-builder.ts` | Fully read |
| `ai/ai-types.ts` | Fully read |
| `ai/deterministic-ai.ts` | Fully read |
| `ai/battle-plan-service.ts` | Fully read |
| `ai/ai-attack-resolver.ts` | Fully read |
| `ai/ai-movement-resolver.ts` | Fully read |
| `ai/ai-target-scorer.ts` | Fully read |
| `ai/handlers/attack-handler.ts` | Fully read |
| `ai/handlers/cast-spell-handler.ts` | Fully read |
| `ai/handlers/move-handler.ts` | Fully read |
| `ai/handlers/move-toward-handler.ts` | Fully read |
| `ai/handlers/move-away-from-handler.ts` | Fully read |
| `ai/handlers/end-turn-handler.ts` | Fully read |
| `ai/handlers/basic-action-handler.ts` | Fully read |
| `ai/handlers/help-handler.ts` | Fully read |
| `ai/handlers/grapple-handler.ts` | Fully read |
| `ai/handlers/use-object-handler.ts` | Fully read |
| `ai/handlers/legendary-action-handler.ts` | Fully read |
| `ai/ai-action-handler.ts` (interface) | Fully read |
| `ai/battle-plan-types.ts` | Fully read |
| `llm/ai-decision-maker.ts` | Fully read |
| `llm/battle-planner.ts` | Fully read |
| `llm/factory.ts` | Fully read |
| `llm/openai-provider.ts` | Fully read — stub only, throws immediately |
| `llm/github-models-provider.ts` | Fully read |
| `llm/mocks/index.ts` | Fully read |
| `llm/intent-parser.ts` | Fully read |
| `llm/narrative-generator.ts` | Fully read |
| `llm/story-generator.ts` | Fully read |
| `llm/character-generator.ts` | Fully read |
