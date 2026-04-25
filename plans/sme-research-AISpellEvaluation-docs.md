# SME Research — AISpellEvaluation — Docs Accuracy

## Scope
- Docs read: `.github/instructions/ai-spell-evaluation.instructions.md`, `packages/game-server/src/application/services/combat/ai/CLAUDE.md`
- Code read: `deterministic-ai.ts`, `ai-spell-evaluator.ts`, `handlers/cast-spell-handler.ts`, `handlers/ai-spell-delivery.ts`, `ai-bonus-action-picker.ts`
- Adjacent verification: `helpers/spell-slot-manager.ts`, `deterministic-ai.test.ts`

## Current Truth
- The instruction file is partly current: AI spell execution does go through `CastSpellHandler` and then `AiSpellDelivery`, and `AiSpellDelivery` now performs real mechanics for spell attacks, healing, save-based damage, conditions/effects, and zones.
- `deterministic-ai.ts` is a thin turn orchestrator. Spell choice is delegated to `pickSpell()` in `ai-spell-evaluator.ts`, and bonus-action coordination is split with `ai-bonus-action-picker.ts`.
- Bonus-action spell coordination is enforced in `deterministic-ai.ts`: if the previewed bonus action is a spell, the main action spell search is restricted to cantrips only; otherwise the AI may attack or use a non-spell bonus action.
- Slot spending and concentration replacement are handled by `prepareSpellCast()` in `spell-slot-manager.ts`, not by the evaluator. That helper validates slot availability, supports pact/legacy slot formats, and breaks prior concentration before setting the new concentration spell.
- `ai-spell-evaluator.ts` is still heuristic, not deep rules reasoning. It does basic healing/debuff/buff/cantrip/damage ranking, uses damage-type multipliers, and estimates AoE value mostly from enemy count.
- Friendly-fire avoidance exists, but not where the doc currently implies. The evaluator does not compute `enemyDamage - allyDamage`. The actual ally-avoidance logic is in `AiSpellDelivery.resolveTargets()`, which scores candidate AoE centers with `enemiesHit * 2 - alliesHit * 3` and then only returns enemy targets inside the chosen area.
- Concentration replacement is only handled as a hard filter in the evaluator today: if already concentrating, `pickSpell()` removes concentration candidates entirely instead of weighing replacement tradeoffs.

## Drift Findings
1. The instruction file still says `deterministic-ai.ts` is the "core AI decision engine" for spell decisions. That is now misleading. The file orchestrates; the spell heuristics live in `ai-spell-evaluator.ts`.
2. The instruction file overstates evaluator sophistication on concentration replacement. Current behavior is not "weigh this tradeoff"; it is "do not pick a new concentration spell while already concentrating."
3. The instruction file overstates AoE evaluation. Current evaluator logic does not calculate net damage with ally subtraction. It estimates enemy hits only. Ally-avoidance happens later in delivery target resolution.
4. The instruction file should explicitly say that `prepareSpellCast()` owns slot validation and concentration-state mutation. Right now that responsibility is implied across multiple bullets instead of stated cleanly.
5. The instruction file is directionally correct that `AiSpellDelivery` is full mechanical delivery, but the line about `deterministic-ai.ts` calling `pickSpell()` undersells the real runtime path: decision selection and mechanical resolution are now separated across `pickSpell()` -> `CastSpellHandler` -> `AiSpellDelivery`.
6. The nearest `packages/game-server/src/application/services/combat/ai/CLAUDE.md` file is not wrong, but it is too generic to warn readers that AI spell choice is heuristic while spell execution is mechanical. That omission can send readers to the wrong place when debugging this flow.

## Recommended Doc Edits
- Instruction doc replacement for the Purpose section:

  Deterministic AI spellcasting has two separate parts:
  1. selection heuristics in `ai-spell-evaluator.ts` and `ai-bonus-action-picker.ts`
  2. execution in `CastSpellHandler` and `AiSpellDelivery`

  The selector is heuristic, not a full rules engine. It ranks healing, debuff, buff, cantrip, and damage options using lightweight combat context. The execution path performs slot spending, concentration updates, and mechanical spell resolution.

- Instruction doc replacement for the `deterministic-ai.ts` row:

  Thin AI turn orchestrator. Previews bonus actions, enforces the 2024 bonus-action-spell/cantrip restriction, delegates spell choice to `pickSpell()`, and returns the final AI decision.

- Instruction doc replacement for the `ai-spell-evaluator.ts` row:

  Heuristic spell selector: parses spell data, checks slot availability, ranks healing/buff/debuff/damage options, applies damage-type multipliers, and estimates AoE upside from enemy coverage. It does not perform full mechanical resolution, deep concentration tradeoff scoring, or full friendly-fire net-damage math.

- Instruction doc replacement for the `cast-spell-handler.ts` row:

  AI spell-cast executor: resolves spell metadata, initiates Counterspell reactions, calls `prepareSpellCast()` for slot spending and concentration replacement, then delegates mechanical resolution to `AiSpellDelivery`.

- Instruction doc replacement for the `ai-spell-delivery.ts` row:

  Mechanical AI spell resolution: spell attacks, healing, save-based damage, condition/effect application, and zone creation. For AoE spells, it chooses a center that prefers enemy coverage and penalizes ally hits before applying effects.

- Instruction doc replacement for the concentration gotcha bullet:

  Concentration replacement is not currently scored as a tradeoff. If the AI is already concentrating, `pickSpell()` filters out new concentration spells entirely. The actual concentration-state replacement is handled later by `prepareSpellCast()`.

- Instruction doc replacement for the AoE gotcha bullet:

  AoE evaluation is split. `ai-spell-evaluator.ts` estimates upside mostly from enemy hit count. Friendly-fire reduction is applied later in `AiSpellDelivery.resolveTargets()`, which penalizes ally hits when choosing the AoE center.

- Instruction doc addition for slot handling:

  Slot validation and concentration-state mutation are owned by `prepareSpellCast()` in `helpers/spell-slot-manager.ts`. That helper supports standard slot pools, Pact Magic fallback, and the legacy `spellSlots` object format.

- CLAUDE doc addition only if you want one extra warning line:

  Spell pick use simple brain. Spell cast do real rules work.

- Mermaid note:

  Mermaid would help only a little here. A small call-path diagram could clarify `DeterministicAiDecisionMaker -> pickSpell/pickBonusAction -> CastSpellHandler -> prepareSpellCast + AiSpellDelivery`, but it is not materially necessary if the instruction doc clearly separates selection from execution in plain English.