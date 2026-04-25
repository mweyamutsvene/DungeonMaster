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

**Problem**: Every class gets subclass at L3 (Sorc/Warlock at L1). Without features, 11/12 classes lose L3 identity. Framework EXISTS (`SubclassDefinition`, `registry.ts:getSubclassDefinition()`). Existing subclass defs are skeletal placeholders — **no mechanical executors**.

## Existing subclass defs (feature keys only, no executors)
Barbarian/Berserker, Bard/Lore, Cleric/Life, Druid/Land, Fighter/Champion, Monk/OpenHand, Paladin/Devotion, Ranger/Hunter, Rogue/Thief, Sorcerer/Draconic, Warlock/Fiend, Wizard/Evocation.

## L3 Features by Tier

### Tier A — pure functions, just need executor hookup (~2 days)

1. **Champion: Improved Critical** — crit on 19-20. `attack-resolver.ts` `isCriticalHit()` reads subclass crit range.
2. **Thief: Fast Hands** — Cunning Action BA can also Use Object / Sleight of Hand / Thieves' Tools. Extend `cunning-action-executor.ts`.
3. **Hunter: Colossus Slayer** — once/turn +1d8 vs creature below max HP. Hook in damage resolver.
4. **Open Hand: Open Hand Technique** — Flurry of Blows hits add riders (prone / push 15ft / no reaction). Extend `flurry-of-blows-executor.ts`.
5. **Draconic Resilience** — +1 HP/Sorc level + AC = 13+DEX unarmored. Hook in `getAC()` + HP hydration.
6. **Draconic Ancestry** — choose damage type; speak Draconic. Mostly cosmetic.
7. **Dark One's Blessing** — kill → gain temp HP. Needs kill-trigger event bus (new infra).

### Tier B — new executors required (~3 days; Cutting Words blocked on d20-roll-interrupt)

1. **Berserker: Frenzy** — on rage, opt for Frenzy: extra BA melee attack. Simple executor.
2. **Bard Lore: Cutting Words** — reaction; subtract BI die from roll. **BLOCKED** on plan-d20-roll-interrupt.
3. **Life Domain: Disciple of Life** — heal spells gain +(2 + spellLevel). Hook in healing handler post-roll.
4. **Devotion: Sacred Weapon** — Channel Divinity: add CHA mod to attacks + magical damage for 1 min. BA ability + active effect.
5. **Hunter's Prey** — choose Colossus Slayer / Horde Breaker / Giant Killer at L3.

### Tier C — large subsystems (out of scope for L1-5 baseline)
Battle Master Maneuvers, Eldritch Knight, Arcane Trickster, Circle of Moon (needs wild-shape-stat-swap), College of Valor, War Domain.

## Files (Tier A)

| File | Change |
|---|---|
| `domain/entities/classes/registry.ts` | Subclass lookup + `getCritRangeForActor()` |
| `domain/rules/attack-resolver.ts` | Use `getCritRangeForActor()` |
| `executors/rogue/cunning-action-executor.ts` | Add useObject/sleightOfHand choices for Thief |
| `tabletop/rolls/damage-resolver.ts` | Colossus Slayer rider for Hunter |
| `executors/monk/flurry-of-blows-executor.ts` | Open Hand Technique rider |
| `helpers/creature-hydration.ts` | Draconic Resilience HP + AC |
| `domain/entities/classes/sorcerer.ts` | L1 subclass selection; expose draconic damage type |
| `helpers/kill-trigger-bus.ts` (NEW) | On-kill event |
| `executors/warlock/dark-ones-blessing-listener.ts` (NEW) | Subscribe to kill, grant temp HP |

## Tests
- Unit: 1-2 tests per feature in existing class test files
- E2E: extend existing scenarios (e.g. Champion variant in `fighter/martial-extra-attack-l5.json` for 19-20 crits)

## Scope
- Tier A: ~2 days
- Tier B: ~3 days (Cutting Words deferred)
- Tier C: out of scope

## Unblocks
L3 identity for 7+ classes, subclass framework validated end-to-end.
