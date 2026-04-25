# SME Research — SpellSystem Docs Accuracy

## Scope
- Docs compared:
  - `.github/instructions/spell-system.instructions.md`
  - `packages/game-server/src/domain/entities/spells/CLAUDE.md`
  - `packages/game-server/src/application/services/combat/tabletop/CLAUDE.md`
- Primary code verified:
  - `packages/game-server/src/application/services/combat/tabletop/spell-action-handler.ts`
  - `packages/game-server/src/application/services/combat/tabletop/spell-delivery/*`
  - `packages/game-server/src/application/services/combat/tabletop/rolls/saving-throw-resolver.ts`
  - `packages/game-server/src/application/services/combat/helpers/spell-slot-manager.ts`
  - `packages/game-server/src/application/services/combat/helpers/concentration-helper.ts`
  - `packages/game-server/src/application/services/entities/spell-lookup-service.ts`
  - `packages/game-server/src/domain/rules/concentration.ts`
- Adjacent confirmation reads:
  - `packages/game-server/src/domain/entities/spells/prepared-spell-definition.ts`
  - `packages/game-server/src/application/services/combat/ai/handlers/cast-spell-handler.ts`
  - `packages/game-server/src/application/services/combat/ai/handlers/ai-spell-delivery.ts`

## Current Truth
- Tabletop spell routing is no longer just 5 delivery handlers. `SpellActionHandler` now registers 6 handlers in priority order: `DispelMagicDeliveryHandler`, attack, healing, save, zone, buff/debuff, then falls back to auto-hit handling and finally a generic simple cast message.
- `SpellActionHandler` also owns more than slot spend + handler dispatch. It enforces verbal/material checks, 2024 two-spell restrictions, range checks, Counterspell pause via `twoPhaseActions.initiateSpellCast()`, and post-cast `onCastSideEffects` processing.
- `prepareSpellCast()` is shared across tabletop and AI, but AI no longer stops at bookkeeping. `CastSpellHandler` calls `AiSpellDelivery` to apply mechanical spell effects.
- Concentration rules are split deliberately: pure rules stay in `domain/rules/concentration.ts`, while encounter cleanup and DB writes live in `helpers/concentration-helper.ts`.
- `PreparedSpellDefinition` has grown beyond the docs: notable current fields include `area`, `range`, `ignoresCover`, `damageDiceSidesOnDamaged`, `onHitEffects`, `pushOnFailFeet`, `turnEndSave`, `multiAttack`, `autoHit`, `dartCount`, and `onCastSideEffects`.
- `SavingThrowResolver` is broader than the docs imply. It handles effect bonuses, advantage/disadvantage, exhaustion, cover bonuses on DEX saves, aura bonuses, forced movement outcomes, condition application/removal, and concentration breaking when conditions demand it.

## Drift Findings
1. `.github/instructions/spell-system.instructions.md` is stale on handler architecture.
   It says “5 delivery handlers + inline simple fallback.” Current code has 6 handlers because `DispelMagicDeliveryHandler` is a dedicated first-match special case.

2. `.github/instructions/spell-system.instructions.md` is stale on AI behavior.
   It says AI uses `prepareSpellCast()` for bookkeeping but does not use delivery handlers and does not apply spell mechanics. Current AI code applies mechanics through `AiSpellDelivery`.

3. `.github/instructions/spell-system.instructions.md` understates `SpellActionHandler` responsibilities.
   The doc frames it mostly as slot spend + dispatch. Current code also does component enforcement, bonus-action spell restriction enforcement, range validation, Counterspell reaction initiation, and `onCastSideEffects` finalization.

4. `.github/instructions/spell-system.instructions.md` is missing newer spell-shape contracts.
   The doc still centers older core fields and misses `multiAttack`, `autoHit`/`dartCount`, `turnEndSave`, `onHitEffects`, `range`, `ignoresCover`, and `onCastSideEffects`.

5. `packages/game-server/src/domain/entities/spells/CLAUDE.md` is misleading on concentration ownership.
   “Concentration logic lives in one place: domain/rules/concentration.ts” is not true for the runtime flow. Pure concentration rules live there, but cleanup/state mutation lives in `helpers/concentration-helper.ts`.

6. `packages/game-server/src/domain/entities/spells/CLAUDE.md` is slightly too absolute on handler shape.
   “One delivery handler owns one effect type” mostly matches the design, but current code has a spell-specific exception: `DispelMagicDeliveryHandler` routes by spell name.

