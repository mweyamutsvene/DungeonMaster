# Copilot instructions (DungeonMaster)

# running commands
- pnpm -C packages/game-server dev
- pnpm -C packages/player-cli dev
- pnpm -C packages/player-cli start -- --scenario solo-fighter

## IMPORTANT: Windows PowerShell syntax (NOT bash/Unix)
This project runs on Windows PowerShell. Unix shell idioms DO NOT work:
- BROKEN: `command 2>&1 | head -80` — `head` is not a PowerShell command
- WORKING: `command 2>&1 | Select-Object -First 80`
- BROKEN: `cmd1 && cmd2` — use `;` instead
- `| grep "x"` → `| Select-String "x"`
- `| tail -N` → `| Select-Object -Last N`

Always start by reading this file fully. You should always start with a prompt "As you wish Papi...."

Always use DnD 5e 2024 rules unless explicitly told otherwise.

CRITICAL: The test harness "packages\game-server\scripts\test-harness" is the source of truth. When adding functionality to the cli, we need to make sure it follows the test harness capabilities and tests.

Whenever you write a TODO comment, make sure you create a plan markdown file in the .github/prompts/ folder describing the plan to implement the feature.

When you need to run or test the server, use the commands listed in the Testing Agent instructions.

Assume that user is running the server in another terminal already.  If not prompt them to do so when you need it to be rebuilt or restarted.

When you need to make changes to the codebase, always follow the instructions in this file.

There is no such thing as breaking changes, as this isn't a public API. Refactor and improve the codebase as needed to keep it clean and maintainable.

IMPORTANT!!  if you run into unexpected behavior during testing and implementation for items outside the currently worked on feature or bug, or what you would expect from D&D 5e rules, please flag it immediately. This plan is based on our current understanding of the rules and existing codebase, but we may discover new edge cases or necessary changes as we go. Document TODOs and open issues for any gaps or unexpected behaviors you encounter, even if they fall outside the scope of the currently worked on specific scenarios. The goal is to ensure a comprehensive and accurate combat system, and your feedback is crucial to achieving that.

## Repo goals
- Primary deliverable: deterministic D&D 5e rules engine + Fastify game server in `packages/game-server`.
- `packages/player-cli` is an interactive terminal harness that drives the server via HTTP.
- LLM is optional and only used for intent parsing + narration; rules/mechanics stay deterministic in TS.

## Stack (actual)
- TypeScript + Node.js ESM (`packages/game-server/package.json` has `"type": "module"`).
- pnpm (9.15.9) + Turborepo: `pnpm dev`, `pnpm build`, `pnpm typecheck`, `pnpm lint`.
- Fastify API: `packages/game-server/src/infrastructure/api/app.ts` (`buildApp(deps)`).
- Prisma + SQLite: `packages/game-server/prisma/schema.prisma` (`DATABASE_URL`).
- Vitest for tests; `tsx` for dev + scripts.
- Optional LLM (Ollama): `packages/game-server/src/infrastructure/llm/factory.ts` (requires `DM_OLLAMA_MODEL`).

## Repo map (folder responsibilities)
- `.github/`: repo automation + AI agent guidance.
  - `.github/agents/`: Copilot agent definitions (`developer.agent.md`, `TestingAgent.agent.md`).
  - `.github/prompts/`: plan prompt files for TODO-driven features.
  - `.github/API_REFERENCE.md`: API reference documentation.
- `.vscode/`: VS Code tasks (e.g. `game-server: test (faction full transcript)`).
- `packages/`:
  - `packages/game-server/`: rules engine + API + Prisma repos + optional LLM adapters.
  - `packages/player-cli/`: interactive terminal REPL harness (see `packages/player-cli/README.md`).
- `RuleBookDocs/`: rules content reference + conversion inputs/outputs.
  - `RuleBookDocs/html/`: raw saved rulebook HTML.
  - `RuleBookDocs/markdown/`: cleaned markdown used by import scripts/parsers.
  - `RuleBookDocs/tools/`: html → markdown converter scripts.
