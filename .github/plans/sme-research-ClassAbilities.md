# ClassAbilities SME Audit — Deep Dive
*Date: 2026-03-26 | Full audit of all 12 class files, executors, feature keys, and profiles*

---

## Executive Summary

Total findings: **32** across all classes and cross-cutting concerns.
- **Critical (bugs / architectural violations):** 4
- **High (missing implemented features):** 10
- **Medium (gaps with clear priority):** 12
- **Low (nice-to-have / higher-level):** 6

---

## CRITICAL Findings

### C1 — Monk `restRefreshPolicy` missing `uncanny_metabolism` and `wholeness_of_body`
**File:** `packages/game-server/src/domain/entities/classes/monk.ts`  
**Lines:** `~130–134` (restRefreshPolicy array)

`getMonkResourcePools()` creates both `uncanny_metabolism` (1/long rest) and `wholeness_of_body` (WIS-mod/long rest) pools at combat start. However, `Monk.restRefreshPolicy` only declares `ki`:

```typescript
restRefreshPolicy: [
  { poolKey: "ki", refreshOn: "both", computeMax: (level) => kiPointsForLevel(level) },
  // Missing: uncanny_metabolism, wholeness_of_body
],
```

These pools will **never be refreshed** when a Monk takes a long rest via the rest system. Confirmed by checking `refreshClassResourcePools` consumes this policy.

**Fix:** Add two entries:
```typescript
{ poolKey: "uncanny_metabolism", refreshOn: "long", computeMax: (_level) => 1 },
{ poolKey: "wholeness_of_body", refreshOn: "long", computeMax: (level, mods) => wholenessOfBodyUsesForLevel(level, mods?.wisdom ?? 0) },
```

---

### C2 — Bard missing `resourcesAtLevel` — Bardic Inspiration never initialized at combat start
**File:** `packages/game-server/src/domain/entities/classes/bard.ts`

`buildCombatResources()` delegates to `classDef.resourcesAtLevel?.(level, abilityModifiers)`. Bard only defines `resourcePoolFactory`, **not** `resourcesAtLevel`. Since `buildCombatResources()` calls `resourcesAtLevel?.()` (note the `?`), Bard's Bardic Inspiration pool is **silently skipped** when a Bard character enters combat.

`Bard` has complete logic: `bardicInspirationUsesForLevel()`, `createBardicInspirationState()`, CHA-modifier pool sizing — but it's unreachable from the combat initialization path.

**Fix:** Add `resourcesAtLevel` that mirrors the `resourcePoolFactory`:
```typescript
resourcesAtLevel: (level, abilityModifiers) => {
  const chaMod = abilityModifiers?.charisma;
  if (chaMod === undefined) return [];
  return [createBardicInspirationState(level, chaMod).pool];
},
```

---

### C3 — Copilot instructions stale: warlock "eldritch blast action mapping" does not exist
**File:** `.github/copilot-instructions.md` line 214

Instructions state: `"warlock (warlock.ts): eldritch blast action mapping"`

Reality: `WARLOCK_COMBAT_TEXT_PROFILE.actionMappings = []` — completely empty. No eldritch blast mapping, no text parser, no executor. This may cause AI or future developers to assume the feature is implemented when it is not.

**Fix:** Update copilot instructions to read: `"warlock (warlock.ts): 0 action mappings + Hellish Rebuke damage reaction"` (which mirrors the Absorb Elements / Shield format used for other spell-reaction classes).

---

### C4 — `UNCANNY_DODGE` reaction uses raw string class check instead of `classHasFeature`
**File:** `packages/game-server/src/domain/entities/classes/rogue.ts` line ~120

```typescript
detect(input: AttackReactionInput): DetectedAttackReaction | null {
  if (input.className !== "rogue") return null; // raw string check
  if (input.level < 5) return null;
  ...
}
```

All other reactions (Deflect Attacks, Shield) use `input.resources` flags or level checks only. This one hardcodes `"rogue"` — a multiclass rogue/fighter at level 3 fighter / 5 rogue would fail if `className` resolves to the "primary" class rather than "rogue".

**Fix:** Replace with `classHasFeature(input.className, UNCANNY_DODGE, input.level)`.

---

## HIGH Priority Findings

