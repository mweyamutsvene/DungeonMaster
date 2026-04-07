# SpellSystem Deep Dive Audit Report

**Auditor**: SpellSystem SME
**Date**: 2025-04-06
**Scope**: All spell system files — delivery handlers, catalog, concentration, slot management, spell-casting rules, reaction handlers, saving throw resolver

---

## 1. Spell Delivery Modes — Implementation Status

### Implemented (5 + 1 fallback)
| Handler | Status | Notes |
|---------|--------|-------|
| `SpellAttackDeliveryHandler` | ✅ Complete | Fire Bolt, Guiding Bolt, Inflict Wounds, Scorching Ray. Cantrip scaling + upcast scaling. |
| `HealingSpellDeliveryHandler` | ✅ Complete | Single target + AoE healing. Revival from 0 HP. Bonus action tracking. |
| `SaveSpellDeliveryHandler` | ✅ Complete | Single target + AoE. Cover bonus, Evasion, damage defenses, half-on-save, forced movement. |
| `ZoneSpellDeliveryHandler` | ✅ Complete | Aura + placed zones. Concentration cleanup integrated. |
| `BuffDebuffSpellDeliveryHandler` | ✅ Complete | Self/target/allies/enemies routing. ActiveEffect creation. |
| Inline Simple (Magic Missile) | ✅ Complete | Custom dart-counting logic with upcast. |

### Missing Delivery Modes

| Missing Mode | Severity | D&D 5e 2024 Rule Reference | Details |
|-------------|----------|---------------------------|---------|
| **Teleportation spells** | **Medium** | Misty Step, Dimension Door, Thunder Step | Misty Step is in catalog but has NO delivery fields (`isBonusAction` only). Falls through to generic "simple" fallback — no actual teleportation happens. No position update, no mechanical effect. |
| **Summoning spells** | **Low** | Conjure Animals, Spirit Guardians (the summon variant) | Not in scope for Basic Rules but worth noting. |
| **Dispel Magic delivery** | **Medium** | PHB p.234 | In catalog but has NO mechanical fields. Falls through to generic fallback — doesn't actually remove effects/concentration from target. |
| **Absorb Elements delivery** | **Medium** | PHB, reaction spell | In catalog but has NO effects/damage fields. Falls through to generic fallback — doesn't grant resistance or add damage to next melee attack. |
| **Mage Armor delivery** | **Medium** | PHB p.256 | In catalog but has NO effects fields. Falls through to generic fallback — doesn't modify AC. |

**Finding F1**: Several spells exist in the catalog with metadata (school, components, description) but lack the mechanical fields needed for any delivery handler to process them. They silently fall through to the generic fallback, which only marks the action as spent and produces a message. **No mechanical effect is applied.**

**Affected spells**: Misty Step, Dispel Magic, Absorb Elements, Mage Armor, Shield (reaction only, handled separately), Booming Blade (partially — catalog entry exists but no melee-weapon-attack-plus-effect delivery mode).

**Severity**: **CRITICAL** for Misty Step (players expect teleportation); **Medium** for others.

---

## 2. Spell Catalog Completeness

### Current State
| Level | Count | Spells |
|-------|-------|--------|
| Cantrips | 8 | Eldritch Blast, Fire Bolt, Produce Flame, Sacred Flame, Ray of Frost, Toll the Dead, Chill Touch, Booming Blade |
| Level 1 | 17 | Absorb Elements, Bless, Burning Hands, Cause Fear, Cure Wounds, Guiding Bolt, Healing Word, Hellish Rebuke, Heroism, Inflict Wounds, Longstrider, Mage Armor, Magic Missile, Shield, Shield of Faith, Thunderwave, Thunderous Ward |
| Level 2 | 8 | Cloud of Daggers, Hold Person, Misty Step, Moonbeam, Scorching Ray, Shatter, Spike Growth, Spiritual Weapon |
| Level 3 | 5 | Counterspell, Dispel Magic, Fireball, Revivify, Spirit Guardians |
| Level 4+ | 0 | None |
| **Total** | **38** | |

### D&D 5e 2024 Basic Rules Spell Coverage Gaps

The Basic Rules include approximately 80-100 spells. Notable missing spells:

