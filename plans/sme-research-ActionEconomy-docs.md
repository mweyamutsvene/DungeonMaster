# SME Research — ActionEconomy — Doc Accuracy Check

## Scope
- Files read: `.github/instructions/action-economy.instructions.md`; `packages/game-server/src/domain/rules/CLAUDE.md`; `packages/game-server/src/domain/entities/combat/action-economy.ts`; `packages/game-server/src/application/services/combat/helpers/resource-utils.ts`; `packages/game-server/src/application/services/combat/helpers/combat-hydration.ts`; `packages/game-server/src/domain/entities/creatures/legendary-actions.ts`
- Adjacent verification reads: `packages/game-server/src/domain/combat/combat.ts`; `packages/game-server/src/application/services/combat/combat-service.ts`; `packages/game-server/src/application/services/combat/tactical-view-service.ts`; `packages/game-server/src/application/services/combat/ai/legendary-action-handler.ts`; `packages/game-server/src/application/services/combat/abilities/executors/fighter/action-surge-executor.ts`; selected tests/grep call sites
- Task context: verify whether the ActionEconomy instruction doc and nearest shared CLAUDE guidance still match current code, then propose concise doc fixes.

## Current Truth
- The flow is split across three layers, not one object:
  - `action-economy.ts` defines a small domain `ActionEconomy` record plus immutable updaters and deprecated mutable spend helpers.
  - `combat.ts` still uses the deprecated mutable spend helpers directly, and resets only the new active creature to `freshActionEconomy()` on turn advance.
  - `combat-hydration.ts` is the bridge between domain economy and persisted `resources` JSON: `hydrateCombat()` parses persisted flags into domain state, and `extractActionEconomy()` serializes domain state back into `resources`.
- Persisted combat resources are broader than `ActionEconomy`. `resource-utils.ts` manages attack counters, reaction/bonus-action flags, disengage, movement flags, object interaction, positions, resource pools, inventory, active effects, and legendary action charges.
- The main turn reset path is `CombatService.nextTurn()` calling `combat.endTurn()` for domain reset, then `resetLegendaryActions()` for a legendary creature's own turn, then `extractActionEconomy()` to persist the refreshed domain state.
- `resetTurnResources()` exists, but current app code does not use it as the production turn-advance path.
- Persisted flag names are mixed today:
  - hydration reads/writes `bonusActionSpent` and `reactionSpent`
  - resource helpers mostly read/write `bonusActionUsed` and `reactionUsed`
  - tactical/AI views often bridge both formats explicitly
- `legendary-actions.ts` covers more than legendary action defs: it also models/parses lair actions and `isInLair`, but parsing still returns `undefined` unless `legendaryActions` exists.
- Action Surge is not tracked by a dedicated action-economy field. The fighter executor spends the `actionSurge` resource pool and uses `grantAdditionalAction()` to increase `attacksAllowedThisTurn` and clear `actionSpent`.

## Drift Findings
| Doc area | Drift | Verified truth | Why it matters |
|---|---|---|---|
| Instruction file, `combat-hydration.ts` responsibility | Says `extractActionEconomy()` is "from DB state" and implies hydration-only responsibility | `extractActionEconomy()` serializes domain economy back into persisted resources; parsing from DB state happens inside `hydrateCombat()` / private `parseActionEconomy()` | This is the clearest factual error in the doc |
| Instruction file, purpose text | Implies one flow object tracks action, bonus, reaction, movement, and free object interaction | Free object interaction is not part of `ActionEconomy`; it lives only in the `resources` blob | Current wording blurs the domain type vs persisted resource bag |
| Instruction file, immutable vs legacy guidance | Implies deprecated mutable helpers are only older leftovers | The owning `Combat` aggregate still calls `spendAction()` / `spendBonusAction()` / `spendReaction()` / `spendMovement()` directly | Readers could assume immutable helpers are the dominant runtime path when they are not |
| Instruction file, reset lifecycle | Mentions `resetTurnResources()` as the reset helper without clarifying actual production path | Turn start reset is currently orchestrated by `CombatService.nextTurn()` + `combat.endTurn()` + `extractActionEconomy()`; `resetTurnResources()` is a utility, not the main turn-advance call path | Important for anyone debugging turn resets |
| Instruction file, persisted flag model | Missing the current dual-key reality | Bonus/reaction state currently exists as both `...Spent` and `...Used`, with bridging in consumers such as `tactical-view-service.ts` | This is a real architecture constraint and source of confusion |
| Instruction file, free object interaction reset | Gotcha says it is tracked in resources blob, but omits where it resets | `resetTurnResources()` does not clear `objectInteractionUsed`; current fresh-turn clearing happens in `extractActionEconomy()` when the economy is fresh | Without this note, the doc points readers to the wrong reset function |
| Instruction file, Action Surge wording | Says Action Surge is tracked in the JSON resources blob via `resource-utils.ts` | More specifically: the pool lives in `resourcePools`, and the combat effect is applied through `grantAdditionalAction()` / `attacksAllowedThisTurn` plus `actionSpent: false` | The current text is directionally right but too vague to debug with |
| Instruction file, legendary-actions responsibility | Describes only legendary action definitions | The file also models/parses lair actions and `isInLair` | Small but real omission |
| `packages/game-server/src/domain/rules/CLAUDE.md` | No factual drift found | The rules-only laws remain accurate and generic | No CLAUDE edit is needed; ActionEconomy-specific nuance belongs in the instruction file, not this shared rules note |