### H1 — Monk `uncanny-metabolism` auto-trigger: no `restRefreshPolicy` race with level-up
**File:** `packages/game-server/src/application/services/combat/tabletop/rolls/initiative-handler.ts` lines 459–487

`InitiativeHandler` correctly auto-triggers Uncanny Metabolism at combat start (restores all ki + heals). **But** if a Monk levels up after a long rest (pool rebuilt at new level by `buildCombatResources`), the `uncanny_metabolism` pool current resets to `max` correctly. The critical issue is only the `restRefreshPolicy` gap (C1). Otherwise this is functioning.

**Status:** Dependent on C1 fix.

---

### H2 — Barbarian `Brutal Strike` entirely absent
**File:** `packages/game-server/src/domain/entities/classes/barbarian.ts` and `feature-keys.ts`

D&D 5e 2024 replaces *Brutal Critical* with **Brutal Strike** (level 9). When using Reckless Attack, the Barbarian can forgo advantage on one attack roll to gain an attack bonus (1d10 extra + effect choice). Completely unimplemented:
- No feature key in `feature-keys.ts`
- Not in `Barbarian.features` map  
- No executor in `executors/barbarian/`
- No text profile entry in `BARBARIAN_COMBAT_TEXT_PROFILE`

The legacy plan document (`sme-research-ClassAbilities-audit.md`) already flagged this as "Beyond scope, level 9+" — but for the record it's missing.

---

### H3 — Paladin `Aura of Protection` entirely absent (level 6)
**File:** `packages/game-server/src/domain/entities/classes/paladin.ts`

The most impactful Paladin feature: add CHA modifier to all saving throws for self and allies within 10 feet. Zero implementation:
- No feature key (`aura-of-protection`)
- Not in `Paladin.features` map
- Not mentioned in `capabilitiesForLevel`
- No executor

---

### H4 — Fighter `Indomitable` listed in `capabilitiesForLevel` but never implemented
**File:** `packages/game-server/src/domain/entities/classes/fighter.ts` line ~162

```typescript
if (level >= 9) {
  caps.push({ name: "Indomitable", economy: "free", cost: "1 use/long rest", 
    effect: "Reroll a failed saving throw" });
}
```

No `abilityId`, no feature key, no resource pool, no executor. The capability shows up in the tactical view but cannot be activated. Wrong — it should either have a full implementation or be removed from `capabilitiesForLevel`.

---

### H5 — Rogue `Cunning Action: Hide` returns NOT_IMPLEMENTED error
**File:** `packages/game-server/src/application/services/combat/abilities/executors/rogue/cunning-action-executor.ts` lines 104–106

```typescript
{
  summary: 'Hide action not yet implemented',
  error: 'NOT_IMPLEMENTED',
}
```

Hide as a Cunning Action is one of the three core uses (Dash/Disengage/Hide). A Rogue asking to hide via Cunning Action will receive a NOT_IMPLEMENTED error. The same stub exists in `NimbleEscapeExecutor` (monster).

---

### H6 — Evasion: feature key and map entry exist, but no DEX save integration
**Files:** `monk.ts` (features: `evasion: 7`), `rogue.ts` (features: `evasion: 7`)

Both have `EVASION` feature key constant and features map entries. The SavingThrowResolver presumably checks DEX saves for area effects — but there is no guard in the saving throw path that detects `EVASION` and converts "half damage failure" → "no damage success / half damage failure".

The feature is **declared** but **not enforced** in mechanics.

---

### H7 — Warlock missing features map and `capabilitiesForLevel`
**File:** `packages/game-server/src/domain/entities/classes/warlock.ts`

```typescript
features: {
  "pact-magic": 1,
  // Nothing else
},
```

Missing feature keys:
- `eldritch-invocations` (level 2) — Agonizing Blast, Repelling Blast, etc.
- `pact-boon` (level 3)
- No `capabilitiesForLevel` at all

The Warlock is treated as a pure spellcaster (Hellish Rebuke reaction only) with no class-specific combat abilities.

---

### H8 — Ranger minimal: no resources, no executors, no capabilities
**File:** `packages/game-server/src/domain/entities/classes/ranger.ts`

Ranger has only 4 feature keys (weapon-mastery, fighting-style, spellcasting, extra-attack). Missing:
- `Hunter's Mark` (level 1) — concentration damage bonus, entire bonusDmg loop
- `Favored Enemy` (level 1 — now Enemy Bane in 2024)
- No `resourcesAtLevel`, `restRefreshPolicy`, `capabilitiesForLevel`
- No combat text profile, no executors
- No profile in `COMBAT_TEXT_PROFILES` registry