**Critical Missing (commonly used)**:
| Spell | Level | Why Critical |
|-------|-------|-------------|
| Detect Magic | 1 | Most commonly cast ritual spell |
| Command | 1 | Core Cleric spell, single target WIS save |
| Faerie Fire | 1 | Advantage-granting AoE (in Bard/Druid lists) |
| Hunter's Mark | 1 | Core Ranger spell, bonus action concentration |
| Hex | 1 | Core Warlock spell, bonus action concentration |
| Sleep | 1 | Unique HP-pool mechanic |
| Aid | 2 | Max HP boost, common preparation |
| Darkness | 2 | Common tactical spell |
| Invisibility | 2 | Core utility spell |
| Lesser Restoration | 2 | Condition removal |
| Silence | 2 | Key anti-caster zone |
| Web | 2 | Classic control zone (mentioned in zone handler comments but not in catalog) |
| Haste | 3 | Iconic buff, major combat impact |
| Slow | 3 | Iconic debuff |
| Lightning Bolt | 3 | Classic AoE damage |
| Fly | 3 | Core mobility buff |
| Remove Curse | 3 | Condition/curse removal |

**Severity**: **Medium** overall — the catalog covers the most critical combat spells. Gaps are primarily in utility/control spells.

---

## 3. Concentration Mechanics Audit

### What's Implemented ✅
| Feature | Status | Location |
|---------|--------|----------|
| Concentration tracking (`concentrationSpellName` in resources) | ✅ | `spell-slot-manager.ts` |
| One concentration spell at a time (old spell broken when new one cast) | ✅ | `prepareSpellCast()` |
| Concentration check on damage (`max(10, floor(damage/2))`) | ✅ | `domain/rules/concentration.ts` |
| CON save with War Caster advantage | ✅ | `concentrationSaveRollMode()` |
| Break concentration removes effects from all combatants | ✅ | `concentration-helper.ts` |
| Break concentration removes zones from map | ✅ | `concentration-helper.ts` |
| Conditions that break concentration (Incapacitated, Paralyzed, Petrified, Stunned, Unconscious) | ✅ | `isConcentrationBreakingCondition()` |
| Auto-break on condition applied (via SavingThrowResolver) | ✅ | `saving-throw-resolver.ts` L267-271 |

### Concentration Issues Found

| # | Issue | Severity | D&D 5e 2024 Reference |
|---|-------|----------|----------------------|
| C1 | **No concentration check when damage comes from zone effects** — Zone start-of-turn damage and movement-through-zone damage may not trigger concentration checks on the damaged creature. This needs verification of whether the zone damage processing path calls the concentration check. | **Medium** | PHB: "Whenever you take damage while concentrating, you must make a CON save" |
| C2 | **Concentration state lives in resources bag as loose keys** — `concentrationSpellName` is a string field in the JSON resources blob. No type safety, easy to miss in bulk resource operations. | **Low** | Architecture concern |
| C3 | **Death (3 failures) doesn't explicitly break concentration** — The code checks for Unconscious condition breaking concentration, but a creature that dies from death save failures may not have the Unconscious condition re-checked. However, they would already be unconscious at 0 HP, so this is likely handled. Needs verification. | **Low** | PHB: "Concentration ends if you die" |

---

## 4. Spell Slot Management Audit

### What's Implemented ✅
| Feature | Status | Location |
|---------|--------|----------|
| Standard spell slot spending (`spellSlot_N` pools) | ✅ | `spell-slot-manager.ts` |
| Pact Magic fallback (warlock) | ✅ | `spell-slot-manager.ts` |
| Pact slot level validation | ✅ | `spell-slot-manager.ts` |
| Full caster slot progression (levels 1-20) | ✅ | `spell-progression.ts` |
| Half caster slot progression (levels 1-20) | ✅ | `spell-progression.ts` |
| Warlock pact magic progression (levels 1-20) | ✅ | `spell-progression.ts` |
| Upcast validation (castAtLevel >= spellLevel, <= 9) | ✅ | `spell-action-handler.ts` + `spell-slot-manager.ts` |
| Slot recovery on long rest | ✅ | `domain/rules/rest.ts` |
| Pact slot recovery on short rest | ✅ | `domain/rules/rest.ts` + test |
| Cantrip: no slot cost | ✅ | `prepareSpellCast()` returns early for level 0 |
| Bonus action spell restriction (D&D 5e 2024) | ✅ | `spell-action-handler.ts` |

