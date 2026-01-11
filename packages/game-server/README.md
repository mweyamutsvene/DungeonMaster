# @dungeonmaster/game-server

The core D&D 5e rules engine and game server. This package contains:

- **Domain Layer**: Pure TypeScript classes representing D&D entities (Character, Spell, Combat, etc.)
- **Application Layer**: Services that orchestrate domain logic and persistence
- **Infrastructure Layer**: Database, repositories, and external integrations
- **API Layer**: REST endpoints and real-time communication

## Architecture

```
src/
├── domain/           # Pure game logic (no dependencies)
│   ├── entities/     # Character, Monster, Spell, Item, etc.
│   ├── combat/       # Combat system, initiative, action economy
│   ├── effects/      # Damage, healing, conditions
│   └── rules/        # Dice rolling, modifiers, validators
├── application/      # Use cases and services
│   ├── services/     # CharacterService, CombatService, etc.
│   └── repositories/ # Data access interfaces
├── infrastructure/   # External concerns
│   ├── db/          # Prisma client and implementations
│   └── api/         # REST routes and WebSocket handlers
└── index.ts         # Server entry point
```

## Design Principles

1. **Server is the source of truth** - All D&D rules live in code, not LLM prompts
2. **Domain-driven design** - Business logic separated from infrastructure
3. **LLM is a translator** - Only converts natural language ↔ structured commands
4. **Testable** - Domain layer has zero external dependencies
5. **Type-safe** - Full TypeScript coverage with strict mode

## Development

```bash
# Run in watch mode
pnpm dev

# Run tests
pnpm test

# Type check
pnpm type-check
```