Ranger is purely structural — it gets Extra Attack at 5 and Fighting Style at 2, but that's all.

---

### H9 — Bard missing combat profile, no executors, Bardic Inspiration unusable in combat
**File:** `packages/game-server/src/domain/entities/classes/bard.ts`

- Beyond C2 (combat start pool init gap), there's also no combat text profile → Bard can't use Bardic Inspiration via text command
- No executor for `class:bard:bardic-inspiration`
- Not registered in `COMBAT_TEXT_PROFILES` registry
- No `capabilitiesForLevel`

The Bard's only in-combat ability (Bardic Inspiration as a bonus action) is completely non-functional.

---

### H10 — Sorcerer: Sorcery Points pool tracked but no executors or Metamagic
**File:** `packages/game-server/src/domain/entities/classes/sorcerer.ts`

- `sorceryPointsForLevel()` and `createSorceryPointsState()` are implemented
- Features map: `sorcery-points: 2`, `metamagic: 2`
- No `capabilitiesForLevel`, no combat text profile, no executors
- Flexible Casting (convert spell slots ↔ sorcery points) not implemented
- Metamagic options (Twinned Spell, Quickened Spell, etc.) not implemented

---

## MEDIUM Priority Findings

### M1 — Druid: Wild Shape pool never executable in combat
**File:** `packages/game-server/src/domain/entities/classes/druid.ts`

Wild Shape pool is tracked (`wildShapeUsesForLevel`, `createWildShapeState`, `restRefreshPolicy`). But:
- No combat text profile → player can't say "wild shape into bear"
- No executor for `class:druid:wild-shape`
- No subclasses defined

The pool exists and refreshes correctly, but is entirely non-functional.

---

### M2 — Stale `capabilitiesForLevel` in `monk.ts` references `wholeness_of_body` from level 6 but the feature is Open Hand–gated
**File:** `packages/game-server/src/domain/entities/classes/monk.ts` line ~158

`capabilitiesForLevel` returns a Wholeness of Body entry for any Monk at level 6+, but Wholeness of Body requires the **Open Hand subclass**. The `WholenessOfBodyExecutor` already checks for this and rejects non-Open-Hand monks — but the tactical view will incorrectly suggest the ability is available to all monks.

---

### M3 — `wholeness_of_body` pool initialized for all Monks at level 6+, not just Open Hand
**File:** `packages/game-server/src/domain/entities/classes/monk.ts`, `getMonkResourcePools()`

```typescript
const wbUses = wholenessOfBodyUsesForLevel(level, wisdomModifier);
if (wbUses > 0) pools.push({ name: "wholeness_of_body", ... });
```

The pool is created for every level 6+ Monk regardless of subclass. The executor guards correctness at execution time, but it creates phantom pool entries in the tactical display for non-Open-Hand monks.

---

### M4 — Barbarian `Primal Knowledge` (level 10) and `Relentless Rage` (level 11) absent from features map
**File:** `packages/game-server/src/domain/entities/classes/barbarian.ts`

Beyond level 7 (Feral Instinct), `Barbarian.features` is empty. D&D 5e 2024 Barbarian progression is partially represented:
- Level 7: Feral Instinct ✅
- Level 9: Brutal Strike ❌ (see H2)
- Level 10: Relentless Rage ❌
- Level 10: Primal Knowledge ❌  
- Level 14: Persistent Rage ❌

---

### M5 — No feature key constants for important missing features
**File:** `packages/game-server/src/domain/entities/classes/feature-keys.ts`

Missing constants that would be needed to implement outstanding features:
```typescript
// Fighter
export const INDOMITABLE = "indomitable";

// Barbarian  
export const BRUTAL_STRIKE = "brutal-strike";
export const RELENTLESS_RAGE = "relentless-rage";

// Paladin
export const AURA_OF_PROTECTION = "aura-of-protection";
export const AURA_OF_COURAGE = "aura-of-courage";
export const IMPROVED_DIVINE_SMITE = "improved-divine-smite";

// Ranger
export const HUNTERS_MARK = "hunters-mark";
export const FAVORED_ENEMY = "favored-enemy";

// Warlock
export const ELDRITCH_INVOCATIONS = "eldritch-invocations";
export const PACT_BOON = "pact-boon";

// Bard
export const JACK_OF_ALL_TRADES = "jack-of-all-trades";
export const CUTTING_WORDS = "cutting-words"; // College of Lore reaction

// Sorcerer
export const FLEXIBLE_CASTING = "flexible-casting";
export const TWINNED_SPELL = "twinned-spell";
```

