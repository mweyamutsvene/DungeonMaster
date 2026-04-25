# Domain Effects — Quick Constraints

Speak caveman. Keep short.

## Scope
`domain/effects/*`

## Laws
1. Effect model and behavior stay deterministic and pure.
2. No infra imports. No DB/API/LLM coupling.
3. Keep effect semantics aligned with combat cleanup timing.
4. If effect contract changes, update domain users and tests together.
5. Follow `.github/instructions/combat-rules.instructions.md` as primary law.
