# Combat Abilities Services — Quick Constraints

Speak caveman. Keep short.

## Scope
`application/services/combat/abilities/*`

## Laws
1. Executors do one job each. Keep class-specific logic modular.
2. Registry wiring must stay explicit and testable.
3. No hidden class detection here; source of truth is class domain profiles/maps.
4. If new executor added, update registration and tests same pass.
5. Follow `.github/instructions/class-abilities.instructions.md` as primary law.
