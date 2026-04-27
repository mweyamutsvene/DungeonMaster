import { useState, useCallback } from "react";
import { useAppStore } from "../store/app-store";
import { gameServer } from "../hooks/use-game-server";
import { useParams } from "react-router-dom";

// ── Dice utility ─────────────────────────────────────────────────────────────

interface ParsedDice {
  rolls: number;
  sides: number;
  modifier: number;
}

function parseDiceNotation(notation: string): ParsedDice {
  const match = notation.trim().match(/^(\d*)d(\d+)([+-]\d+)?$/i);
  if (!match) return { rolls: 1, sides: 20, modifier: 0 };
  return {
    rolls: parseInt(match[1] || "1", 10),
    sides: parseInt(match[2] || "20", 10),
    modifier: parseInt(match[3] || "0", 10),
  };
}

function rollDice(notation: string): { total: number; breakdown: string } {
  const { rolls, sides, modifier } = parseDiceNotation(notation);
  const results: number[] = [];
  for (let i = 0; i < rolls; i++) {
    results.push(Math.floor(Math.random() * sides) + 1);
  }
  const subtotal = results.reduce((a, b) => a + b, 0);
  const total = subtotal + modifier;
  const rollsStr = results.length === 1 ? `${results[0]}` : `(${results.join("+")})`;
  const modStr = modifier > 0 ? ` + ${modifier}` : modifier < 0 ? ` - ${Math.abs(modifier)}` : "";
  const breakdown = modifier !== 0 ? `${rollsStr}${modStr} = ${total}` : rollsStr;
  return { total, breakdown };
}

function rollTypeLabel(rollType: string): string {
  switch (rollType) {
    case "initiative": return "Roll Initiative";
    case "attack": return "Roll Attack";
    case "damage": return "Roll Damage";
    case "opportunity_attack": return "Roll Opportunity Attack";
    case "opportunity_attack_damage": return "Roll Opportunity Attack Damage";
    default: return "Roll Dice";
  }
}

function diceEmoji(rollType: string): string {
  switch (rollType) {
    case "initiative": return "⚡";
    case "attack":
    case "opportunity_attack": return "⚔️";
    case "damage":
    case "opportunity_attack_damage": return "💥";
    default: return "🎲";
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function DiceRollModal() {
  const { id: sessionId } = useParams<{ id: string }>();
  const pendingRoll = useAppStore((s) => s.pendingRoll);
  const handleRollResponse = useAppStore((s) => s.handleRollResponse);
  const setPendingRoll = useAppStore((s) => s.setPendingRoll);

  const [rolled, setRolled] = useState<{ total: number; breakdown: string } | null>(null);
  const [customValue, setCustomValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRoll = useCallback(() => {
    if (!pendingRoll) return;
    const notation = pendingRoll.diceNeeded ?? "d20";
    const result = rollDice(notation);
    setRolled(result);
    setCustomValue(String(result.total));
    setError(null);
  }, [pendingRoll]);

  const handleSubmit = useCallback(async () => {
    if (!sessionId || !pendingRoll || submitting) return;
    const rawValue = customValue.trim();
    const value = parseInt(rawValue, 10);
    if (isNaN(value) || value < 1) {
      setError("Enter a valid roll number (1 or higher)");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const response = await gameServer.submitRoll(sessionId, {
        text: `I rolled ${value}`,
        actorId: pendingRoll.actorId,
      });
      // Reset local UI state
      setRolled(null);
      setCustomValue("");
      // Let the store decide whether to chain another roll or clear
      handleRollResponse(response, pendingRoll.actorId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit roll");
    } finally {
      setSubmitting(false);
    }
  }, [sessionId, pendingRoll, submitting, customValue, handleRollResponse]);

  const handleDismiss = useCallback(() => {
    setRolled(null);
    setCustomValue("");
    setError(null);
    setPendingRoll(null);
  }, [setPendingRoll]);

  if (!pendingRoll) return null;

  const notation = pendingRoll.diceNeeded ?? "d20";
  const label = rollTypeLabel(pendingRoll.rollType);
  const emoji = diceEmoji(pendingRoll.rollType);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center pointer-events-none px-4 pb-4">
      <div className="pointer-events-auto w-full max-w-sm bg-slate-900 border border-amber-500/60 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 bg-amber-900/40 border-b border-amber-700/40">
          <span className="text-xl leading-none">{emoji}</span>
          <div>
            <p className="text-amber-300 font-bold text-sm">{label}</p>
            <p className="text-slate-400 text-xs line-clamp-2">{pendingRoll.message}</p>
          </div>
        </div>

        {/* Body */}
        <div className="px-4 py-3 space-y-3">
          {/* Dice expression */}
          <div className="flex items-center justify-between">
            <span className="text-slate-400 text-xs">Dice</span>
            <span className="text-amber-200 font-mono text-sm font-bold">{notation}</span>
          </div>

          {/* Roll button */}
          <button
            onClick={handleRoll}
            disabled={submitting}
            className="w-full py-3 rounded-xl bg-amber-600 hover:bg-amber-500 active:bg-amber-700 text-white font-bold text-base transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            🎲 Roll {notation}
          </button>

          {/* Result */}
          {rolled && (
            <div className="text-center py-1">
              <p className="text-3xl font-black text-amber-300">{rolled.total}</p>
              {rolled.breakdown !== String(rolled.total) && (
                <p className="text-slate-500 text-xs font-mono">{rolled.breakdown}</p>
              )}
            </div>
          )}

          {/* Manual override input */}
          <div className="space-y-1">
            <label className="text-slate-500 text-xs">Or enter your roll:</label>
            <input
              type="number"
              min={1}
              value={customValue}
              onChange={(e) => {
                setCustomValue(e.target.value);
                setError(null);
              }}
              placeholder="Enter total..."
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 text-sm placeholder-slate-600 focus:outline-none focus:border-amber-500"
            />
          </div>

          {/* Error */}
          {error && <p className="text-red-400 text-xs">{error}</p>}

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={handleDismiss}
              className="flex-1 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 text-sm font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => void handleSubmit()}
              disabled={!customValue.trim() || submitting}
              className="flex-1 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? "Submitting…" : "Confirm"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
