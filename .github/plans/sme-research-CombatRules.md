# SME Research — CombatRules — BUG-H1, BUG-6, BUG-P1

## Scope
- Files read: `attack-handlers.ts` (~830 lines), `damage-resolver.ts` (~660 lines), `weapon-catalog.ts` (~340 lines), `equipped-items.ts`, `armor-catalog.ts`, `hit-rider-resolver.ts` (~300 lines), `tabletop-types.ts`
- Task: Research three combat rules bugs (range validation, versatile damage, damage display)

## Bug 1: BUG-H1 — Long-range attack rejected

### Current Code
**File**: `packages/game-server/src/application/services/combat/tabletop/dispatch/attack-handlers.ts`

**Range validation** (lines 500-504):
```typescript
if (inferredKind === "ranged") {
  const maxRange = longRange ?? normalRange ?? 600;
  if (dist > maxRange + 0.0001) {
    throw new ValidationError(`Target is out of range (${Math.round(dist)}ft > ${Math.round(maxRange)}ft)`);
  }
}
```

**Range population** (lines 476-499): Two paths populate `normalRange`/`longRange`:
1. **Thrown path** (line 477): `if (isThrownAttack && thrownNormalRange)` → sets both from `resolveThrownRange()`
2. **Non-thrown path** (line 480): parses `spec?.range ?? equippedWeapon?.range`

**`resolveThrownRange`** (lines 659–680) — **PRECISE ROOT CAUSE IS HERE**:
```typescript
private resolveThrownRange(weapon: any): { normalRange?: number; longRange?: number } {
  if (weapon.kind === "ranged" && weapon.range && typeof weapon.range === "string"
      && weapon.range.toLowerCase() !== "melee") {
    const parts = weapon.range.split("/").map(Number);
    const normalRange = parts.length >= 1 && !isNaN(parts[0]) ? parts[0] : undefined;
    const longRange   = parts.length >= 2 && !isNaN(parts[1]) ? parts[1] : undefined;
    return { normalRange, longRange };  // ← EARLY RETURN with longRange=undefined if range="20"
  }
  // catalog lookup is never reached for ranged weapons with partial range string
  const catalogRange = getWeaponThrownRange(weaponName, ...);
  ...
}
```

### Root Cause Analysis
Error message `"30ft > 20ft"` means `maxRange = longRange ?? normalRange = 20`. `longRange` is undefined.

**Exact failure path**: A character sheet stores the Handaxe attack as `kind: "ranged"` (common for thrown weapons) with `range: "20"` (only normal range as string — no "/60" segment). The early-return branch fires and returns `{ normalRange: 20, longRange: undefined }`. The catalog lookup that would return `[20, 60]` is completely bypassed. Then:
```typescript
const maxRange = longRange ?? normalRange ?? 600;  // = 20 (not 60)
if (30 > 20.0001) throw ValidationError("30ft > 20ft");  // ← BUG
```

**Why `enrichAttackProperties` doesn't save you**: It enriches `properties`, `mastery`, `versatileDamage` but **NOT** `range`. A weapon stored with `range: "20"` stays `range: "20"` after enrichment.

**Secondary rules gap**: Even with correct ranges, there is **no disadvantage flag** when `normalRange < dist <= longRange`. D&D 5e 2024: attacks beyond normal range use Disadvantage. Separate follow-up.

### Proposed Fix
In `resolveThrownRange` (lines 659-680): only early-return from the string branch if BOTH parts exist. Otherwise fall through to catalog:
```typescript
if (weapon.kind === "ranged" && weapon.range && typeof weapon.range === "string"
    && weapon.range.toLowerCase() !== "melee") {
  const parts = weapon.range.split("/").map(Number);
  const normalRange = parts.length >= 1 && !isNaN(parts[0]) ? parts[0] : undefined;
  const longRange   = parts.length >= 2 && !isNaN(parts[1]) ? parts[1] : undefined;
  if (normalRange !== undefined && longRange !== undefined) {
    return { normalRange, longRange };  // complete — safe to return
  }
  // Partial range string — fall through to catalog for authoritative long range
}
```