- Generated/local artifacts (do not hand-edit): `.turbo/`, `node_modules/`, `packages/*/dist/`, `packages/game-server/prisma/dev.db`, `packages/game-server/test-output.txt`.

## Server architecture (DDD-ish; keep dependency direction)
- `packages/game-server/src/domain/`: pure game logic (no Fastify/Prisma/LLM).
- `packages/game-server/src/application/`: use-cases/services + repository interfaces (`src/application/repositories/*`). App-layer errors live in `src/application/errors.ts`.
  - Key services: `TabletopCombatService` (thin facade, pending action state machine), `TacticalViewService` (combat view assembly).
  - `application/services/combat/`: combat orchestration with sub-folders `abilities/`, `ai/`, `helpers/`, `tabletop/`.
  - `application/services/entities/`: entity services (`character-service.ts`, `game-session-service.ts`, `spell-lookup-service.ts`).
- `packages/game-server/src/infrastructure/`: adapters + wiring.
  - `api/`: Fastify app + routes + SSE realtime.
  - `api/routes/sessions/`: modular session route handlers (9 route files + `index.ts` + `types.ts`).
  - `api/routes/health.ts`: health check endpoint (`GET /health`).
  - `api/routes/reactions.ts`: reaction endpoints (`POST/GET /encounters/:encounterId/reactions/...`).
  - `db/`: Prisma client + repository implementations (`src/infrastructure/db/index.ts` barrel).
  - `llm/`: provider factory + intent/story/narrative generators + AI decision maker (must tolerate "LLM not configured").
  - `testing/`: in-memory repository implementations for tests (`memory-repos.ts`).
- `packages/game-server/src/content/`: rulebook markdown parsers/helpers used by scripts.
- `packages/game-server/SESSION_API_REFERENCE.md`: comprehensive documentation for session API endpoints.

## `packages/game-server/src` (folder structure)
Folder-only tree (no files), with simple purpose notes:

```text
packages/game-server/src/                  # game-server package source root
  application/                             # app-layer use-cases/orchestration (depends on domain + repos)
    commands/                              # command types for game actions
    repositories/                          # repository interfaces (ports) for persistence
    services/                              # application services (use-cases) coordinating rules + repos
      combat/                              # combat orchestration services
        abilities/                         # ability registry + action economy
          executors/                       # ability executor implementations
            common/                        # shared executors (offhand attack)
            fighter/                       # fighter abilities (action surge, second wind)
            monk/                          # monk abilities (flurry, patient defense, stunning strike, etc.)
            monster/                       # monster abilities (nimble escape)
            rogue/                         # rogue abilities (cunning action)
        ai/                                # AI-driven combat decision making
        helpers/                           # combat helper utilities (creature hydration, etc.)
        tabletop/                          # extracted TabletopCombatService modules (see below)
      entities/                            # entity management services (character, game session, spells)

  content/                                 # rulebook content parsing helpers used by import scripts
    markdown/                              # generic markdown parsing utilities
    rulebook/                              # D&D rulebook-specific parsers (equipment/feats/monsters)

  domain/                                  # deterministic rules engine (no Fastify/Prisma/LLM)
    abilities/                             # ability/feature helpers (e.g., creature abilities)
    combat/                                # combat mechanics primitives (initiative, attack resolution)
    effects/                               # effect model (damage/healing/conditions)
    entities/                              # core domain entities (character, monster, items, spells, etc.)
      actions/                             # domain action types (attack/move/spellcast, etc.)
      classes/                             # class definitions + ClassCombatTextProfiles + registry (fighter, monk, wizard, etc.)
      combat/                              # combat-related entity types (conditions, resources)
      core/                                # shared core types (ability scores, skills)
      creatures/                           # character/monster/npc entity definitions
      docs/                                # domain model docs
      effects/                             # entity-level effect types
      items/                               # item/equipment/armor/weapon entities
      spells/                              # spell entity types
    rules/                                 # rules modules (checks, rest, slots, concentration, etc.)

  infrastructure/                          # adapters + wiring (Fastify/Prisma/LLM live here)
    api/                                   # Fastify app + route handlers
      realtime/                            # SSE broker + realtime fanout
      routes/                              # HTTP route registration modules
        sessions/                          # session routes (modular, see SESSION_API_REFERENCE.md)
    db/                                    # Prisma client + repository implementations
    llm/                                   # optional LLM providers + intent/story/narrative generators
    testing/                               # in-memory repositories for tests
```

