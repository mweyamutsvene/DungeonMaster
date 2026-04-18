---
description: "Architecture and conventions for the AISpellEvaluation flow: AI spell decision-making, slot economy, spell value computation, AI spell casting pipeline, bonus action spell evaluation."
applyTo: "packages/game-server/src/application/services/combat/ai/deterministic-ai.ts,packages/game-server/src/application/services/combat/ai/ai-spell-evaluator.ts,packages/game-server/src/application/services/combat/ai/handlers/cast-spell-handler.ts,packages/game-server/src/application/services/combat/ai/handlers/ai-spell-delivery.ts,packages/game-server/src/application/services/combat/ai/ai-bonus-action-picker.ts"
---

# AISpellEvaluation Flow

## Purpose
Deterministic AI spell decision-making: evaluates which spell to cast and when, computes spell value against targets, manages slot economy, and executes AI spell casting. The most complex AI subsystem combining slot economy + targeting + D&D spell rules.

## File Responsibility Matrix

| File | ~Lines | Responsibility |
|------|--------|----------------|
| `combat/ai/deterministic-ai.ts` | ~500 | Core AI decision engine: calls `pickSpell()` from ai-spell-evaluator for spell decisions |
| `combat/ai/ai-spell-evaluator.ts` | ~400 | Dedicated spell evaluation: `pickSpell()`, `estimateSpellDamage()`, `hasAvailableSlot()`, `getLowestAvailableSlotLevel()`, AoE targeting |
| `combat/ai/handlers/cast-spell-handler.ts` | ~210 | AI spell casting execution: spend slot via `prepareSpellCast()`, then full mechanical delivery via `AiSpellDelivery` |
| `combat/ai/handlers/ai-spell-delivery.ts` | ~200+ | Full spell resolution for AI: save-based damage (with SavingThrowResolver), healing, spell attacks, buff/debuff conditions, zone creation |
| `combat/ai/ai-bonus-action-picker.ts` | ~220 | Bonus action spell/feature evaluation: `pickBonusAction()`, `pickFeatureAction()`, `pickHealingForDyingAlly()` |

## Key Types/Interfaces

- `pickSpell(combatant, target, allies, name, round, ...)` in `ai-spell-evaluator.ts` — main spell selection entry point; returns a `castSpell` AiDecision or null
- `estimateSpellDamage(spell, casterLevel)` in `ai-spell-evaluator.ts` — expected damage estimate for scoring
- `hasAvailableSlot(resources, level)` / `getLowestAvailableSlotLevel(resources)` in `ai-spell-evaluator.ts` — slot economy checks
- `CastSpellHandler.execute(ctx, deps)` in `cast-spell-handler.ts` — spends slot via `prepareSpellCast()`, then calls `AiSpellDelivery.deliver()` for full mechanical resolution
- `AiSpellDelivery.deliver(sessionId, encounterId, caster, spellDef, targetCombatant, targetName, castAtLevel, casterSource)` in `ai-spell-delivery.ts` — full spell delivery with dice, saves, conditions, zones
- `pickBonusAction(combatant, ...)` in `ai-bonus-action-picker.ts` — picks best bonus action spell or feature
- `pickFeatureAction(combatant, ...)` in `ai-bonus-action-picker.ts` — picks class feature actions

## Known Gotchas

- **AI spell casting DOES fully resolve spell mechanics** — `AiSpellDelivery.deliver()` handles saves (via `SavingThrowResolver`), resistance/immunity/vulnerability, healing with upcast scaling, spell attack rolls, buff/debuff `ActiveEffect` application, and zone creation via `addZone()`. This is NOT a simplified estimate path.
- **Concentration replacement evaluation** — casting a new concentration spell drops the existing one. AI must weigh whether the new spell is worth losing the current one (e.g., don't drop a strong ongoing effect for a marginally better one).
- **AoE net value must subtract friendly fire** — `netValue = enemyDamage - allyDamage`. An AoE that hits 2 enemies and 1 ally may not be worth it.
- **Spell slot validation is mandatory** — never spend a slot the creature doesn't have. Check `hasAvailableSlot()` before evaluating spells at that level.
- **Bonus action spells are separate economy** — if the AI casts a bonus action spell, it can still use its action for attacks or cantrips (but NOT for another leveled spell per D&D rules).
