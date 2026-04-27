import { useAppStore } from "../store/app-store";

export function CharacterSheetModal() {
  const closeCharacterSheet = useAppStore((s) => s.closeCharacterSheet);
  const targetId = useAppStore((s) => s.characterSheetTargetId);
  const combatants = useAppStore((s) => s.combatants);

  const combatant = combatants.find((c) => c.id === targetId);

  return (
    <div
      className="absolute inset-0 bg-slate-950/80 flex items-end sm:items-center justify-center z-50 p-4"
      onClick={closeCharacterSheet}
    >
      <div
        className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-sm p-5 space-y-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-100">
              {combatant?.name ?? "Character Sheet"}
            </h2>
            {combatant && (
              <p className="text-xs text-slate-400 mt-0.5">
                {combatant.combatantType}
                {combatant.initiative !== undefined && ` · Initiative ${combatant.initiative}`}
              </p>
            )}
          </div>
          <button
            onClick={closeCharacterSheet}
            className="text-slate-500 hover:text-slate-300 text-xl leading-none"
          >
            ×
          </button>
        </div>

        {combatant ? (
          <div className="space-y-3">
            {/* HP */}
            <div>
              <div className="flex justify-between text-xs text-slate-400 mb-1">
                <span>Hit Points</span>
                <span className="tabular-nums">
                  {combatant.hp.current} / {combatant.hp.max}
                </span>
              </div>
              <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500 rounded-full"
                  style={{
                    width: `${Math.max(0, (combatant.hp.current / combatant.hp.max) * 100)}%`,
                  }}
                />
              </div>
            </div>

            {/* Action Economy */}
            {combatant.actionEconomy && (
              <div className="grid grid-cols-3 gap-2 text-xs text-center">
                <ResourceCell label="Action" available={combatant.actionEconomy.actionAvailable} />
                <ResourceCell label="Bonus" available={combatant.actionEconomy.bonusActionAvailable} />
                <ResourceCell label="Reaction" available={combatant.actionEconomy.reactionAvailable} />
              </div>
            )}

            {/* Movement */}
            {combatant.actionEconomy && (
              <div className="text-xs text-slate-400">
                Movement:{" "}
                <span className="text-slate-200 tabular-nums">
                  {combatant.actionEconomy.movementRemainingFeet}ft
                </span>
                {" "}/ {combatant.movement.speed}ft
              </div>
            )}

            {/* Conditions */}
            {combatant.conditions && combatant.conditions.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {combatant.conditions.map((c) => (
                  <span
                    key={c}
                    className="text-[10px] bg-orange-900/40 text-orange-300 border border-orange-800 px-2 py-0.5 rounded-full"
                  >
                    {c}
                  </span>
                ))}
              </div>
            )}

            <p className="text-slate-600 text-xs text-center pt-1">
              Full character sheet — coming soon
            </p>
          </div>
        ) : (
          <p className="text-slate-500 text-sm">No combatant data available.</p>
        )}
      </div>
    </div>
  );
}

function ResourceCell({ label, available }: { label: string; available: boolean }) {
  return (
    <div
      className={[
        "rounded-lg py-2 border",
        available
          ? "bg-slate-700 border-slate-600 text-slate-200"
          : "bg-slate-900 border-slate-800 text-slate-600",
      ].join(" ")}
    >
      <div className="text-base leading-none mb-0.5">{available ? "●" : "○"}</div>
      <div className="text-[10px] uppercase tracking-wider">{label}</div>
    </div>
  );
}
