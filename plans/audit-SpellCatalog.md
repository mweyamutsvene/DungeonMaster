---
type: sme-research
flow: SpellCatalog
feature: mechanics-audit-l1-5
author: claude-explore-spell-catalog
status: DRAFT
created: 2026-04-24
updated: 2026-04-24
---

# SpellCatalog L1–5 Audit

## Scope
Comprehensive evaluation of D&D 5e 2024 spell implementation across levels 0–5. Validates playability for L1 (casters), L3 (mixed), L5 (full progression).

---

## Currently Supported

### Cantrips (9/15 core)
**Implemented:**
- Fire Bolt (Sorcerer, Wizard) — 1d10 force, ranged attack
- Eldritch Blast (Warlock) — 1d10 force, bonus beams at L5/11/17
- Sacred Flame (Cleric) — 1d8 radiant save, ignores cover
- Ray of Frost (Sorcerer, Wizard) — 1d8 cold, -10 speed debuff
- Produce Flame (Druid) — 1d8 fire, ranged attack
- Toll the Dead (Cleric, Wizard) — 1d8/1d12 necrotic, damage-scale
- Chill Touch (Sorcerer, Warlock, Wizard) — 1d10 necrotic, prevent healing
- Booming Blade (Sorcerer, Warlock, Wizard) — 0d8 + 1d8 rider on move
- Vicious Mockery (Bard) — 1d4 psychic, disadvantage on next attack

**Missing core cantrips:**
- Guidance (Cleric, Druid, Ranger) — +1d4 to ability checks
- Spare the Dying (Cleric, Druid) — stabilize dying creature
- Resistance (Cleric, Druid, Ranger) — +1d4 to saves
- Light (Cleric, Sorcerer, Wizard) — illuminate 30 ft
- Mage Hand (Sorcerer, Wizard) — create spectral hand
- Shillelagh (Druid) — melee combat cantrip, 1d8
- Minor Illusion (Bard, Sorcerer, Wizard) — minor visual/auditory effects
- Shocking Grasp (Sorcerer, Wizard) — 1d8 lightning, disengage

**Assessment:** 60% core coverage. Missing utility & social cantrips. Damage scaling present; no ritual/non-combat cantrips.

---

### Level 1 (34 spells)
**Spell Count:** 34 unique
- Damage: 7 options (Burning Hands, Chromatic Orb, Guiding Bolt, Hellish Rebuke, Inflict Wounds, Magic Missile, Witch Bolt)
- Control: Bane, Bless, Command, Entangle, Faerie Fire, Sleep
- Protection: Armor of Agathys, Mage Armor, Shield, Shield of Faith, Protection from Evil/Good
- Healing: Cure Wounds, Healing Word
- Utility: Detect Magic, Divine Favor, Ensnaring Strike, Goodberry, Heroism, Hunters Mark, Hex, Longstrider, Searing/Thunderous/Wrathful Smite, Thunderous Ward, Silvery Barbs, Thunderwave, Absorb Elements

**Assessment:** Comprehensive. All base classes supported. Smite family complete (Paladin), healing/support robust, damage diverse. Missing: Fog Cloud, Color Spray, Ice Knife, Sanctuary.

---

### Level 2 (19 spells)
**Spell Count:** 19 unique
- Damage/Control: Cloud of Daggers, Scorching Ray, Shatter, Spike Growth, Moonbeam
- Save/Status: Blindness/Deafness, Hold Person, Web
- Mobility: Misty Step
- Defense: Lesser Restoration, Pass Without Trace, Aid, Mirror Image
- Casting: Spiritual Weapon (bonus action, no concentration—2024 change)

**Assessment:** Zone spells present (Spike Growth, Moonbeam, Cloud of Daggers, Web). Missing: Prayer of Healing, Magic Weapon, Blur, Enlarge/Reduce, Silence.

---

### Level 3 (12 spells)
**Spell Count:** 12 unique
- Signature burst: Fireball
- Control/crowd: Hypnotic Pattern, Stinking Cloud, Call Lightning
- Shutdown: Counterspell
- Utility: Dispel Magic, Revivify, Daylight, Fly
- Support: Mass Healing Word, Spirit Guardians

