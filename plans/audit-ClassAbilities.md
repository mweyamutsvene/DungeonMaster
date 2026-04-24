---
type: sme-research
flow: ClassAbilities
feature: mechanics-audit-l1-5
author: claude-sme-class-abilities
status: DRAFT
created: 2026-04-24
updated: 2026-04-24
---

## Scope

ClassAbilities flow for D&D 5e 2024 L1-5 across 12 classes. Territory: `domain/entities/classes/`, `domain/abilities/`, `application/services/combat/abilities/executors/`.

**Caveat:** Some items marked `[UNVERIFIED]` — prior session had tool-access issues. The orchestrator should spot-check per-class executor presence before acting.

**Structural anchors confirmed:**
- Two-pattern system: `ClassCombatTextProfile` (text→action) + `AbilityRegistry` (executor dispatch)
- Executors registered in main + test registries
- `class-resources.ts` imports **10** class resource factories (not 12) — 2 classes lack pools
- Monk is complexity outlier (~200 LOC, 6 action mappings + 2 enhancements + 1 reaction); other classes are simpler

Legend: `[OK]` implemented + wired · `[PARTIAL]` rough edges · `[TEXT-ONLY]` text profile but no mechanics · `[MISSING]` not present · `[UNVERIFIED]`

## Currently Supported (per class, L1-5)

### Barbarian
- L1 **Rage** `[OK]` `createRageState()` resource pool, bonus-action activation, damage bonus + resistance + STR-check advantage. Duration/concentration-like check `[UNVERIFIED]`.
- L1 **Unarmored Defense** — cross-flow (AC calc).
- L1 **Weapon Mastery** — cross-flow.
- L2 **Reckless Attack** `[PARTIAL]` — advantage on STR melee + attackers gain advantage vs you. "Advantage vs you" tracking `[UNVERIFIED]`.
- L2 **Danger Sense** — adv on DEX saves vs effects you can see. `[UNVERIFIED]`/`[MISSING]`.
- L3 **Subclass** (Berserker/Wild Heart/World Tree/Zealot) — `[MISSING]`.
- L4 ASI/Feat — cross-flow.
- L5 **Extra Attack** — cross-flow.
- L5 **Fast Movement** — +10 speed unarmored. `[MISSING]`.

### Bard
- L1 **Spellcasting** (CHA) — cross-flow SpellSystem.
- L1 **Bardic Inspiration** `[PARTIAL]` — resource pool + granting likely works; **consumption** (adding BI die to attack/save/check) is the hard part. `[UNVERIFIED]` d20-roll hook.
- L2 **Expertise** — cross-flow skills.
- L2 **Jack of All Trades** — half-prof on non-proficient checks. `[MISSING]`.
- L3 **Subclass** (Lore/Valor/Dance/Glamour) — Cutting Words (Lore) is reaction on attacker's miss/save; needs reaction hook. `[MISSING]` high-priority.
- L4 ASI.
- L5 **Font of Inspiration** — BI on short rest. `[UNVERIFIED]`.
- L5 **Bardic Inspiration d8** upgrade — `[PARTIAL]` if scaling exists.

### Cleric
- L1 **Spellcasting** (WIS, prepared) — cross-flow.
- L1 **Divine Order** (Protector / Thaumaturge) — `[UNVERIFIED]`.
- L2 **Channel Divinity** (2/rest) — resource pool `[UNVERIFIED]`. Options: Turn Undead, Divine Spark (damage/heal). `[UNVERIFIED]`.
- L3 **Subclass** (Life/Light/Trickery/War) — Life's Disciple of Life procs on heal spells. `[MISSING]`.
- L4 ASI.
- L5 **Sear Undead** / improved Channel Divinity. `[UNVERIFIED]`.

### Druid
- L1 **Spellcasting** (WIS) — cross-flow.
- L1 **Druidic** (non-combat).
- L1 **Primal Order** (Magician/Warden) — `[UNVERIFIED]`.
- L2 **Wild Shape** `[MISSING]` — stat-block replacement; text-profile only at best.
- L2 **Wild Companion** (2024) — depends on Wild Shape + summons.
- L3 **Subclass** (Land/Moon/Sea/Stars) — Moon Circle Wild-Shape-intensive. `[MISSING]`.
- L4 ASI. L4 **Elemental Fury** (some subclasses).
- L5 — no universal druid feature; subclass-specific.
- **Goodberry** — git status shows active `druid/goodberry-create-and-eat.json` scenario; spell cross-flow.

