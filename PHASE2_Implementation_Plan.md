# Phase 2: Rules Engine Game Server

**Goal**: Build a proper D&D 5e game server where the server handles all rules and mechanics. The LLM only translates between natural language and structured game commands.

**Tech Stack**: TypeScript, Fastify, Prisma (SQLite), domain-driven design with OOP

**Package**: `@dungeonmaster/game-server` (new, separate from old server)

## Naming Conventions (Current Repo)

This repo standardizes on:

- **Files/folders**: `kebab-case` (e.g. `ability-scores.ts`, `dice-roller.ts`)
- **Exports/imports**: NodeNext ESM with explicit `.js` extensions in TypeScript source (e.g. `"./ability-scores.js"`)
- **Classes/types**: `PascalCase` (e.g. `AbilityScores`, `SeededDiceRoller`)
- **Domain organization**: grouped by concern under `src/domain/`:
  - `entities/` contains OOP types (split into subfolders like `core/`, `creatures/`, `actions/`, `items/`, `effects/`)
  - `rules/` contains deterministic rule helpers (e.g. dice)
  - `combat/` contains encounter/initiative/resolution orchestration

---

## Architecture Philosophy

### Server Responsibilities
- ✅ All D&D 5e rules and mechanics
- ✅ Game state management (HP, resources, conditions, inventory)
- ✅ Combat system (initiative, action economy, attacks, damage)
- ✅ Character sheets and progression
- ✅ Spell effects and resource tracking
- ✅ Deterministic rule application

### LLM Responsibilities
- ✅ Parse player natural language into structured intents
- ✅ Generate narrative descriptions from game events
- ✅ Maintain storytelling and flavor
- ✅ Create story framework at session start:
  - Concrete story opening (initial scenario)
  - Loose narrative arc toward the ending
  - Concrete ending with trigger checkpoints
  - Server stores this story to seed future LLM interactions
- ✅ Drive narrative toward the ending:
  - Guide players toward story objectives
  - Prevent endless side quests
  - Introduce plot-relevant events and NPCs
  - Escalate tension as checkpoints are reached
- ❌ NO rules decisions
- ❌ NO game mechanics calculations
- ❌ NO state validation

### Benefits
- Consistent rule application (no hallucinations)
- Works with simple LLMs (even local models)
- Faster turns (no validation loop)
- Testable game logic
- Easy to add house rules or switch editions

---

## Phase 2 Implementation Plan

### Stage 1: Foundation & Rules Conversion (Week 1-2)

#### 1.1 HTML to Markdown Conversion
**Goal**: Convert all 16 D&D Beyond HTML files to clean, readable markdown

**Files to Convert** (in priority order):
1. [X] The Basics
2. [X] Playing the Game (core mechanics) - **START HERE**
3. [X] Rules Glossary
4. [X] Character Classes (split into 12 files, one per class):
   - [X] Barbarian
   - [X] Bard
   - [X] Cleric
   - [X] Druid
   - [X] Fighter
   - [X] Monk
   - [X] Paladin
   - [X] Ranger
   - [X] Rogue
   - [X] Sorcerer
   - [X] Warlock
   - [X] Wizard
5. [X] Spell Descriptions (split by level or school)
6. [X] Spells (spell lists)
7. [X] Equipment
8. [X] Feats
9. [X] Conditions (from Rules Glossary)
10. [X] Creature Stat Blocks
11. [X] Magic Items & Magic Items A-Z

**Output**: `RuleBookDocs/markdown/` with clean markdown files

**Conversion Process**:
- Extract content starting around line 2250 (after navigation)
- Strip all HTML boilerplate, scripts, navigation
- Convert tables to markdown tables
- Convert headings to markdown headers
- Preserve structure and hierarchy
- Keep human-readable (no metadata needed)
- One file per class to keep manageable

**Tracking**: See [RulesConversion_Tracker.md](RulesConversion_Tracker.md)

#### 1.2 Domain Model Design
**Goal**: Design the OOP class hierarchy for D&D entities

**Core Classes** (using inheritance):
```
Creature (abstract)
├── Character
├── Monster
└── NPC

Action (abstract)
├── AttackAction
├── SpellcastAction
├── SkillCheckAction
└── MovementAction

Item (abstract)
├── Weapon
├── Armor
└── Equipment

Effect (abstract)
├── DamageEffect
├── HealingEffect
└── ConditionEffect
```

**Key Interfaces**:
- `AbilityScores` - STR, DEX, CON, INT, WIS, CHA
- `ActionEconomy` - Action, Bonus, Reaction, Movement
- `ResourcePool` - Spell slots, Ki, Rage, etc.
- `Condition` - Blinded, Charmed, Frightened, etc.

