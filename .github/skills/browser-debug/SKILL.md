---
name: browser-debug
description: 'Run, interact with, and debug the DungeonMaster web client in the VS Code browser panel using Playwright and screenshot tools. USE FOR: testing web-client UI flows end-to-end in the browser, clicking canvas game tokens, querying live API state, verifying UI after code changes. DO NOT USE FOR: game-server unit tests, E2E JSON scenario harness, or non-browser debugging.'
argument-hint: 'Describe the UI flow you want to test or debug'
---

# Browser Debug — Web Client

Interact with the DungeonMaster web client running in the VS Code embedded browser using the Playwright and screenshot tools. The goal is verifying UI behavior end-to-end against the live Fastify game server.

## Prerequisites

The web client dev server must be running before browser interaction. The game server must also be up.

```powershell
# Start web client dev server (port 5175)
pnpm --filter @dungeonmaster/web-client dev

# Verify game server is alive (port 3001)
Invoke-WebRequest -Uri http://localhost:3001/health -UseBasicParsing | Select-Object -First 3
```

If the game server needs restarting: `pnpm -C packages/game-server dev`

## Step 1 — Navigate to the App

Always navigate to `http://localhost:5175/` first in the browser tool.

```
Navigate to http://localhost:5175/ in [Browser]
```

The first page is the LobbyPage. It shows a name input and two buttons (Create / Join). The **Create button is disabled until a name is typed**.

## Step 2 — Lobby → Session Setup

1. Click the name text input (label "Your Name").
2. Type a player name (e.g., "Papi").
3. Click "Create New Session".
4. Wait — setup page loads. Use "Read Page" to confirm.

## Step 3 — Session Setup → Quick-Start Combat

The setup page has quick-start presets. Click one (e.g., "Solo Fighter vs Goblins") to bootstrap combatants.

**IMPORTANT — Wait for combatants to hydrate before clicking Start Combat.** The combatants panel shows a spinner while loading. After the quick-start click, do NOT immediately click Start Combat — read the page or wait 30-69 seconds for combatants to appear.

Then click "Start Combat".

## Step 4 — Tactical Combat View

After Start Combat the app transitions to the SessionPage with the TacticalLayout.

### Key Steps to Always Perform
1. After some sort of interaction (click, wait, attack, etc.), always observe the UI and capture a screenshot to verify the result. Look for unexpected states (e.g., buttons not appearing, tokens not rendering, modals not showing).
2. Document each instance of these so that the Developer can determine if it is truely a bug or just a misunderstanding of the expected flow.

### Canvas Coordinate System

The combat grid is rendered on a `<canvas>` element. DOM click helpers won't hit tokens — use `page.mouse.click()` with computed pixel coordinates.

**Grid dimensions (defaults):**
- Canvas width: 825 px
- Canvas height: 559 px  
- Grid cols: 42, rows: 22
- Canvas top offset (from viewport top): ~83.5 px

```js
const cellW = 825 / 42;  // ≈ 19.64 px per cell
const cellH = 559 / 22;  // ≈ 25.41 px per cell
const canvasTop = 83.5;  // px from viewport top to canvas top edge

function cellCenter(gridX, gridY) {
  return {
    px: gridX * cellW + cellW / 2,
    py: canvasTop + gridY * cellH + cellH / 2,
  };
}
```

Use `page.mouse.click(px, py)` — **not** `page.locator('canvas').click(...)` which can be intercepted.

### Query Live Combatant Positions

Before clicking tokens, always query the API to get real grid coordinates:

```js
const res = await page.evaluate(async () => {
  const sessionId = window.location.pathname.split('/session/')[1]?.split('/')[0];
  const combat = await fetch(`/api/sessions/${sessionId}/combat`).then(r => r.json());
  const encId = combat?.encounter?.id;
  const tact = await fetch(`/api/sessions/${sessionId}/combat/${encId}/tactical`).then(r => r.json());
  return tact.combatants.map(c => ({
    name: c.name,
    pos: c.position,
    dist: c.distanceFromActive,
    moveLeft: c.actionEconomy?.movementRemainingFeet,
  }));
});
```

### Move Flow

Thorin starts at (10,10), goblins at (40,10) and (40,20). Melee range is 5ft (1 cell). Move Thorin to (35,10) first.

1. **First click** on destination cell → shows preview highlight.
2. **Second click** on same cell → confirms move (sends `POST /move`).

Wait 800 ms between clicks.

```js
const dest = cellCenter(35, 10);
await page.mouse.click(dest.px, dest.py);
await page.waitForTimeout(800);
await page.mouse.click(dest.px, dest.py);
await page.waitForTimeout(1000);
```

