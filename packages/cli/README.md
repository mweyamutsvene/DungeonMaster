# DungeonMaster CLI

A tiny interactive terminal test harness for the DungeonMaster Phase 2 game-server.

## Run

From repo root:

- `pnpm --filter @dungeonmaster/cli dev`

Optional flags:

- `pnpm --filter @dungeonmaster/cli dev -- --server http://127.0.0.1:3000`
- `pnpm --filter @dungeonmaster/cli dev -- --session <sessionId> --character <characterId>`

## Basic flow

1) `new`
2) `addchar Alice fighter 1`
3) `spawn goblin`
4) `combat start`
5) `act I attack the goblin with my sword`
6) (optional) `roll 1d20+5`

## Commands

Type `help` inside the CLI.
