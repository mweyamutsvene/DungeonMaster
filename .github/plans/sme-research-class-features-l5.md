# SME Research — ClassAbilities — All Class Features L1-5

## Scope
- Files read: 12 class definition files, feature-keys.ts, registry.ts, app.ts (executor registrations), spell-progression.ts, prepared-spell-definition.ts, all E2E scenario folders
- 12 classes defined: Barbarian, Bard, Cleric, Druid, Fighter, Monk, Paladin, Ranger, Rogue, Sorcerer, Warlock, Wizard

## Registered Executors in app.ts (22 total)
ActionSurge, Indomitable, SecondWind, NimbleEscape, CunningAction, OffhandAttack, FlurryOfBlows, PatientDefense, StepOfTheWind, MartialArts, WholenessOfBody, Rage, RecklessAttack, BrutalStrike, Frenzy, LayOnHands, ChannelDivinity, TurnUndead, BardicInspiration, WildShape, QuickenedSpell, TwinnedSpell

## Combat Text Profiles Registered (12)
All 12 classes have profiles in registry.ts: Monk, Fighter, Wizard, Warlock, Barbarian, Paladin, Cleric, Rogue, Ranger, Bard, Sorcerer, Druid

---

## BARBARIAN (L1-5)

| Feature | Level | Type | Has Executor | Has E2E | Notes |
|---------|-------|------|-------------|---------|-------|
| Rage | 1 | bonus action | ✅ RageExecutor | ✅ rage.json, rage-resistance.json, rage-ends.json | 2 uses/LR at L1, 3 at L3. Resource pool + active flag |
| Unarmored Defense | 1 | passive | ❌ (computed) | ✅ unarmored-defense.json | AC=10+DEX+CON. Computed in hydration |
| Weapon Mastery | 1 | passive | ❌ (system) | ✅ mastery/*.json | Handled by weapon mastery system |
| Reckless Attack | 2 | free (classAction) | ✅ RecklessAttackExecutor | ✅ reckless-attack.json | Advantage on STR melee; enemies get advantage |
| Danger Sense | 2 | passive | ❌ (rules) | ❌ | Advantage on DEX saves vs visible effects |
| Extra Attack | 5 | action | ❌ (system) | ✅ extra-attack.json | Auto-chained in damage-resolver |
| **Subclass: Berserker** | | | | | |
| Frenzy | 3 | bonus action | ✅ FrenzyExecutor | ❌ | Extra melee attack while raging |

**Spells:** None (non-caster)
**Reactions (profile):** None defined
**Resource pools:** rage (2→3 at L3-5, long rest)

---

## BARD (L1-5)

| Feature | Level | Type | Has Executor | Has E2E | Notes |
|---------|-------|------|-------------|---------|-------|
| Spellcasting | 1 | action | ❌ (spell system) | ❌ | Full caster, CHA-based |
| Bardic Inspiration | 1 | bonus action | ✅ BardicInspirationExecutor | ❌ | d6 die, CHA mod uses/LR. d8 at L5 |
| Jack of All Trades | 2 | passive | ❌ | ❌ | Half prof to unproficient checks |
| Font of Inspiration | 5 | passive | ❌ | ❌ | BI recharges on short rest |

**Spells:** Full caster (L1: 2 slots, L2: 3, L3: 4+2×L2, L4: 4+3×L2, L5: 4+3+2×L3)
**Reactions (profile):** None defined
**Resource pools:** bardicInspiration (CHA mod uses, long rest; short rest at L5)
**E2E folder:** None exists

---

## CLERIC (L1-5)

| Feature | Level | Type | Has Executor | Has E2E | Notes |
|---------|-------|------|-------------|---------|-------|
| Spellcasting | 1 | action | ❌ (spell system) | ✅ cure-wounds.json, solo-cleric-replay.json | Full caster, WIS-based |
| Channel Divinity | 2 | action | ✅ ChannelDivinityExecutor | ❌ | 2 uses/SR at L2 |
| Turn Undead | 2 | action (CD use) | ✅ TurnUndeadExecutor | ✅ turn-undead.json | WIS save or turned |
| Destroy Undead | 5 | passive (upgrade) | ❌ (rules) | ❌ | CR ≤ 0.5 undead auto-destroyed |

**Spells:** Full caster (same progression as Wizard)
**Reactions (profile):** None defined
**Resource pools:** channelDivinity:cleric (2 uses/SR at L2-5)

---

## DRUID (L1-5)

| Feature | Level | Type | Has Executor | Has E2E | Notes |
|---------|-------|------|-------------|---------|-------|
| Spellcasting | 1 | action | ❌ (spell system) | ❌ | Full caster, WIS-based |
| Wild Shape | 2 | bonus action | ✅ WildShapeExecutor | ❌ | 2 uses at L2-4, Beast of Land only until L4 |

**Spells:** Full caster (same progression as Wizard)
**Reactions (profile):** None defined
**Resource pools:** wildShape (2 uses/SR at L2-4, 3 at L5)
**E2E folder:** None exists

---

## FIGHTER (L1-5)

| Feature | Level | Type | Has Executor | Has E2E | Notes |
|---------|-------|------|-------------|---------|-------|
| Fighting Style | 1 | passive | ❌ (rules) | ❌ | Domain has Protection reaction def (TODO: CO-L6) |
| Weapon Mastery | 1 | passive | ❌ (system) | ✅ mastery/*.json | All 9 mastery types have E2E |
| Second Wind | 1 | bonus action | ✅ SecondWindExecutor | ✅ second-wind.json | 1d10+level HP, 1 use/SR |
| Action Surge | 2 | free | ✅ ActionSurgeExecutor | ✅ action-surge.json | Extra action, 1 use/SR |
| Extra Attack | 5 | action | ❌ (system) | ✅ extra-attack.json | Auto-chained in damage-resolver |
| **Subclass: Champion** | | | | | |
| Improved Critical | 3 | passive | ❌ (registry fn) | ❌ | Crit on 19-20. getCriticalHitThreshold() |

**Spells:** None (non-caster)
**Reactions (profile):** Protection (TODO — not wired). Requires extending reaction detection to allies.
**Resource pools:** actionSurge (1 use/SR), secondWind (1 use/SR)

---

## MONK (L1-5)

| Feature | Level | Type | Has Executor | Has E2E | Notes |
|---------|-------|------|-------------|---------|-------|
| Martial Arts | 1 | bonus action | ✅ MartialArtsExecutor | ✅ martial-arts.json | Bonus unarmed strike after Attack action |
| Unarmored Defense | 1 | passive | ❌ (computed) | ❌ | AC=10+DEX+WIS |
| Flurry of Blows | 2 | bonus action | ✅ FlurryOfBlowsExecutor | ✅ flurry.json +5 more | 1 ki, 2 unarmed strikes |
| Patient Defense | 2 | bonus action | ✅ PatientDefenseExecutor | ✅ patient-defense.json | 1 ki, Dodge action |
| Step of the Wind | 2 | bonus action | ✅ StepOfTheWindExecutor | ✅ step-of-the-wind*.json (3) | 1 ki, Disengage or Dash |
| Uncanny Metabolism | 2 | passive | ❌ | ✅ uncanny-metabolism.json | 1/LR, regain ki on roll |
| Deflect Attacks | 3 | reaction | ❌ (profile reaction) | ✅ deflect-attacks.json, deflect-attacks-redirect.json | Reduce dmg by 1d10+DEX+level |
| Stunning Strike | 5 | free (on-hit) | ❌ (attack enhancement) | ✅ stunning-strike*.json (4) | 1 ki, CON save or Stunned |
| Extra Attack | 5 | action | ❌ (system) | ✅ flurry-extra-attack.json | Auto-chained |
| **Subclass: Open Hand** | | | | | |
| Open Hand Technique | 3 | free (on-hit, FoB) | ❌ (attack enhancement) | ✅ open-hand*.json (2) | Addle/Push/Topple on FoB hit |

**Spells:** None (non-caster)
**Reactions (profile):** Deflect Attacks (AttackReactionDef in monk.ts)
**Resource pools:** ki (L=level pts/SR), uncanny_metabolism (1/LR)

---

## PALADIN (L1-5)

| Feature | Level | Type | Has Executor | Has E2E | Notes |
|---------|-------|------|-------------|---------|-------|
| Lay on Hands | 1 | bonus action | ✅ LayOnHandsExecutor | ✅ lay-on-hands.json | 5×level HP pool/LR |
| Spellcasting | 1 | action | ❌ (spell system) | ✅ bonus-action-spell-attack.json | Half caster, CHA-based. L2: 2 slots |
| Weapon Mastery | 1 | passive | ❌ (system) | ❌ | |
| Fighting Style | 2 | passive | ❌ | ❌ | |
| Divine Smite | 2 | bonus action (on-hit) | ❌ (attack enhancement) | ✅ divine-smite.json | 2d8+ radiant, costs spell slot + BA |
| Channel Divinity | 3 | varies | ✅ ChannelDivinityExecutor | ❌ | 1 use/SR at L3 |
| Divine Sense | 3 | bonus action (CD) | ❌ (text mapping only) | ❌ | Detect celestials/fiends/undead 60ft |
| Extra Attack | 5 | action | ❌ (system) | ❌ | Auto-chained |
| Aura of Protection | 6 | passive | ❌ (rules) | ✅ aura-of-protection.json | +CHA saves 10ft (above L5 scope) |

**Spells:** Half caster (L2: 2×L1, L3: 3×L1, L5: 4×L1+2×L2)
**Reactions (profile):** None defined
**Resource pools:** layOnHands (5×level/LR), channelDivinity:paladin (1 use/SR at L3)
**Attack enhancements:** Divine Smite (requires melee hit + BA available + spell slot)

---

## RANGER (L1-5)

| Feature | Level | Type | Has Executor | Has E2E | Notes |
|---------|-------|------|-------------|---------|-------|
| Weapon Mastery | 1 | passive | ❌ (system) | ❌ | |
| Favored Enemy | 1 | free | ❌ | ❌ | Free Hunter's Mark casts (2/LR) |
| Spellcasting | 1 | action | ❌ (spell system) | ❌ | Half caster, WIS-based. L2: 2 slots |
| Deft Explorer | 2 | passive | ❌ | ❌ | Expertise + languages |
| Fighting Style | 2 | passive | ❌ | ❌ | |
| Extra Attack | 5 | action | ❌ (system) | ❌ | Auto-chained |

**Spells:** Half caster (same as Paladin). Gets cantrips (2 at L1).
**Reactions (profile):** None defined
**Resource pools:** favoredEnemy (2 at L1-4), spell slots
**E2E folder:** None exists. **Zero E2E coverage.**

---

## ROGUE (L1-5)

| Feature | Level | Type | Has Executor | Has E2E | Notes |
|---------|-------|------|-------------|---------|-------|
| Sneak Attack | 1 | free (once/turn) | ❌ (rules) | ✅ sneak-attack.json +1 | 1d6→3d6 at L5. Finesse/ranged + adv or ally |
| Weapon Mastery | 1 | passive | ❌ (system) | ❌ | |
| Cunning Action | 2 | bonus action | ✅ CunningActionExecutor | ✅ cunning-action-*.json (3) | Dash/Disengage/Hide as BA |
| Uncanny Dodge | 5 | reaction | ❌ (profile reaction) | ✅ uncanny-dodge.json | Halve incoming attack damage |
| **Subclass: Thief** | | | | | |
| Fast Hands | 3 | passive | ❌ | ❌ | Use Object as BA |
| Second-Story Work | 3 | passive | ❌ | ❌ | Climb speed = walk speed |

**Spells:** None (non-caster)
**Reactions (profile):** Uncanny Dodge (AttackReactionDef in rogue.ts)
**Resource pools:** None

---

## SORCERER (L1-5)

| Feature | Level | Type | Has Executor | Has E2E | Notes |
|---------|-------|------|-------------|---------|-------|
| Spellcasting | 1 | action | ❌ (spell system) | ❌ | Full caster, CHA-based |
| Sorcery Points | 2 | free | ❌ | ❌ | Points = level (2-5). Convert to/from slots |
| Metamagic | 2 | free | ❌ | ❌ | Modify spell properties |
| Quickened Spell | 2 | bonus action | ✅ QuickenedSpellExecutor | ❌ | Cast action spell as BA (2 SP) |
| Twinned Spell | 2 | classAction | ✅ TwinnedSpellExecutor | ❌ | Target two creatures (SP = spell level) |

**Spells:** Full caster (same progression as Wizard)
**Reactions (profile):** None defined
**Resource pools:** sorceryPoints (level pts/LR, starts at L2)
**E2E folder:** None exists. **Zero E2E coverage.**

---

## WARLOCK (L1-5)

| Feature | Level | Type | Has Executor | Has E2E | Notes |
|---------|-------|------|-------------|---------|-------|
| Pact Magic | 1 | action | ❌ (spell system) | ✅ short-rest-pact-magic.json | Unique slot system, all same level |
| Eldritch Invocations | 2 | passive | ❌ | ❌ | Passive/activated abilities |
| Pact Boon | 3 | passive | ❌ | ❌ | Blade/Chain/Tome |

**Spells:** Pact Magic (L1: 1×L1, L2: 2×L1, L3-4: 2×L2, L5: 2×L3). Refresh on SR.
**Reactions (profile):** Hellish Rebuke (DamageReactionDef — fires when damaged, costs spell slot)
**E2E coverage:** ✅ hellish-rebuke.json, hex*.json (3), eldritch-blast*.json (2)
**Resource pools:** pactMagic (short rest refresh)

---

## WIZARD (L1-5)

| Feature | Level | Type | Has Executor | Has E2E | Notes |
|---------|-------|------|-------------|---------|-------|
| Spellcasting | 1 | action | ❌ (spell system) | ✅ cast.json, spell-attacks.json +11 | Full caster, INT-based |
| Arcane Recovery | 1 | free | ❌ | ❌ | 1/LR, recover spell slot levels = ½ wizard level |

**Spells:** Full caster (L1: 2 slots, L5: 4+3+2). 3 cantrips at L1.
**Reactions (profile):**
- Shield (AttackReactionDef) — +5 AC, costs L1 slot. ✅ shield-reaction.json, shield-persistence.json
- Counterspell (SpellReactionDef) — interrupt spell, costs L3 slot. ✅ counterspell.json
- Absorb Elements (DamageReactionDef) — resist elemental dmg, costs L1 slot. ✅ absorb-elements.json
- Silvery Barbs (AttackReactionDef) — force reroll, costs L1 slot. TODO: CO-L4 (detection only)

**Resource pools:** arcaneRecovery (1 use/LR)

---

## Summary: Implementation Gaps (L1-5 features without executor or E2E)

| Class | Feature | Gap Type |
|-------|---------|----------|
| Barbarian | Danger Sense | No executor, no E2E |
| Barbarian | Frenzy (Berserker L3) | Has executor, **no E2E** |
| Bard | **Entire class** | Has executor (BI), **no E2E folder** |
| Cleric | Channel Divinity (generic) | Has executor, no standalone E2E |
| Cleric | Destroy Undead | No executor, no E2E |
| Druid | **Entire class** | Has executor (WS), **no E2E folder** |
| Fighter | Fighting Style / Protection | Reaction defined but TODO (CO-L6) |
| Fighter | Improved Critical (Champion L3) | Computed only, no E2E |
| Paladin | Divine Sense | Text mapping only, no executor, no E2E |
| Ranger | **Entire class** | No executors, **no E2E folder** |
| Sorcerer | **Entire class** | Has executors (QS/TS), **no E2E folder** |
| Wizard | Arcane Recovery | No executor, no E2E |
| Wizard | Silvery Barbs | Detection only, TODO CO-L4 |

**Classes with zero E2E coverage:** Bard, Druid, Ranger, Sorcerer
**Classes with strong E2E coverage:** Fighter (14), Monk (20), Rogue (9), Wizard (13), Warlock (6), Barbarian (7), Paladin (5), Cleric (3)
