---
type: sme-research
flow: ClassAbilities
feature: classabilities-row-rogue-staleness
author: DMDeveloper
status: DRAFT
round: 1
created: 2026-04-26
updated: 2026-04-26
---

# SME Research — ClassAbilities Row Audit: Rogue

## Scope

Audit the Rogue row in `plans/mechanics-and-coverage-report.md` §2.2 Per-class status table. Covers L1-L5 claims only (L7+ acknowledged as out-of-scope but noted where newly green).

**Current row (§2.2):**
```
| **Rogue** | Expertise, Sneak Attack SUP, Weapon Mastery 2 | Cunning Action SUP, Steady Aim SUP | Archetype MISSING | ASI | Uncanny Dodge SUP, Cunning Strike SUP (all 5 options) |
```

---

## Row Verdict: STALE

Three cells contain incorrect/incomplete status labels. No claims are outright wrong in direction but Expertise, Steady Aim, and the Archetype cell all overstate or mischaracterize the implementation state.

---

## Evidence

### L1 — Expertise (STALE — overstated as SUP)

- `computeSkillModifier` in `packages/game-server/src/domain/entities/core/skills.ts` correctly doubles proficiency when a skill appears in the character's `skillExpertise` array — the **mechanic works**.
- `Character.skillExpertise?: string[]` exists in `packages/game-server/src/domain/entities/creatures/character.ts`.
- **Gap**: `Rogue.features` at `packages/game-server/src/domain/entities/classes/rogue.ts` contains **no `"expertise": 1` entry**. No `EXPERTISE` constant in `feature-keys.ts` for Rogue. The feature is not class-gated, not auto-granted at L1, and `classHasFeature("rogue", "expertise", 1)` returns `false`. It must be manually specified on the character sheet.
- Correct status: `PARTIAL` (mechanic ✓; class feature key absent, not auto-granted)

### L1 — Sneak Attack SUP (CORRECT)

- `isSneakAttackEligible()` fully implements class check, finesse/ranged gate, advantage-or-ally guard, once-per-turn rule (`rogue.ts` lines 50-77).
- `sneakAttackDiceForLevel()` scales 1d6→10d6 with unit test coverage at L1/2/3/5/19/20.
- Wired through `roll-state-machine.ts` → `damage-resolver.ts`.
- E2E: `class-combat/rogue/sneak-attack-advantage.json` passes.

### L1 — Weapon Mastery 2 (CORRECT)

- `weapon-mastery.ts`: `rogue: 2`
- `rogue.ts`: `"weapon-mastery": 1` (unlocks at L1)
- Unit test: `rogue.test.ts` confirms at level 1.

### L2 — Cunning Action SUP (CORRECT)

- `CunningActionExecutor` handles all 3 variants (dash/disengage/hide) via text inference or `params.choice`.
- `ROGUE_COMBAT_TEXT_PROFILE.actionMappings` has regex for all variants.
- `Rogue.features["cunning-action"]: 2` ✓
- E2E: `class-combat/rogue/cunning-escape-artist.json` exercises Disengage (R1), Hide→SA (R2), Dash (R3) ✓

### L2 — Steady Aim SUP (STALE — overstated as SUP)

- `SteadyAimExecutor` at `executors/rogue/steady-aim-executor.ts` applies `until_triggered` advantage + `speed_modifier: -9999` (speed-0) ✓
- **Documented gap in executor file (line 10)**: *"The 'haven't moved this turn' precondition is not yet enforced."* Any rogue can currently use Steady Aim after moving — rules violation.
- Correct status: `PARTIAL` (advantage+speed-0 ✓; movement-precondition unenforced)

### L3 — Archetype MISSING (STALE — understates: definition exists)

- `ThiefSubclass` IS defined in `rogue.ts` lines 82-90 with feature keys: `fast-hands: 3`, `second-story-work: 3`, `supreme-sneak: 9`, `use-magic-device: 13`, `thiefs-reflexes: 17`
- All feature constants exist in `feature-keys.ts` lines 72-77.
- `classHasFeature("rogue", FAST_HANDS, 3, "thief")` returns `true` (confirmed by `subclass-framework.test.ts` lines 197-203).
- `Rogue.subclasses = [ThiefSubclass]` ✓
- **Gap**: Zero combat executors exist for any Thief feature — no `fast-hands-executor.ts`, `second-story-work-executor.ts`, etc. under `executors/rogue/`. Domain defs + feature keys only; no combat wiring.
- Correct status: `Thief DEF` (not `MISSING`) — definition + keys wired; combat executors absent

