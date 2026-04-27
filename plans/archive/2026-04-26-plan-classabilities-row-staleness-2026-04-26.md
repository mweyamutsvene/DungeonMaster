---
type: plan
flow: ClassAbilities
feature: classabilities-row-staleness-2026-04-26
author: DMDeveloper
status: COMPLETE
round: 1
created: 2026-04-26
updated: 2026-04-26
---

# Plan: ClassAbilities Row Staleness Refresh
## Round: 1
## Status: COMPLETE
## Affected Flows: ClassAbilities, ReactionSystem, SpellSystem, EntityManagement

## Objective
Refresh only section `2.2 ClassAbilities` in `plans/mechanics-and-coverage-report.md` so each class row reflects verified runtime behavior, wiring, and scenario/test evidence as of 2026-04-26. No mechanics implementation changes are in scope; this is a documentation truth pass driven by serialized DMDeveloper row audits.

## Normalization Rules
- [x] Use row-level statuses conservatively: prefer `PARTIAL` when behavior is implemented but scope/cadence/coverage is incomplete.
- [x] Use full status words only in row text and avoid introducing pseudo-status tags.
- [x] For every `MISSING -> PARTIAL/SUPPORTED` change, cite at least one runtime-path source and one test/scenario source in the row research file.

## Inputs Collected
- [x] Barbarian row audit: `plans/sme-research-ClassAbilities-row-barbarian.md`
- [x] Bard row audit: `plans/sme-research-ClassAbilities-row-bard.md`
- [x] Cleric row audit: `plans/sme-research-ClassAbilities-row-cleric.md`
- [x] Druid row audit: `plans/sme-research-ClassAbilities-row-druid.md`
- [x] Fighter row audit: `plans/sme-research-ClassAbilities-row-fighter.md`
- [x] Monk row audit: `plans/sme-research-ClassAbilities-row-monk.md`
- [x] Paladin row audit: `plans/sme-research-ClassAbilities-row-paladin.md`
- [x] Ranger row audit: `plans/sme-research-ClassAbilities-row-ranger.md`
- [x] Rogue row audit: `plans/sme-research-ClassAbilities-row-rogue.md`
- [x] Sorcerer row audit: `plans/sme-research-ClassAbilities-row-sorcerer.md`
- [x] Warlock row audit: `plans/sme-research-ClassAbilities-row-warlock.md`
- [x] Wizard row audit: `plans/sme-research-ClassAbilities-row-wizard.md`

## Changes
### ClassAbilities
#### File: `plans/mechanics-and-coverage-report.md`
- [x] Barbarian row replacement
	Before:
	`| **Barbarian** | Rage (SUPPORTED), Unarmored Def (cross-flow), Weapon Mastery (cross-flow) | Reckless Attack, Danger Sense (SUPPORTED) | Primal Path mechanical features MISSING | ASI (cross-flow) | Extra Attack (cross-flow), Fast Movement SUPPORTED |`
	After:
	`| **Barbarian** | - Rage (SUPPORTED)<br>- Unarmored Defense (cross-flow)<br>- Weapon Mastery (cross-flow) | - Reckless Attack (SUPPORTED)<br>- Danger Sense (SUPPORTED) | - Primal Path mechanical features (PARTIAL)<br>- Berserker Frenzy (SUPPORTED) | - Ability Score Improvement (cross-flow) | - Extra Attack (cross-flow)<br>- Fast Movement (SUPPORTED) |`
- [x] Bard row replacement
	Before:
	`| **Bard** | Spellcasting, Bardic Inspiration grant/refresh (SUPPORTED; attack + save consumption wired via roll-interrupt hook) | Expertise, Jack of All Trades SUPPORTED | Bard College MISSING (Cutting Words require ally-scan — deferred) | ASI | Font of Inspiration + BI d8 SUPPORTED |`
	After:
	`| **Bard** | - Spellcasting (SUPPORTED)<br>- Bardic Inspiration grant/refresh (SUPPORTED; attack/save roll-interrupt consumption wired; ability-check interrupts still open) | - Expertise (SUPPORTED)<br>- Jack of All Trades (SUPPORTED) | - Bard College (PARTIAL)<br>- Cutting Words attack-reaction path (SUPPORTED)<br>- Ability-check/damage-roll trigger parity (deferred) | - Ability Score Improvement | - Font of Inspiration (SUPPORTED)<br>- Bardic Inspiration d8 scaling (SUPPORTED) |`