### Spell Slot Issues Found

| # | Issue | Severity | D&D 5e 2024 Reference |
|---|-------|----------|----------------------|
| S1 | **Duplicate upcast validation** — `castAtLevel` is validated in BOTH `SpellActionHandler.handleCastSpell()` (lines 107-117) AND `prepareSpellCast()` (lines 142-148). Same checks, different error messages. Should be in one place. | **Low** | Code quality |
| S2 | **Slot spending happens before Counterspell resolution** — If a spell is counterspelled, the caster's slot is still consumed. This is actually correct per D&D 5e 2024 rules ("the spell fails and the slot is not expended" — wait, Counterspell says the TARGET's slot isn't expended if counter succeeds). The code has a subtlety: slot is consumed on cast ATTEMPT. Need to check if the counterspelled caster gets slot back. Looking at the code, I see the slot IS consumed (line ~157 in spell-action-handler.ts) even when going through the counterspell path. **This is INCORRECT** — D&D 5e 2024 Counterspell says the countered spell fails and its slot IS expended (you attempted to cast it). Actually, re-reading: the TRIGGERING creature's spell fails. So the caster's slot IS spent. **This is CORRECT after all.** | N/A | Confirmed correct |
| S3 | **Arcane Recovery (Wizard) not implemented** — Wizards should recover some spell slots on short rest (levels 1-5 slots, total levels = ceil(wizard level / 2)). | **Medium** | PHB 2024: Wizard "Arcane Recovery" feature |

---

## 5. Missing Spell Features

### Ritual Casting
| # | Issue | Severity | Details |
|---|-------|----------|---------|
| R1 | **Ritual casting not implemented** | **Medium** | `CanonicalSpell` has a `ritual?: boolean` field in the type definition, but NO spells in the catalog set it to `true`. The casting pipeline has NO ritual casting path — no 10-minute cast time, no "cast without spending a slot" logic. Detect Magic, Identify, Comprehend Languages are all ritual-eligible. Impact: Low in combat (rituals take 10 minutes), but missing for completeness. |

### Spell-Specific Mechanics Not Implemented

| # | Spell | Issue | Severity |
|---|-------|-------|----------|
| M1 | **Guiding Bolt** | Catalog defines damage correctly but does NOT grant advantage on next attack against the target. Missing `effects` field for advantage-on-next-attack. | **Medium** |
| M2 | **Toll the Dead** | Should deal d12 instead of d8 if target is already damaged. Catalog hard-codes d8. No conditional dice logic. | **Low** |
| M3 | **Ray of Frost** | Should reduce target speed by 10 feet until start of caster's next turn. No speed reduction effect in catalog. | **Low** |
| M4 | **Chill Touch** | Should prevent target from regaining HP until end of caster's next turn. No healing prevention effect. | **Low** |
| M5 | **Sacred Flame** | Target gains no benefit from cover. Cover bonus is still applied in save resolution path. | **Medium** |
| M6 | **Eldritch Blast** | Multi-beam mechanics not implemented. At levels 5/11/17, creates additional beams (separate attack rolls). Currently scales like a regular cantrip (extra dice). Comment in catalog acknowledges this. | **Medium** |
| M7 | **Scorching Ray** | Multi-ray mechanics not implemented. Should be 3 separate attack rolls at base, +1 ray per upcast level. Currently treated as single attack. | **Medium** |
| M8 | **Thunderwave** | Should push creatures 10 feet on failed save. The save-spell-delivery-handler supports push via `outcome.movement.push` but Thunderwave's catalog entry doesn't include movement data. | **Medium** |
| M9 | **Revivify** | Defined as healing spell with 0d0+1. This routes to HealingSpellDeliveryHandler which will heal 1 HP. But Revivify specifically requires the target to have died within 1 minute and costs 300GP diamond. No death-timing or component-consumption validation. | **Low** |
| M10 | **Hold Person** | Catalog has `saveAbility` + `conditions` but NO `effects` for end-of-turn save repeat. The condition is applied but never re-checked. Target stays Paralyzed forever (until concentration ends). | **CRITICAL** |
| M11 | **Cause Fear** | Same issue as Hold Person — condition applied on failed save but no end-of-turn save to escape. | **Medium** |
| M12 | **Inflict Wounds** | Catalog defines it as `saveAbility: 'constitution'` with half damage on save. But in D&D 5e 2024, Inflict Wounds is a **melee spell attack** (not a saving throw). Should have `attackType: 'melee_spell'` instead. | **CRITICAL** |
| M13 | **Spiritual Weapon** | Catalog has `concentration: true` but D&D 5e 2024 Spiritual Weapon does NOT require concentration. Also missing the "bonus action on subsequent turns to move + attack" mechanic. | **Medium** |
| M14 | **Heroism** | Placeholder value of 0 for temp HP. Comment says "actual value is caster's spellcasting ability modifier" but nothing fills this in at cast time. | **Medium** |

