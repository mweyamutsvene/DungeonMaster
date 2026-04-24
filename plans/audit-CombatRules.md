---
type: sme-research
flow: CombatRules
feature: mechanics-audit-l1-5
author: claude-sme-combat-rules
status: DRAFT
created: 2026-04-24
updated: 2026-04-24
---

## Scope

CombatRules flow for D&D 5e 2024 L1-5 playability. Files audited in `domain/rules/`, `domain/combat/`, `domain/effects/`.

## Currently Supported (SOLID)

- **Attack resolution** (`attack-resolver.ts`): full advantage/disadvantage net logic, crits on 20, auto-miss on 1, target AC (incl. cover bonus), proficiency, ability mod. `attack.ts` handles crit dice doubling and `alwaysHits/alwaysMisses` paths.
- **Damage pipeline** (`damage.ts`): resistance/immunity/vulnerability with spell-damage immunity (Magic Missile vs Shield), temp HP absorbed first via `hit-points.ts`, full damage-type coverage (psychic/force/radiant/necrotic etc).
- **Conditions (13 of 15)** in `conditions.ts`: blinded, charmed, deafened, frightened, grappled, incapacitated, paralyzed, poisoned, prone, restrained, stunned, unconscious, invisible, petrified. AttackResolver applies advantage/disadvantage/auto-crit from conditions (prone melee-crit, incapacitated auto-hit).
- **Saving throws** (`saving-throw.ts` + `saving-throw-calculator.ts`): proficiency, ability modifier, advantage/disadvantage.
- **Ability checks/skills** (`ability-check.ts` + `skill-proficiencies.ts`): 18-skill coverage, expertise support, passive scores via `passive-scores.ts`.
- **Death saves** (`death-saves.ts`): 3/3 success/failure, nat 20 regains 1 HP + conscious, nat 1 = 2 failures, damage at 0 = 1 failure (crit = 2), massive damage instant-death threshold, stabilization clearing.
- **Initiative** (`initiative.ts`): Dex + roll, deterministic tie-breaking, tracking. **No surprise or Alert feat**.
- **Concentration** (`concentration.ts`): damage-triggered save (DC 10 or half damage), ends on unconscious/death, single-spell enforcement.
- **Movement** (`movement.ts` + `combat-map.ts`): grid, difficult terrain 2×, prone standing ½ speed, walk/climb/swim/fly speeds, BFS pathfinding, blocked-tile detection.
- **Grapple + shove** (`grapple-shove.ts`): unarmed-strike option, STR (Athletics) vs STR (Athletics)/DEX (Acrobatics) contest.
- **Cover** (`combat-map.ts`): half (+2), three-quarters (+5), total (untargetable). Ray-cast.
- **Dodge/Disengage/Dash** (`actions.ts`): Dodge disadvantage on incoming + advantage on Dex saves; Disengage prevents OA; Dash doubles speed.
- **Help, Search, Ready, Use Object** in `actions.ts`.
- **Unarmed strikes** (`attack.ts` + `grapple-shove.ts`): STR mod + proficiency, 1+STR damage, 2024 grapple/shove option chain.

## Needs Rework

1. **Critical hit damage rule (2024)**: `attack.ts` doubles all damage dice. 2024: only weapon/unarmed damage dice double, not flat magic bonuses. Verify dice-vs-flat separation.
2. **Hide action**: Present in `actions.ts` but likely stub. Needs Stealth vs passive Perception, applies Invisible until moved/attacked/noisy.
3. **Two-weapon fighting**: `attack.ts` has light-weapon bonus-action attack field; wiring through combat-orchestrator to bonus action incomplete. 2024 rule: off-hand adds ability mod only if negative (else 0).
4. **Cover + Dex save bonus**: AC works; Dex save bonus (+2/+5) from targeted-area spells (Fireball) needs verification.
5. **Surprise/Alert (2024)**: Initiative doesn't model 2024 surprise (disadvantage on initiative). Alert feat not implemented.
6. **Concentration cleanup**: Drop triggers need to cleanly remove all effect-source when spell ends mid-turn.
7. **Opportunity attack + grapple-movement**: Grapple-drag should trigger OAs for the grappler, not grappled target.
8. **Fall damage**: Not implemented. 2024: 1d6 per 10ft, max 20d6, prone on landing.

## Missing — Required for L1-5

### P0 (blocks play)
- **Exhaustion (2024)**: Completely absent. 2024: 10 levels, each = -2 to d20 tests and -1 to spell save DCs, death at 10. Barbarians and monster abilities apply exhaustion.
- **Fall damage**: No implementation. Required for shoves off ledges, Thunderwave into pits, flying creatures dropping targets.

### P1 (common)
- **Surprise (2024)**: Disadvantage on initiative for surprised creatures.
- **Alert feat (2024)**: +proficiency to initiative, can't be surprised, swap initiative.
- **Two-weapon fighting wiring** (full chain).
- **Hide full implementation**.
- **Critical damage dice-vs-flat separation**.
- **Forced movement tracking**: Thunderwave, bull rush — push distance, OA/fall interaction.
- **Grappled escape action**: Target uses Action to escape (STR/DEX vs grappler's DC). Initial grapple exists; escape not wired.

### P2 (edge case, likely hit before L5)
- **Suffocation / drowning / environment damage**: CON save for drowning, suffocation round tracker, lava/acid zones.
- **Disease/poison long-term effects**: Generic Poisoned covered; specific diseases not modeled.
- **Petrified damage-defense stack**: Full resistance to all damage + immunity to disease/poison progression.
- **Mounted combat**: Mount/rider relationship, controlled vs independent, targeting.
- **Two-weapon fighting style**: Fighter/Ranger feature to add ability mod to off-hand.
- **Grappled creature drags**: Move at ½ speed while grappling + grappled creature moves with you.
- **Readied spell slot timing**: 2024: slot consumed when readied, not on trigger.
- **Crit fishing on paralyzed/unconscious**: Melee within 5ft auto-crit on hit — verify both condition paths.

## Cross-Flow Dependencies

- **ActionEconomy**: Dodge/Disengage/Dash/Hide/Help/off-hand/grapple-escape budgeting.
- **ReactionSystem**: OAs, Ready triggers, Shield spell.
- **ClassAbilities**: TWF fighting style, Sneak Attack crit interaction, Barbarian rage damage resistance stacking, Monk unarmed d-dice scaling.
- **SpellSystem**: Concentration-dropping, spell-save DC consumption, AoE cover.
- **EntityManagement**: HP/temp-HP mutation, exhaustion level persistence.
- **AIBehavior**: Passive consumer — condition predicates, movement costs, cover.

## Summary

**CombatRules engine is ~80% of the way to L1-5 readiness.** Attack/damage/save/death/initiative/concentration/movement/cover/grapple are solid. **Must-fix before L1-5 play**: exhaustion (completely absent) and fall damage (absent). **Should-fix**: 2024 surprise, Alert feat, two-weapon fighting wiring, crit damage dice-vs-flat separation, Hide action depth.
