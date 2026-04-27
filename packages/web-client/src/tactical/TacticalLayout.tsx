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
import type { PathPreviewResponse } from "../types/api";

export function TacticalLayout() {
  const { id: sessionId } = useParams<{ id: string }>();
  const openCharacterSheet = useAppStore((s) => s.openCharacterSheet);
  const moveCombatant = useAppStore((s) => s.moveCombatant);
  const combatants = useAppStore((s) => s.combatants);
  const activeCombatantId = useAppStore((s) => s.activeCombatantId);
  const myCharacterId = useAppStore((s) => s.myCharacterId);
  const encounterId = useAppStore((s) => s.encounterId);

  const [attackMode, setAttackMode] = useState(false);
  const [selectedMoverId, setSelectedMoverId] = useState<string | null>(null);
  const [pathPreview, setPathPreview] = useState<PathPreviewResponse | null>(null);
  const [pathDestination, setPathDestination] = useState<{ x: number; y: number } | null>(null);
  const [moving, setMoving] = useState(false);

  const activeCombatant = combatants.find((c) => c.id === activeCombatantId);
  const myTurn = !!activeCombatant && !!myCharacterId && activeCombatant.characterId === myCharacterId;
  const movementBudget = activeCombatant?.actionEconomy.movementRemainingFeet ?? 0;

  function clearMoveState() {
    setSelectedMoverId(null);
    setPathPreview(null);
    setPathDestination(null);
  }

  async function handleAttackToken(combatantId: string) {
    const target = combatants.find((c) => c.id === combatantId);
    if (!target || !sessionId || !encounterId || !myCharacterId) return;
    setAttackMode(false);
    clearMoveState();
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
    if (!target) return;

    if (attackMode && target && target.combatantType !== "Character") {
      void handleAttackToken(combatantId);
      return;
    }

    const isMyActiveCombatant = myTurn && target.id === activeCombatantId && target.characterId === myCharacterId;
    if (isMyActiveCombatant) {
      setAttackMode(false);
      setSelectedMoverId((prev) => (prev === target.id ? null : target.id));
      setPathPreview(null);
      setPathDestination(null);
    } else {
      setAttackMode(false);
      clearMoveState();
      openCharacterSheet(combatantId);
    }
  }

  async function handleCellTap(x: number, y: number) {
    // Cancel attack mode when tapping empty cells.
    if (attackMode) {
      setAttackMode(false);
      return;
    }

    if (!myTurn || !sessionId || !encounterId || !selectedMoverId || moving) return;
    const mover = combatants.find((c) => c.id === selectedMoverId);
    if (!mover?.position || movementBudget <= 0) return;

    const confirmingExistingDestination =
      pathDestination?.x === x &&
      pathDestination?.y === y &&
      !!pathPreview &&
      !pathPreview.blocked &&
      pathPreview.path.length > 0;

    if (confirmingExistingDestination) {
      setMoving(true);
      try {
        await gameServer.submitAction(sessionId, {
          text: `move to ${x},${y}`,
          actorId: myCharacterId,
          encounterId,
        });
        // Optimistic position update — SSE Move event will confirm later
        moveCombatant(selectedMoverId, { x, y });
        clearMoveState();
      } catch (err) {
        console.error("Move action failed:", err);
      } finally {
        setMoving(false);
      }
      return;
    }

    try {
      const preview = await gameServer.previewPath(sessionId, encounterId, {
        from: mover.position,
        to: { x, y },
        maxCostFeet: movementBudget,
      });
      setPathPreview(preview);
      setPathDestination({ x, y });
    } catch (err) {
      console.error("Path preview failed:", err);
      setPathPreview(null);
      setPathDestination(null);
    }
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
        {!attackMode && selectedMoverId && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 bg-blue-900/80 border border-blue-400 rounded-lg px-3 py-1 text-blue-100 text-xs font-medium pointer-events-none">
            Tap destination cell to preview, tap same cell again to move
          </div>
        )}
        <GridCanvas
          onTokenTap={handleTokenTap}
          onCellTap={handleCellTap}
          attackMode={attackMode}
          selectedCombatantId={selectedMoverId}
          movementPath={pathPreview?.path ?? []}
          movementDestination={pathDestination}
          movementBlocked={pathPreview?.blocked ?? false}
        />
      </div>

      <ActionEconomyBar />
      <ActionBar
        attackMode={attackMode}
        onAttackSelect={() => {
          clearMoveState();
          setAttackMode(true);
        }}
      />
      <NarrationLog />
    </div>
  );
}
