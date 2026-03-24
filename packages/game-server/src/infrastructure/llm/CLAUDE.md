# LLM Infrastructure — Architectural Constraints

## Scope
`infrastructure/llm/*`

## Laws
1. **LLM is always optional** — every adapter and consumer must handle missing provider gracefully.
2. **Factory pattern** — env vars select the backend. Never hardcode a specific provider.
3. **Mock-first testing** — default tests use mock providers. Real LLM only with `DM_RUN_LLM_TESTS=1`.
4. **SpyLlmProvider** records prompts for snapshot testing. Prompt format changes require `test:llm:e2e:snapshot-update`.
