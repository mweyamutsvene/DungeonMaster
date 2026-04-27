import { useAppStore } from "../store/app-store";
import { useParams } from "react-router-dom";
import { gameServer } from "../hooks/use-game-server";

interface ActionDef {
  id: string;
  label: string;
  icon: string;
  type: "action" | "bonus" | "free";
  disabled?: boolean;
}

export function ActionBar() {
  const combatants = useAppStore((s) => s.combatants);
  const currentTurnId = useAppStore((s) => s.currentTurnCombatantId);
  const myCharacterId = useAppStore((s) => s.myCharacterId);
  const encounterId = useAppStore((s) => s.encounterId);
  const { id: sessionId } = useParams<{ id: string }>();

  const myTurn =
    !!currentTurnId &&
    combatants.find((c) => c.id === currentTurnId)?.entityId === myCharacterId;

  const current = combatants.find((c) => c.id === currentTurnId);
  const res = current?.resources;

  const actions: ActionDef[] = [
    { id: "attack", label: "Attack", icon: "⚔️", type: "action", disabled: !res?.actionAvailable },
    { id: "dodge", label: "Dodge", icon: "🛡️", type: "action", disabled: !res?.actionAvailable },
    { id: "dash", label: "Dash", icon: "💨", type: "action", disabled: !res?.actionAvailable },
    { id: "help", label: "Help", icon: "🤝", type: "action", disabled: !res?.actionAvailable },
    { id: "hide", label: "Hide", icon: "👁️", type: "action", disabled: !res?.actionAvailable },
  ];

  async function handleEndTurn() {
    if (!sessionId || !encounterId) return;
    try {
      await gameServer.endTurn(sessionId, encounterId);
    } catch (err) {
      console.error("End turn failed:", err);
    }
  }

  return (
    <div className="flex flex-col gap-1.5 px-2 py-2 bg-slate-900 border-t border-slate-800 shrink-0">
      {/* Action buttons */}
      <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-0.5">
        {actions.map((a) => (
          <button
            key={a.id}
            disabled={!myTurn || a.disabled}
            className={[
              "flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg text-xs font-medium shrink-0 transition-colors min-w-[56px]",
              !myTurn || a.disabled
                ? "bg-slate-800 text-slate-600 cursor-not-allowed"
                : "bg-slate-700 text-slate-200 hover:bg-slate-600 active:bg-slate-500",
            ].join(" ")}
          >
            <span className="text-base leading-none">{a.icon}</span>
            <span>{a.label}</span>
          </button>
        ))}

        <div className="h-full w-px bg-slate-700 mx-1 shrink-0" />

        {/* Spells placeholder */}
        <button
          disabled={!myTurn}
          className={[
            "flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg text-xs font-medium shrink-0 transition-colors min-w-[56px]",
            !myTurn
              ? "bg-slate-800 text-slate-600 cursor-not-allowed"
              : "bg-indigo-900/60 text-indigo-300 hover:bg-indigo-900 active:bg-indigo-800",
          ].join(" ")}
        >
          <span className="text-base leading-none">📖</span>
          <span>Spells</span>
        </button>
      </div>

      {/* End turn */}
      {myTurn && (
        <button
          onClick={handleEndTurn}
          className="w-full bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-slate-950 font-bold py-2 rounded-lg text-sm transition-colors"
        >
          End Turn
        </button>
      )}

      {!myTurn && (
        <div className="text-center text-slate-500 text-xs py-1">
          {current ? `${current.name}'s turn…` : "Waiting…"}
        </div>
      )}
    </div>
  );
}
