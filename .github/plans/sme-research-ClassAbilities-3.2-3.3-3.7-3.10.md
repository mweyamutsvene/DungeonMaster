# SME Research — ClassAbilities — Phase 3 Sub-Item Scoping (3.2 / 3.3 / 3.7 / 3.10)

Scope: verify implementation state of four remaining Phase 3 sub-items in [plan-class-abilities-l1-5-complete.prompt.md](.github/prompts/plan-class-abilities-l1-5-complete.prompt.md) against live source.

---

## 3.2 — Rogue Cunning Strike (L5, 2024) — **NOT STARTED**

Current state:
- [rogue.ts](packages/game-server/src/domain/entities/classes/rogue.ts) declares `"cunning-strike": 5` in the features map and lists it as a capability, **but has no `ClassActionMapping`, no `AttackEnhancementDef`, and no effect definition** (Poison / Trip / Withdraw).
- Executors folder [executors/rogue/](packages/game-server/src/application/services/combat/abilities/executors/rogue) contains only `cunning-action-executor.ts` + `index.ts`. No Cunning Strike executor.
- No scenario file `rogue/cunning-strike.json` exists.
- Sneak Attack damage is assembled inline in [roll-state-machine.ts](packages/game-server/src/application/services/combat/tabletop/roll-state-machine.ts#L907-L1024) by injecting `${n}d6` into the damage formula; subtraction of dice (the 2024 "forgo dice before roll" mechanic) has **no hook**. Usage marker `sneakAttackUsedThisTurn` is written in [damage-resolver.ts](packages/game-server/src/application/services/combat/tabletop/rolls/damage-resolver.ts#L432-L438).

Files involved (to touch):
- `rogue.ts` — add `cunningStrikeEffects` metadata or direct ActionMapping set.
- `roll-state-machine.ts` — support `cunningStrike?: { option: 'poison'|'trip'|'withdraw' }` on the pending ATTACK action, deducting dice from `sneakAttackDiceCount` before formula build.
- `damage-resolver.ts` — after damage applied, fire post-hit rider: CON save (Poison→Poisoned 1rd), DEX save (Trip→Prone), Withdraw→grant free Disengage bonus.
- New executor or dispatch hook for choosing the option at attack-declare time (likely inline parser `"sneak attack poison"` / extension on attack command).
- New scenario `scripts/test-harness/scenarios/rogue/cunning-strike.json`.

Complexity: **M**. Core plumbing exists (SA dice, save resolver, prone + disengage already supported). Work is wiring choice + dice subtraction + 3 post-hit effects.

---

## 3.3 — Spiritual Weapon persistent attack (GAP-12) — **PARTIAL**

Current state:
- [level-2.ts:185](packages/game-server/src/domain/entities/spells/catalog/level-2.ts#L185) defines `SPIRITUAL_WEAPON` as `isBonusAction: true`, `melee_spell`, 1d8 force, **no concentration** (correct for 2024). Contains explicit TODO: "Subsequent turns allow bonus action to move weapon 20ft + repeat melee spell attack".
- [ai-bonus-action-picker.ts:207-210](packages/game-server/src/application/services/combat/ai/ai-bonus-action-picker.ts#L207) already returns `"spiritualWeaponAttack"` when `combatant.concentrationSpell === "spiritual weapon"` — but: (a) the spell is NOT marked concentration, so this branch never fires, and (b) there is no handler for that token in tabletop text flow.
- [cleric.ts](packages/game-server/src/domain/entities/classes/cleric.ts) `CLERIC_COMBAT_TEXT_PROFILE` has ONLY `turn-undead`; no action mapping for "spiritual weapon attack".
- No executor in `executors/cleric/`.
- No scenario `cleric/spiritual-weapon-loop.json`.
- Spell-delivery handlers in [spell-delivery/](packages/game-server/src/application/services/combat/tabletop/spell-delivery) have no "persistent attack rider" / "summoned-entity" concept.

Files involved (to touch):
- Install rider in `spell-attack-delivery-handler.ts` (or new `persistent-attack-spell-delivery.ts`) — on cast, write `resources.spiritualWeapon = { attackBonus, damageDice, expiresRound }`.
- `cleric.ts` — add ActionMapping `spiritual-weapon-attack` as `bonusAction`.
- New executor in `executors/cleric/spiritual-weapon-attack-executor.ts` — consumes bonus action, fires a spell attack using stored rider state.
- AI picker: fix tracking to use the resource rider (not `concentrationSpell`) and add handler.
- New scenario.
- Turn-end/long-rest cleanup for rider (1 min duration = 10 rounds).

Complexity: **M-L**. This is the first "persistent spell-entity lite" — establishes a pattern that Summon Beast etc. will follow, so architecture choice matters.

---

## 3.7 — Warlock Fiend subclass + Agonizing Blast / Hex rider — **PARTIAL**

Current state:
- [warlock.ts](packages/game-server/src/domain/entities/classes/warlock.ts) has `TheFiendSubclass` shell with `DARK_ONES_BLESSING: 3` and `FIEND_EXPANDED_SPELLS: 3` but NO executor, NO event hook, NO `AttackEnhancementDef`.
- `WARLOCK_COMBAT_TEXT_PROFILE` contains only `HELLISH_REBUKE_REACTION`. No Agonizing Blast enhancement, no Dark One's Blessing listener.
- No executor files in `executors/warlock/` (directory does not exist — confirmed by listing).
- **No "creature-killed" / "enemy-reduced-to-0" event anywhere** in the codebase (grep for onKill / creatureKilled returns nothing; only tempHp read/write via `temp-hp.ts` helpers exists).
- Scenario **exists**: [class-combat/warlock/hex-and-blast.json](packages/game-server/scripts/test-harness/scenarios/class-combat/warlock/hex-and-blast.json) — covers Hex + EB multi-beam at L5 (2 beams). Does NOT test Agonizing Blast (+CHA/beam) or Dark One's Blessing (L5 Warlock is not subclass-L3-gated only — but scenario character has no subclass set and training-dummy monsters never die).
- Hex damage rider already noted as working ("Hex damage applied server-side per beam") in scenario description.

Files involved (to touch):
- `warlock.ts` — add `AGONIZING_BLAST` `AttackEnhancementDef` gated on invocation flag + Eldritch Blast spell id, adds CHA to each beam's damage (modify beam damage in `damage-resolver.ts` multi-attack chain).
- New executor + event hook for Dark One's Blessing — needs a "target reduced to 0" hook. Likely cleanest: emit a domain event from `applyDamageWithTempHp` when hp→0 and caller is a Fiend warlock, grant `CHA mod + warlock level` tempHp via `withTempHp`.
- Extend existing scenario or add `warlock/fiend-dark-ones-blessing.json`.

Complexity: **M**. Agonizing Blast is isolated (one attack enhancement). Dark One's Blessing introduces a new death-event hook — small but cross-cutting (damage-resolver + ai-attack-resolver both write 0-hp paths).

Risk: the on-kill hook is tempting to inline but should be a shared helper so Great Weapon Master, Piercer, etc. can reuse.

---

## 3.10 — Sorcerer Metamagic breadth — **PARTIAL (2/8 done)**

Current state:
- [sorcerer.ts](packages/game-server/src/domain/entities/classes/sorcerer.ts) `SORCERER_COMBAT_TEXT_PROFILE` has only `quickened-spell`, `twinned-spell`, `flexible-casting`.
- Executors [executors/sorcerer/](packages/game-server/src/application/services/combat/abilities/executors/sorcerer): `quickened-spell-executor.ts`, `twinned-spell-executor.ts`, `flexible-casting-executor.ts`. None for the other 6.
- [action-dispatcher.ts:401](packages/game-server/src/application/services/combat/tabletop/action-dispatcher.ts#L401) has a `metamagicCast` parser that **only** matches `/^\s*quickened\s+spell\s+(cast\s+.+)$/i` — Twinned is NOT wired via this chain (presumably its executor stands alone) and none of the 6 missing metamagics are parsed.
- Scenario `sorcerer/metamagic-burst.json` exists but exercises only Quickened + Twinned + Elemental Affinity.
- NO implementation for: **Careful** (exempt allies from AoE save), **Distant** (2x range / 30ft touch), **Empowered** (reroll up to CHA damage dice), **Extended** (2x duration), **Heightened** (disadv on first save — 3 SP), **Subtle** (no V/S components).

Files involved (to touch):
- `sorcerer.ts` — 6 new `ClassActionMapping`s + helper to cost each (1–3 SP).
- `action-dispatcher.ts` — generalize `metamagicCast` parser: regex `/^\s*(quickened|distant|careful|empowered|extended|heightened|subtle|twinned)\s+spell\s+(cast\s+.+)$/i` → dispatch to option-specific pre-cast transform.
- New executors under `executors/sorcerer/`. Each modifies the `CastSpellOptions` or post-roll state:
  - Careful → mark chosen allies as auto-pass on the next save triggered by this spell (save-delivery handler flag).
  - Distant → multiply `range` in delivery.
  - Empowered → post-damage hook: reroll up to `chaMod` damage dice (free `damage-resolver` flag).
  - Extended → double `roundsRemaining` on returned effects.
  - Heightened → apply `disadvantage: true` to the first save resolved for this spell cast.
  - Subtle → no mechanical combat effect; just allow casting while Silenced/restrained verbal. Low value in combat E2E; still needs SP cost + success token.
- Extend `metamagic-burst.json` or add `sorcerer/metamagic-breadth.json`.

Complexity: **L**. Empowered + Heightened + Careful touch damage-resolver and save-resolver respectively; require new pending-action flags. Distant + Extended are straightforward data patches. Subtle is trivial (SP burn only).

---

## Summary & Recommended Order (ROI-based)

| # | Item | State | Complexity | Scenario exists | ROI rank |
|---|------|-------|------------|------------------|----------|
| 3.2 | Rogue Cunning Strike | NOT STARTED | M | No | **1 (do first)** |
| 3.7 | Warlock Fiend + Agonizing Blast + Hex | PARTIAL (Hex OK) | M | Partial (hex-and-blast.json) | **2** |
| 3.10 | Metamagic breadth (6 options) | PARTIAL (2/8) | L | Partial | **3** |
| 3.3 | Spiritual Weapon persistent attack | PARTIAL | M-L | No | **4 (last)** |

Rationale:
- **3.2 first** — high value (a 2024-new core feature that unlocks real rogue gameplay at L5+), isolated to rogue files + one formula hook, no architectural risk.
- **3.7 second** — Agonizing Blast is a tiny enhancement but completes the Warlock combat loop; Dark One's Blessing introduces a reusable "on-kill" hook that will pay dividends for other features (Piercer, GWM cleave, etc.). Existing hex-and-blast scenario can be extended rather than rewritten.
- **3.10 third** — largest effort, touches two resolvers, but each metamagic is a narrow slice; can ship in sub-batches (Empowered + Heightened first — most common table picks).
- **3.3 last** — introduces the persistent-spell-entity pattern which should be designed deliberately (future impact on Summon Beast, Conjure Animals, Moonbeam-move). Worth waiting until the other three are merged so the refactor has a stable foundation.

Open flags for orchestrator:
- `SPIRITUAL_WEAPON` currently has no concentration and no rider → first cast works but re-attack does not. AI picker branch is dead code today. Worth fixing in 3.3 scope, not as a quick patch.
- No generic "on-enemy-reduced-to-zero" event bus exists. 3.7 should create one rather than inlining the Dark One's Blessing hook.
- `metamagicCast` parser in action-dispatcher.ts currently hard-codes Quickened only; Twinned is reachable only via LLM intent → classAction path. Confirm before 3.10 whether Twinned is actually exercised end-to-end from text.