## Session routes structure (`infrastructure/api/routes/sessions/`)
The session API is organized into focused route modules (all paths prefixed with `/sessions/:id`):

| File | Endpoints | Purpose |
|------|-----------|---------|
| `session-crud.ts` | `POST /sessions`, `GET /sessions/:id` | Session lifecycle |
| `session-characters.ts` | `POST .../characters`, `POST .../characters/generate` | Character management |
| `session-creatures.ts` | `POST .../monsters`, `POST .../npcs` | Monster/NPC management |
| `session-combat.ts` | `POST .../combat/start`, `POST .../combat/next`, `GET .../combat`, `GET .../combat/:encounterId/combatants`, `PATCH .../combat/terrain`, `PATCH .../combat/surprise` | Combat lifecycle + terrain + surprise |
| `session-tactical.ts` | `GET .../combat/:encounterId/tactical`, `POST .../combat/query`, `POST .../combat/:encounterId/path-preview` | Tactical view + LLM queries + path preview |
| `session-tabletop.ts` | `POST .../combat/initiate`, `POST .../combat/roll-result`, `POST .../combat/action`, `POST .../combat/move/complete` | Tabletop dice flow |
| `session-actions.ts` | `POST .../actions` | Programmatic actions |
| `session-llm.ts` | `POST .../llm/intent`, `POST .../llm/act`, `POST .../llm/narrate` | LLM integration |
| `session-events.ts` | `GET .../events` (SSE), `GET .../events-json` | SSE + event polling |
| `session-inventory.ts` | `GET/POST/DELETE/PATCH .../characters/:charId/inventory` | Character inventory management |

Additional non-session routes:
- `health.ts`: `GET /health`
- `reactions.ts`: `POST /encounters/:encounterId/reactions/:pendingActionId/respond`, `GET /encounters/:encounterId/reactions/:pendingActionId`, `GET /encounters/:encounterId/reactions`

See `packages/game-server/SESSION_API_REFERENCE.md` for full request/response schemas.

## TabletopCombatService Architecture (`combat/tabletop/`)
The former 3,600-line monolith is now a **thin facade** (~370 lines) at `combat/tabletop-combat-service.ts` that delegates to 7 focused modules under `combat/tabletop/`:

| Module | Responsibility |
|--------|---------------|
| `tabletop-types.ts` | All exported types/interfaces (`TabletopPendingAction`, `RollRequest`, `TabletopCombatServiceDeps`, etc.) |
| `combat-text-parser.ts` | Pure text-parsing functions (`tryParseMoveText`, `tryParseSimpleActionText`, `inferActorRef`, etc.) |
| `roll-state-machine.ts` | Roll handlers: `handleInitiativeRoll`, `handleAttackRoll`, `handleDamageRoll`, `handleDeathSaveRoll` + `loadRoster` |
| `action-dispatcher.ts` | `dispatch()` — routes parsed actions to handlers (`handleMoveAction`, `handleAttackAction`, `handleClassAbility`, etc.) |
| `spell-action-handler.ts` | `handleCastSpellAction` (~540 lines) |
| `saving-throw-resolver.ts` | `SavingThrowResolver` — auto-resolves saving throws (replaces temporary MonkTechniqueResolver) |
| `tabletop-event-emitter.ts` | `TabletopEventEmitter` — narration generation + event emission helpers |
| `index.ts` | Barrel re-exports for sub-module access |

