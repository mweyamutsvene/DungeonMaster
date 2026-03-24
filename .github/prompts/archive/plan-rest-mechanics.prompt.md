# Plan: REST Mechanics — Phase 10

## Overview

Short and long rest mechanics are partially implemented. Domain logic and API route exist,
but lack Hit Dice, spell slot domain handling, CLI integration, documentation, and E2E tests.

## Current State

| Layer | Status | Notes |
|-------|--------|-------|
| Domain (`rest.ts`) | Functional | `refreshClassResourcePools()` handles 12 pool types + spell slots for short/long rest |
| API route | Exists | `POST /sessions/:id/rest` with `{ type: "short" \| "long" }` |
| Application service | Exists | `CharacterService.takeSessionRest()` — refreshes pools, restores HP on long rest |
| Unit tests | 10 tests | Covers class resource pool refresh + spell slot refresh |
| CLI | ✅ Already wired | `rest short` / `rest long` commands + handleRestCommand() |
| E2E | ✅ 4 scenarios | short-rest-recovery, long-rest-recovery, long-rest-spellcaster, short-rest-pact-magic |
| Docs | ✅ Documented | Added to SESSION_API_REFERENCE.md |

## Items

### Tier 1 — Quick Wins (wiring + docs)

| # | Feature | Complexity | Status |
|---|---------|-----------|--------|
| 1 | Document `POST /sessions/:id/rest` in SESSION_API_REFERENCE.md | Trivial | ✅ Done |
| 2 | Add `rest` command to player-cli REPL | Small | ✅ Already existed |
| 3 | E2E scenario: short rest resource recovery | Small | ✅ Already existed (core/short-rest-recovery.json) |
| 4 | E2E scenario: long rest full recovery | Small | ✅ Done (3 new scenarios created) |

### Tier 2 — Domain Gaps

| # | Feature | Gap | Complexity | Status |
|---|---------|-----|-----------|--------|
| 5 | Hit Dice spending on short rest | Zero Hit Dice logic in rest.ts | Medium | ⏸️ Deferred |
| 6 | Move spell slot refresh to domain | Currently hard-coded in CharacterService, not in `refreshClassResourcePools()` | Small-Med | ✅ Done |
| 7 | Warlock Pact Magic short rest | Pact Magic slots refresh on short rest — verify in domain function | Small | ✅ Verified + E2E |

### Tier 3 — Advanced

| # | Feature | Complexity | Status |
|---|---------|-----------|--------|
| 8 | Long rest: recover half Hit Dice (5e 2024) | Medium | ⏸️ Deferred |
| 9 | Rest interruption (combat during rest) | Large — new mechanic | ⏸️ Deferred |

## D&D 5e 2024 Rest Rules

### Short Rest (1 hour)
- Spend Hit Dice to recover HP (roll die + CON mod per Hit Die)
- Class-specific: Ki resets, Channel Divinity resets (Cleric 2+), Warlock Pact slots reset, Bardic Inspiration resets (5+), Arcane Recovery (Wizard 1/day, not per rest)

### Long Rest (8 hours)
- Recover all HP
- Recover all spell slots
- Recover half Hit Dice (round down, minimum 1)
- Reset all class resource pools
- Death saves reset

## Implementation Order

1. Docs + CLI wiring (#1, #2)
2. E2E scenarios (#3, #4)
3. Domain improvements (#5, #6, #7)
4. Advanced (#8, #9) — deferred

## Complexity

Small-Medium total for Tier 1-2. Large if pursuing Hit Dice mechanics.

---

## Completion Notes

### What was done
- **#1 API Docs**: Added full `POST /sessions/:id/rest` documentation to SESSION_API_REFERENCE.md including request/response schemas and short/long rest recovery tables
- **#2 CLI**: Discovered already fully wired — `rest short` / `rest long` commands with `handleRestCommand()` handler and help text
- **#3 Short Rest E2E**: Discovered `core/short-rest-recovery.json` already existed (fighter secondWind + actionSurge)
- **#4 Long Rest E2E**: Created 3 new scenarios:
  - `core/long-rest-recovery.json` — Barbarian rage + HP restore verification
  - `core/long-rest-spellcaster.json` — Wizard arcaneRecovery + spell slot refresh + HP restore
  - `warlock/short-rest-pact-magic.json` — Warlock Pact Magic short rest refresh
- **#6 Spell Slot Domain**: Moved spell slot refresh from `CharacterService.takeSessionRest()` to domain `rest.ts`:
  - Added `spellSlot_*` pattern to `shouldRefreshOnRest()` (long rest only)
  - Added spell slot handling in `refreshClassResourcePools()` (uses pool's stored max)
  - Removed inline spell slot refresh from CharacterService
- **#7 Warlock Pact Magic**: Verified already working — `pactMagic` pool refreshes on both short and long rest in domain logic. Added E2E scenario.
- **Scenario runner**: Enhanced `RestAction` to support `characterHp` verification (reads session state after rest to confirm HP)
- **Tests**: Added 2 new unit tests (spell slot refresh on long rest, spell slot unchanged on short rest). Total: 10 domain tests.

### Verification
- TypeScript: clean compilation
- Unit tests: 575 passed, 0 failed (10 rest-specific)
- E2E: 149 passed, 0 failed (up from 146 baseline)

### Deferred items
- **#5 Hit Dice spending**: No Hit Dice tracking in Character entity yet. Would need: new `hitDice` field on character sheet, domain logic for spending/rolling during rest, API for choosing how many to spend, CLI prompts. Medium-large effort.
- **#8 Half Hit Dice recovery on long rest**: Depends on #5.
- **#9 Rest interruption**: Large new mechanic — would need combat-in-rest state tracking.
