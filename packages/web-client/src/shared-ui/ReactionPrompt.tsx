import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../store/app-store";
import { gameServer } from "../hooks/use-game-server";

type OaPhase = "prompt" | "oa-attack" | "oa-damage";

export function ReactionPrompt() {
  const pendingReaction = useAppStore((s) => s.pendingReaction);
  const dismissReaction = useAppStore((s) => s.dismissReaction);
  const sessionId = useAppStore((s) => s.sessionId);

  const [secondsLeft, setSecondsLeft] = useState<number>(10);
  const [phase, setPhase] = useState<OaPhase>("prompt");
  const [rollInput, setRollInput] = useState("");
  const [rollError, setRollError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const rollInputRef = useRef<HTMLInputElement>(null);

  // Reset phase when a new reaction comes in.
  useEffect(() => {
    setPhase("prompt");
    setRollInput("");
    setRollError(null);
  }, [pendingReaction?.pendingActionId]);

  // Auto-focus the roll input when entering a roll phase.
  useEffect(() => {
    if ((phase === "oa-attack" || phase === "oa-damage") && rollInputRef.current) {
      rollInputRef.current.focus();
    }
  }, [phase]);

  useEffect(() => {
    if (!pendingReaction || phase !== "prompt") return;

    const expiresAt = new Date(pendingReaction.expiresAt).getTime();
    const updateTimer = () => {
      const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining <= 0) dismissReaction();
    };

    updateTimer();
    const interval = setInterval(updateTimer, 250);
    return () => clearInterval(interval);
  }, [pendingReaction, dismissReaction, phase]);

  if (!pendingReaction) return null;

  const { reactionOpportunity, actorName, pendingActionId, encounterId, combatantId } = pendingReaction;
  const expiresAt = new Date(pendingReaction.expiresAt).getTime();
  const totalMs = 10_000;
  const progressPct = Math.max(0, Math.min(1, (expiresAt - Date.now()) / totalMs));
  const isOaReaction = reactionOpportunity.reactionType === "opportunity_attack";

  function reactionDescription(reactionType: string, triggerName: string): string {
    switch (reactionType) {
      case "opportunity_attack":
        return `${triggerName} is moving away from you — make an opportunity attack!`;
      case "shield_spell":
        return `${triggerName}'s attack is about to hit you — cast Shield to raise your AC by 5!`;
      case "deflect_missiles":
        return `${triggerName} hit you with a ranged weapon — use Deflect Missiles to reduce the damage!`;
      case "uncanny_dodge":
        return `${triggerName} is attacking you — use Uncanny Dodge to halve the damage!`;
      case "parry":
        return `${triggerName} is attacking you — use Parry to reduce the damage!`;
      default: {
        const label = reactionType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        return `${triggerName} triggered your ${label} reaction.`;
      }
    }
  }

  async function respond(choice: "use" | "decline") {
    try {
      await gameServer.respondToReaction(encounterId, pendingActionId, {
        combatantId,
        opportunityId: reactionOpportunity.id,
        choice,
      });
    } catch {
      // server will auto-decline on timeout anyway
    }

    if (choice === "use" && isOaReaction) {
      // Enter OA roll phase instead of dismissing.
      setRollInput("");
      setRollError(null);
      setPhase("oa-attack");
      return;
    }

    dismissReaction();
  }

  async function submitOaRoll() {
    const roll = parseInt(rollInput, 10);
    if (isNaN(roll) || roll < 1 || roll > 20) {
      setRollError("Enter a number between 1 and 20.");
      return;
    }
    if (!sessionId) {
      setRollError("Session not found.");
      return;
    }

    setSubmitting(true);
    setRollError(null);
    try {
      const result = await gameServer.completeMove(sessionId, {
        pendingActionId,
        roll,
        rollType: "opportunity_attack",
      });

      if (result.requiresPlayerInput && result.rollType === "opportunity_attack_damage") {
        setRollInput("");
        setPhase("oa-damage");
      } else {
        dismissReaction();
      }
    } catch (err) {
      setRollError(err instanceof Error ? err.message : "Roll failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitOaDamage() {
    const roll = parseInt(rollInput, 10);
    if (isNaN(roll) || roll < 1) {
      setRollError("Enter a valid damage roll (1 or higher).");
      return;
    }
    if (!sessionId) {
      setRollError("Session not found.");
      return;
    }

    setSubmitting(true);
    setRollError(null);
    try {
      await gameServer.completeMove(sessionId, {
        pendingActionId,
        roll,
        rollType: "opportunity_attack_damage",
      });
      dismissReaction();
    } catch (err) {
      setRollError(err instanceof Error ? err.message : "Roll failed.");
    } finally {
      setSubmitting(false);
    }
  }

  // --- OA attack roll phase ---
  if (phase === "oa-attack") {
    return (
      <div className="absolute inset-0 bg-slate-950/70 flex items-center justify-center z-50 p-4">
        <div className="bg-slate-800 rounded-2xl border border-orange-600 w-full max-w-xs p-5 space-y-4 shadow-2xl">
          <div className="flex items-center gap-2">
            <span className="text-xl">⚔️</span>
            <h3 className="text-base font-bold text-orange-300">Opportunity Attack!</h3>
          </div>
          <p className="text-sm text-slate-300">
            Roll your d20 attack against{" "}
            <span className="text-amber-400 font-medium">{actorName}</span>.
          </p>
          <input
            ref={rollInputRef}
            type="number"
            min={1}
            max={20}
            value={rollInput}
            onChange={(e) => setRollInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void submitOaRoll(); }}
            placeholder="d20 result"
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
          />
          {rollError && <p className="text-red-400 text-xs">{rollError}</p>}
          <button
            onClick={() => void submitOaRoll()}
            disabled={submitting}
            className="w-full bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white font-bold py-2.5 rounded-xl text-sm transition-colors"
          >
            {submitting ? "Rolling…" : "Roll Attack"}
          </button>
        </div>
      </div>
    );
  }

  // --- OA damage roll phase ---
  if (phase === "oa-damage") {
    return (
      <div className="absolute inset-0 bg-slate-950/70 flex items-center justify-center z-50 p-4">
        <div className="bg-slate-800 rounded-2xl border border-red-600 w-full max-w-xs p-5 space-y-4 shadow-2xl">
          <div className="flex items-center gap-2">
            <span className="text-xl">💥</span>
            <h3 className="text-base font-bold text-red-300">OA Hit! Roll Damage</h3>
          </div>
          <p className="text-sm text-slate-300">
            Your attack hit <span className="text-amber-400 font-medium">{actorName}</span>!
            Roll your weapon damage dice.
          </p>
          <input
            ref={rollInputRef}
            type="number"
            min={1}
            value={rollInput}
            onChange={(e) => setRollInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void submitOaDamage(); }}
            placeholder="damage dice total"
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-red-500"
          />
          {rollError && <p className="text-red-400 text-xs">{rollError}</p>}
          <button
            onClick={() => void submitOaDamage()}
            disabled={submitting}
            className="w-full bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold py-2.5 rounded-xl text-sm transition-colors"
          >
            {submitting ? "Dealing damage…" : "Roll Damage"}
          </button>
        </div>
      </div>
    );
  }

  // --- Initial reaction prompt ---
  return (
    <div className="absolute inset-0 bg-slate-950/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-2xl border border-violet-700 w-full max-w-xs p-5 space-y-4 shadow-2xl">
        <div className="flex items-center gap-2">
          <span className="text-xl">⚡</span>
          <h3 className="text-base font-bold text-violet-300">Reaction Available!</h3>
        </div>

        <div className="text-sm text-slate-300 space-y-1">
          <p>{reactionDescription(reactionOpportunity.reactionType, actorName)}</p>
          <p className="text-slate-400 text-xs">
            Type:{" "}
            <span className="text-violet-300 font-medium">
              {reactionOpportunity.reactionType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
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
