# SME Research — CombatOrchestration — NPC Class Support

## Scope
- Files read: `application/types.ts` (~110), `application/services/combat/helpers/creature-hydration.ts` (~427), `application/services/combat/helpers/combatant-resolver.ts` (~395), `domain/entities/creatures/npc.ts` (~30), `application/services/combat/tabletop-combat-service.ts` (~500+), `application/services/combat/tabletop/action-dispatcher.ts` (~630), `application/services/combat/tabletop/dispatch/class-ability-handlers.ts` (~925), `application/services/combat/tabletop/dispatch/attack-handlers.ts` (~1000+), `application/services/combat/tabletop/dispatch/social-handlers.ts` (~240), `application/services/combat/tabletop/dispatch/movement-handlers.ts` (~790), `application/services/combat/tabletop/roll-state-machine.ts` (~1500+), `application/services/combat/tabletop/rolls/initiative-handler.ts` (~670), `application/services/combat/tabletop/rolls/damage-resolver.ts` (~1000+), `application/services/combat/tabletop/rolls/hit-rider-resolver.ts` (~300+), `application/services/combat/combat-service.ts` (~1000+), `application/services/combat/ai/ai-context-builder.ts` (~640), `application/services/combat/ai/ai-action-executor.ts` (~360), `application/services/combat/ai/handlers/use-feature-handler.ts` (~190), `application/services/combat/ai/ai-turn-orchestrator.ts` (~1100+), `application/services/combat/helpers/faction-service.ts` (~180)
- Task context: Assess CombatOrchestration impact of allowing NPCs to enter combat as class-backed creatures using `className`, `level`, and `sheet`, instead of only stat-block-backed NPCs.

## Current State
`SessionNPCRecord` still only persists `statBlock`; the orchestration layer therefore treats NPCs as stat-block creatures by default, while Characters are the only combatants with first-class `sheet`, `className`, and `level` fields.

There is already one partial bridge: `InitiativeHandler` reads `statBlock.className` and `statBlock.level` for NPCs and feeds them into `buildCombatantResources()`. That means class-like NPCs can already receive class resource pools, prepared-spell flags, Alert/Feral-style initiative modifiers, and `attacksPerAction` if the class data is embedded in the NPC stat block.

Outside initiative, most tabletop execution paths fall back to Character-only lookups:
- `ClassAbilityHandlers.handleClassAbility()` rejects any non-Character actor immediately.
- `handleBonusAbility()`, offhand/Nick handling, attack dispatch, Sneak Attack/Cunning Strike tracking, hit-rider assembly, and several damage-side class bonuses re-read only `characters.find(id)` or `combatantType === "Character"` combatants.
- `CombatantResolver.getCombatStats()` returns `className` only for Characters. NPCs keep `level` and `proficiencyBonus`, but downstream resolver-based feature checks lose class identity.

Turn flow also remains Character-special:
- `CombatService.advanceTurnOrder()` only gives death-save treatment to records with `characterId`; defeated NPCs are skipped as dead non-characters.
- `AiTurnOrchestrator` likewise creates tabletop death-save pending actions only for Characters.

AI is mixed:
- `AiContextBuilder` already exposes `npc.statBlock.className`, `level`, and computed `classAbilities`.
- `UseFeatureHandler` can pass NPC `statBlock` into the `AbilityRegistry` as a pseudo-sheet.
- `AiActionExecutor.executeBonusAction()` and resolver-driven AI attack logic still assume Character-or-Monster more than Character-or-Monster-or-NPC, so NPC class mechanics would stay inconsistent even if tabletop parsing were fixed.

