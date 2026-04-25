# Domain Abilities — Quick Constraints

Speak caveman. Keep short.

## Scope
`domain/abilities/*`

## Laws
1. Keep ability contracts and constants domain-first and pure.
2. No app/infra imports from here.
3. Ability IDs and feature keys must match executor registry and profile mappings.
4. If contract changes, update executors/tests in same change.
5. Follow `.github/instructions/class-abilities.instructions.md` as primary law.
