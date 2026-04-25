---
type: plan
flow: ClassAbilities,EntityManagement
feature: subclass-framework-l3
author: claude-orchestrator
status: DRAFT
created: 2026-04-24
updated: 2026-04-24
---

# Plan: L3 Subclass Features for All 12 Classes

## Why this matters

D&D 5e 2024: every class chooses a subclass at L3 (except Sorcerer/Warlock at L1). Without subclass features, **11 of 12 classes lose their L3 identity**. Per the audit, the typed `SubclassDefinition` framework EXISTS in `class-definition.ts` and `registry.ts:getSubclassDefinition()` works. Several subclass definitions exist as placeholders (Thief, School of Evocation, Life Domain, The Fiend, Path of the Berserker, Open Hand). What's largely missing is the **mechanical implementation** of subclass features.

## Current state

Existing subclass definitions (skeletal, mostly feature-keys without executors):
- Barbarian — Path of the Berserker (Frenzy, Mindless Rage, Intimidating Presence, Retaliation)
- Bard — College of Lore (Cutting Words, Additional Magical Secrets, Bonus Proficiencies)
- Cleric — Life Domain (Disciple of Life, Preserve Life, Life Domain Spells)
- Druid — Circle of the Land (Circle Spells, Land's Aid)
- Fighter — Champion (Improved Critical, Remarkable Athlete, Additional Fighting Style)
- Monk — Way of the Open Hand (Open Hand Technique, Quivering Palm, Perfect Focus)
- Paladin — Oath of Devotion (Sacred Weapon, Oath of Devotion Spells)
- Ranger — Hunter (Hunter's Lore, Hunter's Prey, Colossus Slayer)
- Rogue — Thief (Fast Hands, Second Story Work, Supreme Sneak, Use Magic Device, Thief's Reflexes)
- Sorcerer — Draconic Sorcery (Red) (Draconic Resilience, Draconic Ancestry, Elemental Affinity)
- Warlock — The Fiend (Dark One's Blessing, Fiend Expanded Spells)
- Wizard — School of Evocation (Sculpt Spells, Evocation Savant)

## L3 features to implement (priority order)

### Tier A — already-extant pure functions, just need executors / hookups

1. **Champion: Improved Critical** — crit on 19-20. Hook: `attack-resolver.ts` `isCriticalHit()` should respect subclass crit range.
2. **Thief: Fast Hands** — Cunning Action's bonus action can also be Use an Object, Sleight of Hand check, or DEX(Thieves' Tools). Hook: extend Cunning Action executor.
3. **Hunter: Colossus Slayer** — once per turn, +1d8 damage to a creature already below max HP. Hook: damage resolver, on Sneak-Attack-style trigger.
4. **Open Hand: Open Hand Technique** — Flurry of Blows hits get rider effects (prone, push 15ft, no reaction next turn). Hook: extend `flurry-of-blows-executor.ts`.
5. **Draconic Sorcery: Draconic Resilience** — +1 HP per Sorcerer level + AC = 13 + DEX while unarmored. Hook: HP at hydration + AC formula in `getAC()`.
6. **Draconic Sorcery: Draconic Ancestry** — choose damage type; you can speak Draconic. Mostly cosmetic at L3.
7. **Fiend: Dark One's Blessing** — kill a creature → temp HP. Hook: kill-trigger event bus (currently absent — needs new infrastructure).

### Tier B — new executors required

1. **Path of the Berserker: Frenzy** — on rage, opt into Frenzy: extra attack as bonus action (free unarmed/melee). Costly, simple executor.
2. **Bard Lore: Cutting Words** — reaction; subtract BI die from a roll. **Blocked on d20 roll-interrupt hook (see plan-d20-roll-interrupt.md).**
3. **Life Domain: Disciple of Life** — heal spells gain +(2 + spellLevel) HP. Hook: healing handler post-roll.
4. **Devotion: Sacred Weapon** — Channel Divinity to add CHA mod to attack rolls + magical damage for 1 minute. Bonus action class ability + active effect.
5. **Hunter: Hunter's Prey** (selector for Colossus Slayer / Horde Breaker / Giant Killer) — choose at L3.

### Tier C — large feature trees

1. **Battle Master Maneuvers** (Fighter alt subclass) — Superiority Dice subsystem with 16+ maneuvers. Sized like a feature on its own.
2. **Eldritch Knight** (Fighter alt) — partial caster, weapon bond, war magic.
3. **Arcane Trickster** (Rogue alt) — partial caster + Mage Hand Legerdemain.
4. **Circle of the Moon** (Druid alt) — stronger Wild Shape; depends on Wild Shape stat-swap (see plan-wild-shape-stat-swap.md).
5. **College of Valor** (Bard alt) — martial bardic.
6. **War Domain** (Cleric alt) — bonus action attack on CD.

## Recommended phasing

### Phase 1 (1-2 days) — Tier A
The pure-function-existence + small executor pattern. Hits 7 of 12 classes. Drives playable L3-5 across the party.

### Phase 2 (2-3 days) — Tier B
Adds the executor-required features. Note Cutting Words is blocked on d20 interrupt — sequence after that.

### Phase 3 (2+ weeks) — alternate subclasses (Tier C)
Out of scope for L1-5 minimum viable. Players can pick the implemented subclass for their class.

## Touched files (Tier A)

| File | Change |
|---|---|
| `domain/entities/classes/registry.ts` | Subclass lookup + crit range function |
| `domain/rules/attack-resolver.ts` | Use `getCritRangeForActor()` from class definition |
| `application/services/combat/abilities/executors/rogue/cunning-action-executor.ts` | Add `useObject` + `sleightOfHand` choices for Thief |
| `application/services/combat/tabletop/rolls/damage-resolver.ts` | Add Colossus Slayer rider for Hunter |
| `application/services/combat/abilities/executors/monk/flurry-of-blows-executor.ts` | Open Hand Technique rider |
| `application/services/combat/helpers/creature-hydration.ts` | Draconic Resilience HP + AC |
| `domain/entities/classes/sorcerer.ts` | Subclass selection at L1 routes to Draconic; expose draconic damage type |
| `application/services/combat/helpers/kill-trigger-bus.ts` (NEW) | On-kill event for Dark One's Blessing |
| `application/services/combat/abilities/executors/warlock/dark-ones-blessing-listener.ts` (NEW) | Subscribe and grant temp HP |

## Test strategy

- Unit per feature: 1-2 tests in the existing class test files.
- E2E: extend existing class-combat scenarios (e.g., `class-combat/fighter/martial-extra-attack-l5.json` add a Champion variant validating 19-20 crits).
- Multi-PC scenarios with subclass features active to validate cross-flow correctness.

## Estimated scope

- Tier A: ~2 days
- Tier B: ~3 days (Cutting Words deferred)
- Tier C: out of scope for L1-5 baseline

## Unblocks

- L3 identity for 7+ classes
- Validates the subclass framework end-to-end (currently only definition stubs exist)
- Drives subclass-specific scenario coverage