### Fighter
- L1 **Fighting Style** `[PARTIAL]` — Defense/Dueling/Archery are static modifiers (AC/damage/attack, cross-flow). GWF reroll `[UNVERIFIED]`. Protection reaction `[MISSING]`.
- L1 **Second Wind** `[UNVERIFIED]`/`[PARTIAL]` — bonus action, 1d10+level heal, short/long rest.
- L1 **Weapon Mastery (3)** — cross-flow.
- L2 **Action Surge** (1/rest) `[PARTIAL]` — executor probably exists.
- L2 **Tactical Mind** (2024) — spend Second Wind to reroll skill check. `[MISSING]`.
- L3 **Subclass** (Champion/Battle Master/Eldritch Knight/Psi Warrior) — Champion improved crit (19-20) needs crit-range hook. Battle Master Maneuvers are a subsystem. `[MISSING]`.
- L4 ASI.
- L5 **Extra Attack** — cross-flow.
- L5 **Tactical Shift** (2024) — Second Wind grants half-speed move without OA. Cross-flow movement.

### Monk (outlier, most complete)
- L1 **Martial Arts** `[OK]` — d6 unarmed, DEX-for-attack, bonus-action unarmed strike.
- L1 **Unarmored Defense** — cross-flow AC.
- L2 **Monk's Focus / Ki / Focus Points** `[OK]` — `createKiState()` pool. Flurry of Blows (bonus: 2 unarmed), Patient Defense (disengage + dodge), Step of the Wind (dash + disengage). `[OK]` likely.
- L2 **Unarmored Movement** +10 ft — cross-flow movement.
- L3 **Deflect Attacks** (2024) `[OK]` — reaction; reduce damage, throw back.
- L3 **Subclass** (Warrior of Mercy/Shadow/Elements/Open Hand) — Open Hand Flurry rider (prone/push/disadv) `[UNVERIFIED]`.
- L4 ASI. L4 **Slow Fall** (reaction).
- L5 **Extra Attack**.
- L5 **Stunning Strike** — spend focus on hit, force CON save or Stunned until end of your next turn. **Critical L5 feature.** `[UNVERIFIED]`/`[PARTIAL]`.

### Paladin
- L1 **Spellcasting** (prepared, half-caster) — cross-flow.
- L1 **Lay on Hands** `[UNVERIFIED]`/`[MISSING]` — resource pool (5×level hp). Cures disease/poison (2024).
- L1 **Weapon Mastery (2)** — cross-flow.
- L2 **Fighting Style** — as Fighter subset.
- L2 **Divine Smite** (2024: now a spell, 1st-level slot) `[UNVERIFIED]`/`[PARTIAL]` — on melee hit, expend slot for +2d8 radiant (+1d8 per level above 1st, +1d8 vs undead/fiend).
- L2 **Channel Divinity** (2/rest): Divine Sense, Harness Divine Power. `[UNVERIFIED]`.
- L3 **Subclass** (Devotion/Glory/Ancients/Vengeance) — oath spells + unique Channel Divinity. `[MISSING]`.
- L3 **Divine Health** — immune disease.
- L4 ASI.
- L5 **Extra Attack**.
- L5 **Faithful Steed** — Find Steed 1/day. Cross-flow summons.

### Ranger
- L1 **Spellcasting** (WIS, prepared) — cross-flow.
- L1 **Favored Enemy** (2024) — always have Hunter's Mark prepared, free cast uses. `[UNVERIFIED]`.
- L1 **Weapon Mastery (2)** — cross-flow.
- L2 **Fighting Style**.
- L2 **Deft Explorer** — non-combat.
- L3 **Subclass** (Hunter/Beast Master/Fey Wanderer/Gloom Stalker) — Hunter's Prey Colossus Slayer. `[MISSING]`.
- L3 **Roving** — +10 speed, climb/swim.
- L4 ASI.
- L5 **Extra Attack**.

