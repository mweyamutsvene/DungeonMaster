---
flow: CombatOrchestration
author: claude-explore-combat-orchestration
status: DRAFT
created: 2026-04-24
---

# CombatOrchestration Audit: D&D 5e 2024 L1-5

## Scope

Audit covers encounter lifecycle, turn progression, intent parsing, action dispatch, and roll state machine for tabletop combat at levels 1-5. Focus: completeness, robustness of intent parsing, action handler coverage, and victory/defeat detection.

---

## Currently Supported

### Encounter Lifecycle
- **Start** (startEncounter, addCombatantsToEncounter): Creates encounter, maps, combatants with position + speed defaults. Faction-based friendly/hostile placement.
- **Turn Progression** (nextTurn, endTurn): Advance turn index, skip defeated non-characters, trigger turn boundary effects.
- **Victory/Defeat** (BasicCombatVictoryPolicy): Faction-based win/loss, character death saves count as alive/dying, fled creatures ignored.
- **End Combat** (endCombat): Manual stop with reason (dm_end, flee, surrender).
- **Death Saves** (makeDeathSavingThrow, auto-roll at turn start): d20 vs DC 10, track 3 successes/failures, revival on crit, auto-stabilize at 3 successes.

### Turn Boundary Effects (6-Phase Sequence)
1. End-of-Turn: Condition expiry, ActiveEffect cleanup, zone damage triggers.
2. Turn Order Advance: Increment turn, skip dead monsters.
3. Incoming Effects: Rage end check, legendary action charge reset, action economy persist.
4. Start-of-Turn: Condition expiry, StunningStrikePartial removal, ActiveEffect processing.
5. Turn Advanced Event: Emitted.
6. Death Save Auto-Roll: If actor at 0 HP and eligible.

### Intent Parsing (CombatTextParser)
Stateless utility functions (no repo dependencies):

**Movement**: tryParseMoveText (coords), tryParseMoveTowardText (creature + range), tryParseJumpText (long/high + direction + distance), tryParseSimpleActionText (dash/dodge/disengage/ready).

**Actions**: tryParseAttackText (target + weapon), tryParseCompoundMoveAttack (move + attack), tryParseCastSpellText (spell + target + upcast), tryParseOffhandAttackText, tryParseReadyText, tryParseLegendaryAction.

**Items**: tryParsePickupText, tryParseDropText, tryParseDrawWeaponText, tryParseSheatheWeaponText, tryParseUseItemText (NEW: rejects give/administer), tryParseGiveItemText (NEW), tryParseAdministerItemText (NEW).

**Social**: tryParseHelpText, tryParseShoveText, tryParseGrappleText, tryParseEscapeGrappleText.

**Utilities**: deriveRollModeFromConditions (adv/disadv + distance-aware Prone), findCombatantByName (fuzzy match), getActorNameFromRoster.

### Action Dispatch (ActionDispatcher)
Routes text to handlers (GrappleHandlers, AttackHandlers, MovementHandlers, InteractionHandlers, SocialHandlers, ClassAbilityHandlers).

1. Incapacitation Block: Stunned/Paralyzed/Unconscious/Petrified blocked (only end turn allowed).
2. Parser Chain: Movement -> Simple Actions -> Attacks -> Spells -> Items -> Class Abilities -> Grapple -> Shove -> Help -> Ready -> End Turn.
3. Handler Execution: Each returns ActionParseResult with pending action.

### Action Handlers
- **Attack**: Target resolution (nearest, named), distance + cover AC bonus, weapon spec enrichment, attack enhancement matching (Sneak Attack, Flurry), Cunning Strike parsing.
- **Movement**: Move-to-coords, move-toward-creature (pathfinding), jump (long/high, distance calc), zone damage en route, pit detection, aura sync.
- **Grapple**: Initiate contest, escape.
- **Shove**: Push vs save, prone vs save, 5ft push on success.
- **Spell**: Spell catalog lookup, spell scaling, spell effect riders, concentration.
- **Interaction**: Use item (Bonus/Action per item), pick up, drop, draw, sheathe, give, administer (NEW).
- **Class Abilities**: Regex match per class (Barbarian Rage, Monk Flurry, Rogue Cunning Strike, etc.).

