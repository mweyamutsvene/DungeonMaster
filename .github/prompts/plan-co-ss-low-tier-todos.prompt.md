# Plan: CO/SS Low-Tier TODO Follow-ups

## Status: FOUNDATION LAID — awaiting future implementation

These TODOs were created during the CO-L2→L8 + SS-L4/L5/L7 batch. Each has types/stubs in place but needs integration work.

## CO-L3: Ability Check Pending Action
- **File**: `domain/entities/combat/pending-action.ts`
- **TODO**: Integrate `ability_check` type with grapple/shove contested roll flow
- **What exists**: `PendingAbilityCheckData` interface, `"ability_check"` in `PendingActionType` union
- **Next step**: Use it in `GrappleActionHandler` / `GrappleHandlers` to represent contested ability checks

## CO-L4: Silvery Barbs Full Reaction Flow
- **File**: `domain/entities/classes/wizard.ts`
- **TODO**: Full reaction flow — reroll resolution mechanics, advantage grant to ally
- **What exists**: `SILVERY_BARBS` spell in catalog, `SILVERY_BARBS_REACTION` AttackReactionDef in wizard profile with detection logic
- **Next step**: Add SpellReactionHandler support in TwoPhaseActionService, implement reroll + advantage grant

## CO-L5: Interception Fighting Style
- **File**: `domain/entities/classes/fighter.ts`
- **TODO**: Wire into TwoPhaseActionService AttackReactionHandler, implement damage reduction (1d10 + PB)
- **What exists**: `INTERCEPTION_REACTION` stub (returns null), `"interception"` in FightingStyleId, `FEAT_INTERCEPTION` constant
- **Next step**: Implement `detect()` logic (scan allies in 5ft), create reaction resolution handler

## CO-L6: Protection Fighting Style
- **File**: `domain/entities/classes/fighter.ts`
- **TODO**: Wire into TwoPhaseActionService AttackReactionHandler, implement disadvantage imposition
- **What exists**: `PROTECTION_REACTION` stub (returns null), `"protection"` reaction type in pending-action.ts
- **Next step**: Implement `detect()` logic (scan allies in 5ft with shield), create reaction resolution handler

## CO-L7: Dual Pending Action Unification
- **File**: `domain/entities/combat/pending-action.ts`
- **TODO**: Consider unifying encounter-level `pendingAction` field and `PendingActionRepository` into single state machine
- **What exists**: Architecture documentation explaining both systems
- **Next step**: Design unified state machine (medium-complexity refactor)

## SS-L5: SpellCastingContext `sheet` Field
- **File**: `spell-delivery/spell-delivery-handler.ts`
- **TODO**: Create proper `CharacterSheet` interface to replace `sheet: any`
- **What exists**: 5 of 6 fields typed; `sheet` kept as `any` because delivery handlers depend on nested JSON shape
- **Next step**: Define `CharacterSheet` interface with all properties used by delivery handlers

## SS-L7: Ritual Casting Mode
- **File**: `domain/entities/spells/catalog/types.ts`
- **TODO**: Wire `SpellCastingMode` into SpellActionHandler castInfo and prepareSpellCast
- **What exists**: `SpellCastingMode = 'normal' | 'ritual'` type, `DETECT_MAGIC` with `ritual: true`
- **Next step**: Add mode parameter to `prepareSpellCast()`, skip slot spending when mode is `'ritual'`
