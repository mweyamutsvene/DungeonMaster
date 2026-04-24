---
type: sme-research
flow: CreatureHydration
feature: mechanics-audit-l1-5
author: claude-explore-creature-hydration
status: DRAFT
created: 2026-04-24
updated: 2026-04-24
---

## Scope

Hydration pipeline: DB records (`SessionCharacterRecord`, `SessionMonsterRecord`, `SessionNPCRecord`, `CombatantStateRecord`) → rich domain entities (`Character`, `Monster`, `NPC`). Entry points: `hydrateCharacter()`, `hydrateMonster()`, `hydrateNPC()` + reverse via `extractCombatantState()`.

## Currently Supported

### Character Hydration
- Ability scores (default 10), HP (max/current/temp), AC lookup, speed, class/level, multiclass via `classLevels` array, resource pools, feat IDs, fighting style unification.

### Species Traits
- 10 species registered: Human, Elf, Dwarf, Halfling, Dragonborn, Gnome, Orc, Tiefling, Aasimar, Goliath.
- Darkvision range, damage resistances (incl. Dragonborn ancestry mapping), save advantages (Elf charmed, Dwarf poisoned, etc.), speed override.

### AC Derivation
- Base `Creature.getAC()`: armor formula + capped DEX + shield bonus.
- Character layer: **Unarmored Defense** (Barb 10+DEX+CON, Monk 10+DEX+WIS) with feature gate.
- **Defense Fighting Style** (+1 AC armored).
- Shield training checked.

### Equipment
- Pre-enriched fields + armor catalog fallback.
- `extractEquipment()` resolves armor category/formula, shield bonus.

### Monster/NPC
- Stat block parsing, proficiency from CR, damage defenses.

### Combat Resolver
- `CombatantCombatStats`: AC, ability scores, feats, size, skills, equipment.
- Weapon detection via catalog; two-handed via `isTwoHanded()`.

## Needs Rework

### AC — No Spell Effects
- Mage Armor (13 + DEX) not detected/applied. No `mageArmorActive` hydration.
- No active effects framework for temporary AC modifiers.
- Magic item bonuses (+1/+2/+3 armor) not parsed.

### HP — No Class Integration
- Sheet-stored only; no validation against `level + CON + hit die + Tough feat`.
- Tough applied at enrichment, not domain-time.

### Species Traits — Incomplete
- Supported: darkvision, resistances, speed, save advantages.
- Missing: natural armor, breath weapons, ability check bonuses (Gnome Cunning INT/WIS/CHA magic saves), size → AC/grapple.

### Feat Traits — Partial
- Supported: Alert, Defense, Dueling, GWF, Protection, TWF, Archery.
- Missing: Lucky (point tracking), Resilient (ability + save prof), Grappler, Skilled, Interception (placeholders).

### Magic Items — No Framework
- No catalog integration for +X weapons/armor, attunement, ability score bonuses.

### Combat Stats — No DC/Attack Derivation
- `spellSaveDC` (8 + prof + ability) / `spellAttackBonus` read from sheet, not computed.
- Skill modifiers duplicated between domain + combatant-resolver.

### Wild Shape/Polymorph — Lossy
- Executor stores beast form in resources JSON (HP, AC, attacks, speed).
- **No reverse hydration**: loading mid-wild-shape reads character AC/HP, not beast form.
- Reverting clears metadata; restoring character HP undefined.

### ASI Boosts — Not Applied
- `asiChoices` parsed but not merged into `getEffectiveAbilityScores()` at hydration.
- AC/attack/saves from base scores (stale if ASI present).

### Proficiency Bonus — Heuristic
- Character: level-based (deterministic, L1-5 OK).
- Monster: CR + 4 offset (heuristic, not spec).
- Multiclass: uses total level (OK for L1-5).

## Missing — Required for L1-5

- **Sheet validation** — no required field checks; graceful fallback to 10/10/10 masks data issues.
- **Size application** — extracted but not applied to AC, grapple reach.
- **Condition immunities** — not modeled (Elf Fey Ancestry "charmed" immunity).
- **Multiclass spellcasting** — no slot pooling across classes.
- **Buff persistence** — temporary AC modifiers in resources JSON, no domain application.
- **Skill check unification** — duplicated logic in combatant-resolver; no single stat source.

## Cross-Flow Dependencies

| Flow | Depends On | Status |
|---|---|---|
| Character.getAC() | Equipment, ArmorTraining, FeatModifiers, ClassFeatures | OK minimal |
| Attack Resolution | Creature AC, Ability Mods, Feat Bonuses | Partial |
| Spell Casting | SpellSaveDC, SpellAttackBonus | Partial, sheet-dependent |
| Wild Shape | Beast form executor → resources JSON | Lossy |
| Skill Checks | Ability Scores, Profs, Expertise, Feats | Duplicated |
| Initiative | DEX, Alert feat | OK via `Character.getInitiativeModifier()` |
| Damage Defenses | Resistances (species + sheet) | OK merged |

## Summary

**60% complete for L1-5.** Core hydration works for hand-crafted sheets. Production failures: wild shape mid-combat, ASI-boosted effective stats, spell effects, multiclass spellcasting.

**Priority rework:**
1. ASI merging into effective ability scores.
2. Wild shape reverse hydration.
3. Spell effect detection (Mage Armor).
4. Unified skill/attack logic (remove duplication).
