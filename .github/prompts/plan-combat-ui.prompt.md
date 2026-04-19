# Plan: CRPG Combat Mode + UI Client

## Status: DRAFT
## Affected Flows: CombatOrchestration, CombatRules, CombatMap, ClassAbilities, SpellSystem, ReactionSystem, ActionEconomy, AIBehavior
## Priority: Future milestone — depends on exploration client foundation (plan-exploration-ui.prompt.md phases 1-6)
## Prerequisite: Exploration plan phases 1-6 complete (Phaser + ECS + movement + sprites)

---

## Objective

Build a combat mode UI that transitions from the exploration mode into BG2/ToEE-style turn-based tactical combat on a revealed grid. The existing `packages/game-server` combat engine is the sole authority for all combat mechanics — the client is a thin visual layer that renders state and sends user input. All dice rolls, damage, conditions, reactions, and turn order are server-determined.

---

## Design Decisions

### Combat Style
- **Turn-based** (not real-time-with-pause like BG2 — closer to Temple of Elemental Evil / Solasta)
- **Grid revealed on combat start** — exploration hides the grid, combat shows it
- **Initiative-ordered turn list** with visible portraits
- **Movement highlighting** — reachable cells shown in blue, attack range in red, AoE templates in orange
- **Two-phase tabletop flow** — same as existing server API (initiate → roll → resolve)
- **Reaction interrupts** — Shield, Opportunity Attacks, Counterspell pause the turn for player decision

### Client Responsibility
- **Render**: grid, combatants, movement range, attack range, AoE templates, health bars, status icons, turn order, combat log
- **Input**: click to move, click target to attack, ability bar, spell selection, end turn
- **Local calculations** (display only, NOT authoritative): movement range preview, path preview, AoE template preview, line of sight preview
- **Server is truth**: all rolls, damage, hit/miss, conditions, reactions, turn order, combat end

### Server Communication
- **HTTP**: POST actions (move, attack, cast spell, use ability, end turn)
- **SSE**: combat state changes, turn start, roll requests, reaction prompts, damage events, death events, combat end
- The existing Fastify API stays unchanged — the client consumes the same endpoints the CLI uses

---

## Architecture

### Combat Manager (Client)

```typescript
class CombatManager {
  // State mirrored from server
  encounter: EncounterState;
  combatants: CombatantState[];
  turnOrder: InitiativeEntry[];
  currentTurn: string;            // combatant ID
  pendingAction: PendingAction | null;
  combatLog: CombatLogEntry[];

  // Client-only display state
  selectedAbility: AbilitySlot | null;
  selectedSpell: PreparedSpell | null;
  hoveredCell: GridCell | null;
  targetingMode: TargetingMode | null;
  previewPath: GridCell[] | null;
  previewAoE: GridCell[] | null;
  reachableCells: GridCell[];

  // Lifecycle
  enterCombat(encounterId: string): void;
  exitCombat(): void;
  onTurnStart(combatantId: string): void;
  onRollRequest(request: RollRequest): void;
  onReactionPrompt(prompt: ReactionPrompt): void;
  onCombatEnd(result: CombatResult): void;
}
```

### Targeting Modes

```typescript
type TargetingMode =
  | { type: 'move' }                                    // click cell to move
  | { type: 'melee_attack'; weapon: WeaponSpec }        // click adjacent enemy
  | { type: 'ranged_attack'; weapon: WeaponSpec; range: number; longRange: number }
  | { type: 'spell_single'; spell: SpellDef; range: number }     // click single target
  | { type: 'spell_aoe'; spell: SpellDef; shape: AoEShape }      // place AoE template
  | { type: 'spell_self'; spell: SpellDef }                       // no target needed
  | { type: 'spell_cone'; spell: SpellDef; size: number }         // cone direction
  | { type: 'grapple' }                                  // click adjacent creature
  | { type: 'shove' }                                    // click adjacent creature
  | { type: 'help' }                                     // click adjacent ally
  | { type: 'class_ability'; ability: AbilityDef }       // varies by ability
```

---

## ECS Components (Combat-Specific)