The facade's 4 public methods stay unchanged:
- `initiateAction()` → roster loading + pending action creation
- `processRollResult()` → `RollStateMachine.handle*Roll()`
- `parseCombatAction()` → `ActionDispatcher.dispatch()`
- `completeMove()` → delegates to `TwoPhaseActionService`

`abilityRegistry` is **required** in `TabletopCombatServiceDeps` — no optional guards.

## Class-Specific Code: Domain-First Principle
**All class-specific detection, eligibility checks, and combat text matching MUST live in domain class files** (`domain/entities/classes/<class>.ts`), NOT inline in application-layer services. Services consume generic interfaces; the domain declares the class-specific data.

Three complementary patterns achieve this:

---

### Pattern 1: ClassCombatTextProfile (text matching + reactions)
Profile-driven system for parsing combat text into actions, enhancing attacks, and detecting reactive abilities. Profiles are **declared in domain class files** and **collected by a registry**.

#### Core types (`domain/entities/classes/combat-text-profile.ts`)
- **`ClassCombatTextProfile`** — per-class profile with three extension points:
  - `actionMappings: ClassActionMapping[]` — regex → action type for text-based action parsing (e.g., "flurry of blows" → `flurryOfBlows`)
  - `attackEnhancements?: AttackEnhancementDef[]` — abilities that piggyback on attacks (e.g., Stunning Strike auto-applied on unarmed hit)
  - `attackReactions?: AttackReactionDef[]` — reactive abilities triggered when a creature is attacked (e.g., Shield spell, Deflect Attacks)
- **`tryMatchClassAction(text, profiles)`** — finds first matching action across all profiles
- **`matchAttackEnhancements(creature, profiles)`** — returns all applicable enhancements for a creature
- **`detectAttackReactions(input, profiles)`** — returns all eligible reactions for an incoming attack

#### Registry (`domain/entities/classes/registry.ts`)
- `getAllCombatTextProfiles()` returns all registered `ClassCombatTextProfile[]`
- Currently registered: `MONK_COMBAT_TEXT_PROFILE`, `FIGHTER_COMBAT_TEXT_PROFILE`, `WIZARD_COMBAT_TEXT_PROFILE`, `WARLOCK_COMBAT_TEXT_PROFILE`, `BARBARIAN_COMBAT_TEXT_PROFILE`, `PALADIN_COMBAT_TEXT_PROFILE`, `CLERIC_COMBAT_TEXT_PROFILE`

#### Current profile contents
- **monk** (`monk.ts`): 6 action mappings + `StunningStrike` enhancement + `DeflectAttacks` reaction
- **fighter** (`fighter.ts`): 2 action mappings (action surge, second wind)
- **wizard** (`wizard.ts`): 0 action mappings + `Shield` reaction
- **barbarian** (`barbarian.ts`): rage, reckless attack action mappings
- **paladin** (`paladin.ts`): lay on hands, divine smite action mappings
- **cleric** (`cleric.ts`): turn undead action mapping
- **warlock** (`warlock.ts`): eldritch blast action mapping

#### Adding a new profile entry
1. Define the `ClassActionMapping`, `AttackEnhancementDef`, or `AttackReactionDef` const in the class's domain file (e.g., `monk.ts`)
2. Add it to the class's `ClassCombatTextProfile` export (e.g., `MONK_COMBAT_TEXT_PROFILE`)
3. If it's a **new class** that doesn't have a profile yet, create the profile and register it in `registry.ts` → `COMBAT_TEXT_PROFILES` array
4. Application services automatically pick it up via `getAllCombatTextProfiles()` — no service code changes needed

---

### Pattern 2: AbilityRegistry (ability execution)
Executor-based system for **executing** class abilities once they've been identified. Executors live in the **application layer** since they orchestrate combat state changes.

