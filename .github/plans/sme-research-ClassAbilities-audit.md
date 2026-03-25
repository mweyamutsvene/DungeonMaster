# SME Research — ClassAbilities Audit (D&D 5e 2024)

## Scope
Audit of all 12 class definitions against D&D 2024 rules. Focus: levels 1–5, combat-relevant features.
Files audited: `domain/entities/classes/*.ts`, `domain/abilities/`, `application/services/combat/abilities/executors/`.

---

## BARBARIAN — Well Implemented (Levels 1–7)

### Implemented
| Feature | Level | Domain | Executor | Profile | Resource | Feature Key |
|---------|-------|--------|----------|---------|----------|-------------|
| Rage | 1 | `barbarian.ts` (state, start/end, rest reset, damage bonus) | `RageExecutor` ✅ | `rage` mapping | `rage` pool | `RAGE` |
| Unarmored Defense | 1 | `barbarianUnarmoredDefenseAC()` | — (passive) | — | — | `UNARMORED_DEFENSE` |
| Reckless Attack | 2 | `barbarian.ts` | `RecklessAttackExecutor` ✅ | `reckless-attack` mapping | — | `RECKLESS_ATTACK` |
| Danger Sense | 2 | `isDangerSenseNegated()`, saving-throw-resolver | — (passive) | — | — | `DANGER_SENSE` |
| Extra Attack | 5 | — | — (ClassFeatureResolver) | — | — | `EXTRA_ATTACK` |
| Feral Instinct | 7 | Initiative advantage + anti-surprise | — (passive) | — | — | `FERAL_INSTINCT` |
| Rage end check | — | `shouldRageEnd()` | — | — | — | — |

### Missing
| Feature | Level | Severity | Notes |
|---------|-------|----------|-------|
| Weapon Mastery | 1 | **Important** | System exists in `weapon-mastery.ts` (2 weapons), but no `weapon-mastery` feature key in barbarian.features |
| Primal Knowledge | 2 | Nice-to-have | Skill proficiency swap — non-combat |
| Subclass (level 3) | 3 | **Important** | Path of Berserker, Wild Heart, World Tree — zero subclass support |
| Brutal Strike | 9 | Nice-to-have | Beyond scope, but missing entirely |

---

## CLERIC — Basic Implementation

### Implemented
| Feature | Level | Domain | Executor | Profile | Resource | Feature Key |
|---------|-------|--------|----------|---------|----------|-------------|
| Spellcasting | 1 | — | — (spell system) | — | — | `SPELLCASTING` |
| Channel Divinity | 2 | `clericChannelDivinityUsesForLevel()`, state mgmt | — | — | `channelDivinity` pool | `CHANNEL_DIVINITY` |
| Turn Undead | 2 | — | `TurnUndeadExecutor` ✅ | `turn-undead` mapping | spends CD | `TURN_UNDEAD` |

### Missing
| Feature | Level | Severity | Notes |
|---------|-------|----------|-------|
| Holy Order | 2 | Nice-to-have | Flavor/skill — non-combat |
| Divine Domain (subclass) | 3 | **Critical** | No subclass features at all — no domain spells, no domain-specific CD options |
| Destroy Undead | 5 | Important | Turn Undead upgrade — undead below CR threshold are destroyed |
| Searing Smite (free prep) | 5 | Nice-to-have | Auto-prepared spell at level 5 |
| capabilitiesForLevel | — | Nice-to-have | Exists but minimal — no domain-specific entries |

---

## FIGHTER — Well Implemented Core

### Implemented
| Feature | Level | Domain | Executor | Profile | Resource | Feature Key |
|---------|-------|--------|----------|---------|----------|-------------|
| Second Wind | 1 | State mgmt, rest reset | `SecondWindExecutor` ✅ | `second-wind` mapping | `secondWind` pool | `SECOND_WIND` |
| Action Surge | 2 | State mgmt, rest reset | `ActionSurgeExecutor` ✅ | `action-surge` mapping | `actionSurge` pool | `ACTION_SURGE` |
| Extra Attack | 5 | — | ClassFeatureResolver | — | — | `EXTRA_ATTACK` |
| 2 Extra Attacks | 11 | — | ClassFeatureResolver | — | — | `TWO_EXTRA_ATTACKS` |
| 3 Extra Attacks | 20 | — | ClassFeatureResolver | — | — | `THREE_EXTRA_ATTACKS` |
| Indomitable | 9 | capabilitiesForLevel display only | — | — | — | — |

