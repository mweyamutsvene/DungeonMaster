# Plan: Mock LLM Combat Testing Harness

Create a test harness that uses mock LLM implementations returning predictable values, enabling deterministic combat API testing without requiring Ollama.

## Steps

1. **Create a `MockIntentParser`** in a new file `packages/game-server/scripts/test-harness/mocks.ts` that pattern-matches input text and returns expected `ParsedIntent` commands (e.g., `"I attack the goblin"` → `{ kind: "attack", targetName: "goblin" }`).

2. **Create a `MockNarrativeGenerator`** in the same file that returns templated narrative strings based on event types, allowing tests to verify narrative flow without LLM latency.

3. **Build a test runner script** `packages/game-server/scripts/test-harness/combat-e2e.ts` that uses `buildApp()` with in-memory repos and mock LLM deps, exposing the Fastify app for HTTP testing via `app.listen()`.

4. **Define a test scenario JSON file** `packages/game-server/scripts/test-harness/scenarios/happy-path.json` that declares: session setup, character/monster data, action sequence, and expected responses—allowing the harness to replay and assert.

5. **Add npm script** in `packages/game-server/package.json`: `"test:e2e:combat:mock": "tsx scripts/test-harness/combat-e2e.ts"` to run the mock-LLM E2E tests easily.

## Further Considerations

1. **Mock response strategy?** Option A: Hardcoded map of input patterns → outputs / Option B: Configurable per-scenario via JSON / Option C: Sequence-based (return nth response) — I recommend A for simplicity with B for advanced scenarios.

2. **Should mock live in `scripts/` or `src/infrastructure/llm/mocks/`?** Putting it in `src/` allows reuse in Vitest tests; `scripts/` keeps it isolated to E2E harness. Recommend `src/infrastructure/llm/mocks/` for reuse.

3. **Real HTTP vs `app.inject()`?** For true E2E, the harness should call `app.listen(3099)` and use `fetch()` against localhost:3099. This catches serialization issues that `inject()` misses.

## Research Context

### LLM Interfaces to Mock

| Interface | Method Signature |
|-----------|------------------|
| `IIntentParser` | `parse(text: string, context?: object): Promise<ParsedIntent>` |
| `INarrativeGenerator` | `narrate(input: { events: Event[] }): Promise<string>` |
| `IStoryGenerator` | `generateStoryFramework(seed?: number): Promise<StoryFramework>` |
| `ICharacterGenerator` | `generateCharacter(opts: { className, level, seed? }): Promise<CharacterSheet>` |
| `IAiDecisionMaker` | `decide(context: CombatContext): Promise<AiDecision>` |

### Existing Mock Patterns (from tests)

**Inline object mock:**
```typescript
const intentParser: IIntentParser = {
  async parse(text: string) {
    if (text.includes("attack")) {
      return { kind: "attack", targetName: "Goblin" };
    }
    if (text.match(/move to \((\d+),\s*(\d+)\)/)) {
      const [, x, y] = text.match(/move to \((\d+),\s*(\d+)\)/)!;
      return { kind: "move", destination: { x: +x, y: +y } };
    }
    return { kind: "unknown" };
  },
};
```

**Using with buildApp:**
```typescript
const { app } = buildApp({
  ...inMemoryRepos,
  intentParser,
  narrativeGenerator,
  storyGenerator,
  characterGenerator,
});
```

### Combat Test Scenario Structure (proposed)

```json
{
  "name": "Happy Path: Fighter vs Goblin",
  "setup": {
    "character": {
      "name": "Thorin",
      "className": "fighter",
      "level": 5,
      "sheet": { /* ... */ }
    },
    "monsters": [
      { "name": "Goblin Warrior", "statBlock": { /* ... */ } }
    ]
  },
  "actions": [
    {
      "type": "initiate",
      "input": { "text": "I attack the goblin", "actorId": "$characterId" },
      "expectRollRequest": { "rollType": "initiative" }
    },
    {
      "type": "rollResult",
      "input": { "text": "I rolled 15", "actorId": "$characterId" },
      "expectCombatStarted": true
    },
    {
      "type": "action",
      "input": { "text": "I attack the Goblin Warrior", "actorId": "$characterId" },
      "expectRollRequest": { "rollType": "attack" }
    },
    {
      "type": "rollResult",
      "input": { "text": "I rolled 18", "actorId": "$characterId" },
      "expectHit": true,
      "expectRollRequest": { "rollType": "damage" }
    },
    {
      "type": "rollResult",
      "input": { "text": "I rolled 6", "actorId": "$characterId" },
      "expectActionComplete": true
    }
  ]
}
```

## File Structure

```
packages/game-server/
├── scripts/
│   └── test-harness/
│       ├── mocks.ts              # MockIntentParser, MockNarrativeGenerator, etc.
│       ├── combat-e2e.ts         # Main test runner script
│       ├── scenario-runner.ts    # Loads and executes scenario JSON files
│       └── scenarios/
│           ├── happy-path.json   # Fighter kills goblin
│           ├── multi-strike.json # Monk Flurry of Blows
│           ├── movement-oa.json  # Movement with opportunity attacks
│           └── miss-sequence.json# Attack misses, no damage roll
└── src/
    └── infrastructure/
        └── llm/
            └── mocks/
                └── index.ts      # Reusable mock implementations for Vitest
```

## Commands to Run

```bash
# Run mock-LLM E2E tests
pnpm -C packages/game-server test:e2e:combat:mock

# Run specific scenario
pnpm -C packages/game-server test:e2e:combat:mock -- --scenario=happy-path
```