---

### M6 — Paladin `channel-divinity` uses are declared but no Channel Divinity ability action is exposed
**File:** `packages/game-server/src/domain/entities/classes/paladin.ts`

`Paladin.features` has `channel-divinity: 3` and the resource pool tracks uses. But:
- No Channel Divinity action executor (only Cleric has `TurnUndeadExecutor`)
- No oath-specific abilities in profile (Sacred Weapon, Sacred Flame, etc.)
- The `capabilitiesForLevel` has Channel Divinity entry but no `abilityId`

The pool is tracked and will drain only if an executor spends it. Currently nothing spends it.

---

### M7 — Warlock `pactMagic` pool doesn't use the spell slot naming convention
**File:** `packages/game-server/src/domain/entities/classes/warlock.ts`

Regular spell slots use the `spellSlot_N` naming convention (e.g., `spellSlot_1`). Warlock Pact Magic uses `pactMagic` (a single pool with variable level). The `SpellActionHandler` and `SpellSlotManager` in the spell system likely check `spellSlot_N` pools — Warlocks casting spells via Pact Magic may route through different code paths than expected.

---

### M8 — Cleric `clericChannelDivinityUsesForLevel` uses D&D 2024 number, comments say 2014
**File:** `packages/game-server/src/domain/entities/classes/cleric.ts`

```typescript
export function clericChannelDivinityUsesForLevel(level: number): number {
  if (level < 2) return 0;
  if (level < 6) return 2;  // D&D 2024: starts at 2 uses
  if (level < 18) return 3;
  return 4;
}
```

The code is correct for 2024 (starts at 2 uses at level 2). The comment structure implies this is intentional. However, Paladin's `paladinChannelDivinityUsesForLevel` starts at 1 use at level 3:
```typescript
if (level < 3) return 0;
if (level < 7) return 1; // 1 use at 3, 2 at 7, 3 at 18
```

Paladin and Cleric now share the `channelDivinity` pool key in their `restRefreshPolicy`, which could cause confusion in multiclass scenarios.

---

### M9 — Monk Deflect Attacks reaction only triggers on `className === "monk"` in detect()
**File:** `packages/game-server/src/domain/entities/classes/monk.ts`

The `DEFLECT_ATTACKS_REACTION.detect()` method explicitly checks:
```typescript
if (input.className !== "monk") return null;
```

Same raw-string anti-pattern as the Rogue Uncanny Dodge (C4). Should use `classHasFeature(input.className, DEFLECT_ATTACKS, input.level)`.

---

### M10 — `Warrior of the Open Hand` subclass profile not registered as a separate `combatTextProfile`
**File:** `packages/game-server/src/domain/entities/classes/monk.ts`

The `OpenHandSubclass` definition:
```typescript
export const OpenHandSubclass: SubclassDefinition = {
  id: "open-hand",
  name: "Way of the Open Hand",
  classId: "monk",
  features: { "open-hand-technique": 3 },
  // No combatTextProfile field
};
```

The `SubclassDefinition` interface supports an optional `combatTextProfile`. The Open Hand Technique `AttackEnhancementDef` lives in the base `MONK_COMBAT_TEXT_PROFILE`, but semantically it's a subclass feature. This works today because the main profile carries it, but if a non-Open-Hand Monk is playing, the enhancement is still in the profile and will be offered (then rejected by the executor). Moving it to a subclass profile would be more correct.

---

### M11 — Fighter `restRefreshPolicy` uses `refreshOn: "both"` for Action Surge
**File:** `packages/game-server/src/domain/entities/classes/fighter.ts`

```typescript
restRefreshPolicy: [
  { poolKey: "actionSurge", refreshOn: "both", ...},
  { poolKey: "secondWind", refreshOn: "both", ...},
],
```

