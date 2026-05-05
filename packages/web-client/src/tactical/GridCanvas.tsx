import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";
import { useAppStore } from "../store/app-store";
import {
  loadHeroSprites,
  drawHeroSprite,
  drawHeroAttack,
  facingFromVector,
  facingFromIsoGrid,
  ATTACK_DURATION_MS,
  type Facing,
} from "./hero-sprite";
import { loadIsoTiles, getGrassTile, getAnyGrassTile, grassVariantIndex } from "./iso-tiles";
import { HERO_PROFILE, getMonsterProfile } from "./sprite-profile";
import { loadMonsterSprites, getMonsterSprites, drawMonsterSprite } from "./monster-sprite";

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
  const lastAttackEvent = useAppStore((s) => s.lastAttackEvent);

  const positioned = combatants.filter((c) => c.position !== null);
  // Compute the maximum occupied cell on either axis, then use ONE square
  // grid dimension. Iso bounding-box has fixed 2:1 aspect so a square grid
  // gives the best fit in arbitrary containers.
  const maxX = Math.max(0, ...positioned.map((c) => Math.ceil(d(c.position?.x ?? 0)) + 1));
  const maxY = Math.max(0, ...positioned.map((c) => Math.ceil(d(c.position?.y ?? 0)) + 1));
  const dim = Math.max(8, maxX, maxY);
  const cols = dim;
  const rows = dim;

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
  // iso tile assets loaded flag
  const tilesReady = useRef(false);
  // Set of combatant names whose monster sprites have been kicked off for loading.
  const monsterSpriteLoaded = useRef(new Set<string>());
  // Death animations: combatant id → performance.now() when death started.
  const dyingAnimations = useRef<Map<string, number>>(new Map());
  // Attack animations: combatant id → { startTime, facing }
  const attackAnimations = useRef<Map<string, { startTime: number; facing: Facing }>>(new Map());
  // Last narration entry id processed for attack-animation triggering.
  const lastAttackTriggerId = useRef<string | null>(null);
  // Previous HP per combatant — used to detect the alive→dead transition.
  const prevHp = useRef<Map<string, number>>(new Map());
  const rafRef = useRef<number | null>(null);

  // ── Pan / zoom state ───────────────────────────────────────────────
  // zoom is a multiplier on the auto-fit tile size; pan is screen-pixel offset.
  const zoom = useRef(1);
  const pan = useRef({ x: 0, y: 0 });
  // Drag tracking (for pan).
  const dragState = useRef<{ active: boolean; startX: number; startY: number; baseX: number; baseY: number; moved: boolean }>(
    { active: false, startX: 0, startY: 0, baseX: 0, baseY: 0, moved: false },
  );

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
    const TILE_SCALE = 3.5;
    const TILE_W = Math.max(2, Math.floor(
      Math.min(width / (cols + rows), (height * 2) / (cols + rows)) * zoom.current * TILE_SCALE,
    ));
    const TILE_H = TILE_W / 2;
    const HALF_W = TILE_W / 2;
    const HALF_H = TILE_H / 2;
    // Bounding box of the projected diamond (top is at gx=0,gy=0 → (-cols*HW, 0) ... )
    // Simpler: place grid origin so the diamond is centered, then offset by pan.
    const isoW = (cols + rows) * HALF_W;
    const isoH = (cols + rows) * HALF_H;
    const originX = Math.floor((width - isoW) / 2 + rows * HALF_W + pan.current.x);
    const originY = Math.floor((height - isoH) / 2 + pan.current.y);
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
          facing.current.set(id, facingFromIsoGrid(next.x - pos.x, next.y - pos.y, facing.current.get(id) ?? "south"));
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

    // ── Ground tile fill ───────────────────────────────────────────────
    const anyGrass = tilesReady.current ? getAnyGrassTile() : undefined;
    if (anyGrass) {
      // Painter's algorithm: back-to-front so dirt sides overlap correctly.
      // Each cell uses a stable hash-picked variant for visual depth.
      const refH = Math.round(TILE_W * (anyGrass.height / anyGrass.width));
      const tileOrder: Array<[number, number]> = [];
      for (let gy = 0; gy < rows; gy++) {
        for (let gx = 0; gx < cols; gx++) {
          tileOrder.push([gx, gy]);
        }
      }
      tileOrder.sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
      for (const [gx, gy] of tileOrder) {
        const variant = grassVariantIndex(gx, gy);
        const tileImg = getGrassTile(variant) ?? anyGrass;
        const TILE_OVERDRAW = 1.1; // scale each tile slightly larger to close seams
        const drawW = TILE_W * TILE_OVERDRAW;
        const drawH = Math.round(TILE_W * (tileImg.height / tileImg.width) * TILE_OVERDRAW);
        const [tx, ty] = project(gx, gy);
        ctx.drawImage(tileImg, tx - drawW / 2, ty, drawW, drawH);
      }
      void refH; // used only as fallback reference
    } else {
      // Procedural fallback while the tile asset loads.
      for (let gy = 0; gy < rows; gy++) {
        for (let gx = 0; gx < cols; gx++) {
          const h = ((gx * 73856093) ^ (gy * 19349663)) & 0xff;
          const checker = (gx + gy) % 2 === 0;
          const base = checker ? 64 : 54;
          const j = (h % 14) - 7;
          const v = Math.max(34, Math.min(96, base + j));
          ctx.fillStyle = `rgb(${v + 8}, ${v + 4}, ${v - 4})`;
          tracePoly(gx, gy);
          ctx.fill();
        }
      }
    }

    // No explicit grid lines when using tile art — the tile's own edges
    // (dirt sides) provide the visual separation between cells.

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
    // Sort back-to-front so closer tokens occlude farther ones (iso depth = gx + gy).
    // Tiebreaker: dead/corpse tokens render before alive tokens so a live combatant
    // standing on a corpse draws on top instead of being hidden behind it.
    const tokensSorted = [...cbs]
      .filter((c) => c.position)
      .map((c) => {
        const ap = animPos.current.get(c.id);
        const ax = ap ? ap.x : d(c.position!.x);
        const ay = ap ? ap.y : d(c.position!.y);
        return { c, ax, ay };
      })
      .sort((a, b) => {
        const depth = a.ax + a.ay - (b.ax + b.ay);
        if (depth !== 0) return depth;
        const aDead = a.c.hp.current <= 0 ? 0 : 1;
        const bDead = b.c.hp.current <= 0 ? 0 : 1;
        return aDead - bDead;
      });

    let anyDeathActive = false;
    for (const { c, ax, ay } of tokensSorted) {
      const [px, py] = project(ax + 0.5, ay + 0.5);
      // Token visuals fit *inside* the iso diamond they occupy. The diamond is
      // 2:1, so its inscribed disc has radius = TILE_H/2 = TILE_W/4. We use a
      // little less so there's a small margin against the cell border.
      const r = cellSize * 0.22;

      const isPlayer = c.combatantType === "Character";
      const isCurrent = c.id === activeId;
      const isSelected = c.id === selectedCombatantId;
      const isDead = c.hp.current <= 0;
      const isAttackTarget = attackMode && !isPlayer && !isDead;

      // ── Cell-occupancy highlight: draw the iso diamond the token stands on
      // so it's clear which tile they actually occupy. Use faction colors.
      // Anchor on the sprite's *centre* (ax + 0.5, ay + 0.5) so the highlight
      // tracks the visible body during running animation instead of jumping
      // ahead to the destination tile.
      if (!isDead) {
        const cellGx = Math.floor(ax + 0.5);
        const cellGy = Math.floor(ay + 0.5);
        const fillRgba = isPlayer
          ? "rgba(59, 130, 246, 0.28)"  // blue
          : "rgba(239, 68, 68, 0.28)";  // red
        const strokeRgba = isPlayer ? "#60a5fa" : "#f87171";
        ctx.fillStyle = fillRgba;
        tracePoly(cellGx, cellGy);
        ctx.fill();
        ctx.strokeStyle = strokeRgba;
        ctx.lineWidth = isCurrent ? 2.5 : 1.5;
        tracePoly(cellGx, cellGy);
        ctx.stroke();
      }

      // Resolve sprite profile: hero for players, monster lookup for others.
      const monsterProfile = !isPlayer ? getMonsterProfile(c.name) : null;
      const activeProfile = isPlayer ? HERO_PROFILE : monsterProfile;
      const spriteSize = activeProfile ? cellSize * activeProfile.sizeScale : 0;
      const feetOffsetY = activeProfile ? spriteSize * (activeProfile.feetAnchorY - 0.5) : 0;
      // Death animation frame index for monsters with death sprites.
      const deathFrameCount = monsterProfile?.deathAnimationPaths?.length ?? 0;
      const deathFrameMs = monsterProfile?.deathFrameMs ?? 130;
      let deathFrameIndex: number | null = null;
      if (isDead && !isPlayer && deathFrameCount > 0) {
        const deathStart = dyingAnimations.current.get(c.id) ?? null;
        if (deathStart !== null) {
          const elapsed = now - deathStart;
          deathFrameIndex = Math.min(Math.floor(elapsed / deathFrameMs), deathFrameCount - 1);
          if (deathFrameIndex < deathFrameCount - 1) anyDeathActive = true;
        } else {
          deathFrameIndex = deathFrameCount - 1; // already dead — show final (prone) frame
        }
      }
      // Whether we'll draw sprite art (vs. disc fallback).
      // Dead monsters show the death/prone sprite when available.
      const showSpriteOverlay =
        ((isPlayer && spritesReady.current && !isDead) ||
          (!isPlayer && monsterProfile !== null && getMonsterSprites(monsterProfile) !== null &&
            (!isDead || deathFrameIndex !== null)));
      // For sprite-rendered tokens, decorations anchor on the sprite body centre.
      const bodyCx = px;
      const bodyCy = showSpriteOverlay ? py - feetOffsetY : py;
      const bodyR = showSpriteOverlay ? spriteSize * 0.30 : r;

      if (isAttackTarget) {
        ctx.beginPath();
        ctx.arc(bodyCx, bodyCy, bodyR + 5, 0, Math.PI * 2);
        ctx.strokeStyle = "#f97316";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      if (isCurrent) {
        ctx.beginPath();
        ctx.arc(bodyCx, bodyCy, bodyR + 4, 0, Math.PI * 2);
        ctx.strokeStyle = "#f59e0b";
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(bodyCx, bodyCy, bodyR + 8, 0, Math.PI * 2);
        ctx.strokeStyle = "#60a5fa";
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      if (!showSpriteOverlay) {
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
      }

      // Draw sprite art when available.
      if (showSpriteOverlay) {
        const isMoving = animations.current.has(c.id);
        const attackAnim = attackAnimations.current.get(c.id);
        const attackProgress = attackAnim ? (now - attackAnim.startTime) / ATTACK_DURATION_MS : null;
        const isAttacking = attackProgress !== null && attackProgress >= 0 && attackProgress < 1;
        if (attackProgress !== null && attackProgress >= 1) {
          attackAnimations.current.delete(c.id);
        }
        const dir = isAttacking && attackAnim ? attackAnim.facing : (facing.current.get(c.id) ?? "south");
        // Soft contact shadow under the feet — drawn before the sprite so the
        // body occludes the upper edge. Skipped for prone/dead sprites.
        if (!isDead) {
          const shadowRx = spriteSize * 0.20;
          const shadowRy = shadowRx * 0.42;
          const shadowCy = py - spriteSize * 0.04;
          ctx.save();
          ctx.beginPath();
          ctx.ellipse(px, shadowCy, shadowRx, shadowRy, 0, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
          ctx.filter = "blur(2px)";
          ctx.fill();
          ctx.restore();
        }
        if (isPlayer) {
          if (isAttacking && attackProgress !== null) {
            if (!drawHeroAttack(ctx, bodyCx, bodyCy, spriteSize, dir, attackProgress)) {
              drawHeroSprite(ctx, bodyCx, bodyCy, spriteSize, dir, isMoving, now);
            }
          } else {
            drawHeroSprite(ctx, bodyCx, bodyCy, spriteSize, dir, isMoving, now);
          }
        } else if (monsterProfile) {
          drawMonsterSprite(ctx, bodyCx, bodyCy, spriteSize, dir, monsterProfile, {
            running: isMoving && !isDead,
            deathFrameIndex,
            now,
          });
        }
      }

      // Skip HP bar for dead sprite tokens — they're prone on the ground.
      if (!isDead || !showSpriteOverlay) {
        const barW = cellSize * 0.75;
        const barH = 3;
        const barX = bodyCx - barW / 2;
        const barY = bodyCy + bodyR + 4;
        const hpPct = Math.max(0, c.hp.current / c.hp.max);
        ctx.fillStyle = "#1e293b";
        ctx.fillRect(barX, barY, barW, barH);
        ctx.fillStyle = hpPct > 0.5 ? "#22c55e" : hpPct > 0.25 ? "#eab308" : "#ef4444";
        ctx.fillRect(barX, barY, barW * hpPct, barH);
      }
    }

    // Keep looping while tweens or death animations are active; otherwise go idle
    if (animations.current.size > 0 || anyDeathActive || attackAnimations.current.size > 0) {
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
      facing.current.set(combatantId, facingFromIsoGrid(first.x - from.x, first.y - from.y, facing.current.get(combatantId) ?? "south"));
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

  // ── Detect combatant position changes + death transitions → kick off animations ──
  useEffect(() => {
    combatantsRef.current = combatants;
    let hasNew = false;

    for (const c of combatants) {
      // Detect alive→dead HP transition and start death animation.
      const currHp = c.hp?.current ?? 0;
      const wasAlive = (prevHp.current.get(c.id) ?? 1) > 0;
      prevHp.current.set(c.id, currHp);
      if (wasAlive && currHp <= 0 && !dyingAnimations.current.has(c.id)) {
        const profile = getMonsterProfile(c.name);
        if (profile?.deathAnimationPaths?.length) {
          dyingAnimations.current.set(c.id, performance.now());
          hasNew = true;
        }
      }

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
        facing.current.set(c.id, facingFromIsoGrid(to.x - from.x, to.y - from.y, facing.current.get(c.id) ?? "south"));
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

  // ── Attack animation trigger (player heroes only) ────────────────────────
  useEffect(() => {
    if (!lastAttackEvent) return;
    const seqKey = `attack-${lastAttackEvent.seq}`;
    if (lastAttackTriggerId.current === seqKey) return;
    lastAttackTriggerId.current = seqKey;

    const { attackerId, targetId } = lastAttackEvent;
    if (!attackerId) return;
    const attacker = combatantsRef.current.find((c) => c.id === attackerId);
    if (!attacker || attacker.combatantType !== "Character") return; // hero attack frames only

    // Compute facing toward target if known, else keep current facing.
    let attackFacing = facing.current.get(attackerId) ?? "south";
    if (targetId) {
      const target = combatantsRef.current.find((c) => c.id === targetId);
      const aPos = animPos.current.get(attackerId)
        ?? (attacker.position ? { x: d(attacker.position.x), y: d(attacker.position.y) } : null);
      const tPos = target?.position ? { x: d(target.position.x), y: d(target.position.y) } : null;
      if (aPos && tPos) {
        attackFacing = facingFromIsoGrid(tPos.x - aPos.x, tPos.y - aPos.y, attackFacing);
        facing.current.set(attackerId, attackFacing);
      }
    }
    attackAnimations.current.set(attackerId, {
      startTime: performance.now(),
      facing: attackFacing,
    });
    if (rafRef.current === null) rafRef.current = requestAnimationFrame(renderFrame);
  }, [lastAttackEvent, renderFrame]);

  // ── Canvas resize observer + non-passive wheel zoom ────────────────────
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
    // Wheel zoom must use a native non-passive listener so preventDefault works.
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 1 / 1.1 : 1.1;
      const oldZoom = zoom.current;
      const newZoom = Math.max(0.4, Math.min(4, oldZoom * delta));
      if (newZoom === oldZoom) return;
      const cvs = canvasRef.current;
      if (!cvs) return;
      const rect = cvs.getBoundingClientRect();
      const scaleX = cvs.width / rect.width;
      const scaleY = cvs.height / rect.height;
      const ax = (e.clientX - rect.left) * scaleX;
      const ay = (e.clientY - rect.top) * scaleY;
      const k = newZoom / oldZoom;
      pan.current = { x: ax - (ax - pan.current.x) * k, y: ay - (ay - pan.current.y) * k };
      zoom.current = newZoom;
      if (rafRef.current === null) renderFrame();
    }
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      observer.disconnect();
      canvas.removeEventListener("wheel", onWheel);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [renderFrame]);

  // ── Preload static assets once ───────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    loadHeroSprites()
      .then(() => { if (!cancelled) { spritesReady.current = true; if (rafRef.current === null) renderFrame(); } })
      .catch((err) => { console.warn("Failed to load hero sprites:", err); });
    loadIsoTiles()
      .then(() => { if (!cancelled) { tilesReady.current = true; if (rafRef.current === null) renderFrame(); } })
      .catch((err) => { console.warn("Failed to load iso tiles:", err); });
    return () => { cancelled = true; };
  }, [renderFrame]);

  // ── Kick off monster sprite loading for any new combatant name ───────────
  useEffect(() => {
    let cancelled = false;
    for (const c of combatants) {
      const key = c.name.toLowerCase();
      const profile = getMonsterProfile(c.name);
      if (!profile) continue;
      // Skip if already in-cache (handles HMR: ref persists but module cache is
      // cleared on hot-reload, so re-check actual cache state).
      if (monsterSpriteLoaded.current.has(key) && getMonsterSprites(profile) !== null) continue;
      monsterSpriteLoaded.current.add(key);
      loadMonsterSprites(profile)
        .then(() => { if (!cancelled && rafRef.current === null) renderFrame(); })
        .catch((err) => { console.warn("Failed to load monster sprites for", c.name, err); });
    }
    return () => { cancelled = true; };
  }, [combatants, renderFrame]);

  /** Map mouse-event canvas coords to (gx,gy) cell. Returns null if outside. */
  function mouseToCell(e: { clientX: number; clientY: number }): { vcx: number; vcy: number } | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;
    // Iso layout (must match renderFrame, including zoom/pan).
    const TILE_SCALE = 3.5;
    const TILE_W = Math.max(2, Math.floor(
      Math.min(canvas.width / (cols + rows), (canvas.height * 2) / (cols + rows)) * zoom.current * TILE_SCALE,
    ));
    const TILE_H = TILE_W / 2;
    const HALF_W = TILE_W / 2;
    const HALF_H = TILE_H / 2;
    const isoW = (cols + rows) * HALF_W;
    const isoH = (cols + rows) * HALF_H;
    const originX = Math.floor((canvas.width - isoW) / 2 + rows * HALF_W + pan.current.x);
    const originY = Math.floor((canvas.height - isoH) / 2 + pan.current.y);
    const sx = mx - originX;
    const sy = my - originY;
    const gxF = (sx / HALF_W + sy / HALF_H) / 2;
    const gyF = (sy / HALF_H - sx / HALF_W) / 2;
    const vcx = Math.floor(gxF);
    const vcy = Math.floor(gyF);
    if (vcx < 0 || vcx >= cols || vcy < 0 || vcy >= rows) return null;
    return { vcx, vcy };
  }

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    // Suppress click that ended a drag-pan.
    if (dragState.current.moved) {
      dragState.current.moved = false;
      return;
    }
    const cell = mouseToCell(e);
    if (!cell) return;
    const { vcx, vcy } = cell;
    // Hit-test: collect every combatant in this cell, then pick the most
    // relevant one. Bare `find()` would return whatever is first in the array,
    // which is often a corpse a live goblin walked onto — clicking it then
    // sends `attack @id:<dead>` and the server rejects.
    //
    // Priority:
    //   1. In attack mode: alive non-player tokens only (corpses & allies
    //      are not valid attack targets).
    //   2. Otherwise: alive tokens before dead ones (sheet > corpse).
    //   3. Within alive, prefer the active combatant (the click was for them).
    const hits = combatants.filter(
      (c) => c.position && Math.floor(d(c.position.x)) === vcx && Math.floor(d(c.position.y)) === vcy,
    );
    let pick: typeof hits[number] | undefined;
    if (propsRef.current.attackMode) {
      pick = hits.find((c) => c.hp.current > 0 && c.combatantType !== "Character");
    }
    if (!pick) {
      pick = hits.find((c) => c.hp.current > 0 && c.id === activeCombatantIdRef.current)
        ?? hits.find((c) => c.hp.current > 0)
        ?? hits[0];
    }
    if (pick) {
      onTokenTap?.(pick.id);
    } else {
      onCellTap?.(vcx * FEET_PER_CELL, vcy * FEET_PER_CELL);
    }
  }

  // ── Pan / zoom handlers ──────────────────────────────────────────────
  function clampZoom(z: number) {
    return Math.max(0.4, Math.min(4, z));
  }
  function applyZoom(delta: number, anchor?: { x: number; y: number }) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const oldZoom = zoom.current;
    const newZoom = clampZoom(oldZoom * delta);
    if (newZoom === oldZoom) return;
    if (anchor) {
      // Wheel/pinch: keep the world point under the cursor fixed.
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const ax = (anchor.x - rect.left) * scaleX;
      const ay = (anchor.y - rect.top) * scaleY;
      const k = newZoom / oldZoom;
      pan.current = {
        x: ax - (ax - pan.current.x) * k,
        y: ay - (ay - pan.current.y) * k,
      };
    }
    // Button zoom (no anchor): the origin formula already centers the map, so
    // just changing zoom keeps it centered — no pan adjustment needed.
    zoom.current = newZoom;
    if (rafRef.current === null) renderFrame();
  }
  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    // Middle-click, right-click, or shift+left = pan; otherwise leave for click.
    const isPanButton = e.button === 1 || e.button === 2 || (e.button === 0 && e.shiftKey);
    if (!isPanButton) return;
    e.preventDefault();
    canvasRef.current?.setPointerCapture(e.pointerId);
    dragState.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      baseX: pan.current.x,
      baseY: pan.current.y,
      moved: false,
    };
  }
  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!dragState.current.active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const dx = (e.clientX - dragState.current.startX) * scaleX;
    const dy = (e.clientY - dragState.current.startY) * scaleY;
    if (Math.abs(dx) + Math.abs(dy) > 4) dragState.current.moved = true;
    pan.current = { x: dragState.current.baseX + dx, y: dragState.current.baseY + dy };
    if (rafRef.current === null) renderFrame();
  }
  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!dragState.current.active) return;
    canvasRef.current?.releasePointerCapture(e.pointerId);
    dragState.current.active = false;
  }
  function resetView() {
    zoom.current = 1;
    pan.current = { x: 0, y: 0 };
    if (rafRef.current === null) renderFrame();
  }

  return (
    <div className="relative w-full h-full">
      <canvas
        ref={canvasRef}
        className="w-full h-full cursor-pointer touch-none select-none"
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onContextMenu={(e) => e.preventDefault()}
        style={{ display: "block" }}
      />
      {/* Zoom / pan controls */}
      <div className="absolute bottom-3 right-3 flex flex-col gap-1 z-10 pointer-events-auto">
        <button
          type="button"
          onClick={() => applyZoom(1.25)}
          className="w-9 h-9 rounded bg-slate-800/80 hover:bg-slate-700 border border-slate-600 text-slate-100 text-lg leading-none flex items-center justify-center shadow"
          title="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => applyZoom(1 / 1.25)}
          className="w-9 h-9 rounded bg-slate-800/80 hover:bg-slate-700 border border-slate-600 text-slate-100 text-lg leading-none flex items-center justify-center shadow"
          title="Zoom out"
        >
          −
        </button>
        <button
          type="button"
          onClick={resetView}
          className="w-9 h-9 rounded bg-slate-800/80 hover:bg-slate-700 border border-slate-600 text-slate-100 text-xs flex items-center justify-center shadow"
          title="Reset view"
        >
          ⟲
        </button>
      </div>
      <div className="absolute bottom-3 left-3 text-[10px] text-slate-400/70 bg-slate-900/60 rounded px-2 py-1 pointer-events-none select-none">
        scroll = zoom · shift+drag / middle-drag = pan
      </div>
    </div>
  );
});
