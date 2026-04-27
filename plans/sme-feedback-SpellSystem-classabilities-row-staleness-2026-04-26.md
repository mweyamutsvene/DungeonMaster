---
type: sme-feedback
flow: SpellSystem
feature: classabilities-row-staleness-2026-04-26
author: SpellSystem-SME
status: IN_REVIEW
round: 1
created: 2026-04-26
updated: 2026-04-26
---

## Verdict
APPROVED

## Findings
- Bard: Planned shift to Bard College PARTIAL is consistent with current runtime. Cutting Words is wired for attack-reaction flow, while broader trigger coverage remains incomplete.
- Cleric: Planned split to Turn Undead SUP vs Divine Spark PARTIAL is correct. Divine Spark executor returns payload, but ClassAbility dispatch only has explicit post-processing for Turn Undead.
- Druid: Planned Spellcasting/Wild Shape wording is consistent with current code direction; no SpellSystem conflict found.
- Paladin: Planned row corrections are accurate for spellcasting-adjacent claims (Divine Sense currently modeled under L3 Channel Divinity, Divine Health missing, Faithful Steed missing).
- Ranger: Planned update to Favored Enemy/Hunter's Mark SUP and Hunter L3 support aligns with current resource + subclass wiring.
- Sorcerer: Planned downgrades to Innate Sorcery PARTIAL and Metamagic PARTIAL are correct. Innate Sorcery lacks strict RAW scoping/uses enforcement; Twinned currently activates/spends SP without full cast-chain delivery.
- Warlock: Planned move to L3 subclass defs PARTIAL and keeping Pact Boon MISSING is correct.
- Wizard: Planned Ritual Adept MISSING and Arcane Tradition PARTIAL are correct. Cast path still enforces prepared/known lists and ritual-mode integration is not wired in SpellActionHandler/API.

## Required Fixes (if any)
- None.

## Optional Improvements
- In the Sorcerer row note, explicitly mention that Sorcerous Restoration currently works via rest-refresh policy but has thinner feature-specific scenario evidence; this clarifies why it is marked PARTIAL.
- In the Wizard row note, optionally include "ritual mode not wired through cast API" to make the Ritual Adept MISSING rationale self-evident to future reviewers.
