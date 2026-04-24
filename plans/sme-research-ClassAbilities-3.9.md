# SME Research — ClassAbilities — Phase 3.9 Cutting Words

As you wish Papi....

## Scope
- Files read:
  - `packages/game-server/src/domain/entities/classes/bard.ts` (~190 lines)
  - `packages/game-server/src/domain/entities/classes/combat-text-profile.ts` (types)
  - `packages/game-server/src/domain/entities/classes/combat-resource-builder.ts` (~260 lines)
  - `packages/game-server/src/application/services/combat/two-phase/attack-reaction-handler.ts` (~900 lines, partial)
  - `packages/game-server/src/application/services/combat/tabletop/rolls/initiative-handler.ts` (resource persistence)
  - `packages/game-server/scripts/test-harness/scenarios/bard/cutting-words-control.json`
  - `packages/game-server/scripts/test-harness/scenario-runner.ts` (subclass merge + `waitForReaction`)
  - `packages/game-server/src/domain/entities/combat/pending-action.ts` (ReactionType enum)
  - `packages/game-server/src/application/repositories/event-repository.ts` (CuttingWordsPayload)
  - `packages/game-server/src/infrastructure/api/routes/reactions.ts` (label mapping)
- Task context: determine what's needed to make the `bard/cutting-words-control` E2E scenario pass.

## Current State — Cutting Words is ALREADY fully wired

The scenario description's premise ("Phase 3.9 not yet implemented → prompt never fires") is **stale**. Every plumbing layer exists:

