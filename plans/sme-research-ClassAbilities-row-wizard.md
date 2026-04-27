---
type: sme-research
flow: ClassAbilities
feature: classabilities-row-wizard-staleness
author: DMDeveloper
status: DRAFT
round: 1
created: 2026-04-26
updated: 2026-04-26
---

# Scope

Audit only the Wizard row in section `2.2 ClassAbilities` of `plans/mechanics-and-coverage-report.md` for stale or incorrect claims, verified against current class-ability code plus current Wizard tests and scenarios.

# Row Verdict

INCORRECT

# Evidence

- `packages/game-server/src/domain/entities/classes/wizard.ts`: Wizard L1 capabilities include Spellcasting, Arcane Recovery, and Ritual Adept text; Wizard also has a registered `SchoolOfEvocationSubclass`, so `Arcane Tradition MISSING` is no longer accurate as written.
- `packages/game-server/src/application/services/combat/tabletop/spell-action-handler.ts`: non-cantrip spell casting still rejects spells not in prepared or known lists; no Wizard Ritual Adept exception is wired in the runtime cast path.
- `packages/game-server/src/domain/rules/spell-preparation.ts`: Wizard is a prepared caster, and spell availability checks only prepared or known lists.
- `packages/game-server/src/domain/entities/spells/catalog/types.ts`: ritual mode is explicitly marked TODO for SpellActionHandler/API wiring, which contradicts `Ritual Adept SUP`.
- `packages/game-server/src/domain/entities/classes/feature-keys.ts`: Wizard keys include `ARCANE_RECOVERY`, `RITUAL_ADEPT`, `SCULPT_SPELLS`, and `EVOCATION_SAVANT`; there is no `Scholar` feature key or Wizard Scholar implementation surface.
- `packages/game-server/src/domain/entities/classes/subclass-framework.test.ts`: current tests verify the Wizard Evocation subclass shell resolves and grants L3 feature gates, so subclass support is partial rather than missing.
- `packages/game-server/src/domain/entities/classes/wizard.test.ts`: current unit coverage verifies Arcane Recovery state and Wizard subclass feature gating.
- `packages/game-server/src/domain/entities/classes/wizard.arcane-recovery.test.ts`: Arcane Recovery refund rules are unit-tested.
- `packages/game-server/src/domain/rules/rest.test.ts`: rest-flow tests verify Wizard Arcane Recovery refreshes only on long rest.
- `packages/game-server/scripts/test-harness/scenarios/wizard/arcane-recovery.json`: deterministic scenario coverage proves Arcane Recovery works through the current rest flow.
- `packages/game-server/scripts/test-harness/scenarios/wizard/spell-slots.json`: deterministic Wizard spellcasting scenario coverage supports `Spellcasting SUP`.

# Proposed row edits

Replace:

```md
| **Wizard** | Spellcasting, Ritual Adept SUP, Arcane Recovery via rest flow SUP | Scholar (2024) | Arcane Tradition MISSING | ASI | no universal |
```

With:

```md
| **Wizard** | Spellcasting SUP, Ritual Adept MISSING, Arcane Recovery via rest flow SUP | Scholar MISSING | Arcane Tradition PARTIAL (Evocation subclass shell only) | ASI (cross-flow) | no universal |
```

# Risks

- If there is an unreviewed non-tabletop ritual-casting entry point outside `SpellActionHandler`, `Ritual Adept` could be better classified as PARTIAL instead of MISSING; no such path was found in the audited Wizard/runtime surfaces.
- `Scholar` is treated as MISSING because no current implementation or test/scenario evidence was found; if the report intends to omit non-combat utility features entirely, the row may need wording guidance across all classes.

# Open Questions

- Should ClassAbilities rows consistently mark generic ASI entries as `ASI (cross-flow)` for all classes, including Wizard?
- Should non-combat class features like `Scholar` stay in this table as `MISSING`, or be removed from the coverage row format entirely when they have no combat/runtime surface?