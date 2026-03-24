# Plan: Hit Dice E2E Scenarios (§5.2)

## Status: APPROVED
## Affected Flows: Testing

## Objective
Add E2E scenario coverage for hit dice spending during short rest and hit dice recovery during long rest. The scenario runner already supports `rest` actions — what's missing is `hitDiceSpending` input support and hit-dice-specific assertions (`characterHitDice`, `hpRecovered`).

## Analysis of Current State

### Already Working
- `RestAction` type + `case "rest":` handler exist in `scenario-runner.ts`
- `short-rest-recovery.json` — tests resource pool refresh (no HD spending)
- `long-rest-recovery.json` — tests HP restore + pool restore (no HD assertion)
- `long-rest-spellcaster.json` — tests spell slot restore + HP restore

### Gaps
1. No scenario tests `hitDiceSpending` on short rest (character spends HD to recover HP)
2. No scenario asserts `hitDiceRemaining` after either rest type
3. No scenario verifies `hpRecovered` value from the rest result
4. The `RestAction` interface and handler don't pass `hitDiceSpending` to the API

## Changes

### File: `packages/game-server/scripts/test-harness/scenario-runner.ts`
- [x] Add `hitDiceSpending?: Record<string, number>` to `RestAction.input` (by character name)
- [x] Add `characterHitDice?: { name: string; remaining: number }` to `RestAction.expect`
- [x] Add `hpRecovered?: { name: string; min?: number; max?: number; exact?: number }` to `RestAction.expect`
- [x] In `case "rest":` handler: translate name-keyed `hitDiceSpending` to ID-keyed, include in API payload
- [x] In `case "rest":` handler: assert `characterHitDice` by fetching session data after rest
- [x] In `case "rest":` handler: assert `hpRecovered` from the rest response body

### File: `packages/game-server/scripts/test-harness/scenarios/core/short-rest-hit-dice.json` (NEW)
- [x] Fighter level 5, CON 15 (+2 mod), d10 hit die
- [x] Start at `currentHp: 20`, `maxHp: 42`, `hitDiceRemaining: 5`
- [x] Spend 2 hit dice during short rest
- [x] Assert `hitDiceRemaining: 3`, `hpRecovered: { min: 6 }`, `characterHp: { min: 26 }`
- [x] Also assert secondWind + actionSurge pools refreshed

### File: `packages/game-server/scripts/test-harness/scenarios/core/long-rest-hit-dice-recovery.json` (NEW)
- [x] Fighter level 5, CON 15
- [x] Start at `currentHp: 10`, `maxHp: 42`, `hitDiceRemaining: 1` (heavily depleted)
- [x] Long rest
- [x] Assert `characterHp: { exact: 42 }` (full HP restore)
- [x] Assert `characterHitDice: { remaining: 3 }` (1 + floor(5/2) = 3)

## Math Verification
- Fighter d10, level 5, CON 15 → CON mod +2
- Spend 2 HD: minimum = 2 × max(1, 1+2) = 6 HP; maximum = 2 × (10+2) = 24 HP
- Starting HP 20 + min 6 = 26 minimum final HP
- Long rest HD recovery: floor(5/2) = 2; 1 (current) + 2 = 3 remaining

## Cross-Flow Risk Checklist
- [x] No core mechanics changes — purely Testing flow
- [x] No state machine changes
- [x] No action economy implications
- [x] No entity shape changes
- [x] No app.ts registration changes needed

## Test Plan
- [x] 2 new E2E scenarios (short-rest-hit-dice, long-rest-hit-dice-recovery)
- [x] Both must pass with `test:e2e:combat:mock`
- [x] Existing rest scenarios must continue to pass
- [x] typecheck clean