- [x] Cleric row replacement
	Before:
	`| **Cleric** | Spellcasting, Divine Order MISSING | Channel Divinity (Turn Undead + Divine Spark) SUPPORTED | Divine Domain MISSING | ASI | Sear/Destroy Undead SUPPORTED |`
	After:
	`| **Cleric** | - Spellcasting (SUPPORTED)<br>- Divine Order (MISSING) | - Channel Divinity: Turn Undead (SUPPORTED)<br>- Channel Divinity: Divine Spark (PARTIAL) | - Divine Domain (PARTIAL) | - Ability Score Improvement | - Destroy Undead (SUPPORTED) |`
- [x] Druid row no-op verification
	Current row already matches validated target; confirm no edit needed.
	Target:
	`| **Druid** | - Spellcasting (SUPPORTED)<br>- Primal Order (MISSING) | - Wild Shape (SUPPORTED; structured form-state swap/hydration + shared damage routing; no temp HP overlay) | - Primal Circle (PARTIAL) | - Ability Score Improvement | - Wild Resurgence (MISSING) |`
- [x] Fighter row replacement
	Before:
	`| **Fighter** | Fighting Style, Second Wind SUPPORTED, Weapon Mastery 3 (cross-flow) | Action Surge SUPPORTED, Tactical Mind SUPPORTED | Martial Archetype MISSING | ASI | Extra Attack, Tactical Shift PARTIAL |`
	After:
	`| **Fighter** | - Fighting Style (SUPPORTED)<br>- Second Wind (SUPPORTED)<br>- Weapon Mastery 3 (cross-flow) | - Action Surge (SUPPORTED)<br>- Tactical Mind (SUPPORTED) | - Champion (PARTIAL)<br>- Improved/Superior Critical (SUPPORTED)<br>- Remaining archetype mechanics (PARTIAL) | - Ability Score Improvement | - Extra Attack (SUPPORTED)<br>- Tactical Shift (PARTIAL) |`
- [x] Monk row replacement
	Before:
	`| **Monk** | Martial Arts SUPPORTED, Unarmored Def | Ki/Focus pool SUPPORTED, Flurry/Patient/Step SUPPORTED, Unarmored Movement | Deflect Attacks SUPPORTED (reaction), Monastic Tradition MISSING | ASI, Slow Fall SUPPORTED | Extra Attack, Stunning Strike PARTIAL (inline) |`
	After:
	`| **Monk** | - Martial Arts (SUPPORTED)<br>- Unarmored Defense (SUPPORTED) | - Ki/Focus pool (SUPPORTED)<br>- Flurry of Blows / Patient Defense / Step of the Wind (SUPPORTED)<br>- Uncanny Metabolism (PARTIAL; pool tracked, no initiative trigger)<br>- Unarmored Movement (PARTIAL; L2 +10 only, L6/10/14/18 scaling missing) | - Open Hand (PARTIAL)<br>- Deflect Attacks reaction (SUPPORTED)<br>- Open Hand Technique L3 + Wholeness of Body L6 (SUPPORTED)<br>- Higher-level features (MISSING) | - Ability Score Improvement<br>- Slow Fall (SUPPORTED; auto-apply, no reaction prompt) | - Extra Attack (SUPPORTED)<br>- Stunning Strike (PARTIAL; inline, success-partial branch under-covered) |`
