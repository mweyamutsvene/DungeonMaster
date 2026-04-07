# ClassAbilities SME Audit — Deep Dive (UPDATED)
*Date: 2026-04-06 | Supersedes 2026-03-26 audit. Verified against current source.*

---

## Changes Since Last Audit (2026-03-26)

Items from the previous audit that are now **RESOLVED**:
- ~~C1 Monk restRefreshPolicy~~ → FIXED: now includes `uncanny_metabolism` and `wholeness_of_body`
- ~~C2 Bard missing resourcesAtLevel~~ → FIXED: `resourcesAtLevel` now present with CHA modifier support
- ~~C3 Warlock eldritch blast mapping~~ → FIXED: `WARLOCK_COMBAT_TEXT_PROFILE` now has eldritch-blast actionMapping (but still NO executor)
- ~~C4 Uncanny Dodge raw string check~~ → FIXED: now uses `classHasFeature(input.className, UNCANNY_DODGE, input.level)`
- ~~H3 Paladin Aura of Protection absent~~ → PARTIALLY FIXED: feature key, features map entry, domain functions (`getAuraOfProtectionRange`, `computeAuraSaveBonus`), capabilitiesForLevel all present. `combat-service.ts` consumes it for saving throw bonuses.
- ~~H4 Fighter Indomitable~~ → FIXED: feature key `INDOMITABLE`, features map `"indomitable": 9`, resource pool `createIndomitableState`, `IndomitableExecutor` registered in app.ts, capabilitiesForLevel with abilityId
- ~~H6 Evasion not enforced~~ → FIXED: `domain/rules/evasion.ts` has `applyEvasion()` and `creatureHasEvasion()`, consumed in ai-spell-delivery, damage-reaction-handler, move-reaction-handler
- ~~H7 Warlock missing capabilitiesForLevel~~ → FIXED: Warlock now has `capabilitiesForLevel` (Pact Magic, Eldritch Invocations, Pact Boon)
- ~~H8 Ranger no capabilities~~ → PARTIALLY FIXED: Ranger now has `capabilitiesForLevel` (Favored Enemy, Weapon Mastery, Fighting Style, Spellcasting, Extra Attack)
- ~~H9 Bard no profile~~ → FIXED: `BARD_COMBAT_TEXT_PROFILE` now registered with `bardic-inspiration` mapping
- ~~H10 Sorcerer no profile~~ → FIXED: `SORCERER_COMBAT_TEXT_PROFILE` now registered with `quickened-spell` and `twinned-spell` mappings
- ~~M1 Druid no profile~~ → FIXED: `DRUID_COMBAT_TEXT_PROFILE` now registered with `wild-shape` mapping
- ~~M9 Monk Deflect Attacks raw string~~ → FIXED: now uses `classHasFeature(input.className, DEFLECT_ATTACKS, input.level)`
- ~~M12 Stale plan doc references~~ → Resolved: migration to `classHasFeature()` complete

---

## Executive Summary (Current State)

Total **active** findings: **27**
- **Critical (runtime failures / missing execution path):** 6
- **High (significant feature gaps for implemented classes):** 6
- **Medium (incomplete implementations or data gaps):** 10
- **Low (non-blocking quality / accuracy issues):** 5

---

## CRITICAL Findings

### C1 — 6 text profile action mappings → non-existent executors (RUNTIME FAILURE)

These classes have `ClassCombatTextProfile.actionMappings` that route to ability IDs with **no registered executor** in `app.ts`. If a player or AI text input matches, the parser chain matches → `AbilityRegistry.execute()` → `UNREGISTERED_ABILITY` error.

| Class | Ability ID in profile | Category | Impact |
|-------|----------------------|----------|--------|
| **Warlock** | `class:warlock:eldritch-blast` | classAction | Core Warlock attack cantrip fails on text parse |
| **Bard** | `class:bard:bardic-inspiration` | bonusAction | Core Bard ability fails on text parse |
| **Druid** | `class:druid:wild-shape` | bonusAction | Core Druid ability fails on text parse |
| **Ranger** | `class:ranger:hunters-mark` | bonusAction | Core Ranger ability fails on text parse |
| **Sorcerer** | `class:sorcerer:quickened-spell` | bonusAction | Metamagic fails on text parse |
| **Sorcerer** | `class:sorcerer:twinned-spell` | classAction | Metamagic fails on text parse |