### Reuse from Exploration
- `PositionComponent` — grid + visual position
- `SpriteComponent` — animation state
- `CreatureStatsComponent` — ability scores, AC, HP, proficiency

### New Combat Components

```typescript
interface CombatantComponent {
  combatantId: string;           // server-assigned ID
  encounterId: string;
  initiative: number;
  faction: 'player' | 'enemy' | 'neutral';
  isCurrentTurn: boolean;

  // Action economy (mirror of server state)
  hasAction: boolean;
  hasBonusAction: boolean;
  hasReaction: boolean;
  movementRemaining: number;     // in feet

  // HP
  currentHp: number;
  maxHp: number;
  tempHp: number;

  // Conditions
  conditions: ActiveCondition[];

  // Concentration
  concentratingOn: string | null; // spell name

  // Death saves
  deathSaves: { successes: number; failures: number } | null;
}

interface ActiveCondition {
  id: string;
  name: string;
  duration: number | null;       // rounds remaining, null = indefinite
  source: string;                // who applied it
}

interface CombatGridComponent {
  width: number;
  height: number;
  cells: CellState[][];
}

interface CellState {
  terrain: TerrainType;
  isReachable: boolean;          // current combatant can move here
  isInRange: boolean;            // current ability can reach here
  isAoE: boolean;                // currently in AoE preview template
  isOccupied: boolean;
  occupiedBy: string | null;
  coverLevel: 'none' | 'half' | 'three-quarters' | 'full';
  isHazard: boolean;
  hazardType: string | null;
  elevation: number;
}

interface AbilityBarComponent {
  slots: AbilitySlot[];
}

interface AbilitySlot {
  id: string;
  name: string;
  icon: string;
  type: 'action' | 'bonus_action' | 'reaction' | 'free';
  available: boolean;            // has economy + resources
  resourceCurrent: number | null;
  resourceMax: number | null;
  keyBind: string;               // '1', '2', etc.
  tooltip: string;
}

interface SpellBarComponent {
  preparedSpells: PreparedSpellSlot[];
  spellSlots: { level: number; total: number; used: number }[];
  cantrips: PreparedSpellSlot[];
}
```

---

## ECS Systems (Combat-Specific)

```
Combat Frame Loop (60fps):

 1. CombatInputSystem            ← mouse/keyboard → combat intents
 2. TargetingSystem              ← manages targeting mode, validates targets
 3. MovementPreviewSystem        ← highlights reachable cells (shared getReachableCells)
 4. AttackRangePreviewSystem     ← highlights cells in weapon/spell range
 5. AoEPreviewSystem             ← shows AoE template on cursor position
 6. PathPreviewSystem            ← shows movement path + OA warning markers
 7. CoverPreviewSystem           ← shows cover indicators relative to selected enemy
 8. LineOfSightSystem            ← dims cells out of sight (shared sight raycasting)
 9. CombatAnimationSystem        ← attack anims, spell effects, damage numbers, death
10. HealthBarSystem              ← floating HP bars above combatants
11. ConditionIconSystem          ← status effect icons (poisoned, stunned, concentrating)
12. TurnOrderSystem              ← portrait initiative tracker
13. CombatLogSystem              ← scrolling combat text (BG2-style)
14. ActionEconomySystem          ← updates ability/spell bar availability
15. CombatRenderSystem           ← grid overlay, highlights, range indicators
16. CombatUISystem               ← action bar, spell bar, end turn button, tooltips
17. CombatNetworkSystem          ← sends actions, receives SSE events, syncs state
```

---

## Combat Flow (Client ↔ Server)

### 1. Combat Entry (Exploration → Combat)

```
Exploration Mode:
  → Ambush trigger / hostile NPC detected / player attacks
  → Client: POST /sessions/:id/combat/start { combatants, terrain }
  → Server: creates encounter, returns encounterId
  → Client: switches to CombatScene
    - Grid overlay fades in over exploration tilemap
    - Camera zooms to tactical level
    - Combatants snap to grid positions
    - Initiative bar appears
  → Server: SSE → roll_request { type: 'initiative' } for each player character
  → Client: shows initiative roll UI for each PC
  → Player rolls → POST /sessions/:id/combat/roll-result { combatantId, roll }
  → Server: resolves initiative, SSE → turn_start { combatantId }
```

