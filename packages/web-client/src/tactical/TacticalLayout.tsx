import { useState } from "react";
import { useParams } from "react-router-dom";
import { PartyStatusBar } from "./PartyStatusBar";
import { InitiativeTracker } from "./InitiativeTracker";
import { GridCanvas } from "./GridCanvas";
import { ActionEconomyBar } from "./ActionEconomyBar";
import { ActionBar } from "./ActionBar";
import { NarrationLog } from "./NarrationLog";
import { useAppStore } from "../store/app-store";
import { gameServer } from "../hooks/use-game-server";

export function TacticalLayout() {
  const { id: sessionId } = useParams<{ id: string }>();
  const openCharacterSheet = useAppStore((s) => s.openCharacterSheet);
  const combatants = useAppStore((s) => s.combatants);
  const myCharacterId = useAppStore((s) => s.myCharacterId);
  const encounterId = useAppStore((s) => s.encounterId);

  const [attackMode, setAttackMode] = useState(false);

  async function handleAttackToken(combatantId: string) {
    const target = combatants.find((c) => c.id === combatantId);
    if (!target || !sessionId || !encounterId || !myCharacterId) return;
    setAttackMode(false);
    try {
      await gameServer.submitAction(sessionId, {
        text: `attack ${target.name}`,
        actorId: myCharacterId,
        encounterId,
      });
    } catch (err) {
      console.error("Attack action failed:", err);
    }
  }

  function handleTokenTap(combatantId: string) {
    const target = combatants.find((c) => c.id === combatantId);
    if (attackMode && target && target.combatantType !== "Character") {
      void handleAttackToken(combatantId);
    } else {
      setAttackMode(false);
      openCharacterSheet(combatantId);
    }
  }

  function handleCellTap(_x: number, _y: number) {
    // Cancel any pending targeting mode on empty cell tap
    if (attackMode) setAttackMode(false);
  }

  return (
    <div className="h-full flex flex-col bg-slate-950 overflow-hidden">
      <PartyStatusBar />
      <InitiativeTracker />

      <div className="flex-1 min-h-0 relative">
        {attackMode && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 bg-red-900/80 border border-red-500 rounded-lg px-3 py-1 text-red-200 text-xs font-medium pointer-events-none">
            Tap an enemy to attack
          </div>
        )}
        <GridCanvas
          onTokenTap={handleTokenTap}
          onCellTap={handleCellTap}
          attackMode={attackMode}
        />
      </div>

      <ActionEconomyBar />
      <ActionBar attackMode={attackMode} onAttackSelect={() => setAttackMode(true)} />
      <NarrationLog />
    </div>
  );
}
