# Player CLI — Interactive D&D 5e Combat Client

An interactive text-based client for the DungeonMaster game-server. Drive combat encounters through natural language input, roll physical dice, and see real-time AI turn resolution via SSE.

## Quick Start

```bash
# Start the game server (in another terminal)
pnpm -C packages/game-server dev

# Run with main menu
pnpm -C packages/player-cli start

# Jump straight to a scenario
pnpm -C packages/player-cli start -- --scenario solo-fighter

# Run agent-player smoke scenarios (starts isolated backend + captures logs)
pnpm -C packages/player-cli agent:smoke
```

## Agent Player Smoke Runs

You can run scripted smoke tests where the agent acts as the player and follows prompt-driven actions.

- Starts a dedicated backend on a temporary port (default `3101`) using your current environment (including current LLM settings)
- Captures backend logs to a temp file
- Runs player-cli scenarios and auto-responds to prompts (actions + dice rolls)
- Captures frontend transcript logs per scenario
- Generates a summary report with warning/failure signals from backend and frontend logs
- Generates bug reports for any failed scenarios, including all relevant logs and a description of the failure

### Commands

```bash
# Run default subset (up to 3 scenarios)
pnpm -C packages/player-cli agent:smoke

# Run all agent-player scenarios
pnpm -C packages/player-cli agent:smoke:all

# Run specific scenario ids
pnpm -C packages/player-cli agent:smoke -- --scenario fighter-smoke --scenario monk-smoke

# Override isolated backend port
pnpm -C packages/player-cli agent:smoke -- --port 3110
```

### Scenario Prompt Files

Agent-player scenario definitions live in:

- `scenarios/agent-player/fighter-smoke.json`
- `scenarios/agent-player/monk-smoke.json`
- `scenarios/agent-player/boss-smoke.json`

Each file defines:

- `cliScenario`: which normal CLI scenario to load
- `actionSequence`: commands the agent will issue at the `>` prompt
- `dice`: deterministic values for initiative/attack/damage/saves
- `timeoutMs` and `maxActionPrompts`: guard rails for stuck flows

### Output Artifacts

Each run creates a temp folder like `dm-agent-player-XXXXXX` under your OS temp directory:

- `backend.log`: backend server stdout/stderr
- `<scenario-id>.frontend.log`: CLI transcript + agent inputs
- `summary.json`: machine-readable run summary
- `report.txt`: quick human-readable verdicts

## CLI Options

| Flag | Description |
|------|-------------|
| `--server URL`, `-s URL` | Game server URL (default: `http://127.0.0.1:3001`) |
| `--scenario NAME` | Load a scenario directly by name |
| `--verbose`, `-v` | Show HTTP request/response details |
| `--no-narration` | Suppress LLM narration text |
| `--help`, `-h` | Show help |

## Game Modes

### Scenario Mode

Load a pre-built encounter from `scenarios/`:

- **solo-fighter** — Fighter vs basic enemies
- **solo-monk** — Monk vs basic enemies
- **boss-fight** — Single character vs a powerful enemy
- **party-dungeon** — Multi-character dungeon delve

### Quick Encounter Mode

Create a custom session on the fly:
1. Name your character and pick a class (fighter/monk/wizard/rogue)
2. Choose a level (1-20)
3. Add monsters (comma-separated: `goblin, goblin, wolf`)

Built-in monster presets: **Goblin**, **Wolf**, **Skeleton**, **Ogre**, **Orc**.

## Combat Commands

### Actions

| Command | Description |
|---------|-------------|
| `attack <target>` | Attack a target (e.g., "I attack the Goblin with my sword") |
| `move to (x, y)` | Move to a grid position |
| `cast <spell>` | Cast a spell (e.g., "cast fireball at the goblins") |
| `dash` | Double your movement for the turn |
| `dodge` | Impose disadvantage on attacks against you |
| `disengage` | Move without provoking opportunity attacks |
| `end turn` | End your turn (also: `end`, `pass`, `done`) |

### Class Abilities

