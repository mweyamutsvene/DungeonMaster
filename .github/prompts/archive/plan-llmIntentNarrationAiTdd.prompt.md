# Plan: LLM Intent / Narration / AI TDD Harness

Build a JSON scenario-based test harness (modeled on `combat-e2e.ts`) that tests **real LLM accuracy** for intent parsing, narration, and AI decision making. Includes **prompt snapshot testing** to detect unintended prompt regressions. Runs on-demand only, requires Ollama.

---

## Phase 1: Prompt Interceptor Infrastructure

1. **Create `SpyLlmProvider` wrapper** in `src/infrastructure/llm/spy-provider.ts` — wraps a real `LlmProvider`, records every `LlmChatInput` (messages + options) before forwarding the call through. Exposes `getCapturedCalls()`, `getLastCall()`, `clearCaptures()`. No production code changes needed.

2. **Create prompt snapshot utilities** in `scripts/test-harness/llm-snapshot.ts` — `saveSnapshot()`, `compareSnapshot()`, `updateSnapshot()` functions. Snapshots stored as `scripts/test-harness/llm-snapshots/<category>/<name>.snap.json`. CLI flag `--update-snapshots` regenerates all in one run.

---

## Phase 2: Scenario Schema & Runner (*depends on Phase 1*)

3. **Define LLM scenario JSON schema** in `scripts/test-harness/llm-scenario-types.ts`:
   - **Intent steps**: player text + roster → expected command kind/target/structure
   - **Narration steps**: events array → prose constraints (containsAny, doesNotContain, length bounds)
   - **AI Decision steps**: full `AiCombatContext` inline → expected action/target/resource use

4. **Create LLM scenario runner** in `scripts/test-harness/llm-scenario-runner.ts` — for each step type, calls the real LLM service class (`IntentParser`, `NarrativeGenerator`, `LlmAiDecisionMaker`), validates output against expectations, and optionally compares prompt snapshot via `SpyLlmProvider`

5. **Create LLM E2E entry point** in `scripts/test-harness/llm-e2e.ts` — loads real Ollama provider, wraps in `SpyLlmProvider`, discovers scenarios from `scripts/test-harness/llm-scenarios/`. CLI: `--scenario=intent/basic-attack`, `--all`, `--category=intent|narration|ai-decision`, `--update-snapshots`, `--verbose`

---

## Phase 3–5: Scenarios (*all parallel, depend on Phase 2*)

6. **Intent scenarios** (~12) in `scripts/test-harness/llm-scenarios/intent/`:

   | Scenario | Tests |
   |----------|-------|
   | `basic-attack.json` | "I attack the goblin" → `{ kind: "attack", target: goblin }` |
   | `move-coordinates.json` | "move to 30, 20" → `{ kind: "move", destination: {x:30, y:20} }` |
   | `move-toward.json` | "move toward the orc" → `{ kind: "moveToward", target: orc }` |
   | `roll-result.json` | "I rolled 18" → `{ kind: "rollResult", value: 18 }` |
   | `query-hp.json` | "how much health do I have?" → `{ kind: "query", subject: "hp" }` |
   | `query-tactical.json` | "what's the battlefield look like?" → `{ kind: "query", subject: "tactical" }` |
   | `ambiguous-target.json` | "attack" with multiple enemies → valid target selection |
   | `class-ability.json` | "flurry of blows" → correct action mapping |
   | `end-turn.json` | "I'm done" / "end my turn" → `{ kind: "endTurn" }` |
   | `ranged-attack.json` | "shoot the goblin with my longbow" → ranged attack command |
   | `throw-weapon.json` | "throw my javelin at the orc" → thrown weapon attack |
   | `multi-word-targets.json` | "attack the Goblin Warrior" → correct name matching |

