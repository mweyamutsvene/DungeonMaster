import { useState } from "react";
import { PartyStatusBar } from "./PartyStatusBar";
import { InitiativeTracker } from "./InitiativeTracker";
import { GridCanvas } from "./GridCanvas";
import { ActionEconomyBar } from "./ActionEconomyBar";
import { ActionBar } from "./ActionBar";
import { NarrationLog } from "./NarrationLog";
import { useAppStore } from "../store/app-store";

export function TacticalLayout() {
  const openCharacterSheet = useAppStore((s) => s.openCharacterSheet);
  const [_selectedToken, setSelectedToken] = useState<string | null>(null);

  function handleTokenTap(combatantId: string) {
    setSelectedToken(combatantId);
    // For now just open the sheet; attack targeting comes in the next phase
    openCharacterSheet(combatantId);
  }

  function handleCellTap(_x: number, _y: number) {
    setSelectedToken(null);
    // Movement targeting comes in the next phase
  }

  return (
    <div className="h-full flex flex-col bg-slate-950 overflow-hidden">
      {/* Party HP + initiative strip */}
      <PartyStatusBar />
      <InitiativeTracker />

      {/* Grid — takes all remaining space */}
      <div className="flex-1 min-h-0 relative">
        <GridCanvas onTokenTap={handleTokenTap} onCellTap={handleCellTap} />
      </div>

      {/* Action economy + buttons + log anchored at bottom */}
      <ActionEconomyBar />
      <ActionBar />
      <NarrationLog />
    </div>
  );
}
