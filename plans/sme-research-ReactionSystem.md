# SME Research — ReactionSystem — Phase 3.1 Fighting Styles (Protection + Interception)

## Scope
- [attack-reaction-handler.ts](packages/game-server/src/application/services/combat/two-phase/attack-reaction-handler.ts) (~760 lines)
- [combat-text-profile.ts](packages/game-server/src/domain/entities/classes/combat-text-profile.ts#L66-L125) (`AttackReactionInput`, `AttackReactionDef`, `detectAttackReactions`)
- [fighter.ts](packages/game-server/src/domain/entities/classes/fighter.ts#L170-L260) (PROTECTION_REACTION, INTERCEPTION_REACTION)
- [protection.ts](packages/game-server/src/domain/combat/protection.ts) (existing domain helper — currently unused)
- [combat-resource-builder.ts](packages/game-server/src/domain/entities/classes/combat-resource-builder.ts#L120-L180)
- [creature-hydration.ts](packages/game-server/src/application/services/combat/helpers/creature-hydration.ts#L200-L275)
- [damage-resolver.ts](packages/game-server/src/application/services/combat/tabletop/rolls/damage-resolver.ts#L300-L550)
- Task: wire Protection (pre-hit, impose disadvantage) + Interception (post-hit, 1d10+prof reduction) reactions that trigger on **allies within 5 ft**, not on the target itself.

## Current State

### 1. How `AttackReactionHandler.initiate()` iterates candidates
Two distinct passes ([attack-reaction-handler.ts](packages/game-server/src/application/services/combat/two-phase/attack-reaction-handler.ts)):

- **Target-only pass** (L150-L189): builds one `AttackReactionInput` for **the target** and calls `detectAttackReactions(input, getAllCombatTextProfiles())`. Every profile's reactions are checked against the *target's* stats/resources. This is how Shield, Deflect Attacks, Cutting Words, Uncanny Dodge are wired.
- **Sentinel ally-scan pass** (L193-L263): iterates `combatants`, skips attacker+target+dead, reads `sentinelEnabled` flag, runs `canMakeSentinelReaction()` domain gate, and pushes a `reactionType: "sentinel_attack"` opportunity per eligible nearby combatant. **This is the architectural precedent for Protection/Interception** — a hard-coded ally scan, not profile-driven.

So today the profile detection only runs on the target. Any ally-scoped reaction must be added either (a) as a hard-coded second pass like Sentinel, or (b) by extending the profile API to declare "ally scope".

### 2. `AttackReactionInput` fields
```ts
{ className, level, abilityScores, resources, hasReaction, isCharacter,
  attackRoll, attackerId, targetAC }
```
No nearby-ally fields. No target position. `resources` already carries `hasProtectionStyle`, `hasInterceptionStyle`, `hasShieldEquipped`, `hasWeaponEquipped` (declared on `ReactionResources`, L37-L41 of combat-text-profile.ts) — but **none of these are populated today** (see §6).

The input describes *one creature*. To evaluate Protection/Interception, we need to evaluate the detector in the context of an ALLY (potential protector), not the target. Options:
- **Call `detect()` once per nearby ally** (cleanest; no API change other than semantics — input just describes "this candidate reactor"). Requires the handler to iterate allies and build an input per ally.
- Add `potentialProtectorId` / nearby-ally context to the input — **worse**: forces the profile detector to know about the map and other combatants, violating the "pure eligibility predicate" contract.

**Recommendation: iterate allies and call `detect()` per ally.** The existing input shape already works for a protector as `isCharacter`/`hasReaction`/`resources` — just pass the ALLY's data, not the target's.

### 3. How `detectAttackReactions(input, profiles)` is called
Called exactly **once per attack** today (L167). Input built once from target. Nothing prevents us from calling it multiple times with different inputs — it's a pure function over `readonly profiles[]`.

Clean path: add a **second detection loop** (mirroring Sentinel's pattern, L193-L263) that iterates `combatants`, filters to allies within 5 ft of `target` (not `actor` — Protection is "within 5 ft of the creature being attacked"), builds an ally-scoped `AttackReactionInput`, calls `detectAttackReactions()`, and collects opportunities with `combatantId = other.id` (the protector), not `target.id`.

### 4. Protection: how to actually impose disadvantage
**Problem**: `initiate()` receives `attackRoll: number` — a *single already-totaled* d20+mods value. The caller is [ai-attack-resolver.ts:250](packages/game-server/src/application/services/combat/ai/ai-attack-resolver.ts), which rolled one d20 via the dice-roller before calling initiate.

There is **no retroactive-disadvantage path** today. Options:

- **(A) Post-hoc reroll in `complete()`**: when the player accepts Protection, roll a *second* d20 using `input.diceRoller`, recompute `attackTotal = min(originalD20, newD20) + attackBonus`, then re-evaluate hit against `finalAC`. Needs us to carry `attackBonus` / `d20Roll` / `rollMode` into `PendingAttackData` so we can recompute. `PendingAttackData` already stores `attackRoll`, `attackBonus`, `attackTotal`, `d20Roll` (see [attack-reaction-handler.ts:678-685](packages/game-server/src/application/services/combat/two-phase/attack-reaction-handler.ts) AttackResolved emit). This is the most self-contained path.
- **(B) Pre-roll detection**: call `initiate()` BEFORE rolling d20, then re-enter the attack flow with chosen rollMode. Requires lifting initiate earlier in `ai-attack-resolver.ts` and is much more invasive — affects Shield/Deflect interleaving (they need the roll value to decide eligibility, e.g., "roll <= 5+AC"). **Avoid.**
- **(C) Advisory-only**: mark the attack to reroll in `complete()` — same as (A) mechanically but don't call it "retroactive". This matches DM practice ("ok, roll with disadvantage against the shielded target").

**Recommendation: Option A.** Reroll in `complete()`. Precedent: Cutting Words already *subtracts* from `attackData.attackRoll` in complete() (L484-L487), so mutating the effective roll post-initiate is established. Order matters: apply Cutting Words first (or Protection first — spec-check D&D 2024, but either is defensible; suggest Protection → Cutting Words because Protection is a reroll while CW is a modifier).

### 5. Interception: integration with damage
Cleanest hook is in **`AttackReactionHandler.complete()`**, NOT in `damage-resolver.ts`. Reason: two-phase attacks (AI → player target) flow through `complete()`; `damage-resolver.ts` handles player→monster attacks where no player reaction is possible. [attack-reaction-handler.ts:543-600](packages/game-server/src/application/services/combat/two-phase/attack-reaction-handler.ts) already applies Deflect Attacks reduction and Uncanny Dodge halving in sequence; Interception slots in **right after Deflect, before Uncanny Dodge** (or before Deflect — Deflect is target-specific, Interception is ally-specific; order affects minimum damage outcomes).

Pattern (mirrors Deflect):
```
if (interceptionReaction && interceptionOpp && input.diceRoller) {
  const reductionRoll = input.diceRoller.rollDie(10).total + profBonus;
  damageApplied = Math.max(0, damageApplied - reductionRoll);
  // mark protector's reactionUsed: true (NOT the target's)
  // emit InterceptionApplied event
}
```
**Critical**: the protector combatant must be resolved via the opportunity's `combatantId`, not the target — Deflect uses `target.id` because the target IS the reactor. Interception needs `combatants.find(c => c.id === interceptionOpp.combatantId)`.

### 6. Resource flags — where populated
Currently **not populated**:
- `hasProtectionStyle`, `hasInterceptionStyle`: `fightingStyle` is parsed from the sheet and stored on the hydrated creature ([creature-hydration.ts:201-275](packages/game-server/src/application/services/combat/helpers/creature-hydration.ts)), but `buildCombatResources()` does NOT emit `hasProtectionStyle`/`hasInterceptionStyle` flags into combat resources ([combat-resource-builder.ts:179](packages/game-server/src/domain/entities/classes/combat-resource-builder.ts) returns `{ resourcePools, hasShieldPrepared, hasCounterspellPrepared, ... }` — no fighting-style flags).
- `hasShieldEquipped`: equipped shield data lives on `sheet.equippedShield` ([armor-catalog.ts:143,249](packages/game-server/src/domain/entities/items/armor-catalog.ts)), but never mirrored into combat resources.
- `hasWeaponEquipped`: not tracked at all — would require inventory inspection (`slot === "main-hand"` or similar) at hydration/initiative time.

**All four flags must be added to `buildCombatResources()`**, sourcing:
- `hasProtectionStyle = sheet.fightingStyle === "protection"`
- `hasInterceptionStyle = sheet.fightingStyle === "interception"`
- `hasShieldEquipped = !!sheet.equippedShield`
- `hasWeaponEquipped = inventory.some(i => i.equipped && (i.slot === "main-hand" || i.slot === "two-handed"))`

Called from [initiative-handler.ts:73](packages/game-server/src/application/services/combat/tabletop/rolls/initiative-handler.ts) at combat start, so these get baked into `CombatantState.resources` at initiative time. Shield equipment changes mid-combat (unlikely in tabletop play) would be stale; acceptable.

### 7. Existing but orphaned helper
[protection.ts](packages/game-server/src/domain/combat/protection.ts) already defines `canUseProtection(protector, protectorPos, targetPos)` — distance + shield + reaction check. **Currently not imported anywhere except its test.** This is the domain predicate to use inside the ally-scan loop for Protection. No equivalent exists for Interception — would need to create `canUseInterception()` following the same shape (distance + (shield OR weapon) + reaction + style).

## Impact Analysis
| File | Change | Risk | Why |
|------|--------|------|-----|
| [combat-resource-builder.ts](packages/game-server/src/domain/entities/classes/combat-resource-builder.ts) | Emit 4 new flags (`hasProtectionStyle`, `hasInterceptionStyle`, `hasShieldEquipped`, `hasWeaponEquipped`) | low | Pure additive; must also extend `CombatResourcesResult` return shape |
| [initiative-handler.ts](packages/game-server/src/application/services/combat/tabletop/rolls/initiative-handler.ts) | Pass inventory/equipment into builder; persist new flags | low | Already calls `buildCombatResources` |
| [attack-reaction-handler.ts](packages/game-server/src/application/services/combat/two-phase/attack-reaction-handler.ts) | Add ally-scan pass (Protection + Interception); extend `complete()` with Protection reroll + Interception reduction; track protector reactionUsed | **high** | Touches hot path; interacts with Shield/Deflect/CW/UD ordering |
| [fighter.ts](packages/game-server/src/domain/entities/classes/fighter.ts) | Keep `PROTECTION_REACTION` / `INTERCEPTION_REACTION` detectors but remove from `attackReactions` on the profile (they're ally-scoped, not target-scoped) OR split into a new profile field | med | API decision — see Options |
| [combat-text-profile.ts](packages/game-server/src/domain/entities/classes/combat-text-profile.ts) | Possibly add `allyAttackReactions?: AttackReactionDef[]` field | med | Clean separation of scopes |
| [protection.ts](packages/game-server/src/domain/combat/protection.ts) | Use existing `canUseProtection`; add `canUseInterception` sibling | low | Domain predicates |
| [pending-action.ts](packages/game-server/src/domain/entities/combat/pending-action.ts) | Extend `PendingAttackData` to carry `d20Roll`, `attackBonus`, `rollMode` (likely already present for other reactions) | low | Required for Protection reroll |

## Constraints & Invariants
1. **One reaction per creature per round** — protector consumes THEIR reaction, not the target's. `reactionUsed: true` must be set on the protector's combatant, not the target.
2. **Protection requires shield**, Interception requires shield OR simple/martial weapon (2024 PHB).
3. **Distance is to the TARGET**, not attacker: "creature attacks a target *within 5 feet of you*". Current Sentinel scan uses `actorPos` (attacker) — Protection/Interception must use `target` position.
4. **Protector ≠ target** — the reaction explicitly requires the attacked creature be "other than you". Skip when `other.id === target.id`.
5. **Detectors must remain pure** — no map/position knowledge inside `detect()`. Distance check happens in the handler (like Sentinel).
6. **Ordering in `complete()`**: Protection reroll changes hit/miss → must run BEFORE `hit = attackRoll >= finalAC` computation. Interception runs AFTER damage roll, can slot alongside Deflect/Uncanny Dodge.
7. **Reroll semantics**: imposed disadvantage means "roll second d20, take lower". Existing `resolveD20Roll` disadvantage handling is not reachable here since `attackRoll` is pre-totaled.

## Options & Tradeoffs
| Option | Pros | Cons | Recommendation |
|--------|------|------|---------------|
| **A. Hard-coded ally-scan like Sentinel** (iterate `combatants`, inline Protection/Interception checks using `canUseProtection`/`canUseInterception`) | Fastest to implement; matches Sentinel precedent; no profile API change | Not profile-driven; adds class-specific code to app layer (violates "domain-first" principle in copilot-instructions) | ✗ Avoid long-term |
| **B. Extend profile API with `allyAttackReactions: AttackReactionDef[]`**; handler iterates allies + calls `detectAttackReactions()` per ally against ally-scoped detectors only | Preserves domain-first principle; scales to future ally reactions (e.g., Cavalier "Warding Maneuver"); symmetric with `attackReactions` | New API surface; requires migrating `PROTECTION_REACTION`/`INTERCEPTION_REACTION` to new field | ✓ **Preferred** |
| **C. Add `scope: "target" \| "ally"` discriminator to `AttackReactionDef`** | Minimal type churn; one field change | Detectors become position-aware inside handler; harder to reason about | ✗ Worse than B |
| **D. Enrich `AttackReactionInput` with `nearbyAllies: CombatantRef[]`** and let detectors return multiple opportunities | Single detection call | Forces detectors to iterate map data; breaks pure-predicate contract; bloats input | ✗ Avoid |
| **E. Split into two detectors per ability** (target-side "I'm being attacked" + ally-side "ally is being attacked") | No new API field; reuses `attackReactions` | Detectors would need to know their role via input; awkward | ✗ Avoid |

## Risks
1. **Reroll observability** — players will see the original d20 in logs before accepting Protection. Acceptable per tabletop norms; scenario/CLI must display "Attack rerolled with disadvantage: N → M". Mitigation: emit `ProtectionApplied` event with both rolls.
2. **Flag population timing** — if `buildCombatResources` runs at initiative but a character picks up a shield mid-combat, flag goes stale. Mitigation: document; rebuild on equip action if inventory-changing actions exist.
3. **Reaction opportunity prompt UX** — multiple allies could be eligible. Existing code already supports per-opportunity `ReactionPrompt` events (L280-L296); CLI must route the prompt to each protector separately. Low risk — pattern established.
4. **AI protectors** — if an NPC ally has Protection, AI must decide to use it. Out of scope for 3.1 but flag: deterministic AI has no hook for ally reactions today. Mitigation: default to auto-decline for AI protectors in v1; add AI hook later.
5. **Interception + Uncanny Dodge stacking** — both reduce damage. Spec allows both (different reactions from different creatures). Order: apply whichever is declared first; final damage floor = 0.
6. **Protection vs Shield interaction** — Shield raises AC after Protection reroll; must ensure Protection reroll happens first, then AC adjustment, then hit check.

## Recommendations (ordered)
1. **Adopt Option B**: add `allyAttackReactions?: AttackReactionDef[]` to `ClassCombatTextProfile`. Move `PROTECTION_REACTION`/`INTERCEPTION_REACTION` from `attackReactions` → `allyAttackReactions` on fighter profile.
2. **Populate flags in `buildCombatResources()`**: source `fightingStyle` + `equippedShield` + inventory from the character sheet (extend its input contract). Add unit test coverage in combat-resource-builder.test.ts.
3. **In `AttackReactionHandler.initiate()`**, after the Sentinel loop, add a **protection/interception ally-scan**: iterate combatants, filter to alive characters ≠ target ≠ attacker within 5 ft of **target**, build `AttackReactionInput` per ally (using ally's className/level/resources/hasReaction), call `detectAttackReactions(input, profiles)` against `allyAttackReactions` only. Push opportunities with `combatantId = other.id` (protector).
4. **In `complete()`**:
   - Handle Protection FIRST (before hit check): reroll d20 using stored `d20Roll` + `input.diceRoller`, take min, recompute `attackTotal`, emit `ProtectionApplied` event, mark **protector's** `reactionUsed: true`.
   - Handle Interception AFTER damage roll, slot before Uncanny Dodge: roll 1d10 + profBonus, subtract from `damageApplied`, emit `InterceptionApplied` event, mark **protector's** `reactionUsed: true`.
5. **Extend `PendingAttackData`** to carry `d20Roll`, `attackBonus`, `rollMode` (verify existing fields first — mostly present per L678-L685).
6. **Add `canUseInterception()`** sibling to `canUseProtection()` in `domain/combat/protection.ts` (or rename file to `fighting-style-reactions.ts`).
7. **Defer AI-protector auto-decision** to a later phase; auto-decline for NPC protectors in v1.
8. **Test coverage**: unit tests for new domain predicates; integration test in attack-reaction-handler adding an ally-protector scenario; E2E scenario under `scenarios/fighter/` covering (a) Protection imposes disadvantage and flips hit→miss, (b) Interception reduces damage to 0, (c) protector without shield is not offered, (d) protector already used reaction is not offered.
