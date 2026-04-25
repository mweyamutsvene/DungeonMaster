# LLM Infrastructure — Quick Constraints

Speak caveman. Keep short.

## Scope
`infrastructure/llm/*`

## Laws
1. LLM optional always. Missing provider path must work.
2. Provider chosen by env + factory. No hardcoded backend.
3. Mock-first testing. Real LLM only when explicitly enabled.
4. `SpyLlmProvider` snapshots prompts; prompt changes require snapshot update.
