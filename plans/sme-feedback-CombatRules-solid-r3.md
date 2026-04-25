---
type: sme-feedback
flow: CombatRules
feature: canonical-doc-solid-audit
author: CombatRules-SME
status: COMPLETE
round: 3
created: 2026-04-25
updated: 2026-04-25
---

# SME Feedback — CombatRules — SOLID Audit (R3)
## Verdict: SOLID

## Scope Checked
- AGENTS.md
- .github/copilot-instructions.md
- .github/instructions/combat-rules.instructions.md
- packages/game-server/src/domain/rules/CLAUDE.md
- packages/game-server/src/domain/combat/CLAUDE.md
- packages/game-server/src/domain/effects/CLAUDE.md

## Concrete Blockers
1. None.

## Notes
- AGENTS.md and .github/copilot-instructions.md are consistent on CombatRules flow mapping.
- Scoped CombatRules guardrails now exist for all three surfaces: domain/rules, domain/combat, and domain/effects.
- .github/instructions/combat-rules.instructions.md weapon mastery section now describes WEAPON_MASTERY_MAP semantically (no stale fixed count), so the prior blocker is resolved.
- .github/instructions/combat-rules.instructions.md applyTo includes domain/entities/combat/effects.ts, preserving effect-lifecycle coverage in canonical flow law.