import { useRef, useEffect, useCallback } from "react";
import { useAppStore } from "../store/app-store";

// Cell size in px at 1x zoom
const BASE_CELL = 48;

interface GridCanvasProps {
  onCellTap?: (x: number, y: number) => void;
  onTokenTap?: (combatantId: string) => void;
}

export function GridCanvas({ onCellTap, onTokenTap }: GridCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const combatants = useAppStore((s) => s.combatants);
  const currentTurnId = useAppStore((s) => s.currentTurnCombatantId);

  // Determine grid extents from combatant positions
  const cols = Math.max(
    10,
    ...combatants.filter((c) => c.position).map((c) => (c.position?.x ?? 0) + 2)
  );
  const rows = Math.max(
    10,
    ...combatants.filter((c) => c.position).map((c) => (c.position?.y ?? 0) + 2)
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { width, height } = canvas;
    const cellW = width / cols;
    const cellH = height / rows;

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

    // Combatant tokens
    for (const c of combatants) {
      if (!c.position) continue;
      const px = c.position.x * cellW + cellW / 2;
      const py = c.position.y * cellH + cellH / 2;
      const r = Math.min(cellW, cellH) * 0.38;

      const isPlayer = c.entityType === "Character";
      const isCurrent = c.id === currentTurnId;
      const isDead = c.hp.current <= 0;

      // Token ring (active turn highlight)
      if (isCurrent) {
        ctx.beginPath();
        ctx.arc(px, py, r + 4, 0, Math.PI * 2);
        ctx.strokeStyle = "#f59e0b";
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }

      // Token body
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fillStyle = isDead ? "#374151" : isPlayer ? "#3b82f6" : "#ef4444";
      ctx.fill();
      ctx.strokeStyle = isDead ? "#4b5563" : isPlayer ? "#93c5fd" : "#fca5a5";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Token initial
      ctx.fillStyle = isDead ? "#6b7280" : "#ffffff";
      ctx.font = `bold ${Math.round(r * 1.1)}px system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(c.name[0]?.toUpperCase() ?? "?", px, py);

      // HP bar under token
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
  }, [combatants, currentTurnId, cols, rows]);

  // Redraw whenever state changes
  useEffect(() => {
    draw();
  }, [draw]);

  // Resize observer — keep canvas pixel-perfect
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const observer = new ResizeObserver(() => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      draw();
    });
    observer.observe(canvas);
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    draw();

    return () => observer.disconnect();
  }, [draw]);

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const cellW = canvas.width / cols;
    const cellH = canvas.height / rows;
    const gx = Math.floor(mx / cellW);
    const gy = Math.floor(my / cellH);

    // Check if a token was tapped
    const hit = combatants.find((c) => c.position?.x === gx && c.position?.y === gy);
    if (hit) {
      onTokenTap?.(hit.id);
    } else {
      onCellTap?.(gx, gy);
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
}
