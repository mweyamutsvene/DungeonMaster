# CombatRules — Quick Constraints

Speak caveman. Keep short.

## Scope
`domain/rules/`, `domain/combat/`, `domain/effects/`

## Laws
1. `domain/rules/` stay pure. `domain/combat/` and `domain/effects/` can hold state or mutate creature, but still no repo, DB, API, event bus, or LLM stuff.
2. Keep imports inside domain only. Rules can read entities. Some entities already read shared rule helpers too. Do not pull app or infra into this flow, and do not make cycle.
3. Use D&D 5e 2024 rules, not 2014.
4. Class resource declarations flow through class definitions + registry; class resource shape changes still ripple into `class-resources.ts` consumers.
5. Combat map modules are high fanout; map changes require downstream tests (path, cover, zone, movement).

6. Movement state live in `rules/movement.ts` now. `combat/movement.ts` dead. Do not bring dead file back.

## API Docs Alignment

- Canonical client API docs live in `docs/api/` (README + reference + guides).
- When changing routes, payloads, errors, events, or client integration loops, update the matching files in `docs/api/reference/` and `docs/api/guides/` in the same change.
- For SME research, agent reviews, and implementation plans that affect client contracts, cite and update the impacted docs under `docs/api/`.
- Treat these docs as done criteria for contract changes: `docs/api/reference/endpoints.md`, `docs/api/reference/schemas.md`, `docs/api/reference/events.md`, and `docs/api/reference/errors.md`.
