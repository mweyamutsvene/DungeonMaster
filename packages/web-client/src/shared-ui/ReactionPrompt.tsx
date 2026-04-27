import { useEffect, useState } from "react";
import { useAppStore } from "../store/app-store";
import { gameServer } from "../hooks/use-game-server";

export function ReactionPrompt() {
  const pendingReaction = useAppStore((s) => s.pendingReaction);
  const dismissReaction = useAppStore((s) => s.dismissReaction);

  const [secondsLeft, setSecondsLeft] = useState<number>(10);

  useEffect(() => {
    if (!pendingReaction) return;

    const expiresAt = new Date(pendingReaction.expiresAt).getTime();
    const updateTimer = () => {
      const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining <= 0) dismissReaction();
    };

    updateTimer();
    const interval = setInterval(updateTimer, 250);
    return () => clearInterval(interval);
  }, [pendingReaction, dismissReaction]);

  if (!pendingReaction) return null;

  const { reactionOpportunity, actorName, pendingActionId, encounterId, combatantId } = pendingReaction;
  const expiresAt = new Date(pendingReaction.expiresAt).getTime();
  const totalMs = 10_000;
  const progressPct = Math.max(0, Math.min(1, (expiresAt - Date.now()) / totalMs));

  async function respond(choice: "use" | "decline") {
    try {
      await gameServer.respondToReaction(encounterId, pendingActionId, combatantId, choice);
    } catch {
      // server will auto-decline on timeout anyway
    }
    dismissReaction();
  }

  return (
    <div className="absolute inset-0 bg-slate-950/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-2xl border border-violet-700 w-full max-w-xs p-5 space-y-4 shadow-2xl">
        <div className="flex items-center gap-2">
          <span className="text-xl">⚡</span>
          <h3 className="text-base font-bold text-violet-300">Reaction Available!</h3>
        </div>

        <div className="text-sm text-slate-300 space-y-1">
          <p>
            <span className="text-amber-400 font-medium">{actorName}</span> is moving away —
            you have a reaction opportunity.
          </p>
          <p className="text-slate-400 text-xs">
            Type:{" "}
            <span className="text-violet-300 font-medium">
              {reactionOpportunity.reactionType.replace(/([A-Z])/g, " $1").trim()}
            </span>
            {reactionOpportunity.oaType === "spell" && (
              <span className="ml-1 text-indigo-400">(spell)</span>
            )}
            {!reactionOpportunity.canUse && reactionOpportunity.reason && (
              <span className="block text-red-400 mt-0.5">{reactionOpportunity.reason}</span>
            )}
          </p>
        </div>

        <div>
          <div className="flex justify-between text-xs text-slate-400 mb-1">
            <span>Auto-decline in</span>
            <span className="tabular-nums font-medium text-slate-300">{secondsLeft}s</span>
          </div>
          <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-violet-500 rounded-full transition-all duration-250"
              style={{ width: `${progressPct * 100}%` }}
            />
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => void respond("use")}
            className="flex-1 bg-violet-600 hover:bg-violet-500 text-white font-bold py-2.5 rounded-xl text-sm transition-colors"
          >
            Use Reaction
          </button>
          <button
            onClick={() => void respond("decline")}
            className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-300 font-medium py-2.5 rounded-xl text-sm transition-colors"
          >
            Decline
          </button>
        </div>
      </div>
    </div>
  );
}