**Output**: Design docs and interface definitions in `domain/entities/`

#### 1.3 Database Schema v2
**Goal**: Design Prisma schema for game server

**Tables Needed**:

**Static Rules Data** (read-only, seeded):
- `SpellDefinition` - All spell details
- `ClassFeatureDefinition` - Class abilities by level
- `ItemDefinition` - Equipment, weapons, armor
- `ConditionDefinition` - Status effects
- `MonsterDefinition` - Creature stat blocks

**Runtime Game State**:
- `GameSession` - Active games
  - `storyFramework` (JSON) - LLM-generated story structure:
    - Opening scenario (concrete)
    - Narrative arc (loose)
    - Ending scenario (concrete)
    - Trigger checkpoints for ending
- `Character` - Player characters
- `Monster` - Active monsters in session
- `CombatEncounter` - Initiative tracker
- `CombatantState` - HP, conditions, resources per combatant
- `GameEvent` - Event log

**Output**: `packages/game-server/prisma/schema.prisma`

---

### Stage 2: Domain Layer (Week 3-4)

#### 2.1 Base Entity Classes
**Goal**: Implement foundational domain classes with no dependencies

**Files to Create**:
- `domain/entities/creatures/creature.ts` - Abstract base for all combatants
- `domain/entities/creatures/character.ts` - Player characters
- `domain/entities/creatures/monster.ts` - NPCs and enemies
- `domain/entities/core/ability-scores.ts` - STR/DEX/CON/INT/WIS/CHA
- `domain/entities/core/skills.ts` - Skill system
- `domain/rules/dice-roller.ts` - d20 rolls, damage dice

**Core Methods**:
```typescript
class Creature {
  abstract getName(): string
  abstract getMaxHP(): number
  getCurrentHP(): number
  getAC(): number
  getAbilityModifier(ability: Ability): number
  getProficiencyBonus(): number
  
  takeDamage(amount: number, type: DamageType): void
  heal(amount: number): void
  isAlive(): boolean
  rollInitiative(): number
}
```

**Testing**: Unit tests for all domain classes (no DB needed)

#### 2.2 Combat System
**Goal**: Build the turn-based combat engine

**Files to Create**:
- `domain/combat/combat.ts` - Combat encounter manager
- `domain/combat/initiative.ts` - Turn order
- `domain/combat/attack-resolver.ts` - Attack rolls and damage

Note: `ActionEconomy` already exists under `domain/entities/combat/action-economy.ts` and is used by combat orchestration.

**Features**:
- Roll initiative for all combatants
- Track turn order
- Manage action economy per turn
- Resolve attacks (to-hit, damage, crits)
- Handle conditions affecting combat

#### 2.3 Effects System
**Goal**: Implement damage, healing, and condition effects

**Files to Create**:
- `domain/effects/Effect.ts` - Base effect class
- `domain/effects/DamageEffect.ts` - HP reduction
- `domain/effects/HealingEffect.ts` - HP restoration
- `domain/effects/ConditionEffect.ts` - Status conditions
- `domain/effects/ResourceCost.ts` - Spell slots, Ki, etc.

**Condition Implementation**:
- Blinded, Charmed, Deafened, Frightened, Grappled
- Incapacitated, Invisible, Paralyzed, Petrified
- Poisoned, Prone, Restrained, Stunned, Unconscious

---

### Stage 3: Rules Engine (Week 5-6)

#### 3.1 Core Mechanics
**Goal**: Implement fundamental D&D rules

**Files to Create**:
- `domain/rules/AbilityChecks.ts` - Skill checks, saves
- `domain/rules/Advantage.ts` - Advantage/disadvantage
- `domain/rules/Proficiency.ts` - Proficiency bonus
- `domain/rules/CombatRules.ts` - Attack resolution
- `domain/rules/MovementRules.ts` - Speed, terrain, opportunity attacks

**Rules to Implement**:
- D20 test (d20 + modifier vs DC)
- Advantage/disadvantage (roll twice, take higher/lower)
- Proficiency bonus (+2 to +6 based on level)
- Critical hits (natural 20 = double damage dice)
- Saving throws (DEX save for half damage, etc.)

#### 3.2 Spell System
**Goal**: Implement spellcasting mechanics

**Files to Create**:
- `domain/entities/Spell.ts` - Spell class
- `domain/rules/SpellResolver.ts` - Cast spells, apply effects
- `domain/rules/SpellSlots.ts` - Slot tracking and recovery
- `domain/rules/Concentration.ts` - Concentration checks

