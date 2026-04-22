# SME Research — SpellSystem — L1-5 Class Spell Catalog Audit

> Note: this file complements `sme-research-SpellSystem.md` (which is narrowly scoped to GAP-6/8/11 root-cause analysis). This file is the broader inventory + architectural gap survey the orchestrator requested.

## Scope
- `domain/entities/spells/catalog/` (cantrips + level-1..5)
- `application/services/combat/tabletop/spell-delivery/` (5 handlers)
- `domain/rules/concentration.ts`
- `tabletop/rolls/damage-resolver.ts` — where Hex/Hunter's Mark riders apply
- `scripts/test-harness/scenarios/class-combat/COVERAGE.md` — existing GAPs

## Catalog Inventory (what IS implemented)

**Cantrips (8):** Eldritch Blast, Fire Bolt, Produce Flame, Sacred Flame, Ray of Frost, Toll the Dead, Chill Touch, Booming Blade.

**Level 1 (25):** Absorb Elements, Bane, Bless, Burning Hands, Cause Fear, Cure Wounds, Detect Magic, Guiding Bolt, Healing Word, Hellish Rebuke, Heroism, Inflict Wounds, Longstrider, Mage Armor, Magic Missile, Shield, Silvery Barbs, Shield of Faith, Thunderwave, Thunderous Ward, Command, Faerie Fire, Hex, Hunter's Mark, Sleep.

**Level 2 (13):** Cloud of Daggers, Hold Person, Misty Step, Moonbeam, Scorching Ray, Shatter, Spike Growth, Spiritual Weapon, Aid, Darkness, Invisibility, Lesser Restoration, Web.

**Level 3 (5):** Counterspell, Dispel Magic, Fireball, Revivify, Spirit Guardians.

**Level 4 (6):** Wall of Fire, Banishment, Polymorph, Greater Invisibility, Ice Storm, Dimension Door.
**Level 5 (6):** Cone of Cold, Hold Monster, Wall of Force, Animate Objects, Telekinesis, Cloudkill.

## MISSING Class-Essential Spells (L1-3, high class-identity impact)

| Spell | Lvl | Class | Identity impact |
|-------|-----|-------|-----------------|
| **Divine Favor** | 1 | Paladin | HIGH — baseline +1d4 radiant rider |
| **Searing / Thunderous / Wrathful Smite** | 1 | Paladin | HIGH — Paladin smite-spell kit empty |
| **Branding Smite / Magic Weapon / Blinding Smite** | 2 / 2 / 3 | Paladin | MED-HIGH |
| **Ensnaring Strike / Hail of Thorns** | 1 | Ranger | MED — Ranger rider-on-attack kit |
| **Pass Without Trace** | 2 | Ranger/Druid | HIGH — party aura staple |
| **Summon Beast / Conjure Animals** | 2 / 3 | Druid/Ranger | HIGH — needs summon delivery mode |
| **Entangle** | 1 | Druid | HIGH — Druid L1 control |
| **Goodberry** | 1 | Druid/Ranger | MED — sustained healing |
| **Call Lightning** | 3 | Druid | HIGH — Druid L3 signature |
| **Chaos Bolt** | 1 | Sorcerer | MED — Sorcerer signature |
| **Mirror Image** | 2 | Sorcerer/Wizard/Warlock | HIGH — defensive staple |
| **Haste / Fly** | 3 | Sorcerer/Wizard | HIGH |
| **Hypnotic Pattern** | 3 | Bard/Sorcerer/Warlock/Wizard | HIGH — L3 control staple |
| **Suggestion** | 2 | Bard/Sorcerer/Warlock/Wizard | HIGH — Bard identity |
| **Mass Healing Word** | 3 | Bard/Cleric | HIGH — Cleric L3 core |
| **Armor of Agathys** | 1 | Warlock | HIGH — Warlock L1 signature |
| **Agonizing Blast (invocation)** | — | Warlock | HIGH — core Warlock damage (CHA to EB). Not a spell but class-feature gap. |
| **Prayer of Healing** | 2 | Cleric/Bard | LOW (out-of-combat) |

## BROKEN / Partial Spells (in catalog but don't work correctly)