### 2. Player Turn

```
SSE: turn_start { combatantId: 'player-1' }
  → Client: highlights active combatant, shows action economy (● Action ● Bonus ◐ Move 30ft ● Reaction)
  → Client: populates ability bar based on class + level + remaining resources
  → Client: highlights reachable cells (blue) via shared getReachableCells()

Player clicks cell to move:
  → Client: path preview (green line with blue endpoint)
  → Client: OA warning icons on path if leaving enemy reach (shared OA detection)
  → Player confirms (click again or Enter)
  → POST /sessions/:id/combat/action { type: 'move', path: [...] }
  → Server: validates, may trigger reactions (OA)
    → If OA: SSE → reaction_prompt { type: 'opportunity_attack', attacker, target }
       → Client: pauses, shows OA animation, roll UI
       → Server resolves OA, SSE → attack_resolved { ... }
    → SSE → move_complete { combatantId, newPosition, movementRemaining }
  → Client: smooth entity lerp to new position, update movement remaining

Player clicks ability (e.g., "Attack"):
  → Client: enters targeting mode { type: 'melee_attack', weapon }
  → Client: highlights valid targets in range (red cells under enemies)
  → Player clicks enemy
  → POST /sessions/:id/combat/initiate { combatantId, action: 'attack', targetId, weapon }
  → Server: SSE → roll_request { type: 'attack', ... }
  → Client: shows d20 roll UI with attack bonus
  → Player enters roll (or clicks "Roll" for server-generated)
  → POST /sessions/:id/combat/roll-result { roll: 15 }
  → Server: resolves hit/miss
    → Hit → SSE → roll_request { type: 'damage', dice: '1d8+3' }
    → Client: shows damage dice UI
    → Player rolls → POST roll-result { roll: 7 }
    → Server: applies damage
      → May trigger reactions (Shield, Deflect Attacks)
      → SSE → damage_applied { targetId, damage, newHp, conditions }
      → If Extra Attack available: SSE → roll_request { type: 'attack', message: 'Extra Attack' }
    → Miss → SSE → attack_resolved { result: 'miss' }

Player clicks "End Turn":
  → POST /sessions/:id/combat/action { type: 'endTurn' }
  → Server: advances initiative → SSE → turn_start { combatantId: next }
```

### 3. AI Turn (Enemy)

```
SSE: turn_start { combatantId: 'goblin-1', isNPC: true }
  → Client: camera pans to active enemy
  → Server: AI decides + executes actions (existing AIBehavior flow)
  → Server streams SSE events for each action:
    → SSE: combatant_move { combatantId, path }
       → Client: smooth move animation
    → SSE: attack_initiated { attackerId, targetId, weapon }
       → Client: attack animation + roll display
    → SSE: attack_resolved { hit: true, damage: 7, damageType: 'slashing' }
       → Client: damage number floats up, HP bar updates
       → May trigger player reactions:
         → SSE: reaction_prompt { type: 'shield', targetPlayerId, ... }
         → Client: "Cast Shield?" popup → player decides
         → POST /encounters/:eid/reactions/:pid/respond { use: true }
    → SSE: turn_end { combatantId: 'goblin-1' }
  → Next turn begins
```

### 4. Spell Casting