### Roll State Machine (RollStateMachine)
State transitions:
- INITIATIVE: Parse initiative roll, compute adv/disadv, resolve surprise, start combat.
- ATTACK: Resolve attack roll vs AC (with cover/elevation), determine hit/miss, trigger on-hit enhancements, move to DAMAGE if hit.
- DAMAGE: Roll damage, apply crit doubling, resolve hit-rider enhancements (saves, conditions, push), update HP, check victory, end turn.
- DEATH_SAVE: d20 auto-roll, track successes/failures, stabilize/revive/kill.
- SAVING_THROW: Target rolls or auto-resolve (Stunning Strike, Hold Person), apply outcome.

### Combat Narration
- TabletopEventEmitter: LLM-based narrative for action start, roll resolution, damage, victory/defeat.
- PathNarrator: Multi-step movement narration with terrain.

### Victory/Defeat Detection
BasicCombatVictoryPolicy: Faction-based (party, enemy, neutral). Victory = all enemies dead/fled. Defeat = all allies dead/fled. Characters at 0 HP with <3 death save failures count as alive (dying).

---

## Needs Rework

### 1. Intent Parsing Robustness
Regex-based parsers brittle to natural language variance.

**Examples**: tryParseJumpText has 4 separate patterns, doesn't handle "jump 15 feet" (feet second). tryParseAttackText has hardcoded verb list, no plugin mechanism. tryParseMoveTowardText rejects "move to ranged position" if followed by parens (false negative). deriveRollModeFromConditions doesn't account for spells providing advantage (Bless +1d4). No LLM fallback for ambiguous parses.

**Impact**: L1-5 mostly avoids edge cases, but late-L5 flexibility (custom spells, homebrew) breaks.

### 2. Compound Intent Handling
tryParseCompoundMoveAttack only supports "move (X,Y) and attack [target] [with weapon]".

**Missing**: Move-toward + attack. Attack + move. Three-part (move + attack + disengage). Interleaved reactions.

**Workaround**: Requires separate text inputs per action.

### 3. Action Dispatch Parser Chain Ordering
Current: Movement -> Simple -> Attacks -> Spells -> Items -> Class -> Grapple -> Shove -> Help -> Ready -> End Turn.

**Risk**: "dash to Goblin" matches tryParseSimpleActionText ("dash") before tryParseMoveTowardText (false positive). Hardcoded rejection in tryParseSimpleActionText partially mitigates, but not comprehensive.

### 4. Surprise Round Logic
Surprised creatures have disadvantage on initiative rolls (implemented). **Gap**: No explicit "surprise round" state. Ambush mechanics (Stealth vs Passive) are pre-combat. Once combat starts, surprised creatures don't skip their first turn.

**Assumption**: L1-3 rarely ambush; L4-5 may need explicit surprise round.

### 5. Retreat/Flee Mechanics
hasFled() checks resources.fled === true, but nothing sets it. No command to flee/disengage or retreat. Victory ignores fled creatures, but turn advancement doesn't auto-skip them.

**Impact**: Flee needs dispatcher support (mark fled, skip future turns until re-engaged).

### 6. Combat Pause/Resume
No explicit pause state. encounter.status is Active/Victory/Defeat. Pausing requires external session state. Resuming assumes consistency (dangerous if resources drifted during pause).

### 7. Timeline / Initiative Swap
InitiativeSwapPendingAction type exists but never instantiated. Some classes (Sentinel, Lucky) want to move earlier reactively. No API to manually swap.

### 8. Multi-Attack Spell Handling
spellStrike / spellStrikeTotal for multi-attack spells (Eldritch Blast, Scorching Ray). Attack #1 via ATTACK -> DAMAGE -> ATTACK #2 (pending action re-created). Race condition if disconnect mid-sequence. No transactional recovery.

### 9. Reaction Opportunity Detection
TwoPhaseActionService detects OAs; TabletopCombatService allows player opt-in. **Gap**: Spell OAs (War Caster) auto-resolved, but other reaction spells (Counterspell, Feather Fall, Absorb Elements) unsupported. Rogue Reaction Cunning Action not exposed.

### 10. ActiveEffect Expiry Edge Cases
expiresAt targeting (e.g., expires when Paladin's turn ends) rarely used. save-to-end effects (Hold Person) resolved at turn boundaries, but if creature takes damage on another'
