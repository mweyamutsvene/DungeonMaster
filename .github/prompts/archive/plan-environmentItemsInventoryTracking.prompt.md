# Plan: Environment Items & Inventory Tracking

Add a ground items system so thrown/dropped weapons land on the battlefield, players and AI can see and pick them up, and inventory quantities are tracked. Uses the existing `MapEntity` + `MapCell.objects` infrastructure that's defined but completely unpopulated today.

---

## Phase 1: Domain Layer — Ground Item Model + Map Helpers

1. **Define `GroundItem` type** in `domain/entities/items/` — extends existing `MapEntity` concept (`type: "item"`) with metadata for weapon stats, source (`thrown|dropped|preplaced|container`), and `droppedBy` reference
2. **Add `MapCell.objects` helpers** in `combat-map.ts` — `addItemToCell`, `removeItemFromCell`, `getItemsAtPosition`, `getItemsNearPosition(radiusFeet)`. These functions are completely missing despite `MapCell.objects[]` being defined
3. **Define `InventoryItem` type** — `{ name, quantity, weaponStats? }` stored in combatant `resources.inventory` (no Prisma migration needed — it's a JSON field)

## Phase 2: Combat Mechanics — Throw Consumption + Ground Drop (*depends on Phase 1*)

4. **Consume thrown weapon from inventory** in `action-dispatcher.ts` — after thrown attack resolves, decrement quantity. If 0, remove from `attacks` array
5. **Drop weapon at target position** in `roll-state-machine.ts` — after `handleDamageRoll()` and attack miss path, create `GroundItem` at target position, add to map via new helpers, persist via `combatRepo.updateEncounter()`
6. **AI throw consumption** in `ai-action-executor.ts` — same logic: Orc throws Javelin → removed from Orc's attacks, Javelin lands on ground (*depends on 4, 5*)

## Phase 3: Pickup & Use Mechanics (*depends on Phase 2*)

7. **Track free Object Interaction** — add `objectInteractionUsed: boolean` to combatant resources, reset each turn. D&D 5e 2024: one free per turn
8. **Parse "pick up" commands** in `action-dispatcher.ts` — "pick up javelin", "grab the dart". Validates item is at/adjacent to actor (5ft), free interaction available. Removes from map, adds to inventory + attacks
9. **"Pick up and throw" combo** — "pick up javelin and throw it at orc". D&D 5e 2024 says equipping a weapon (including picking it up) is part of the Attack action
10. **AI pickup** in `ai-action-executor.ts` — if monster needs a weapon and ground item is nearby, AI can pick up + use (*lower priority*)

## Phase 4: Tactical View & Query Integration (*parallel with Phase 3*)

11. **Ground items in TacticalView** — add `groundItems: Array<{ id, name, position, distanceFromActive }>` to `tactical-view-service.ts` response
12. **Ground items in combat query context** — add `nearbyItems` so LLM can answer "what's around me?" with ground items + distances
13. **CLI display** — show interactable items near active combatant in combat status

## Phase 5: Pre-placed Items & Containers (*parallel with Phase 2*)

14. **Scenario setup `groundItems` array** — add to scenario JSON, items placed on map at combat start
15. **Container destruction spawns items** — barrel/crate destroyed → contents become ground items (requires object HP, deferred)

## Phase 6: Ammunition System (*depends on Phase 1*)

16. **Ammo consumption** — weapons with `Ammunition` property expend from inventory per shot. No ammo = can't fire
17. **Post-combat recovery** — D&D 5e 2024: recover half used ammo after fight (round down)

---

## D&D 5e 2024 Rules Reference

### Free Object Interaction
> You can interact with one object or feature of the environment for free, during either your move or action. If you want to interact with a second object, you need to take the Utilize action.

### Equipping Weapons (includes pickup)
> You can either equip or unequip one weapon when you make an attack as part of this action. Equipping a weapon includes drawing it from a sheath or **picking it up.**

### Thrown Property
> If a weapon has the Thrown property, you can throw the weapon to make a ranged attack, and you can draw that weapon as part of the attack.

### Ammunition Recovery
> After a fight, you can spend 1 minute to recover half the ammunition (round down) you used in the fight; the rest is lost.

### Improvised Weapons (deferred)
> An improvised weapon is an object wielded as a makeshift weapon. Don't add Proficiency Bonus. Deals 1d4 damage. Range 20/60 if thrown.

---

## Relevant Files

### Domain Layer (modify)
- `packages/game-server/src/domain/rules/combat-map.ts` — cell object helpers
- `packages/game-server/src/domain/entities/items/` — GroundItem, InventoryItem types

### Application Layer (modify)
- `packages/game-server/src/application/services/combat/tabletop/action-dispatcher.ts` — throw consumption, pickup parsing
- `packages/game-server/src/application/services/combat/tabletop/roll-state-machine.ts` — drop item after attack resolves
- `packages/game-server/src/application/services/combat/ai/ai-action-executor.ts` — AI throw/pickup
- `packages/game-server/src/application/services/combat/tactical-view-service.ts` — ground items in views + queries
- `packages/game-server/src/application/services/combat/helpers/` — possible new helper for inventory operations

### Infrastructure Layer (modify)
- `packages/game-server/src/infrastructure/api/routes/sessions/session-tactical.ts` — expose ground items in query response
- `packages/game-server/src/infrastructure/db/combat-repository.ts` — mapData updates for ground items

### Test Harness (create/modify)
- `packages/game-server/scripts/test-harness/scenarios/core/thrown-weapon-ground-item.json` — throw → ground → pickup → rethrow
- `packages/game-server/scripts/test-harness/scenarios/core/preplaced-items.json` — pre-placed items → pickup → use
- `packages/game-server/scripts/test-harness/scenarios/core/inventory-tracking.json` — dart quantity tracking across throws

---

## Verification

1. **E2E**: Orc throws Javelin → lands at PC position → PC asks "what's around me?" → sees Javelin → picks up → throws back
2. **E2E**: Pre-placed weapons on map → pickup → use in attack
3. **E2E**: Monk with 10 Darts → throws 3 → inventory shows 7 → 3 darts on ground
4. **Unit tests**: MapCell object helpers + inventory quantity tracking
5. **Regression**: 458+ unit tests + 125+ E2E scenarios still pass

---

## Key Decisions

- Ground items stored on `CombatMap.groundItems[]` (separate from `MapCell.objects` for simpler management)
- Picked-up weapons stored in `resources.pickedUpWeapons` (non-destructive, merged at read time in `handleAttackAction`)
- Thrown weapons always land at target position (no scatter)
- Object interaction check prevents multiple pickups per turn
- Phase 6 (Ammunition) deferred for separate implementation

---

## Implementation Notes (Completed)

### What was done
- **Phase 1** ✅: Created `GroundItem` type (`ground-item.ts`), `InventoryItem` type (`inventory.ts`), added `groundItems?: GroundItem[]` to `CombatMap`, added 5 helper functions (`getGroundItems`, `addGroundItem`, `removeGroundItem`, `getGroundItemsAtPosition`, `getGroundItemsNearPosition`), added `isThrownAttack` to `WeaponSpec`, added `objectInteractionUsed` reset in `extractActionEconomy()`
- **Phase 2** ✅: Added `dropThrownWeaponOnGround()` method to `RollStateMachine` class, injected calls in both miss path and hit/damage path. Weapons preserve full `WeaponSpec` including range info for re-pickup.
- **Phase 3** ✅: Added `tryParsePickupText()` parser in `combat-text-parser.ts`, `handlePickupAction()` in `action-dispatcher.ts`, `pickedUpWeapons` merging in `handleAttackAction()`. Pickup validates 5ft proximity, checks objectInteractionUsed flag.
- **Phase 4** ✅: Added `groundItems` to `TacticalView` (all items with distance from active), `nearbyItems` to `CombatQueryContext` (30ft radius for LLM queries).
- **Phase 5** ✅: Added `PATCH /sessions/:id/combat/ground-items` endpoint, `groundItems` in scenario setup JSON, ground item assertions in scenario runner (`groundItemCount`, `groundItemExists`, `groundItemNotExists`). Fixed ground item placement timing — items placed after `rollResult` captures `encounterId` (not just after initiate).
- **Phase 6** ⬜: Ammunition system deferred.

### E2E Scenarios Created
- `core/thrown-weapon-ground-item.json` — 16 steps: Monk throws Dart → Dart on ground → end turn → move to pickup → pick up Dart → Dart gone → rethrow → Dart on ground again
- `core/preplaced-items.json` — 12 steps: Fighter moves to pre-placed Javelin → picks up → throws at Orc → Javelin lands at Orc position

### Test Results
- **127 E2E scenarios passed, 0 failed** (includes 2 new scenarios)
- **458 unit tests passed** (61 test files, 3 skipped LLM files)
- TypeScript typecheck: clean

### Files Created
- `src/domain/entities/items/ground-item.ts`
- `src/domain/entities/items/inventory.ts`
- `scripts/test-harness/scenarios/core/thrown-weapon-ground-item.json`
- `scripts/test-harness/scenarios/core/preplaced-items.json`

### Files Modified
- `src/domain/rules/combat-map.ts` — GroundItem import + groundItems field + 5 helpers
- `src/application/services/combat/tabletop/tabletop-types.ts` — `isThrownAttack` on WeaponSpec
- `src/application/services/combat/helpers/combat-hydration.ts` — `objectInteractionUsed` reset
- `src/application/services/combat/tabletop/roll-state-machine.ts` — `dropThrownWeaponOnGround()` + injection calls
- `src/application/services/combat/tabletop/combat-text-parser.ts` — `tryParsePickupText()`
- `src/application/services/combat/tabletop/action-dispatcher.ts` — pickup parsing, handling, isThrownAttack, pickedUpWeapons merge
- `src/application/services/combat/tactical-view-service.ts` — groundItems in TacticalView + nearbyItems in CombatQueryContext
- `src/infrastructure/api/routes/sessions/session-combat.ts` — PATCH ground-items endpoint
- `scripts/test-harness/scenario-runner.ts` — groundItems setup, placement after rollResult, assertions

### Assumptions Made
- Thrown weapons land at the target's grid position (no scatter mechanic)
- Picking up a weapon is a free object interaction (one per turn), consistent with D&D 5e 2024 rules
- AI doesn't actively pick up ground items yet (separate enhancement)
- Weapon quantity tracking (e.g., "10 Darts") deferred to Phase 6 / Ammunition system

### Open Questions / Follow-ups
- Should missed thrown weapons scatter to a random nearby position?
- Should weapons be displayed as quantity (e.g., "Dart x3") in inventory/tactical view?
- Should creatures drop their weapons on KO/death?
- CLI display of nearby ground items (Phase 4 item 13) — needs player-cli update
- Thrown weapons always land at target position (D&D has no scatter rules for thrown weapons)
- Container destruction deferred (Phase 5.2 — needs object HP system)
- Improvised weapons deferred (complex DM-adjudication rules)

## Open Questions

1. **Missed throw landing**: D&D doesn't specify where a missed thrown weapon lands. Recommend: target position for simplicity. Alternative: 5ft scatter.
2. **Weapon quantity display**: Should the CLI show "Dart (x7)" in the attacks list, or only mention quantities in inventory?
3. **Drop weapon on KO/death**: When a creature drops to 0 HP, should their equipped weapons drop to the ground as lootable items? D&D says yes (weapons drop when unconscious). Include in scope?
