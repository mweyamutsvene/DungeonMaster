# Plan: Post-Hit Enhancement Opt-In (2024 Rules)

**TL;DR**: Refactor the attack enhancement system so that "when you hit" abilities (Stunning Strike, Divine Smite, Open Hand Technique) are offered to the player after a hit is confirmed, then declared alongside the damage roll. The hit response includes `eligibleEnhancements[]` telling the client what's available; the player includes the keyword in their damage roll text (e.g., `"8 with stunning strike"`, `"6 and topple"`). Upfront declaration in the action text is removed. This matches D&D 5e 2024 RAW and applies TDD: test scenario first, then implementation.

## Rules Basis (2024 RAW)

**Stunning Strike** (Monk Level 5):
> Once per turn when you hit a creature with a Monk weapon or an Unarmed Strike, you can expend 1 Focus Point to attempt a stunning strike. The target must make a Constitution saving throw. On a failed save, the target has the Stunned condition until the start of your next turn. On a successful save, the target's Speed is halved until the start of your next turn, and the next attack roll made against the target before then has Advantage.

**Divine Smite** (Paladin Level 2 — now a spell in 2024):
> Casting Time: Bonus Action, which you take **immediately after hitting** a target with a Melee weapon or an Unarmed Strike

**Open Hand Technique** (Monk Level 3, Warrior of the Open Hand):
> Whenever you hit a creature with an attack granted by your Flurry of Blows, you can impose one of the following effects on that target: Addle, Push, or Topple.

All three trigger **"when you hit"** — the player decides AFTER seeing the hit confirmed.

## Affected Enhancements

| Enhancement | Class | Current | New Trigger | Choice Type |
|---|---|---|---|---|
| Stunning Strike | Monk 5+ | Upfront in action text | onHit — in damage text | Binary (keyword present = apply) |
| Divine Smite | Paladin 2+ | Upfront in action text | onHit — in damage text | Binary (keyword present = apply) |
| Open Hand Technique | Monk 3+ (Open Hand) | Upfront in flurry text | onHit — in damage text per hit | Keyword choice: `addle`, `push`, or `topple` |

**Not affected** (already correct):
- Sneak Attack (Rogue): Auto-applied on hit, no player declaration needed
- Rage Damage Bonus (Barbarian): Auto-applied on damage, passive

## User-Facing Flow

```
Player: "I do an unarmed attack on goblin"
Server: → requests attack roll (d20)
Player: "I roll 18"
Server: → HIT! requests damage roll (1d8+3)
        → also returns eligibleEnhancements: [{ keyword: "stunning-strike", displayName: "Stunning Strike", resourceCost: { pool: "ki", amount: 1 } }]
Player: "I roll 8 and attempt to apply stunning strike"
Server: → applies 11 damage, then auto-resolves CON save for Stunning Strike
        → returns stunningStrike: { saved: false, conditionApplied: "Stunned", saveDC: 14, ... }
```

## Decisions

- **New flow only**: upfront declaration removed. `"attack with stunning strike"` no longer precommits the enhancement — `onHit` enhancement keywords in action text are ignored
- **OHT included**: Open Hand Technique migrated from Flurry executor bespoke parsing to the generic `onHit` enhancement system. Choice keyword (addle/push/topple) included in damage text
- **OHT fires per-hit**: Each Flurry strike independently prompts for OHT, matching 2024 RAW ("whenever you hit"). Player can choose differently per strike
- **Enhancement matching in damage text**: Single unified pattern — damage roll text is scanned for enhancement keywords. Both numeric roll value and keywords are extracted from the same text
- **Divine Smite special handling**: Costs a spell slot + bonus action (2024 rules make it a spell). Slot selection logic stays in `handleDamageRoll()`

---

## Phase 0: Test Scenarios (TDD — write first, expect failures)

### 0a. New scenario: `scenarios/monk/stunning-strike-on-hit.json`

Monk level 5 vs Stone Guardian. Validates the new post-hit opt-in flow:

1. `initiate` → `rollResult` (initiative)
2. `action`: `"I do an unarmed attack on Stone Guardian"` (NO stunning strike keyword) → expect `rollType: "attack"`
3. `rollResult`: `"18"` → expect `hit: true`, `rollType: "damage"`, **`eligibleEnhancements`** containing `{ keyword: "stunning-strike" }`
4. `rollResult`: `"8 with stunning strike"` → expect `rollType: "damage"`, `actionComplete: true`, `stunningStrike: {}` (save resolved)
5. `assertState`: ki spent (5→4)

### 0b. New scenario: `scenarios/monk/stunning-strike-decline.json`

Same setup, but player declines the enhancement:

1. `action`: `"attack Stone Guardian"` → `rollResult`: `"18"` (hit with eligibleEnhancements)
2. `rollResult`: `"8"` (no keyword — decline) → expect `actionComplete: true`, NO `stunningStrike` field
3. `assertState`: ki NOT spent (still 5)

### 0c. New scenario: `scenarios/monk/open-hand-on-hit.json`

Open Hand Monk level 5, Flurry of Blows with per-hit OHT choice:

1. `action`: `"use flurry of blows"` (NO technique keyword)
2. `rollResult`: `"15"` (strike 1 hit) → expect `eligibleEnhancements` containing OHT options AND stunning strike
3. `rollResult`: `"6 with topple"` (damage + OHT choice) → expect `openHandTechnique: {}`, then strike 2 attack roll prompt
4. `rollResult`: `"18"` (strike 2 hit) → expect `eligibleEnhancements` again (OHT fires per hit)
5. `rollResult`: `"4 with addle"` (different choice on strike 2) → expect `openHandTechnique: {}`

### 0d. Update existing scenario: `scenarios/monk/stunning-strike.json`

Modify to use the new flow: remove upfront declaration from action text, move keyword to damage roll text.

---

## Phase 1: Domain Layer Changes

### 1a. Add `trigger` field to `AttackEnhancementDef`

File: `domain/entities/classes/combat-text-profile.ts`

```typescript
interface AttackEnhancementDef {
  keyword: string;
  displayName?: string;              // NEW — human-readable name for prompts
  patterns: readonly RegExp[];
  minLevel: number;
  resourceCost?: { pool: string; amount: number };
  turnTrackingKey?: string;
  requiresMelee?: boolean;
  trigger?: "onDeclare" | "onHit";   // NEW — default "onDeclare"
  choiceOptions?: string[];           // NEW — for OHT: ["addle", "push", "topple"]
  requiresBonusAction?: string;       // NEW — for OHT: "flurry-of-blows" (only eligible on flurry hits)
}
```

### 1b. New function: `getEligibleOnHitEnhancements()`

File: `domain/entities/classes/combat-text-profile.ts`

Takes `attackKind`, `classId`, `level`, `turnFlags`, `resourcePools`, `profiles`, and optionally `bonusAction`.
Returns `EligibleOnHitEnhancement[]` — all `onHit` trigger enhancements passing eligibility checks (level, melee, once-per-turn, resource, bonusAction).
Does NOT check text patterns — just eligibility.

```typescript
interface EligibleOnHitEnhancement {
  keyword: string;
  displayName: string;
  resourceCost?: { pool: string; amount: number };
  choiceOptions?: string[];
}
```

### 1c. New function: `matchOnHitEnhancementsInText()`

File: `domain/entities/classes/combat-text-profile.ts`

Takes the damage roll text + eligible enhancement defs.
Returns matched enhancement keywords and choice values.

```typescript
function matchOnHitEnhancementsInText(
  text: string,
  eligibleDefs: readonly AttackEnhancementDef[],
): Array<{ keyword: string; choice?: string }>
```

### 1d. Update `matchAttackEnhancements()`

Add `triggerFilter` parameter. When called from the action dispatcher, filter to `"onDeclare"` only.

### 1e. Set `trigger: "onHit"` on Stunning Strike

File: `domain/entities/classes/monk.ts`

```typescript
{
  keyword: "stunning-strike",
  displayName: "Stunning Strike",
  patterns: [/\bstun(?:ning)?\s*(?:strike)?\b/],
  minLevel: 5,
  resourceCost: { pool: "ki", amount: 1 },
  turnTrackingKey: "stunningStrikeUsedThisTurn",
  requiresMelee: true,
  trigger: "onHit",
}
```

### 1f. Set `trigger: "onHit"` on Divine Smite

File: `domain/entities/classes/paladin.ts`

### 1g. Add OHT to `MONK_COMBAT_TEXT_PROFILE.attackEnhancements`

File: `domain/entities/classes/monk.ts`

```typescript
{
  keyword: "open-hand-technique",
  displayName: "Open Hand Technique",
  patterns: [/\b(addle|push|topple)\b/],
  minLevel: 3,
  requiresMelee: true,
  trigger: "onHit",
  choiceOptions: ["addle", "push", "topple"],
  requiresBonusAction: "flurry-of-blows", // Only eligible on flurry hits
}
```

---

## Phase 2: Type Changes

### 2a. Add `eligibleEnhancements` to `AttackResult`

File: `tabletop-types.ts`

```typescript
interface AttackResult {
  // ... existing fields ...
  eligibleEnhancements?: Array<{
    keyword: string;
    displayName: string;
    resourceCost?: { pool: string; amount: number };
    choiceOptions?: string[];
  }>;
}
```

### 2b. Remove upfront enhancement flags from `AttackPendingAction`

File: `tabletop-types.ts`

Remove: `stunningStrike?: boolean`, `divineSmite?: boolean`, `openHandTechnique?: "addle" | "push" | "topple"`

### 2c. Keep `enhancements` on `DamagePendingAction`

The `HitRiderEnhancement[]` array stays — this is where resolved enhancements go after the player opts in at damage time. But remove the `stunningStrike?: boolean` and `openHandTechnique` fields since they're no longer set upfront.

---

## Phase 3: Server Logic Changes

### 3a. Update `ActionDispatcher.handleAttackAction()`

File: `action-dispatcher.ts`

