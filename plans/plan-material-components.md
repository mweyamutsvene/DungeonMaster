---
type: plan
flow: SpellSystem,InventorySystem,SpellCatalog
feature: material-component-enforcement
author: claude-orchestrator
status: DRAFT
created: 2026-04-24
updated: 2026-04-24
---

# Plan: Material Component Enforcement

## Why this matters

Several core 2024 spells require material components with specific GP cost, sometimes consumed:
- Revivify — 300gp diamond, **consumed**
- Raise Dead — 500gp diamond, consumed
- Chromatic Orb — 50gp diamond
- Find Familiar — 10gp brazier with charcoal/incense/herbs (consumed)
- Continual Flame — 50gp ruby dust (consumed)

Without enforcement, casters trivially cast these spells without paying the cost. Audit confirms: catalog entries declare `m: "string"` but no validation occurs at cast time.

## Current state

- Catalog format: `components: { v: true, s: true, m: 'a diamond worth 300+ GP, consumed' }`
- Component string is descriptive only; no machine-readable cost or consumed flag.
- `SpellActionHandler.handle()` checks `cannotSpeak` for verbal but does nothing for material.

## Proposed design

### Schema change — structured material data

Replace the descriptive string with a structured object:

```ts
type MaterialComponent = string | StructuredMaterialComponent;

interface StructuredMaterialComponent {
  description: string;       // "a diamond worth 300+ GP, consumed"
  itemId?: string;            // "diamond" — looked up in inventory
  costGp?: number;            // 300
  consumed?: boolean;         // true → spell consumes the item on cast
  /** Allow a component pouch / arcane focus to satisfy this if cost is undefined */
  componentPouchSatisfies?: boolean;  // default true if costGp is undefined
}
```

Migration: existing string values map to `{ description: <string>, componentPouchSatisfies: true }`. Costed/consumed components must be re-declared with structured form.

### Phase 1 — schema

Update `CanonicalSpell` type to accept either form. Add an extractor `parseMaterialComponent()` that converts strings → structured form, parsing common patterns ("worth N GP", "consumed", etc.) for backward compatibility. New entries should use structured form directly.

### Phase 2 — enforcement

Add a check in `SpellActionHandler.handle()` BEFORE slot consumption:

```ts
const material = parseMaterialComponent(spellMatch.components?.m);
if (material?.costGp && material.costGp > 0) {
  const inventoryCheck = await inventoryService.findItemMatchingComponent(
    actorId, material
  );
  if (!inventoryCheck.found) {
    return error("Missing material component: " + material.description);
  }
  if (material.consumed) {
    await inventoryService.consumeItem(actorId, inventoryCheck.itemInstanceId);
  }
}
```

### Phase 3 — initial structured data for high-value spells

Convert these spells to structured material components:
- Revivify (L3): diamond, 300gp, consumed
- Chromatic Orb (L1): diamond, 50gp, NOT consumed
- Find Familiar (L1, ritual): brazier+charcoal etc., 10gp, consumed
- Continual Flame (L2): ruby dust, 50gp, consumed
- Raise Dead (L5): diamond, 500gp, consumed
- Identify (L1, ritual): pearl, 100gp, NOT consumed

### Inventory matching

`InventoryService.findItemMatchingComponent(characterId, component)`:
- If `itemId` set, find item with that base ID + value ≥ `costGp`
- Else fuzzy-match item name against `description` (e.g., contains "diamond")
- Return first match with sufficient value

For an MVP, match by item name keyword. Refine later.

## Touched files

| File | Change |
|---|---|
| `domain/entities/spells/catalog/types.ts` | Allow MaterialComponent union |
| `domain/entities/spells/catalog/material-component.ts` (NEW) | Parser for "worth N GP, consumed" strings |
| Catalog files (`level-1.ts`, `level-3.ts`, etc.) | Convert costed/consumed entries to structured form |
| `application/services/combat/tabletop/spell-action-handler.ts` | Add material check before slot consume |
| `application/services/entities/inventory-service.ts` | Add `findItemMatchingComponent` + consume |

## Test strategy

- Unit: parser converts string forms; inventory matcher finds items; cost validation rejects insufficient.
- E2E: cast Revivify with no diamond → error; with diamond → diamond consumed, target revived; cast Chromatic Orb with cheap diamond → cast succeeds, diamond not consumed.

## Risks

- Existing scenarios use spells with material components (Bless, etc.) where pouch satisfies — backward-compat must keep these working. The string→structured fallback uses `componentPouchSatisfies: true`.
- Inventory matching is fuzzy at MVP — might miss-match similarly-named items. Acceptable for L1-5; tighten later.

## Estimated scope

~1 day. 4 files. ~150 LOC + 5–10 catalog entry conversions.

## Unblocks

- Authentic Revivify gameplay (the diamond cost is a meaningful adventure constraint)
- Audit gap closed
