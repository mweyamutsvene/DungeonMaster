# DungeonMaster CLI

An interactive terminal test harness for the DungeonMaster Phase 2 game-server. This CLI acts as a UI client, connecting to the game server via HTTP to test full encounter flows with LLM integration.

## Features

- 🎮 **Quick Encounter Setup**: Pre-configured scenarios with Level 5 Fighter or Monk vs 2 Goblins
- 🎲 **Interactive Combat**: Natural language actions with user-provided dice rolls
- 🤖 **LLM Integration**: Intent parsing and narrative generation
- ⚔️ **Full Combat System**: Initiative, attacks, damage, reactions, and abilities
- 📖 **Dynamic Narrative**: Real-time storytelling based on combat events
- 🗺️ **Virtual Environment**: Text-based combat that simulates location/map awareness

## Requirements

The game-server must be running with LLM enabled:

```bash
# In packages/game-server/.env
DM_OLLAMA_MODEL=llama3.1:8b
# Optional: DM_OLLAMA_BASE_URL=http://localhost:11434
```

## Run

From repo root:

```bash
pnpm --filter @dungeonmaster/cli dev
```

Optional flags:

```bash
pnpm --filter @dungeonmaster/cli dev -- --server http://127.0.0.1:3000
```

## Usage Flow

### 1. Main Menu

When you start the CLI, you'll see:

```
=== MAIN MENU ===
1) Quick Encounter Setup (Fighter or Monk vs 2 Goblins)
2) View Session Info
3) Start Combat
4) Exit
```

### 2. Quick Encounter Setup (Option 1)

This creates a complete encounter in seconds:

- Creates a new game session with LLM story framework
- Generates an optimized Level 5 Fighter or Monk character
- Spawns 2 goblins (Goblin Warrior and Goblin Archer)
- Sets up the combat environment

You'll be prompted to choose:
```
Choose your character:
1) Level 5 Fighter
2) Level 5 Monk
```

### 3. Start Combat (Option 3)

Initiates the combat sequence:

1. **Initiative Roll**: You'll roll d20 + DEX modifier
2. **Turn Order**: System displays all combatants sorted by initiative
3. **Combat Loop**: Alternates between player and monster turns

### 4. Player Turn

On your turn, you can use natural language:

```
🎲 YOUR TURN
What would you like to do?
Examples:
  - 'I attack the Goblin Warrior with my sword'
  - 'I cast a spell at the Goblin Archer'
  - 'I end my turn'

Your action: I attack the Goblin Warrior with my sword
```

The system will prompt you for dice rolls:

1. **Attack Roll**: `Enter your attack roll (d20 + modifier): `
2. **Damage Roll** (if hit): `Enter your damage roll (1d8+3): `

### 5. Narrative

After each action, the LLM generates narrative:

```
📖 Thorin Ironfist charges forward, his blade gleaming in the torchlight.
With a mighty swing, he strikes the Goblin Warrior, dealing devastating damage!
```

### 6. Monster Turns

The game-server's Monster AI automatically handles enemy actions. You'll see:

```
ROUND 1 | Turn: Monster

=== COMBATANTS ===
  Thorin Ironfist: HP 45/45 [ACTIVE]
  Goblin Warrior: HP 3/7
  Goblin Archer: HP 7/7

Waiting for Monster's turn...
```

### 7. Victory or Defeat

Combat ends when:
- ✅ **Victory**: All monsters HP = 0
- ❌ **Defeat**: Player character HP = 0

## Example Session

```
$ pnpm --filter @dungeonmaster/cli dev

============================================================
DUNGEONMASTER - Encounter Test Harness
============================================================

Server: http://127.0.0.1:3000
LLM integration enabled for narrative and intent parsing.

=== MAIN MENU ===
1) Quick Encounter Setup (Fighter or Monk vs 2 Goblins)
2) View Session Info
3) Start Combat
4) Exit

Select option: 1

============================================================
QUICK ENCOUNTER SETUP
============================================================

Creating new session with LLM story framework...
✓ Session created: xyz123

Choose your character:
1) Level 5 Fighter
2) Level 5 Monk

Select (1 or 2): 1

Generating optimized level 5 fighter character...
✓ Character created: Thorin Ironfist (fighter level 5)

Spawning 2 goblins...
✓ Monsters spawned: Goblin Warrior, Goblin Archer

============================================================
ENCOUNTER READY
============================================================

Character: Thorin Ironfist (fighter level 5)
Enemies: Goblin Warrior, Goblin Archer

Return to main menu to start combat (option 3).

Select option: 3

============================================================
COMBAT START
============================================================

The encounter begins! Rolling for initiative...

Roll for initiative! (d20 + your DEX modifier)
Enter your initiative roll (d20 + DEX modifier): 15

✓ Combat started! Thorin Ironfist's turn (Initiative: 15).

=== TURN ORDER ===
  Thorin Ironfist (Initiative: 15)
  Goblin Warrior (Initiative: 12)
  Goblin Archer (Initiative: 10)
```

## Architecture

The CLI is a pure HTTP client that:

1. Uses `fetch()` to communicate with game-server REST API
2. Parses user natural language input via `/sessions/:id/combat/initiate`
3. Prompts user for dice rolls when server requests them
4. Receives combat outcomes and narrative from server
5. Displays formatted combat state and results

All game logic, rules, and state management live in the game-server. The CLI is just a thin presentation layer.

## API Endpoints Used

- `POST /sessions` - Create new session
- `POST /sessions/:id/characters/generate` - Generate character with LLM
- `POST /sessions/:id/monsters` - Spawn monsters
- `POST /sessions/:id/combat/initiate` - Initiate combat action
- `POST /sessions/:id/combat/roll-result` - Submit dice roll result
- `GET /sessions/:id/combat` - Get combat state
- `POST /sessions/:id/combat/next` - Advance to next turn
- `POST /sessions/:id/llm/narrate` - Get narrative for events
- `GET /sessions/:id/events` - Get recent combat events

## Notes

- Reactions, opportunity attacks, and special abilities are supported automatically
- The LLM handles intent parsing (e.g., "I attack the goblin" → attack action)
- User provides actual dice rolls for authenticity and control
- Combat is fully deterministic except for user-provided random rolls
- All rules enforcement happens server-side (no client-side game logic)