### Component Enforcement
| # | Issue | Severity | Details |
|---|-------|----------|---------|
| CE1 | **Components stored but never enforced** | **Medium** | `CanonicalSpell.components` has V/S/M fields. The `conditions.ts` models `cannotSpeak: boolean` on condition effects. But the spell-casting pipeline NEVER checks: (a) whether the caster can speak (verbal), (b) whether the caster has a free hand (somatic), (c) whether the caster has the material component in inventory. A Silenced or Stunned creature can still cast verbal spells. |
| CE2 | **Material component consumption not tracked** | **Low** | Revivify's "300GP diamond, consumed" is a string in the catalog. No inventory deduction happens. |

---

## 6. Code Quality / Architecture Issues

| # | Issue | Severity | Location |
|---|-------|----------|----------|
| A1 | **SpellCastingContext uses `any` for 4 fields** | **Low** | `spell-delivery-handler.ts` — `sheet: any`, `characters: any[]`, `actor: any`, `encounter: any`, `combatants: any[]`, `actorCombatant: any`. Six `any` types. Should use proper interfaces. |
| A2 | **Magic Missile is hardcoded inline** | **Low** | `spell-action-handler.ts` L310-360 — Magic Missile has custom inline logic instead of a proper delivery handler or catalog-driven approach. The Phase 4 TODO comments in the catalog acknowledge this (`autoHit: true`, `dartCount: 3`). |
| A3 | **Duplicate encounter context fetching** | **Low** | `spell-action-handler.ts` calls `resolveEncounterContext()` multiple times in the same method (lines 128, 238, 275, 312). Could be consolidated. |
| A4 | **canHandle() on HealingSpellDeliveryHandler depends on diceRoller** | **Low** | `spell.healing && this.handlerDeps.deps.diceRoller` — the diceRoller check is an infrastructure concern leaking into the routing decision. If diceRoller is null (no-dice mode), healing spells fall through to generic. |
| A5 | **No validation that target is in range** | **Medium** | None of the delivery handlers check if the target is within the spell's declared `range` field. A caster can target anyone in the encounter regardless of distance. |
| A6 | **Zone saveDC not populated from caster** | **Medium** | `ZoneSpellDeliveryHandler` creates zones from the `SpellZoneDeclaration` but zone effects have `saveDC` as optional. For spells like Spirit Guardians, the `saveDC` on the zone effect should be the caster's spell save DC, but the catalog entry doesn't set it (by design — comment says "filled in at cast time"). However, I don't see where the cast-time fill-in happens. Zone effects may have undefined saveDC. |

---

## 7. E2E Test Scenario Coverage

### Covered Scenarios (wizard/ folder)
| Scenario | Tests |
|----------|-------|
| `cast.json` | Basic spell casting flow |
| `cantrip-scaling.json` | Fire Bolt damage scaling at level 5 |
| `spell-attacks.json` | Spell attack rolls |
| `spell-slots.json` | Slot spending/depletion |
| `upcast-spell.json` | Upcasting mechanics |
| `concentration.json` | CON save on damage, concentration replacement |
| `counterspell.json` | Two-phase counterspell reaction |
| `aoe-burning-hands.json` | AoE save spell with cone geometry |
| `shield-reaction.json` | Shield spell as reaction |
| `absorb-elements.json` | Absorb Elements reaction |

