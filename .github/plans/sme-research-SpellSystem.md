# SME Research — SpellSystem — Shield of Faith Action Economy + Slot Bugs

## Scope
- Files read: `combat-text-parser.ts`, `spell-action-handler.ts`, `spell-slot-manager.ts`, `buff-debuff-spell-delivery-handler.ts`, `healing-spell-delivery-handler.ts`, `zone-spell-delivery-handler.ts`, `save-spell-delivery-handler.ts`, `action-service.ts`, `active-actor-resolver.ts`, `resource-utils.ts`, `level-1.ts`, `action-dispatcher.ts`, `spell-delivery-handler.ts`
- Task: Trace Shield of Faith casting path to find why action (not bonus) is consumed and slot is not spent

## Shared Root Cause — Parser Captures Too Much

`tryParseCastSpellText` in `combat-text-parser.ts:437`:
```ts
const match = normalized.match(/\bcast\s+(.+?)(?:\s+at\s+level\s+(\d+))?(?:\s+(?:at|on)\s+(.+))?\s*$/i);
```
Input: `"I cast shield of faith as a bonus action"` → **spellName = `"shield of faith as a bonus action"`**

The non-greedy `(.+?)` still must consume everything up to `$` because `"as a bonus action"` doesn't match the optional groups (`at level N` or `at/on <target>`). The extraneous text becomes part of the spell name.

This causes `resolveSpell("shield of faith as a bonus action", sheet)` → **`null`** (no catalog match).

### Cascade from null spellMatch (`spell-action-handler.ts:119-122`):
```ts
const spellMatch = resolveSpell(castInfo.spellName, sheet);
const spellLevel = spellMatch?.level ?? 0;          // → 0 (treated as cantrip!)
const isBonusAction = spellMatch?.isBonusAction ?? false;  // → false
```
- `spellLevel = 0` → the `if (spellLevel > 0)` guard at line ~288 SKIPS `prepareSpellCast()` entirely → **no slot consumed (Bug 2)**
- `isBonusAction = false` → falls through to generic path → **action consumed instead of bonus (Bug 1)**
- No delivery handler matches → generic fallback at line ~420 calls `castSpell()` without `skipActionCheck` → sets `actionSpent: true`

## Bug 1: Action Economy — Secondary Issue (persists even after parser fix)

### Affected: ALL delivery handlers except HealingSpellDeliveryHandler

**HealingSpellDeliveryHandler** (correct, line 155-160):
```ts
const isBonusAction = spellMatch.isBonusAction ?? false;
await deps.actions.castSpell(sessionId, {
  encounterId: encounter.id, actor,
  spellName: castInfo.spellName,
  skipActionCheck: isBonusAction,   // ← CORRECT
});
// Also patches bonusActionUsed: true on resources
```

**BuffDebuffSpellDeliveryHandler** (broken, line 181-184):
```ts
await deps.actions.castSpell(sessionId, {
  encounterId, actor,
  spellName: castInfo.spellName,
  // skipActionCheck: MISSING → always sets actionSpent: true
});
```

**ZoneSpellDeliveryHandler** (broken, line 155-158), **SaveSpellDeliveryHandler** (broken, lines 134, 342, 476): Same pattern — no `skipActionCheck`.

**SpellActionHandler** itself (broken, 3 call sites):
- Counterspell reaction path, line ~248
- Auto-hit path (Magic Missile), line ~400
- Fallback path, line ~420

### How `performSimpleAction` decides (`action-service.ts:118-124`):
```ts
if (input.skipActionCheck) {
  updatedResources = { ...actorResources, bonusActionUsed: true };
} else {
  updatedResources = { ...actorResources, actionSpent: true };  // ← Bug hits here
}
```

## Bug 2: Spell Slot — Entirely Caused by Parser

When `spellLevel` defaults to 0 (parser → null match), slot spending is unconditionally skipped:
```ts
if (spellLevel > 0) {   // FALSE when spellLevel = 0
  await prepareSpellCast(...);  // NEVER REACHED
}
```
`prepareSpellCast` itself is correct — `spendResourceFromPool` properly decrements `spellSlot_1.current`. The function just never gets called.

## Impact Analysis

| File | Change Required | Risk | Why |
|------|----------------|------|-----|
| `combat-text-parser.ts:437` | Fix regex to strip "as a bonus action" | **Med** | Core parser used by all spell text; must not break existing patterns |
| `buff-debuff-spell-delivery-handler.ts:181` | Add `skipActionCheck: isBonusAction` | **Low** | Direct fix, mirrors healing handler pattern |
| `zone-spell-delivery-handler.ts:155` | Add `skipActionCheck` | **Low** | Same pattern |
| `save-spell-delivery-handler.ts:134,342,476` | Add `skipActionCheck` (3 sites) | **Low** | Same pattern |
| `spell-action-handler.ts:248,400,420` | Add `skipActionCheck` (3 sites) | **Low** | Same pattern |
| `spell-delivery-handler.ts:21` | Consider adding `isBonusAction` to context | **Low** | Cleaner than re-reading from spellMatch |

## Proposed Fixes

### Fix 1: Parser regex (`combat-text-parser.ts:437`)
Add a non-capturing group to strip bonus/action qualifiers before the spell name capture ends:
```ts
const cleaned = normalized.replace(/\s+as\s+(?:a\s+|my\s+)?bonus\s+action\b/i, "")
                           .replace(/\s+using\s+(?:a\s+|my\s+)?bonus\s+action\b/i, "");
const match = cleaned.match(/\bcast\s+(.+?)(?:\s+at\s+level\s+(\d+))?(?:\s+(?:at|on)\s+(.+))?\s*$/i);
```

### Fix 2: Action economy in delivery handlers + SpellActionHandler
In every `castSpell()` call site, pass `skipActionCheck: isBonusAction`. Derive `isBonusAction` from `ctx.spellMatch.isBonusAction ?? false`. Also patch `bonusActionUsed: true` on resources (like the healing handler does).

## Risks
1. **Parser over-stripping**: The cleanup regex could accidentally match legitimate spell names containing "bonus" or "action". Mitigation: the patterns are specific ("as a bonus action", "using my bonus action") and no D&D spell name contains these phrases.
2. **Double action marking**: After fixing the parser, the `SpellActionHandler` calls `castSpell` AND the delivery handler calls `castSpell` separately. Need to verify only ONE call happens per cast (the handler returns before the fallback). Currently, for buff spells: handler IS the terminal call (returns the result). The handler's `castSpell` is the only one that runs. ✓
3. **Missing bonusActionUsed patch**: `skipActionCheck: true` in `performSimpleAction` already sets `bonusActionUsed: true` (line 120). So just passing `skipActionCheck: isBonusAction` is sufficient for most handlers. The healing handler's extra `bonusActionUsed` patch is redundant but harmless.

## Catalog Confirmation
Shield of Faith in `domain/entities/spells/catalog/level-1.ts:339`:
```ts
castingTime: 'bonus_action',
isBonusAction: true,
concentration: true,
level: 1,
effects: [{ type: 'bonus', target: 'armor_class', value: 2, duration: 'concentration', appliesTo: 'self' }]
```
Catalog is correct. `BuffDebuffSpellDeliveryHandler.canHandle()` returns true (effects.length > 0). The handler WILL match once the parser returns the correct spell name.
