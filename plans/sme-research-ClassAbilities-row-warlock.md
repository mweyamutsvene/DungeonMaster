---
type: sme-research
flow: ClassAbilities
feature: classabilities-row-warlock-staleness
author: DMDeveloper
status: DRAFT
round: 1
created: 2026-04-26
updated: 2026-04-26
---

# Scope

Audit ONLY the Warlock row in section `2.2 ClassAbilities` of `plans/mechanics-and-coverage-report.md` for stale or incorrect claims, verified against current code, tests, and deterministic scenarios.

# Row Verdict

INCORRECT

# Evidence

- `plans/mechanics-and-coverage-report.md`: Current row says `L1 subclass defs PARTIAL`, which does not match the current Warlock subclass model.
- `packages/game-server/src/domain/entities/classes/warlock.ts`: Warlock defines `TheFiendSubclass` with subclass features at level 3 and exposes `PACT_BOON` at level 3; Pact Magic, Magical Cunning, and Agonizing Blast helpers are implemented here.
- `packages/game-server/src/domain/entities/classes/warlock.test.ts`: Unit tests verify pact-slot progression, Pact Boon appearing at level 3, Agonizing Blast helpers, and Fiend Dark One's Blessing qualification.
- `packages/game-server/src/domain/entities/classes/subclass-framework.test.ts`: Subclass framework tests verify Warlock subclass lookup and level-3 subclass feature gating.
- `packages/game-server/src/application/services/combat/abilities/executors/warlock/magical-cunning-executor.ts`: Magical Cunning has a real executor that restores half of Pact Magic slots and spends its long-rest use.
- `packages/game-server/src/infrastructure/api/app.ts`: Main ability registry registers `MagicalCunningExecutor`, confirming live wiring in the primary app path.
- `packages/game-server/src/application/services/combat/tabletop/spell-delivery/spell-attack-delivery-handler.ts`: Eldritch Blast damage adds Agonizing Blast's Charisma modifier per beam.
- `packages/game-server/scripts/test-harness/scenarios/warlock/short-rest-pact-magic.json`: Deterministic scenario covers Pact Magic short-rest refresh.
- `packages/game-server/scripts/test-harness/scenarios/warlock/fiend-dark-ones-blessing.json`: Deterministic scenario covers Agonizing Blast damage bonus and Fiend Dark One's Blessing temp HP at level 3.
- `packages/game-server/src/domain/entities/spells/spell-progression.ts`: Warlock level 5 progression is two pact slots at slot level 3, matching the row's `3rd-lvl Pact slots` claim.

# Proposed row edits

Replace:

```md
| **Warlock** | Pact Magic SUP, Agonizing Blast invocation SUP, L1 subclass defs PARTIAL | Magical Cunning SUP | Pact Boon MISSING | ASI | 3rd-lvl Pact slots |
```

With:

```md
| **Warlock** | Pact Magic SUP, Agonizing Blast invocation SUP | Magical Cunning SUP | L3 subclass defs PARTIAL, Pact Boon MISSING | ASI | 3rd-lvl Pact slots |
```

# Risks

- Magical Cunning is implemented and registered, but this audit did not find a dedicated deterministic Warlock scenario for its live use.
- Agonizing Blast has deterministic coverage at level 3 single-beam resolution; broader multi-beam invocation coverage remains thinner than Pact Magic coverage.

# Open Questions

- Should `Magical Cunning SUP` remain as-is, or be softened until there is direct deterministic scenario coverage for the executor path?