| Layer | Location | Status |
|---|---|---|
| `ReactionType` union | [pending-action.ts#L42](packages/game-server/src/domain/entities/combat/pending-action.ts#L42) | ✅ `"cutting_words"` present |
| Feature key | [feature-keys.ts](packages/game-server/src/domain/entities/classes/feature-keys.ts) | ✅ `CUTTING_WORDS` |
| Subclass feature gate | [bard.ts#L93](packages/game-server/src/domain/entities/classes/bard.ts#L93) | ✅ College of Lore L3 |
| `bardicInspiration` resource pool factory | [bard.ts#L50](packages/game-server/src/domain/entities/classes/bard.ts#L50) (`createBardicInspirationState`) + die size progression d6/d8/d10/d12 | ✅ complete |
| Resource init via `resourcesAtLevel` | [bard.ts#L111](packages/game-server/src/domain/entities/classes/bard.ts#L111) | ✅ |
| `hasCuttingWords` flag computed | [combat-resource-builder.ts#L176-L185](packages/game-server/src/domain/entities/classes/combat-resource-builder.ts#L176-L185) | ✅ gates on `level>=3` + subclass `college-of-lore`/`lore` |
| Flag persisted onto combatant | [initiative-handler.ts#L94-L96](packages/game-server/src/application/services/combat/tabletop/rolls/initiative-handler.ts#L94-L96) | ✅ |
| Reaction def (attackReactions) | [bard.ts#L158-L181](packages/game-server/src/domain/entities/classes/bard.ts#L158-L181) `CUTTING_WORDS_REACTION` | ✅ checks `hasReaction`, `isCharacter`, `hasCuttingWords`, `bardicInspiration>0`; returns `dieSize` in context |
| Profile registration | `registry.ts` — `BARD_COMBAT_TEXT_PROFILE` imported + included in `COMBAT_TEXT_PROFILES` | ✅ |
| Detection call site | [attack-reaction-handler.ts `initiate()` `detectAttackReactions`](packages/game-server/src/application/services/combat/two-phase/attack-reaction-handler.ts) | ✅ same path as Shield |
| Apply logic in `complete()` | [attack-reaction-handler.ts#L681-L720](packages/game-server/src/application/services/combat/two-phase/attack-reaction-handler.ts#L681-L720) | ✅ rolls `d{dieSize}`, subtracts from `attackData.attackRoll`, spends `bardicInspiration`, sets `reactionUsed`, emits `CuttingWords` event |
| Event payload | `CuttingWordsPayload` in event-repository.ts | ✅ |
| Reactions route label | [reactions.ts#L297](packages/game-server/src/infrastructure/api/routes/reactions.ts#L297) | ✅ |
| Harness `waitForReaction`/`reactionRespond` | scenario-runner.ts | ✅ matches on `reactionType === "cutting_words"` |
| Subclass flows into sheet | scenario-runner.ts#L784 merges `subclass` into sheet → `buildCombatResources` fallback picks it up | ✅ |

**Resource pool shape**: `{ name: "bardicInspiration", current: N, max: N }` where N = max(1, CHA mod). Die size via `bardicInspirationDieForLevel(level)` → d6 / d8(L5) / d10(L10) / d12(L15). Context on opportunity carries `{ attackerId, attackRoll, currentAC, dieSize }`.

## Impact Analysis

| File | Change Required | Risk | Why |
|------|----------------|------|-----|
| (none in ClassAbilities flow) | No new code needed for Cutting Words attack-roll variant | — | Already implemented |
| `bard/cutting-words-control.json` | Update description (remove "EXPECTED FAILURE / Phase 3.9 not implemented") | low | Doc-only |
| Scenario assertions | May need tuning once run live (resource name, HP range, `monsterActiveEffects` schema) | med | Unverified downstream |

## Constraints & Invariants
- Attack-reaction detection only runs when `target.combatantType === "Character"` and target is not incapacitated — matches RAW ("target is immune if charm-immune/can't hear"; current impl covers the common case via incapacitation gates but does NOT check charm-immunity on the attacker or audibility — acceptable for v1).
- Subtraction is applied to `attackData.attackRoll` **after** Shield's `+5 AC` (Shield block runs BEFORE the CW block in `complete()`) but the hit comparison uses the final mutated `attackRoll` vs `finalAC`, so order is functionally correct for "hit vs miss".
- Ordering in `complete()`: Protection → Shield → **Cutting Words** → hit check → damage → Deflect → Interception → Uncanny Dodge. Fine.
- Reaction consumes `reactionUsed=true` + 1 `bardicInspiration` charge. Second attack same round cannot re-trigger (detect short-circuits on `!hasReaction`). ✓ scenario step 2 depends on this.

## What the scenario actually tests beyond Cutting Words
1. **Cutting Words happy path** (steps: init → Hob attacks → waitForReaction → respond `use` → assert miss + pool 4→3). Should work as wired.
2. **Reaction exhaustion** (Gnoll second attack has no prompt). Implicit in `waitForTurn` — works.
3. **Vicious Mockery cantrip** (catalog: ✅ `cantrips.ts`) casting + applying **disadvantage-on-next-attack** debuff with `source: "Vicious Mockery"`. **This is the most likely actual failure point** — depends on whether the VM spell delivery handler applies a named `ActiveEffect` that surfaces in `monsterActiveEffects.hasSources`.
4. **Disadvantage on Hobgoblin's R2 attack** — requires VM's effect to be honored by the attack roll-mode computation.

## Options & Tradeoffs

| Option | Pros | Cons | Recommendation |
|---|---|---|---|
| A: Assume scenario runs and only patch description | Zero code risk | Unknown downstream failures | ✓ Start here — run the scenario live |
| B: Pre-emptively audit Vicious Mockery disadvantage plumbing | Proactive | Out of ClassAbilities scope (SpellSystem) | Defer to SpellSystem SME if (A) reveals VM gap |
| C: Extend Cutting Words to damage rolls + ability checks | RAW completeness | Out of scope for scenario; new detection hooks needed (no `allyCheckReactions` / `damageReactionOnIncoming` wired) | ✗ Not required by Phase 3.9 scenario |

## Risks
1. **Stale scenario description**: scenario claims feature is missing; orchestrator/agents should not implement duplicate logic on top of existing impl. Mitigation: run the scenario first and read failure.
2. **Multi-class subclass plumbing**: if a scenario uses `classLevels` (multi-class) instead of single `className`, the Bard entry must include `subclass: "college-of-lore"` on its class level entry — current scenario uses single-class path so unaffected.
3. **Shield + Cutting Words same round**: a Lore Bard/Wizard multi-class with both prepared would be offered BOTH reactions from the same prompt. The detector/handler correctly allow picking one. No bug, but worth noting for multi-class plans.
4. **Cutting Words on OWN roll**: RAW says "when a creature you can see… makes an attack roll". A Bard cannot cast it on their own attack roll because `attackReactions` are keyed to the defender; they are not fired when Bard is the attacker. Acceptable.
5. **Cutting Words vs damage roll / ability check**: NOT implemented. Only the attack-roll variant exists. Scenario doesn't test these, so no blocker.
6. **Vicious Mockery disadvantage application**: outside ClassAbilities — if it fails, hand off to SpellSystem SME.

## Recommendations (ordered by confidence)
1. **Do not re-implement the Cutting Words reaction** — it is fully wired. Running the scenario is the next action.
2. After running: if first failure is before the Vicious Mockery step (steps 1–7), investigate subclass→resource plumbing (likely the `subclass` string wasn't normalized, or init order consumed dice unexpectedly). Likely fix is scenario data (e.g., explicit `classLevels: [{classId:"bard", level:5, subclass:"college-of-lore"}]` if needed).
3. If failure is at step 8+ (Vicious Mockery), escalate to SpellSystem SME — not a ClassAbilities concern.
4. Update scenario description to remove the misleading "EXPECTED FAILURE / not yet implemented" language once it passes.
5. (Future, out of scope) Add `damageReactionOnIncoming` + `checkReactionOnIncoming` detection hooks if the full RAW Cutting Words (damage/ability-check subtraction) is desired. Requires new hook types in `combat-text-profile.ts` and call sites in damage-resolver + ability-check pathway.

## Files That Would Change (if anything)
- **None in ClassAbilities scope.** All mechanics exist.
- Possible: `scenarios/bard/cutting-words-control.json` (description + assertion tuning).
