# Web Client

React + Vite client for DungeonMaster tactical/theatre play.

## Prerequisites

- Node.js 20+
- pnpm
- Game server running on `http://localhost:3001`

## Launch (Development)

From the repository root:

```powershell
pnpm --filter @dungeonmaster/web-client dev
```

Then open:

- `http://localhost:5173/`

The Vite dev server proxies `/api/*` requests to the game server URL defined by `VITE_SERVER_URL` (default: `http://localhost:3001`).

## Optional: Use a Different Game Server URL

```powershell
$env:VITE_SERVER_URL = "http://localhost:4000"
pnpm --filter @dungeonmaster/web-client dev
```

## Production Build

```powershell
pnpm --filter @dungeonmaster/web-client build
pnpm --filter @dungeonmaster/web-client preview
```