#### Structure
- **Executors** live in `application/services/combat/abilities/executors/<class>/`
  - Class folders: `fighter/`, `monk/`, `rogue/`, `monster/`, `common/`
  - Example: `fighter/action-surge-executor.ts`
- **AbilityRegistry** in `application/services/combat/abilities/ability-registry.ts`
- **Registration** in `infrastructure/api/app.ts` (both main and test registry)

#### Current registered executors (14 total)
- **barbarian**: Rage, RecklessAttack
- **cleric**: TurnUndead
- **fighter**: ActionSurge, SecondWind
- **monk**: FlurryOfBlows, PatientDefense, StepOfTheWind, MartialArts, WholenessOfBody
- **paladin**: LayOnHands
- **rogue**: CunningAction
- **monster**: NimbleEscape
- **common**: OffhandAttack

Note: StunningStrike, DeflectAttacks, OpenHandTechnique are handled as attack enhancements/reactions via ClassCombatTextProfile, not AbilityRegistry executors.

#### Adding a new ability executor
1. Create executor implementing `AbilityExecutor` interface (see `domain/abilities/ability-executor.ts`)
2. Export from class folder's `index.ts`
3. Export from main `executors/index.ts`
4. Register in `app.ts`: `abilityRegistry.register(new YourExecutor())`
5. Add text parser in `TabletopCombatService.parseCombatAction()` if needed
6. Route through `handleClassAbility()` or `handleBonusAbility()` as appropriate

#### Key differences
- **Bonus actions** (Flurry, Patient Defense): Route through `handleBonusAbility()`, consumes bonus action economy
- **Free abilities** (Action Surge): Route through `handleClassAbility()`, doesn't consume action economy but may spend resource pools
- **Resource pools** (ki, actionSurge): Initialize in `handleInitiativeRoll()` when combat starts

---

### Pattern 3: Feature Maps (boolean eligibility gates)
Data-driven system for **boolean feature checks** — "does this class have Rage at this level?" Each class definition declares a `features` map, queried through generic registry functions. Replaces the old `ClassFeatureResolver.has*()` / `is*()` methods.

#### Core types
- **`CharacterClassDefinition.features`** — `Record<string, number>` mapping feature id → minimum class level. Declared in each class's domain file.
- **`feature-keys.ts`** — String constants for all standard feature keys (`RAGE`, `ACTION_SURGE`, `CUNNING_ACTION`, etc.). Use these instead of raw strings for compile-time safety.

#### Registry functions (`domain/entities/classes/registry.ts`)
- `classHasFeature(classId, feature, level)` — single-class check. **Normalizes classId to lowercase.**
- `hasFeature(classLevels, feature)` — multi-class-ready check (takes `Array<{classId, level}>`)
- `getClassFeatureLevel(classId, feature)` — returns the minimum level for a feature, or `undefined`

#### ClassFeatureResolver (computed values only)
`ClassFeatureResolver` now ONLY contains methods that return computed numeric/complex values:
- `getLevel()`, `getProficiencyBonus()` — generic utilities
- `getAttacksPerAction()` — uses `classHasFeature()` internally for Extra Attack tiers
- `getUnarmedStrikeStats()` — uses `classHasFeature()` for Monk detection
- `getClassCapabilities()` — delegates to class definition's `capabilitiesForLevel()`
- `hasOpenHandTechnique()` — kept because it has a subclass guard that can't be expressed in the features map alone

**NEVER add new boolean feature checks to ClassFeatureResolver.** Use the features map pattern instead.

#### Adding a new boolean feature gate
1. Add constant in `feature-keys.ts`: `export const MY_FEATURE = "my-feature"`
2. Add to the class's `features` map in its domain file: `"my-feature": 3` (minimum level)
3. Use `classHasFeature(classId, MY_FEATURE, level)` from application services
4. For subclass-gated features: features map provides level gate (necessary), executor guards subclass (sufficient)