- Change `matchAttackEnhancements()` call to use `triggerFilter: "onDeclare"` — skips `onHit` enhancements
- Remove `stunningStrike` and `divineSmite` flag-setting on `AttackPendingAction`

### 3b. Update `handleAttackRoll()` hit path

File: `roll-state-machine.ts`

After a hit is confirmed:
1. Call `getEligibleOnHitEnhancements()` to detect available enhancements for this attacker
2. For OHT: check if attack was a Flurry of Blows hit (`action.bonusAction === "flurry-of-blows"`)
3. Include `eligibleEnhancements` in the hit response (alongside `rollType: "damage"`, `requiresPlayerInput: true`)
4. **Remove** the upfront `HitRiderEnhancement` building for SS/Divine Smite/OHT — enhancements are now built in `handleDamageRoll()`

### 3c. Update `handleDamageRoll()`

File: `roll-state-machine.ts`

- Accept `rawText` parameter (the full damage roll text from the player)
- Call `matchOnHitEnhancementsInText()` to detect which enhancements the player opted into
- Build `HitRiderEnhancement[]` from the matched keywords (same logic currently in `handleAttackRoll`, moved here)
- Set `action.enhancements` with the dynamically built enhancements
- Rest of damage processing unchanged — enhancements resolve post-damage as before

### 3d. Update `processRollResult()`

File: `roll-state-machine.ts`

Pass raw text to `handleDamageRoll()`.

### 3e. Update Flurry of Blows executor

File: `flurry-of-blows-executor.ts`

- Remove `parseOpenHandTechnique()` from the executor
- Remove setting `openHandTechnique` on the attack pending action
- The executor just sets up the Flurry attack — OHT choice is deferred to damage time

### 3f. Update flurry strike 2 propagation

File: `roll-state-machine.ts`

- Currently copies `openHandTechnique` to strike 2. Remove this.
- Strike 2 independently prompts for OHT via `eligibleEnhancements`

---

## Phase 4: Scenario Runner Updates

### 4a. Add `eligibleEnhancements` validation

File: `scenario-runner.ts`

New expect field on `RollResultAction`:

```typescript
eligibleEnhancements?: Array<{ keyword: string }>;
```

Validates that the hit response includes the expected enhancement options (keyword presence check).

---

## Phase 5: Player CLI Updates

### 5a. Add `eligibleEnhancements` to `ActionResponse`

File: `player-cli/src/types.ts`

### 5b. Update `rollPromptLoop()`

File: `player-cli/src/combat-repl.ts`

When asking for a damage roll and `eligibleEnhancements` is present, display available enhancements:
```
⚡ Available: Stunning Strike (1 ki) — include "stunning strike" in your roll
🤛 Available: Open Hand Technique — include "addle", "push", or "topple" in your roll
```

Update `askForRoll()` to accept `"<number> with <keyword>"` patterns (not just bare numbers).

---

## Phase 6: TODO for Future On-Hit Enhancements

Create plan doc for future `onHit` enhancements not yet implemented:

| Enhancement | Class | Level | Trigger | Type |
|---|---|---|---|---|
| Quivering Palm | Monk | 17 | "When you hit with an Unarmed Strike" | Delayed save-or-die |
| Eldritch Smite | Warlock | 5 | "when you hit with your pact weapon" | Bonus damage + Prone |
| Lifedrinker | Warlock | 9 | "when you hit with your pact weapon" | Bonus 1d6 + self-heal |
| Hurl Through Hell | Warlock | 14 | "when you hit with an attack roll" | Save-or-banish |
| Colossus Slayer | Ranger | 3 | "When you hit a creature with a weapon" | Auto extra 1d8 (target missing HP) |
| Radiant Strikes | Paladin | 11 | "When you hit with melee/unarmed" | Auto extra 1d8 |
| Divine Strike | Cleric | — | "when you hit with an attack roll using a weapon" | Auto extra 1d8 |
| Primal Strike | Druid | — | "when you hit in weapon or Beast form" | Auto extra 1d8 |

---

## Verification

1. Run new test scenarios: `pnpm -C packages/game-server test:e2e:combat:mock` — new scenarios pass
2. Run existing test scenarios — verify no regressions (monk/paladin scenarios updated)
3. `pnpm -C packages/game-server typecheck` — clean
4. `pnpm -C packages/player-cli typecheck` — clean
5. Manual test with player-cli: Monk quick encounter → attack → hit → `"8 with stunning strike"` → see save result

---

## Implementation Notes (Completed)

All 6 phases implemented. Enhancement system now follows 2024 D&D "when you hit" rules.

**Verification Results:** All typechecks clean. Unit tests: 360 passed. E2E: 59 passed, 0 failed.

**Files modified:** combat-text-profile.ts, monk.ts, paladin.ts, tabletop-types.ts, action-dispatcher.ts, roll-state-machine.ts, flurry-of-blows-executor.ts, scenario-runner.ts, player-cli types.ts + combat-repl.ts, cli types.ts. Created 3 new scenarios, updated 3 existing.

**Open:** 3 pre-existing cleric test failures (unrelated). Future onHit enhancements not yet implemented.
