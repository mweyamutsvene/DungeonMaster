# SME Research — CombatOrchestration Audit vs D&D 5e 2024 Rules

## 1. Turn Structure

**Implemented:**
- Turn advancement via `CombatService.nextTurn()` ([combat-service.ts](packages/game-server/src/application/services/combat/combat-service.ts#L457))
- **End-of-turn**: condition expiry, ActiveEffect processing (ongoing damage, save-to-end, buff expiry), zone triggers ([combat-service.ts](packages/game-server/src/application/services/combat/combat-service.ts#L480-L498))
- **Start-of-turn**: condition expiry (`start_of_turn`), ActiveEffect processing, zone triggers, Rage end check, death save detection ([combat-service.ts](packages/game-server/src/application/services/combat/combat-service.ts#L546-L620))
- Action economy reset per turn via `extractActionEconomy()` ([combat-hydration.ts](packages/game-server/src/application/services/combat/helpers/combat-hydration.ts#L104)) — resets `actionSpent`, `bonusActionUsed`, `reactionUsed`, `movementRemaining`, `dashed`, `disengaged`, `attacksUsedThisTurn`

**Missing:**
- No formal phase enforcement (Movement → Action → Bonus Action). Phases are softly tracked via boolean flags, not a strict FSM. Player can interleave freely. **Severity: Nice-to-have** (D&D 5e 2024 allows interleaving movement/actions)
- Readied actions are not cleared at start of the readier's next turn. Only cleared on actual execution. **Severity: Important** — D&D 5e says readied actions expire at start of your next turn if not triggered
- `objectInteractionUsed` flag exists but free object interaction limit isn't enforced during turns. **Severity: Nice-to-have**

## 2. Action Types via ActionDispatcher

**Implemented (19 parser chain entries):**
1. **Move** — A* pathfinding, terrain speed modifiers, prone stand-up cost
2. **Move Toward** — move to within range of creature
3. **Jump** — long/high jump with Athletics check
4. **Dash** — doubles speed via `dashed` flag, properly tracked
5. **Dodge** — grants `ActiveEffect` disadvantage on attacks + advantage on DEX saves
6. **Disengage** — sets `disengaged` flag, prevents OA
7. **Ready** — stores trigger + response type, detected during movement
8. **Class Abilities** — profile-driven via `ClassCombatTextProfile` registry
9. **Hide** — Stealth check, Cunning Action bonus-action support
10. **Search** — Perception check to reveal hidden creatures
11. **Off-hand Attack** — TWF validation, Nick mastery bonus-action bypass
12. **Help** — grants advantage via target reference
13. **Shove** — attack roll vs save, push or prone
14. **Grapple** — attack roll vs save, applies Grappled condition
15. **Escape Grapple** — Athletics/Acrobatics vs DC
16. **Cast Spell** — full spell delivery subsystem (5 handlers)
17. **Pickup/Drop/Draw/Sheathe** — item interaction
18. **Use Item** — general item use
19. **Attack** — full attack resolution with Extra Attack, weapon mastery, etc.

**Missing D&D 5e 2024 standard actions:**
- **Use Magic Item** — No separate parser; partially covered by `useItem` but no attunement/charge tracking. **Severity: Nice-to-have**
- **Influence** — D&D 5e 2024 social action (Persuasion/Deception/Intimidation). Not combat-relevant. **Severity: Nice-to-have**
- **Study** — D&D 5e 2024 knowledge action. Not combat-relevant. **Severity: Nice-to-have**

All core combat actions (Attack, Cast Spell, Dash, Disengage, Dodge, Help, Hide, Search, Ready, Grapple, Shove) are implemented.

## 3. Reaction System

**Implemented:**
- **Opportunity Attacks** — detected during two-phase movement via `MoveReactionHandler` ([move-reaction-handler.ts](packages/game-server/src/application/services/combat/two-phase/move-reaction-handler.ts)). Path-cell–based detection. Resolved via `opportunity-attack-resolver.ts`.
- **Shield** — detected via `AttackReactionHandler.initiate()` using `detectAttackReactions()` from combat-text-profile. Creates pending action for player decision. ([attack-reaction-handler.ts](packages/game-server/src/application/services/combat/two-phase/attack-reaction-handler.ts))
- **Deflect Attacks** (Monk) — detected same path as Shield via combat-text-profile. Reduces damage after hit.
- **Counterspell** — detected via `SpellReactionHandler.initiate()` using `detectSpellReactions()`. Checks proximity, spell slots. ([spell-reaction-handler.ts](packages/game-server/src/application/services/combat/two-phase/spell-reaction-handler.ts))
- **Readied Action — Attack trigger** — stored on Ready action, detected during movement when creature enters reach. Fires as `readied_action` reaction type.
- **Damage Reactions** — `AttackReactionHandler` + `DamageReactionInitiator` interface for post-damage reactions (e.g., Absorb Elements detected via `detectDamageReactions`).

**Missing:**
- **Readied Action — Spell trigger** only currently fires on `creature_moves_within_range` + `attack` response. Ready action with `cast_spell` response is not executed (stores `responseType` but execution only handles attack). **Severity: Important**
- **Readied Action — non-movement triggers** (e.g., "when the enemy opens the door", "when the wizard casts a spell"). Only `creature_moves_within_range` trigger type is detected. **Severity: Important**
- **Readied action expiry** — stored but never cleared at start of readier's next turn. **Severity: Important**
- **Sentinel feat** — opportunity attack stopping movement not implemented (feat system exists but Sentinel not wired). **Severity: Nice-to-have** (feat-specific)
- **War Caster opportunity attack with spell** not implemented. **Severity: Nice-to-have**

## 4. Pending Action State Machine

**Implemented:** ([pending-action-state-machine.ts](packages/game-server/src/application/services/combat/tabletop/pending-action-state-machine.ts))
- States: `null`, `INITIATIVE`, `INITIATIVE_SWAP`, `ATTACK`, `DAMAGE`, `DEATH_SAVE`, `SAVING_THROW`
- Transitions:
  - `null → INITIATIVE | ATTACK | DEATH_SAVE | SAVING_THROW`
  - `INITIATIVE → null | INITIATIVE_SWAP`
  - `INITIATIVE_SWAP → null`
  - `ATTACK → null | DAMAGE | ATTACK` (Flurry second strike)
  - `DAMAGE → null | ATTACK | SAVING_THROW` (hit-rider saves)
  - `DEATH_SAVE → null`
  - `SAVING_THROW → null | SAVING_THROW` (chained saves)
- `assertValidTransition()` is non-blocking (warns, doesn't throw) — observability aid.

**Assessment:**
- No dead-end states identified. All paths eventually resolve to `null`.
- Coverage is thorough — initiative, attacks, damage, death saves, saving throws, Alert feat swap all have proper transitions.
- **Missing:** No `READY` or `HELD_ACTION` pending state for the readied action trigger execution. Readied actions use the separate `PendingAction` system in the two-phase flow, not the tabletop pending action state machine. This is architecturally correct (two different pending action systems for two different concerns). **Severity: N/A — acceptable design**

## 5. Multi-Attack

**Implemented:**
- **Extra Attack** — tracked via `attacksUsedThisTurn` counter and `attacksAllowedThisTurn` (computed by `ClassFeatureResolver.getAttacksPerAction()`). Supports Fighter Extra Attack (2 at L5, 3 at L11, 4 at L20). ([roll-state-machine.ts](packages/game-server/src/application/services/combat/tabletop/roll-state-machine.ts))
- **Monster Multiattack** — monster attacks spec includes multiple attacks, executed sequentially through the attack pending action chain.
- **Action Surge** — grants additional full action. Implemented via `ActionSurgeExecutor` in ability registry. Resets `actionSpent` + `attacksUsedThisTurn`.
- **Flurry of Blows** — two bonus-action unarmed strikes, tracked via `flurryStrike` (1 or 2) on `AttackPendingAction`/`DamagePendingAction`.
- **Two-Weapon Fighting** — off-hand attack as bonus action with TWF Light property validation. Nick mastery bypasses bonus action cost.

**Missing:**
- Monster multiattack as a single "Multiattack" action parsing — monsters must declare individual attacks. The AI handles this in its turn loop. **Severity: Nice-to-have** (functional for AI, slightly awkward for manual play)

## 6. Movement During Turn

**Implemented:**
- **Split movement** — `movementRemaining` tracks remaining feet, `movementSpent` only true when `movementRemaining <= 0`. Multiple move commands in one turn are supported — the system uses `movementRemaining` to allow partial moves. ([move-reaction-handler.ts](packages/game-server/src/application/services/combat/two-phase/move-reaction-handler.ts#L84-L91))
- **Dash doubling** — `dashed` flag doubles effective speed.
- **Prone stand-up** — costs half movement speed.
- **Grappled/Incapacitated block** — can't move while grappled/stunned/paralyzed/unconscious/incapacitated (checked on prone stand-up).
- **Terrain speed modifiers** — difficult terrain doubles movement cost via A* pathfinding.
- **Speed modifier from conditions** — `speedModifier` resource (0.5 = halved).
- **Aura zone sync** — aura zones move with casters after movement.

**Missing:**
- **Difficult terrain through grapple drag** — moving while grappling another creature costs double movement. Not explicitly implemented. **Severity: Important**
- **Crawling** — moving while prone costs 1 extra foot per foot but system auto-removes Prone on stand-up. No crawl option. **Severity: Nice-to-have**
- **Climbing/Swimming** — no special movement modes. **Severity: Nice-to-have**

## 7. Combat Start/End

**Implemented:**
- **Initiative rolling** — `InitiativeHandler` in [initiative-handler.ts](packages/game-server/src/application/services/combat/tabletop/rolls/initiative-handler.ts). Supports DEX modifier, proficiency from feats, advantage/disadvantage.
- **Surprise** — `SurpriseSpec` type: `"enemies"` | `"party"` | `{ surprised: string[] }`. Surprised creatures get disadvantage on initiative (D&D 5e 2024 model). Computed via `computeSurprise()` + passive Perception. ([tabletop-combat-service.ts](packages/game-server/src/application/services/combat/tabletop-combat-service.ts#L27))
- **Alert feat** — skip disadvantage for surprised Alert holders + initiative swap offer post-roll.
- **Feral Instinct** (Barbarian) — advantage on initiative.
- **Resource pool initialization** — Ki, Action Surge, Second Wind, spell slots, rage initialized at combat start via `InitiativeHandler`.
- **Combat end (Victory)** — `BasicCombatVictoryPolicy` checks faction-based: all enemies dead = Victory, all party dead = Defeat. Characters making death saves count as alive. ([combat-victory-policy.ts](packages/game-server/src/application/services/combat/combat-victory-policy.ts))
- **Victory check** — evaluated before turn advancement AND after death save results.
- **CombatStarted/CombatEnded events** emitted.

**Missing:**
- **Flee/Surrender** — no explicit flee or surrender mechanic. Combat only ends on all-dead. **Severity: Important** — common D&D resolution
- **XP/Loot** — no post-combat XP award or loot distribution. **Severity: Nice-to-have** (out of combat scope)
- **Concentration check on death** — when a concentrating creature reaches 0 HP, concentration should auto-break. Likely handled but needs verification. **Severity: Important**

## 8. AI Turn Orchestration

**Implemented:** ([ai-turn-orchestrator.ts](packages/game-server/src/application/services/combat/ai/ai-turn-orchestrator.ts))
- Full turn loop: LLM decides → server executes → LLM sees results → repeat (max 5 iterations).
- Movement + Action + Bonus Action all supported.
- **Stunned/Incapacitated/Paralyzed skip** — AI correctly skips turns for incapacitated combatants.
- **Death save handling** — characters set up DEATH_SAVE pending action and pause AI loop for player input.
- **Stabilized skip** — stabilized-but-unconscious characters skip turns.
- **Fallback simple turn** — if no LLM, executes basic movement + attack.
- **Battle plan integration** — faction-wide tactics via `BattlePlanService`.
- **Deferred bonus action** — if attack paused by reaction (OA/Shield), bonus action deferred and executed after reaction resolves.
- **Reaction decision** — AI can decide on shield/counterspell/deflect reactions via `aiDecideReaction()`.
- **Consecutive failure safety** — ends turn after 2 consecutive action failures.

**Missing:**
- Nothing significant. AI orchestration is comprehensive. **Severity: N/A**

## 9. Dodge Action

**Implemented:** ([action-service.ts](packages/game-server/src/application/services/combat/action-service.ts#L214-L238))
- Spends action (or bonus action for Monk Patient Defense).
- Creates two `ActiveEffect`s:
  1. `disadvantage` on `attack_rolls` targeting the dodger (`until_start_of_next_turn`)
  2. `advantage` on `saving_throws` for `dexterity` (`until_start_of_next_turn`)
- Effects are processed by attack resolution and saving throw resolver.

**Assessment:** Correctly implemented per D&D 5e 2024. **Severity: N/A**

## 10. Dash Action

**Implemented:** ([action-service.ts](packages/game-server/src/application/services/combat/action-service.ts#L240))
- Sets `dashed: true` flag on resources.
- Movement handler checks `dashed` flag and doubles effective speed.
- Works as both action and bonus action (Rogue Cunning Action, Monk Step of the Wind).

**Assessment:** Correctly implemented. **Severity: N/A**

## 11. Disengage Action

**Implemented:** ([action-service.ts](packages/game-server/src/application/services/combat/action-service.ts#L244))
- Sets `disengaged: true` flag via `markDisengaged()`.
- `MoveReactionHandler.initiate()` checks `disengaged` flag when evaluating opportunity attacks via `canMakeOpportunityAttack()`.
- Works as bonus action for Rogue/Monk.

**Assessment:** Correctly implemented. **Severity: N/A**

## 12. Ready Action

**Implemented:** ([social-handlers.ts](packages/game-server/src/application/services/combat/tabletop/dispatch/social-handlers.ts#L66-L113))
- Spends action, stores `readiedAction` object in resources with `responseType`, `triggerType`, `triggerDescription`.
- Text parser `tryParseReadyText()` extracts trigger/response.
- Trigger detection: `creature_moves_within_range` detected in `MoveReactionHandler.initiate()` — when an enemy moves INTO reach of the readier.
- Execution: readied action fires as a reaction opportunity (uses reaction), resolved via `opportunity-attack-resolver.ts` which clears the `readiedAction` resource.

**Missing:**
- **Only attack response type is executed.** Spell readying (holding concentration) not implemented. **Severity: Important**
- **Only `creature_moves_within_range` trigger type detected.** Other triggers (e.g., creature casts spell, creature opens door) not supported. **Severity: Important**
- **Readied action expiry** — should be cleared at start of readier's next turn. Currently never expires unless triggered. The `extractActionEconomy()` resets many flags on new turn but does NOT clear `readiedAction`. **Severity: Important**
- **Concentration for readied spells** — D&D 5e 2024 says readying a spell requires concentrating on it until the trigger. Not implemented. **Severity: Important** (if spell readying is added)

## 13. Help Action

**Implemented:** ([social-handlers.ts](packages/game-server/src/application/services/combat/tabletop/dispatch/social-handlers.ts#L121-L142), [skill-action-handler.ts](packages/game-server/src/application/services/combat/action-handlers/skill-action-handler.ts))
- Spends action, targets an ally.
- Delegates to `ActionService.help()` which marks the action.

**Needs verification:** Whether the advantage-on-next-attack ActiveEffect is actually created and consumed. The action is recorded but the effect application may need deeper dive into `skill-action-handler.ts`. **Severity: Important** (if not actually granting advantage)

## 14. Two-Phase Flow

**Implemented:**
- **Movement reactions** — `MoveReactionHandler` creates `PendingAction` with `ReactionOpportunity[]`, emits `ReactionPrompt` SSE event, waits for response. `completeMove()` resolves OAs and applies movement. Zone damage during path. Booming Blade voluntary move triggers.
- **Attack reactions** — `AttackReactionHandler` detects Shield/Deflect Attacks via `detectAttackReactions()`, creates pending action for player response. `completeAttack()` applies Shield AC bonus or Deflect damage reduction. Also supports **damage reactions** (Absorb Elements) after damage is applied.
- **Spell reactions** — `SpellReactionHandler` detects Counterspell via `detectSpellReactions()`, checks proximity (60ft), spell slot availability.
- **Full flow**: `initiate() → pending action + event → player responds → complete()`.

**Assessment:** Two-phase flow is solid and comprehensive. Handles the three main reaction categories. **Severity: N/A**

## 15. Victory/Defeat

**Implemented:** ([combat-victory-policy.ts](packages/game-server/src/application/services/combat/combat-victory-policy.ts))
- Faction-based: `party` vs `enemy`/`hostile`.
- **Victory**: all enemies at 0 HP (dead).
- **Defeat**: all party members at 0 HP (not dying — characters making death saves count as "alive").
- **Post-death-save recheck**: if a character dies from a failed death save, victory is re-evaluated.
- Events: `CombatEnded` with result payload.

**Missing:**
- **Flee/Surrender/Morale** — no way to end combat except total elimination. **Severity: Important**
- **XP calculation** — no post-combat XP. **Severity: Nice-to-have**
- **Loot/treasure** — no post-combat loot. **Severity: Nice-to-have**
- **Neutral faction handling** — neutrals are ignored in victory check (neither party nor enemy). **Severity: Nice-to-have**

---

## Priority Summary

### Critical (None Found)
The core combat loop is complete and functional. No critical gaps that break gameplay.

### Important (Action Required)
| Gap | Area | Details |
|-----|------|---------|
| Readied action expiry | §3, §12 | Readied actions never expire at start of readier's next turn |
| Ready: spell response | §3, §12 | Only attack response executes; spell readying not implemented |
| Ready: limited triggers | §3, §12 | Only `creature_moves_within_range` — no custom/spell triggers |
| Flee/Surrender | §7, §15 | Combat only ends on total elimination — no flee/surrender mechanic |
| Grapple drag cost | §6 | Moving while grappling doesn't cost double movement |
| Help advantage verification | §13 | Need to verify Help action actually creates consumable advantage effect |
| Concentration on drop to 0 HP | §7 | Verify concentration auto-breaks at 0 HP |

### Nice-to-have (Low Priority)
| Gap | Area |
|-----|------|
| Crawling while prone | §6 |
| Climbing/Swimming movement | §6 |
| Monster "Multiattack" single-command | §5 |
| Sentinel feat (OA stops movement) | §3 |
| War Caster OA with spell | §3 |
| Use Magic Item with charges/attunement | §2 |
| Influence/Study actions | §2 |
| XP/Loot post-combat | §15 |
| Neutral faction in victory | §15 |
| Free object interaction limit enforcement | §1 |