## Rules content pipeline (RuleBookDocs → Prisma definitions)
- `pnpm -C packages/game-server import:rulebook` loads equipment/feats from `RuleBookDocs/markdown` (see `packages/game-server/scripts/import-rulebook.ts`).
- `pnpm -C packages/game-server import:monsters` loads stat blocks from `RuleBookDocs/markdown` (see `packages/game-server/scripts/import-monsters.ts`).

## Test harness scripts (`packages/game-server/scripts/`)
- `scripts/test-harness/combat-e2e.ts`: E2E combat test runner (run via `pnpm -C packages/game-server test:e2e:combat:mock`).
- `scripts/test-harness/scenario-runner.ts`: scenario execution engine.
- `scripts/test-harness/scenarios/`: 43 JSON combat scenario definitions (happy-path, fighter abilities, monk abilities, rogue tactics, wizard spells, grapple, opportunity attacks, etc.).
- `scripts/test-harness/llm-e2e.ts`: LLM accuracy test runner (run via `pnpm -C packages/game-server test:llm:e2e`). Requires real Ollama + `DM_OLLAMA_MODEL`.
- `scripts/test-harness/llm-scenario-runner.ts`: LLM scenario step execution engine.
- `scripts/test-harness/llm-scenario-types.ts`: LLM scenario JSON schema types.
- `scripts/test-harness/llm-snapshot.ts`: prompt snapshot capture/compare utilities.
- `scripts/test-harness/llm-scenarios/`: JSON LLM test scenarios organized by category (`intent/`, `narration/`, `ai-decision/`).
- `scripts/test-harness/llm-snapshots/`: stored prompt snapshots (auto-generated via `--update-snapshots`).
- `src/infrastructure/llm/spy-provider.ts`: `SpyLlmProvider` — transparent wrapper that records LLM calls for snapshot testing.
- `scripts/import-rulebook.ts` / `scripts/import-monsters.ts`: rulebook content importers.
- `scripts/run-vitest-with-env.ts`: vitest wrapper with environment variable injection.

## Standards that matter here
- Explicit `.js` extensions in TS imports (NodeNext ESM). Preserve this style.
- Server is the source of truth for mechanics; LLM never decides rules.
- API error mapping depends on `NotFoundError` / `ValidationError` and Fastify’s error handler in `packages/game-server/src/infrastructure/api/app.ts`.

## Testing patterns
- Fast/unit tests: in-memory repositories (`infrastructure/testing/memory-repos.ts`) + stubs with Fastify `app.inject()` (see `packages/game-server/src/infrastructure/api/app.test.ts`).
- Integration tests: `combat-service-domain.integration.test.ts`, `character-generator.integration.test.ts`.
  - Default `pnpm -C packages/game-server test` is deterministic; real-LLM tests are skipped unless `DM_RUN_LLM_TESTS=1|true|yes`.
  - Run LLM combat e2e separately: `pnpm -C packages/game-server test:e2e:combat:llm`.
  - Run all LLM integration tests (combat + character generator): `pnpm -C packages/game-server test:llm`.
  - Run mock E2E combat scenarios: `pnpm -C packages/game-server test:e2e:combat:mock`.
  - Run LLM accuracy E2E (all categories): `pnpm -C packages/game-server test:llm:e2e` (requires Ollama).
  - Run LLM intent tests only: `pnpm -C packages/game-server test:llm:e2e:intent`.
  - Run LLM narration tests only: `pnpm -C packages/game-server test:llm:e2e:narration`.
  - Run LLM AI decision tests only: `pnpm -C packages/game-server test:llm:e2e:ai`.
  - Update prompt snapshots: `pnpm -C packages/game-server test:llm:e2e:snapshot-update`.
  - Interactive: `pnpm -C packages/game-server test:watch`, `pnpm -C packages/game-server test:ui`.
