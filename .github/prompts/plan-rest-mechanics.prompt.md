# Plan: REST Mechanics — Phase 10

## Overview

Short and long rest mechanics are partially implemented. Domain logic and API route exist,
but lack Hit Dice, spell slot domain handling, CLI integration, documentation, and E2E tests.

## Current State

| Layer | Status | Notes |
|-------|--------|-------|
| Domain (`rest.ts`) | Functional | `refreshClassResourcePools()` handles 12 pool types for short/long rest |
| API route | Exists | `POST /sessions/:id/rest` with `{ type: "short" \| "long" }` |
| Application service | Exists | `CharacterService.takeSessionRest()` — refreshes pools, restores HP on long rest |
| Unit tests | 7 tests | Covers class resource pool refresh |
| CLI | SDK method exists | `GameClient.rest()` — but not wired to REPL commands |
| E2E | **None** | No integration tests for rest flow |
| Docs | **Missing** | Not in SESSION_API_REFERENCE.md |

## Items

### Tier 1 — Quick Wins (wiring + docs)

| # | Feature | Complexity |
|---|---------|-----------|
| 1 | Document `POST /sessions/:id/rest` in SESSION_API_REFERENCE.md | Trivial |
| 2 | Add `rest` command to player-cli REPL | Small |
| 3 | E2E scenario: short rest resource recovery | Small |
| 4 | E2E scenario: long rest full recovery | Small |

### Tier 2 — Domain Gaps

| # | Feature | Gap | Complexity |
|---|---------|-----|-----------|
| 5 | Hit Dice spending on short rest | Zero Hit Dice logic in rest.ts | Medium |
| 6 | Move spell slot refresh to domain | Currently hard-coded in CharacterService, not in `refreshClassResourcePools()` | Small-Med |
| 7 | Warlock Pact Magic short rest | Pact Magic slots refresh on short rest — verify in domain function | Small |

### Tier 3 — Advanced

| # | Feature | Complexity |
|---|---------|-----------|
| 8 | Long rest: recover half Hit Dice (5e 2024) | Medium |
| 9 | Rest interruption (combat during rest) | Large — new mechanic |

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
