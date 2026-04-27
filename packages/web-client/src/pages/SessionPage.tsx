import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAppStore } from "../store/app-store";
import { gameServer } from "../hooks/use-game-server";
import { useSSE } from "../hooks/use-sse";
import { TacticalLayout } from "../tactical/TacticalLayout";
import { TheatreLayout } from "../theatre/TheatreLayout";
import { CharacterSheetModal } from "../shared-ui/CharacterSheetModal";
import { ReactionPrompt } from "../shared-ui/ReactionPrompt";

export function SessionPage() {
  const { id: sessionId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const mode = useAppStore((s) => s.mode);
  const setSession = useAppStore((s) => s.setSession);
  const hydrateTacticalView = useAppStore((s) => s.hydrateTacticalView);
  const setMode = useAppStore((s) => s.setMode);
  const characterSheetOpen = useAppStore((s) => s.characterSheetOpen);
  const pendingReaction = useAppStore((s) => s.pendingReaction);

  const [loadError, setLoadError] = useState<string | null>(null);

  // Connect SSE for this session
  useSSE(sessionId ?? null);

  // Bootstrap: fetch session + any active encounter
  useEffect(() => {
    if (!sessionId) return;

    setSession(sessionId);

    (async () => {
      try {
        await gameServer.getSession(sessionId);

        // Check for an active encounter
        try {
          const { encounters } = await gameServer.getEncounters(sessionId);
          const active = encounters.find((e) => e.status === "Active");
          if (active) {
            const tactical = await gameServer.getTacticalView(sessionId, active.id);
            hydrateTacticalView(tactical);
          } else {
            setMode("theatre");
          }
        } catch {
          // No encounters endpoint yet or none active — go theatre
          setMode("theatre");
        }
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Session not found");
        setTimeout(() => navigate("/"), 2000);
      }
    })();
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

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

  return (
    <div className="h-full relative">
      {mode === "tactical" ? <TacticalLayout /> : <TheatreLayout />}

      {characterSheetOpen && <CharacterSheetModal />}
      {pendingReaction && <ReactionPrompt />}
    </div>
  );
}
