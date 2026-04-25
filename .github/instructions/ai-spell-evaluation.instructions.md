---
description: "Architecture and conventions for the AISpellEvaluation flow: AI spell decision-making, slot economy, spell value computation, AI spell casting pipeline, bonus action spell evaluation."
applyTo: "packages/game-server/src/application/services/combat/ai/deterministic-ai.ts,packages/game-server/src/application/services/combat/ai/ai-spell-evaluator.ts,packages/game-server/src/application/services/combat/ai/handlers/cast-spell-handler.ts,packages/game-server/src/application/services/combat/ai/handlers/ai-spell-delivery.ts,packages/game-server/src/application/services/combat/ai/ai-bonus-action-picker.ts"
---

# AISpellEvaluation Flow

## Purpose
Deterministic AI spellcasting has two separate parts: selection heuristics in `ai-spell-evaluator.ts` and `ai-bonus-action-picker.ts`, and execution in `CastSpellHandler` plus `AiSpellDelivery`. The selector is heuristic rather than a full rules engine; the execution path performs slot spending, concentration updates, and mechanical spell resolution.

## File Responsibility Matrix

| File | ~Lines | Responsibility |
|------|--------|----------------|
| `combat/ai/deterministic-ai.ts` | ~500 | Thin AI turn orchestrator: previews bonus actions, enforces the 2024 bonus-action-spell/cantrip restriction, delegates spell choice to `pickSpell()`, and returns the final AI decision |
| `combat/ai/ai-spell-evaluator.ts` | ~400 | Heuristic spell selector: `pickSpell()`, `estimateSpellDamage()`, slot checks, simple ranking for healing/buff/debuff/damage, and enemy-focused AoE upside estimation |
| `combat/ai/handlers/cast-spell-handler.ts` | ~210 | AI spell-cast executor: resolves metadata, opens Counterspell reactions, calls `prepareSpellCast()` for slot spending and concentration replacement, then delegates to `AiSpellDelivery` |
| `combat/ai/handlers/ai-spell-delivery.ts` | ~200+ | Mechanical AI spell resolution: spell attacks, healing, save-based damage, effect application, and zone creation; AoE center choice penalizes ally hits |
| `combat/ai/ai-bonus-action-picker.ts` | ~220 | Bonus action spell/feature evaluation: `pickBonusAction()`, `pickFeatureAction()`, `pickHealingForDyingAlly()` |

## Key Types/Interfaces

- `pickSpell(combatant, target, allies, name, round, ...)` in `ai-spell-evaluator.ts` — main spell selection entry point; returns a `castSpell` AiDecision or null
- `estimateSpellDamage(spell, casterLevel)` in `ai-spell-evaluator.ts` — expected damage estimate for scoring
- `hasAvailableSlot(resources, level)` / `getLowestAvailableSlotLevel(resources)` in `ai-spell-evaluator.ts` — slot economy checks
- `CastSpellHandler.execute(ctx, deps)` in `cast-spell-handler.ts` — spends slot via `prepareSpellCast()`, then calls `AiSpellDelivery.deliver()` for full mechanical resolution
- `AiSpellDelivery.deliver(sessionId, encounterId, caster, spellDef, targetCombatant, targetName, castAtLevel, casterSource)` in `ai-spell-delivery.ts` — full spell delivery with dice, saves, conditions, zones
- `pickBonusAction(combatant, ...)` in `ai-bonus-action-picker.ts` — picks best bonus action spell or feature
- `pickFeatureAction(combatant, ...)` in `ai-bonus-action-picker.ts` — picks class feature actions
- `prepareSpellCast()` in `helpers/spell-slot-manager.ts` — owns slot validation and concentration-state mutation for both tabletop and AI spellcasting paths

## Known Gotchas

- **AI spell casting DOES fully resolve spell mechanics** — `AiSpellDelivery.deliver()` handles saves (via `SavingThrowResolver`), resistance/immunity/vulnerability, healing with upcast scaling, spell attack rolls, buff/debuff `ActiveEffect` application, and zone creation via `addZone()`. This is NOT a simplified estimate path.
- **Concentration replacement is not scored as a tradeoff yet** — if the AI is already concentrating, `pickSpell()` filters out new concentration spells entirely. Actual concentration-state replacement happens later in `prepareSpellCast()`.
- **AoE evaluation is split** — `ai-spell-evaluator.ts` estimates upside mostly from enemy coverage. Friendly-fire reduction happens later in `AiSpellDelivery.resolveTargets()`, which penalizes ally hits when choosing the AoE center.
- **Spell slot validation is mandatory** — never spend a slot the creature doesn't have. Check `hasAvailableSlot()` before evaluating spells at that level.
- **Bonus action spells are separate economy** — if the AI casts a bonus action spell, it can still use its action for attacks or cantrips (but NOT for another leveled spell per D&D rules).
