# Domain Combat Entities — Quick Constraints

Speak caveman. Keep short.

## Scope
`domain/entities/combat/*`

## Laws
1. Keep pure data + helpers. No app/infra import.
2. Action economy shape here is source for action/bonus/reaction/move budget.
3. Pending action types here are source for reaction/tabletop pending unions.
4. If enum/union change, update all consumers same pass (tabletop, two-phase, API, tests).
5. Do not hide ownership. Flow instructions stay primary law.