### Dependencies at Risk
- `resolveThrownRange` is a private method with 3 call sites in `attack-handlers.ts` only. Change is self-contained.
- The catalog lookup (`getWeaponThrownRange`) already handles Handaxe, Javelin, Spear, Trident correctly.

---

## Bug 2: BUG-6 — Longsword versatile always uses two-handed damage

### Current Code
**File**: `packages/game-server/src/application/services/combat/tabletop/dispatch/attack-handlers.ts`

**`resolveVersatileGrip`** (lines 723-766):
```typescript
// Default detection logic (lines 748-753):
const hasShield = !!(actorSheet?.equipment?.armor?.type === "shield"
  || (actorSheet?.equipment?.shield));
const attacks = (actorSheet?.attacks ?? actorSheet?.equipment?.weapons ?? []) as any[];
const hasSecondWeapon = attacks.filter((a: any) => a.kind === "melee").length >= 2;
hands = (hasShield || hasSecondWeapon) ? 1 : 2;  // ← DEFAULT IS TWO-HANDED
```

Then (lines 756-760):
```typescript
if (hands === 2 && versatileDamage?.diceSides) {
  effectiveDiceSides = versatileDamage.diceSides;  // Uses d10 for Longsword
}
```

### Root Cause
**Two issues**:

1. **Default is wrong per D&D 5e 2024**: The code defaults to `hands = 2` (two-handed) when it can't detect a shield or dual-wield. Per 5e 2024 rules: *"A Versatile weapon can be used with one or two hands."* — two-handed is the optional mode requiring explicit intent. Default should be one-handed.

2. **Shield detection checks completely wrong keys** (confirmed by reading source):
   - `actorSheet.equipment.armor.type === "shield"` — `armor.type` is always `"light"`, `"medium"`, or `"heavy"`. Shields are a separate entity from armor, never stored here. Always `false`.
   - `actorSheet.equipment.shield` — wrong nesting AND wrong key name.

   **The actual key is `actorSheet.equippedShield` (top-level on sheet)**, set by `recomputeArmorFromInventory` in `armor-catalog.ts`:
   ```typescript
   // armor-catalog.ts line 211
   equippedShield = { name: equippedShieldItem.name, armorClassBonus: shieldBonus };
   // stored as sheet.equippedShield — top-level, NOT sheet.equipment.shield
   ```
   Confirmed by `creature-hydration.ts` line 146: `const enrichedShield = sheet.equippedShield;`
   Also confirmed by `EquippedItems` interface in `equipped-items.ts`: `shield?: EquippedShield` (the field is `shield` in the typed interface but the sheet sets it under `equippedShield` at top level).

### Proposed Fix
**Two-part fix**:

1. **Fix shield detection** (line ~741): change the check to use the actual sheet field:
```typescript
const hasShield = !!(actorSheet?.equippedShield           // primary: top-level enriched field
  || actorSheet?.equipment?.shield                         // legacy fallback
  || actorSheet?.equipment?.armor?.type === "shield");     // legacy fallback
```

2. **Change default from `hands = 2` to `hands = 1`** per D&D 5e 2024 rules:
```typescript
// D&D 5e 2024: Versatile defaults to one-handed. Two-handed requires explicit intent.
hands = (hasShield || hasSecondWeapon) ? 1 : 1;  // default is 1h; only 2h if explicit text
```
Actually: just set `hands = 1` as the else-branch default regardless. Two-handed requires the player to type "two-handed" / "2h" explicitly.

The shield detection fix alone corrects the reported bug. The default change aligns rules for cases where shield detection might still miss.

### Dependencies at Risk
- **E2E scenarios** that expect two-handed damage for versatile weapons without explicit "two-handed" text will change to one-handed. These scenarios need updating.
- **AI attacks** using versatile weapons: AI text doesn't include "two-handed" → will now correctly default to one-handed.
- `divine-smite.json` scenario: Longsword damage would change from 1d10 to 1d8 (since no explicit two-handed text). The scenario setup may need `damage.diceSides: 8` or the test steps updated.

