---
description: 'Continue web-client tactical development from the latest handoff. Reads the most recent handoff log and git changes, continues implementation, browser-verifies the result, commits, and writes the next handoff.'
tools: [vscode, execute, read, agent, edit, search, web, browser, todo]
---

# Web Client: Continue From Handoff

You are implementing the DungeonMaster web client. This is a **browser-verified, commit-and-handoff** workflow.

You do not TOUCH the game server code. If you encounter a server bug that blocks client implementation, document it in the handoff but do not fix it.

You DO NOT TOUCH the CLI or scenario harness. This is purely web client work.

The CLI is a good tool to see the server's expected contracts and flows.

## Step 1 — Orient

Read these files in parallel before writing any code:

1. The latest handoff log — find it with:
   ```powershell
   Get-ChildItem plans/handoff-web-client-tactical-*.md | Sort-Object Name | Select-Object -Last 1
   ```
2. Recent git changes to understand what was just done:
   ```powershell
   git log --oneline -10
   git diff HEAD~3..HEAD --stat
   ```
3. The plan milestone tracker:
   - `plans/plan-multiplayer-tabletop-client.prompt.md` — find the Build Phases table and locate which M-items are checked/unchecked

Identify the top 1–3 **uncompleted items** from the handoff's "Not Yet Implemented" section that are most impactful, and confirm against the plan's milestone list.

## Step 2 — Read the Browser Debug Skill

**REQUIRED before any browser interaction.** Read the skill file:

```
.github/skills/browser-debug/SKILL.md
```

This contains the canvas coordinate system, the double-click move pattern, API query helpers, common failure modes, and the full flow checklist. Do not skip this.

## Step 3 — Implement

Build the top-priority items identified in Step 1.

### Web Client Source Roots
- `packages/web-client/src/` — all client source
- `packages/web-client/src/tactical/` — grid, tokens, action bar, layout
- `packages/web-client/src/shared-ui/` — modals and reusable UI
- `packages/web-client/src/store/app-store.ts` — Zustand store (SSE state, pending rolls, UI state)
- `packages/web-client/src/hooks/use-game-server.ts` — typed API client
- `packages/web-client/src/pages/` — page-level components

### Game Server API Reference
- `packages/game-server/src/infrastructure/api/routes/sessions/` — all route handlers
- `packages/game-server/SESSION_API_REFERENCE.md` — high-level API doc
- `docs/api/reference/` — canonical schema, events, endpoints, errors

### Key Constraints
- **SSE contract:** `requiresPlayerInput: true` in any action response → show `DiceRollModal`. Chain via `handleRollResponse(response, actorId)`.
- **Roll submission:** submit raw die value only (server adds modifier). Never submit total.
- **Canvas clicks:** use `page.mouse.click(px, py)` with computed `cellCenter(gridX, gridY)` coords — not element selectors.
- **Move pattern:** first click = preview, second click = confirm (800ms gap).
- **Melee attacks:** target must be ≤5ft from active combatant. Query `/tactical` API for positions first.
- **TypeScript:** run `pnpm --filter @dungeonmaster/web-client exec tsc --noEmit` to validate before committing.

## Step 4 — Browser Verify

**Every session must end with a browser-verified flow.** Do not skip this even if the build is clean.

1. Confirm game server is running: `Invoke-WebRequest -Uri http://localhost:3001/health -UseBasicParsing | Select-Object -First 3`
2. Confirm web client dev server is running on `:5174` or `:5175` (check the active browser tab URL).
   - If not running: `pnpm --filter @dungeonmaster/web-client dev`
3. Navigate to `http://localhost:5174/` (or whichever port is active).
4. Run the full flow checklist from `browser-debug/SKILL.md`.
5. Take screenshots at each major checkpoint (tactical view, dice modal, kill).
6. If a canvas click misses, query the `/tactical` API to verify actual positions before retrying.

Capture a final screenshot showing the verified end state.

## Step 5 — Typecheck

```powershell
pnpm --filter @dungeonmaster/web-client exec tsc --noEmit
```

Fix any errors before committing.

## Step 6 — Commit

Stage and commit only web-client source changes:

```powershell
git add packages/web-client/src/
git commit -m "feat(web-client): <concise description of what was implemented>"
```

Use conventional commits. One commit per logical feature. Multiple commits are fine for large sessions.

## Step 7 — Write the Next Handoff Log

Create `plans/handoff-web-client-tactical-<YYYY-MM-DD>-v<N>.md` where `<N>` is one greater than the last handoff version.

The handoff must contain:

```markdown
# Handoff: Web Client Tactical View v<N> — <Title>
**Date:** <YYYY-MM-DD>
**Commits:** `<sha1>`, `<sha2>`, ...
**Prior Handoff:** `plans/handoff-web-client-tactical-<prior>.md`

---

## What Was Implemented This Session
[Describe each feature/fix with enough detail that the next agent can understand the architecture decisions]

### ⚠️ Important Contracts / Gotchas
[Any non-obvious contracts the next agent must know — server API quirks, state machine rules, coordinate math, etc.]

---

## New Files
| File | Purpose |

## Modified Files
| File | Change |

---

## Browser-Verified Flow
| Step | Result |
[Table of steps tested, each marked ✅ or ❌]

---

## Current State of the Web Client

### Working End-to-End
[Bullet list of confirmed-working features]

### Not Yet Implemented
[Numbered list — ordered by impact. This becomes the input to the next session.]

---
```

Then commit the handoff doc:

```powershell
git add plans/handoff-web-client-tactical-<date>-v<N>.md
git commit -m "docs: web-client tactical handoff v<N> - <title>"
```

## Guardrails

- Do not modify game-server source unless a bug in the server is blocking a client feature AND it is a clear fix. If so, document it explicitly in the handoff.
- Do not implement features not in the plan milestones or the handoff's "Not Yet Implemented" list without noting the deviation.
- If the browser session is not yet in combat (e.g., fresh page), follow the full setup flow in `browser-debug/SKILL.md` — do NOT assume a prior session is still active.
- If the tactical grid canvas offsets produce misses, re-read `GridCanvas.tsx` for current `CANVAS_WIDTH`, `CANVAS_HEIGHT`, `COLS`, `ROWS` constants before retrying.
