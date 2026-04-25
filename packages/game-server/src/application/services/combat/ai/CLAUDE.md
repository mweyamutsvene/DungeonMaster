# AIBehavior — Quick Constraints

Speak caveman. Keep short.

## Scope
`combat/ai/*`, `infrastructure/llm/*`

## Laws
1. LLM optional always. If missing or null, deterministic AI take over.
2. AI decision is suggestion only. Rules engine is judge.
3. Battle plans are faction-scoped; replan on big state change.
4. Support Ollama, OpenAI, GitHub Models, Copilot. Pick by env + factory.
5. Prompt format change needs snapshot update: `test:llm:e2e:snapshot-update`.