### Missing
| Feature | Level | Severity | Notes |
|---------|-------|----------|-------|
| Fighting Style | 1 | **Important** | Defense (+1 AC), Dueling (+2 dmg), GWF, etc. — zero implementation |
| Weapon Mastery | 1 | **Important** | System in `weapon-mastery.ts` (3 weapons), no feature key in fighter.features |
| Tactical Mind | 2 | Nice-to-have | Add d10 to failed ability check — niche |
| Subclass (level 3) | 3 | **Important** | Champion (Improved Critical), Battle Master (maneuvers), Eldritch Knight — nothing |
| Indomitable (functional) | 9 | Nice-to-have | Displayed in caps but no executor/mechanic — reroll failed save |

---

## MONK — Best Implemented Class ⭐

### Implemented
| Feature | Level | Domain | Executor | Profile | Resource | Feature Key |
|---------|-------|--------|----------|---------|----------|-------------|
| Martial Arts | 1 | Die scaling, unarmed stats | `MartialArtsExecutor` ✅ | `martial-arts` mapping | — | `MARTIAL_ARTS` |
| Unarmored Defense | 1 | — (passive) | — | — | — | `UNARMORED_DEFENSE` |
| Ki (Focus Points) | 2 | State mgmt, rest reset | — | — | `ki` pool | — |
| Flurry of Blows | 2 | — | `FlurryOfBlowsExecutor` ✅ | Profile mapping | 1 ki | `FLURRY_OF_BLOWS` |
| Patient Defense | 2 | — | `PatientDefenseExecutor` ✅ | Profile mapping | 1 ki | `PATIENT_DEFENSE` |
| Step of the Wind | 2 | — (+ dash variant) | `StepOfTheWindExecutor` ✅ | Profile mapping | 1 ki | `STEP_OF_THE_WIND` |
| Uncanny Metabolism | 2 | `uncannyMetabolismUsesForLevel()` | — | — | `uncanny_metabolism` pool | `UNCANNY_METABOLISM` |
| Deflect Attacks | 3 | `DEFLECT_ATTACKS_REACTION` (full detection) | — (reaction handler) | attackReaction | reaction | `DEFLECT_ATTACKS` |
| Open Hand Technique | 3 | Enhancement (addle/push/topple) | — (enhancement handler) | attackEnhancement | flurry req | `OPEN_HAND_TECHNIQUE` |
| Stunning Strike | 5 | Enhancement (CON save) | — (enhancement handler) | attackEnhancement | 1 ki | `STUNNING_STRIKE` |
| Extra Attack | 5 | — | ClassFeatureResolver | — | — | `EXTRA_ATTACK` |
| Wholeness of Body | 6 | Uses = WIS mod | `WholenessOfBodyExecutor` ✅ | Profile mapping | pool | `WHOLENESS_OF_BODY` |

### Missing
| Feature | Level | Severity | Notes |
|---------|-------|----------|-------|
| Slow Fall | 4 | Nice-to-have | Reduce fall damage — rarely used in combat engine |
| Ki-Empowered Strikes | 6 | Nice-to-have | Unarmed = magical — primarily a resistance bypass |
| Evasion | 7 | Important | DEX save → 0 damage on success, half on fail. No feature key for monk |
| Stillness of Mind | 7 | Nice-to-have | End charmed/frightened — condition removal |

---

## PALADIN — Solid Core

### Implemented
| Feature | Level | Domain | Executor | Profile | Resource | Feature Key |
|---------|-------|--------|----------|---------|----------|-------------|
| Lay on Hands | 1 | Pool = 5×level, state mgmt | `LayOnHandsExecutor` ✅ | `lay-on-hands` mapping | `layOnHands` pool | `LAY_ON_HANDS` |
| Divine Smite | 2 | `divineSmiteDice()`, hit-rider in RollStateMachine | — (enhancement) | attackEnhancement | spell slot | `DIVINE_SMITE` |
| Channel Divinity | 3 | `paladinChannelDivinityUsesForLevel()` | — | — | `channelDivinity` pool | `CHANNEL_DIVINITY` |
| Extra Attack | 5 | — | ClassFeatureResolver | — | — | `EXTRA_ATTACK` |

