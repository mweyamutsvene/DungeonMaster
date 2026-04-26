---
type: sme-research
flow: ClassAbilities
feature: classabilities-row-ranger-staleness
author: DMDeveloper
status: DRAFT
round: 1
created: 2026-04-26
updated: 2026-04-26
---

## Scope

Audit the Ranger row in section `2.2 ClassAbilities` of `plans/mechanics-and-coverage-report.md` for staleness and incorrect claims.

**Current row:**
```
| **Ranger** | Spellcasting, Favored Enemy / Hunter's Mark tie PARTIAL | Fighting Style, Deft Explorer (non-combat) | Archetype MISSING, Roving | ASI | Extra Attack |
```

---

## Row Verdict

**INCORRECT**

Three distinct errors: "PARTIAL" label on Favored Enemy/Hunter's Mark is stale (fully implemented); "Archetype MISSING" is false (Hunter subclass with Colossus Slayer is implemented and E2E tested); "Roving" is miscolumned (L6, not L3). Additionally, Weapon Mastery (L1) is entirely absent from the row.

---

## Evidence

### L1 — `Spellcasting, Favored Enemy / Hunter's Mark tie PARTIAL`

| Claim | Verdict | Evidence |
|-------|---------|----------|
| Spellcasting | CORRECT | `ranger.ts:91` — `"spellcasting": 1` in feature map |
| Favored Enemy / Hunter's Mark tie **PARTIAL** | **STALE** | `ranger.ts:99–107` — `favoredEnemyUses()` pool factory fully wired; `MoveHuntersMarkExecutor` registered in `app.ts:301`; E2E scenario `favored-enemy-slot-economy.json` exercises pool decrement (3→0) and fallback to spell slot. Not PARTIAL — fully supported. |
| Weapon Mastery | **MISSING from row** | `ranger.ts:88` — `"weapon-mastery": 1`; `ranger.test.ts:19–21` asserts 2 mastery slots; `weapon-mastery.ts` lists Ranger. Identical coverage level to Paladin L1 Weapon Mastery which IS listed in its row. |

### L2 — `Fighting Style, Deft Explorer (non-combat)`

| Claim | Verdict | Evidence |
|-------|---------|----------|
| Fighting Style | CORRECT | `ranger.ts:90` — `"fighting-style": 2`; `fighting-style-character.test.ts:119` asserts it |
| Deft Explorer (non-combat) | CORRECT | `ranger.ts:89` — `[DEFT_EXPLORER]: 2`; no executor exists (no combat effect) — annotation accurate |

### L3 — `Archetype MISSING, Roving`

| Claim | Verdict | Evidence |
|-------|---------|----------|
| Archetype MISSING | **INCORRECT** | `ranger.ts:63–70` — `Hunter` subclass defined with `HUNTERS_LORE`, `HUNTERS_PREY`, `COLOSSUS_SLAYER` at L3. Colossus Slayer wired in `damage-resolver.ts:310–328` with per-turn guard; `combat-hydration.ts:153` and `resource-utils.ts:201` track `colossusSlayerUsedThisTurn`; E2E scenario `hunters-mark-colossus.json` covers mark + Colossus Slayer + mark transfer. |
| Roving (placed in L3 column) | **INCORRECT** | `ranger.ts:89` — `[ROVING]: 6`. Roving is L6, not L3. Column placement is wrong. |

### L4 — `ASI`

| Claim | Verdict | Evidence |
|-------|---------|----------|
| ASI | CORRECT | `ability-score-improvement.ts:25` — standard ASI levels `[4, 8, 12, 16, 19]`; Ranger follows standard table |

### L5 — `Extra Attack`

| Claim | Verdict | Evidence |
|-------|---------|----------|
| Extra Attack | CORRECT | `ranger.ts:93` — `"extra-attack": 5`; `ranger.test.ts:11,15` asserts it; exercised in `hunters-mark-colossus.json` and `party-scout.json` scenarios |

---

## Proposed Row Edits

Replace current row:
```
| **Ranger** | Spellcasting, Favored Enemy / Hunter's Mark tie PARTIAL | Fighting Style, Deft Explorer (non-combat) | Archetype MISSING, Roving | ASI | Extra Attack |
```

With:
```
| **Ranger** | Spellcasting, Favored Enemy / Hunter's Mark SUP (pool + MoveHuntersMark executor + slot fallback), Weapon Mastery 2 | Fighting Style, Deft Explorer (non-combat) | Hunter subclass: Hunters Lore, Hunters Prey, Colossus Slayer SUP | ASI | Extra Attack |
```

Notes on what was removed/added:
- `PARTIAL` → `SUP` on Favored Enemy/Hunter's Mark  
- Added `Weapon Mastery 2` to L1 (same basis as Paladin row)  
- `Archetype MISSING` → `Hunter subclass: Hunters Lore, Hunters Prey, Colossus Slayer SUP`  
- Removed `Roving` from L3 (it is L6, outside the L1–5 scope of this table)

---

## Risks

- **Low**: Changes are documentation-only. No code changes required.
- The other Hunter L3 feature `HUNTERS_LORE` (`ranger.ts:65`) has no combat executor — its "(knowledge)" non-combat annotation is implicit; confirm this is intentional and not a hidden gap before finalizing SUP claim for all Hunter subclass features.

---

## Open Questions

1. Should `HUNTERS_LORE` be annotated separately as "(non-combat)" similar to `Deft Explorer`? It has no executor or E2E coverage but that may be correct by design (passive knowledge skill).
2. `Roving` (L6) — should a `>L5` or "L6+" column note be added to the table for features outside L1–5? Currently the table cuts at L5 and Roving is silently dropped.
3. Are additional Hunter's Prey options beyond Colossus Slayer (e.g., Giant Killer, Horde Breaker) implemented or missing? The SME found only Colossus Slayer wired in `damage-resolver.ts`.
