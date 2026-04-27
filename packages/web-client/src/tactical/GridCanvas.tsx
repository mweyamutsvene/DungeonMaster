import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";
import { useAppStore } from "../store/app-store";
import {
  loadHeroSprites,
  drawHeroSprite,
  facingFromVector,
  type Facing,
} from "./hero-sprite";

export interface GridCanvasHandle {
  /** Animate a combatant along a series of waypoints before its store position updates. */
  moveAlongPath(combatantId: string, path: Array<{ x: number; y: number }>): void;
}

// ── Grid scale ────────────────────────────────────────────────────────────
// Backend positions are in 1ft units. D&D grid cells are 5ft.
const FEET_PER_CELL = 5;
/** Convert backend 1ft unit → display cell coord */
const d = (n: number) => n / FEET_PER_CELL;

// ── Animation constants ────────────────────────────────────────────────────
const STEP_MS = 350; // ms per grid cell when following a path
const SLIDE_MS = 700; // ms for a direct (SSE-triggered) slide
const easeInOut = (t: number) =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

// ── True isometric projection ─────────────────────────────────────
// Each square cell becomes a 2:1 rhombus (Diablo / BG / Fallout style).
// Every tile is the same size on screen — depth comes from art + draw order.
// Standard iso transform around the grid center:
//   sx = (gx - gy) * (TILE_W/2)
//   sy = (gx + gy) * (TILE_H/2)   with TILE_H = TILE_W / 2
// Tile pixel size is derived per-frame from available canvas space.

interface Anim {
  from: { x: number; y: number };
  to: { x: number; y: number };
  startTime: number;
  durationMs: number;
}

interface GridCanvasProps {
  onCellTap?: (x: number, y: number) => void;
  onTokenTap?: (combatantId: string) => void;
  attackMode?: boolean;
  selectedCombatantId?: string | null;
  movementPath?: Array<{ x: number; y: number }>;
  movementDestination?: { x: number; y: number } | null;
  movementBlocked?: boolean;
}

