---
type: challenge
flow: multi
feature: inventory-g2-scalable
author: copilot-developer
status: APPROVED
round: 2
created: 2026-04-23
updated: 2026-04-24
---

# Plan Challenge — Inventory G2 (Scalable) — Round 2

## Overall Assessment: STRONG

All 6 Critical issues (C1–C6) and 6 of 7 Important issues from Round 1 are resolved. New issues below.

## Critical (NEW)

### C-R2-1. Side-effect processor placement in `spell-action-handler.ts` is under-specified
`return handler.handle(ctx)` exits before any trailing code. Goodberry works only because no handler matches. Future `creates_item` spells with delivery effects will never invoke the processor.

**Required:** pick one:
- (a) wrapper awaits `handler.handle(ctx)` then runs side-effects in BOTH handler-matched and no-handler paths + Magic Missile inline + post-counterspell resume path.
- (b) each delivery handler's `handle()` invokes processor as last step.

### C-R2-2. OoC cast breaks dual-write contract
D2 mandates dual-writes to sheet + combatant.resources.inventory. D11 OoC cast runs without a combatant.

**Required:** processor accepts `actorCombatant?: Combatant | undefined`, skips resources mirror when absent. Explicit "hydrate inventory from sheet" at combat start required.

## Important (NEW)

### I-R2-1. `administer: 'bonus'` potion default RAW-questionable
2024 administering a potion to another creature may be Utilize, not Bonus. Consider potion default = `utilize`, Goodberry overrides to `bonus`.

### I-R2-2. EV comparison signal source undefined
D9 says `UseObjectHandler` compares item EV vs best BA heal spell. Specify: does `ai-context-builder` populate `bestBonusHealSpellEV`, or does handler re-derive?

### I-R2-3. sheetVersion race with non-UoW writers
Raise retry budget or surface ConflictError to CLI.

### I-R2-4. Re-entrant `repos?` parameter easy to misuse
Missing `repos` commits independently. Consider required param + `autoCommit()` helper.

### I-R2-5. canUseItems blocklist vs Wild Shape/polymorphed PCs
Druid Wild Shape (beast form) will be blocked from using items. Sheet override must be auto-set by future Wild Shape code. Add TODO.

## Edge Cases to Test
1. Goodberry cast in-combat → processor invoked once on handler-matched return path.
2. OoC cast with stale combatant row → no stale-write.
3. Concurrent OoC casts → one retries, final 20 berries.
4. Rest + combat-start sweep double-fire → expire exactly once.
5. Missing `repos` param caught.
6. Administer unconscious ally with `utilize` → Action consumed.

## Plan Status
**READY TO IMPLEMENT** conditional on C-R2-1 + C-R2-2 clarifications.
