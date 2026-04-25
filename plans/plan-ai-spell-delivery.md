---
type: plan
flow: AISpellEvaluation,SpellSystem,CombatOrchestration
feature: ai-spell-delivery-resolution
author: claude-orchestrator
status: DRAFT
created: 2026-04-24
updated: 2026-04-24
---

# Plan: AI Spell Delivery Resolution

## Why this matters

Currently `application/services/combat/ai/handlers/ai-spell-delivery.ts` records a `spell-cast` event and consumes a slot, but **does not actually resolve damage, saves, conditions, or concentration on targets**. Effect: AI spellcasters are cosmetic in mock combat and AI-vs-AI scenarios. PCs vs AI works because the player rolls dice, but AI casting at a player target produces no damage.

This is the biggest single blocker for L1-5 AI enemies (mages, evil clerics, drow priestesses).

## Current state

- `cast-spell-handler.ts` emits the event + spends slot
- `ai-spell-delivery.ts` is a stub
- Player-driven path goes through `SpellActionHandler` → delivery handlers (`SpellAttackDeliveryHandler`, `SaveSpellDeliveryHandler`, `HealingSpellDeliveryHandler`, `ZoneSpellDeliveryHandler`, `BuffDebuffSpellDeliveryHandler`, `DispelMagicDeliveryHandler`) which DO resolve effects.

## Proposed design

Make `SpellActionHandler` invokable from the AI path. Two options:

### Option A (recommended) — share the existing delivery handlers

Refactor `SpellActionHandler.handle()` to be callable without the `actor` being a Character. The delivery handlers already accept a `SpellCastingContext` with a `CombatantRef` actor that can be Monster or NPC. The blockers:

1. `sheet: CharacterSheet | null` field on context — handlers must tolerate `null` and read from monster `statBlock` instead. Already the case for several handlers (Spell Attack, Save) but verify all paths.
2. `roster: LlmRoster` is character-roster-shaped — extend to include monster roster entries for target resolution (already partial).
3. Slot-spend currently pulls from `Character` — extend to allow Monster slots (some monsters have spell slots in their stat block).

### Option B — duplicate handlers in AI path

Create AI-specific versions of each handler. Worse: drift between PC and AI behavior.

## Implementation order (Option A)

1. Audit each delivery handler for character-only assumptions:
   - `BuffDebuffSpellDeliveryHandler.handle` — already mostly generic
   - `HealingSpellDeliveryHandler` — uses `getSpellcastingModifier(sheet)` which assumes Character; extend to read from monster stat block via a shared helper
   - `SpellAttackDeliveryHandler` — uses sheet for spell attack bonus; same fix
   - `SaveSpellDeliveryHandler` — uses sheet for save DC; same fix
   - `ZoneSpellDeliveryHandler` — uses sheet for caster; same fix
   - `DispelMagicDeliveryHandler` — uses sheet for mod + PB; same fix

2. Create a `getCasterSpellStats(actor, sheet?, statBlock?) -> { spellSaveDC, spellAttackBonus, spellcastingMod, profBonus }` helper that handles both paths.

3. Refactor `SpellActionHandler.handle()` to accept an `actor: CombatantRef` (instead of just character flow). The existing param shape is already mostly there — verify non-character callers can drive it.

4. In `ai-spell-delivery.ts`, replace the stub with a call to `SpellActionHandler.handle()` with the AI's chosen spell + target.

5. Slot spending — for monsters, `Combat.spendSlot(actorRef, level)` reads from monster resources. Already partially supported; verify.

6. Reaction prompts — when AI casts a spell that triggers Counterspell, the existing two-phase flow already handles this on either side. Verify monster-as-caster works.

## Touched files

| File | Change |
|---|---|
| `application/services/combat/ai/handlers/ai-spell-delivery.ts` | Stub → call `SpellActionHandler.handle()` |
| `application/services/combat/tabletop/spell-action-handler.ts` | Verify non-character actor support; add fallback for sheet=null |
| `application/services/combat/helpers/spell-stats-helper.ts` (NEW) | `getCasterSpellStats` |
| Each spell-delivery/*.ts handler | Replace direct `sheet` reads with `getCasterSpellStats` |
| `domain/rules/spell-casting.ts` | Add `computeSpellSaveDCFromStatBlock(statBlock)` if missing |

## Test strategy

- New E2E: `scenarios/class-combat/core/ai-mage-vs-party.json` — Dark Mage casts Fireball at party, party takes damage, party casts Counterspell to break it (already-validated reaction system).
- Move `scenarios-pending/horde-encounter.json` into active suite once AI casting works (it currently exposes the auto-AoE bug, but that's a separate fix).
- Unit: `spell-action-handler.ts` test cases with monster actor.

## Risks

- Mid-cast pending actions for AI: AI doesn't have a UI to respond to pending actions. The existing spell-reaction handlers must auto-resolve for AI casters or AI must always-decline reaction opportunities. Today the AI reaction handler does this (`ai-reaction-handler.ts`); verify it covers Counterspell/Shield/Hellish Rebuke from monster casters too.
- Monster spell save DC: monster stat blocks have `spellSaveDC` directly in modern format but legacy entries may not. Fall back to compute from stat block fields.
- Concentration on monsters: `breakConcentration` already takes a CombatantStateRecord; verify monster path.

## Estimated scope

~1–2 days. ~6–8 files touched. ~300 LOC added (mostly the spell-stats helper + handler audits).

## Unblocks

- All AI-vs-PC encounters with monster spellcasters (Mage, Archmage, Cult Fanatic, Priest, etc.)
- AI-vs-AI mock combat for E2E development
- Validated AI behavior against Counterspell, Shield, Absorb Elements when AI casts