D&D 5e 2024: Action Surge refreshes on **short or long rest** (same as 2014). `"both"` is correct. But Double-checking: Second Wind in 2024 **refreshes on short or long rest** too. This is confirmed correct — however note that under 2014 rules Second Wind only refreshed on short rest. The 2024 change is documented in the rules, but worth confirming this is intentional for 2024.

**Status:** Likely correct. Low risk.

---

### M12 — Missing `hasDangerSense` / `hasFeralInstinct` functions from barbarian.ts (lingering plan doc references)
**Files:** Archive plan docs and CLAUDE.md memory reference `hasDangerSense()` and `hasFeralInstinct()` as pure functions in `barbarian.ts`

Checking actual `barbarian.ts` code — these ARE defined:
```typescript
export function isDangerSenseNegated(conditions: string[]): boolean { ... }
```

But `hasDangerSense()` is not a function in barbarian.ts — it's implemented via `classHasFeature("barbarian", DANGER_SENSE, level)` in initiative-handler.ts. The plan docs' references to `hasDangerSense` and `hasFeralInstinct` as functions are stale. **No action needed**, just confirming the transition was completed.

---

## LOW Priority Findings

### L1 — Barbarian `BARBARIAN_COMBAT_TEXT_PROFILE` rage pattern too restrictive
**File:** `packages/game-server/src/domain/entities/classes/barbarian.ts`

```typescript
normalizedPatterns: [/^rage$|^userage$|^enterrage$/],
```

Only matches exact strings `rage`, `userage`, `enterrage` after normalization. Natural language like "I enter a rage" normalizes to `ienterarage` — no match. Compare to Monk's more flexible patterns.

---

### L2 — Fighter has no `capabilitiesForLevel` for Extra Attack variants (2 and 3 attacks)
**File:** `packages/game-server/src/domain/entities/classes/fighter.ts`

level 11 (three attacks) and level 20 (four attacks) are in the features map but not mentioned in `capabilitiesForLevel` — the capability at level 5 just says "Attack twice" without noting it upgrades.

---

### L3 — Sorcerer `restRefreshPolicy` uses `refreshOn: "long"` for sorcery points
**File:** `packages/game-server/src/domain/entities/classes/sorcerer.ts`

D&D 5e 2024: Sorcery Points refresh on long rest. Code: `refreshOn: "long"`. Correct. *(Just confirming.)*

---

### L4 — `Warlock.features` doesn't include `spellcasting`
**File:** `packages/game-server/src/domain/entities/classes/warlock.ts`

All other spellcasting classes (Wizard, Cleric, Paladin, Bard, Sorcerer, Druid) have `"spellcasting": 1` in their features map. Warlock has `"pact-magic": 1` but not `"spellcasting": 1`. This inconsistency means `classHasFeature("warlock", SPELLCASTING, level)` returns `false` for Warlocks.

---

### L5 — Paladin `lay-on-hands` in `capabilitiesForLevel` shows `amount: 5` as fixed cost
**File:** `packages/game-server/src/domain/entities/classes/paladin.ts`

```typescript
resourceCost: { pool: "layOnHands", amount: 5 },
```

Actually Lay on Hands can restore **any amount** (1+ HP), not always 5. The cost represents "minimum 5 HP from pool" for the AI/tactical view, but the executor itself heals as much as possible. This could mislead the AI into only ever healing in 5 HP increments.

---

### L6 — Monk `step-of-the-wind-dash` text profile entry lacks feature key
**File:** `packages/game-server/src/domain/entities/classes/monk.ts` line ~199

The text profile has two Step of the Wind variants:
- `step-of-the-wind-dash` → `class:monk:step-of-the-wind-dash`
- `step-of-the-wind` → `class:monk:step-of-the-wind`

But `Monk.features` only has `"step-of-the-wind": 2`. The `-dash` variant's ability ID has no corresponding features map entry and no separate `StepOfTheWindDashExecutor` — the executor for the base step resolves the dash variant based on context. The mapping works, but the `class:monk:step-of-the-wind-dash` ability ID is "orphaned" from the features map perspective.

---

## Summary Table

