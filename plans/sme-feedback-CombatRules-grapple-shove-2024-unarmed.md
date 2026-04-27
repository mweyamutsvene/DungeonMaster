# SME Feedback — CombatRules — Round 1
## Verdict: APPROVED

## Missing Context
- Current domain/programmatic grapple-shove path still applies raw STR/DEX modifiers for target saves, while tabletop contest save resolution already includes save proficiency. The plan correctly closes this parity gap.

## Suggested Changes
1. Keep the domain helper contract explicit that incoming target save modifiers are full save totals (ability + proficiency when proficient), not raw ability mods.
2. Preserve existing contest invariants while implementing: target chooses better STR/DEX total, save tie resists, auto-fail STR/DEX conditions honored, and attack-slot consumption unchanged on hit/miss branches.