- [x] Paladin row replacement
	Before:
	`| **Paladin** | Spellcasting, Lay on Hands SUPPORTED, Weapon Mastery 2 | Fighting Style, Divine Smite PARTIAL (inline), Channel Divinity PARTIAL | Sacred Oath MISSING | ASI, Divine Health | Extra Attack, Faithful Steed cross-flow |`
	After:
	`| **Paladin** | - Spellcasting (SUPPORTED)<br>- Lay on Hands (SUPPORTED)<br>- Weapon Mastery 2 | - Fighting Style (SUPPORTED)<br>- Divine Smite (PARTIAL; inline) | - Channel Divinity (PARTIAL; includes Divine Sense under current 2024 repository rules text)<br>- Sacred Oath (PARTIAL; Oath of Devotion Sacred Weapon implemented)<br>- Divine Health (MISSING) | - Ability Score Improvement | - Extra Attack (SUPPORTED)<br>- Faithful Steed (MISSING) |`
- [x] Ranger row replacement
	Before:
	`| **Ranger** | Spellcasting, Favored Enemy / Hunter's Mark tie PARTIAL | Fighting Style, Deft Explorer (non-combat) | Archetype MISSING, Roving | ASI | Extra Attack |`
	After:
	`| **Ranger** | - Spellcasting (SUPPORTED)<br>- Favored Enemy / Hunter's Mark tie (SUPPORTED)<br>- Weapon Mastery 2 | - Fighting Style (SUPPORTED)<br>- Deft Explorer (non-combat) | - Hunter subclass (PARTIAL)<br>- Hunters Lore / Hunters Prey / Colossus Slayer (implemented)<br>- Broader archetype breadth (pending) | - Ability Score Improvement | - Extra Attack (SUPPORTED) |`
- [x] Rogue row replacement
	Before:
	`| **Rogue** | Expertise, Sneak Attack SUPPORTED, Weapon Mastery 2 | Cunning Action SUPPORTED, Steady Aim SUPPORTED | Archetype MISSING | ASI | Uncanny Dodge SUPPORTED, Cunning Strike SUPPORTED (all 5 options) |`
	After:
	`| **Rogue** | - Expertise (PARTIAL; doubling works, class-key/auto-grant parity incomplete)<br>- Sneak Attack (SUPPORTED)<br>- Weapon Mastery 2 | - Cunning Action (SUPPORTED)<br>- Steady Aim (PARTIAL; movement precondition unenforced) | - Thief (PARTIAL; definition/feature keys present, no dedicated combat executors) | - Ability Score Improvement | - Uncanny Dodge (SUPPORTED)<br>- Cunning Strike (SUPPORTED; all 5 options, Disarm inventory-removal parity pending) |`
- [x] Sorcerer row replacement
	Before:
	`| **Sorcerer** | Spellcasting, Innate Sorcery SUPPORTED, L1 subclass defs PARTIAL | Font of Magic SUPPORTED | Metamagic SUPPORTED (Quickened/Twinned baseline) | ASI | Sorcerous Restoration SUPPORTED |`
	After:
	`| **Sorcerer** | - Spellcasting (SUPPORTED)<br>- Innate Sorcery (PARTIAL)<br>- L1 subclass definitions (PARTIAL) | - Font of Magic (SUPPORTED) | - Metamagic (PARTIAL)<br>- Quickened chained cast (SUPPORTED)<br>- Twinned activation/SP spend only | - Ability Score Improvement | - Sorcerous Restoration (PARTIAL; rest-refresh wiring present, thinner feature-specific scenario depth) |`
- [x] Warlock row replacement
	Before:
	`| **Warlock** | Pact Magic SUPPORTED, Agonizing Blast invocation SUPPORTED, L1 subclass defs PARTIAL | Magical Cunning SUPPORTED | Pact Boon MISSING | ASI | 3rd-lvl Pact slots |`
	After:
	`| **Warlock** | - Pact Magic (SUPPORTED)<br>- Agonizing Blast invocation (SUPPORTED) | - Magical Cunning (SUPPORTED) | - L3 subclass definitions (PARTIAL)<br>- Pact Boon (MISSING) | - Ability Score Improvement | - 3rd-level Pact slots (SUPPORTED) |`
