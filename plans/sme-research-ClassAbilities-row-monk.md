---
type: sme-research
flow: ClassAbilities
feature: classabilities-row-monk-staleness
author: DMDeveloper
status: DRAFT
round: 1
created: 2026-04-26
updated: 2026-04-26
---

## Scope

Audit the **Monk row** (line 177) in section `2.2 ClassAbilities` of `plans/mechanics-and-coverage-report.md` against current code, unit tests, and E2E scenarios. ClassAbilities-SME researched all monk feature files, executors, tests, and scenarios.

Files examined:
- `packages/game-server/src/domain/entities/classes/monk.ts`
- `packages/game-server/src/application/services/combat/abilities/executors/monk/` (all 5 executors)
- `packages/game-server/src/domain/rules/class-startup-effects.ts`
- `packages/game-server/src/application/services/combat/tabletop/rolls/hit-rider-resolver.ts`
- `packages/game-server/src/application/services/combat/helpers/pit-terrain-resolver.ts`
- `packages/game-server/src/domain/entities/classes/feature-keys.ts`
- Unit tests: `monk.test.ts`, `class-startup-effects.test.ts`, `pit-terrain-resolver.test.ts`
- E2E scenarios: `stunning-strike-lockdown.json`, `deflect-and-patient-defense.json`, `flurry-and-open-hand.json`, `ki-resource-depletion.json`

---

## Row Verdict

**INCORRECT / STALE**

Multiple cells have wrong labels, missing labels, wrong terminology, and one feature (`Uncanny Metabolism`) is completely absent from the report.

---

## Evidence

### L1 — "Martial Arts SUP, Unarmored Def" (missing SUP on Unarmored Def)

| Claim | Verdict | Evidence |
|-------|---------|---------|
| Martial Arts SUP | ✅ CORRECT | `MartialArtsExecutor` exists; `"martial-arts": 1` in feature map; patterns in `MONK_COMBAT_TEXT_PROFILE` |
| Unarmored Def *(no label)* | ⚠️ STALE | `monkUnarmoredDefenseAC(dexMod, wisMod)` implemented in `monk.ts`; called in `character.ts` L427-436; unit-tested in `monk.test.ts` L34-48. **Missing SUP label.** |

---

### L2 — "Ki/Focus pool SUP, Flurry/Patient/Step SUP, Unarmored Movement"

| Claim | Verdict | Evidence |
|-------|---------|---------|
| Ki/Focus pool SUP | ✅ CORRECT | `createKiState()`, `kiPointsForLevel()`, `getMonkResourcePools()` all implemented; refreshes on short+long rest |
| Flurry/Patient/Step SUP | ✅ CORRECT | Three dedicated executors; all registered in `MONK_COMBAT_TEXT_PROFILE`; covered by `deflect-and-patient-defense.json` + `flurry-and-open-hand.json` E2E |
| Unarmored Movement *(no label)* | ⚠️ STALE | L2 +10 ft installed as `speed_modifier` passive in `class-startup-effects.ts` L64-70 — **but L6/10/14/18 scaling is NOT implemented.** Also bypasses the feature map (hardcoded `classId` check). Should be PARTIAL. |
| Uncanny Metabolism — **ABSENT** | ❌ INCORRECT | `"uncanny-metabolism": 2` in feature map; `UNCANNY_METABOLISM` key in `feature-keys.ts`; `uncannyMetabolismUsesForLevel()` + resource pool present — **but no initiative-trigger executor exists.** Pool is plumbed, mechanic is missing. Entire feature omitted from report. |

---

### L3 — "Deflect Attacks SUP (reaction), Monastic Tradition MISSING"

| Claim | Verdict | Evidence |
|-------|---------|---------|
| Deflect Attacks SUP (reaction) | ✅ CORRECT | `"deflect-attacks": 3` in feature map; `DEFLECT_ATTACKS_REACTION` declared; reduction = 1d10+DEX+monkLevel; covered by `deflect-and-patient-defense.json`. L3 placement correct per 2024 PHB. |
| Monastic Tradition MISSING | ❌ INCORRECT | "Monastic Tradition" is 2014 terminology — 2024 PHB calls it "Monk Subclass". More critically, **Open Hand Technique (L3) IS implemented** as an `attackEnhancement` in `OpenHandSubclass.combatTextProfile` (addle/push/topple choices). `WholenessOfBodyExecutor` implements the L6 feature. Should be "Monk Subclass: Open Hand PARTIAL". |

