import { useRef, useEffect, useCallback } from "react";
import { useAppStore } from "../store/app-store";

interface GridCanvasProps {
  onCellTap?: (x: number, y: number) => void;
  onTokenTap?: (combatantId: string) => void;
  attackMode?: boolean;
}

export function GridCanvas({ onCellTap, onTokenTap, attackMode = false }: GridCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const combatants = useAppStore((s) => s.combatants);
  const activeCombatantId = useAppStore((s) => s.activeCombatantId);

  const positioned = combatants.filter((c) => c.position !== null);
  const cols = Math.max(10, ...positioned.map((c) => (c.position?.x ?? 0) + 2));
  const rows = Math.max(10, ...positioned.map((c) => (c.position?.y ?? 0) + 2));

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { width, height } = canvas;
    const cellW = width / cols;
    const cellH = height / rows;

    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, width, height);

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

    for (const c of combatants) {
      if (!c.position) continue;
      const px = c.position.x * cellW + cellW / 2;
      const py = c.position.y * cellH + cellH / 2;
      const r = Math.min(cellW, cellH) * 0.38;

      const isPlayer = c.combatantType === "Character";
      const isCurrent = c.id === activeCombatantId;
      const isDead = c.hp.current <= 0;
      const isAttackTarget = attackMode && !isPlayer && !isDead;

      // Pulse ring for valid attack targets
      if (isAttackTarget) {
        ctx.beginPath();
        ctx.arc(px, py, r + 5, 0, Math.PI * 2);
        ctx.strokeStyle = "#f97316";
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Active turn ring
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
  }, [combatants, activeCombatantId, cols, rows, attackMode]);

  useEffect(() => {
    draw();
  }, [draw]);

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