| Command | Class | Effect |
|---------|-------|--------|
| `action surge` | Fighter | Take an additional action |
| `second wind` | Fighter | Heal 1d10+level as bonus action |
| `flurry of blows` | Monk | 2 bonus unarmed strikes (1 ki) |
| `patient defense` | Monk | Dodge as bonus action (1 ki) |
| `step of the wind` | Monk | Dash/Disengage as bonus (1 ki) |
| `cunning action` | Rogue | Dash, Disengage, or Hide as bonus |

### Info Commands

| Command | Description |
|---------|-------------|
| `status` | Show character sheet summary (HP, AC, ability scores, attacks) |
| `spells` | Show prepared spells and remaining spell slots |
| `abilities` | Show class features, resource pools, and active conditions |
| `inventory` / `inv` / `items` | Show your equipment and items |
| `tactical` / `map` / `look` | Redisplay the tactical combat state |
| `help` / `?` | Show all available commands |

### Other

| Command | Description |
|---------|-------------|
| `rest short` | Take a short rest (refresh some resources) |
| `rest long` | Take a long rest (full refresh + HP restore) |
| `<question>?` | Ask a tactical question (routed to LLM if available) |

## Dice Rolling

When the server requests a dice roll (initiative, attack, damage, saving throw), enter the raw d20/damage result:

```
Enter your d20 roll for attack: 17
Enter your damage dice roll for damage: 8
```

### On-Hit Enhancements (2024 Rules)

After a confirmed hit, the server may offer enhancement abilities. Include the keyword in your damage roll:

```
Enter your damage dice roll for damage: 8 with stunning strike
Enter your damage dice roll for damage: 6 with topple
```

## Post-Combat

After combat ends you can:
1. Take a short or long rest
2. View character status
3. Return to the main menu
4. Quit

## Scenarios

Scenarios are JSON files in `scenarios/`. Each defines a setup (character + monsters) and drops into an interactive REPL.

### Scenario Format

```json
{
  "name": "My Encounter",
  "description": "A brief description",
  "setup": {
    "character": {
      "name": "Hero",
      "className": "fighter",
      "level": 5,
      "position": { "x": 0, "y": 0 },
      "sheet": {
        "abilityScores": { "strength": 16, "dexterity": 14, "constitution": 15, "intelligence": 10, "wisdom": 12, "charisma": 8 },
        "maxHp": 42,
        "armorClass": 18,
        "speed": 30,
        "proficiencyBonus": 3,
        "attacks": [
          {
            "name": "Longsword",
            "kind": "melee",
            "range": "melee",
            "attackBonus": 6,
            "damage": { "diceCount": 1, "diceSides": 8, "modifier": 3 },
            "damageType": "slashing"
          }
        ]
      }
    },
    "monsters": [
      {
        "name": "Goblin",
        "position": { "x": 30, "y": 0 },
        "statBlock": {
          "maxHp": 7,
          "hp": 7,
          "armorClass": 15,
          "speed": 30,
          "attacks": [
            { "name": "Scimitar", "kind": "melee", "attackBonus": 4, "damage": { "diceCount": 1, "diceSides": 6, "modifier": 2 }, "damageType": "slashing" }
          ]
        }
      }
    ],
    "npcs": []
  }
}
```

## Architecture

```
src/
├── main.ts            # Entry point, CLI args, menu flows
├── combat-repl.ts     # Event-driven combat state machine
├── game-client.ts     # Typed HTTP SDK for the game server API
├── display.ts         # Terminal rendering (colors, combat display, events)
├── event-stream.ts    # SSE client with hold/replay buffer
├── scenario-loader.ts # Scenario discovery and setup orchestration
├── http-client.ts     # Thin HTTP wrapper with timeout + retry
└── types.ts           # Shared TypeScript type definitions
```

### Combat State Machine

```
IDLE → INITIATIVE_ROLL → WAITING_FOR_TURN ↔ PLAYER_TURN ↔ ROLL_PROMPT
                              ↕
                    REACTION_PROMPT / MOVE_REACTION
                              ↓
                        COMBAT_OVER → Post-Combat Loop
```

The REPL uses SSE (Server-Sent Events) for real-time display of AI turns, with automatic fallback to polling if the event stream is unavailable.