| Spell | Problem | Evidence |
|-------|---------|----------|
| **Eldritch Blast + Hex** (GAP-6) | Catalog + delivery appear correct; scenario logs show base beam damage only. See companion file `sme-research-SpellSystem.md` for localisation (A: stale-resources stomp in bonusActionUsed patch; B: `createEffect` may drop `diceValue`). | COVERAGE.md:167-169 |
| **Bane** (GAP-BANE) | COVERAGE.md says "not in catalog" — **stale**. Bane IS present in level-1.ts:45 with proper penalty+diceValue effects. Save-on-cast path in BuffDebuffHandler (:171) may be skipping effect application incorrectly. Needs scenario re-run + doc update. | level-1.ts:45; buff-debuff :164-180 |
| **Spiritual Weapon** | Only initial cast creates a spell attack. TODO: "Subsequent turns allow bonus action to move weapon 20ft + repeat attack" — no mechanism to spawn persistent entity or reuse bonus action. | level-2.ts:200 |
| **Dispel Magic** | Effect is `{type:'custom', target:'custom'}` — no handler consumes `custom`. Effectively no-op. | level-3.ts:27 |
| **Counterspell** | Listed with `castingTime:'reaction'` but no effects wired. Would fall through the 5-handler chain. Only works if reaction handler claims it — not verified. | level-3.ts:13 |
| **Silvery Barbs** | Reaction spell (force reroll) — same reaction-delivery gap as Counterspell. | level-1.ts:344 |
| **Absorb Elements** | Reaction spell (resistance + +1d6 next melee) — same reaction gap. | level-1.ts:14 |
| **Aid** | `{type:'custom', target:'hit_points'}` — no `+5 max HP per target` logic; no-op. | level-2.ts:204 |
| **Lesser Restoration** | Likely `custom`-typed condition removal, no generic consumer — verify. | level-2.ts:275 |
| **Command** | Uses `conditions.onFailure:['Incapacitated']` — the 2024 command keywords (flee/halt/drop/grovel/approach) collapse to one-turn Incapacitated. Functional but coarse. | level-1.ts:433 |
| **Sleep** | "Spell ends when target takes damage" auto-wake rule is not wired to damage events; Unconscious persists until concentration drops. | level-1.ts:526 |
| **Faerie Fire** | `advantage` on `attack_rolls` with `appliesTo:'target'`. BuffDebuffHandler's advantage-scope branch (:219-226) only sets `targetCombatantId` when `appliesTo:'enemies'`. Faerie Fire may leak advantage to ALL attacks, not just attacks against the illuminated target. | level-1.ts:450; buff-debuff :219 |
| **Hunter's Mark (2024 transfer rule)** | Core rider works. 2024 rule "move mark to new target as bonus action when original drops to 0 HP" not wired. | level-1.ts:503 |

## Architectural Gaps (spells that don't fit 5 delivery modes)

1. **Reaction-cast spells** — Counterspell, Silvery Barbs, Absorb Elements. Shield/Hellish Rebuke work via `ClassCombatTextProfile.attackReactions`; reaction-spell coverage is incomplete. The 5-handler `canHandle` chain only fires on the caster's turn.
2. **Summoned entities** — Spiritual Weapon (repeat), Summon Beast, Conjure Animals, Animate Objects. No delivery mode spawns a combatant with its own turn + concentration linkage.
3. **Bonus-action "rider on next weapon hit"** — Paladin smite spells (Searing/Thunderous/Wrathful/Branding/Blinding), Divine Favor, Ensnaring Strike, Hail of Thorns. Pattern exists: `hit-rider-resolver.ts` already consumes a `"divine-smite"` keyword on hit. **Reuse:** extend BuffDebuff to install `triggerAt:'on_next_weapon_hit'` effects on caster; extend hit-rider-resolver to consume them and clear.
4. **Aura-around-caster skill/save buffs** — Pass Without Trace (+10 Stealth aura), Aura of Protection (future). `zones.ts` supports passive zone bonuses for `saving_throws`; extend to `ability_checks` with skill filter.
5. **Max-HP modifiers** — Aid (+5 max HP per slot). Needs new `max_hp_bonus` effect type honoured by HP cap logic.
6. **Temp-HP + retaliation self-buff** — Armor of Agathys. Retaliatory damage plumbing exists (attack-action-handler:313); missing piece is temp-HP grant + on-hit-against-self trigger.

## Class-Feature Spells — Current Status

