# AIBehavior — Architectural Constraints

## Scope
`combat/ai/*`, `infrastructure/llm/*`

## Laws
1. **LLM is always optional** — every code path must handle "LLM not configured" gracefully.
2. **AI decisions are advisory** — the rules engine validates and may reject LLM-suggested actions. Never trust LLM output as authoritative.
3. **Battle plans are faction-scoped** — one plan per faction, re-planned when conditions change significantly.
4. **Multiple LLM backends** — Ollama (local), OpenAI, GitHub Models. Factory pattern selects based on env vars. Always test with mock provider.
5. **Prompt format changes** require updating snapshots via `test:llm:e2e:snapshot-update`.
