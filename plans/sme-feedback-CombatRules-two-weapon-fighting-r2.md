# SME Feedback — CombatRules — Round 2
## Verdict: APPROVED

## Concise Notes
1. CombatRules scope is now domain-first and explicit: a pure evaluator in two-weapon-fighting.ts with structured fields (`allowed`, `reason`, `requiresBonusAction`, `usesNick`, `offhandAddsAbilityModifier`) removes prior ambiguity.
2. The plan now correctly treats Attack action as a hard prerequisite and includes Nick once-per-turn state as an explicit input/behavior contract, which matches 2024 TWF expectations.
3. Dual Wielder override and TWF style damage policy are included in the CombatRules contract, reducing parser/fallback drift risk across orchestration paths.
4. Planned domain tests cover the required acceptance matrix for CombatRules (Light baseline, non-Light rejection, Dual Wielder allowance, Attack-action prerequisite, Nick lifecycle, style policy).
