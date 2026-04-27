import { useAppStore } from "../store/app-store";

export function ActionEconomyBar() {
  const combatants = useAppStore((s) => s.combatants);
  const currentTurnId = useAppStore((s) => s.currentTurnCombatantId);
  const myCharacterId = useAppStore((s) => s.myCharacterId);

  // Show economy for either the local player's combatant or whoever's turn it is
  const mine = combatants.find(
    (c) => c.entityId === myCharacterId || c.id === currentTurnId
  );

  const res = mine?.resources;
  if (!mine || !res) {
    return (
      <div className="flex items-center justify-center px-3 py-1.5 bg-slate-900 border-t border-slate-800 text-slate-600 text-xs shrink-0">
        Waiting for combat…
      </div>
    );
  }

  const movePct = Math.max(0, res.movementRemaining / (res.movementMax || 30));

  return (
    <div className="flex items-center gap-3 px-3 py-1.5 bg-slate-900 border-t border-slate-800 shrink-0">
      <Pip label="Action" used={!res.actionAvailable} color="amber" />
      <Pip label="Bonus" used={!res.bonusActionAvailable} color="sky" />
      <Pip label="React" used={!res.reactionAvailable} color="violet" />

      <div className="flex items-center gap-1.5 ml-auto">
        <span className="text-[10px] text-slate-400 uppercase tracking-wider">Move</span>
        <div className="w-20 h-1.5 bg-slate-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-500 rounded-full transition-all"
            style={{ width: `${movePct * 100}%` }}
          />
        </div>
        <span className="text-[10px] text-slate-300 tabular-nums">
          {res.movementRemaining}ft
        </span>
      </div>
    </div>
  );
}

function Pip({ label, used, color }: { label: string; used: boolean; color: "amber" | "sky" | "violet" }) {
  const active = {
    amber: "bg-amber-500",
    sky: "bg-sky-500",
    violet: "bg-violet-500",
  }[color];

  return (
    <div className="flex items-center gap-1">
      <div
        className={[
          "w-2.5 h-2.5 rounded-full border",
          used ? "bg-slate-700 border-slate-600" : `${active} border-transparent`,
        ].join(" ")}
      />
      <span className={["text-[10px] uppercase tracking-wider", used ? "text-slate-600" : "text-slate-300"].join(" ")}>
        {label}
      </span>
    </div>
  );
}
