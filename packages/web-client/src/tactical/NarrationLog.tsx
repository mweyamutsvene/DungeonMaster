import { useRef, useEffect, useState } from "react";
import { useAppStore } from "../store/app-store";
import type { AttackResolvedData } from "../store/app-store";
import type { StoredCombatant } from "../types/api";

function findCombatantName(
  combatants: StoredCombatant[],
  ref: AttackResolvedData["attackerRef"],
): string | undefined {
  if (!ref) return undefined;
  return combatants.find(
    (c) =>
      (ref.characterId && c.characterId === ref.characterId) ||
      (ref.monsterId && c.monsterId === ref.monsterId) ||
      (ref.npcId && c.npcId === ref.npcId),
  )?.name;
}

function buildAttackLine(ar: AttackResolvedData, combatants: StoredCombatant[]): { label: string; body: string } {
  const attackerName =
    ar.attackerName ?? findCombatantName(combatants, ar.attackerRef) ?? "?";
  const targetName =
    ar.targetName ?? findCombatantName(combatants, ar.targetRef) ?? "?";

  const rollDisplay = ar.attackTotal ?? ar.attackRoll;
  const statsTag =
    rollDisplay != null && ar.targetAC != null
      ? `[${rollDisplay} vs AC ${ar.targetAC}] `
      : rollDisplay != null
        ? `[roll: ${rollDisplay}] `
        : "";

  if (ar.critical) {
    return { label: "CRITICAL HIT", body: `${statsTag}${targetName} takes ${ar.damageApplied ?? "?"} damage!` };
  }
  if (ar.hit) {
    return { label: "HIT", body: `${statsTag}${targetName} takes ${ar.damageApplied ?? "?"} damage` };
  }
  return { label: "MISS", body: `${statsTag}${attackerName} misses ${targetName}` };
}

export function NarrationLog() {
  const narrationLog = useAppStore((s) => s.narrationLog);
  const combatants = useAppStore((s) => s.combatants);
  const [expanded, setExpanded] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new entries
  useEffect(() => {
    if (expanded) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [narrationLog, expanded]);

  const latest = narrationLog[narrationLog.length - 1];

  return (
    <div
      className={[
        "bg-slate-900 border-t border-slate-800 transition-all duration-200 shrink-0",
        expanded ? "h-40" : "h-10",
      ].join(" ")}
    >
      {/* Header / latest entry */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-2 px-3 h-10 text-left hover:bg-slate-800/50 transition-colors"
      >
        <span className="text-slate-500 text-xs shrink-0">{expanded ? "▼" : "▲"}</span>
        {latest ? (
          (() => {
            if (latest.eventType === "AttackResolved" && latest.attackResolved) {
              const { label } = buildAttackLine(latest.attackResolved, combatants);
              const labelClass =
                label === "CRITICAL HIT" ? "text-red-400 font-bold"
                : label === "HIT" ? "text-green-400 font-bold"
                : "text-yellow-400 font-bold";
              return <span className={`text-xs truncate ${labelClass}`}>{label}: {buildAttackLine(latest.attackResolved, combatants).body}</span>;
            }
            return (
              <span className={[
                "text-xs truncate",
                latest.eventType === "error" ? "text-red-400 font-medium" : "text-slate-300",
              ].join(" ")}>
                {latest.text}
              </span>
            );
          })()
        ) : (
          <span className="text-slate-600 text-xs italic">Combat log…</span>
        )}
        {latest?.eventType === "error" && !expanded && (
          <span className="ml-auto shrink-0 w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        )}
      </button>

      {/* Expanded scroll area */}
      {expanded && (
        <div className="h-[calc(100%-2.5rem)] overflow-y-auto px-3 py-2 space-y-1.5 scrollbar-hide">
          {narrationLog.length === 0 && (
            <p className="text-slate-600 text-xs italic">No events yet.</p>
          )}
          {narrationLog.map((entry) => {
            if (entry.eventType === "AttackResolved" && entry.attackResolved) {
              const { label, body } = buildAttackLine(entry.attackResolved, combatants);
              const labelClass =
                label === "CRITICAL HIT"
                  ? "text-red-400 font-bold"
                  : label === "HIT"
                  ? "text-green-400 font-bold"
                  : "text-yellow-400 font-bold"; // MISS
              return (
                <div key={entry.id} className="text-xs flex gap-1.5 items-baseline pl-2 border-l-2 border-slate-700">
                  <span className={labelClass}>{label}</span>
                  {body && <span className="text-slate-300">{body}</span>}
                </div>
              );
            }
            return (
              <div key={entry.id} className="text-xs">
                {entry.actor && (
                  <span className="text-amber-400 font-medium">{entry.actor}: </span>
                )}
                <span
                  className={
                    entry.eventType === "error"
                      ? "text-red-400 font-medium"
                      : entry.eventType === "NarrativeText"
                      ? "text-slate-200 italic"
                      : entry.eventType === "OpportunityAttack"
                      ? "text-orange-300 font-medium"
                      : entry.eventType === "Move"
                      ? "text-sky-300"
                      : "text-slate-400"
                  }
                >
                  {entry.text}
                </span>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
