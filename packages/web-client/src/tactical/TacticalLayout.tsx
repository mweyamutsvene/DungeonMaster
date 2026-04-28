import { useRef, useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { PartyStatusBar } from "./PartyStatusBar";
import { InitiativeTracker } from "./InitiativeTracker";
import { GridCanvas } from "./GridCanvas";
import type { GridCanvasHandle } from "./GridCanvas";
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
  const handleRollResponse = useAppStore((s) => s.handleRollResponse);
  const addErrorLog = useAppStore((s) => s.addErrorLog);
  const combatants = useAppStore((s) => s.combatants);
  const activeCombatantId = useAppStore((s) => s.activeCombatantId);
  const myCharacterId = useAppStore((s) => s.myCharacterId);
  const encounterId = useAppStore((s) => s.encounterId);
  const combatResult = useAppStore((s) => s.combatResult);

  const [attackMode, setAttackMode] = useState(false);
  const [selectedMoverId, setSelectedMoverId] = useState<string | null>(null);
  const [pathPreview, setPathPreview] = useState<PathPreviewResponse | null>(null);
  const [pathDestination, setPathDestination] = useState<{ x: number; y: number } | null>(null);
  const [moving, setMoving] = useState(false);
  const [loadingPath, setLoadingPath] = useState(false);
  const [attacking, setAttacking] = useState(false);
  const gridRef = useRef<GridCanvasHandle>(null);

  const isLoading = moving || loadingPath || attacking;

  // When combat ends, show overlay then transition to theatre after animations finish.
  useEffect(() => {
    if (!combatResult) return;
    const timer = setTimeout(() => {
      useAppStore.setState({ encounterId: null, mode: "theatre", activeCombatantId: null, combatants: [], combatResult: null });
    }, 4000);
    return () => clearTimeout(timer);
  }, [combatResult]);

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
    setAttacking(true);
    try {
      const response = await gameServer.submitAction(sessionId, {
        text: `attack @id:${target.id}`,
        actorId: myCharacterId,
        encounterId,
      });
      handleRollResponse(response, myCharacterId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addErrorLog(`⚠️ Attack failed: ${msg}`);
      console.error("Attack action failed:", err);
    } finally {
      setAttacking(false);
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
        const response = await gameServer.submitAction(sessionId, {
          text: `move to ${x},${y}`,
          actorId: myCharacterId,
          encounterId,
        });

        if (response.type === "REACTION_CHECK" && response.pendingActionId) {
          // Server is holding the move while reactions resolve.
          // Auto-respond on behalf of all AI-controlled reactors (monsters always use OAs).
          const opportunities = response.opportunityAttacks ?? [];
          for (const opp of opportunities) {
            if (!opp.canAttack) continue;
            try {
              await gameServer.respondToReaction(encounterId, response.pendingActionId, {
                combatantId: opp.combatantId,
                opportunityId: opp.opportunityId,
                choice: "use",
              });
            } catch (err) {
              console.warn("respondToReaction failed for", opp.combatantId, err);
            }
          }
          // Complete the move — server executes OAs and commits the position.
          await gameServer.completeMove(sessionId, { pendingActionId: response.pendingActionId });
        }

        // Animate along the confirmed path then update store position.
        if (pathPreview && gridRef.current) {
          gridRef.current.moveAlongPath(selectedMoverId, pathPreview.path);
        }
        moveCombatant(selectedMoverId, { x, y });
        clearMoveState();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        addErrorLog(`⚠️ Move failed: ${msg}`);
        console.error("Move action failed:", err);
      } finally {
        setMoving(false);
      }
      return;
    }

    try {
      setLoadingPath(true);
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
    } finally {
      setLoadingPath(false);
    }
  }

  return (
    <div className="h-full flex flex-col bg-slate-950 overflow-hidden">
      <PartyStatusBar />
      <InitiativeTracker />

      <div className="flex-1 min-h-0 relative">
        {/* Loading spinner overlay */}
        {isLoading && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/60 pointer-events-none">
            <div className="w-8 h-8 rounded-full border-2 border-slate-600 border-t-amber-400 animate-spin" />
          </div>
        )}
        {/* Combat ended overlay — stays until death animations finish */}
        {combatResult && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center pointer-events-none">
            <div className="bg-slate-900/80 border border-amber-500/60 rounded-2xl px-10 py-8 flex flex-col items-center gap-3 shadow-2xl">
              <div className="text-5xl">
                {combatResult.toLowerCase().includes("victory") || combatResult.toLowerCase().includes("win") ? "⚔️" : "💀"}
              </div>
              <div className="text-amber-300 text-3xl font-bold tracking-wider uppercase">
                {combatResult}
              </div>
              <div className="text-slate-400 text-sm mt-1">Returning to session…</div>
            </div>
          </div>
        )}
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
          ref={gridRef}
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
