---
type: sme-research
flow: ClassAbilities
feature: classabilities-row-paladin-staleness
author: DMDeveloper
status: DRAFT
round: 1
created: 2026-04-26
updated: 2026-04-26
---

# SME Research — ClassAbilities — Paladin Row Audit

## Scope
- Files read:
  - `packages/game-server/src/domain/entities/classes/paladin.ts` (210 lines)
  - `packages/game-server/src/application/services/combat/abilities/executors/paladin/lay-on-hands-executor.ts` (~100 lines)
  - `packages/game-server/src/application/services/combat/abilities/executors/paladin/channel-divinity-executor.ts` (~100 lines)
  - `packages/game-server/src/application/services/combat/abilities/executors/paladin/index.ts`
  - `packages/game-server/src/application/services/combat/tabletop/rolls/hit-rider-resolver.ts` (lines 200–280)
  - `packages/game-server/src/domain/entities/classes/feature-keys.ts` (lines 78–170)
  - `packages/game-server/src/domain/rules/weapon-mastery.ts`
  - `packages/game-server/src/domain/entities/spells/spell-progression.ts`
  - `packages/game-server/src/infrastructure/api/app.ts` (imports/registrations)
  - E2E scenario dirs: `scenarios/paladin/`, `scenarios/class-combat/paladin/`
- Task context: Audit each feature claim in the Paladin row of `mechanics-and-coverage-report.md` for correctness and staleness.

---

## Row Verdict: INCORRECT

4 errors found: Channel Divinity in wrong column (L2→L3), Divine Health wrong level + MISSING status omitted, Faithful Steed labelled "cross-flow" but is unimplemented, Divine Sense omitted from L1 entirely.

---

## Current Row (as-is)

```
| **Paladin** | Spellcasting, Lay on Hands SUP, Weapon Mastery 2 | Fighting Style, Divine Smite PARTIAL (inline), Channel Divinity PARTIAL | Sacred Oath MISSING | ASI, Divine Health | Extra Attack, Faithful Steed cross-flow |
```

Columns: L1 | L2 | L3 (subclass) | L4 | L5

---

## Feature-by-Feature Findings

### 1. L1 — Spellcasting
- **Claimed:** Spellcasting (no qualifier = implemented)
- **Code:** `paladin.ts` line 165 — `"spellcasting": 1` in features map. `spell-progression.ts` line 188 — `paladin: "half"`. Half-caster table shows `{}` at L1, first slots (`{ 1: 2 }`) at L2.
- **Verdict:** **CORRECT.** Spellcasting is a L1 feature but slots begin at L2 per half-caster table. Correctly modeled. Spell preparation enforcement is wired per `spell-preparation.ts` line 4 comment.

---

### 2. L1 — Lay on Hands SUP
- **Claimed:** `Lay on Hands SUP`
- **Code:**
  - `paladin.ts` line 165 — `"lay-on-hands": 1`
  - `executors/paladin/lay-on-hands-executor.ts` — Full executor: checks bonus action, checks `layOnHands` pool, touch-range validates, heals from HP pool. Registered in `app.ts` line 294.
  - E2E: `scenarios/paladin/lay-on-hands.json` exists.
- **Verdict:** **CORRECT.** Full executor exists. "SUP" (supported) is accurate.

---

### 3. L1 — Weapon Mastery 2
- **Claimed:** `Weapon Mastery 2`
- **Code:**
  - `paladin.ts` line 167 — `"weapon-mastery": 1`
  - `weapon-mastery.ts` line 8 comment: "Classes with Weapon Mastery: Fighter (3), Barbarian (2), Paladin (2), Ranger (2), Rogue (2)"
  - `weapon-mastery.ts` line 96 — `paladin: 2`
- **Verdict:** **CORRECT.** Count of 2 is accurate.

---

### 4. L1 — Divine Sense NOT IN ROW ⚠️
- **Claimed:** (omitted from row entirely)
- **Code:** `paladin.ts` line 171 — `"divine-sense": 3` (placed at **level 3**, not level 1). `PALADIN_COMBAT_TEXT_PROFILE` has action mapping for `divine-sense` → `class:paladin:divine-sense`. `ChannelDivinityExecutor` handles the `divine-sense` abilityId and costs a Channel Divinity use.
- **2024 rules:** Divine Sense is a **L1** feature with its own separate uses (NOT a Channel Divinity option).
- **Verdict:** **STALE — compound issue.** The row omits Divine Sense entirely. The code compounds the problem by placing it at L3 as a Channel Divinity sub-option, which is wrong per 2024 rules. Divine Sense should be:
  - Listed in the L1 column of the row
  - Have its own resource pool (not shared with Channel Divinity)
  - Feature key at L1, not L3

---

### 5. L2 — Fighting Style
- **Claimed:** `Fighting Style` (no qualifier)
- **Code:** `paladin.ts` line 168 — `"fighting-style": 2`. Full fighting-style infrastructure exists (`fighting-style.ts`, hydration in `creature-hydration.ts`, applied in roll state machine).
- **2024 rules:** Paladin gets Fighting Style at L2. ✓
- **Verdict:** **CORRECT.**

