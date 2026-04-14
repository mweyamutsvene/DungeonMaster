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
| `combat/ai/deterministic-ai.ts` | ~500 | Core AI decision engine: `evaluateSpellAction()`, `computeSpellValue()` |
| `combat/ai/ai-spell-evaluator.ts` | ~300 | Dedicated spell evaluation: damage estimation, heal priority, AoE targeting |
| `combat/ai/handlers/cast-spell-handler.ts` | ~200 | AI spell casting execution: spend action + slot, record event |
| `combat/ai/handlers/ai-spell-delivery.ts` | ~150 | Simplified spell resolution for AI (damage/heal without full dice flow) |
| `combat/ai/ai-bonus-action-picker.ts` | ~150 | Bonus action spell evaluation (Healing Word, Spiritual Weapon, etc.) |

## Key Types/Interfaces

- `evaluateSpellAction(creature, spell, targets, context)` — returns a value score for casting this spell
- `computeSpellValue(spell, targets, existingConcentration)` — raw value computation factoring in concentration tradeoff
- `CastSpellHandler.execute(creature, spell, target, context)` — spends action + slot, records combat event
- `AISpellDelivery.resolve(spell, caster, targets)` — simplified resolution (estimated damage/heal, no dice)
- `evaluateBonusActionSpell(creature, spells, allies, enemies)` — picks best bonus action spell

## Known Gotchas

- **AI spell casting does NOT resolve full spell mechanics** — saves, conditions, and exact damage are NOT computed. It only spends the action/slot and records the event. The TODO at line ~133-136 of `cast-spell-handler.ts` tracks this limitation. Full spell delivery only works through the player-facing tabletop dice flow.
- **Concentration replacement evaluation** — casting a new concentration spell drops the existing one. AI must weigh whether the new spell is worth losing the current one (e.g., don't drop a strong ongoing effect for a marginally better one).
- **AoE net value must subtract friendly fire** — `netValue = enemyDamage - allyDamage`. An AoE that hits 2 enemies and 1 ally may not be worth it.
- **Spell slot validation is mandatory** — never spend a slot the creature doesn't have. Check remaining slots before evaluating spells at that level.
- **Bonus action spells are separate economy** — if the AI casts a bonus action spell, it can still use its action for attacks or cantrips (but NOT for another leveled spell per D&D rules).