- [x] Wizard row replacement
	Before:
	`| **Wizard** | Spellcasting, Ritual Adept SUPPORTED, Arcane Recovery via rest flow SUPPORTED | Scholar (2024) | Arcane Tradition MISSING | ASI | no universal |`
	After:
	`| **Wizard** | - Spellcasting (SUPPORTED)<br>- Ritual Adept (MISSING)<br>- Arcane Recovery via rest flow (SUPPORTED) | - Scholar (MISSING) | - Arcane Tradition (PARTIAL; Evocation shell only) | - Ability Score Improvement | - No universal L5 feature |`

## Cross-Flow Risk Checklist
- [x] Do changes in one flow break assumptions in another?
- [x] Does the pending action state machine still have valid transitions?
- [x] Is action economy preserved (1 action, 1 bonus, 1 reaction, 1 movement)?
- [x] Do both player AND AI paths handle the change?
- [x] Are repo interfaces + memory-repos updated if entity shapes change?
- [x] Is `app.ts` registration updated if adding executors?
- [x] Are D&D 5e 2024 rules correct (not 2014)?

## Risks
- Risk: Some proposed row text captures nuanced PARTIAL states that could be interpreted as implementation backlog items instead of doc deltas.
- Mitigation: Keep edits constrained to status/notes phrasing and cite originating row research files in commit/body.
- Risk: Cross-audit contradictions could still cause overclaims.
- Mitigation: Resolve disputed cells conservatively (`PARTIAL` + explicit caveat) and require SME sign-off on exact replacement strings before editing report content.

## Test Plan
- [x] Documentation consistency check: verify class table remains markdown-valid and aligned with section legend terms.
- [x] Targeted smoke checks for all `MISSING -> PARTIAL/SUPPORTED` upgrades in final approved rows.

## Disputed Cell Disposition
- [x] Bard L3 (Cutting Words scope): ACCEPTED as `PARTIAL`; explicitly attack-reaction only with deferred ability-check/damage-roll parity.
- [x] Monk L2/L3/L5 nuance: ACCEPTED as `PARTIAL` where execution/cadence/prompting remains incomplete.
- [x] Paladin Divine Sense placement: ACCEPTED at L3 Channel Divinity under repository 2024 source text; removed L1 mis-model caveat.
- [x] Ranger L3 archetype breadth: ACCEPTED as `PARTIAL` to avoid overclaiming full archetype surface.
- [x] Warlock subclass timing: ACCEPTED as L3 subclass defs `PARTIAL`; removed stale L1 subclass claim.

## SME Validation Plan
- [x] ClassAbilities-SME round-1 review completed (`NEEDS_WORK`): `plans/sme-feedback-ClassAbilities-classabilities-row-staleness-2026-04-26.md`
- [x] SpellSystem-SME round-1 review completed (`APPROVED`): `plans/sme-feedback-SpellSystem-classabilities-row-staleness-2026-04-26.md`
- [x] CombatRules-SME round-1 review completed (`NEEDS_WORK`): `plans/sme-feedback-CombatRules-classabilities-row-staleness-2026-04-26.md`
- [x] Challenger round-1 review completed (`BLOCKED`): `plans/challenge-classabilities-row-staleness-2026-04-26.md`
- [x] ClassAbilities-SME round-2 re-review completed (`APPROVED`): `plans/sme-feedback-ClassAbilities-classabilities-row-staleness-2026-04-26-round2.md`
- [x] CombatRules-SME round-2 re-review completed (`NEEDS_WORK`): `plans/sme-feedback-CombatRules-classabilities-row-staleness-2026-04-26-round2.md`
- [x] Challenger round-2 review completed (`PASS_WITH_FIXES`): `plans/challenge-classabilities-row-staleness-2026-04-26-round2.md`
- [x] CombatRules-SME round-3 final review completed (`APPROVED`): `plans/sme-feedback-CombatRules-classabilities-row-staleness-2026-04-26-round3.md`
- [x] Required plan fixes from validation artifacts applied.

## Exit Criteria
- [x] Consolidated plan receives APPROVED verdict from SMEs (or issues resolved).
- [x] `plans/mechanics-and-coverage-report.md` row edits are applied exactly once.
- [x] Plan status moved to COMPLETE or split with explicit deferred issues.
