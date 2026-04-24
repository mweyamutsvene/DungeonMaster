---
type: challenge
flow: multi
feature: inventory-g2-scalable
author: copilot-developer
status: IN_REVIEW
round: 1
created: 2026-04-22
updated: 2026-04-23
---

# Plan Challenge — Inventory G2 (Scalable)

## Overall Assessment: ADEQUATE (6 Critical issues that will corrupt state if shipped as-is)

The architecture is sound — `onCastSideEffects` as a separate spell field (D2), UoW-wrapped transfer (D5), and reusing `objectInteractionUsed` (D1/D8) all track the SME research correctly. But the plan has real gaps around **atomicity, parser ambiguity, AI selection, and failure semantics of `onCastSideEffects`** that will produce wrong game state or silent data loss.

## Critical Issues

### C1. `onCastSideEffects` + delivery-handler failure = desync with NO rollback
If processor runs after slot spend but before delivery, and delivery throws, we end up with: slot spent, inventory items created, no compensating remove. Also combatant.resources.inventory mirror not written → berries invisible until rehydration.

**Required:** reorder side-effects AFTER delivery dispatch (Goodberry is self-only non-concentration so safe; future-proofs for Heroes' Feast). AND mandate dual-write to `actorCombatant.resources.inventory` matching `interaction-handlers.ts:244-258`.

### C2. Stack-key race: concurrent transfers from same source
No version field, no row lock. Two UoWs read Alice (10 berries), decrement to 9, commit. **Required:** `sheetVersion` field bumped+compared on every `updateSheet`, OR `transferItem` must re-read both sheets INSIDE the UoW callback.

### C3. Parser ambiguity
- `"hand"` collides with handaxe.
- `"give greataxe to Alice"` could match attack parser.
- `"use potion"` with two potions — undefined.

**Required:** strict regex `/^(?:give|hand|feed|administer)\s+.+\s+to\s+\S+/i`; precede attack parsers; explicit ambiguous-name handling.

### C4. `creates_item` + missing `magicItemId` → silent failure
**Required:** side-effect processor throws ValidationError on unresolved `magicItemId`.

### C5. `resetTurnResources` fix may mask a latent mid-turn bug
Adding `objectInteractionUsed: false` is correct defense-in-depth, but must audit all callers of `resetTurnResources`. If any run mid-turn, this fix silently refunds interaction mid-turn.

### C6. AI item selection has no expected-value comparison
AI at 20% HP with Goodberry (1 HP) and Healing Word slot will burn goodberry before casting. **Required:** `UseObjectHandler.findBestUsableItem` compares expected-heal.

## Important
- **I1.** Armor equip during combat — rejection path not wired.
- **I2.** Spell scroll `use='utilize'` — actually spell's casting time applies.
- **I3.** Split `give` (free obj interaction, transfer only) vs `feed`/`administer` (bonus, transfer+activate).
- **I4.** Document no inventory cap.
- **I5.** Sweep expired items at combat/session start too, not only long rest.
- **I6.** `sweepExpiredItems` emits via deferred event repo inside rest UoW.
- **I7.** Clarify: UoW-scoped deferred event repo for transfer event.

## Edge Cases to Test
1. Concurrent transfer from same source.
2. In-combat Goodberry cast.
3. `give goodberry to self` — reject.
4. Transfer preserves `longRestsRemaining` (stack split on receiver side).
5. Multiple long rests decrement expiry only once.
6. Dropped goodberry → pickup preserves expiry.
7. `canUseItems: false` beast companion carrying goodberries.
8. Bonus-action potion rejected when TWF offhand consumed bonus.
9. Feed unconscious ally → 1 HP + conscious + prone.
10. Same-expiry stacks merge on second cast.

## Recommendation
**Revise plan round 2** to address C1–C6 before implementation.
