# SME Research — ReactionSystem Docs Accuracy

## Scope
- Files read: `.github/instructions/reaction-system.instructions.md` (1-44), `packages/game-server/src/application/services/combat/two-phase/CLAUDE.md` (1-13), `packages/game-server/src/application/services/combat/two-phase-action-service.ts` (1-210), `packages/game-server/src/application/services/combat/two-phase/move-reaction-handler.ts` (1-520), `packages/game-server/src/application/services/combat/two-phase/attack-reaction-handler.ts` (1-560), `packages/game-server/src/application/services/combat/two-phase/spell-reaction-handler.ts` (1-379), `packages/game-server/src/application/services/combat/two-phase/damage-reaction-handler.ts` (1-291), `packages/game-server/src/domain/entities/combat/pending-action.ts` (1-280), `packages/game-server/src/application/services/combat/helpers/oa-detection.ts` (1-102), `packages/game-server/src/infrastructure/api/routes/reactions.ts` (1-500), `packages/game-server/src/application/services/combat/tabletop/pending-action-state-machine.ts` (1-55), plus adjacent pause/resume callers in `session-tabletop.ts`, `spell-action-handler.ts`, and `ai-attack-resolver.ts`.
- Task context: verify the ReactionSystem instruction docs against current source and note concrete wording drift.

## Current Truth
- `TwoPhaseActionService` is a thin facade with four private handlers: move, attack, spell, and damage.
- Reaction pending records live in `PendingActionRepository`. Their statuses are repository-driven: `awaiting_reactions`, `ready_to_complete`, `completed`, `cancelled`, `expired`.
- Encounter-level `pendingAction = reaction_pending` is real, but it is set by surrounding tabletop/AI/route orchestration, not by the handlers themselves.
- `MoveReactionHandler` does more than basic OA prompting: it reuses shared OA detection, supports War Caster spell OAs via `oaType: "spell"`, and also raises `readied_action` move triggers.
- `AttackReactionHandler` now covers more than Shield and Deflect Attacks. Current attack-side reactions include `shield`, `deflect_attacks`, `uncanny_dodge`, `cutting_words`, `sentinel_attack`, `protection`, and `interception`, and it can chain into a follow-up `damage_reaction`.
- `SpellReactionHandler` currently only resolves Counterspell, but the source uses the 2024 implementation already in code: the target caster makes a Constitution save against the counterspeller's spell save DC. The older "higher-slot ability check" model is not what this code does.
- `DamageReactionHandler` fires after damage is already applied and currently resolves `absorb_elements` and `hellish_rebuke`.
- Reaction routes do more than accept a response. They also expose single/list queries, auto-complete ready actions, mirror encounter `reaction_pending` state, and resume AI turns after reaction resolution.

## Drift Findings
1. The instruction file's purpose and matrix are too narrow. They name OA, Shield, Deflect Attacks, Counterspell, and post-damage reactions, but current source also supports Protection, Interception, Uncanny Dodge, Cutting Words, Sentinel reaction attacks, readied-action reactions, and War Caster spell OAs.
2. The instruction file's Counterspell wording is stale and inaccurate. It says "slot + ability check for higher levels"; current code instead spends a slot and resolves Counterspell with the target caster's Constitution save against the counterspeller's spell save DC.
3. The instruction file's `PendingActionStateMachine` description is misleading for this flow. The checked-in state machine under `tabletop/` validates tabletop roll-flow types like `ATTACK` and `DAMAGE`; it does not model the reaction repository lifecycle. Reaction lifecycle is derived by `PendingActionRepository.getStatus()` and completion/deletion calls.
4. The instruction file's route description is incomplete. The routes are not just `POST respond / GET pending reaction routes`; they also list all pending reactions and auto-complete move/attack/spell/damage reaction flows once all responses are in.
5. The instruction file's "two-phase flow pauses combat state" note is directionally correct but too absolute. The pause signal is produced by orchestration layers writing encounter `reaction_pending`; the handlers themselves only create repository-backed pending actions.
6. The scoped `CLAUDE.md` is mostly accurate but now underspecifies the flow. It omits the repository-status model, the encounter-level mirror owned by orchestration, and the broadened attack/move reaction surface.

## Recommended Doc Edits
### `.github/instructions/reaction-system.instructions.md`
Replace the `## Purpose` paragraph with:

"Manages the two-phase reaction pipeline: source code detects a reaction trigger, stores a repository-backed pending action, prompts the reacting player or AI, then resumes the interrupted move, attack, spell, or post-damage flow after responses are in. Current reaction coverage includes opportunity attacks, War Caster spell opportunity attacks, Shield, Deflect Attacks, Counterspell, Absorb Elements, Hellish Rebuke, Protection, Interception, Uncanny Dodge, Sentinel reaction attacks, and readied-action triggers."

Replace the `spell-reaction-handler.ts` matrix row text with:

"Counterspell reaction detection and resolution. Current code spends the reacting caster's slot and resolves Counterspell with the target caster's Constitution save against the counterspeller's spell save DC."

Replace the `pending-action-state-machine.ts` matrix row text with:

"Adjacent tabletop roll-flow state machine, not the primary reaction lifecycle authority. Reaction pending-action lifecycle is tracked by `PendingActionRepository` status (`awaiting_reactions` -> `ready_to_complete` -> `completed` / `cancelled` / `expired`)."

Replace the `reactions.ts` matrix row text with:

"HTTP reaction entry points: record responses, query one or all pending reactions, auto-complete ready reaction flows, mirror encounter `reaction_pending`, and resume AI turns after resolution."

Replace the `PendingActionStateMachine` bullet in `## Key Types/Interfaces` with:

"`PendingActionRepository` / `PendingActionStatus` — the reaction flow's lifecycle authority. Status is repository-derived, not validated by the tabletop roll state machine."

Replace the `The two-phase flow pauses combat state` bullet in `## Known Gotchas` with:

"The two-phase flow pauses combat through orchestration layers that mirror repository-backed reaction prompts into encounter `pendingAction = reaction_pending`. Do not assume the handler itself mutates encounter pending state."

Optional addition under `## Known Gotchas`:

"Move reactions are broader than leave-reach weapon OAs. The current flow also supports War Caster spell OAs and `readied_action` move triggers, so move-trigger logic should stay centralized in the shared helper plus the move handler."

### `packages/game-server/src/application/services/combat/two-phase/CLAUDE.md`
Add this caveman-style line under `## Laws`:

"8. Reaction status live in PendingActionRepository. Tabletop pending-action machine is different beast. Do not mix."

Optional caveman replacement for law 6 if you want it to match current source more closely:

"6. Use current code truth: Shield give retro +5 AC. Counterspell here use target CON save vs counterspeller DC. Damage reactions happen after damage land."

Optional caveman addition after law 7:

"9. Attack and move reactions bigger now: Protection, Interception, Uncanny Dodge, Cutting Words, Sentinel, readied action, War Caster OA. Keep trigger logic in reaction flow, not random caller."

### Mermaid
Yes, one small Mermaid sequence diagram would materially help this flow doc. The useful picture is not class structure; it is the pause/resume handshake between caller, `TwoPhaseActionService`, `PendingActionRepository`, encounter `pendingAction = reaction_pending`, reaction routes, and AI resume. Anything larger than that would be noise.