### Attack Flow

1. Click the "Attack" button in the ActionBar (it's a DOM button, use the click element tool).
2. Attack mode activates (button turns red/active).
3. Click the goblin token on the canvas using `page.mouse.click()` with computed coords.
4. The DiceRollModal appears if the attack needs a roll.

**CRITICAL — Melee range check:** Thorin must be adjacent (≤5ft) to the target before attacking. If `distanceFromActive` is > 5, move first. Clicking a token out of range dismisses attack mode silently with no error.

### Dice Roll Modal

When an action returns `requiresPlayerInput`, the DiceRollModal renders. It shows:
- A "Roll dN" button that generates a random roll
- A result display
- A "Confirm" button (disabled until rolled)

Interact with DOM buttons normally:

```
Click "Roll d20" button in [Browser]
Click "Confirm" button in [Browser]
```

After the attack roll, if it hits, a second modal for damage appears automatically (chained via `handleRollResponse`).

## Taking Screenshots

Use the screenshot tool to verify UI state visually after each major step:

```
Capture screenshot of <description> in [Browser]
```

Useful checkpoints:
- After tactical view loads (tokens on grid)
- After entering attack mode
- After DiceRollModal appears
- After goblin dies (token disappears, log entry appears)

## Reading Page State

Use the "Read page" tool to inspect DOM text (initiative tracker, action economy bullets, log entries) when screenshots aren't sufficient.

## Common Failure Modes

| Symptom | Cause | Fix |
|---|---|---|
| Create button stays disabled | No name typed in lobby input | Click name field → type name first |
| Quick-start spinner never resolves | Game server not running | Start `pnpm -C packages/game-server dev` |
| Attack click dismisses attack mode silently | Thorin not in melee range | Query tactical API, move Thorin adjacent first |
| Canvas click hits wrong cell | canvasTop offset wrong or grid size changed | Re-read `GridCanvas.tsx` for `CANVAS_WIDTH/HEIGHT/COLS/ROWS` constants |
| DiceRollModal doesn't appear | `handleRollResponse` not wired in ActionBar or TacticalLayout | Check `app-store.ts` `pendingRoll` state and `TacticalLayout.tsx` handler |
| API fetch in `page.evaluate` returns 404 | Wrong session ID extraction | Log `window.location.pathname` to verify |

## Key Source Files

| File | Purpose |
|---|---|
| [packages/web-client/src/tactical/GridCanvas.tsx](../../../packages/web-client/src/tactical/GridCanvas.tsx) | Canvas rendering, grid constants (`CANVAS_WIDTH`, `COLS`, etc.) |
| [packages/web-client/src/tactical/TacticalLayout.tsx](../../../packages/web-client/src/tactical/TacticalLayout.tsx) | Attack token handler, move handler, `handleRollResponse` wiring |
| [packages/web-client/src/tactical/ActionBar.tsx](../../../packages/web-client/src/tactical/ActionBar.tsx) | Action buttons; `doAction` must call `handleRollResponse` on response |
| [packages/web-client/src/shared-ui/DiceRollModal.tsx](../../../packages/web-client/src/shared-ui/DiceRollModal.tsx) | Dice roll modal component |
| [packages/web-client/src/store/app-store.ts](../../../packages/web-client/src/store/app-store.ts) | Zustand store; `pendingRoll`, `setPendingRoll`, `handleRollResponse` |
| [packages/web-client/src/hooks/use-game-server.ts](../../../packages/web-client/src/hooks/use-game-server.ts) | API client; `submitRoll`, `sendAction`, `moveToken` |
| [packages/web-client/src/pages/LobbyPage.tsx](../../../packages/web-client/src/pages/LobbyPage.tsx) | Lobby form; Create button disabled without name |
| [packages/web-client/src/pages/SessionSetupPage.tsx](../../../packages/web-client/src/pages/SessionSetupPage.tsx) | Quick-start presets, Start Combat button |

## Full Flow Checklist

```
[ ] Game server running on :3001
[ ] Web client dev server running on :5175
[ ] Navigate to http://localhost:5175/
[ ] Type player name → Create New Session
[ ] Click quick-start preset → wait for combatants
[ ] Click Start Combat
[ ] Query /tactical API for combatant positions
[ ] Move player token adjacent to target (double-click pattern)
[ ] Click Attack button (DOM)
[ ] Click target token (canvas mouse.click with cellCenter coords)
[ ] DiceRollModal appears → Roll → Confirm
[ ] Damage modal chain (if hit) → Roll → Confirm
[ ] Screenshot / Read page to verify outcome
```