**Spell Features**:
- Spell slots by level (1st through 9th)
- Casting time (action, bonus action, reaction, ritual)
- Components (V, S, M)
- Range and targeting
- Duration (instantaneous, concentration, etc.)
- Upcasting (cast at higher level)
- Concentration (one spell at a time, break on damage)

#### 3.3 Class Features
**Goal**: Implement class-specific abilities

**Files to Create** (one per class):
- `domain/entities/classes/Barbarian.ts`
- `domain/entities/classes/Bard.ts`
- `domain/entities/classes/Cleric.ts`
- ... (all 12 classes)

**Features to Implement**:
- Hit dice and HP calculation
- Proficiencies (armor, weapons, saves, skills)
- Class features by level (Rage, Sneak Attack, Extra Attack, etc.)
- Resource tracking (Ki, Sorcery Points, Channel Divinity, etc.)
- Subclass support (planned for later)

---

### Stage 4: Application Layer (Week 7)

#### 4.1 Services
**Goal**: Orchestrate domain logic with persistence

**Files to Create**:
- `application/services/CharacterService.ts`
- `application/services/CombatService.ts`
- `application/services/SpellcastingService.ts`
- `application/services/GameSessionService.ts`

**Service Responsibilities**:
- Load/save domain entities from database
- Coordinate complex operations (attack + damage + conditions)
- Emit events for real-time updates
- Transaction management

#### 4.2 Repositories
**Goal**: Abstract data access

**Files to Create**:
- `application/repositories/ICharacterRepository.ts` (interface)
- `application/repositories/ICombatRepository.ts`
- `application/repositories/ISpellRepository.ts`
- `infrastructure/db/CharacterRepository.ts` (Prisma impl)
- `infrastructure/db/CombatRepository.ts`
- `infrastructure/db/SpellRepository.ts`

**Pattern**: Domain defines interfaces, infrastructure implements with Prisma

---

### Stage 5: Infrastructure & API (Week 8)

#### 5.1 Database Implementation
**Goal**: Connect Prisma to domain repositories

**Tasks**:
- Implement all repository interfaces with Prisma
- Create seed scripts for static game data
- Add migrations for schema changes
- Test data access layer

#### 5.2 REST API
**Goal**: Build Fastify endpoints for game actions

**Endpoints**:
```
POST   /sessions                    - Create new game
GET    /sessions/:id                - Get game state
POST   /sessions/:id/characters     - Add character
POST   /sessions/:id/combat/start   - Start combat
POST   /sessions/:id/combat/next    - Next turn
POST   /sessions/:id/actions        - Perform action
GET    /sessions/:id/events         - SSE event stream
```

**Flow**:
```
Session Creation:
  → LLM generates story framework (opening, arc, ending, checkpoints)
  → Server stores in GameSession.storyFramework
  → Story seeds all future LLM interactions

Player Turn:
  → Player Input (NL) 
  → LLM extracts intent (seeded with story context)
  → API receives structured command
  → Service executes via domain
  → State saved to DB
  → Events emitted
  → LLM generates narrative (seeded with story context)
  → Response to player
```

#### 5.3 LLM Integration
**Goal**: Connect LLM for translation and story generation

**Files to Create**:
- `infrastructure/llm/StoryGenerator.ts` - Create story framework at session start
- `infrastructure/llm/IntentParser.ts` - NL → structured intent
- `infrastructure/llm/NarrativeGenerator.ts` - Events → NL story
- `infrastructure/llm/LLMProvider.ts` - Ollama/OpenAI adapter

**LLM Prompts**:
- **Story Framework**: "Create a D&D adventure with concrete opening, loose middle arc toward ending, concrete ending scenario, and trigger checkpoints"
- **Intent Extraction**: "Parse this into { action, target, modifiers }"
- **Narration**: "Describe this attack result: hit AC 15, 8 damage"

---

### Stage 6: Testing & CLI (Week 9)

#### 6.1 Unit Tests
**Goal**: Comprehensive test coverage for domain layer

**Test Suites**:
- Character creation and leveling
- Combat mechanics (attacks, damage, initiative)
- Spell resolution
- Condition effects
- Action economy

**Tools**: Vitest with 80%+ coverage target

#### 6.2 CLI Interface
**Goal**: Terminal-based test client (Phase 1 equivalent)

**Features**:
- Create characters
- Start combat encounters
- Input actions in natural language
- See narrative output
- View character sheet
- Roll dice manually

**Implementation**: Reuse `@dungeonmaster/cli` but connect to new game-server

