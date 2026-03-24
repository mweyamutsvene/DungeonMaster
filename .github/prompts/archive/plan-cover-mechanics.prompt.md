# Plan: Cover Mechanics Completion — Phase 13

## Overview

Cover is **substantially implemented** for the tabletop attack flow — terrain-based cover detection,
AC bonus calculation, and an E2E scenario all exist. However, several gaps remain that prevent full
D&D 5e 2024 compliance.

## D&D 5e 2024 Rules Reference

| Degree | AC Bonus | DEX Save Bonus | Description |
|--------|----------|----------------|-------------|
| Half Cover | +2 | +2 | Another creature or object covers at least half the target |
| Three-Quarters Cover | +5 | +5 | Object covers at least three-quarters of the target |
| Total Cover | Can't be targeted | Can't be targeted | Object covers the whole target |

> "A target can benefit from cover only when an attack or other effect originates on the opposite
> side of the cover."

## Current State

| Component | Status | Location |
|-----------|--------|----------|
| `TerrainType` includes cover types | ✅ Done | `domain/rules/combat-map.ts` L21-23 |
| `CoverLevel` type | ✅ Done | `domain/rules/combat-map.ts` L31 |
| `getCoverLevel(map, attacker, target)` | ✅ Done | `domain/rules/combat-map.ts` L251-289 |
| `getCoverACBonus(cover)` | ✅ Done | `domain/rules/combat-map.ts` L296-305 |
| Tabletop attack → cover AC bonus | ✅ Done | `action-dispatcher.ts` L1709-1723, `roll-state-machine.ts` L507-509 |
| `AttackPendingAction.coverACBonus` | ✅ Done | `tabletop-types.ts` L67 |
| E2E scenario: `core/cover-ac-bonus.json` | ✅ Done | Archer vs goblin behind half cover |
| Cover bonus on DEX saving throws | ❌ Missing | `saving-throw-resolver.ts` has no cover logic |
| Creatures-as-cover (half cover) | ❌ Missing | `getCoverLevel()` only checks terrain cells |
| Cover on two-phase/AI attack paths | ❌ Missing | `two-phase-action-service.ts`, `ai-action-executor.ts` |
| Spell attack/targeting cover | ❌ Missing | `spell-action-handler.ts` doesn't check cover |
| Total cover blocks spell targeting | ❌ Missing | No validation for non-attack spell targets behind total cover |

## Implementation Plan

### Phase 13.1 — DEX Saving Throw Cover Bonus (Small)

**The highest-value gap.** Many AOE spells (Fireball, Lightning Bolt) require DEX saves. Cover
should grant +2/+5 to these saves.

| # | Task | Details |
|---|------|---------|
| 1 | Extend `SavingThrowResolver` context | Pass caster position + combat map into saving throw resolution |
| 2 | Calculate cover between caster and target | Call `getCoverLevel()` for DEX saves only |
| 3 | Apply bonus to DEX save total | Half → +2, Three-quarters → +5, Total → auto-success |
| 4 | E2E scenario | `core/cover-dex-save-bonus.json` — creature behind half cover gets +2 on Fireball DEX save |

### Phase 13.2 — Creatures-as-Cover (Small-Medium)

D&D 5e 2024: "Another creature" can provide half cover. When a creature is between the attacker
and its target, the target should get half cover.

| # | Task | Details |
|---|------|---------|
| 5 | Extend `getCoverLevel()` to check creature positions | Accept combatant positions array, check if any creature occupies cells between attacker and target |
| 6 | Filter out attacker and target from creature list | Don't count self or target as cover providers |
| 7 | Merge creature cover with terrain cover | Take the highest cover level between terrain and creatures |
| 8 | E2E scenario | `core/creatures-as-cover.json` — attack through another creature → half cover (+2 AC) |

### Phase 13.3 — Cover on AI/Two-Phase Attack Paths (Small)

Ensure monsters attacking PCs and OA resolution also apply cover bonuses.

| # | Task | Details |
|---|------|---------|
| 9 | Add cover check to `two-phase-action-service.ts` OA resolution | Calculate cover when resolving opportunity attacks |
| 10 | Add cover check to `ai-action-executor.ts` | AI-driven attacks should respect cover AC bonus |
| 11 | E2E scenario | `core/monster-attack-cover.json` — monster attacks PC behind half cover → AC increased |

### Phase 13.4 — Spell Cover (Medium)

| # | Task | Details |
|---|------|---------|
| 12 | Spell attack cover check | Add cover calculation in `spell-action-handler.ts` for spell attacks |
| 13 | Total cover blocks targeting | Validate that targets behind total cover can't be targeted by single-target spells |
| 14 | E2E scenario | `core/spell-attack-cover.json` — spell attack against target behind cover |

## Dependencies

- Phase 13.2 (creatures-as-cover) depends on having combatant position data available in the
  cover calculation context — may need to pass roster/position info through.
- Phase 13.4 (spell cover) should be done after the spell system is more mature.

## Complexity

- Phase 13.1: Small (add cover lookup to existing save resolution)
- Phase 13.2: Small-Medium (extend domain function + wire positions)
- Phase 13.3: Small (copy existing pattern from tabletop flow)
- Phase 13.4: Medium (spell targeting validation is new)

## Priority

**Medium** — The tabletop attack path already works. The gaps mainly affect AOE spell saves and
edge cases like shooting through/past creatures. Phase 13.1 is highest value since it affects
common gameplay (Fireball saves behind cover).