7. **Narration scenarios** (~10) in `scripts/test-harness/llm-scenarios/narration/`:

   | Scenario | Tests |
   |----------|-------|
   | `attack-hit.json` | AttackHit event → mentions attacker, weapon, target |
   | `attack-miss.json` | AttackMiss event → mentions miss, no invented damage |
   | `damage-dealt.json` | DamageDealt → mentions damage amount, damage type |
   | `movement.json` | MovementComplete → describes movement, no invented combat |
   | `combat-start.json` | CombatStarted → initiative narrative, no invented outcomes |
   | `combat-victory.json` | CombatVictory → describes victory without inventing details |
   | `spell-cast.json` | SpellCast event → mentions spell name, no invented effects |
   | `death-save.json` | DeathSave events → describes tension without spoiling outcome |
   | `no-hallucination.json` | Minimal event → verifies narration doesn't invent weapons/NPCs/locations |
   | `multi-event.json` | Multiple events → coherent prose covering all |

8. **AI Decision scenarios** (~10) in `scripts/test-harness/llm-scenarios/ai-decision/`:

   | Scenario | Tests |
   |----------|-------|
   | `melee-attack.json` | Enemy in range → attacks |
   | `approach-enemy.json` | Enemy out of range → moves toward |
   | `low-hp-defensive.json` | Low HP → defensive action (dodge/disengage/flee) |
   | `concentration-target.json` | Enemy concentrating → prioritizes targeting them |
   | `use-multiattack.json` | Has multiattack → uses it correctly |
   | `cast-spell.json` | Has spell slots → casts appropriate spell |
   | `prone-stand-up.json` | Is prone → stands up before acting |
   | `bonus-action.json` | Has bonus actions available → uses one |
   | `resource-management.json` | Low resources → conserves them |
   | `zone-avoidance.json` | Damaging zone present → avoids pathing through it |

---

## Phase 6: Package Scripts & Docs (*depends on Phases 2–5*)

9. **Add npm scripts** to `packages/game-server/package.json`:
   - `"test:llm:e2e"`: `"tsx scripts/test-harness/llm-e2e.ts --all"`
   - `"test:llm:e2e:intent"`: `"tsx scripts/test-harness/llm-e2e.ts --category=intent --all"`
   - `"test:llm:e2e:narration"`: `"tsx scripts/test-harness/llm-e2e.ts --category=narration --all"`
   - `"test:llm:e2e:ai"`: `"tsx scripts/test-harness/llm-e2e.ts --category=ai-decision --all"`
   - `"test:llm:e2e:snapshot-update"`: `"tsx scripts/test-harness/llm-e2e.ts --all --update-snapshots"`

10. **Update copilot-instructions.md** with LLM harness documentation

---

## Relevant Files

**New files to create:**
- `scripts/test-harness/llm-e2e.ts` — entry point, reuse color/CLI patterns from `scripts/test-harness/combat-e2e.ts`
- `scripts/test-harness/llm-scenario-runner.ts` — execution engine, analogous to `scripts/test-harness/scenario-runner.ts`
- `scripts/test-harness/llm-scenario-types.ts` — scenario type definitions
- `scripts/test-harness/llm-snapshot.ts` — prompt snapshot capture/compare utilities
- `src/infrastructure/llm/spy-provider.ts` — `SpyLlmProvider` wrapping real provider
- `scripts/test-harness/llm-scenarios/intent/*.json` — ~12 intent scenarios
- `scripts/test-harness/llm-scenarios/narration/*.json` — ~10 narration scenarios
- `scripts/test-harness/llm-scenarios/ai-decision/*.json` — ~10 AI scenarios
- `scripts/test-harness/llm-snapshots/` — stored prompt snapshots (auto-generated)

