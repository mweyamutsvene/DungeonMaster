import { useAppStore } from "../store/app-store";

interface SpellSlotRow {
  level: number;
  current: number;
  max: number;
}

function deriveSpellSlots(resourcePools: Array<{ name: string; current: number; max: number }>): SpellSlotRow[] {
  return resourcePools
    .filter((p) => p.name.startsWith("spellSlot_") && p.max > 0)
    .map((p) => ({ level: parseInt(p.name.slice(10), 10), current: p.current, max: p.max }))
    .sort((a, b) => a.level - b.level);
}

export function ActionEconomyBar() {
  const combatants = useAppStore((s) => s.combatants);
  const activeCombatantId = useAppStore((s) => s.activeCombatantId);
  const myCharacterId = useAppStore((s) => s.myCharacterId);

  // Show economy for the local player's combatant, falling back to the active combatant
  const mine =
    combatants.find((c) => c.characterId === myCharacterId) ??
    combatants.find((c) => c.id === activeCombatantId);

  const ae = mine?.actionEconomy;
  if (!mine || !ae) {
    return (
      <div className="flex items-center justify-center px-3 py-1.5 bg-slate-900 border-t border-slate-800 text-slate-600 text-xs shrink-0">
        Waiting for combat…
      </div>
    );
  }

  const speed = mine.movement.speed || 30;
  const movePct = Math.max(0, ae.movementRemainingFeet / speed);
  const spellSlots = deriveSpellSlots(mine.resourcePools ?? []);

  return (
    <div className="flex flex-col bg-slate-900 border-t border-slate-800 shrink-0">
      {/* Action economy row */}
      <div className="flex items-center gap-3 px-3 py-1.5">
        <Pip label="Action" used={!ae.actionAvailable} color="amber" />
        <Pip label="Bonus" used={!ae.bonusActionAvailable} color="sky" />
        <Pip label="React" used={!ae.reactionAvailable} color="violet" />

        <div className="flex items-center gap-1.5 ml-auto">
          <span className="text-[10px] text-slate-400 uppercase tracking-wider">Move</span>
          <div className="w-20 h-1.5 bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all"
              style={{ width: `${movePct * 100}%` }}
            />
          </div>
          <span className="text-[10px] text-slate-300 tabular-nums">
            {ae.movementRemainingFeet}ft
          </span>
        </div>
      </div>

      {/* Spell slots row — only shown for casters */}
      {spellSlots.length > 0 && (
        <div className="flex items-center gap-3 px-3 pb-1.5 flex-wrap">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider">Slots</span>
          {spellSlots.map((slot) => (
            <SlotGroup key={slot.level} level={slot.level} current={slot.current} max={slot.max} />
          ))}
        </div>
      )}
    </div>
  );
}

function Pip({
  label,
  used,
  color,
}: {
  label: string;
  used: boolean;
  color: "amber" | "sky" | "violet";
}) {
  const active = { amber: "bg-amber-500", sky: "bg-sky-500", violet: "bg-violet-500" }[color];

  return (
    <div className="flex items-center gap-1">
      <div
        className={[
          "w-2.5 h-2.5 rounded-full border",
          used ? "bg-slate-700 border-slate-600" : `${active} border-transparent`,
        ].join(" ")}
      />
      <span
        className={[
          "text-[10px] uppercase tracking-wider",
          used ? "text-slate-600" : "text-slate-300",
        ].join(" ")}
      >
        {label}
      </span>
    </div>
  );
}

const SLOT_LEVEL_LABELS = ["", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

function SlotGroup({ level, current, max }: SpellSlotRow) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] text-slate-500 tabular-nums w-2.5 text-center">{SLOT_LEVEL_LABELS[level]}</span>
      <div className="flex gap-0.5">
        {Array.from({ length: max }).map((_, i) => (
          <div
            key={i}
            className={[
              "w-2 h-2 rounded-sm border",
              i < current
                ? "bg-indigo-500 border-indigo-400"
                : "bg-slate-700 border-slate-600",
            ].join(" ")}
          />
        ))}
      </div>
    </div>
  );
}
