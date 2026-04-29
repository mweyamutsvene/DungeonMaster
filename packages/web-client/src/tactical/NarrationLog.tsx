import { useRef, useEffect, useState } from "react";
import { useAppStore } from "../store/app-store";
import type { AttackLogData } from "../store/app-store";
import type { StoredCombatant } from "../types/api";

function resolveRef(
  combatants: StoredCombatant[],
  ref: AttackLogData["attacker"] | undefined,
): string | undefined {
  if (!ref) return undefined;
  if (ref.characterId) return combatants.find((c) => c.characterId === ref.characterId)?.name;
  if (ref.monsterId) return combatants.find((c) => c.monsterId === ref.monsterId)?.name;
  if (ref.npcId) return combatants.find((c) => c.npcId === ref.npcId)?.name;
  return undefined;
}

function buildAttackLine(
  data: AttackLogData,
  combatants: StoredCombatant[],
): { label: string; labelClass: string; body: string } {
  const attackerName = resolveRef(combatants, data.attacker) ?? "?";
  const targetName = resolveRef(combatants, data.target) ?? "?";

  const label = data.critical ? "CRITICAL HIT" : data.hit ? "HIT" : "MISS";
  const labelClass =
    data.critical ? "text-red-400 font-bold"
    : data.hit ? "text-green-400 font-bold"
    : "text-yellow-400 font-bold";

  let statsTag = "";
  if (data.attackTotal !== undefined && data.targetAC !== undefined) {
    statsTag = `[${data.attackTotal} vs AC ${data.targetAC}] `;
  } else if (data.attackRoll !== undefined) {
    statsTag = `[roll ${data.attackRoll}] `;
  }

  const damageTag = data.hit && data.damageApplied !== undefined
    ? ` — ${targetName} takes ${data.damageApplied} damage`
    : data.hit
    ? ` — ${attackerName} hits ${targetName}`
    : ` — ${attackerName} misses ${targetName}`;

  const body = `${statsTag}${damageTag}`;
  return { label, labelClass, body };
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
          latest.eventType === "AttackResolved" && latest.attackData ? (
            (() => {
              const { label, labelClass, body } = buildAttackLine(latest.attackData, combatants);
              return <span className={`text-xs truncate ${labelClass}`}>{label}{body}</span>;
            })()
          ) : (
            <span className={[
              "text-xs truncate",
              latest.eventType === "error" ? "text-red-400 font-medium" : "text-slate-300",
            ].join(" ")}>
              {latest.text}
            </span>
          )
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
            if (entry.eventType === "AttackResolved" && entry.attackData) {
              const { label, labelClass, body } = buildAttackLine(entry.attackData, combatants);
              return (
                <div key={entry.id} className="text-xs flex gap-1.5 items-baseline pl-2 border-l-2 border-slate-700">
                  <span className={labelClass}>{label}</span>
                  <span className="text-slate-300">{body}</span>
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
