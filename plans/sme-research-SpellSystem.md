# SME Research — SpellSystem — `creates_item` spell effect primitive

## Scope
- Files read:
  - [prepared-spell-definition.ts](packages/game-server/src/domain/entities/spells/prepared-spell-definition.ts) (~200 lines)
  - [effects.ts](packages/game-server/src/domain/entities/combat/effects.ts) — `EffectType` union L17-34
  - [spell-action-handler.ts](packages/game-server/src/application/services/combat/tabletop/spell-action-handler.ts) (~410 lines)
  - [spell-delivery-handler.ts](packages/game-server/src/application/services/combat/tabletop/spell-delivery/spell-delivery-handler.ts) (interface + context)
  - All 5 delivery handlers under [spell-delivery/](packages/game-server/src/application/services/combat/tabletop/spell-delivery)
  - [spell-slot-manager.ts](packages/game-server/src/application/services/combat/helpers/spell-slot-manager.ts)
  - [tabletop-types.ts](packages/game-server/src/application/services/combat/tabletop/tabletop-types.ts) L490-525 (deps contract)
  - [interaction-handlers.ts](packages/game-server/src/application/services/combat/tabletop/dispatch/interaction-handlers.ts) L200-260 (sheet-write precedent)
  - [inventory.ts](packages/game-server/src/domain/entities/items/inventory.ts), [magic-item.ts](packages/game-server/src/domain/entities/items/magic-item.ts) L270-310
  - [types.ts](packages/game-server/src/domain/entities/spells/catalog/types.ts) L26 (`castingTime`)
- Task context: add a `creates_item` spell primitive for Goodberry-class spells that mutate caster inventory at cast time.

## Current State