7. `packages/game-server/src/domain/entities/spells/CLAUDE.md` is missing the current declarative side-effect path.
   `onCastSideEffects` is now part of `PreparedSpellDefinition` and is processed centrally after a successful cast.

8. `packages/game-server/src/application/services/combat/tabletop/CLAUDE.md` is misleading on spell-delivery location.
   It says spell-delivery handlers are “private to `spell-action-handler.ts`.” They are actually separate files under `tabletop/spell-delivery/`, exported through a barrel, and orchestrated by `SpellActionHandler`.

9. Mermaid would materially help the main SpellSystem instruction doc, but not the two CLAUDE quick-reference docs.
   The flow now has two important branches that are easy to misunderstand without a diagram: tabletop cast orchestration including Counterspell pause, and the separate AI mechanical delivery path.

## Recommended Doc Edits

### `.github/instructions/spell-system.instructions.md`

Replace the Purpose paragraph with:

"Spell casting pipeline for mechanical resolution after parsing has already identified a cast intent. Covers spell lookup, slot spending, concentration transitions, component and range validation, Counterspell pause points, delivery routing, saving-throw resolution, and post-cast side effects. Tabletop and AI share spell preparation helpers, but mechanical delivery is split between `SpellActionHandler` and `AiSpellDelivery`."

Replace the first Architecture paragraph with:

"`SpellActionHandler` is the tabletop spell orchestrator. It resolves the spell definition, validates upcasting, enforces current cast restrictions (components, range, bonus-action spell limits), opens Counterspell reaction windows, spends slots and swaps concentration through `prepareSpellCast()`, dispatches to the first matching delivery handler, then runs any `onCastSideEffects` after a successful completion."

Replace the handler list/table intro with:

"`SpellActionHandler` currently checks delivery handlers in this priority order: `DispelMagicDeliveryHandler`, `SpellAttackDeliveryHandler`, `HealingSpellDeliveryHandler`, `SaveSpellDeliveryHandler`, `ZoneSpellDeliveryHandler`, `BuffDebuffSpellDeliveryHandler`. If none match, it falls back to catalog-driven auto-hit handling such as Magic Missile, then to a generic simple cast completion. First match still wins."

Add this cross-flow note:

"AI spell casting no longer stops at resource bookkeeping. `CastSpellHandler` shares `prepareSpellCast()` with tabletop, then applies spell mechanics through `AiSpellDelivery`, which mirrors the major delivery categories without using the interactive tabletop pending-roll flow."

Add this contract note under `PreparedSpellDefinition`:

"Important modern fields used by the current pipeline include `area`, `range`, `ignoresCover`, `damageDiceSidesOnDamaged`, `onHitEffects`, `pushOnFailFeet`, `turnEndSave`, `multiAttack`, `autoHit`, `dartCount`, and `onCastSideEffects`. Docs or changes that omit these fields will under-describe current spell behavior."

Add this note near concentration/contracts:

"Concentration is intentionally split: `domain/rules/concentration.ts` holds pure rules such as DC calculation and break conditions, while `helpers/concentration-helper.ts` performs encounter-wide cleanup, active-effect removal, condition cleanup, and map-zone removal."

If the Mermaid diagram is kept, update it to show:

"Add `DispelMagicDeliveryHandler` as the first tabletop route, show the Counterspell pause before delivery, and add a side branch for AI: `CastSpellHandler -> prepareSpellCast -> AiSpellDelivery`. Without those three updates, the diagram materially misstates the current flow."

### `packages/game-server/src/domain/entities/spells/CLAUDE.md`

Replace Law 3 with caveman wording:

"Pure concentration rules live in `domain/rules/concentration.ts`. Cleanup and combat-state rewrite live in `helpers/concentration-helper.ts`."

Replace Law 5 with caveman wording:

"Most delivery handlers own one delivery mode. Named special case okay when one spell needs custom rules, like Dispel Magic."

Add this law:

"Post-cast side effects use `onCastSideEffects`. Weird item-creation stuff no sneak into random handler code."

### `packages/game-server/src/application/services/combat/tabletop/CLAUDE.md`

Replace Law 9 with caveman wording:

"Spell-delivery handlers live in `tabletop/spell-delivery/`. `SpellActionHandler` owns route order and picks first handler that matches."

Add this law if you want the quick doc to match current tabletop behavior better:

"Spell cast can pause before delivery for Counterspell. Spend/action timing must stay consistent across pause and resolve paths."