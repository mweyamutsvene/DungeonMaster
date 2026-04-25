# Domain Combat — Quick Constraints

Speak caveman. Keep short.

## Scope
`domain/combat/*`

## Laws
1. Keep domain pure. No Fastify, Prisma, LLM, repo imports.
2. Combat state machine lives here. Turn/round/order rules stay deterministic.
3. Attack resolution here is full domain pipeline. Keep helper rules in `domain/rules/*` pure and reusable.
4. If combat state shape changes, update hydration and tests same pass.
5. Follow `.github/instructions/combat-rules.instructions.md` as primary law.
