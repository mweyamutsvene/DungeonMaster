import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";
import { useAppStore } from "../store/app-store";

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
const STEP_MS = 120; // ms per grid cell when following a path
const SLIDE_MS = 350; // ms for a direct (SSE-triggered) slide
const easeInOut = (t: number) =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

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
    const cellW = width / cols;
    const cellH = height / rows;
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

    // Grid lines
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 1;
    for (let x = 0; x <= cols; x++) {
      ctx.beginPath();
      ctx.moveTo(x * cellW, 0);
      ctx.lineTo(x * cellW, height);
      ctx.stroke();
    }
    for (let y = 0; y <= rows; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * cellH);
      ctx.lineTo(width, y * cellH);
      ctx.stroke();
    }

    // Movement path highlight (path coords are in backend 1ft units)
    if (movementPath.length > 0) {
      ctx.fillStyle = "rgba(59, 130, 246, 0.25)";
      for (const step of movementPath) {
        ctx.fillRect(d(step.x) * cellW, d(step.y) * cellH, cellW, cellH);
      }
    }

    // Destination indicator (also backend units)
    if (movementDestination) {
      ctx.strokeStyle = movementBlocked ? "#ef4444" : "#22c55e";
      ctx.lineWidth = 2;
      ctx.strokeRect(
        d(movementDestination.x) * cellW + 2,
        d(movementDestination.y) * cellH + 2,
        cellW - 4,
        cellH - 4,
      );
    }

    // Tokens (animPos stores display units already; fall back to scaled backend pos)
    for (const c of cbs) {
      if (!c.position) continue;
      const ap = animPos.current.get(c.id);
      const ax = ap ? ap.x : d(c.position.x);
      const ay = ap ? ap.y : d(c.position.y);
      const px = ax * cellW + cellW / 2;
      const py = ay * cellH + cellH / 2;
      const r = Math.min(cellW, cellH) * 0.38;

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

      const barW = cellW * 0.75;
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
        animations.current.set(c.id, {
          from: { ...from },
          to: { x: d(c.position.x), y: d(c.position.y) },
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

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const cellW = canvas.width / cols;
    const cellH = canvas.height / rows;
    // Visual cell clicked
    const vcx = Math.floor(mx / cellW);
    const vcy = Math.floor(my / cellH);
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