## Impact Analysis
| File | Change Required | Risk | Why |
|------|-----------------|------|-----|
| `application/types.ts` | Likely add NPC class/sheet fields or define a supported dual-shape contract | high | Current NPC record shape is the root mismatch; orchestration cannot reliably load class-backed NPC state without it |
| `helpers/creature-hydration.ts` | Split NPC hydration into stat-block vs class-backed paths | high | Current `hydrateNPC()` only reads `statBlock`; class-backed NPCs would lose AC, equipment, spells, and class traits if not rehydrated like Characters |
| `helpers/combatant-resolver.ts` | Return `className`, sheet-derived attacks, equipment, save proficiencies for class-backed NPCs | high | Many orchestration decisions depend on resolver output; NPCs currently lose class identity here |
| `tabletop/rolls/initiative-handler.ts` | Probably small refinement, not rewrite | low | This is the one place already prepared for class-like NPC metadata, but it assumes the data lives on `statBlock` |
| `tabletop/dispatch/class-ability-handlers.ts` | Remove Character-only actor/combatant lookups | high | Class action parsing can match NPC text today, but execution hard-fails before reaching the executor |
| `tabletop/dispatch/attack-handlers.ts` | Generalize actor sheet/class lookup beyond Characters | high | Extra Attack, Nick, unarmed scaling, Cunning Strike, and weapon resolution are Character-only today |
| `tabletop/roll-state-machine.ts` | Generalize Character-only sneak-attack/class lookups | medium | Attack-to-damage transition currently re-reads Character data for rogue mechanics and other class-dependent roll flow |
| `tabletop/rolls/damage-resolver.ts` and `tabletop/rolls/hit-rider-resolver.ts` | Generalize post-hit feature tracking | medium | Dark One's Blessing, Sneak Attack use, Withdraw, Divine-Smite-style enhancements, and profile-based riders assume Character records |
| `combat-service.ts` and `ai-turn-orchestrator.ts` | Decide whether class-backed NPCs still die like NPCs or get Character-like death-save turns | high | This is the main turn-flow contract risk; current logic ties death saves to combatant type, not to class-backed capability |
| `ai/ai-action-executor.ts` and `ai/handlers/use-feature-handler.ts` | Fix NPC bonus-action targeting and executor params | medium | AI can partially see NPC class info, but action execution still drops NPC-specific class context in several places |

## Constraints & Invariants
- `TabletopCombatService` must stay thin; the real work belongs in dispatcher, roll-state, hydration, and resolver layers.
- `CombatTextParser` stays pure. NPC class support should not be implemented by baking repo lookups into parsing.
- Pending-action flow must remain valid: initiative -> attack/save/damage/death-save pending -> resolved. Supporting NPC class mechanics cannot introduce a parallel pending-action shape unless it is wired exhaustively.
- Faction and turn-order rules cannot keep using `actor.type !== "Character"` shortcuts if class-backed NPCs are meant to behave like party-side class combatants.
- Any fix that only patches tabletop parsing but leaves AI/combatant resolution unchanged will produce divergent behavior between manual and AI-controlled NPC turns.

## Options & Tradeoffs
| Option | Pros | Cons | Recommendation |
|--------|------|------|---------------|
| A: Keep NPCs stat-block-backed, but allow class fields inside `statBlock` and generalize orchestration to read them | Smaller persistence change; initiative path already points this way | Keeps NPCs on a second-class schema; repeated `sheet` vs `statBlock` branching will keep spreading | △ Viable short-term, but not clean |
| B: Introduce a unified “class-backed combatant” adapter for Character + NPC, then route tabletop/AI through it | Fixes the root orchestration issue; reduces repeated Character-only branches; keeps facade thin | Requires coordinated hydration/resolver rewrite | ✓ Preferred |
| C: Reclassify class-backed NPCs as Characters in combat | Simplifies class mechanics and death-save flow | Blurs entity-management boundaries; likely wrong for persistence/API semantics | ✗ Avoid unless the product wants NPCs to become Characters outright |

## Risks
1. Parser/executor mismatch: class-action text can already match NPC input, but current execution throws for non-Characters. If upstream NPC schema changes land first, users will hit new runtime failures immediately.
2. Partial mechanic drift: initiative already grants class resources to NPCs from `statBlock.className/level`, while attack and bonus-action flows still ignore the same NPC class data. That creates half-enabled NPC turns.
3. Turn-flow contract ambiguity: if class-backed NPCs remain `combatantType === "NPC"`, they still skip turns at 0 HP and never enter death-save flow. If that is not desired, turn advancement and AI turn gating must change explicitly.
4. Faction shortcuts: several nearest-hostile helpers treat “non-Character” as one side, lumping NPCs with Monsters. Class-backed allied NPCs will target or path incorrectly unless those shortcuts move to faction-aware checks.
5. AI inconsistency: AI context can advertise NPC class abilities that downstream resolver/executor code cannot actually honor, especially for bonus actions and resolver-based on-hit features.

## Recommendations
1. Treat this as a hydration/resolver-first change, not a parser-first change. CombatOrchestration already has enough generic routing; it lacks a unified source of class-backed NPC combat data.
2. Introduce one combatant adapter abstraction for “class-backed actor” and use it in `ClassAbilityHandlers`, `AttackHandlers`, `RollStateMachine`, and damage/hit-rider resolution instead of repeated `characters.find(...)` branches.
3. Decide the turn-flow rule up front: do class-backed NPCs still use NPC KO rules, or should they inherit Character death-save behavior? That answer changes both `CombatService` and AI turn orchestration.
4. Replace hardcoded Character-vs-non-Character hostility shortcuts with faction-aware checks where NPC party allies are involved.
5. Validate both manual tabletop flow and AI-controlled NPC turns together; otherwise the repo will support class-backed NPCs in one orchestration path and silently fail in the other.