### Missing
| Feature | Level | Severity | Notes |
|---------|-------|----------|-------|
| Spellcasting | 1 | **Critical** | D&D 2024 paladins get spellcasting at level 1. NO `spellcasting` feature key! |
| Fighting Style | 2 | Important | Defense, Dueling, GWF, Protection — not implemented |
| Weapon Mastery | 1 | Important | System exists (2 weapons per rules), no feature key |
| Sacred Oath (subclass) | 3 | **Important** | Oath of Devotion, Vengeance, Ancients — zero subclass |
| Aura of Protection | 6 | Important | +CHA mod to saves within 10ft — significant combat feature |

---

## ROGUE — Good Core, Missing 2024 Features

### Implemented
| Feature | Level | Domain | Executor | Profile | Resource | Feature Key |
|---------|-------|--------|----------|---------|----------|-------------|
| Sneak Attack | 1 | `sneakAttackDiceForLevel()`, `isSneakAttackEligible()` | — (auto in RollStateMachine) | — | turn tracking | `SNEAK_ATTACK` |
| Cunning Action | 2 | — | `CunningActionExecutor` ✅ | `cunning-action` mapping | — | `CUNNING_ACTION` |
| Uncanny Dodge | 5 | Feature key only | **NO EXECUTOR** ❌ | — | — | `UNCANNY_DODGE` |
| Evasion | 7 | Feature key only | **NO IMPLEMENTATION** ❌ | — | — | `EVASION` |

### Missing
| Feature | Level | Severity | Notes |
|---------|-------|----------|-------|
| Expertise | 1 | Nice-to-have | Double proficiency on 2 skills — skill check system |
| Weapon Mastery | 1 | Important | 2 weapons per D&D 2024, no feature key |
| Subclass (level 3) | 3 | Important | Thief (Fast Hands, Second-Story Work), Assassin, Arcane Trickster |
| Steady Aim | 3 | Nice-to-have | Bonus action → advantage on next attack (give up movement) |
| Cunning Strike | 5 | **Important** | D&D 2024 signature feature — trade sneak attack dice for effects (Poison, Trip, Withdraw) |
| Uncanny Dodge (functional) | 5 | **Critical** | Feature key exists but NO reaction handler or executor. Halves attack damage |
| Evasion (functional) | 7 | **Important** | Feature key exists but NO saving throw integration |

---

## WARLOCK — Minimal

### Implemented
| Feature | Level | Domain | Executor | Profile | Resource | Feature Key |
|---------|-------|--------|----------|---------|----------|-------------|
| Pact Magic | 1 | Slot level/count tables, short rest refresh | — | — | `pactMagic` pool | `PACT_MAGIC` |
| Hellish Rebuke | — | Damage reaction detection | — (reaction handler) | damageReaction | slot | — |

### Missing
| Feature | Level | Severity | Notes |
|---------|-------|----------|-------|
| Eldritch Invocations | 1 | **Critical** | Core warlock identity — Agonizing Blast, Repelling Blast, etc. |
| Patron (subclass) | 1 | **Important** | Fiend, Great Old One, Archfey — patron features at 1, 6, 10, 14 |
| Pact Boon | 3 | Important | Blade, Chain, Tome — significant combat features |
| Eldritch Blast cantrip handling | — | **Important** | Instructions mention mapping but code has NO action mappings |
| capabilitiesForLevel | — | Important | Not defined — tactical view shows nothing |
| No subclass support at all | — | **Critical** | |

---

## WIZARD — Reactions Well Done, Class Features Sparse

### Implemented
| Feature | Level | Domain | Executor | Profile | Resource | Feature Key |
|---------|-------|--------|----------|---------|----------|-------------|
| Spellcasting | 1 | — | — (spell system) | — | — | `SPELLCASTING` |
| Arcane Recovery | 1 | State mgmt, max slot levels | — (no executor) | — | `arcaneRecovery` pool | `ARCANE_RECOVERY` |
| Shield (reaction) | — | Attack reaction detection | — (reaction handler) | attackReaction | spell slot | — |
| Counterspell (reaction) | — | Spell reaction detection (60ft, CON save) | — (reaction handler) | spellReaction | lvl 3+ slot | — |
| Absorb Elements (reaction) | — | Damage reaction detection (elemental) | — (reaction handler) | damageReaction | lvl 1 slot | — |

