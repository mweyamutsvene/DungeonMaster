# SME Research — EntityManagement — Barbarian Unarmored Defense

## 1. How Character AC Is Currently Computed and Stored

There are **two distinct AC paths** in the system. Understanding both is critical for Unarmored Defense:

### Path A: Domain Entity `getAC()` (Creature → Character)

The base `Creature` class ([creature.ts](packages/game-server/src/domain/entities/creatures/creature.ts#L100-L121)) has a `getAC()` method that:
- If no `equipment.armor` and no `equipment.shield` → returns the raw `this.armorClass` value from `CreatureData`
- If equipment is present → computes `base + capped DEX mod` from the `EquippedArmorClassFormula`, plus shield bonus if trained

The `Character` class ([character.ts](packages/game-server/src/domain/entities/creatures/character.ts#L209-L213)) overrides `getAC()` to add feat bonuses (Defense feat → +1 while armored).

**Problem**: The domain `Character.getAC()` is **NOT called in the tabletop combat flow** for AC resolution. It only matters for domain-level unit tests.

### Path B: Sheet-based AC Lookup (the one that matters for combat)

The combat flow reads AC directly from the persisted JSON sheet/statBlock, NOT from the domain entity:

| Location | How AC is read |
|----------|---------------|
| `roll-state-machine.ts` L1047 | `(target as any).statBlock?.armorClass \|\| (target as any).sheet?.armorClass \|\| 10` |
| `roll-state-machine.ts` L2431-2432 | Same pattern for secondary targets |
| `tabletop-combat-service.ts` L423-424 | `target.resources?.armorClass` |
| `two-phase-action-service.ts` L1230-1232 | `targetStats.armorClass` or `targetResources.armorClass` |
| `ai-action-executor.ts` L489-491 | Same dual-source pattern |

**This means the `armorClass` value stored in the sheet JSON at character creation time IS the AC used in combat**. The domain `getAC()` is not consulted.

### Path C: Creature Hydration (DB → Domain Entity)

`hydrateCharacter()` in [creature-hydration.ts](packages/game-server/src/application/services/combat/helpers/creature-hydration.ts#L126-L131) reads `armorClass` from the sheet:
```ts
const armorClass = readNumber(sheet, 'armorClass') ?? readNumber(sheet, 'ac') ?? 10;
```
It passes this raw number into `CharacterData.armorClass`. Notably, **equipment data is NOT passed** to the `Character` constructor during hydration — the `equipment` field on `CharacterData` is never set by `hydrateCharacter()`. This means even the domain `getAC()` would just return the raw `armorClass` number for hydrated characters.

## 2. Where AC Gets Set at Creation Time

### Mock Character Generator (test/dev path)
`MockCharacterGenerator.generateCharacter()` in [mocks/index.ts](packages/game-server/src/infrastructure/llm/mocks/index.ts#L631-L653):
- Starts with `10 + DEX mod` (base unarmored)
- Checks for Chain Mail → flat 16
- Checks for Scale Mail → 14 + min(2, DEX mod)
- Checks for Leather → 11 + DEX mod
- **Monk-specific**: If monk and no leather → `10 + DEX mod + WIS mod`
- Shield adds +2
- **No barbarian-specific logic exists here**

**There is currently NO barbarian template** in the mock character generator's `classTemplates` map. If "barbarian" is requested, it falls back to the fighter template (Chain Mail + Shield → AC 18), which is wrong for a typical barbarian.

### LLM Character Generator (production path)
[character-generator.ts](packages/game-server/src/infrastructure/llm/character-generator.ts) — the LLM generates `armorClass` as a number in its JSON output. The LLM prompt schema asks for `"armorClass": number`. No post-processing ensures correctness.

### CharacterService.addCharacter() (API path)
[character-service.ts](packages/game-server/src/application/services/entities/character-service.ts#L48-L50) takes the sheet as-is, enriches it with `enrichSheetArmor(enrichSheetAttacks(...))` — but this enrichment:
- Adds `equippedArmor` metadata (AC formula) from the armor catalog
- Does NOT recompute `armorClass` on the sheet
- The AC number that came in on `sheet.armorClass` is preserved unchanged

### Test Scenarios (E2E path)
Scenario JSON files hardcode `armorClass` directly. The existing barbarian scenarios ([rage.json](packages/game-server/scripts/test-harness/scenarios/barbarian/rage.json#L23)) set `armorClass: 15` — which happens to match 10 + DEX(14→+2) + CON(16→+3) = 15 (Unarmored Defense), but this is a coincidence of manual authoring rather than computed.

## 3. How Creature Hydration Populates AC for Combat

`hydrateCharacter()` reads `sheet.armorClass` as a raw number and passes it through to `CharacterData.armorClass`. No class-specific logic is applied. No equipment is parsed. The domain entity gets a plain number.

For monsters: `hydrateMonster()` reads `statBlock.armorClass` — same pattern, raw number.

The hydration layer is **intentionally thin** — it does not recompute derived values. It trusts that the sheet already has the correct AC.

## 4. Where Unarmored Defense AC Override Should Be Applied

### Recommendation: Compute at creation time (same as Monk pattern)

Given the dual-path AC architecture, **Unarmored Defense must be computed at creation time** and stored in the sheet's `armorClass` field. The combat flow reads this field directly and never calls domain `getAC()`.

The existing Monk Unarmored Defense works this way — the mock generator computes `10 + DEX + WIS` and stores it as `armorClass`.

**Specific touchpoints for Barbarian Unarmored Defense:**

| Touchpoint | What to do | Priority |
|-----------|-----------|----------|
| **`barbarian.ts` (domain)** | Export `barbarianUnarmoredDefenseAC(dexMod, conMod): number` helper → `10 + dexMod + conMod`. This keeps the calculation in the domain layer per the domain-first principle. | HIGH |
| **Mock generator (`mocks/index.ts`)** | (a) Add a barbarian template with typical stats (STR 16, DEX 14, CON 16) and NO armor equipment. (b) Add Barbarian Unarmored Defense case: `if (className === "barbarian" && !hasArmor) armorClass = 10 + dexMod + conMod`. | HIGH |
| **`enrichSheetArmor()` in `armor-catalog.ts`** | No change needed — it only enriches, never overrides AC. | — |
| **`CharacterService.addCharacter()`** | Consider adding Unarmored Defense AC recomputation here as a safety net: if class is barbarian, no armor in equipment, and provided AC < computed unarmored AC, override it. But this is **optional** — the sheet should arrive with correct AC. | LOW |
| **`hydrateCharacter()` in `creature-hydration.ts`** | No change needed — it correctly reads whatever `armorClass` is on the sheet. | — |
| **Domain `Character.getAC()` / `Creature.getAC()`** | Consider adding Unarmored Defense logic for correctness (future-proofing), but **not strictly needed** since combat doesn't call this. | LOW |
| **Test scenarios** | Any new barbarian scenario should set `armorClass` to the Unarmored Defense value when no armor is equipped. Existing scenarios already have correct values. | MEDIUM |

## 5. Whether AC Needs to Change at Creation Time, Combat Init Time, or Both

**Creation time only** — for the same reason Monk Unarmored Defense works today:

- The combat flow reads `sheet.armorClass` or `statBlock.armorClass` as a raw number
- Hydration doesn't recompute AC
- The domain `getAC()` is not used in combat resolution
- Initiative/combat start does not recompute stored AC values

If AC were to change dynamically (e.g., donning/doffing armor mid-combat), that would require a more fundamental architectural change. But Unarmored Defense is a **static AC calculation** — it applies at the time the character is built.

**Shield interaction**: Per D&D 5e 2024, Barbarian Unarmored Defense allows shields. If a barbarian has a shield, their AC is `10 + DEX + CON + 2`. The mock generator already adds +2 for shields after computing base AC, so this is naturally handled.

## 6. Concerns and Risks

| # | Risk | Severity | Mitigation |
|---|------|----------|-----------|
| 1 | **LLM character generator may produce wrong AC for barbarians** — the LLM doesn't know about Unarmored Defense and may just output `10 + DEX mod` or guess a value | Medium | Post-process LLM output to apply Unarmored Defense formula. Or, add explicit instructions to the LLM prompt about Barbarian AC. |
| 2 | **No validation on `CharacterService.addCharacter()`** — the service trusts whatever `armorClass` is on the incoming sheet | Low | Could add a class-aware AC validation/fixup step in the service. Not critical if all callers (mock gen, LLM gen, tests) are correct. |
| 3 | **Dual-path AC is fragile** — the domain `Character.getAC()` and the sheet-based AC can diverge. If someone later routes combat through domain `getAC()`, the answer may differ from what's in the sheet. | Medium | Document this clearly. Long-term: unify AC resolution to always go through domain entity. |
| 4 | **`hydrateCharacter()` doesn't pass `equipment` to domain entity** — the `Character` constructor never gets `EquippedItems`, so domain `getAC()` always returns the raw `armorClass` number. This masks bugs where domain `getAC()` would behave differently if equipment were provided. | Low | Not blocking for Unarmored Defense, but worth noting for future armor-related features. |
| 5 | **No existing barbarian template in mock generator** — requesting a barbarian character from `MockCharacterGenerator` falls through to fighter template, getting Chain Mail + Shield (AC 18). This is wrong. | High | Must add a barbarian template with no armor, appropriate stats, and Unarmored Defense AC. |
| 6 | **Multiclass Unarmored Defense stacking** — D&D 5e rules say you can only benefit from one AC calculation at a time. A Barbarian/Monk can't stack both. Current system doesn't support multiclass, so not an immediate concern. | None (future) | Skip for now. |

## Summary

The key insight is that **AC is a sheet-level value, not a dynamically computed value in combat**. Barbarian Unarmored Defense is an AC *calculation formula* that should be applied when the character sheet is authored (mock generator, LLM generator, or test scenario JSON). The correct value (`10 + DEX mod + CON mod`, optionally +2 for shield) must be written to `sheet.armorClass` at that time. No changes are needed to combat hydration, roll resolution, or the tabletop combat service.

The minimum implementation for EntityManagement:
1. Add `barbarianUnarmoredDefenseAC()` helper in `barbarian.ts` (domain)
2. Add barbarian template to `MockCharacterGenerator` with correct Unarmored Defense AC
3. Add barbarian Unarmored Defense case in mock generator's AC computation (parallel to existing monk case)
