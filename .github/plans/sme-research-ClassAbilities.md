# SME Research — ClassAbilities — Phase 3.1 Fighting Styles

As you wish Papi....

## Scope
- Plan: `.github/prompts/plan-class-abilities-l1-5-complete.prompt.md` Phase 3.1
- Files inspected: `domain/entities/classes/fighting-style.ts`, `domain/rules/feat-modifiers.ts`, `domain/combat/attack-resolver.ts`, `domain/combat/two-weapon-fighting.ts`, `domain/combat/protection.ts`, `domain/entities/classes/fighter.ts`, `domain/entities/classes/combat-text-profile.ts`, `application/services/combat/tabletop/rolls/damage-resolver.ts`, `application/services/combat/tabletop/roll-state-machine.ts`, `application/services/combat/ai/ai-attack-resolver.ts`, `application/services/combat/helpers/creature-hydration.ts`.

## Current State — Quick Map
| Style | Mechanism | Wire site | Status |
|-------|-----------|-----------|--------|
| Archery | `rangedAttackBonus: +2` via `computeFeatModifiers` | `attack-resolver.ts:187`, `roll-state-machine.ts:435` | ✅ |
| Defense | `armorClassBonusWhileArmored: +1` | `character.ts getAC()` via featIds | ✅ |
| Dueling | `duelingDamageBonus: +2` + `shouldApplyDueling()` | `attack-resolver.ts:233`, `damage-resolver.ts:169` | ⚠ Gap 1 |
| GWF | die-min 3 + `shouldApplyGreatWeaponFighting()` | `attack-resolver.ts:225` ONLY | ⚠ Gap 2 (silent bug in tabletop path) |
| TWF | ability mod on offhand | `damage-resolver.ts:181` + `two-weapon-fighting.ts` | ⚠ Gap 3 |
| Protection | `AttackReactionDef` in fighter.ts | `fighter.ts:187` — reads `resources.hasProtectionStyle`/`hasShieldEquipped` | ❌ flags never written + ally-scan missing |
| Interception | `AttackReactionDef` in fighter.ts | `fighter.ts:223` — reads `hasInterceptionStyle`/`hasShieldEquipped`/`hasWeaponEquipped` | ❌ flags never written + ally-scan missing + no post-damage-reduction handler |

## Gaps Beyond the Known TODOs

### Gap 1 — `shouldApplyDueling` ignores "no other weapons" clause
`feat-modifiers.ts:180-195` only checks `hands !== 2` and `!two-handed`. **Does not verify no offhand weapon.** A dual-wielder (shortsword + dagger) currently gets +2 Dueling on the main-hand strike. RAW: "no other weapons" (shield allowed).
Fix: add `offhandEquipped: boolean` param; caller reads `equipment.offhand?.kind !== "shield"`.

### Gap 2 — GWF **NOT applied** in tabletop `damage-resolver.ts`
Grep confirms `applyDamageDieMinimum` is called ONLY in `domain/combat/attack-resolver.ts` (programmatic AI path). The tabletop damage path (`damage-resolver.ts:160-200`) merges feat mods and applies Dueling + TWF but **skips GWF**. PCs using GWF today get zero benefit in the normal player-driven flow. This is a silent correctness bug, not a "missing feature".
Fix complexity: tabletop ingests player-submitted totals via `RollResultCommand.value`, not raw dice. Either (a) transmit raw dice values, (b) re-roll dice server-side for GWF-eligible attacks, or (c) compute min-3 reconstruction from die count × sides. Requires CombatOrchestration SME coordination.

### Gap 3 — TWF offhand ability-mod picks `max(str, dex)` for melee
`damage-resolver.ts:186-194` uses `Math.max(strMod, dexMod)` for melee offhand. RAW uses the ability tied to the weapon (finesse picks higher; non-finesse light weapons like handaxe should be STR-only). Low visibility — Light offhand weapons are usually finesse.

### Gap 4 — AI attack path never applies fighting-style mods
`ai-attack-resolver.ts` zero references to `featIds`/`fightingStyle`/`computeFeatModifiers`. Fine for monsters (no styles), but **breaks AI-controlled NPC allies** with `fightingStyle: "archery"`. No Phase 2 scenario currently exercises this.

## `fightingStyle` Hot-Path Coverage
| Hot path | Reads `sheet.fightingStyle`? | Via |
|----------|:---:|-----|
| `domain/combat/attack-resolver.ts` (AI/programmatic attack rolls) | ✅ | `attacker.getFeatIds()` — Character ctor merges fighting-style feat id |
| `damage-resolver.ts` (tabletop damage) | ✅ | explicit `mergeFightingStyleFeatId` |
| `roll-state-machine.ts` (tabletop attack) | ✅ | explicit `mergeFightingStyleFeatId` |
| `character.ts getAC()` | ✅ | via featIds merged in ctor |
| `ai-attack-resolver.ts` | ❌ | Gap 4 |

Unification is solid: any code path through the domain `Character` entity picks up the style feat automatically; tabletop raw-sheet paths correctly mirror this via `mergeFightingStyleFeatId`.