| Feature | Spell? | Implementation | Gap |
|---------|--------|----------------|-----|
| Divine Smite | No (feature, burns slot) | `hit-rider-resolver.ts` via `"divine-smite"` keyword | Works. Pattern reusable for smite SPELLS. |
| Paladin smite spells | Yes (Searing etc.) | **Not in catalog** | Install `nextHitRider` effect via BuffDebuff. |
| Hunter's Mark rider | Yes | `damage-resolver.ts:151` filter, targetCombatantId-scoped | Works for weapon attacks; verify on spell attacks; 2024 transfer rule missing. |
| Hex rider | Yes | Same pipeline as Hunter's Mark | GAP-6 — see companion file for root-cause. |
| Bardic Inspiration | No — resource | `bard/bardic-inspiration-executor.ts` | Works. |
| Wild Shape | No — resource | `druid/wild-shape-executor.ts` | Works. |
| Metamagic | No — feature+cost | `sorcerer/quickened-spell-executor.ts`, `twinned-spell-executor.ts` + `METAMAGIC` feature flag | Works. |
| Channel Divinity / Turn Undead | No — resource | `paladin/channel-divinity-executor.ts`, `cleric/turn-undead-executor.ts` | Works. |
| Eldritch Invocations (Agonizing Blast) | No — feature | **Not implemented** | HIGH — missing Warlock core damage modifier. |

## Recommendations

### Fix GAP-6 (Hex on EB beams)
See `sme-research-SpellSystem.md` for full analysis. Summary: write a focused unit test that casts Hex and asserts the caster's `activeEffects` contains the `diceValue:{1,6}` effect with correct `targetCombatantId`; localise between (A) bonusActionUsed patch stomping resources and (B) `createEffect` dropping `diceValue`.

### Fix GAP-11/GAP-BANE (Bane no-op)
1. Mark COVERAGE.md stale — Bane IS in catalog.
2. Verify BuffDebuffHandler save-on-cast path at :171 — `resolveSaveForTarget` may short-circuit (null resolver, or all-fail path).
3. Add unit test: cast Bane on 3 monsters with mocked saves (1 fail, 2 succeed); assert exactly 1 target has the penalty effect.
4. Scenario `class-combat/cleric/bless-and-bane-party` should assert penalty dice on the failed-save monster's attack roll.

### Priority for new catalog work (by class identity cost)
1. **Paladin smite spells + Divine Favor** — biggest identity hole.
2. **Druid: Entangle + Pass Without Trace + Call Lightning**.
3. **Wizard/Sorcerer: Mirror Image + Haste + Fly + Hypnotic Pattern**.
4. **Warlock: Armor of Agathys + Agonizing Blast invocation**.
5. **Bard: Suggestion + Hypnotic Pattern + Mass Healing Word**.
6. **Ranger: Ensnaring Strike + Hail of Thorns + Pass Without Trace**.

### Delivery-mode extensions (one extension unlocks many spells)
- **`nextHitRider` effect support** in BuffDebuff + hit-rider-resolver → unlocks ~8 smite/Divine Favor/Ensnaring Strike/Hail of Thorns.
- **Reaction-spell routing** (generalise Shield/Hellish Rebuke pattern) → unlocks Counterspell + Silvery Barbs + Absorb Elements.
- **Summon delivery handler** (spawn ephemeral combatant tied to caster) → unlocks Spiritual Weapon repeat + Summon Beast + Conjure Animals.
- **`max_hp_bonus` effect type** → unlocks Aid.
- **Aura-bonus for ability_checks** → unlocks Pass Without Trace.

## Invariants (do not violate)
- Concentration: one concentration spell per caster; new cast drops prior. `concentration.ts` state machine is authoritative.
- Concentration DC on damage: `max(10, floor(damage/2))`, auto-fail on Unconscious.
- Slot expenditure happens BEFORE handler dispatch in `SpellActionHandler`; delivery handlers read `encounter`/`combatants` AFTER slot deduction.
- Caster-side damage riders (Hex/Hunter's Mark) MUST be installed on the CASTER's resources with `targetCombatantId` scoping — never on the victim.
- Reaction spells MUST NOT be routed through the 5-handler `canHandle` chain on the caster's turn — they fire via reaction handler.

## Risks
1. Hex GAP-6 root-cause not conclusively localised without runtime trace. Runtime repro is fast (existing failing scenario).
2. Extending BuffDebuff save-on-cast semantics (for Bane) risks breaking Bless/Faerie Fire — needs sweep.
3. Adding `nextHitRider` touches hit-rider-resolver which already handles Divine Smite — regressions possible if the slot-picker UX is duplicated.
4. Counterspell is a PendingAction state-machine change — high effort. Defer unless explicitly scoped.