---

### 6. L2 — Divine Smite PARTIAL (inline)
- **Claimed:** `Divine Smite PARTIAL (inline)`
- **Code:**
  - `paladin.ts` line 169 — `"divine-smite": 2`
  - `PALADIN_COMBAT_TEXT_PROFILE` attack enhancement at lines 126–134 — `keyword: "divine-smite"`, `minLevel: 2`, `requiresMelee: true`, `trigger: "onHit"`, `requiresBonusActionAvailable: true`, `requiresAnySpellSlot: true`
  - `hit-rider-resolver.ts` lines 214–248 — inline handling: finds lowest spell slot, spends slot + bonus action, computes `divineSmiteDice(slotLevel)`, pushes `bonusDice: { diceCount, diceSides: 8 }`. **No standalone executor — handled inline in HitRiderResolver.**
  - `divineSmiteDice()` in `paladin.ts`: implements the 2024 cap of 5d8 max.
  - E2E: `scenarios/paladin/divine-smite.json` exists.
- **2024 rules concern:** In 2024, "Divine Smite" was renamed **"Paladin's Smite"** and became a spell (you cast it as a bonus action after hitting). The code uses the old name and implements it as an attack enhancement trigger rather than a distinct spell. Functionally similar but classification/naming is stale.
- **Verdict:** **MOSTLY CORRECT — name/classification STALE.** "Inline" and "PARTIAL" qualifiers are accurate. The mechanism works (slot spend + radiant dice). However: (a) old name still used in code and row, (b) 2024 rules treat it as a spell not an enhancement flag. This is a rework concern but the row accurately describes current code state.

---

### 7. L2 — Channel Divinity PARTIAL ← WRONG LEVEL
- **Claimed:** `Channel Divinity PARTIAL` in **L2** column
- **Code:** `paladin.ts` line 170 — `"channel-divinity": 3` — Channel Divinity is at **L3**, not L2.
- **Executor:** `channel-divinity-executor.ts` exists, handles `class:paladin:divine-sense` / `class:paladin:channel-divinity`. Registered in `app.ts` line 295. Implements only Divine Sense (detect celestials/fiends/undead). Sacred Weapon (Oath of Devotion CD option) has no executor.
- **2024 rules:** Channel Divinity is gained at **L3**. ✓ (code is correct, row column placement is wrong)
- **Verdict:** **INCORRECT COLUMN PLACEMENT.** Channel Divinity should be in the **L3** column, not L2. The "PARTIAL" status is correct (only Divine Sense implemented). Move it to L3.

---

### 8. L3 — Sacred Oath MISSING
- **Claimed:** `Sacred Oath MISSING`
- **Code:**
  - `paladin.ts` lines 147–156 — `OathOfDevotionSubclass` shell definition: features `SACRED_WEAPON: 3`, `OATH_OF_DEVOTION_SPELLS: 3`. Comment: *"executor for Sacred Weapon Channel Divinity is deferred to Phase 3"*.
  - `feature-keys.ts` line 152 — `SACRED_WEAPON` key exists.
  - No executor for Sacred Weapon found anywhere in `executors/paladin/`.
  - No executor for "Turn the Unholy" found anywhere.
- **Verdict:** **CORRECT.** Sacred Oath is genuinely MISSING. Subclass shell exists but no executor. Oath of Devotion Spells feature key exists too but no spell-grant implementation.

---

### 9. L4 — ASI
- **Claimed:** `ASI` (no qualifier)
- **Code:** ASI is universally handled and not class-specific. Not explicitly listed in `paladin.ts` features map but this is standard across all classes.
- **Verdict:** **CORRECT.** Universal feature.

---

### 10. L4 — Divine Health ← UNIMPLEMENTED + WRONG LEVEL
- **Claimed:** `Divine Health` (no qualifier = implies implemented)
- **Code:**
  - **No feature key for `divine-health` anywhere in `feature-keys.ts`.**
  - `paladin.ts` features map: **Divine Health is absent entirely.**
  - No executor found. No disease-immunity check tied to Paladin level.
  - `conditions.ts` line 264 has generic `conditionImmunities: ['disease', 'poisoned']` for undead stat blocks — unrelated to Paladin.
- **2024 rules:** Divine Health (immunity to disease) is a **L3** feature per 2024 PHB, not L4. The row places it in L4 (wrong level AND unmarked when unimplemented).
- **Verdict:** **INCORRECT.** Should be `Divine Health MISSING` and placed in **L3** column (per 2024 rules), not L4. Zero implementation exists.

---

### 11. L5 — Extra Attack
- **Claimed:** `Extra Attack` (no qualifier)
- **Code:** `paladin.ts` line 173 — `"extra-attack": 5`. `capabilitiesForLevel()` line ~200 — pushes Extra Attack capability at level ≥ 5.
- **Verdict:** **CORRECT.**

---