### L4 — ASI (CORRECT)

Cross-flow. `asiChoices` stored/validated on character sheet for all classes; rogue-specific gate not needed.

### L5 — Uncanny Dodge SUP (CORRECT)

- `UNCANNY_DODGE_REACTION` AttackReactionDef gated on `classHasFeature(…, UNCANNY_DODGE, level)` in `rogue.ts` lines 155-172.
- `Rogue.features["uncanny-dodge"]: 5` ✓
- 5 unit test cases for detection/non-detection in `rogue.test.ts` lines 63-95.
- E2E: `cunning-escape-artist.json` (triggers UD via guaranteed-hit in R2); `evasion-vs-aoe.json` also exercises UD ✓

### L5 — Cunning Strike SUP all 5 (CORRECT with minor caveat)

- All 5 in `damage-resolver.ts` `resolveCunningStrike()` (~line 914):
  - **withdraw**: sets `disengaged: true` on actor resources ✓
  - **daze** (2d cost): CON save → `reactionUsed: true` + `dazedNextTurn: true`; SA-dice cost in `roll-state-machine.ts` ~line 1051 ✓
  - **disarm**: STR save → narration "Drops a held weapon" — **no actual `ItemService` call; item stays in inventory**
  - **poison**: CON save → Poisoned condition via hit-rider pipeline ✓
  - **trip**: DEX save → Prone condition via hit-rider pipeline ✓
- `parseCunningStrikeOption()` parses all 5 from text (`rogue.ts` lines 19-24) ✓
- Unit tests for all 5 variants (`rogue.test.ts` lines 7-27) ✓
- Minor caveat worth noting in the cell: Disarm is narrative only (no item removal)

---

## Additional Finding: Evasion at L7 (Beyond scope — already green)

Not in the L5 row (correct), but worth noting:
- `Rogue.features["evasion"]: 7` defined
- Fully implemented: `evasion.ts`, `saving-throw-resolver.ts`, `save-spell-delivery-handler.ts`, `zone-damage-resolver.ts`
- E2E: `class-combat/rogue/evasion-vs-aoe.json` passes (L7 Thief Rogue, DEX save → 0 damage path)
- The report's L5 column does not mention Evasion — that is **correct** (Evasion is L7)

---

## Proposed Row Edits

Replace the current row:
```markdown
| **Rogue** | Expertise, Sneak Attack SUP, Weapon Mastery 2 | Cunning Action SUP, Steady Aim SUP | Archetype MISSING | ASI | Uncanny Dodge SUP, Cunning Strike SUP (all 5 options) |
```

With:
```markdown
| **Rogue** | Expertise PARTIAL (doubling ✓; no class feature key, not auto-granted), Sneak Attack SUP, Weapon Mastery 2 | Cunning Action SUP, Steady Aim PARTIAL (effect ✓; movement precondition unenforced) | Thief DEF (definition + feature keys ✓; no combat executors for fast-hands/second-story-work) | ASI | Uncanny Dodge SUP, Cunning Strike SUP (all 5; Disarm narrative-only — no item removal) |
```

---

## Risks

- **Expertise auto-grant gap**: Characters relying on manual `skillExpertise` array are functional but Rogue L1 auto-grant is missing. Low combat impact (skill checks only), but a source of future confusion.
- **Steady Aim movement bypass**: A player could trivially abuse Steady Aim after moving. Low priority unless Rogue combat scenarios explicitly test this constraint.
- **Disarm inventory gap**: The disarm Cunning Strike option produces the correct narrative but does not remove the weapon from the game state. Narration says "drops weapon" but the target can still use it next turn. This is a moderate correctness gap.

---

## Open Questions

1. Should Expertise auto-grant be implemented as a class feature key now (low effort — just add `"expertise": 1` to `Rogue.features` and an executor that validates/stamps `skillExpertise`)?
2. Is the movement-precondition for Steady Aim tracked anywhere as a TODO/plan item?
3. Disarm: should `ItemService.dropItem()` be called on a successful disarm save? The `plans/` bus has an inventory plan (`audit-InventorySystem.md`) — is this tracked there?