```
Player clicks spell from spell bar:
  → Client: validates spell slot available (display only)
  → Client: enters targeting mode based on spell.targetType:
    - 'single': highlight targets in range
    - 'self': no target needed
    - 'point': show AoE template on cursor (circle, cone, line, cube)
    - 'cone': show cone direction from caster
  → Player selects target/point
  → POST /sessions/:id/combat/initiate { action: 'castSpell', spellName, targetId/point, slotLevel }
  → Server handles via SpellActionHandler → appropriate delivery handler
  → SSE responses vary by spell type:

  Attack Roll Spell (Fire Bolt):
    → SSE: roll_request { type: 'attack', spellName: 'Fire Bolt' }
    → d20 roll → hit/miss → damage roll → damage applied

  Save-Based Spell (Fireball):
    → SSE: spell_cast { spellName, aoeArea: [...cells], saveType: 'dexterity', saveDC: 15 }
    → Client: AoE highlight + each target rolls (server auto-rolls for NPCs)
    → SSE: saving_throw_results { results: [{ combatantId, roll, success, damage }] }
    → Client: per-target damage numbers

  Buff/Debuff Spell (Bless, Shield of Faith):
    → SSE: spell_cast { spellName, targets: [...], effects: [...] }
    → Client: spell effect animation + condition icons

  Concentration Spell:
    → SSE: concentration_start { casterId, spellName }
    → Client: concentration icon on caster portrait
    → On caster takes damage: SSE: roll_request { type: 'concentration_save', dc }
    → Client: shows concentration save
    → On fail: SSE: concentration_broken { casterId, spellName, zoneRemoved }

  Healing Spell (Cure Wounds):
    → SSE: spell_cast { spellName, targetId }
    → SSE: roll_request { type: 'healing', dice: '1d8+3' }
    → Roll → SSE: healing_applied { targetId, amount, newHp }
    → Client: green floating number
```

### 5. Reactions

```
Opportunity Attack (during movement):
  → Server detects OA trigger during move resolution
  → SSE: reaction_prompt { type: 'opportunity_attack', reactorId, targetId }
  → If reactor is player:
    → Client: "Take Opportunity Attack against {target}?" popup
    → Player decides → POST /encounters/:eid/reactions/:pid/respond { use: true, roll: 18 }
  → If reactor is NPC:
    → Server auto-decides, SSE: attack_initiated → attack_resolved
  → SSE: reaction_resolved → movement continues

Shield (when player is attacked):
  → Server detects Shield eligible (wizard/sorcerer, has reaction, has spell slot)
  → SSE: reaction_prompt { type: 'shield', targetId, incomingAttack: { total: 17 }, currentAC: 15 }
  → Client: "Cast Shield? (AC would become 20)" popup
  → Player decides → POST respond { use: true }
  → SSE: shield_cast { newAC: 20, hitNowMiss: true }

Counterspell:
  → Enemy casts spell → server detects Counterspell eligible in range
  → SSE: reaction_prompt { type: 'counterspell', casterId, spellName, spellLevel }
  → Client: "Counterspell {spell}?" popup
  → POST respond { use: true, slotLevel: 3 }
  → If slot < spell level: SSE: roll_request { type: 'ability_check', ability: 'spellcasting', dc: 10 + spellLevel }
  → Result → SSE: counterspell_resolved { success: true/false }

Deflect Attacks (Monk):
  → Monk hit by attack → server detects Deflect Attacks eligible
  → SSE: damage_reaction_prompt { type: 'deflect_attacks', targetId, incomingDamage, reductionDice: '1d10+5' }
  → Client: "Use Deflect Attacks?" popup
  → POST respond { use: true }
  → SSE: deflect_resolved { damageReduced, damageRemaining, deflectedBack: boolean }
```

### 6. Combat Exit

```
All enemies defeated / party flees / encounter scripted end:
  → SSE: combat_end { result: 'victory' | 'defeat' | 'flee', xpAwarded, loot }
  → Client:
    - Victory screen with XP + loot summary
    - Grid overlay fades out
    - Camera zooms back to exploration level
    - Conditions/HP persist into exploration mode
    - Switch back to ExplorationScene
```

---