## Recommended Doc Edits
### Instruction File
- Replace the `Purpose` paragraph with:

  `Tracks turn-scoped combat availability across two representations: a small domain ActionEconomy record (action, bonus action, reaction, movement, actions used) and a larger persisted resources blob (object interaction, attack counters, disengage, movement flags, spell-turn restrictions, legendary charges, and other per-turn counters). Turn refresh happens at the start of a creature's turn and is persisted between server requests through the combat hydration layer.`

- Replace the `combat/helpers/combat-hydration.ts` row with:

  ``| `combat/helpers/combat-hydration.ts` | ~200 | Hydrates `Combat` from persisted records, parses persisted action-economy flags into domain state, and serializes domain economy back into the `resources` blob via `extractActionEconomy()` |``

- Replace the `extractActionEconomy(...)` bullet with:

  ``- `extractActionEconomy(combat, creatureId, existingResources)` in `combat-hydration.ts` — serializes the current domain `ActionEconomy` back into persisted `resources`; hydration from DB state happens in `hydrateCombat()` / `parseActionEconomy()```

- Replace the legacy mutable API bullet with:

  ``- **Mutable runtime API still in active use** (`@deprecated`): `spendAction()` / `spendBonusAction()` / `spendReaction()` / `spendMovement()` mutate via cast and are still called by the `Combat` aggregate. Prefer the immutable helpers for new code, but do not assume the mutable path is unused.``

- Add this bullet immediately after the `resetTurnResources(...)` bullet:

  ``- **Actual turn-start persistence path**: production turn refresh currently flows through `CombatService.nextTurn()` -> `combat.endTurn()` -> `extractActionEconomy()` for all combatants, plus `resetLegendaryActions()` for the incoming legendary creature. `resetTurnResources()` is a utility helper, not the main turn-advance entry point.``

- Add this bullet immediately after the paragraph above:

  ``- **Persisted flag vocabulary is mixed today**: `actionSpent` is shared, but bonus/reaction state appears as both `bonusActionSpent` / `reactionSpent` and `bonusActionUsed` / `reactionUsed`. Hydration uses the `...Spent` keys, helper utilities mostly use the `...Used` keys, and some consumers bridge both for compatibility.``

- Replace the Action Surge gotcha with:

  `- **Action Surge grants more attack capacity through resources, not a new ActionEconomy field** — the feature spends the `actionSurge` resource pool and applies its combat effect by increasing `attacksAllowedThisTurn` and clearing `actionSpent` via `grantAdditionalAction()`.`

- Replace the free object interaction gotcha with:

  `- **Free object interaction lives only in the persisted resources blob** — it is tracked with `objectInteractionUsed`, not on `ActionEconomy`. In the current turn-refresh path it is cleared when `extractActionEconomy()` writes a fresh economy, not by `resetTurnResources()`.`

- Replace the `legendary-actions.ts` row with:

  ``| `domain/entities/creatures/legendary-actions.ts` | ~100 | Pure domain types/parser for legendary actions, lair actions, and `isInLair` metadata |``

### CLAUDE File
- No update recommended for `packages/game-server/src/domain/rules/CLAUDE.md`.
- Reason: it is still accurate as a shared rules-law file, and ActionEconomy-specific lifecycle/persistence details would be misplaced there.
- If you still want a caveman reminder despite that, add only this short line:

  `Action economy split. Small domain state. Big resources blob.`

### Mermaid
- No Mermaid recommendation.
- Reason: this flow's current confusion is mostly wording drift and mixed key names, not a large structural graph. A short lifecycle bullet and one explicit note about the domain/resources split should be enough.