### 12. L5 — Faithful Steed cross-flow ← MISSING, NOT CROSS-FLOW
- **Claimed:** `Faithful Steed cross-flow`
- **Code:**
  - Search for "faithful-steed", "faithful steed" → **zero matches anywhere in the codebase.**
  - Not in `paladin.ts` features map.
  - No feature key in `feature-keys.ts`.
  - No executor, no scenario, no mention anywhere.
- **2024 rules:** Faithful Steed (summon a spirit horse as a 2nd-level spell-like ability) is a **L5** feature.
- **Verdict:** **INCORRECT.** "cross-flow" implies it's handled elsewhere, but there is NO code anywhere. Should be `Faithful Steed MISSING`.

---

## Issues Summary

| # | Column | Feature | Current Claim | Verdict | Correct Claim |
|---|--------|---------|---------------|---------|---------------|
| 1 | L1 | Divine Sense | (omitted) | STALE/MISSING | `Divine Sense MISSING` (also misimplemented at L3 in code) |
| 2 | L2 | Channel Divinity | `Channel Divinity PARTIAL` | INCORRECT column | Move to L3: `Channel Divinity PARTIAL` |
| 3 | L4 | Divine Health | `Divine Health` (no qualifier) | INCORRECT | `Divine Health MISSING` (also wrong level — it's L3 in 2024) |
| 4 | L5 | Faithful Steed | `Faithful Steed cross-flow` | INCORRECT | `Faithful Steed MISSING` |

---

## Secondary Code Issues (Not Row Errors — Actual Code Bugs)

1. **Divine Sense at wrong level in code:** `paladin.ts` has `"divine-sense": 3`. Per 2024 rules it's L1. Also incorrectly modeled as a Channel Divinity sub-option — it should have its own resource pool and be a separate L1 feature.

2. **Divine Smite naming:** Code and row both use "Divine Smite" but 2024 renames it "Paladin's Smite" and classifies it as a spell. The functional implementation works but classification is stale — this is a deferred rework concern, not an urgent correctness bug.

3. **Sacred Weapon / Turn the Unholy not implemented:** Channel Divinity has 2 options at L3 for Devotion Paladin. Only Divine Sense (which is mislabeled as a CD option) is implemented. Sacred Weapon and Turn the Unholy are both missing.

---

## Proposed Row Edits

**File:** `plans/mechanics-and-coverage-report.md`

Old:
```
| **Paladin** | Spellcasting, Lay on Hands SUP, Weapon Mastery 2 | Fighting Style, Divine Smite PARTIAL (inline), Channel Divinity PARTIAL | Sacred Oath MISSING | ASI, Divine Health | Extra Attack, Faithful Steed cross-flow |
```

New:
```
| **Paladin** | Spellcasting, Lay on Hands SUP, Weapon Mastery 2, Divine Sense MISSING | Fighting Style, Divine Smite PARTIAL (inline) | Channel Divinity PARTIAL, Sacred Oath MISSING, Divine Health MISSING | ASI | Extra Attack, Faithful Steed MISSING |
```

Changes:
1. **L1:** add `Divine Sense MISSING` — omitted from row; 2024 L1 feature currently misimplemented as CD sub-option at L3
2. **L2:** remove `Channel Divinity PARTIAL` — wrong column
3. **L3:** add `Channel Divinity PARTIAL` (moved from L2) + `Divine Health MISSING` (2024 L3 feature, zero code)
4. **L4:** remove `Divine Health` (wrong level, missing status qualifier)
5. **L5:** `Faithful Steed cross-flow` → `Faithful Steed MISSING` (zero code, not delegated to another system)

---

## Risks

1. **Divine Sense resource pool confusion:** Changing Divine Sense from a CD sub-option to its own L1 feature pool requires touching `paladin.ts`, resource initialization, and `ChannelDivinityExecutor` scope — non-trivial refactor.

2. **Divine Smite reclassification:** Renaming to Paladin's Smite and treating as a spell would touch `PALADIN_COMBAT_TEXT_PROFILE`, `hit-rider-resolver.ts`, AI attack resolver, and potentially E2E scenarios. High blast radius.

3. **E2E scenario coverage:** `scenarios/class-combat/paladin/` has 3 scenarios (channel-divinity-smite-burst, party-aura-tank, smite-and-heal). `scenarios/paladin/` has 6 (aura-of-protection, bonus-action-spell-attack, divine-smite, lay-on-hands, scripted-multi-monster, smite-spell-kit). No scenario for Faithful Steed.

---

## Open Questions

1. Should Divine Sense's code misimplementation (placed under Channel Divinity at L3) be filed as a dedicated bug plan? It is a rule violation for 2024 and needs its own resource pool at L1.
2. "Faithful Steed" in 2024 is a castable ability (cast *Find Steed* for free). Should this be scoped under SpellSystem or ClassAbilities?
3. Should `Divine Smite` be formally flagged as REWORK (rename to "Paladin's Smite" + spell classification) now, or remain PARTIAL until a dedicated smite plan exists?