### Rogue
- L1 **Expertise (2)** — cross-flow.
- L1 **Sneak Attack** `[PARTIAL]` — +1d6 per 2 levels. Needs attack-hit hook + advantage-detection + finesse/ranged. Critical feature.
- L1 **Thieves' Cant** — non-combat.
- L1 **Weapon Mastery (2)** — cross-flow.
- L2 **Cunning Action** `[UNVERIFIED]` — bonus to Dash/Disengage/Hide. Hide complex.
- L3 **Subclass** (Thief/Assassin/Arcane Trickster/Soulknife) — Assassinate (auto-crit vs surprised) attack-pipeline-deep. `[MISSING]`.
- L3 **Steady Aim** (2024 base) — bonus action, grant self advantage on next attack if you don't move. `[UNVERIFIED]`/`[MISSING]`.
- L4 ASI.
- L5 **Uncanny Dodge** `[MISSING]` — reaction, halve damage from visible attacker.
- L5 **Cunning Strike** (2024) `[MISSING]` — spend Sneak Attack dice for extra effects (Trip/Withdraw/Disarm/Daze/Poison).

### Sorcerer
- L1 **Spellcasting** (CHA, known) — cross-flow.
- L1 **Innate Sorcery** (2024) — bonus action, 1m, advantage on Sorcerer-spell attack + +1 DC. 2/LR. `[UNVERIFIED]`/`[MISSING]`.
- L1 **Sorcerous Origin** subclass at L1 (Aberrant/Clockwork/Draconic/Wild Magic) — Draconic Resilience (+1 HP/level, scaling armor). `[MISSING]`.
- L2 **Font of Magic** `[PARTIAL]` — `createSorceryPointsState()` pool; slots↔points conversion executor plausible.
- L3 **Metamagic (2)** `[MISSING]` — each is a spell-cast modifier. Quickened easiest; Twinned requires single-target detection; Heightened requires save hook.
- L4 ASI.
- L5 **Sorcerous Restoration** — `[UNVERIFIED]`.

### Warlock
- L1 **Pact Magic** (short-rest slots, highest level) — cross-flow SpellSystem (fundamentally different slot model).
- L1 **Eldritch Invocations (2)** `[MISSING]` — each is its own mini-feature. Agonizing Blast, Devil's Sight, Repelling Blast, Pact of the Blade (2024 invocation).
- L1 **Patron subclass at L1** (Archfey/Celestial/Fiend/Old One/Hexblade) — Fiend's Dark One's Blessing (temp HP on kill). `[MISSING]`.
- L2 **Magical Cunning** (2024) — ritual, recover half Pact slots 1/LR.
- L3 **Pact Boon** (Blade/Chain/Tome/Talisman).
- L4 ASI.
- L5 — 3rd-level Pact slots.
- **Warlock is likely weakest-covered class.**

### Wizard
- L1 **Spellcasting** (INT, prepared from spellbook) — cross-flow.
- L1 **Ritual Adept** (2024) — cast any ritual from spellbook without preparation.
- L1 **Arcane Recovery** — SR, regain slots up to half wizard level. `[UNVERIFIED]`.
- L2 **Scholar** (2024) — Expertise in one knowledge skill. Cross-flow.
- L3 **Subclass** (Abjurer/Diviner/Evoker/Illusionist) — Evoker's Sculpt Spells (exclude allies), Diviner's Portent (replace d20). `[MISSING]`.
- L4 ASI.
- L5 — no universal wizard feature at L5; subclass-specific.

## Needs Rework

1. **Resource pool coverage partial.** `class-resources.ts` imports 10 of 12 classes — identify the 2 missing (likely Fighter or Rogue or Warlock or Wizard).
2. **Attack enhancement stacking.** Reckless Attack, Sneak Attack, Divine Smite, Stunning Strike all in "on-hit modify damage" slot — need precedence/composition order.
3. **Attack reaction dedup.** Shield, Deflect Attacks, Uncanny Dodge, Protection, Cutting Words all compete for reaction on incoming attack.
4. **Bonus action routing.** Verify all bonus-action class features actually consume bonus-action economy.
5. **Subclass scaffolding is absent.** Sorc/Warlock get subclass at L1 (2024); no subclass registry evidence. **Biggest structural gap.**
6. **Monk outlier pattern should be generalized.** Rogue and Paladin likely under-populated given feature density.
7. **2024-specific features** (Weapon Mastery, Tactical Mind, Cunning Strike, Innate Sorcery, Magical Cunning, Favored Enemy-as-HuntersMark, Divine Smite-as-spell) — if written against 2014 rules, need rework.
8. **Bardic Inspiration consumption hook.** If not wired into d20 rolls, BI is cosmetic.
9. **Condition application from class abilities** — Stunning Strike, Cunning Strike, Battle Master maneuvers — need uniform application through save pipeline.