---

## Bug 3: BUG-P1 — Divine Smite damage arithmetic display

### Current Code
**File**: `packages/game-server/src/application/services/combat/tabletop/rolls/damage-resolver.ts`

**Enhancement damage processing** (lines 327-380):
```typescript
// Line 362: Enhancement bonus damage added to totalDamage
totalDamage += bonusDamage;

// Line 377-378: Enhancement result stored with summary string
enhancementResults.push({
  summary: `${enhancement.displayName}: ${bonusDamage} bonus damage!`,
});
```

**Message formatting** (lines 653-654, and ALL similar templates at lines 437, 600, 620):
```typescript
`${rollValue} + ${damageModifier}${effectBonusSuffix} = ${totalDamage} damage to ${targetName}!`
```

### Root Cause
The message equation `${rollValue} + ${damageModifier} = ${totalDamage}` only includes the base weapon damage components. Enhancement bonus damage (Divine Smite's 16 radiant) is added to `totalDamage` but NOT to the left side of the equation. The enhancement appears AFTER the equation as a suffix: `" Divine Smite: 16 bonus damage!"`.

Result: `6 + 3 = 25 damage ... Divine Smite: 16 bonus damage!`
Expected: `6 + 3 + 16[Divine Smite] = 25 damage ... Divine Smite: 16 bonus damage!`

### Proposed Fix
Track total enhancement bonus damage and include it in the equation:
```typescript
// After enhancement loop, compute total enhancement damage
const enhancementDamageTotal = enhancementResults.reduce(
  (sum, r) => sum + (r.bonusDamage ?? 0), 0
);
const enhDmgStr = enhancementDamageTotal > 0
  ? ` + ${enhancementDamageTotal}[smite]`
  : "";

// Update message templates (all 5 locations):
`${rollValue} + ${damageModifier}${effectBonusSuffix}${enhDmgStr} = ${totalDamage} damage to ${targetName}!`
```

This requires:
1. Adding `bonusDamage` to the `HitRiderEnhancementResult` type so enhancement results carry their numeric damage
2. Computing `enhancementDamageTotal` after the enhancement loop
3. Updating ALL 5 message template locations (lines ~437, ~478, ~600, ~620, ~653-654)

### Dependencies at Risk
- **HitRiderEnhancementResult type** needs a new optional `bonusDamage` field — check `tabletop-types.ts`
- **E2E scenarios** that assert on exact message text will need updating
- **CLI display** may parse the damage message — check if `player-cli/src/display.ts` does regex on the equation format
- Effect bonus suffix (`effectBonusSuffix` for Rage, Hex) is already included in the equation — enhancement damage needs the same treatment

---

## Risks
1. **BUG-H1**: Enrichment fix only affects new characters. Existing characters retain stale data. May need a migration or runtime catalog fallback.
2. **BUG-6**: Changing default to one-handed affects ALL versatile weapons for ALL characters. Must audit every versatile weapon scenario (Longsword, Battleaxe, Warhammer, Quarterstaff).
3. **BUG-P1**: 5 message template locations must ALL be updated consistently. Missing one creates inconsistent display.
4. **Cross-bug**: None of these changes affect domain pure functions — they're all in the application-layer tabletop dispatch/resolution code. No domain rule violations.

## Recommendations
1. **BUG-6 is the simplest fix**: Change default to `hands = 1`. Minimal code change, correct per rules. Fix first.
2. **BUG-P1 is medium complexity**: Add `bonusDamage` tracking and update 5 message templates. Straightforward but touches many lines.
3. **BUG-H1 requires deepest investigation**: The exact character sheet format causing the failure needs reproduction. Add `range` to `enrichAttackProperties` + add catalog fallback in range validation. Also add long-range disadvantage (already at line 892-895).
