# SME Feedback — EntityManagement — Round 1

## Verdict: APPROVED

## Feedback

### 1. Mock Generator Barbarian Template Stats — Reasonable

The plan says STR 16, DEX 14, CON 16. These are standard point-buy optimized Barbarian stats for D&D 5e 2024. STR as primary for melee, CON as secondary for both HP (d12 hit die) and Unarmored Defense, DEX at 14 for a +2 modifier. This matches the quality and style of the existing templates (Fighter gets STR 16/DEX 14/CON 15, Monk gets DEX 16/WIS 15/CON 14, etc.).

Equipment (Greataxe, javelins, no armor) is correct — Barbarians typically favor two-handed weapons and don't wear armor to benefit from Unarmored Defense. No shield is included, which is fine for a default template (shield is optional and would change the build style). Proficiencies should include Light, Medium, Shields (per D&D 5e 2024 Barbarian) — the plan doesn't explicitly list these but they should be in the template. Not a blocker since the existing `Barbarian` ClassDefinition already has `savingThrows: ["strength", "constitution"]` and the mock template can simply list the armor/weapon proficiencies directly, same as every other template.

### 2. AC Computation — Correct

The plan specifies: `if className === "barbarian" && !hasArmor → armorClass = 10 + dexMod + conMod`. This is exactly D&D 5e 2024 Unarmored Defense for Barbarian. With template stats (DEX 14 → +2, CON 16 → +3), the result is AC 15, which matches the value already hardcoded in existing barbarian test scenarios (`rage.json` has `armorClass: 15`).

The plan correctly places this check alongside the existing Monk Unarmored Defense block (which does `10 + dexMod + wisMod`). The shield +2 bonus is already applied **after** all base AC computations in the existing code, so a Barbarian with a shield would correctly get `10 + DEX + CON + 2`. No issue here.

One minor note: the `!hasArmor` guard should check all three armor types (Chain Mail, Scale Mail, Leather) to be robust, same as the Monk check. The Monk currently only checks `!hasLeatherArmor`, but the Barbarian template has no armor at all so there's no practical issue. The plan's `!hasArmor` phrasing is slightly ambiguous — it should be implemented as `!hasChainMail && !hasScaleMail && !hasLeatherArmor` (using the existing boolean variables) to be safe.

### 3. No Changes Needed to Hydration or Character Service — Confirmed

I've verified all three touchpoints:

- **`hydrateCharacter()`** (`creature-hydration.ts` L132): Reads `armorClass` from the sheet as a raw number — `readNumber(sheet, 'armorClass') ?? readNumber(sheet, 'ac') ?? 10`. No class-specific logic. No change needed.
- **`CharacterService`** (`character-service.ts`): Does not touch `armorClass` at all. It enriches the sheet with weapon/armor metadata but never overrides the AC number. No change needed.
- **`combatant-resolver.ts`**: Reads `armorClass` from sheet/statBlock for combat. No class-specific logic. No change needed.

The architecture is: AC is computed at sheet creation time → stored in `sheet.armorClass` → read verbatim by hydration and combat. Barbarian Unarmored Defense just needs to set the right value at creation time. This is the correct approach.

### 4. Follows Existing Patterns — Confirmed

The Monk Unarmored Defense precedent (lines 641-645 of `mocks/index.ts`) is:
```ts
if (className === "monk" && !hasLeatherArmor) {
  const dexMod = Math.floor(((template.abilityScores?.dexterity ?? 10) - 10) / 2);
  const wisMod = Math.floor(((template.abilityScores?.wisdom ?? 10) - 10) / 2);
  armorClass = 10 + dexMod + wisMod;
}
```

The Barbarian case will follow the exact same structure — class name check, no-armor guard, modifier computation from template ability scores, formula application. The domain helper `barbarianUnarmoredDefenseAC(dexMod, conMod)` in `barbarian.ts` is a nice addition that the ClassAbilities SME covers; the mock generator can either call that helper or inline the formula (both approaches work since it's a trivial computation).

## Suggested Changes

None — the plan is clean for EntityManagement. The only minor implementation note: ensure `!hasArmor` is implemented as the conjunction of all three armor-type booleans (`!hasChainMail && !hasScaleMail && !hasLeatherArmor`) rather than introducing a new variable, to stay consistent with the existing code pattern.
