---
type: sme-feedback
flow: ClassAbilities
feature: crossflow-priority-table-reaudit
author: ClassAbilities-SME
status: IN_REVIEW
round: 1
created: 2026-04-26
updated: 2026-04-26
---

# Scope
- Audited only Section 4 (`Cross-Flow Priority Table`) rows tied to ClassAbilities and CreatureHydration crossover:
  - Tier1: #9b, #10, #11, #12, #14, #15, #18
  - Tier2: #7, #8, #17, #18, #19, #20
- Verification sources: live code paths (domain + application), executor registration, and current deterministic scenarios.

# Findings
| Row | Verdict | Evidence |
|---|---|---|
| Tier1 #9b | STALE | Subclass framework and multiple L3 mechanics are live (e.g., Champion crit threshold in `attack-resolver.ts` + `roll-state-machine.ts`, Fiend temp-HP hook in tabletop/AI resolvers, Fast Hands in rogue executor, Sacred Weapon executor present). Row claim that ~7 subclass mechanics are still missing is over-broad/outdated. |
| Tier1 #10 | INCORRECT | Row says grouped executor work is DONE, but runtime is mixed: `SteadyAimExecutor`, `InnateSorceryExecutor`, `DivineSparkExecutor`, `MagicalCunningExecutor`, `TacticalMindExecutor` exist and are registered in `app.ts`; no Wizard executor path for Ritual Adept; Slow Fall is in `pit-terrain-resolver.ts`; Cunning Strike is inline in `damage-resolver.ts`; Sorcerous Restoration is rest-refresh policy in `sorcerer.ts`. |
| Tier1 #11 | STALE | Stunning Strike and Divine Smite are inline in `hit-rider-resolver.ts`, but Cunning Strike now resolves in `damage-resolver.ts` (not in `hit-rider-resolver.ts`). Consolidation claim needs location correction. |
| Tier1 #12 | INCORRECT | Claim says no kill-trigger path for patron hooks. Dark One's Blessing currently triggers on KO in both tabletop (`damage-resolver.ts`) and AI (`ai-attack-resolver.ts`) using `qualifiesForDarkOnesBlessing`/`darkOnesBlessingTempHp`. |
| Tier1 #14 | ACCURATE | `cleric.ts` has no Divine Order feature key/capability/runtime path; no `DIVINE_ORDER` usage in class flow. |
| Tier1 #15 | ACCURATE | `druid.ts` has no Primal Order feature key/capability/runtime path; no `PRIMAL_ORDER` usage in class flow. |
| Tier1 #18 | INCORRECT | Row marks Sear Undead as false positive via Destroy Undead threshold. Live code implements Destroy Undead CR-threshold behavior in Turn Undead path (`class-ability-handlers.ts` + `getDestroyUndeadCRThreshold`), but 2024 Sear Undead is separate radiant-damage rider and is not implemented as stated. |
| Tier2 #7 | ACCURATE | Cunning Strike options (including Disarm + Daze) are implemented in `damage-resolver.ts` with save/effect handling. |
| Tier2 #8 | ACCURATE | Tactical Mind interrupt option is wired in `roll-interrupt-resolver.ts` (`_addTacticalMindOption`). |
| Tier2 #17 | STALE | Not fully MISSING anymore: hydration parses `asiChoices` and `Character.getEffectiveAbilityScores()` applies them (tested in `character-em.test.ts`), but AC/attack/save paths still predominantly use base `abilityScores` (`Creature.getAbilityModifier`, `Character.getAC`). |
| Tier2 #18 | ACCURATE | Mage Armor-specific hydration detection is still absent (no `mageArmor*` handling in `creature-hydration.ts`). |
| Tier2 #19 | ACCURATE | Partial parity statement remains valid: weapon magic bonus support exists in attack paths, but broad cross-path parity remains incomplete. |
| Tier2 #20 | ACCURATE | Wild Shape reverse hydration/projected vitals are wired (`wild-shape-form-helper.ts` + `creature-hydration.ts` + tabletop/AI damage routing). |

# Suggested row edits
Replace only stale/incorrect rows with the exact lines below.

`| 9b | **Subclass L3 features for 12 classes** | ClassAbilities | Framework + typed definitions are live, and several L3 subclass mechanics are implemented (Champion crit threshold, Berserker Frenzy, Open Hand Technique, Thief Fast Hands, Hunter Colossus Slayer, Life Disciple of Life, Devotion Sacred Weapon, Fiend Dark One's Blessing). Remaining gaps are subclass breadth (e.g., Battle Master/Eldritch Knight/Arcane Trickster, Hunter Horde Breaker/Giant Killer, Cutting Words save/damage-path parity). |`

`| 10 | **Class feature runtime coverage (grouped)** | ClassAbilities | Mixed state: executors are live for Steady Aim, Innate Sorcery, Divine Spark, Magical Cunning, Tactical Mind; Cunning Strike resolves inline in damage-resolver; Tactical Shift is piggybacked in Second Wind execution; Slow Fall is handled in pit-terrain resolver; Sorcerous Restoration is rest-refresh policy only; Ritual Adept is still capability text without runtime cast-path support. |`

`| 11 | **Stunning Strike / Divine Smite / Cunning Strike architectural consolidation** | ClassAbilities | Partial consolidation target remains: Stunning Strike + Divine Smite are inline in `hit-rider-resolver.ts`; Cunning Strike is inline in `damage-resolver.ts` (not hit-rider). Dedicated executor unification is still pending. |`

`| 12 | **Patron subclass combat hooks** | ClassAbilities | Dark One's Blessing is already wired on KO in both tabletop and AI attack resolvers via `qualifiesForDarkOnesBlessing`/`darkOnesBlessingTempHp`; broader patron trigger architecture is still fragmented (no generalized event-bus pattern). |`

`| 18 | **Sear Undead (Cleric L5)** | ClassAbilities | Not implemented as 2024 Sear Undead radiant rider. Current Turn Undead path implements Destroy Undead CR-threshold auto-destroy behavior instead. |`

`| 17 | ASI merging into effective ability scores | CreatureHydration | PARTIAL: `asiChoices` are hydrated and `Character.getEffectiveAbilityScores()` applies ASI choices, but AC/attack/save pipelines still rely primarily on base ability scores and do not consistently consume effective scores. |`

# Verdict summary
- `ACCURATE`: 6 rows
- `STALE`: 3 rows
- `INCORRECT`: 3 rows
- Net: Cross-flow table is directionally good, but key ClassAbilities rows (#10/#12/#18) currently overstate or mischaracterize live behavior and should be patched before using this table for prioritization.