### Missing
| Feature | Level | Severity | Notes |
|---------|-------|----------|-------|
| Arcane Recovery (executor) | 1 | Important | Domain state exists, no executor to activate during short rest |
| Ritual Casting | 1 | Nice-to-have | Cast spells with ritual tag without slots |
| Memorize/Prepare Spell | 1 | Nice-to-have | Spell preparation mechanics |
| School features (subclass) | 2 | Important | Abjuration Ward, Evocation's Sculpt Spells, etc. |
| capabilitiesForLevel | — | Nice-to-have | Not defined |

---

## PARTIALLY DEFINED CLASSES (No Combat Implementation)

### Bard
- **Definition**: ✅ `bard.ts` — hitDie, proficiencies, BardicInspiration resource pool (CHA-based), die scaling (d6→d12), Font of Inspiration at 5
- **Feature keys**: `SPELLCASTING`, `BARDIC_INSPIRATION`
- **Missing**: No combat text profile, no executor, no capabilitiesForLevel. **Severity: Not playable in combat**

### Druid
- **Definition**: ✅ `druid.ts` — hitDie, proficiencies, Wild Shape resource pool, CR limits by level
- **Feature keys**: `SPELLCASTING`, `WILD_SHAPE`
- **Missing**: No combat text profile, no executor, no capabilitiesForLevel. **Severity: Spellcasting works, Wild Shape does not**

### Ranger
- **Definition**: ⚠️ `ranger.ts` — MINIMAL: hitDie, proficiencies, only 2 feature keys (spellcasting at 2, extra-attack at 5)
- **Missing**: No resource pools, no combat text profile, no executor, no capabilitiesForLevel. **Severity: Barely defined**

### Sorcerer
- **Definition**: ✅ `sorcerer.ts` — hitDie, proficiencies, Sorcery Points resource pool, rest refresh
- **Feature keys**: `SPELLCASTING`, `SORCERY_POINTS`, `METAMAGIC`
- **Missing**: No combat text profile, no executor, no metamagic mechanics, no capabilitiesForLevel. **Severity: Spellcasting works, Metamagic does not**

---

## CROSS-CUTTING GAPS

| Gap | Severity | Notes |
|-----|----------|-------|
| **Weapon Mastery feature key** | Important | Rules system exists in `weapon-mastery.ts` with full property mapping. No class has `weapon-mastery` in its features map. Fighter/Barbarian/Paladin/Ranger/Rogue all should. |
| **Fighting Style** | Important | Zero implementation. Affects Fighter, Paladin, Ranger damage/AC. |
| **Subclass system** | **Critical** | Only Monk (Open Hand) has any subclass-gated logic (via executor guard). No general subclass framework. |
| **Uncanny Dodge** | **Critical** | Feature key exists but zero implementation — should be a reaction that halves damage. |
| **Evasion** | Important | Feature key exists for Rogue (and should exist for Monk 7) — zero saving-throw integration. |
| **capabilitiesForLevel** gaps | Nice-to-have | Warlock, Wizard, Bard, Druid, Ranger, Sorcerer all lack it — tactical view shows no abilities. |
| **Spellcasting for Paladin** | **Critical** | D&D 2024 Paladin gets spellcasting at level 1, but no `spellcasting` feature key. |

## IMPLEMENTATION PRIORITY (Top 10)

1. **Uncanny Dodge reaction** — Rogue feature key exists, no handler (Critical)
2. **Paladin spellcasting feature key** — missing from features map (Critical)
3. **Weapon Mastery feature keys** — system ready, just needs feature map entries (Important)
4. **Fighting Style system** — affects 3 martial classes (Important)
5. **Evasion** — saving throw modifier for Rogue 7 / Monk 7 (Important)
6. **Subclass framework** — needed for Champion, Battle Master, Path of Berserker, etc. (Important)
7. **Cunning Strike** — D&D 2024 Rogue signature at level 5 (Important)
8. **Destroy Undead** — Turn Undead upgrade at Cleric 5 (Important)
9. **Arcane Recovery executor** — domain state exists, no way to use it (Important)
10. **Warlock combat surface** — Eldritch Invocations, capabilitiesForLevel, Eldritch Blast (Critical for class)