## Resource Flags — All Stubs (No Setters Anywhere)
Flags `hasProtectionStyle`, `hasShieldEquipped`, `hasInterceptionStyle`, `hasWeaponEquipped`:
- **Declared**: `combat-text-profile.ts:37-41` as optional on `AttackReactionInput.resources`
- **Read**: only in `fighter.ts` PROTECTION_REACTION / INTERCEPTION_REACTION `detect()`
- **Written**: nowhere — grep across `/src` returns 0 setter sites

`creature-hydration.ts` parses `fightingStyle` but never derives these booleans. Consequence: both reaction `detect()` calls return `null` on every invocation today; both reaction defs are dead code.

### Required wiring
1. **Compute per-attack** in the reaction-dispatch caller that assembles `AttackReactionInput.resources` (cleaner than persisting in resource state — equipment can change).
   - `hasProtectionStyle = char.getFightingStyle() === "protection"`
   - `hasInterceptionStyle = char.getFightingStyle() === "interception"`
   - `hasShieldEquipped = equipment.offhand?.kind === "shield"` (verify shape against `equipped-items.ts`/`armor-catalog.ts`)
   - `hasWeaponEquipped = equipment.mainHand?.kind === "weapon"` (simple/martial)
2. **Ally-scan extension** (fighter.ts TODOs CO-L5/L6): `AttackReactionHandler` currently passes one `input` keyed to the target. Protection/Interception belong to *allies within 5ft of the target*, not the target. Needs `two-phase/attack-reaction-handler.ts` to scan all combatants within 5ft via `domain/combat/protection.ts` `calculateDistance`. Cross-cuts **ReactionSystem SME**.
3. **Interception post-damage-reduction handler**: new reaction category. Existing reactions are pre-hit (Shield, Protection impose disadvantage) or pre-damage (Deflect Attacks rerolls). Interception applies `1d10 + profBonus` reduction AFTER damage roll, before HP apply. May need a new `pendingActionType` between hit-confirm and HP-deduction.

## Existing Tests (do not duplicate)
| File | Coverage |
|------|----------|
| `domain/rules/fighting-style.test.ts` | `computeFeatModifiers` numeric per style |
| `domain/combat/fighting-style-attack.test.ts` | Dueling (3), Archery (2), GWF (1), featId↔style parity, Defense (2) via `resolveAttack` |
| `domain/combat/two-weapon-fighting.test.ts` | `canMakeOffhandAttack` light/non-light/Dual Wielder |
| `domain/combat/protection.test.ts` | `canUseProtection` pure-fn gates |
| `domain/entities/creatures/fighting-style-character.test.ts` | `getFightingStyle`, class-level gates, AC (Defense), featIds merge |
| `domain/combat/attack-resolver.test.ts` | `feat_archery` featId path |
| `domain/entities/classes/subclass-framework.test.ts` | Champion `additional-fighting-style` at L7 |

**Missing**: tabletop-flow test for GWF die-min (Gap 2 is undetected by current suite); end-to-end Protection/Interception scenarios (COVERAGE.md L37 admits Defense is "implicit via AC 20"; L39 lists TWF+Nick as "future scenario").

## Risks for Phase 3.1 Completion
1. **Gap 2 GWF-in-tabletop** is the highest-unknown — schema-level change likely (`RollResultCommand` carrying raw dice, or server-side reroll). Cross-flow with CombatOrchestration.
2. **Ally-scan architecture** in `AttackReactionHandler` is a structural change (multi-defender detect loop), not a one-file patch. Cross-flow with ReactionSystem SME.
3. **Interception post-damage path** is a new reaction phase — generalization vs narrow addition decision needs design alignment with ReactionSystem SME.
4. **Resource-flag placement** — per-attack computation recommended (dynamic equipment) vs persistent resource state (may go stale).
5. **Dueling "no offhand" fix** — no current scenarios dual-wield + Dueling, so low regression risk.
6. **No E2E scenario drives Protection/Interception today** — recommend authoring one per style before wiring to keep paths alive.

## Recommendations (confidence-ordered)
1. **Fix Gap 2 (GWF tabletop) first** — silent bug affecting existing PCs; coordinate with CombatOrchestration on dice-transport schema.
2. **Wire resource flags in `two-phase/attack-reaction-handler.ts`** when building `AttackReactionInput.resources`. Unblocks the dead reaction defs.
3. **Extend reaction dispatch to iterate allies within 5ft** — add `findAlliesWithinFt(target, 5, combatants)` helper; scope with ReactionSystem SME.
4. **Add Interception post-damage reduction phase** — new pending-action type between hit-confirm and HP-apply; design with ReactionSystem SME.
5. **Patch `shouldApplyDueling`** to accept `offhandEquipped` and pass from callers.
6. **Author Phase 2 scenarios** for protection-reaction and interception-reduction before implementation, so the work is driven by failing tests.
7. **Defer Gap 4 (AI attack path)** — revisit only if an AI NPC ally scenario surfaces.

---
_Note: this document replaces the earlier L1-5 audit that previously occupied this path._
<!-- Old L1-5 audit content removed — superseded by the Phase 3.1 brief above. -->