### 1. `SpellEffectDeclaration.type` IS `EffectType` — the combat-only union
`SpellEffectDeclaration.type` aliases `EffectType` directly ([prepared-spell-definition.ts L33](packages/game-server/src/domain/entities/spells/prepared-spell-definition.ts#L33) → [effects.ts L17-34](packages/game-server/src/domain/entities/combat/effects.ts#L17)):

```
advantage | disadvantage | bonus | penalty | resistance | vulnerability | immunity
| temp_hp | speed_modifier | speed_multiplier | ongoing_damage | retaliatory_damage
| condition_immunity | recurring_temp_hp | prevent_healing | custom
```

Every value is a **runtime combat effect** that the buff/debuff delivery handler feeds to `createEffect()` + `addActiveEffectsToResources()`. **No existing `type` value writes to character state outside the encounter-scoped combatant resources.** Adding `creates_item` to this union puts a non-ActiveEffect primitive into a type that ~every consumer passes to `createEffect()`.

### 2. Which of the 5 delivery handlers would claim it?
Dispatch order in `SpellActionHandler` ctor ([spell-action-handler.ts L71-79](packages/game-server/src/application/services/combat/tabletop/spell-action-handler.ts#L71)):

| # | Handler | `canHandle` predicate |
|---|---------|-----------------------|
| 1 | `SpellAttackDeliveryHandler` | `spell.attackType` set |
| 2 | `HealingSpellDeliveryHandler` | `spell.healing && diceRoller` |
| 3 | `SaveSpellDeliveryHandler` | `spell.saveAbility` + damage OR failure conditions (defers to #5 if only `effects[]`) |
| 4 | `ZoneSpellDeliveryHandler` | `spell.zone` set |
| 5 | `BuffDebuffSpellDeliveryHandler` | `!!(spell.effects && spell.effects.length > 0)` — the catch-all |

If `creates_item` is modeled as a `SpellEffectDeclaration` entry, **BuffDebuff claims it** because it is the last with the broadest predicate. That handler resolves targets by `appliesTo: 'self'|'target'|'allies'|'enemies'`, runs `createEffect()`, and calls `addActiveEffectsToResources()` — none of which match an inventory-write. It **cannot cleanly piggyback on any of the 5 existing handlers** without a type-branching special case.

Goodberry's shape (self-only, no target, no ActiveEffect, no concentration, cast-time one-shot write) most closely resembles the **Magic Missile auto-hit fallback** inline in `spell-action-handler.ts` L361-410 — which itself is not a handler class but a fallback branch after `find(canHandle)` misses.

### 3. `SpellCastingContext` — what the delivery handler already has

From [spell-delivery-handler.ts L22-47](packages/game-server/src/application/services/combat/tabletop/spell-delivery/spell-delivery-handler.ts#L22):

```ts
interface SpellCastingContext {
  sessionId, encounterId, actorId, castInfo, spellMatch, spellLevel, castAtLevel,
  isConcentration, isBonusAction,
  sheet: CharacterSheet | null,          // caster's sheet, typed
  characters: SessionCharacterRecord[],  // all session characters
  actor: CombatantRef,
  roster: LlmRoster,
  encounter, combatants, actorCombatant, // fetched fresh AFTER slot spending
}
```

And via `SpellDeliveryDeps.deps: TabletopCombatServiceDeps` ([tabletop-types.ts L510-524](packages/game-server/src/application/services/combat/tabletop/tabletop-types.ts#L510)):

```ts
characters: ICharacterRepository   // HAS updateSheet(id, sheet)  ← key
monsters, npcs, combatRepo, combat, actions, twoPhaseActions,
combatants, pendingActions, events?, abilityRegistry, diceRoller?, ...
```

**Every delivery handler already has write access to the caster's sheet via `deps.characters.updateSheet(actorId, updatedSheet)`.** See [character-repository.ts L32](packages/game-server/src/application/repositories/character-repository.ts#L32).

### 4. Precedent for writing back to the character sheet from combat

`characters.updateSheet(...)` has exactly **2 production call sites outside the character service**:

- **[interaction-handlers.ts L248](packages/game-server/src/application/services/combat/tabletop/dispatch/interaction-handlers.ts#L248)** — drop-weapon dispatch. Mutates `sheet.attacks`, calls `await this.deps.characters.updateSheet(actorId, updatedSheet)`, AND also updates combatant resources (dual-write). This is **the closest architectural precedent** for a combat-time sheet mutation.
- [character-service.ts L121, L356](packages/game-server/src/application/services/entities/character-service.ts) — non-combat.

**Zero spell delivery handler writes to `sheet` today.** All 5 handlers only mutate `combatRepo.updateCombatantState`/encounter state.

Inventory helpers ready for reuse in [inventory.ts](packages/game-server/src/domain/entities/items/inventory.ts):
- `findInventoryItem(inv, name)` — case-insensitive lookup
- `addInventoryItem(inv, item)` — stacks by `(name, magicItemId)`
- `removeInventoryItem(inv, name, qty)` — throws on missing/insufficient

`CharacterItemInstance` shape ([magic-item.ts L277-291](packages/game-server/src/domain/entities/items/magic-item.ts#L277)):
```ts
{ magicItemId?, name, equipped, attuned, currentCharges?, quantity, slot? }
```
No TTL / expiry field. Inventory is dual-stored: persistent `sheet.inventory` + combatant `resources.inventory` mirror (created at combat start, read by AI via `getInventory(resources)` in [ai-context-builder.ts L719](packages/game-server/src/application/services/combat/ai/ai-context-builder.ts#L719)).

### 5. Spell slot manager — concentration vs non-concentration instant-effect spells

`prepareSpellCast()` in [spell-slot-manager.ts](packages/game-server/src/application/services/combat/helpers/spell-slot-manager.ts) runs for every leveled spell regardless of delivery type, called from [spell-action-handler.ts L305-320](packages/game-server/src/application/services/combat/tabletop/spell-action-handler.ts#L305) BEFORE handler dispatch:
- Validates & spends slot via `spendResourceFromPool`
- If `isConcentration=true`: breaks existing concentration, starts new
- If `isConcentration=false`: **no concentration bookkeeping at all** — spell is "instant" from the concentration state machine's perspective

Cantrips (spellLevel 0) skip slot spending. Bonus-action flag bookkeeping at L160-180 / L319-330 is orthogonal.

Goodberry 2024 = level 1, **non-concentration**, `castingTime: 'action'`. Fits existing contracts: slot will be spent, concentration untouched, existing caster concentration (e.g., Bless) preserved. `CanonicalSpell.castingTime` union is `'action' | 'bonus_action' | 'reaction'` ([types.ts L26](packages/game-server/src/domain/entities/spells/catalog/types.ts#L26)) — Goodberry fits; Heroes' Feast (10 min) / Tiny Hut (1 min) would need a new casting-time value (out of scope).

## Impact Analysis

| File | Change Required | Risk | Why |
|------|----------------|------|-----|
| `domain/entities/combat/effects.ts` | Add `'creates_item'` to `EffectType` OR keep the primitive off this union | med | Every `switch (effect.type)` site would need a no-op branch; the union is piped into `createEffect()` / `addActiveEffectsToResources()` and queried across combat rules |
| `domain/entities/spells/prepared-spell-definition.ts` | Either extend `SpellEffectDeclaration` OR add a new top-level optional `PreparedSpellDefinition` field (precedent: `healing`, `zone`, `multiAttack`, `autoHit`+`dartCount`) | low-med | `SpellEffectDeclaration.target|duration|appliesTo` are meaningless for an inventory write |
| `spell-delivery/buff-debuff-spell-delivery-handler.ts` | If primitive lives under `effects[]`, must add a pre-`createEffect()` branch for `creates_item` | high | This handler is the most complex (save-on-cast, multi-target resolution, caster damage-rider detection) — a new branch increases coupling |
| New handler OR fallback branch | Alternative: dedicated `CreatesItemDeliveryHandler` inserted before BuffDebuff, OR extend the L361-410 "auto-hit / simple" fallback in `spell-action-handler.ts` | low | Mirrors Magic Missile's existing self-contained fallback shape |
| `spell-action-handler.ts` dispatch order | If a new handler is added, insert BEFORE `BuffDebuffSpellDeliveryHandler` | low | Order-dependent dispatch; BuffDebuff's predicate is a catch-all |
| Combatant resource mirror | Dual-write: `sheet.inventory` (persistence) + `actorCombatant.resources.inventory` (runtime) so AI `useObject` sees new items mid-encounter | med | Precedent: [interaction-handlers.ts L244-258](packages/game-server/src/application/services/combat/tabletop/dispatch/interaction-handlers.ts#L244) |
| `domain/entities/spells/catalog/level-1.ts` | Add `GOODBERRY` canonical entry | low | No existing entry (grep confirmed); additive |

## Constraints & Invariants

1. **`EffectType` is consumed by `createEffect()` everywhere.** Any `creates_item` value routed through `BuffDebuffSpellDeliveryHandler` must short-circuit before `createEffect(effectDecl.type, ...)` is called, or it becomes a malformed `ActiveEffect`.
2. **`BuffDebuffSpellDeliveryHandler.canHandle` is a catch-all** — any spell with non-empty `effects[]` claims it, ahead of any handler added later unless dispatch order puts the new one first.
3. **Inventory is dual-stored** (`sheet.inventory` + `combatant.resources.inventory`). A mid-combat write to only `sheet` will be invisible to AI `useObject` / existing inventory API until next hydration.
4. **`prepareSpellCast` runs BEFORE delivery dispatch** — slot is already spent when `handle(ctx)` executes. A thrown error inside a `creates_item` handler leaves the slot gone (consistent with all other handlers: counterspelled casts also burn slots).
5. **`concentration: false` on the canonical entry is required** — otherwise `prepareSpellCast` breaks the caster's existing concentration.
6. **Canonical `castingTime` supports only `action | bonus_action | reaction`** — Goodberry fits; longer cast times (10-min Heroes' Feast, 1-min Tiny Hut) would require an additional value before they can use the same primitive.

## Risks

1. **Dispatch collision** with BuffDebuff catch-all if the primitive lives under `effects[]`. Mitigation: new top-level field on `PreparedSpellDefinition` OR exclusion predicate in `BuffDebuff.canHandle`.
2. **Hidden coupling to the combatant resource mirror** — single-write to `sheet.inventory` appears correct in persistence tests but fails AI visibility mid-combat. Mitigation: document dual-write requirement in implementer plan.
3. **No item TTL** — Goodberry berries expire after 24h. Current `CharacterItemInstance` has no `expiresAt`. First slice acceptable as non-expiring mundane items; Heroes' Feast / Summon X tokens will force an expiry field later.
4. **Consumable use-on-eat flow** is a separate integration surface — `useConsumableItem()` in [inventory.ts](packages/game-server/src/domain/entities/items/inventory.ts) decrements quantity but has no HP hook. Goodberry's "eat for 1 HP" lives in the inventory-use API ([session-inventory.ts](packages/game-server/src/infrastructure/api/routes/sessions/session-inventory.ts) `POST /inventory/:itemName/use`), driven by a magic-item/catalog definition. This is out of SpellSystem scope but the `creates_item` schema must provide enough data (name + reference id) for that flow to identify the item.

## Recommendations (documenting what exists; not proposing design)

1. The closest architectural precedent for a spell writing `sheet` mid-combat is **not a spell** — it is the drop-weapon dispatch handler ([interaction-handlers.ts L220-258](packages/game-server/src/application/services/combat/tabletop/dispatch/interaction-handlers.ts#L220)). Dual-write `sheet.attacks` + `combatant.resources`.
2. `SpellDeliveryDeps` + `SpellCastingContext` already carry everything required for a `creates_item` delivery: `deps.characters.updateSheet`, `ctx.sheet`, `ctx.actorCombatant`, `ctx.combatants`, `ctx.characters`. No contract extension needed to add the primitive.
3. Inventory helpers `addInventoryItem`/`removeInventoryItem`/`findInventoryItem` handle stacking by `(name, magicItemId)` — ready to reuse.
4. The Magic Missile auto-hit fallback at [spell-action-handler.ts L361-410](packages/game-server/src/application/services/combat/tabletop/spell-action-handler.ts#L361) is the nearest template for a self-target, no-reaction, no-dice-prompt delivery path that lives inline rather than as a handler class.
5. `EffectType` extension is the most invasive option. A parallel top-level optional field on `PreparedSpellDefinition` (e.g. `createsItem?: CreatesItemSpec`) matches how `healing`, `zone`, `autoHit`+`dartCount`, `multiAttack` are modeled — orthogonal primitives that each route to their own branch/handler instead of overloading `effects[]`.
