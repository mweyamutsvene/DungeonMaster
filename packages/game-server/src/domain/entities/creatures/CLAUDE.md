# Creature Entities — Quick Constraints

Speak caveman. Keep short.

## Scope
`domain/entities/creatures/*`

## Laws
1. Creature shape is shared contract for hydration and combat.
2. Keep entity logic deterministic and domain-only.
3. AC, conditions, defenses, and status behavior stay in entity/rule layer, not API layer.
4. Shape change means update hydration/repos/tests together.
5. Follow `.github/instructions/entity-management.instructions.md` and `.github/instructions/creature-hydration.instructions.md`.
