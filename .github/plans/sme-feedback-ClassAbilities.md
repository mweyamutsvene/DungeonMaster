# SME Feedback — ClassAbilities — Round 1
## Verdict: APPROVED

All ClassAbilities changes are sound. The domain-first principle is respected, no unnecessary executors are proposed, exports/registration are correct, and D&D 5e 2024 level thresholds are accurate. Two non-blocking suggestions below.

## Feedback

1. **Danger Sense condition gating rule belongs in domain** — The plan puts the "Danger Sense doesn't work when blinded/deafened/incapacitated" rule inline in the `SavingThrowResolver` (CombatOrchestration section). Per domain-first principle, the *rule* (which conditions negate Danger Sense) should live in `barbarian.ts` as a domain helper:
   ```ts
   const DANGER_SENSE_NEGATING_CONDITIONS = ['blinded', 'deafened', 'incapacitated'] as const;
   export function isDangerSenseNegated(conditions: string[]): boolean {
     return conditions.some(c => DANGER_SENSE_NEGATING_CONDITIONS.includes(c.toLowerCase() as any));
   }
   ```
   The `SavingThrowResolver` would then call this function instead of hardcoding the condition list. This keeps the D&D rule in domain and prevents rule duplication if Danger Sense is checked elsewhere in the future. **Non-blocking** — the current plan works, just leaks a rule into the application layer.

2. **`capabilitiesForLevel` — passive features need care** — The plan lists Unarmored Defense, Danger Sense, and Feral Instinct in `capabilitiesForLevel`, but these are passive features without action economy. The `ClassCapability` interface requires `economy: "action" | "bonusAction" | "reaction" | "free"`. Recommendation: either use `economy: "free"` for these (consistent with how Fighter lists `Indomitable`), or omit truly passive features (Unarmored Defense has no activation — it's always on) and only list features that have a meaningful tactical choice. Rage and Reckless Attack clearly belong; Unarmored Defense arguably does not. Implementer should decide, but be consistent with Fighter's pattern.

## Verified Correct
- `barbarianUnarmoredDefenseAC(dexMod, conMod) → 10 + dexMod + conMod` — matches D&D 5e 2024 Unarmored Defense.
- `hasDangerSense(level) → level >= 2` — correct for 2024 Barbarian.
- `hasFeralInstinct(level) → level >= 7` — correct for 2024 Barbarian.
- `shouldRageEnd(attacked, tookDamage, isUnconscious) → (!attacked && !tookDamage) || isUnconscious` — matches 2024 Rage end conditions.
- No new executors needed — all four features are passive or state-management. Rage activation/deactivation already has an executor.
- No changes to `registry.ts` — `BARBARIAN_COMBAT_TEXT_PROFILE` is already registered.
- No changes to `app.ts` — no new executor registration required.
- Barrel export (`domain/entities/classes/index.ts` has `export * from "./barbarian.js"`) will pick up new functions automatically.
- `ClassFeatureResolver.hasDangerSense()` and `hasFeralInstinct()` follow the established pattern (check `isBarbarian()`, then delegate to domain function).
- `class-resources.ts` already imports `createRageState` from barbarian — no ripple from new additions.

## Out of Scope (noted, not blocking)
- **Rage 10-minute/100-round duration**: The plan handles turn-by-turn and KO rage termination but not the 10-minute max duration. Reasonable for scope — combats rarely last that long. Worth a TODO in implementation.
- **Persistent Rage (Level 15) / Relentless Rage (Level 11)**: Higher-level Barbarian features that modify rage end conditions. Not in scope for this phase but `shouldRageEnd` should be designed to accommodate future level-gating.

## Suggested Changes
1. Add `isDangerSenseNegated(conditions: string[]): boolean` to `barbarian.ts` (domain) and reference it from the SavingThrowResolver plan step instead of inline condition list. This is a suggestion for the CombatOrchestration section, flagged here because it involves a Barbarian domain rule.
