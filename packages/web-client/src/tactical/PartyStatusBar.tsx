import { useAppStore } from "../store/app-store";

export function PartyStatusBar() {
  const combatants = useAppStore((s) => s.combatants);
  const openCharacterSheet = useAppStore((s) => s.openCharacterSheet);

  const players = combatants.filter((c) => c.combatantType === "Character");

  if (players.length === 0) return null;

  return (
    <div className="flex gap-2 px-2 py-1.5 bg-slate-900 border-b border-slate-800 overflow-x-auto scrollbar-hide shrink-0">
      {players.map((p) => {
        const hpPct = Math.max(0, Math.min(1, p.hp.current / p.hp.max));
        const hpColor =
          hpPct > 0.5 ? "bg-green-500" : hpPct > 0.25 ? "bg-yellow-500" : "bg-red-500";

        return (
          <button
            key={p.id}
            onClick={() => openCharacterSheet(p.id)}
            className="flex items-center gap-2 bg-slate-800 rounded-lg px-2 py-1 min-w-[100px] shrink-0 hover:bg-slate-700 transition-colors"
          >
            <div className="text-left min-w-0">
              <div className="text-xs font-medium text-slate-100 truncate max-w-[72px]">{p.name}</div>
              <div className="flex items-center gap-1 mt-0.5">
                <div className="w-16 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${hpColor}`}
                    style={{ width: `${hpPct * 100}%` }}
                  />
                </div>
                <span className="text-[10px] text-slate-400 whitespace-nowrap">
                  {p.hp.current}/{p.hp.max}
                </span>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