## UI Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  [Portrait] [Portrait] [Portrait] [Portrait]    [Initiative]   │  ← Party + turn tracker (top)
│                                                   ┌─────────┐  │
│                                                   │ Goblin 1│  │
│                                                   │ ROGUE  1│  │
│                                                   │ Goblin 2│  │
│                                                   │►FIGHTER │  │  ← ► = current turn
│                                                   │ WIZARD  │  │
│                                                   └─────────┘  │
│                                                                 │
│                        COMBAT MAP                               │
│                     (grid + combatants)                          │
│                                                                 │
│                                                                 │
│                                                                 │
├──────────────────────┬──────────────────────────────────────────┤
│  ┌─────────────────┐ │  [⚔️Attack] [🛡️Dodge] [💨Dash] [🤝Help]  │  ← Action bar
│  │                 │ │  [🔥Ability1] [⚡Ability2] [🗡️Offhand]   │  ← Class abilities
│  │  COMBAT LOG     │ │  [📖Spell1] [📖Spell2] [📖Spell3] ...    │  ← Spell bar
│  │  (scrolling)    │ │                                          │
│  │                 │ │  ● Action  ● Bonus  ◐ Move 15ft  ● React │  ← Economy tracker
│  │                 │ │                          [End Turn]       │
│  └─────────────────┘ │                                          │
└──────────────────────┴──────────────────────────────────────────┘
```

### Portrait Panels
- Character portrait + HP bar + condition icons
- Click portrait to select character (for abilities that target allies)
- Greyed out when not that character's turn
- Death skull overlay when unconscious
- Glow border when concentrating on a spell

### Initiative Tracker (Right Side)
- Vertical list of all combatants in initiative order
- Current turn highlighted with arrow `►`
- Shows name, faction color (green=ally, red=enemy, yellow=neutral)
- Preview of next 2-3 turns

### Action Bar
- **Row 1**: Standard actions (Attack, Dodge, Dash, Help, Hide, Search, Disengage)
- **Row 2**: Class abilities (Action Surge, Flurry of Blows, Cunning Action, etc.)
- **Row 3**: Prepared spells (click to enter spell targeting mode)
- Greyed out when no action economy remaining
- Resource counters on ability icons (Ki: 3/4, Action Surge: 1/1)
- Keyboard shortcuts: 1-9 for row 1, Shift+1-9 for row 2, spell bar has separate keybinds

### Combat Log
- BG2-style scrolling text log
- Color-coded: white=info, red=damage, green=healing, yellow=conditions, blue=movement
- Shows full detail: "Aldric attacks Goblin 1 with Longsword: 18 vs AC 15 — HIT for 9 slashing damage"
- Click entry to scroll to relevant combatant
- Expandable to full screen

### Action Economy Display
- Filled circle = available, half circle = partially used (movement), empty = spent
- Visual countdown of movement remaining in feet
- Updates in real-time as actions are taken

### End Turn Button
- Always visible when it's player's turn
- Hotkey: Space or Enter
- Confirm dialog if unused action/bonus action/movement remain: "End turn with unused actions?"

---

## Visual Effects

### Grid Overlay
- Appears on combat start with a fade-in animation
- Light grid lines (semi-transparent white) over exploration tilemap
- Cell highlights:
  - **Blue**: reachable cells (movement range)
  - **Light blue**: dash range (if Dash action available)
  - **Red**: enemy cells in attack range
  - **Orange**: AoE template preview
  - **Green**: movement path preview
  - **Yellow**: OA warning (leaving enemy reach)
  - **Grey**: out of range / blocked terrain
  - **Purple**: zone effect active (Darkness, Web, etc.)

### Damage Numbers
- Float up from damaged combatant
- Red for damage, green for healing, white for temp HP
- Critical hits: larger font + "CRITICAL!" text
- Miss: "MISS" in grey
- Font: pixel art style matching the aesthetic

### Attack Animations
- Melee: attacker bounces toward target, weapon swing overlay
- Ranged: projectile sprite travels arc from attacker to target
- Spell: spell-specific particle effect (fire, ice, lightning, radiance)
- Death: combatant sprite fades to transparent + death icon

### Status Effect Visuals
- Poisoned: green tint on sprite
- Stunned: stars circling overhead
- Prone: sprite rotated / lying-down frame
- Concentrating: golden aura around caster
- Grappled: chain link between grappler and target
- Frightened: exclamation mark + flee indicators showing source direction

### Reaction Popups
- Modal overlay that pauses the visual flow
- Shows: "Cast Shield? Your AC would become 20 (currently 15). Attack roll: 17"
- Two buttons: "Cast Shield" (with spell slot cost) / "No"
- Timer bar (optional) for multiplayer scenarios — auto-decline after X seconds
- Highlight the attacker and defender during popup

---

## Movement Preview System

### Reachable Cells Display
- On turn start: compute `getReachableCells()` using shared pathfinding
- Account for: difficult terrain (half speed), grapple (speed 0), conditions (prone = halved)
- Display as blue-tinted cells

### Path Preview (on hover)
- Mouse hovers over reachable cell → show green path from combatant
- Show cell count + feet remaining after move
- If path passes through enemy reach → yellow "⚠️" on exit cells
- If path enters hazard → orange "☠️" on hazard cells

### AoE Template Preview
- Spell targeting mode: AoE shape follows cursor
- Circle: highlight all cells within radius of cursor position
- Cone: rotates based on cursor angle from caster
- Line: extends from caster through cursor position
- Cube: anchored at cursor position
- Count of affected enemies/allies shown

### Cover Indicators
- When hovering an attack target: show cover level between attacker and target
- Half cover: ◑ icon, +2 AC noted
- Three-quarters cover: ◕ icon, +5 AC noted
- Full cover: ● icon, "NO LINE OF SIGHT"

---

## Server Sync Protocol

### Client → Server (HTTP)

| Action | Endpoint | Payload |
|--------|----------|---------|
| Move | `POST /sessions/:id/combat/action` | `{ type: 'move', path: Position[] }` |
| Attack | `POST /sessions/:id/combat/initiate` | `{ combatantId, action: 'attack', targetId, weapon }` |
| Cast Spell | `POST /sessions/:id/combat/initiate` | `{ combatantId, action: 'castSpell', spellName, targetId/point, slotLevel }` |
| Use Ability | `POST /sessions/:id/combat/action` | `{ type: 'classAbility', abilityId }` |
| End Turn | `POST /sessions/:id/combat/action` | `{ type: 'endTurn' }` |
| Roll Result | `POST /sessions/:id/combat/roll-result` | `{ combatantId, roll }` |
| Reaction | `POST /encounters/:eid/reactions/:pid/respond` | `{ use: boolean, ... }` |

### Server → Client (SSE)

| Event | Data | Client Response |
|-------|------|-----------------|
| `turn_start` | combatantId, isNPC | Highlight active, populate abilities |
| `roll_request` | type, dice, bonus, dc | Show roll UI |
| `attack_resolved` | hit/miss, damage, damageType | Animation + HP update |
| `damage_applied` | targetId, amount, newHp, conditions | Damage number + bar update |
| `healing_applied` | targetId, amount, newHp | Green number + bar update |
| `move_complete` | combatantId, position, moveRemaining | Smooth lerp + economy update |
| `reaction_prompt` | type, details | Popup decision UI |
| `reaction_resolved` | result | Resume combat flow |
| `spell_cast` | spellName, effects, area | Spell VFX |
| `concentration_start` | casterId, spellName | Icon on portrait |
| `concentration_broken` | casterId, reason | Icon removal + VFX |
| `condition_applied` | targetId, condition, duration | Status icon + sprite tint |
| `condition_removed` | targetId, condition | Remove icon + tint |
| `combatant_death` | combatantId | Death animation |
| `combat_end` | result, xp, loot | Victory/defeat screen |

---

## Build Phases

| Phase | What | Server Dependency | Deliverable |
|-------|------|-------------------|-------------|
| C1 | Combat scene shell + grid overlay render | None (mock data) | Grid renders over exploration tilemap |
| C2 | Initiative tracker + turn order display | GET /combat/:eid/combatants | Portrait bar + initiative list |
| C3 | Movement: reachable cells + click-to-move + path preview | POST action (move) + SSE move_complete | Character moves on grid with range highlight |
| C4 | Attack: targeting mode + attack animation + damage numbers | POST initiate + SSE roll_request + roll-result flow | Full attack-roll-damage cycle |
| C5 | Action bar + ability buttons + economy tracker | GET tactical view (action economy) | Clickable ability bar with economy display |
| C6 | **Reactions: OA warning + Shield/Deflect popups** | SSE reaction_prompt + POST respond | Reaction interrupts work end-to-end |
| C7 | **Spell targeting: single + AoE templates** | POST initiate (castSpell) | Spell targeting with AoE preview |
| C8 | **AI enemy turns: camera follow + action animations** | SSE events during AI turn | Watch enemies move/attack smoothly |
| C9 | **Combat log (scrolling text)** | All SSE events | BG2-style combat log |
| C10 | **Conditions: icons + sprite effects** | SSE condition_applied/removed | Visual status effects |
| C11 | **Concentration: icon + save prompts** | SSE concentration events | Concentration tracking |
| C12 | **Cover + line of sight preview** | Shared cover/sight functions | Cover indicators on hover |
| C13 | **Combat entry/exit transitions** | POST combat/start, SSE combat_end | Smooth explore ↔ combat transitions |
| C14 | **Class abilities: Action Surge, Flurry, etc.** | POST action (classAbility) | Class ability bar integration |
| C15 | **Death saves + unconscious state** | SSE death_save events | Death save UI + prone sprite |
| C16 | **Grapple/Shove targeting** | POST action (grapple/shove) | Grapple UI + contested check display |
| C17 | Art pass: sprite attack anims, spell VFX, UI polish | — | Replace placeholders with pixel art |

**Vertical slice = Phases C1-C4**: Grid appears, initiative rolls, character moves and attacks one enemy. Proves the core combat loop.

---

## Class Ability UI Mapping

| Class | Abilities on Action Bar | Special UI |
|-------|------------------------|------------|
| Fighter | Action Surge, Second Wind | Extra action economy indicator when surged |
| Monk | Flurry of Blows, Patient Defense, Step of the Wind, Stunning Strike | Ki counter on portrait |
| Rogue | Cunning Action (Dash/Disengage/Hide as bonus) | Sneak Attack auto-highlight eligible targets |
| Wizard | Spell slots + Arcane Recovery | Spell slot tracker in spell bar |
| Barbarian | Rage, Reckless Attack | Rage glow on sprite, advantage indicators |
| Paladin | Lay on Hands, Divine Smite | Smite prompt on hit (before damage roll) |
| Cleric | Turn Undead, Channel Divinity | AoE targeting for Turn Undead |
| Warlock | Eldritch Blast beams, Pact Magic | Pact slot tracker (separate from regular slots) |

---

## Key Shared Code (from packages/shared/)

These are extracted in the Exploration plan (phases 1) and reused here:

| Module | Combat Usage |
|--------|-------------|
| `pathfinding.ts` | `getReachableCells()` for movement preview, `findPath()` for path display |
| `combat-map-types.ts` | Grid types, terrain, MapEntity |
| `movement.ts` | `calculateDistance()` for range checks |
| `ability-checks.ts` | Contested grapple/shove check display |
| `dice-roller.ts` | Local preview dice (display only — server rolls are truth) |

---

## Risks

| Risk | Mitigation |
|------|------------|
| SSE event ordering causes visual desync | Sequence numbers on SSE events; client queues + replays in order |
| Reaction popup timing feels janky | Client pre-caches reaction eligibility; popup appears instantly when SSE arrives |
| AoE template preview disagrees with server resolution | Use same shared code; if disagreement, server wins (re-render on result) |
| AI turn animations too slow/fast | Configurable animation speed; option to "skip enemy animations" |
| 60fps grid rendering performance on large maps | Only render visible cells; frustum culling; cache cell highlight state |
| Multiple simultaneous reactions (Counterspell + Shield) | Queue reactions, process one at a time (server already handles this) |
| Initiative tie-breaking display confusion | Server resolves ties; client displays in server-determined order |

---

## Deferred (Not in This Plan)

- [ ] Multiplayer turn timers (for co-op PvE)
- [ ] Spell effect zone rendering (Darkness, Web, Fog Cloud — persistent visual zones)
- [ ] Environmental interaction in combat (kick table, push barrel)
- [ ] Flanking variant rule visualization
- [ ] Lair actions / legendary actions UI
- [ ] Loot distribution UI after combat
- [ ] Combat replay (record + playback)
- [ ] Accessibility: screen reader combat log, keyboard-only combat, colorblind grid mode
- [ ] Mobile/touch input adaptation
