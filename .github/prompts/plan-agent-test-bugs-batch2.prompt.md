# Bug Fix Plan — Agent Player Test Bugs Batch 2
Date: 2026-04-19
Source: Agent player test runs H (wounded-fighter), I (solo-paladin)
Status: ACTIVE

## Overview

Six deterministic bugs identified from agent player test runs. All have been researched by SME agents. Fixes are grouped into 4 implementation tracks that can be parallelized.

---

## Track A — Dead Combatant Pathfinding (AIBehavior-Implementer)
**Root cause**: Dead combatants (hpCurrent ≤ 0) are included in `occupiedPositions` arrays, causing live combatants to be blocked from reaching their targets. Per D&D 5e, dead creatures are objects and do not block movement.

### Files to change

#### 1. `packages/game-server/src/application/services/combat/ai/handlers/move-toward-handler.ts` ~line 149
```typescript
// CURRENT
const occupiedPositions = allCombatants
  .filter((c) => c.id !== aiCombatant.id && c.id !== targetCombatant.id)
  .map(...)

// FIX — add hpCurrent > 0 filter
const occupiedPositions = allCombatants
  .filter((c) => c.id !== aiCombatant.id && c.id !== targetCombatant.id && c.hpCurrent > 0)
  .map(...)
```

#### 2. `packages/game-server/src/application/services/combat/ai/handlers/move-away-from-handler.ts` ~line 122
```typescript
// CURRENT
const occupiedPositions = allCombatants
  .filter((c) => c.id !== aiCombatant.id)
  .map(...)

// FIX
const occupiedPositions = allCombatants
  .filter((c) => c.id !== aiCombatant.id && c.hpCurrent > 0)
  .map(...)
```

## Track B — Combat Victory + AI Loop Concurrency (AIBehavior-Implementer)
**Root cause**: `processAllMonsterTurns` in `ai-turn-orchestrator.ts` is called as fire-and-forget from multiple locations. Concurrent instances can race — one detects victory but another instance already-read the encounter as Active and continues processing, causing combat to loop indefinitely and auto-resolve player turns.

### Files to change

#### `packages/game-server/src/application/services/combat/ai/ai-turn-orchestrator.ts`
1. Add a per-encounter in-flight guard (`Set<string>` of encounterIds) at class level
2. At start of `processAllMonsterTurns`: skip if encounter already in-flight, add to set
3. In the processing loop: re-check `encounter.status !== "Active"` after EACH `processMonsterTurnIfNeeded` call and break early
4. Always remove from in-flight set in `finally` block

### Victory check defense-in-depth
Also add a victory check after damage kills the last monster in `damage-resolver.ts` by checking if all enemies are at 0 HP and emitting a CombatEnded event. Coordinate with CombatOrchestration-Implementer if needed.

---

## Track C — Attack Range + Versatile Weapon (CombatRules-Implementer)
### BUG-H1: Long-range attacks rejected

**File**: `packages/game-server/src/application/services/combat/tabletop/dispatch/attack-handlers.ts`

Root cause: `enrichAttackProperties` in `weapon-catalog.ts` doesn't populate `range` from the catalog. When the thrown weapon detection path fails (flat-array character sheets), `longRange` stays `undefined`, so the max range check uses only `normalRange`.

Fix options (both should be applied):
1. **Weapon catalog enrichment**: In `enrichAttackProperties`, add `range` data (normalRange, longRange) from the catalog entry when available
2. **Runtime catalog fallback in range validation**: Before the maxRange check, if `longRange` is undefined and weapon name is known, look up the catalog. This covers existing characters.
3. **Apply disadvantage at long range**: When `dist > normalRange && dist <= longRange`, set `disadvantageReasons.push("long_range")` — per 5e 2024 rules

### BUG-6: Versatile weapon always two-handed

**File**: `packages/game-server/src/application/services/combat/tabletop/dispatch/attack-handlers.ts`  
**Function**: `resolveVersatileGrip` ~line 748

```typescript
// CURRENT — defaults to two-handed (WRONG)
hands = (hasShield || hasSecondWeapon) ? 1 : 2;

// FIX — defaults to one-handed per 5e 2024
hands = (explicitTwoHanded) ? 2 : 1;
```

