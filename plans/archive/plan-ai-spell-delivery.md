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

**Problem**: `ai-spell-delivery.ts` records `spell-cast` + spends slot but resolves nothing. AI spellcasters do zero damage. Biggest L1-5 blocker.

**Root cause**: player path uses `SpellActionHandler` → delivery handlers. AI path is stub.

## Fix: share existing delivery handlers (Option A)

Make `SpellActionHandler.handle()` callable from AI. Already mostly generic — just need to handle `sheet=null` (monster uses `statBlock`).

### Steps

1. Create `application/services/combat/helpers/spell-stats-helper.ts` with `getCasterSpellStats(actor, sheet?, statBlock?) → { spellSaveDC, spellAttackBonus, spellcastingMod, profBonus }`.
2. Each delivery handler that directly reads `sheet` → use helper instead: `HealingSpellDeliveryHandler`, `SpellAttackDeliveryHandler`, `SaveSpellDeliveryHandler`, `ZoneSpellDeliveryHandler`, `DispelMagicDeliveryHandler`.
3. Verify `SpellActionHandler.handle()` accepts `actor: CombatantRef` (not just character).
4. Replace `ai-spell-delivery.ts` stub with call to `SpellActionHandler.handle()`.
5. Verify monster slot spend via `Combat.spendSlot(actorRef, level)`.
6. Verify `ai-reaction-handler.ts` covers monster-as-caster Counterspell/Shield.

### Files

| File | Change |
|---|---|
| `ai/handlers/ai-spell-delivery.ts` | Stub → call `SpellActionHandler.handle()` |
| `tabletop/spell-action-handler.ts` | Verify non-character actor; sheet=null fallback |
| `helpers/spell-stats-helper.ts` (NEW) | `getCasterSpellStats` |
| `spell-delivery/*.ts` | Replace direct sheet reads with helper |
| `domain/rules/spell-casting.ts` | Add `computeSpellSaveDCFromStatBlock` if missing |

## Tests
- E2E: `scenarios/class-combat/core/ai-mage-vs-party.json` — mage casts Fireball, party takes damage, party Counterspells
- Unit: `spell-action-handler.ts` with monster actor

## Risks
- AI has no UI for pending actions mid-cast → `ai-reaction-handler.ts` must auto-resolve; verify covers monster caster
- Legacy monster stat blocks may lack `spellSaveDC` → fallback to compute from stats
- `breakConcentration` already takes `CombatantStateRecord`; verify monster path

## Scope
~1–2 days. 6–8 files. ~300 LOC.

## Unblocks
AI-vs-PC with monster spellcasters (Mage, Archmage, Cult Fanatic, Priest, Drow Priestess), AI-vs-AI mock combat, AI Counterspell/Shield validation.