---

### L4 — "ASI, Slow Fall SUP"

| Claim | Verdict | Evidence |
|-------|---------|---------|
| ASI | ✅ CORRECT | Universal; no domain implementation needed |
| Slow Fall SUP | ✅ BROADLY CORRECT | `pit-terrain-resolver.ts` L118: `5 × monkLevel` reduction; gated by `monkLevel >= 4` and reaction availability; tested in `pit-terrain-resolver.test.ts`. **Architecture note:** Hardcoded by monkLevel check (not feature-map gated); auto-triggers without reaction prompt (2024 RAW: "use your Reaction"). SUP label defensible since damage reduces correctly. |

---

### L5 — "Extra Attack, Stunning Strike PARTIAL (inline)"

| Claim | Verdict | Evidence |
|-------|---------|---------|
| Extra Attack *(no label)* | ⚠️ STALE | `"extra-attack": 5` in feature map; `ClassFeatureResolver.getAttacksPerAction()` returns 2; exercised in `stunning-strike-lockdown.json`. **Missing SUP label.** |
| Stunning Strike PARTIAL (inline) | ⚠️ PARTIALLY STALE | "inline" is accurate (handled in `hit-rider-resolver.ts` L190-215, not a standalone executor). However, **both 2024 paths are mechanically complete**: Stunned (fail) and `StunningStrikePartial` (success → speed halved, adv on next attack) are both wired. "PARTIAL" is misleading — the gap is E2E coverage only (success path not in any scenario). **Should be SUP-inline with a coverage note.** |

---

## Proposed Row Edits

**Current:**
```
| **Monk** | Martial Arts SUP, Unarmored Def | Ki/Focus pool SUP, Flurry/Patient/Step SUP, Unarmored Movement | Deflect Attacks SUP (reaction), Monastic Tradition MISSING | ASI, Slow Fall SUP | Extra Attack, Stunning Strike PARTIAL (inline) |
```

**Replacement:**
```
| **Monk** | Martial Arts SUP, Unarmored Def SUP | Ki/Focus pool SUP, Flurry/Patient/Step SUP, Uncanny Metabolism PARTIAL (pool tracked; no initiative-trigger), Unarmored Movement PARTIAL (L2 +10 ft only; L6/10/14/18 scaling MISSING) | Deflect Attacks SUP (reaction), Monk Subclass: Open Hand PARTIAL (OHT L3 + Wholeness of Body L6 SUP; Quivering Palm L11 + Perfect Focus L17 MISSING) | ASI, Slow Fall SUP (auto-trigger; no reaction prompt) | Extra Attack SUP, Stunning Strike SUP-inline (E2E: fail→Stunned covered; success→StunningStrikePartial not in E2E) |
```

---

## Risks

- **Slow Fall reaction prompt:** Auto-firing without a prompt deviates from 2024 RAW. Low priority (almost always desirable), but worth a TODO if strict rules mode is added.
- **Uncanny Metabolism gap:** The initiative-trigger path requires hooking into `turn-start` or roll-initiative flow. No executor exists. This is a real functional gap, not just a coverage gap.
- **Unarmored Movement scaling:** Only L2 +10 ft is applied. Any L6+ monk in combat has incorrect speed if the progression table isn't applied.
- **StunningStrikePartial E2E:** The 2024 success condition (speed halved + advantage on next attack against target) has no E2E coverage. A regression could go undetected.

---

## Open Questions

1. Should Slow Fall be refactored to use the reaction prompt (`pending-action` two-phase flow) to match 2024 RAW? Or is auto-apply acceptable as a product decision?
2. Is Uncanny Metabolism initiative-trigger deferred by design, or untracked? No plan file references it.
3. Should `class-startup-effects.ts` unarmored-movement be converted to use the feature map + level-based scaling instead of the hardcoded classId check?