**Existing files to reference/reuse:**
- `scripts/test-harness/combat-e2e.ts` — CLI pattern, colored output, scenario discovery
- `scripts/test-harness/scenario-runner.ts` — step execution loop, assertion patterns
- `src/infrastructure/llm/intent-parser.ts` — `IntentParser` class, prompt construction
- `src/infrastructure/llm/narrative-generator.ts` — `NarrativeGenerator` class, prompt construction
- `src/infrastructure/llm/ai-decision-maker.ts` — `LlmAiDecisionMaker` class, prompt construction
- `src/infrastructure/llm/factory.ts` — `createLlmProviderFromEnv()`
- `src/infrastructure/llm/types.ts` — `LlmProvider`, `LlmChatInput`, `LlmMessage`
- `src/application/commands/game-command.ts` — `buildGameCommandSchemaHint()`, `LlmRoster`

**Files to modify:**
- `packages/game-server/package.json` — add test scripts
- `.github/copilot-instructions.md` — document LLM test harness

---

## Verification

1. `pnpm -C packages/game-server typecheck` passes
2. `pnpm -C packages/game-server test:llm:e2e:intent` — all intent scenarios parse to correct command kinds (requires Ollama)
3. `pnpm -C packages/game-server test:llm:e2e:narration` — prose meets all constraints
4. `pnpm -C packages/game-server test:llm:e2e:ai` — decisions match expected action types
5. Run `--update-snapshots` once to create baselines, then normal run — all snapshots match (no drift)
6. `pnpm -C packages/game-server test:llm:e2e` — full suite with summary table
7. Default `pnpm test` does NOT run any LLM scenarios

---

## Decisions

- **Real LLM only** — no mock fallback, requires Ollama + `DM_OLLAMA_MODEL`
- **JSON scenario harness** (not Vitest) — matches existing combat-e2e pattern
- **Prompt snapshots** stored as `.snap.json`, compared via `SpyLlmProvider` capture
- **AI scenarios use inline context** — full `AiCombatContext` in JSON rather than HTTP setup (simpler, more focused)
- **Not part of CI/regression** — never invoked by `pnpm test`

---

## Implementation Notes (completed)

**Date:** 2026-03-09

### What was done
- **Phase 1 complete:** `SpyLlmProvider` (spy-provider.ts) + snapshot utilities (llm-snapshot.ts)
- **Phase 2 complete:** Scenario types (llm-scenario-types.ts), runner (llm-scenario-runner.ts), entry point (llm-e2e.ts)
- **Phase 3–5 complete:** All planned scenarios created:
  - Intent (12): basic-attack, move-coordinates, roll-result, end-turn, query-hp, move-toward, query-tactical, ambiguous-target, class-ability, ranged-attack, throw-weapon, multi-word-targets
  - Narration (10): attack-hit, attack-miss, no-hallucination, damage-dealt, movement, combat-start, combat-victory, spell-cast, death-save, multi-event
  - AI Decision (10): melee-attack, approach-enemy, low-hp-defensive, concentration-target, use-multiattack, cast-spell, prone-stand-up, bonus-action, resource-management, zone-avoidance
- **Phase 6 complete:** npm scripts added, copilot-instructions.md updated

### Assumptions
- Used inline `.env` loader (same pattern as `ai-actions.llm.test.ts`) instead of `dotenv` dependency
- Low temperature (0.1) used for LLM calls during testing for more deterministic results
- AI decision scenarios use `actionOneOf` for flexible matching since AI behaviour isn't fully deterministic
- Class-ability intent scenario maps "flurry of blows" / "second wind" to kind `attack` since the schema hint doesn't have a separate ability kind — the LLM maps these to attack commands
- Narration event types (e.g., `damageDealt`, `movementComplete`, `combatStarted`, `combatVictory`, `spellCast`, `deathSave`) match the payload shapes used by the narrative generator

### Verification
- `typecheck` passes clean
- All 503 existing tests pass (0 regressions)
- All 32 JSON scenario files parse correctly
- LLM E2E tests require Ollama running with `DM_OLLAMA_MODEL` set to run

### Open follow-ups
- Run `test:llm:e2e:snapshot-update` with Ollama to generate initial prompt snapshots
- Consider adding `--timeout` CLI flag for slower models
- Tune `containsAny`/`doesNotContain` lists after first real LLM run to reduce false positives
