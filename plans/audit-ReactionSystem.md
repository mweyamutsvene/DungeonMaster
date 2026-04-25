---
type: sme-research
flow: ReactionSystem
feature: mechanics-audit-l1-5
author: claude-sme-reaction-system
status: DRAFT
created: 2026-04-24
updated: 2026-04-25
---

## Scope

Audit of the two-phase reaction flow for D&D 5e 2024, L1-5 coverage. Sources read in full:
- `packages/game-server/src/application/services/combat/two-phase-action-service.ts`
- `packages/game-server/src/application/services/combat/two-phase/move-reaction-handler.ts`
- `packages/game-server/src/application/services/combat/two-phase/attack-reaction-handler.ts`
- `packages/game-server/src/application/services/combat/two-phase/spell-reaction-handler.ts`
- `packages/game-server/src/application/services/combat/two-phase/damage-reaction-handler.ts`
- `packages/game-server/src/domain/entities/combat/pending-action.ts`
- `packages/game-server/src/application/services/combat/tabletop/pending-action-state-machine.ts`
- `packages/game-server/src/application/services/combat/helpers/oa-detection.ts`

## Currently Supported

**Two-phase pending-action pipeline is architecturally sound.**

- `TwoPhaseActionService` is a clean facade delegating to four handlers: move, attack, spell, damage.
- `PendingActionStateMachine` enforces valid transitions (`CREATED -> PROMPT_SENT -> RESOLVED|TIMED_OUT|CANCELLED`). Invalid transitions throw.
- `PendingAction` discriminated union correctly models the four trigger kinds.
- Reaction-consumption bookkeeping (one reaction per round, resets at start of YOUR turn).

**Opportunity attack detection** (`oa-detection.ts`): centralized; reused by programmatic movement and two-phase initiate. Detects: creature leaves an enemy's reach without the Disengage action. Disengage suppresses OAs. Reach (5ft default, 10ft for reach weapons) is consulted per-attacker.

**Per-trigger handlers:**
- Move: Triggers OA prompts when a mover exits reach; prompts each eligible threatener in turn.
- Attack: Supports Shield as reaction; applies +5 AC retroactively to triggering attack AND persists the buff until start of caster's next turn (2024-correct).
- Spell: Counterspell path — checks reaction economy, spell slot availability.
- Damage: Post-damage hook exists; damage is applied first, then reaction window opens.

## Needs Rework

1. **Counterspell 2024 ruleset confusion risk.** 2024 Counterspell is a Constitution save (by the target caster) against the Counterspell-caster's spell save DC, not a 2014 ability check. Verify and port if still on 2014 rules.
2. **Shield persistence tracking.** The +5 AC must last "until the start of your next turn" — across multiple incoming attacks. Verify it's stored as a timed effect on the defender, not only applied to the triggering attack.
3. **Reaction reset timing.** 2024: regains its reaction at start of **its own** turn, not at round-start. Verify `startTurn` (not `startRound`) does the reset.
4. **OA on stand-from-prone and forced movement.** RAW: forced movement (shove, Thunderwave push) does NOT trigger OAs. Standing up from prone does NOT trigger OAs. Verify `oa-detection.ts` respects a "voluntary movement" flag.
5. **Teleport/special movement.** Misty Step and similar don't trigger OAs. Verify teleport moves are excluded.
6. **Two-phase timeout semantics.** Confirm timeout defaults to "decline reaction" (safe default).

## Missing — Required for L1-5

### P0 (very common at L1-5)

- **Absorb Elements** (L1 spell, reaction to elemental damage taken) — Needs damage-reaction-handler wiring; fires AFTER damage for resistance-to-halving AND stores the next-melee-bonus-damage rider.
- **Hellish Rebuke** (Warlock L1 spell, reaction to being damaged by visible creature) — Needs damage-reaction wiring with a "damager" reference.
- **Deflect Attacks** (Monk L1 2024, renamed from Deflect Missiles, now covers melee too) — Reaction to being hit; reduces damage by 1d10 + Dex + Monk level; if reduced to 0 and ranged, spend Focus to redirect as thrown attack.
- **Slow Fall** (Monk L4) — Reaction to falling; reduces fall damage by 5×Monk level. **Needs a new trigger kind** — falling is not currently a pending-action type.
- **Protection fighting style** (Fighter/Paladin, 2024 reaction: impose disadvantage on attack vs ally within 5ft while wielding a shield).
- **Interception fighting style** (Fighter 2024, reaction to reduce damage to ally within 5ft by 1d10 + PB). Needs damage-reaction wiring for ALLY damage events.

### P1 (common but niche at L1-5)

- **Sentinel feat** — OA even on Disengage, and when ally adjacent is attacked.
- **Polearm Master** OA when creature enters reach (currently `oa-detection.ts` only detects leave-reach events).
- **Cutting Words** (Bard Lore L3) — Reaction to subtract BI die from attack roll / ability check / damage roll. Needs a **roll-interrupt hook** — NOT currently modeled. Attack-reaction-handler only supports AC-modifying reactions, not roll-result-modifying reactions. **Architectural gap.**

### P2 (most L1-5 monsters lack meaningful reactions; non-blocker)

## Cross-Flow Dependencies

- **SpellSystem** — Absorb Elements, Counterspell 2024 Con-save mechanic, Hellish Rebuke, Shield; all require spell definitions that declare `reaction: true` plus trigger metadata.
- **ClassAbilities** — Deflect Attacks, Slow Fall, Cutting Words, Interception/Protection fighting styles need class-feature definitions with reaction hooks.
- **CombatOrchestration** — Reaction prompt payload needs trigger kind, eligible responses, reaction-economy state, timeout.
- **ActionEconomy** — Reaction reset at start-of-own-turn (not round start).
- **CombatRules** — Forced movement / teleport / stand-from-prone exclusions for OA detection live in `oa-detection.ts`.
- **EntityManagement** — Shield's +5 AC persistence needs a status-effect entry with "until start of your next turn" duration. Ally-triggered reactions (Protection, Interception, Sentinel) require ally-proximity queries.

---

## Summary

**Architecture sound; content thin.** Of ~12 canonical L1-5 reactions, only Shield, Counterspell, and plain OAs are meaningfully wired.

**Missing: Absorb Elements, Hellish Rebuke, Deflect Attacks, Slow Fall, Protection, Interception, Sentinel, Cutting Words, Polearm Master enter-reach OA.**

**Architectural gaps that will bite:**
1. No **roll-interrupt** reaction kind (blocks Cutting Words, Silvery Barbs when added, Bardic Lore).
2. No **fall-damage** pending-action trigger (blocks Slow Fall).
3. No **ally-targeting** reaction kind for attack-on-ally and damage-to-ally (blocks Protection, Interception, Sentinel).
4. No **enter-reach** OA detection variant (blocks Polearm Master).
5. **Counterspell** likely still on 2014 rules.

**Priority order:**
1. Port Counterspell to 2024 rules
2. Add Absorb Elements
3. Verify Shield persistence
4. Add roll-interrupt reaction kind + Cutting Words
5. Add ally-targeting reaction kind + Protection/Interception
6. Add Deflect Attacks + Hellish Rebuke
7. Add fall-damage trigger + Slow Fall
8. Add PAM enter-reach OA + Sentinel Disengage-override


## R2 Refresh (2026-04-25)

- R2 validated: Counterspell 2024, Absorb Elements, Hellish Rebuke, Deflect Attacks, Protection, and Interception are implemented.
- R2 correction: Cutting Words/Sentinel are partial (architecture surface still incomplete).
- Remaining concern: generalized roll-interrupt architecture and Polearm Master enter-reach OA.