---

## Success Criteria

### Stage 1 Complete When:
- [ ] All 16 HTML files converted to clean markdown
- [ ] Domain model designed and documented
- [ ] Prisma schema v2 created

### Stage 2 Complete When:
- [ ] Character and Monster classes implemented
- [ ] Combat system handles initiative and turn order
- [ ] Effects system applies damage, healing, conditions
- [ ] All domain classes have unit tests

### Stage 3 Complete When:
- [ ] Core mechanics (d20 tests, advantage, proficiency) work
- [ ] Spellcasting system functional
- [ ] All 12 classes implemented with features up to level 5
- [ ] Combat rules (attacks, crits, saves) implemented

### Stage 4 Complete When:
- [ ] Services coordinate domain + persistence
- [ ] Repositories abstract Prisma access
- [ ] All operations are transactional

### Stage 5 Complete When:
- [ ] REST API serves all game operations
- [ ] LLM parses intents and generates narration
- [ ] SSE events stream game updates
- [ ] Database seeded with all spells and features

### Stage 6 Complete When:
- [ ] Unit tests pass with 80%+ coverage
- [ ] CLI can play a full combat encounter
- [ ] End-to-end test: Player input → LLM → Server → Response

---

## File Organization

```
packages/game-server/
├── src/
│   ├── domain/                    # Pure game logic (no deps)
│   │   ├── entities/
│   │   │   ├── Creature.ts
│   │   │   ├── Character.ts
│   │   │   ├── Monster.ts
│   │   │   ├── AbilityScores.ts
│   │   │   ├── Skills.ts
│   │   │   ├── Spell.ts
│   │   │   ├── Item.ts
│   │   │   ├── Weapon.ts
│   │   │   ├── Armor.ts
│   │   │   └── classes/          # One file per D&D class
│   │   │       ├── Barbarian.ts
│   │   │       ├── Bard.ts
│   │   │       └── ...
│   │   ├── combat/
│   │   │   ├── Combat.ts
│   │   │   ├── Initiative.ts
│   │   │   ├── ActionEconomy.ts
│   │   │   └── AttackResolver.ts
│   │   ├── effects/
│   │   │   ├── Effect.ts
│   │   │   ├── DamageEffect.ts
│   │   │   ├── HealingEffect.ts
│   │   │   └── ConditionEffect.ts
│   │   └── rules/
│   │       ├── DiceRoller.ts
│   │       ├── AbilityChecks.ts
│   │       ├── Advantage.ts
│   │       ├── CombatRules.ts
│   │       ├── SpellResolver.ts
│   │       └── Concentration.ts
│   ├── application/
│   │   ├── services/
│   │   │   ├── CharacterService.ts
│   │   │   ├── CombatService.ts
│   │   │   └── SpellcastingService.ts
│   │   └── repositories/
│   │       ├── ICharacterRepository.ts
│   │       └── ICombatRepository.ts
│   ├── infrastructure/
│   │   ├── db/
│   │   │   ├── prisma.ts
│   │   │   ├── CharacterRepository.ts
│   │   │   └── CombatRepository.ts
│   │   ├── api/
│   │   │   └── routes/
│   │   └── llm/
│   │       ├── IntentParser.ts
│   │       └── NarrativeGenerator.ts
│   └── index.ts
├── prisma/
│   ├── schema.prisma
│   ├── seed.ts
│   └── migrations/
├── tests/
│   ├── domain/
│   └── integration/
├── package.json
├── tsconfig.json
└── README.md

RuleBookDocs/
└── markdown/
    ├── the-basics.md
    ├── playing-the-game.md
    ├── rules-glossary.md
    ├── classes/
    │   ├── barbarian.md
    │   ├── bard.md
    │   ├── cleric.md
    │   └── ... (12 files total)
    ├── spells/
    │   ├── spell-lists.md
    │   └── spell-descriptions.md
    ├── equipment.md
    ├── feats.md
    └── conditions.md
```

---

## Next Steps

1. **Start HTML conversion** - See [RulesConversion_Tracker.md](RulesConversion_Tracker.md)
2. **Install dependencies** - Run `pnpm install` in root
3. **Design Creature base class** - First OOP entity
4. **Set up testing** - Configure Vitest
5. **Create Prisma schema** - Database design

---

## Notes

- Phase 1 (old server) is now deprecated and won't be maintained
- Focus 100% on game-server package
- Keep LLM prompts minimal - just translation, not rules
- All game logic must be deterministic and testable
- Use inheritance (Character extends Creature) as requested
- One markdown file per D&D class for maintainability