The `hasShield` and `hasSecondWeapon` checks can be removed as they become redundant. The only way to get `hands = 2` should be explicit text: "two-handed", "with two hands", "grip with both hands", etc.

**Note**: Update any existing E2E scenario assertions that expect `1d10` versatile damage without explicit two-handed text.

---

## Track D — Shield of Faith Spell Parsing + Action Economy (SpellSystem-Implementer)

### Shared root cause
`tryParseCastSpellText` in `combat-text-parser.ts` line ~437 captures "shield of faith **as a bonus action**" as the spell name. The catalog lookup fails → `spellMatch = null` → `spellLevel = 0` (skips slot spending) and `isBonusAction = false` (consumes action instead of bonus action).

### BUG-P2/P3 Fix 1: Parser regex (`combat-text-parser.ts` ~line 437)
Strip bonus-action qualifiers from the spell name before matching:
```typescript
const cleaned = normalized
  .replace(/\s+as\s+(?:a\s+|my\s+)?bonus\s+action\b/i, "")
  .replace(/\s+using\s+(?:a\s+|my\s+)?bonus\s+action\b/i, "");
const match = cleaned.match(/\bcast\s+(.+?)(?:\s+at\s+level\s+(\d+))?(?:\s+(?:at|on)\s+(.+))?\s*$/i);
```
Also set `isBonusActionFromText = true` when the stripped phrase was present, so downstream code can use it as a fallback if `spellMatch?.isBonusAction` is also false.

### BUG-P2 Fix 2: Action economy in delivery handlers
Add `skipActionCheck: isBonusAction` to all `castSpell()` call sites that are missing it.
Also add `bonusActionUsed: true` patch to resources when `isBonusAction` is true.

Affected files (pattern: mirror `HealingSpellDeliveryHandler` which is correct):
- `buff-debuff-spell-delivery-handler.ts` line ~181
- `zone-spell-delivery-handler.ts` line ~155  
- `save-spell-delivery-handler.ts` lines ~134, ~342, ~476
- `spell-action-handler.ts` lines ~248, ~400, ~420

---

## Track E — Damage Display Equation (CombatOrchestration-Implementer)

### BUG-P1: Divine Smite damage not shown in equation
**File**: `packages/game-server/src/application/services/combat/tabletop/rolls/damage-resolver.ts` ~lines 650-655

The damage message formats `rollValue + modifier = totalDamage` but `totalDamage` includes enhancement damage (Divine Smite bonus) that isn't shown in the equation.

Fix: Track the total enhancement bonus separately and include it in the equation string:
```typescript
// CURRENT
`${rollValue} + ${damageModifier} = ${totalDamage} damage to ${targetName}!`

// FIX (when enhancementBonus > 0)
`${rollValue} + ${damageModifier} + ${enhancementBonus} = ${totalDamage} damage to ${targetName}!`
```

Also fix the 4 other message template variants in the same function.

### Dead combatant pathfinding — player-side + path preview
Also add `hpCurrent > 0` filter in:
- `packages/game-server/src/application/services/combat/tabletop/dispatch/movement-handlers.ts` ~line 291
- `packages/game-server/src/infrastructure/api/routes/sessions/session-tactical.ts` ~line 213

---

## E2E Test Coverage

After all fixes land, add E2E scenario tests for:

1. **Dead-blocking path** — scenario where player kills 2 of 3 enemies, 3rd enemy must path through dead body positions to reach player. Assert AI reaches player and attacks.

2. **Long-range attack** — scenario where player throws ranged weapon at target between normalRange and longRange. Assert hit (with disadvantage), not 400 error.

3. **Versatile one-handed** — scenario with longsword attack and no "two-handed" text. Assert `1d8` damage, not `1d10`.

4. **Bonus action spell + attack** — scenario where player casts bonus-action spell then attacks. Assert action economy allows attack after bonus spell.

5. **Combat victory** — scenario where all enemies die in same round. Assert `combatEnded` event fires and no additional turns process.

---

## Testing after each fix
Run: `pnpm -C packages/game-server test:e2e:combat:mock -- --all`
Run: `pnpm -C packages/game-server typecheck`