export const GridCanvas = forwardRef<GridCanvasHandle, GridCanvasProps>(function GridCanvas({
  onCellTap,
  onTokenTap,
  attackMode = false,
  selectedCombatantId = null,
  movementPath = [],
  movementDestination = null,
  movementBlocked = false,
}, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const combatants = useAppStore((s) => s.combatants);
  const activeCombatantId = useAppStore((s) => s.activeCombatantId);

  const positioned = combatants.filter((c) => c.position !== null);
  // Divide backend positions by FEET_PER_CELL to get visual grid dimensions
  const cols = Math.max(10, ...positioned.map((c) => Math.ceil(d(c.position?.x ?? 0)) + 2));
  const rows = Math.max(10, ...positioned.map((c) => Math.ceil(d(c.position?.y ?? 0)) + 2));

  // ── Refs shared with the stable RAF loop ────────────────────────────────
  const combatantsRef = useRef(combatants);
  const activeCombatantIdRef = useRef(activeCombatantId);
  const colsRef = useRef(cols);
  const rowsRef = useRef(rows);
  const propsRef = useRef({ attackMode, selectedCombatantId, movementPath, movementDestination, movementBlocked });

  // animPos: current visual (fractional) grid position per combatant
  const animPos = useRef<Map<string, { x: number; y: number }>>(new Map());
  // animations: active tweens
  const animations = useRef<Map<string, Anim>>(new Map());
  // path queues: remaining waypoints to walk through
  const pathQueues = useRef<Map<string, Array<{ x: number; y: number }>>>(new Map());
  // ids currently being path-animated (skip SSE position-change tween for these)
  const pathAnimating = useRef<Set<string>>(new Set());
  // previous grid positions (to detect changes)
  const prevPos = useRef<Map<string, { x: number; y: number }>>(new Map());
  // current facing per combatant (for sprite rendering)
  const facing = useRef<Map<string, Facing>>(new Map());
  // sprite assets loaded flag — triggers redraw once images are ready
  const spritesReady = useRef(false);
  const rafRef = useRef<number | null>(null);

  // ── Stable render function (reads from refs, never recreated) ───────────
  const renderFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const now = performance.now();
    const { width, height } = canvas;
    const cols = colsRef.current;
    const rows = rowsRef.current;
    // The full iso footprint spans (cols+rows) tile half-widths horizontally
    // and (cols+rows) tile half-heights vertically. Solve for the largest
    // TILE_W that fits the canvas at a 2:1 ratio.
    const TILE_W = Math.floor(Math.min(width / (cols + rows), (height * 2) / (cols + rows)));
    const TILE_H = TILE_W / 2;
    const HALF_W = TILE_W / 2;
    const HALF_H = TILE_H / 2;
    // Bounding box of the projected diamond (top is at gx=0,gy=0 → (-cols*HW, 0) ... )
    // Simpler: place grid origin so the diamond is centered.
    const isoW = (cols + rows) * HALF_W;
    const isoH = (cols + rows) * HALF_H;
    const originX = Math.floor((width - isoW) / 2 + rows * HALF_W);
    const originY = Math.floor((height - isoH) / 2);
    /** Project a grid-cell coord (in cell units) to a screen pixel via 2:1 iso. */
    const project = (gx: number, gy: number): [number, number] => {
      return [originX + (gx - gy) * HALF_W, originY + (gx + gy) * HALF_H];
    };
    // Approximate "cell size" for token sizing (use tile width).
    const cellSize = TILE_W;
    const cbs = combatantsRef.current;
    const activeId = activeCombatantIdRef.current;
    const { attackMode, selectedCombatantId, movementPath, movementDestination, movementBlocked } =
      propsRef.current;

    // Advance active tweens
    for (const [id, anim] of animations.current) {
      const t = Math.min((now - anim.startTime) / anim.durationMs, 1);
      const e = easeInOut(t);
      const pos = {
        x: anim.from.x + (anim.to.x - anim.from.x) * e,
        y: anim.from.y + (anim.to.y - anim.from.y) * e,
      };
      animPos.current.set(id, pos);
      if (t >= 1) {
        animations.current.delete(id);
        // Dequeue next waypoint if path-walking
        const queue = pathQueues.current.get(id);
        if (queue && queue.length > 0) {
          const next = queue.shift()!;
          facing.current.set(id, facingFromVector(next.x - pos.x, next.y - pos.y, facing.current.get(id) ?? "south"));
          animations.current.set(id, {
            from: { ...pos },
            to: next,
            startTime: now,
            durationMs: STEP_MS,
          });
          if (queue.length === 0) {
            pathQueues.current.delete(id);
            pathAnimating.current.delete(id);
          }
        }
      }
    }

    // Background
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, width, height);

    // Helper: outline a single iso tile (gx,gy in cell units) as a diamond.
    const tracePoly = (gx: number, gy: number) => {
      const [x0, y0] = project(gx, gy);
      const [x1, y1] = project(gx + 1, gy);
      const [x2, y2] = project(gx + 1, gy + 1);
      const [x3, y3] = project(gx, gy + 1);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineTo(x3, y3);
      ctx.closePath();
    };

    // ── Procedural stone-tile fill ────────────────────────────────────
    // Deterministic per-cell color + checkerboard accent gives a tabletop
    // "ground" feel without needing tile art assets.
    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        const h = ((gx * 73856093) ^ (gy * 19349663)) & 0xff;
        const checker = (gx + gy) % 2 === 0;
        const base = checker ? 64 : 54;
        const j = (h % 14) - 7;
        const v = Math.max(34, Math.min(96, base + j));
        ctx.fillStyle = `rgb(${v + 8}, ${v + 4}, ${v - 4})`; // warm stone
        tracePoly(gx, gy);
        ctx.fill();
      }
    }

    // ── Isometric grid lines ─────────────────────────────────────────
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 1;
    for (let x = 0; x <= cols; x++) {
      const [sx0, sy0] = project(x, 0);
      const [sx1, sy1] = project(x, rows);
      ctx.beginPath();
      ctx.moveTo(sx0, sy0);
      ctx.lineTo(sx1, sy1);
      ctx.stroke();
    }
    for (let y = 0; y <= rows; y++) {
      const [sx0, sy0] = project(0, y);
      const [sx1, sy1] = project(cols, y);
      ctx.beginPath();
      ctx.moveTo(sx0, sy0);
      ctx.lineTo(sx1, sy1);
      ctx.stroke();
    }

    // Movement path highlight (path coords are in backend 1ft units)
    if (movementPath.length > 0) {
      ctx.fillStyle = "rgba(59, 130, 246, 0.25)";
      for (const step of movementPath) {
        tracePoly(d(step.x), d(step.y));
        ctx.fill();
      }
    }

    // Destination indicator (also backend units)
    if (movementDestination) {
      ctx.strokeStyle = movementBlocked ? "#ef4444" : "#22c55e";
      ctx.lineWidth = 2;
      tracePoly(d(movementDestination.x), d(movementDestination.y));
      ctx.stroke();
    }

    // Tokens (animPos stores display units already; fall back to scaled backend pos)
    for (const c of cbs) {
      if (!c.position) continue;
      const ap = animPos.current.get(c.id);
      const ax = ap ? ap.x : d(c.position.x);
      const ay = ap ? ap.y : d(c.position.y);
      const [px, py] = project(ax + 0.5, ay + 0.5);
      const r = cellSize * 0.38;

      const isPlayer = c.combatantType === "Character";
      const isCurrent = c.id === activeId;
      const isSelected = c.id === selectedCombatantId;
      const isDead = c.hp.current <= 0;
      const isAttackTarget = attackMode && !isPlayer && !isDead;

      if (isAttackTarget) {
        ctx.beginPath();
        ctx.arc(px, py, r + 5, 0, Math.PI * 2);
        ctx.strokeStyle = "#f97316";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      if (isCurrent) {
        ctx.beginPath();
        ctx.arc(px, py, r + 4, 0, Math.PI * 2);
        ctx.strokeStyle = "#f59e0b";
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(px, py, r + 8, 0, Math.PI * 2);
        ctx.strokeStyle = "#60a5fa";
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fillStyle = isDead
        ? "#374151"
        : isAttackTarget
          ? "#b91c1c"
          : isPlayer
            ? "#3b82f6"
            : "#ef4444";
      ctx.fill();
      ctx.strokeStyle = isDead
        ? "#4b5563"
        : isAttackTarget
          ? "#fca5a5"
          : isPlayer
            ? "#93c5fd"
            : "#fca5a5";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = isDead ? "#6b7280" : "#ffffff";
      ctx.font = `bold ${Math.round(r * 1.1)}px system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(c.name[0]?.toUpperCase() ?? "?", px, py);

      // Overlay the sprite for player characters once assets are loaded.
      if (isPlayer && spritesReady.current && !isDead) {
        const isMoving = animations.current.has(c.id);
        const dir = facing.current.get(c.id) ?? "south";
        const spriteSize = cellSize * 1.4;
        drawHeroSprite(ctx, px, py - cellSize * 0.05, spriteSize, dir, isMoving, now);
      }

      const barW = cellSize * 0.75;
      const barH = 3;
      const barX = px - barW / 2;
      const barY = py + r + 3;
      const hpPct = Math.max(0, c.hp.current / c.hp.max);
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(barX, barY, barW, barH);
      ctx.fillStyle = hpPct > 0.5 ? "#22c55e" : hpPct > 0.25 ? "#eab308" : "#ef4444";
      ctx.fillRect(barX, barY, barW * hpPct, barH);
    }

    // Keep looping while tweens are active; otherwise go idle
    if (animations.current.size > 0) {
      rafRef.current = requestAnimationFrame(renderFrame);
    } else {
      rafRef.current = null;
    }
  }, []); // stable — all live data read from refs

  // ── Expose path animation API to parent ───────────────────────────────────
  useImperativeHandle(ref, () => ({
    moveAlongPath(combatantId: string, path: Array<{ x: number; y: number }>) {
      if (path.length === 0) return;
      // Convert backend path to display units
      const displayPath = path.map((p) => ({ x: d(p.x), y: d(p.y) }));
      const prevBk = prevPos.current.get(combatantId);
      const from = animPos.current.get(combatantId) ?? (prevBk ? { x: d(prevBk.x), y: d(prevBk.y) } : null);
      if (!from) return;
      const [first, ...rest] = displayPath;
      pathAnimating.current.add(combatantId);
      if (rest.length > 0) pathQueues.current.set(combatantId, rest);
      facing.current.set(combatantId, facingFromVector(first.x - from.x, first.y - from.y, facing.current.get(combatantId) ?? "south"));
      animations.current.set(combatantId, {
        from: { ...from },
        to: first,
        startTime: performance.now(),
        durationMs: STEP_MS,
      });
      if (rafRef.current === null) rafRef.current = requestAnimationFrame(renderFrame);
    },
  }), [renderFrame]);

  // ── Sync refs on every render ────────────────────────────────────────────
  useEffect(() => {
    colsRef.current = cols;
    rowsRef.current = rows;
    activeCombatantIdRef.current = activeCombatantId;
    propsRef.current = { attackMode, selectedCombatantId, movementPath, movementDestination, movementBlocked };
    // Redraw static state (only if no animation loop is already running)
    if (rafRef.current === null) renderFrame();
  }, [cols, rows, activeCombatantId, attackMode, selectedCombatantId, movementPath, movementDestination, movementBlocked, renderFrame]);

  // ── Detect combatant position changes → kick off animations ─────────────
  useEffect(() => {
    combatantsRef.current = combatants;
    let hasNew = false;

    for (const c of combatants) {
      if (!c.position) continue;
      const prev = prevPos.current.get(c.id);
      if (!prev) {
        // First time seen — place immediately at display coords, no tween
        animPos.current.set(c.id, { x: d(c.position.x), y: d(c.position.y) });
        prevPos.current.set(c.id, { ...c.position }); // prevPos in backend units
        continue;
      }
      if (prev.x !== c.position.x || prev.y !== c.position.y) {
        prevPos.current.set(c.id, { ...c.position });
        // Skip SSE tween if a path animation is already handling this move
        if (pathAnimating.current.has(c.id)) continue;
        // Fallback: tween to new display position (AI moves, remote players, etc.)
        const from = animPos.current.get(c.id) ?? { x: d(prev.x), y: d(prev.y) };
        const to = { x: d(c.position.x), y: d(c.position.y) };
        facing.current.set(c.id, facingFromVector(to.x - from.x, to.y - from.y, facing.current.get(c.id) ?? "south"));
        animations.current.set(c.id, {
          from: { ...from },
          to,
          startTime: performance.now(),
          durationMs: SLIDE_MS,
        });
        hasNew = true;
      }
    }

    if (hasNew) {
      if (rafRef.current === null) rafRef.current = requestAnimationFrame(renderFrame);
    } else if (rafRef.current === null) {
      renderFrame();
    }
  }, [combatants, renderFrame]);

  // ── Canvas resize observer ───────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      if (rafRef.current === null) renderFrame();
    });
    observer.observe(canvas);
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    renderFrame();
    return () => {
      observer.disconnect();
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [renderFrame]);

  // ── Preload hero sprite assets once ──────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    loadHeroSprites()
      .then(() => {
        if (cancelled) return;
        spritesReady.current = true;
        if (rafRef.current === null) renderFrame();
      })
      .catch((err) => {
        console.warn("Failed to load hero sprites:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [renderFrame]);

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;
    // Recompute iso layout (must match renderFrame)
    const TILE_W = Math.floor(Math.min(canvas.width / (cols + rows), (canvas.height * 2) / (cols + rows)));
    const TILE_H = TILE_W / 2;
    const HALF_W = TILE_W / 2;
    const HALF_H = TILE_H / 2;
    const isoW = (cols + rows) * HALF_W;
    const isoH = (cols + rows) * HALF_H;
    const originX = Math.floor((canvas.width - isoW) / 2 + rows * HALF_W);
    const originY = Math.floor((canvas.height - isoH) / 2);
    // Inverse iso transform: given (sx,sy) relative to origin,
    //   gx = sx/HALF_W/2 + sy/HALF_H/2 ... actually: solve
    //     sx = (gx - gy) * HALF_W   → gx - gy = sx / HALF_W
    //     sy = (gx + gy) * HALF_H   → gx + gy = sy / HALF_H
    const sx = mx - originX;
    const sy = my - originY;
    const gxF = (sx / HALF_W + sy / HALF_H) / 2;
    const gyF = (sy / HALF_H - sx / HALF_W) / 2;
    const vcx = Math.floor(gxF);
    const vcy = Math.floor(gyF);
    if (vcx < 0 || vcx >= cols || vcy < 0 || vcy >= rows) return;
    // Ignore clicks outside the grid area
    if (vcx < 0 || vcx >= cols || vcy < 0 || vcy >= rows) return;
    // Hit-test: find token whose display cell matches
    const hit = combatants.find(
      (c) => c.position && Math.floor(d(c.position.x)) === vcx && Math.floor(d(c.position.y)) === vcy
    );
    if (hit) {
      onTokenTap?.(hit.id);
    } else {
      // Emit backend coords so TacticalLayout can pass them straight to the server
      onCellTap?.(vcx * FEET_PER_CELL, vcy * FEET_PER_CELL);
    }
  }

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full cursor-pointer touch-none"
      onClick={handleClick}
      style={{ display: "block" }}
    />
  );
});