## Missing — Required for L1-5

### P0 — Blocking for meaningful L1-5 play
- **Subclass framework.** 11/12 classes lose L3 identity; Sorc/Warlock lose L1 identity. Zero subclass coverage = zero thematic play above L2.
- **Sneak Attack** (Rogue L1).
- **Divine Smite** (Paladin L2, 2024 spell).
- **Stunning Strike** (Monk L5).
- **Action Surge** (Fighter L2) — verify presence.
- **Bardic Inspiration consumption.**
- **Extra Attack cascade** — verify class capability declaration drives attack loop.
- **Weapon Mastery class-to-mastery declarations.**

### P1 — Class fidelity at L1-5
- Rage damage bonus/resistance verification.
- Second Wind executor + 2024 Tactical Mind rider.
- Channel Divinity resource + Turn Undead/Divine Spark.
- Wild Shape (minimal stat-block swap).
- Lay on Hands pool + executor.
- Hunter's Mark integration for Favored Enemy.
- Cunning Action executor.
- Uncanny Dodge reaction.
- Font of Magic pool + conversion.
- Pact slot model (Warlock).
- Arcane Recovery.
- Fighting Style modifiers (AC/damage/attack).
- Metamagic — at least Quickened + Twinned.
- At least one Eldritch Invocation (Agonizing Blast).

### P2 — Polish
- Reckless Attack "advantage vs you" tracking.
- Danger Sense DEX-save tag.
- Great Weapon Fighting reroll.
- Protection fighting-style reaction.
- Slow Fall reaction (Monk L4).
- Cunning Strike dice-spending (Rogue L5, 2024-only, niche).
- Innate Sorcery.
- Magical Cunning.
- Steady Aim.
- Favored Enemy scaling uses.

### Species / Ancestry — flag as living elsewhere
Species traits (Dragonborn Breath, Elf Perception/Fey Ancestry, Dwarf Resilience, Halfling Lucky reroll, Orc Relentless Endurance, Tiefling innate casting, Aasimar Celestial Revelation at L3, Goliath Powerful Build) almost certainly do NOT live in ClassAbilities. They belong in EntityManagement species system. **If not implemented as a flow, that is a P0 gap outside ClassAbilities scope.**

## Cross-Flow Dependencies

| Dependency | Owner | What ClassAbilities needs |
|---|---|---|
| Weapon Mastery | CombatRules + weapon catalog | Mastery defs; class declares which + how many |
| Extra Attack at L5 | CombatOrchestration (attack loop) | Multi-attack cascade from class `capabilities` |
| Spellcasting (Bard/Cleric/Druid/Pal/Ranger/Sorc/Wlk/Wiz) | SpellSystem | Slots, prep, ritual, DC/bonus. 2024 Smite overlap. |
| Fighting Style modifiers | EntityManagement, CombatRules | Attribute-level mods |
| Unarmored Defense | EntityManagement | AC formula branching |
| Conditions (Stunned/Prone/Poisoned/Charmed/Frightened) | CombatRules | Apply/remove on save |
| Save pipeline | CombatRules | Save DC + advantage + on-fail effects |
| Reactions | ReactionSystem | Register triggers on incoming attack; prompt; pay |
| d20 roll interception | ActionEconomy / dice | Post-roll swap-or-add hook (BI, Portent, Lucky) |
| Short/Long rest hooks | EntityManagement / rest service | Recover: Rage, BI (L5+), CD, Action Surge, 2nd Wind, Ki, LoH (LR), Pact (SR), Arcane Recovery, FoM (LR) |
| Kill-trigger | CombatOrchestration | On-kill event bus |
| Summons | EntityManagement | Controlled NPC entity |
| Wild Shape | EntityManagement | Replace CreatureStats; restore on revert |
| Species traits | EntityManagement / new SpeciesFlow | Not ClassAbilities scope |
| Hide/Stealth | AIBehavior + CombatRules | Stealth vs passive Perception |
| Concentration | SpellSystem | Maintenance |
| Attack enhancement stacking | CombatOrchestration | Precedence rules |

---

## Priority build order for L1-5

1. Subclass framework
2. P0 signature features (Sneak Attack, Smite, Action Surge, Stunning Strike, BI consumption)
3. P1 fills
4. Subclass L3 features
5. P2 polish
