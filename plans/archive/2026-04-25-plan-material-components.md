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

**Problem**: Catalog entries declare `m: "string"` (e.g. "300gp diamond, consumed") but no validation at cast time. Casters trivially cast Revivify with no diamond.

## Design

### Schema

```ts
type MaterialComponent = string | StructuredMaterialComponent;

interface StructuredMaterialComponent {
  description: string;         // human-readable
  itemId?: string;             // "diamond" — inventory lookup
  costGp?: number;             // 300
  consumed?: boolean;          // true = spell eats the item
  componentPouchSatisfies?: boolean; // default true if no costGp
}
```

Migration: existing strings → `{ description, componentPouchSatisfies: true }`. Costed/consumed entries rewritten as structured.

### Phases

1. **Schema** — update `CanonicalSpell` to accept union. Add `parseMaterialComponent()` that parses "worth N GP" + "consumed" patterns for backward compat.

2. **Enforcement** — in `SpellActionHandler.handle()` BEFORE slot consume:
   ```ts
   const material = parseMaterialComponent(spell.components?.m);
   if (material?.costGp > 0) {
     const check = await inventoryService.findItemMatchingComponent(actorId, material);
     if (!check.found) return error("Missing: " + material.description);
     if (material.consumed) await inventoryService.consumeItem(actorId, check.itemInstanceId);
   }
   ```

3. **Structured data** for priority spells:
   - Revivify (L3): diamond, 300gp, consumed
   - Chromatic Orb (L1): diamond, 50gp, NOT consumed
   - Find Familiar (L1 ritual): brazier+herbs, 10gp, consumed
   - Continual Flame (L2): ruby dust, 50gp, consumed
   - Raise Dead (L5): diamond, 500gp, consumed
   - Identify (L1 ritual): pearl, 100gp, NOT consumed

### Inventory matching
`findItemMatchingComponent(charId, component)`: if `itemId` set → find by base ID + value ≥ costGp; else fuzzy match name against description keyword (e.g. "diamond").

## Files

| File | Change |
|---|---|
| `domain/entities/spells/catalog/types.ts` | MaterialComponent union |
| `domain/entities/spells/catalog/material-component.ts` (NEW) | Parser |
| Catalog files (level-1.ts, level-3.ts, etc.) | Convert costed/consumed entries |
| `tabletop/spell-action-handler.ts` | Material check before slot consume |
| `application/services/entities/inventory-service.ts` | `findItemMatchingComponent` + `consumeItem` |

## Tests
- Unit: parser; inventory matcher; cost validation rejects insufficient
- E2E: Revivify with no diamond → error; with diamond → consumed + target revived; Chromatic Orb with diamond → succeeds, diamond intact

## Risks
- Backward compat: Bless etc. with pouch → string→structured fallback uses `componentPouchSatisfies: true`. Safe.
- Fuzzy match may miss edge cases at MVP → acceptable, tighten later

## Scope
~1 day. 4 files. ~150 LOC + 6 catalog entry conversions.

## Unblocks
Authentic Revivify gameplay, audit gap closed.