**Files**: [warlock.ts](packages/game-server/src/domain/entities/classes/warlock.ts), [bard.ts](packages/game-server/src/domain/entities/classes/bard.ts), [druid.ts](packages/game-server/src/domain/entities/classes/druid.ts), [ranger.ts](packages/game-server/src/domain/entities/classes/ranger.ts), [sorcerer.ts](packages/game-server/src/domain/entities/classes/sorcerer.ts)

**Registered executors** (15 total in [app.ts](packages/game-server/src/infrastructure/api/app.ts#L237-L251)):
ActionSurge, Indomitable, SecondWind, NimbleEscape, CunningAction, OffhandAttack, FlurryOfBlows, PatientDefense, StepOfTheWind, MartialArts, WholenessOfBody, Rage, RecklessAttack, LayOnHands, TurnUndead

**Fix options**:
1. Create stub executors that return clear "not yet implemented" messages (safe, minimal)
2. Remove mappings until executors are built (breaks text parsing for these actions entirely)
3. Implement full executors (significant effort per class)

---

### C2 — Berserker Frenzy: subclass feature defined, feature key defined, NO executor or text mapping

**File**: [barbarian.ts](packages/game-server/src/domain/entities/classes/barbarian.ts#L138-L143)

`BerserkerSubclass.features` has `"frenzy": 3`. `FRENZY` constant exists in [feature-keys.ts](packages/game-server/src/domain/entities/classes/feature-keys.ts#L18). `classHasFeature("barbarian", FRENZY, 3, "berserker")` returns true in tests.

**But**: No executor, no text profile mapping, no `capabilitiesForLevel` entry. A Berserker Barbarian at level 3+ has this subclass feature gated and tested but **cannot use it in combat**.

D&D 5e 2024 Frenzy: While raging, make one extra melee weapon attack as bonus action. Significant combat power for Berserkers.

**Severity**: Critical — it's a core subclass combat feature that was structurally set up but never wired.

---

## HIGH Findings

### H1 — Barbarian Brutal Strike: domain functions exist, not wired to combat

**File**: [barbarian.ts](packages/game-server/src/domain/entities/classes/barbarian.ts#L82-L104)

Domain layer is complete:
- `BRUTAL_STRIKE` feature key ✅
- `"brutal-strike": 9` in features map ✅
- `canUseBrutalStrike(isRaging, usedRecklessAttack)` pure function ✅
- `getBrutalStrikeBonusDice(weaponDamageDice)` pure function ✅
- Listed in `capabilitiesForLevel` at level 9 ✅
- Unit tests for all domain functions ✅

**Missing**: No `AttackEnhancementDef` in `BARBARIAN_COMBAT_TEXT_PROFILE`, no executor, no text mapping. The domain code is dead code. In D&D 5e 2024, Brutal Strike (level 9) is the primary Barbarian combat upgrade — extra weapon die + choice of Forceful Blow/Hamstring Blow/Staggering Blow.

---

### H2 — Rogue Cunning Action: Hide returns NOT_IMPLEMENTED

**File**: [cunning-action-executor.ts](packages/game-server/src/application/services/combat/abilities/executors/rogue/cunning-action-executor.ts#L105-L106)

```typescript
summary: 'Hide action not yet implemented',
error: 'NOT_IMPLEMENTED',
```

Dash and Disengage work. Hide is one of the three core Cunning Action uses. The Hidden condition is important for Sneak Attack eligibility (advantage from being hidden).

---

### H3 — Wizard has NO capabilitiesForLevel

**File**: [wizard.ts](packages/game-server/src/domain/entities/classes/wizard.ts)

Wizard is the only implemented spellcasting class without `capabilitiesForLevel()`. The AI/tactical view shows NO wizard-specific capabilities. Should at minimum list:
- Arcane Recovery (level 1) — restore spell slots on short rest
- The three reaction spells (Shield, Counterspell, Absorb Elements) as passive indicators

All other implemented classes WITH capabilities: Fighter, Monk, Rogue, Barbarian, Paladin, Cleric, Warlock, Bard, Druid, Sorcerer, Ranger.

---

### H4 — Wholeness of Body pool + capability shown for ALL monks, not just Open Hand

**Files**: [monk.ts](packages/game-server/src/domain/entities/classes/monk.ts) — `getMonkResourcePools()` and `capabilitiesForLevel()`

`getMonkResourcePools()` creates `wholeness_of_body` pool for ANY level 6+ Monk. `capabilitiesForLevel()` advertises it for any level 6+ Monk. But Wholeness of Body is an **Open Hand subclass feature** (D&D 5e 2024).

The `WholenessOfBodyExecutor` correctly rejects non-Open-Hand monks at execution time, but:
1. Phantom resource pool in tactical display
2. AI may waste actions trying to use it on non-Open-Hand monks
3. Wrong capability list in tactical view

---

### H5 — Ranger has no resource pools, no restRefreshPolicy

**File**: [ranger.ts](packages/game-server/src/domain/entities/classes/ranger.ts)

Missing: `resourcesAtLevel`, `resourcePoolFactory`, `restRefreshPolicy`. While Ranger has no dedicated resource pools in D&D 5e 2024 (relying on spell slots), concrete abilities like Hunter's Mark concentration would benefit from tracking. More importantly, if subclasses (Hunter, Beast Master) are added, they'll need resource pools.

---

### H6 — 12+ feature strings in class definitions not in feature-keys.ts

Feature map entries using raw strings instead of constants from [feature-keys.ts](packages/game-server/src/domain/entities/classes/feature-keys.ts). No compile-time safety; typos are silent bugs.

| Raw string | Class/Subclass | Should be constant |
|-----------|---------------|-------------------|
| `"jack-of-all-trades"` | Bard | `JACK_OF_ALL_TRADES` |
| `"font-of-inspiration"` | Bard | `FONT_OF_INSPIRATION` |
| `"countercharm"` | Bard | `COUNTERCHARM` |
| `"eldritch-invocations"` | Warlock | `ELDRITCH_INVOCATIONS` |
| `"pact-boon"` | Warlock | `PACT_BOON` |
| `"favored-enemy"` | Ranger | `FAVORED_ENEMY` |
| `"remarkable-athlete"` | Champion | `REMARKABLE_ATHLETE` |
| `"additional-fighting-style"` | Champion | `ADDITIONAL_FIGHTING_STYLE` |
| `"second-story-work"` | Thief | `SECOND_STORY_WORK` |
| `"supreme-sneak"` | Thief | `SUPREME_SNEAK` |
| `"mindless-rage"` | Berserker | `MINDLESS_RAGE` |
| `"intimidating-presence"` | Berserker | `INTIMIDATING_PRESENCE` |

---

## MEDIUM Findings

### M1 — Paladin Channel Divinity pool tracked but nothing spends it

**File**: [paladin.ts](packages/game-server/src/domain/entities/classes/paladin.ts)

Pool exists, refreshes on short rest. `capabilitiesForLevel` lists "Channel Divinity" at level 3 but with no `abilityId`. No Paladin Oath abilities consume it. No executor. The pool is dead weight.

---

### M2 — LayOnHandsExecutor only heals self, not allies

**File**: [lay-on-hands-executor.ts](packages/game-server/src/application/services/combat/abilities/executors/paladin/lay-on-hands-executor.ts)

```typescript
const currentHP = actor.getCurrentHP();
const maxHP = actor.getMaxHP();
```

Always operates on `context.actor` (self). D&D 5e 2024 Lay on Hands: "As a Bonus Action, you touch a willing creature (which can be yourself)..." Should support `context.target` parameter for healing allies.

---

### M3 — Warlock pactMagic pool name doesn't follow spellSlot_N convention

**File**: [warlock.ts](packages/game-server/src/domain/entities/classes/warlock.ts)

Regular casters use `spellSlot_1`, `spellSlot_2`, etc. Warlock uses `pactMagic` (single pool). This divergence means spell system code checking `spellSlot_N` pools won't find Warlock's slots. The `buildCombatResources` tracks `pactSlotLevel` separately, but spell delivery handlers may not correctly consume Pact Magic.

---

### M4 — Paladin/Cleric Channel Divinity naming collision

**Files**: [paladin.ts](packages/game-server/src/domain/entities/classes/paladin.ts), [cleric.ts](packages/game-server/src/domain/entities/classes/cleric.ts)

Both export identical function names: `ChannelDivinityState`, `createChannelDivinityState`, `spendChannelDivinity`, `resetChannelDivinityOnShortRest`. The barrel [index.ts](packages/game-server/src/domain/entities/classes/index.ts) uses namespace imports to avoid collision, but direct imports from either file would shadow the other. Multiclass Paladin/Cleric would share a `channelDivinity` pool key with different max-uses formulas.

---

### M5 — Barbarian rage text pattern too restrictive

**File**: [barbarian.ts](packages/game-server/src/domain/entities/classes/barbarian.ts)

```typescript
normalizedPatterns: [/^rage$|^userage$|^enterrage$/],
```

Uses start/end anchors (`^...$`) requiring exact match after normalization. "I want to rage" → `iwanttorage` → no match. "activate rage" → `activaterage` → no match. Compare Monk's flurry pattern which uses partial matching with lookbehind.

---

### M6 — Open Hand Technique enhancement in base Monk profile, not subclass profile

**File**: [monk.ts](packages/game-server/src/domain/entities/classes/monk.ts)

The OHT `AttackEnhancementDef` with `requiresSubclass: "open-hand"` lives in `MONK_COMBAT_TEXT_PROFILE`. `matchAttackEnhancements()` filters by subclass, so it works. But architecturally, the `SubclassDefinition` supports `combatTextProfile`, and the `OpenHandSubclass` doesn't use it. If a second Monk subclass is added with its own enhancement, it would also need to share the base profile. Moving OHT to a subclass profile would be cleaner.

---

### M7 — Warlock missing `spellcasting` in features map

**File**: [warlock.ts](packages/game-server/src/domain/entities/classes/warlock.ts)

Every other spellcasting class has `"spellcasting": 1` in features map. Warlock only has `"pact-magic": 1`. `classHasFeature("warlock", SPELLCASTING, level)` returns `false`. Any generic "does this creature have spellcasting?" check would miss Warlocks.

---

### M8 — Barbarian missing post-level-9 features in features map

**File**: [barbarian.ts](packages/game-server/src/domain/entities/classes/barbarian.ts)

D&D 5e 2024 Barbarian level progression features not in map:
- Level 11: Relentless Rage (drop to 0 HP while raging → CON save to stay at 1 HP)
- Level 15: Persistent Rage (rage doesn't end early)
- Level 18: Indomitable Might (STR checks can't roll below STR score)
- Level 20: Primal Champion (+4 STR and CON)

---

### M9 — Cleric missing Destroy Undead upgrade (level 5)

**File**: [cleric.ts](packages/game-server/src/domain/entities/classes/cleric.ts)

Turn Undead is implemented via `TurnUndeadExecutor`. But D&D 5e 2024 upgrades this at level 5: **Destroy Undead** — when an Undead fails the Turn save and has CR below a threshold, it is instantly destroyed. Threshold increases with cleric level. Not in features map, not in executor logic.

---

### M10 — NimbleEscapeExecutor TODO for creature-type validation

**File**: [nimble-escape-executor.ts](packages/game-server/src/application/services/combat/abilities/executors/monster/nimble-escape-executor.ts#L7)

```
TODO: Add creature-type validation once monsters have a trait/feature system
```

Low-risk since it only affects monster ability validation (goblins, etc.), but it means any creature can currently activate Nimble Escape without having the Goblin trait.

---

## LOW Findings

### L1 — Fighter Extra Attack upgrade not in capabilitiesForLevel

**File**: [fighter.ts](packages/game-server/src/domain/entities/classes/fighter.ts)

Level 5 capability says "Attack twice per Attack action." At level 11 (3 attacks) and 20 (4 attacks), no updated capability entry appears. The `features` map correctly tracks `TWO_EXTRA_ATTACKS` and `THREE_EXTRA_ATTACKS`, and `ClassFeatureResolver.getAttacksPerAction()` returns the right number. Only the display in capabilities is missing.

---

### L2 — Paladin Lay on Hands resourceCost.amount: 5 misleads AI

**File**: [paladin.ts](packages/game-server/src/domain/entities/classes/paladin.ts)

```typescript
resourceCost: { pool: "layOnHands", amount: 5 },
```

Lay on Hands can heal any amount (1+ HP at a time). This fixed `amount: 5` in the capability makes the AI think it costs exactly 5 HP per use. The executor actually heals `min(missingHP, poolRemaining)`.

---

### L3 — Monk step-of-the-wind-dash ability ID has no features map entry

**File**: [monk.ts](packages/game-server/src/domain/entities/classes/monk.ts)

The `class:monk:step-of-the-wind-dash` mapping works because `StepOfTheWindExecutor` handles both variants. But the ability ID is "orphaned" from the features map — `classHasFeature("monk", "step-of-the-wind-dash", level)` would return false.

---

### L4 — Rogue Steady Aim missing (D&D 5e 2024 level 3 option)

D&D 5e 2024 Optional Rule: As a bonus action, trade all remaining movement for advantage on next attack roll. Very combat-relevant for Rogues (enables Sneak Attack without ally adjacency). Not in features map, no text mapping, no executor. Lower priority since it's an optional rule.

---

### L5 — Warlock features map missing higher-level entries

**File**: [warlock.ts](packages/game-server/src/domain/entities/classes/warlock.ts)

Features map only has 3 entries up to level 3. D&D 5e 2024 Warlock features:
- Level 9: Contact Patron
- Level 11: Mystic Arcanum
- Level 20: Eldritch Master

Low priority since these are higher-level features unlikely to appear in typical play.

---

## Summary Table

| ID | Class | Finding | Priority |
|----|-------|---------|---------|
| C1 | All | 6 text profile action mappings → non-existent executors (RUNTIME FAILURE) | **CRITICAL** |
| C2 | Barbarian | Berserker Frenzy: subclass feature wired, no executor or text mapping | **CRITICAL** |
| H1 | Barbarian | Brutal Strike domain functions exist but not wired to combat | HIGH |
| H2 | Rogue | Cunning Action: Hide returns NOT_IMPLEMENTED | HIGH |
| H3 | Wizard | No capabilitiesForLevel — AI/tactical blind to wizard abilities | HIGH |
| H4 | Monk | Wholeness of Body pool + capability shown for ALL monks, not just Open Hand | HIGH |
| H5 | Ranger | No resource pools, no restRefreshPolicy | HIGH |
| H6 | All | 12+ feature strings in class definitions not in feature-keys.ts | HIGH |
| M1 | Paladin | Channel Divinity pool tracked but nothing spends it | MEDIUM |
| M2 | Paladin | LayOnHandsExecutor only heals self, not allies | MEDIUM |
| M3 | Warlock | pactMagic pool name diverges from spellSlot_N convention | MEDIUM |
| M4 | Paladin/Cleric | Channel Divinity naming collision in exports | MEDIUM |
| M5 | Barbarian | Rage text pattern too restrictive (anchored) | MEDIUM |
| M6 | Monk | Open Hand Technique enhancement in base profile, not subclass profile | MEDIUM |
| M7 | Warlock | Missing `spellcasting` in features map | MEDIUM |
| M8 | Barbarian | Missing post-level-9 features in features map | MEDIUM |
| M9 | Cleric | Missing Destroy Undead upgrade (level 5) | MEDIUM |
| M10 | Monster | NimbleEscapeExecutor TODO: creature-type validation | MEDIUM |
| L1 | Fighter | Extra Attack upgrade display missing in capabilitiesForLevel | LOW |
| L2 | Paladin | Lay on Hands resourceCost misleads AI | LOW |
| L3 | Monk | step-of-the-wind-dash ability ID orphaned from features map | LOW |
| L4 | Rogue | Steady Aim missing (optional 2024 rule) | LOW |
| L5 | Warlock | Missing higher-level features in map | LOW |

---

## Class Implementation Status Overview

| Class | Definition | Features Map | Resource Pools | Executors | Text Profile | Reactions | capabilitiesForLevel | Subclasses | Overall |
|-------|-----------|-------------|---------------|-----------|-------------|-----------|---------------------|-----------|---------|
| **Fighter** | ✅ | ✅ Complete | ✅ 3 pools | ✅ 3 (AS/SW/Ind) | ✅ 3 mappings | — | ✅ | Champion ✅ | **Strong** |
| **Monk** | ✅ | ✅ Complete | ✅ 3 pools | ✅ 5 (Flurry/PD/SotW/MA/WoB) | ✅ 6 mappings | ✅ Deflect | ✅ | Open Hand ✅ | **Strong** |
| **Rogue** | ✅ | ✅ | — | ✅ 1 (CA, partial) | ✅ 1 mapping | ✅ Uncanny Dodge | ✅ | Thief ✅ | **Good** (Hide missing) |
| **Barbarian** | ✅ | ⚠️ Incomplete >9 | ✅ 1 pool | ✅ 2 (Rage/RA) | ✅ 2 mappings | — | ✅ | Berserker ⚠️ | **Good** (Brutal Strike, Frenzy needed) |
| **Wizard** | ✅ | ⚠️ Sparse | ✅ 1 pool | — | ✅ (empty actions) | ✅ Shield/AE/CS | ❌ | — | **Moderate** (reactions strong, no capabilities) |
| **Warlock** | ✅ | ⚠️ Sparse | ✅ 1 pool | — | ⚠️ EB→no executor | ✅ Hellish Rebuke | ✅ | — | **Moderate** (reaction strong, actions broken) |
| **Paladin** | ✅ | ✅ | ✅ 2 pools | ✅ 1 (LoH) | ✅ 1 mapping + Smite enh | — | ✅ | — | **Good** (CD pool orphaned) |
| **Cleric** | ✅ | ✅ | ✅ 1 pool | ✅ 1 (TU) | ✅ 1 mapping | — | ✅ | — | **Good** (Destroy Undead missing) |
| **Bard** | ✅ | ✅ | ✅ 1 pool | ❌ 0 | ⚠️ BI→no executor | — | ✅ | — | **Skeleton** (profile wired, no executor) |
| **Druid** | ✅ | ⚠️ Sparse | ✅ 1 pool | ❌ 0 | ⚠️ WS→no executor | — | ✅ | — | **Skeleton** (profile wired, no executor) |
| **Ranger** | ✅ | ⚠️ Minimal | ❌ 0 | ❌ 0 | ⚠️ HM→no executor | — | ✅ | — | **Skeleton** (minimal definition) |
| **Sorcerer** | ✅ | ✅ | ✅ 1 pool | ❌ 0 | ⚠️ 2→no executor | — | ✅ | — | **Skeleton** (pool tracked, no executors) |

---

## Files Confirmed Clean (No Issues)

- `class-definition.ts` — well-structured, `SubclassDefinition` interface complete
- `class-feature-resolver.ts` — correctly trimmed to computed-value methods only, `hasOpenHandTechnique()` uses subclass framework
- `combat-text-profile.ts` — complete, all three reaction subtypes (attack/damage/spell), pure detection functions, `AttackEnhancementDef` with trigger/subclass/bonus-action gates
- `registry.ts` — lazy-init avoids TDZ, subclass profiles collected via loop, `classHasFeature` normalizes classId, all 12 classes registered
- `fighting-style.ts` — correct, maps styles to feat IDs, type-safe
- `combat-resource-builder.ts` — correctly delegates to `resourcesAtLevel`, computes ability modifiers, tracks prepared spells + feats
- `executor-helpers.ts` — clean guards: requireActor/Sheet/Resources/ClassFeature + extractClassInfo
- `ability-registry.ts` — correct, returns `UNREGISTERED_ABILITY` for missing executors
- All 5 Monk executors — well-implemented with dual-mode (AI/tabletop) support
- Both Barbarian executors — correct, using ActiveEffects system
- Fighter executors (ActionSurge, SecondWind, Indomitable) — correct
- `subclass-framework.test.ts` — comprehensive tests for Champion, Berserker, Thief, Open Hand
- `LayOnHandsExecutor` — correct (see L5 for minor tactical view concern)
- `TurnUndeadExecutor` — correct, delegates AoE resolution to action dispatcher
- `NimbleEscapeExecutor` — correct except Hide stub (see H5)
