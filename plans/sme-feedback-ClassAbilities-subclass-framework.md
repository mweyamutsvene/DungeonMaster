---
type: sme-feedback
flow: ClassAbilities
feature: subclass-framework-l3
author: ClassAbilities-SME
status: NEEDS_WORK
round: 1
created: 2026-04-26
updated: 2026-04-26
---

# SME Feedback — ClassAbilities — Subclass Framework L3
## Verdict: NEEDS_WORK

---

## ALREADY DONE (do not re-implement)

| Feature | Status | Key Files |
|---------|--------|-----------|
| **Champion: Improved Critical** | ✅ DONE | `domain/combat/attack-resolver.ts:180`, `tabletop/roll-state-machine.ts:507`, `registry.ts:getCriticalHitThreshold`. Unit tests in `subclass-framework.test.ts` + `roll-state-machine.improved-crit.test.ts`. No dedicated E2E scenario. |
| **Hunter: Colossus Slayer** | ✅ DONE | `tabletop/rolls/damage-resolver.ts:315-328`. Once-per-turn guard in `combat-hydration.ts:153` + `resource-utils.ts:201`. E2E: `ranger/hunters-mark-colossus.json`. |
| **Open Hand Technique** | ✅ DONE | `tabletop/rolls/hit-rider-resolver.ts:240-265`, `damage-resolver.ts:607-665`. Class guard in `class-feature-resolver.ts:hasOpenHandTechnique`. E2E: `monk/open-hand-technique.json`, `monk/open-hand-on-hit.json`, `class-combat/monk/flurry-and-open-hand.json`. |
| **Draconic Resilience** | ✅ DONE | `domain/entities/classes/class-feature-enrichment.ts:enrichSheetClassFeatures` — applies +1 HP/level and 13+DEX AC at character creation. Called from `character-service.ts:235` and `session-creatures.ts:96`. E2E: `sorcerer/draconic-resilience.json`. |
| **Dark One's Blessing** | ✅ DONE | `tabletop/rolls/damage-resolver.ts:451-461` — inlined kill-trigger (no bus needed). Domain logic in `warlock.ts:qualifiesForDarkOnesBlessing` + `darkOnesBlessingTempHp`. E2E: `warlock/fiend-dark-ones-blessing.json`. Plan's "new infra kill-trigger bus" was NOT needed. |
| **Berserker: Frenzy** | ✅ DONE | `executors/barbarian/frenzy-executor.ts` exists. Registered in `app.ts:293`. Domain combat text profile in `barbarian.ts:138-140`. E2E: `class-combat/barbarian/frenzy-extra-attack.json`. |
| **Life Domain: Disciple of Life** | ✅ DONE (partial E2E gap) | `tabletop/spell-delivery/healing-spell-delivery-handler.ts:124-131` (single target) and `:261-268` (AoE). Feature guard via `classHasFeature`. ⚠️ No dedicated E2E scenario — covered only incidentally by `class-combat/cleric/bless-and-bane-party.json` which doesn't test healing output. |

---

## NEEDS IMPLEMENTATION

### 1. Thief: Fast Hands
- **What exists**: `FAST_HANDS` feature key, `rogue.ts:"fast-hands": 3`, unit tests in `subclass-framework.test.ts`.
- **What's missing**: `cunning-action-executor.ts` only handles `dash/disengage/hide`. No useObject / Sleight of Hand / Thieves' Tools choices. No E2E scenario.
- **Fix**: Extend `CunningActionExecutor.canExecute` and `execute` to accept `choice: "useObject" | "sleightOfHand" | "thievesTools"` when actor has `fast-hands`. Add `FAST_HANDS` check in executor.

### 2. Devotion: Sacred Weapon
- **What exists**: `SACRED_WEAPON` feature key, `paladin.ts:[SACRED_WEAPON]: 3`, unit test in `subclass-framework.test.ts`. `ChannelDivinityExecutor` exists but **only implements Divine Sense** — no sacred weapon logic.
- **What's missing**: Channel Divinity: Sacred Weapon — add CHA mod to attack rolls + treat as magical for 1 minute. Needs: executor branch or new executor, active-effect application, expend Channel Divinity use.
- **Fix**: Either extend `ChannelDivinityExecutor` with `choice: "sacredWeapon"` branch, or create `SacredWeaponExecutor`. Add combat text mapping in `PALADIN_COMBAT_TEXT_PROFILE`. No E2E scenario.

### 3. Hunter's Prey L3 Choice (Horde Breaker + Giant Killer)
- **What exists**: `COLOSSUS_SLAYER` is hardwired as the only Hunter feature at L3. `HUNTERS_PREY` feature key exists. Ranger subclass definition has `[COLOSSUS_SLAYER]: 3` — no choice mechanism.
- **What's missing**: Horde Breaker (free attack vs 2nd adjacent enemy once/turn) and Giant Killer (reaction attack vs Large+ creature that misses you) are unimplemented. No subclass-choice field on Hunter subclass definition.
- **Fix**: Add `hordeBreaker` and `giantKiller` to Hunter subclass features. Wire Horde Breaker in damage-resolver (post-attack free attack). Wire Giant Killer in reaction system. Alternatively, defer Horde Breaker and Giant Killer to Tier C and document.

---

## Champion: Improved Critical — E2E Gap
- No dedicated E2E scenario testing a Champion rolling a 19 → crit. The feature works (unit tests pass) but there's no regression guard for it.
- Recommend: add `class-combat/fighter/champion-improved-crit.json` extending existing fighter scenarios with subclass = "Champion".

## Disciple of Life — E2E Gap
- Feature is implemented but no dedicated scenario validates the `+(2 + spellLevel)` bonus on Cure Wounds. Should add `class-combat/cleric/disciple-of-life-healing.json`.

---

## Architectural Risks

1. **Sacred Weapon as active effect**: Duration tracking (1 minute = 10 rounds) requires the active-effects pipeline. Existing effects like Rage and Bless follow this pattern — use the same `ActiveEffect` shape. Do NOT add a boolean flag to the character sheet.

2. **Colossus Slayer only = silent Horde Breaker bug**: If a character is built as `subclass: "Hunter"` without specifying colossus-slayer choice, the current implementation auto-grants colossus-slayer to all Hunters. This is a mild rules violation but acceptable for L1-5 scope unless the plan targets choice fidelity.

3. **Dark One's Blessing plan was over-engineered**: Plan described a new event bus — actual implementation is simpler (inline in damage-resolver). Confirm this is intentional and close the `kill-trigger-bus.ts (NEW)` item in the plan.
