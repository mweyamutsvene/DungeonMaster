---
type: plan
flow: SpellSystem
feature: spell-preparation-enforcement
author: DMDeveloper
status: COMPLETE
round: 1
created: 2026-04-26
updated: 2026-04-26
---

# Plan: Spell Preparation Enforcement at Cast Time

## Objective
D&D 2024 rules require prepared casters (Wizard, Cleric, Druid, Paladin) to only cast spells
they have prepared after a Long Rest. Known casters (Bard, Sorcerer, Warlock, Ranger) can only
cast from their fixed known list. Currently the game resolves and executes any spell by name
regardless of whether it's on the caster's prepared/known list. The domain logic already exists
in `spell-preparation.ts` — it just isn't wired into the cast-time path.

## Affected Flows
- **SpellSystem** — `spell-action-handler.ts` (tabletop player path)
- **AISpellEvaluation** — AI only picks from `sheet.spells` already, but should also respect enforcement
- **EntityManagement** — `preparedSpells` shape on character/NPC sheets

---

## Changes

### SpellSystem

#### File: `packages/game-server/src/application/services/combat/tabletop/spell-action-handler.ts`
- [x] Import `getSpellCasterType` and `isSpellAvailable` from `domain/rules/spell-preparation.ts`
- [x] After `resolveSpell()` and cantrip check, add a preparation guard:
  - Determine `classId` from `sheet.classId ?? character.className?.toLowerCase()`
  - Call `getSpellCasterType(classId)` — skip guard for `"none"`
  - For cantrips (`spellLevel === 0`) skip the check
  - For leveled spells: read `sheet.preparedSpells` (array of `{ name, level }` objects or strings) and `sheet.knownSpells`
  - Normalize: extract spell names (handles both `string[]` and `{ name: string }[]` shapes)
  - Call `isSpellAvailable(spellName, preparedNames, knownNames)` — throw `ValidationError` if false
  - Error message: `"${spellName} is not prepared. Prepare spells during a Long Rest."`
- [x] Backward-compat: `isSpellAvailable` already returns `true` when both lists are empty/undefined — no change needed for legacy characters

#### File: `packages/game-server/src/domain/rules/spell-preparation.ts`
- [x] Update `isSpellAvailable` to accept both `string[]` and `{ name: string }[]` for
  `preparedSpells` and `knownSpells`, doing case-insensitive name matching (currently only
  handles `string[]`). This unifies the two sheet shapes.

#### File: `packages/game-server/src/application/services/combat/ai/handlers/cast-spell-handler.ts`
- [x] The AI path resolves the actor's sheet via `getNpcMechanicsSource`. Add the same preparation
  guard here so AI-controlled NPCs (class-backed) are also enforced. The AI spell evaluator
  already only picks from `sheet.spells`, so this is a safety net, not a logic change.

### EntityManagement

#### File: `packages/game-server/src/infrastructure/api/routes/sessions/session-creatures.ts`
- [x] On NPC creation, if `className` is provided, document (comment) that `sheet.preparedSpells`
  or `sheet.spells` must be populated for spell enforcement to work. No code change needed —
  enforcement is permissive when list is empty.

---

## Cross-Flow Risk Checklist
- [x] Do changes in one flow break assumptions in another?
  - The backward-compat clause (`isSpellAvailable` returns `true` when list is empty) protects
    all existing E2E scenarios that don't define `preparedSpells`/`knownSpells`.
- [x] Does the pending action state machine still have valid transitions?
  - Enforcement throws `ValidationError` before any state mutation, so state is untouched.
- [x] Is action economy preserved?
  - Validation is a read-only guard; no economy changes.
- [x] Do both player AND AI paths handle the change?
  - Yes: tabletop handler + AI cast handler both get the guard.
- [x] Are repo interfaces + memory-repos updated if entity shapes change?
  - No entity shape change. `preparedSpells` already exists on sheet JSON.
- [x] Is `app.ts` registration updated if adding executors?
  - No new executors.
- [x] Are D&D 5e 2024 rules correct (not 2014)?
  - Yes: 2024 rules — prepared/known spell lists enforced, cantrips always available.

## Risks
- **`preparedSpells` shape inconsistency**: Character sheets from the LLM generator use
  `{ name, level }[]` objects; the `isSpellAvailable` function currently expects `string[]`.
  Must unify the comparison in `isSpellAvailable` or normalize before calling it.
  *Mitigation*: update `isSpellAvailable` signature to accept both, or add a normalizer.
- **Solo-wizard and existing scenarios**: These define `preparedSpells` as object arrays
  (`{ name, level }[]`) not string arrays. If enforcement runs against them, name matching
  must handle objects correctly or tests break.
  *Mitigation*: covered by the shape-unification fix above.
- **AI scenario authors**: AI spell evaluator picks from `sheet.spells` not `sheet.preparedSpells`.
  If an NPC sheet defines `spells` but not `preparedSpells`, AI picks the spell but enforcement
  blocks the cast. Authors must keep the two lists in sync, or enforcement should treat `sheet.spells`
  as the source of truth for class-backed NPCs.
  *Resolution needed*: decide whether `sheet.spells` also satisfies the prepared list for NPCs.
  Recommended: for class-backed NPCs, treat `sheet.spells` names as the prepared list.

## Open Questions
- [x] For class-backed NPC wizard (like Elara), should `sheet.spells` entries satisfy the
  preparation check, or must `sheet.preparedSpells` also be populated?
  *Resolution*: implemented fallback so class-backed NPCs can satisfy enforcement via `sheet.spells`
  when `preparedSpells`/`knownSpells` are absent.
- [x] Should the error be surfaced differently for AI casters (log warning + skip vs. hard throw)?
  *Resolution*: hard validation error is used to match player enforcement semantics.

## Test Plan
<!-- Each item below requires actual test code to be written. -->
- [x] Unit: `spell-preparation.ts` — `isSpellAvailable` handles `{ name, level }[]` object arrays (case-insensitive)
- [x] Unit: `spell-action-handler.test.ts` — casting unprepared leveled spell throws ValidationError for Wizard
- [x] Unit: `spell-action-handler.test.ts` — casting cantrip always succeeds regardless of prepared list
- [x] Unit: `spell-action-handler.test.ts` — casting prepared spell succeeds
- [x] Unit: `spell-action-handler.test.ts` — legacy sheet (no preparedSpells) passes enforcement (backward compat)
- [x] Unit: `spell-action-handler.test.ts` — non-caster class (Fighter) not subject to enforcement
- [x] E2E: `scripts/test-harness/scenarios/wizard/spell-preparation-enforced.json` — Wizard attempts to cast unprepared spell, gets validation error
- [x] Integration: `src/infrastructure/api/app.test.ts` — combat action endpoint rejects unprepared leveled spell with HTTP 400

## SME Approval (Complex only)
- [ ] SpellSystem-SME

## Completion Notes
- Full validation gates are green: typecheck, full unit/integration tests, full E2E `--all`.
- Plan executed directly via DMDeveloper workflow on user request.