### Missing Scenario Coverage
| Missing | Priority |
|---------|----------|
| Healing spell (Cure Wounds / Healing Word) | **High** |
| AoE healing (Mass Cure Wounds) | Medium |
| Zone spell (Spirit Guardians / Spike Growth) | **High** |
| Buff spell (Bless applying effects to allies) | **High** |
| Hold Person (save-based condition + repeat saves) | **High** |
| Bonus action spell restriction enforcement | Medium |
| Pact Magic slot usage (Warlock) | Medium |
| Concentration broken by condition (Stunned/Paralyzed) | Medium |

---

## 8. Summary of Findings by Severity

### CRITICAL (2)
1. **M10 — Hold Person / Cause Fear: No end-of-turn save repeat** — Conditions applied by save spells with `conditions.onFailure` have no mechanism to re-check saves at end of the affected creature's turn. Target stays Paralyzed/Frightened until concentration drops. D&D 5e 2024: "At the end of each of its turns, the target repeats the save."
2. **M12 — Inflict Wounds misclassified** — Defined as CON save spell but is actually a melee spell attack in D&D 5e 2024.

### MEDIUM (14)
3. **F1** — Misty Step, Dispel Magic, Absorb Elements, Mage Armor all lack mechanical delivery fields (no effect applied).
4. **M1** — Guiding Bolt missing advantage-on-next-attack effect.
5. **M5** — Sacred Flame should ignore cover.
6. **M6** — Eldritch Blast multi-beam not implemented.
7. **M7** — Scorching Ray multi-ray not implemented.
8. **M8** — Thunderwave missing push-on-fail.
9. **M13** — Spiritual Weapon incorrectly requires concentration.
10. **M14** — Heroism temp HP placeholder never filled.
11. **S3** — Arcane Recovery (Wizard short rest slot recovery) not implemented.
12. **CE1** — Spell components stored but never enforced.
13. **A5** — No range validation on spell targets.
14. **A6** — Zone spell saveDC not populated from caster at cast time.
15. **C1** — Zone damage may not trigger concentration checks.
16. **R1** — Ritual casting not implemented.

### LOW (9)
17. **M2** — Toll the Dead d12 vs d8.
18. **M3** — Ray of Frost speed reduction.
19. **M4** — Chill Touch healing prevention.
20. **M9** — Revivify no death-timing/component validation.
21. **M11** — Cause Fear no repeat save.
22. **S1** — Duplicate upcast validation.
23. **A1** — `any` types in SpellCastingContext.
24. **A2** — Magic Missile hardcoded inline.
25. **A3** — Duplicate encounter context fetching.

---

## 9. Recommendations

### Immediate (should fix before more spells are added)
1. **Fix Inflict Wounds classification** — Change from `saveAbility: 'constitution'` to `attackType: 'melee_spell'` with proper damage dice.
2. **Implement end-of-turn save repeats** — This is a foundational mechanic needed for Hold Person, Cause Fear, and many future spells. Likely requires a `turnEndSaveRepeat` field on `PreparedSpellDefinition` and a turn-end processing step.
3. **Add mechanical fields to skeleton catalog entries** — Misty Step (position teleport), Mage Armor (AC buff effect), Absorb Elements (resistance + melee damage boost).

### Short-term (next sprint)
4. **Zone saveDC population** — Fill in saveDC from caster's spell save DC at zone creation time.
5. **Guiding Bolt advantage effect** — Add an `effects` field granting advantage on next attack.
6. **Thunderwave push** — Add movement data to the catalog save outcome or the pending action system.
7. **Spiritual Weapon concentration fix** — Remove `concentration: true`.

### Medium-term
8. **Multi-beam/multi-ray delivery mode** — Eldritch Blast and Scorching Ray need a new delivery pattern or adapter for multiple independent attack rolls.
9. **Spell component enforcement** — Check `cannotSpeak` condition before allowing verbal spells.
10. **Range validation** — Use spell range + position data to validate targeting.
11. **Expand catalog** — Add missing Basic Rules spells (Faerie Fire, Hex, Hunter's Mark, Web, Haste, Slow, etc.).
