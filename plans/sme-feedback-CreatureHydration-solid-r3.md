# SME Feedback — CreatureHydration Solidness Audit — R3 (Retry)

## Verdict
SOLID

## Scope Audited
- AGENTS.md
- .github/copilot-instructions.md
- .github/instructions/creature-hydration.instructions.md
- packages/game-server/src/application/services/combat/CLAUDE.md
- packages/game-server/src/domain/entities/items/CLAUDE.md
- packages/game-server/CLAUDE.md
- CLAUDE.md

## Findings
- Canonical flow mapping is consistent: AGENTS.md and .github/copilot-instructions.md both register CreatureHydration against .github/instructions/creature-hydration.instructions.md with no competing primary-law source.
- Instruction precedence is coherent for this flow: AGENTS.md declares .github/instructions/*.instructions.md as primary flow law, while scoped CLAUDE files are local constraints; this matches the CreatureHydration instruction design.
- CreatureHydration boundaries are internally consistent in canonical docs: schemaless Character.sheet defensive parsing, separate hydration entry points (character/monster/npc), strict-vs-defensive split with combatant resolver, and adapter contract requirements.
- AC and equipment responsibilities are aligned between flow docs and item-scoped constraints: equipped-items stays shape/type oriented, while AC computation remains in creature/entity logic and armor-catalog formulas.
- No canonical-document contradiction in scope forces a SOLID violation for this flow.

## NOT_SOLID Blockers
None.