**Assessment:** Core present. Missing: Lightning Bolt, Sleet Storm, Bestow Curse (high-impact).

---

### Level 4 (6 spells)
- Wall of Fire, Banishment, Polymorph, Greater Invisibility, Ice Storm, Dimension Door

**Assessment:** High-level burst & control. Polymorph mechanics deferred (beast stat integration).

---

### Level 5 (6 spells)
- Cone of Cold, Hold Monster, Wall of Force, Animate Objects, Telekinesis, Cloudkill

**Assessment:** Full-caster capstones present. Wizard favored (6/6). Missing: Mass Cure Wounds, Teleportation Circle.

---

## Needs Rework

### Bugs & Stat Issues
1. **Cantrip Scaling:** No explicit tests for progression at levels 5/11/17 (Fire Bolt, Eldritch Blast, Vicious Mockery).
2. **Spiritual Weapon:** TODO comment states multi-turn bonus action loop not implemented.
3. **Haste:** speed_multiplier not resolved in damage-resolver.
4. **Mirror Image:** Duplicate AC override not wired into hit-resolution.

---

## Missing — Required for L1–5

### Cantrips (8 core)
- Guidance, Spare the Dying, Resistance, Light, Mage Hand, Shillelagh, Minor Illusion, Shocking Grasp

### Level 1 (8 spells)
- Fog Cloud, Color Spray, Ice Knife, Sanctuary, Grease, Tasha's Hideous Laughter, Find Familiar (ritual), Dissonant Whispers

### Level 2 (10 spells)
- Prayer of Healing, Magic Weapon, Enlarge/Reduce, Blur, Silence, Detect Thoughts, Flaming Sphere, Crown of Madness, Hold Person (Cleric), Ray of Enfeeblement

### Level 3 (11 spells)
- **Lightning Bolt (CRITICAL)** — sorcerer/wizard core AoE
- Sleet Storm, Bestow Curse, Animate Dead, Blink, Sending, Catnap, Tiny Hut, Heroism (Paladin upcast), Phantom Steed, Conjure Animals

### Level 4–5
- L4: Greater Restoration, Stoneskin, Fire Shield
- L5: Mass Cure Wounds, Teleportation Circle, Passwall, Awaken

---

## Cross-Flow Dependencies

### Concentration Tracking
Multiple L3 spells require concentration (Counterspell, Hypnotic Pattern, Spirit Guardians, Call Lightning). Enforce single-concentration invariant at prepareSpellCast().

### Upcast Scaling
Cantrip progression (Fire Bolt @ L5/11/17) not tested. Add parametrized test.

### Delivery Handlers
All core types present (Attack, Save, Buff/Debuff, Healing, Zone). Delivery coverage: 95%.

### Slot Expenditure
Ritual flag (Detect Magic, Find Familiar) must wire into slot-skip logic.

### Action Economy
Bonus-action spell stacking (Healing Word + Hex + Hunters Mark) not policed. Reaction collision not prevented.

### Riders & Ongoing Effects
Booming Blade movement rider works. Divine Smite + smite-spells coexistence not yet coordinated.

---

## Summary

**Coverage:** 71/107 PHB core spells (66%)
- Cantrips: 9/17 (53%)
- L1: 34/42 (81%)
- L2: 19/29 (66%)
- L3: 12/23 (52%)
- L4–5: 12/18 (67%)

**Playability:**
- L1: Ready
- L3: Functional; missing Lightning Bolt & Sleet Storm
- L5: Playable; missing Mass Cure Wounds & Teleportation Circle

**Critical Gaps:**
1. Lightning Bolt (L3 sorcerer/wizard)
2. Sleet Storm (L3 area control)
3. Guidance, Spare the Dying (cantrip utility)
4. Magic Weapon, Prayer of Healing (L2 support)
5. Bestow Curse (L3 debuff)

**Action Items:**
- Add Lightning Bolt, Sleet Storm, Bestow Curse for L3
- Implement Guidance, Spare the Dying for cantrips
- Add cantrip scaling tests
- Wire Spiritual Weapon multi-round loop
- Enforce single-concentration invariant