| ID | Class | Finding | Priority |
|----|-------|---------|---------|
| C1 | Monk | `restRefreshPolicy` missing `uncanny_metabolism`+`wholeness_of_body` | **CRITICAL** |
| C2 | Bard | Missing `resourcesAtLevel` — Bardic Inspiration not initialized at combat start | **CRITICAL** |
| C3 | Docs | Copilot instructions claim Warlock has eldritch-blast mapping (it doesn't) | **CRITICAL** |
| C4 | Rogue | `UNCANNY_DODGE` reaction uses raw string class check, not `classHasFeature` | **CRITICAL** |
| H1 | Monk | Uncanny Metabolism auto-trigger depends on C1 fix | HIGH |
| H2 | Barbarian | Brutal Strike (level 9) entirely absent | HIGH |
| H3 | Paladin | Aura of Protection (level 6) entirely absent | HIGH |
| H4 | Fighter | Indomitable listed in capabilities but has no feature key or executor | HIGH |
| H5 | Rogue | Cunning Action: Hide returns NOT_IMPLEMENTED | HIGH |
| H6 | Monk+Rogue | Evasion declared in feature map but not enforced in saving throw resolution | HIGH |
| H7 | Warlock | No features map beyond pact-magic, no `capabilitiesForLevel` | HIGH |
| H8 | Ranger | Minimal stub only — no resources, no executors, no capabilities | HIGH |
| H9 | Bard | No combat profile, no executors — Bardic Inspiration unusable in combat | HIGH |
| H10 | Sorcerer | Sorcery points tracked but no executors or Metamagic | HIGH |
| M1 | Druid | Wild Shape pool tracked but not executable | MEDIUM |
| M2 | Monk | `capabilitiesForLevel` shows Wholeness of Body for all level 6+ monks, not just Open Hand | MEDIUM |
| M3 | Monk | `wholeness_of_body` pool initialized for all level 6+ monks regardless of subclass | MEDIUM |
| M4 | Barbarian | Post-level-7 features not in features map | MEDIUM |
| M5 | All | Missing feature key constants for unimplemented features | MEDIUM |
| M6 | Paladin | Channel Divinity pool tracked but no ability action exposed | MEDIUM |
| M7 | Warlock | `pactMagic` pool name doesn't follow `spellSlot_N` convention | MEDIUM |
| M8 | Cleric | Cleric CD uses different scale than Paladin CD; pool key collision risk in multiclass | MEDIUM |
| M9 | Monk | Deflect Attacks reaction uses raw string `className === "monk"` check | MEDIUM |
| M10 | Monk | Open Hand Technique enhancement in base profile, should be in subclass profile | MEDIUM |
| M11 | Fighter | Action Surge `refreshOn: "both"` — correct for 2024 but worth confirming | MEDIUM |
| M12 | Barbarian | Stale plan doc references to `hasDangerSense()`/`hasFeralInstinct()` as functions | MEDIUM |
| L1 | Barbarian | Rage text pattern too strict for natural language | LOW |
| L2 | Fighter | Extra Attack count not reflected in `capabilitiesForLevel` upgrade path | LOW |
| L3 | Sorcerer | Sorcery points long-rest refresh — confirmed correct | LOW |
| L4 | Warlock | Missing `"spellcasting": 1` feature (uses `pact-magic` instead) | LOW |
| L5 | Paladin | Lay on Hands `resourceCost.amount: 5` misleads AI (always heals 5, not max) | LOW |
| L6 | Monk | `step-of-the-wind-dash` ability ID has no features map entry | LOW |

---

## Files With No Issues

- `class-definition.ts` — well-structured, no gaps
- `class-feature-resolver.ts` — correctly trimmed to computed-value methods only
- `combat-text-profile.ts` — complete, well-typed, all three reaction subtypes present
- `registry.ts` — correct, picks up subclass profiles via loop
- `feature-keys.ts` — complete for currently implemented features (see M5 for additions needed)
- `fighting-style.ts` — correct, maps styles to feat IDs
- `FlurryOfBlowsExecutor`, `PatientDefenseExecutor`, `StepOfTheWindExecutor`, `MartialArtsExecutor` — all correctly implemented
- `RageExecutor`, `RecklessAttackExecutor` — correct, use ActiveEffects properly
- `ActionSurgeExecutor`, `SecondWindExecutor` — correct
- `LayOnHandsExecutor` — correct (see L5 for minor tactical view concern)
- `TurnUndeadExecutor` — correct, delegates AoE resolution to action dispatcher
- `NimbleEscapeExecutor` — correct except Hide stub (see H5)
