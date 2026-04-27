# SME Feedback — CombatRules — Round 2
## Verdict: APPROVED

## Missing Context
- The updated plan now captures the CombatRules-critical parity requirement: target contest resistance must use full STR/DEX save totals (including save proficiency where applicable), matching tabletop semantics.

## Suggested Changes
1. During implementation, keep the domain helper contract explicit and typed as full save totals (not raw ability modifiers) to prevent future drift.
2. Preserve existing contest invariants: target chooses better STR/DEX total, ties resist, and STR/DEX auto-fail conditions continue to short-circuit.
