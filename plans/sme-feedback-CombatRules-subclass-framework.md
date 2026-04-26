---
type: sme-feedback
flow: CombatRules
feature: subclass-framework-l3
author: CombatRules-SME
status: IN_REVIEW
round: 1
created: 2026-04-26
updated: 2026-04-26
---

# SME Feedback — CombatRules — Subclass Framework Tier A

## Verdict: NEEDS_WORK (AI path gaps)

---

## Feature Verdicts

### 1. Champion: Improved Critical
**Tabletop: DONE**
`domain/combat/attack-resolver.ts:180` — calls `getCriticalHitThreshold(classId, charLevel, subclassId)` from registry.
`tabletop/roll-state-machine.improved-crit.test.ts` — lock-in test exists.

**AI: MISSING**
`application/services/combat/ai/ai-attack-resolver.ts:218` — hardcodes `const critical = d20 === 20;`.
Champion AI attackers will never crit on a 19.

---

### 2. Hunter: Colossus Slayer
**Tabletop: DONE**
`tabletop/rolls/damage-resolver.ts:314-325` — checks `classHasFeature(className, COLOSSUS_SLAYER, level, subclass)` + `!actorResRec.colossusSlayerUsedThisTurn`, sets flag, adds 1d8 rider.
Resource flag hydrated in `combat-hydration.ts:153` and reset in `resource-utils.ts:201`.

**AI: MISSING**
`ai-attack-resolver.ts` — no reference to `COLOSSUS_SLAYER` or `colossusSlayerUsedThisTurn`.
Hunter Rangers controlled by AI will not deal Colossus Slayer bonus damage.

---

### 3. Draconic Resilience
**DONE (both paths)**
`domain/entities/classes/class-feature-enrichment.ts:48-80` — `enrichSheetClassFeatures()` applies +1 HP/level + unarmored AC = 13 + DEX mod.
Called at character creation in `application/services/entities/character-service.ts:235` and at session add in `infrastructure/api/routes/sessions/session-creatures.ts:96`.
Both tabletop and AI read from the already-enriched sheet, so no separate AI path needed.

---

### 4. Dark One's Blessing
**Tabletop: DONE**
`tabletop/rolls/damage-resolver.ts:438-468` — `qualifiesForDarkOnesBlessing` + `darkOnesBlessingTempHp` applied on kill.
Domain helpers in `domain/entities/classes/warlock.ts:206-240`.

**AI: MISSING**
`ai-attack-resolver.ts` — no reference to `qualifiesForDarkOnesBlessing` or `darkOnesBlessingTempHp`.
Fiend Warlocks run by AI will never gain temp HP on kill.

---

### 5. Open Hand Technique
**DONE (tabletop)**
`tabletop/rolls/hit-rider-resolver.ts:241-290` — addle/push/topple riders wired as `postDamageEffect` enhancements.
`tabletop/rolls/damage-resolver.ts:607-665` — `ohtResult` extracted and forwarded in response.
`flurry-of-blows-executor.ts:107` comment confirms intent: resolved as on-hit enhancement, not upfront.

**AI: N/A for now** — AI Monk with Flurry of Blows is not yet a supported AI attack path; no gap to fix here until AI Monk is implemented.

---

## Risks

1. **AI crit threshold gap** (Champion) — Low probability but high visibility: Champion at L3 will *silently* under-perform for AI. Fix: `ai-attack-resolver.ts` should call `getCriticalHitThreshold` instead of hardcoding `d20 === 20` (same pattern as `attack-resolver.ts:180`).

2. **AI Colossus Slayer + Dark One's Blessing gaps** — Medium risk: any Hunter/Warlock added as AI-controlled creature misses class identity. Fix: both need a post-damage hook in `ai-attack-resolver.ts` mirroring the tabletop path.

3. **Draconic Resilience enrichment order** — `enrichSheetClassFeatures` mutates HP at creation time. If a sheet is re-imported or restored from DB without re-enriching, the bonus HP will be double-applied or absent. No bug observed today, but worth a guard in the enrichment function.

---

## Recommended Additions to Plan

- Add `ai-attack-resolver.ts` to the Tier A file list.
- Add one task: "Fix AI crit threshold to use `getCriticalHitThreshold`."
- Add one task: "Port Colossus Slayer + Dark One's Blessing kill-hook to AI path."
- E2E scenario for Draconic Resilience should verify AC via a hit-check step (not just HP), since AC=13+DEX is the harder-to-catch path.
