import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAppStore } from "../store/app-store";
import { gameServer } from "../hooks/use-game-server";
import { useSSE } from "../hooks/use-sse";
import { TacticalLayout } from "../tactical/TacticalLayout";
import { TheatreLayout } from "../theatre/TheatreLayout";
import { CharacterSheetModal } from "../shared-ui/CharacterSheetModal";
import { ReactionPrompt } from "../shared-ui/ReactionPrompt";
import type { SessionResponse } from "../types/api";

export function SessionPage() {
  const { id: sessionId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const mode = useAppStore((s) => s.mode);
  const encounterId = useAppStore((s) => s.encounterId);
  const tacticalVersion = useAppStore((s) => s.tacticalVersion);
  const setSession = useAppStore((s) => s.setSession);
  const hydrateCombat = useAppStore((s) => s.hydrateCombat);
  const setMode = useAppStore((s) => s.setMode);
  const myCharacterId = useAppStore((s) => s.myCharacterId);
  const setMyCharacterId = useAppStore((s) => s.setMyCharacterId);
  const characterSheetOpen = useAppStore((s) => s.characterSheetOpen);
  const pendingReaction = useAppStore((s) => s.pendingReaction);

  const [loadError, setLoadError] = useState<string | null>(null);
  const [sessionCharacters, setSessionCharacters] = useState<SessionResponse["characters"]>([]);

  // Track the last tacticalVersion we fetched so we skip double-fetches
  const lastFetchedVersionRef = useRef(0);

  useSSE(sessionId ?? null);

  // Bootstrap: verify session, load character list, check for active combat
  useEffect(() => {
    if (!sessionId) return;

    setSession(sessionId);

    (async () => {
      let sessionData: SessionResponse;
      try {
        sessionData = await gameServer.getSession(sessionId);
        setSessionCharacters(sessionData.characters);
      } catch {
        setLoadError("Session not found");
        setTimeout(() => navigate("/"), 2000);
        return;
      }

      try {
        const encounterState = await gameServer.getCombatState(sessionId);
        const isActive =
          encounterState.encounter.status === "Active" ||
          encounterState.encounter.status === "Pending";

        if (isActive) {
          try {
            const tactical = await gameServer.getTacticalView(
              sessionId,
              encounterState.encounter.id,
            );
            hydrateCombat(encounterState, tactical);
          } catch {
            setMode("tactical");
          }
        } else {
          setMode("theatre");
        }
      } catch {
        // 404 = no encounter → theatre mode
        setMode("theatre");
      }
    })();
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fetch tactical view when SSE events bump tacticalVersion (CombatStarted, TurnAdvanced).
  // The store increments tacticalVersion; we do the async fetch here so the store stays pure.
  useEffect(() => {
    if (!sessionId || !encounterId || tacticalVersion === 0) return;
    if (tacticalVersion === lastFetchedVersionRef.current) return;
    lastFetchedVersionRef.current = tacticalVersion;

    (async () => {
      try {
        const [encounterState, tactical] = await Promise.all([
          gameServer.getCombatState(sessionId, encounterId),
          gameServer.getTacticalView(sessionId, encounterId),
        ]);
        hydrateCombat(encounterState, tactical);
      } catch {
        // Non-fatal: state will be stale until next event
      }
    })();
  }, [tacticalVersion, sessionId, encounterId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loadError) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-950">
        <p className="text-red-400">{loadError} — redirecting…</p>
      </div>
    );
  }

  if (mode === null) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-950">
        <div className="flex flex-col items-center gap-3 text-slate-400">
          <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm">Connecting to session…</p>
        </div>
      </div>
    );
  }

  // Character picker — shown once per session until the player claims a character
  if (!myCharacterId && sessionCharacters.length > 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-slate-950 px-4">
        <div className="w-full max-w-sm space-y-4">
          <h2 className="text-xl font-bold text-amber-500 text-center">Who are you playing?</h2>
          <p className="text-slate-400 text-sm text-center">Pick your character for this session.</p>
          <div className="space-y-2">
            {sessionCharacters.map((c) => (
              <button
                key={c.id}
                onClick={() => setMyCharacterId(c.id)}
                className="w-full flex items-center gap-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-amber-500 rounded-xl px-4 py-3 text-left transition-colors"
              >
                <div className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-sm shrink-0">
                  {c.name[0]?.toUpperCase()}
                </div>
                <div>
                  <p className="text-slate-100 font-medium">{c.name}</p>
                  <p className="text-slate-400 text-xs">
                    {c.class} · Level {c.level}
                  </p>
                </div>
              </button>
            ))}
          </div>
          <button
            onClick={() => setMyCharacterId("")}
            className="w-full text-slate-500 text-sm py-2 hover:text-slate-400 transition-colors"
          >
            Join as observer (no character)
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full relative">
      {mode === "tactical" ? <TacticalLayout /> : <TheatreLayout />}
      {characterSheetOpen && <CharacterSheetModal />}
      {pendingReaction && <ReactionPrompt />}
    </div>
  );
}
