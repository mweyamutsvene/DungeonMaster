import { useAppStore } from "../store/app-store";
import { useParams } from "react-router-dom";
import { gameServer } from "../hooks/use-game-server";

interface ActionBarProps {
  attackMode: boolean;
  onAttackSelect: () => void;
  spellsPanelOpen: boolean;
  onSpellsOpen: () => void;
}

export function ActionBar({ attackMode, onAttackSelect, spellsPanelOpen, onSpellsOpen }: ActionBarProps) {
  const combatants = useAppStore((s) => s.combatants);
  const activeCombatantId = useAppStore((s) => s.activeCombatantId);
  const myCharacterId = useAppStore((s) => s.myCharacterId);
  const encounterId = useAppStore((s) => s.encounterId);
  const handleRollResponse = useAppStore((s) => s.handleRollResponse);
  const addErrorLog = useAppStore((s) => s.addErrorLog);
  const { id: sessionId } = useParams<{ id: string }>();

  const activeCombatant = combatants.find((c) => c.id === activeCombatantId);
  const myTurn = !!activeCombatant && !!myCharacterId && activeCombatant.characterId === myCharacterId;
  const ae = activeCombatant?.actionEconomy;
  const actionAvailable = ae?.actionAvailable ?? false;
  const canAct = myTurn && actionAvailable;

  async function doAction(text: string) {
    if (!sessionId || !encounterId || !myCharacterId) return;
    try {
      const response = await gameServer.submitAction(sessionId, { text, actorId: myCharacterId, encounterId });
      handleRollResponse(response, myCharacterId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addErrorLog(`⚠️ ${text} failed: ${msg}`);
      console.error(`Action "${text}" failed:`, err);
    }
  }

  async function handleEndTurn() {
    if (!sessionId || !encounterId || !myCharacterId) return;
    try {
      await gameServer.endTurn(sessionId, encounterId, myCharacterId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addErrorLog(`⚠️ End turn failed: ${msg}`);
      console.error("End turn failed:", err);
    }
  }

  return (
    <div className="flex flex-col gap-1.5 px-2 py-2 bg-slate-900 border-t border-slate-800 shrink-0">
      <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-0.5">
        {/* Attack — enters targeting mode on the canvas */}
        <button
          disabled={!canAct}
          onClick={canAct ? onAttackSelect : undefined}
          className={[
            "flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg text-xs font-medium shrink-0 transition-colors min-w-[56px]",
            attackMode
              ? "bg-orange-600 text-white ring-2 ring-orange-400"
              : !canAct
                ? "bg-slate-800 text-slate-600 cursor-not-allowed"
                : "bg-slate-700 text-slate-200 hover:bg-slate-600 active:bg-slate-500",
          ].join(" ")}
        >
          <span className="text-base leading-none">⚔️</span>
          <span>Attack</span>
        </button>

        {/* Dodge */}
        <button
          disabled={!canAct}
          onClick={() => void doAction("dodge")}
          className={[
            "flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg text-xs font-medium shrink-0 transition-colors min-w-[56px]",
            !canAct
              ? "bg-slate-800 text-slate-600 cursor-not-allowed"
              : "bg-slate-700 text-slate-200 hover:bg-slate-600 active:bg-slate-500",
          ].join(" ")}
        >
          <span className="text-base leading-none">🛡️</span>
          <span>Dodge</span>
        </button>

        {/* Dash */}
        <button
          disabled={!canAct}
          onClick={() => void doAction("dash")}
          className={[
            "flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg text-xs font-medium shrink-0 transition-colors min-w-[56px]",
            !canAct
              ? "bg-slate-800 text-slate-600 cursor-not-allowed"
              : "bg-slate-700 text-slate-200 hover:bg-slate-600 active:bg-slate-500",
          ].join(" ")}
        >
          <span className="text-base leading-none">💨</span>
          <span>Dash</span>
        </button>

        {/* Help */}
        <button
          disabled={!canAct}
          onClick={() => void doAction("help")}
          className={[
            "flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg text-xs font-medium shrink-0 transition-colors min-w-[56px]",
            !canAct
              ? "bg-slate-800 text-slate-600 cursor-not-allowed"
              : "bg-slate-700 text-slate-200 hover:bg-slate-600 active:bg-slate-500",
          ].join(" ")}
        >
          <span className="text-base leading-none">🤝</span>
          <span>Help</span>
        </button>

        {/* Hide */}
        <button
          disabled={!canAct}
          onClick={() => void doAction("hide")}
          className={[
            "flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg text-xs font-medium shrink-0 transition-colors min-w-[56px]",
            !canAct
              ? "bg-slate-800 text-slate-600 cursor-not-allowed"
              : "bg-slate-700 text-slate-200 hover:bg-slate-600 active:bg-slate-500",
          ].join(" ")}
        >
          <span className="text-base leading-none">👁️</span>
          <span>Hide</span>
        </button>

        <div className="h-full w-px bg-slate-700 mx-1 shrink-0" />

        {/* Spells — opens the spell panel */}
        <button
          disabled={!myTurn}
          onClick={myTurn ? onSpellsOpen : undefined}
          className={[
            "flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg text-xs font-medium shrink-0 transition-colors min-w-[56px]",
            spellsPanelOpen
              ? "bg-indigo-600 text-white ring-2 ring-indigo-400"
              : !myTurn
                ? "bg-slate-800 text-slate-600 cursor-not-allowed"
                : "bg-indigo-900/60 text-indigo-300 hover:bg-indigo-900 active:bg-indigo-800",
          ].join(" ")}
        >
          <span className="text-base leading-none">📖</span>
          <span>Spells</span>
        </button>
      </div>

      {myTurn ? (
        <button
          onClick={() => void handleEndTurn()}
          className="w-full bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-slate-950 font-bold py-2 rounded-lg text-sm transition-colors"
        >
          End Turn
        </button>
      ) : (
        <div className="text-center text-slate-500 text-xs py-1">
          {activeCombatant ? `${activeCombatant.name}'s turn…` : "Waiting…"}
        </div>
      )}
    </div>
  );
}
