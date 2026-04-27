# Testing Instructions

> Apply to: all test-related workflows across all agents.

## Quick Reference — Test Commands

All commands assume cwd is the repo root. **Do NOT change directory first.**

### 1. TypeScript Compilation Check
```powershell
pnpm -C packages/game-server typecheck
```
Run this FIRST before any test suite. Zero output = success.

### 2. Unit & Integration Tests (fast, no LLM, no server needed)
```powershell
pnpm -C packages/game-server test
```
Runs all Vitest tests. Expect output like: `Test Files  N passed | M skipped (total)`

### 3. E2E Combat Scenarios (mock LLM, in-process server)

**CRITICAL: You MUST pass `--all` to run all scenarios. Without it, only `core/happy-path` runs.**

```powershell
# Run ALL scenarios (170+) — this is what you want for verification
pnpm -C packages/game-server test:e2e:combat:mock -- --all

# Run a single scenario by name
pnpm -C packages/game-server test:e2e:combat:mock -- --scenario=core/happy-path

# Verbose (step summaries + narration)
pnpm -C packages/game-server test:e2e:combat:mock -- --all --verbose

# Detailed (full request/response JSON for debugging)
pnpm -C packages/game-server test:e2e:combat:mock -- --all --detailed
```

The E2E harness starts its own in-process Fastify server on port 3099 with in-memory repos and mock LLM. **No external server needed.**

### 4. Reading E2E Output

The final summary line is the only line that matters:
```
  Total: 170 passed, 0 failed
```

Individual scenario results look like:
```
✅ PASSED: 9/9 steps
```

Lines saying `[Action Failed]` in the middle of output are **expected in-game failures** (part of scenario test logic, e.g., testing range validation). They are NOT test failures. Only the final `Total:` line and per-scenario `PASSED`/`FAILED` banners matter.

### 5. Standard Verification Sequence

After any code change, run this sequence:
```powershell
pnpm -C packages/game-server typecheck
pnpm -C packages/game-server test
pnpm -C packages/game-server test:e2e:combat:mock -- --all
```

To capture summary only from E2E:
```powershell
pnpm -C packages/game-server test:e2e:combat:mock -- --all 2>&1 | Select-Object -Last 3
```
This will show the `Total: N passed, M failed` line.

### 6. LLM Tests (only when explicitly asked)

These require a running Ollama instance with `DM_OLLAMA_MODEL` set.

```powershell
# All LLM integration tests
pnpm -C packages/game-server test:llm

# LLM accuracy E2E (all categories)
pnpm -C packages/game-server test:llm:e2e

# By category
pnpm -C packages/game-server test:llm:e2e:intent
pnpm -C packages/game-server test:llm:e2e:narration
pnpm -C packages/game-server test:llm:e2e:ai
```

**Never run LLM tests unless the user explicitly asks for them.**

### 7. Running a Specific Vitest File

```powershell
pnpm -C packages/game-server exec vitest run path/to/file.test.ts --reporter=verbose
```

### 8. Running Tests Matching a Pattern

```powershell
pnpm -C packages/game-server exec vitest run --testNamePattern "pattern" --reporter=verbose
```

## Windows PowerShell Reminders

- `| head -N` → `| Select-Object -First N`
- `| tail -N` → `| Select-Object -Last N`
- `| grep "x"` → `| Select-String "x"`
- `cmd1 && cmd2` → `cmd1 ; cmd2`
- `2>&1 | head -80` is BROKEN — use `2>&1 | Select-Object -First 80`

## Test File Locations

| Type | Location |
|------|----------|
| Unit tests | `src/**/*.test.ts` |
| Integration tests | `src/**/*.integration.test.ts` |
| E2E scenario JSON | `scripts/test-harness/scenarios/**/*.json` |
| E2E runner | `scripts/test-harness/combat-e2e.ts` |
| Scenario executor | `scripts/test-harness/scenario-runner.ts` |
| Mock LLM | `src/infrastructure/llm/mocks/index.ts` |
| In-memory repos | `src/infrastructure/testing/memory-repos.ts` |

## API Docs Alignment

- Canonical client API docs live in `docs/api/` (README + reference + guides).
- When changing routes, payloads, errors, events, or client integration loops, update the matching files in `docs/api/reference/` and `docs/api/guides/` in the same change.
- For SME research, agent reviews, and implementation plans that affect client contracts, cite and update the impacted docs under `docs/api/`.
- Treat these docs as done criteria for contract changes: `docs/api/reference/endpoints.md`, `docs/api/reference/schemas.md`, `docs/api/reference/events.md`, and `docs/api/reference/errors.md`.
