# Plan: Player CLI Polish — Phase 12

## Overview

The player-cli is a fully functional interactive combat client (8 source files, ~2,500 lines).
This plan addresses quality-of-life improvements and missing features.

## Current State

| Feature | Status |
|---------|--------|
| Combat REPL with state machine | Works |
| Dice rolling with validation | Works |
| SSE event streaming for AI turns | Works |
| On-hit enhancements (Stunning Strike, etc.) | Works |
| Reaction handling | Works |
| Tactical state display | Works |
| Quick encounter mode | Works (5 preset monsters) |
| Scenario loading | Works |
| REST command | ✅ Done — `rest short` / `rest long` in REPL |
| `spells`/`abilities` commands | ✅ Done |
| Inventory display | ✅ Done — `inventory` / `inv` / `items` |
| Multi-PC support | **Missing** |
| Post-combat phase | ✅ Done — rest / status / menu / quit |
| Save/resume | **Missing** |
| README.md | ✅ Done |

## Items

### Tier 1 — Quick Wins (Small)

| # | Feature | Description | Complexity |
|---|---------|-------------|-----------|
| 1 | ✅ Add `rest` command to REPL | "rest short" / "rest long" → calls `GameClient.rest()` | Trivial |
| 2 | ✅ Add `spells` command | Show prepared spells + remaining slots | Small |
| 3 | ✅ Add `abilities` command | Show class features + resource pools | Small |
| 4 | ✅ Add `status` command | Show full character sheet summary (HP, AC, conditions, resources) | Small |
| 5 | ✅ Create README.md | Document usage, commands, scenario format | Small |

### Tier 2 — Quality of Life (Medium)

| # | Feature | Description | Complexity |
|---|---------|-------------|-----------|
| 6 | ✅ Post-combat loop | After combat ends: rest / status / menu / quit | Medium |
| 7 | Expanded quick encounters | Pull from server's monster database instead of 5 hardcoded presets | Medium |
| 8 | ✅ Error recovery | SSE fallback to polling, graceful network failure handling | Medium |
| 9 | ✅ Help command | Show all available commands with descriptions | Small |
| 10 | ✅ Command history | `historySize: 100` in readline (arrow-key nav built-in) | Small |

### Tier 3 — Major Features (Large)

| # | Feature | Description | Complexity |
|---|---------|-------------|-----------|
| 11 | Multi-PC party control | Control 2+ characters, select active character | Large |
| 12 | Save/resume sessions | Persist session ID, reconnect to existing combat | Medium-Large |
| 13 | Exploration phase | Out-of-combat movement, NPC interaction, dungeon traversal | Very Large |

## Implementation Order

1. Tier 1 (#1-#5) — can all be done in one session
2. Tier 2 (#6-#10) — incremental improvements
3. Tier 3 (#11-#13) — larger scope, lower priority

## Complexity

Small for Tier 1, Medium for Tier 2, Large for Tier 3.

---

## Implementation Notes

**Completed 2026-03-10:**

- **Tier 1 (#1–#5):** All implemented in one session.
  - `rest`, `spells`, `abilities`, `status`, `help`, `inventory`, `tactical` commands added to combat REPL.
  - `GameClient.getInventory()` added to SDK.
  - `InventoryItem` / `InventoryResponse` types added.
  - README.md created with full documentation.
- **Tier 2 (#6, #8, #9, #10):** Implemented.
  - Post-combat loop with rest/status/menu/quit flow.
  - `CombatREPL.run()` now returns `"quit" | "menu"` to control main menu flow.
  - SSE connection failure handled gracefully with fallback to polling.
  - `pollForPlayerTurn()` added as fallback when event stream is unavailable.
  - `historySize: 100` set on readline for arrow-key command history.
- **Not implemented:** #7 (expanded quick encounters), #11–#13 (Tier 3 major features).
