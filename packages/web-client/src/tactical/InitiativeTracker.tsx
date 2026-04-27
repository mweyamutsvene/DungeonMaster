import { useAppStore } from "../store/app-store";

export function InitiativeTracker() {
  const combatants = useAppStore((s) => s.combatants);
  const currentTurnId = useAppStore((s) => s.currentTurnCombatantId);
  const round = useAppStore((s) => s.round);

  const sorted = [...combatants].sort((a, b) => (b.initiative ?? 0) - (a.initiative ?? 0));

  return (
    <div className="flex items-center gap-0 px-2 py-1 bg-slate-900/80 border-b border-slate-800 shrink-0">
      <span className="text-[10px] text-slate-500 uppercase tracking-wider mr-2 shrink-0">
        Rnd {round}
      </span>
      <div className="flex gap-1.5 overflow-x-auto scrollbar-hide">
        {sorted.map((c) => {
          const isCurrent = c.id === currentTurnId;
          const isEnemy = c.entityType !== "Character";
          const isDead = c.hp.current <= 0;

          return (
            <div
              key={c.id}
              className={[
                "flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium shrink-0 transition-all",
                isCurrent
                  ? "bg-amber-500 text-slate-950 scale-105"
                  : isEnemy
                  ? "bg-slate-700 text-red-300"
                  : "bg-slate-700 text-slate-200",
                isDead && "opacity-40 line-through",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {isCurrent && <span className="text-[8px]">▶</span>}
              <span>{c.name}</span>
              {c.initiative !== undefined && (
                <span className={isCurrent ? "text-slate-800" : "text-slate-400"}>
                  ({c.initiative})
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
