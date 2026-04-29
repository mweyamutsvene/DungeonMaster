import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { gameServer } from "../hooks/use-game-server";
import { useAppStore } from "../store/app-store";
import type { SpellCatalogEntry } from "../types/api";

interface SpellWithMeta extends SpellCatalogEntry {
  /** Whether this spell needs a target (non-self range) */
  needsTarget: boolean;
}

interface SpellsPanelProps {
  onClose: () => void;
  /** Called with spell name when player selects a targeted spell — parent enters targeting mode. */
  onCastTargeted: (spellName: string) => void;
}

const SCHOOL_COLORS: Record<string, string> = {
  evocation:    "text-orange-400",
  abjuration:   "text-blue-400",
  conjuration:  "text-green-400",
  divination:   "text-cyan-400",
  enchantment:  "text-pink-400",
  illusion:     "text-purple-400",
  necromancy:   "text-gray-400",
  transmutation:"text-yellow-400",
};

const CASTING_TIME_LABEL: Record<string, string> = {
  action:       "Action",
  bonus_action: "Bonus",
  reaction:     "Reaction",
};

export function SpellsPanel({ onClose, onCastTargeted }: SpellsPanelProps) {
  const { id: sessionId } = useParams<{ id: string }>();
  const myCharacterId = useAppStore((s) => s.myCharacterId);
  const activeCombatantId = useAppStore((s) => s.activeCombatantId);
  const combatants = useAppStore((s) => s.combatants);
  const encounterId = useAppStore((s) => s.encounterId);
  const handleRollResponse = useAppStore((s) => s.handleRollResponse);
  const addErrorLog = useAppStore((s) => s.addErrorLog);

  const activeCombatant = combatants.find((c) => c.id === activeCombatantId);
  const resourcePools = activeCombatant?.resourcePools ?? [];

  const [spellIds, setSpellIds] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<SpellCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [casting, setCasting] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId || !myCharacterId) return;
    setLoading(true);
    Promise.all([
      gameServer.getCharacterSpells(sessionId, myCharacterId),
      gameServer.getSpellCatalog(),
    ])
      .then(([spellsResp, catalogResp]) => {
        const hasPrepared = spellsResp.preparedSpells.length > 0;
        const hasKnown = spellsResp.knownSpells.length > 0;

        if (hasPrepared || hasKnown) {
          // Explicit spell list — show only prepared/known
          const all = new Set([...spellsResp.preparedSpells, ...spellsResp.knownSpells]);
          setSpellIds([...all]);
        } else if (spellsResp.casterType !== "none") {
          // Backward-compat mode: character is a caster but hasn't explicitly prepared spells.
          // Show all class-appropriate spells from catalog (server allows any spell in this state).
          const classId = spellsResp.classId.toLowerCase();
          const classSpells = catalogResp.spells
            .filter((s) => s.classLists.some((c) => c.toLowerCase() === classId))
            .map((s) => s.id);
          setSpellIds(classSpells);
        } else {
          setSpellIds([]);
        }
        setCatalog(catalogResp.spells);
      })
      .catch((err) => {
        addErrorLog(`⚠️ Failed to load spells: ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => setLoading(false));
  }, [sessionId, myCharacterId, addErrorLog]);

  // Match spell IDs from character sheet to catalog entries
  const mySpells: SpellWithMeta[] = spellIds
    .map((id) => {
      const entry = catalog.find((s) => s.id === id.toLowerCase());
      if (!entry) return null;
      // Self-targeting spells: cantrips and buff spells that use self range
      // We infer "needs target" by whether the spell is an attack/damage type
      // For MVP: reactions and "reaction" castingTime don't need a target here (handled elsewhere)
      const isSelf = [
        "mage armor", "blur", "shield", "misty step", "mirror image", "haste",
        "fly", "blink", "expeditious retreat", "longstrider", "protection from evil and good",
        "armor of agathys", "hex",
      ].includes(entry.id);
      return {
        ...entry,
        needsTarget: entry.castingTime !== "reaction" && !isSelf,
      };
    })
    .filter((s): s is SpellWithMeta => s !== null)
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));

  // Group by level
  const byLevel = new Map<number, SpellWithMeta[]>();
  for (const spell of mySpells) {
    const arr = byLevel.get(spell.level) ?? [];
    arr.push(spell);
    byLevel.set(spell.level, arr);
  }

  function getSlotPool(level: number) {
    const poolName = level === 0 ? null : `spellSlot_${level}`;
    if (!poolName) return null;
    return resourcePools.find((p) => p.name === poolName) ?? null;
  }

  async function castSelf(spellName: string) {
    if (!sessionId || !encounterId || !myCharacterId) return;
    setCasting(spellName);
    try {
      const response = await gameServer.submitAction(sessionId, {
        text: `cast ${spellName}`,
        actorId: myCharacterId,
        encounterId,
      });
      handleRollResponse(response, myCharacterId);
      onClose();
    } catch (err) {
      addErrorLog(`⚠️ Cast ${spellName} failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCasting(null);
    }
  }

  function handleSpellClick(spell: SpellWithMeta) {
    if (spell.needsTarget) {
      onCastTargeted(spell.name);
    } else {
      void castSelf(spell.name);
    }
  }

  const levelLabels: Record<number, string> = {
    0: "Cantrips",
    1: "1st Level", 2: "2nd Level", 3: "3rd Level",
    4: "4th Level", 5: "5th Level", 6: "6th Level",
    7: "7th Level", 8: "8th Level", 9: "9th Level",
  };

  return (
    /* Overlay */
    <div
      className="absolute inset-0 z-40 flex flex-col justify-end"
      onClick={onClose}
    >
      {/* Panel — stop click propagation so taps inside don't close */}
      <div
        className="bg-slate-900 border-t border-slate-700 rounded-t-2xl max-h-[70%] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700 shrink-0">
          <h2 className="text-sm font-semibold text-white">Spells</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-xl leading-none px-1"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-3 py-2 space-y-3">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 rounded-full border-2 border-slate-600 border-t-indigo-400 animate-spin" />
            </div>
          )}

          {!loading && mySpells.length === 0 && (
            <div className="text-slate-500 text-sm text-center py-6">
              No spells prepared. Long rest and prepare spells to unlock this.
            </div>
          )}

          {!loading && [...byLevel.entries()].map(([level, spells]) => {
            const slotPool = getSlotPool(level);
            const slotsRemaining = slotPool?.current ?? null;
            const slotsMax = slotPool?.max ?? null;

            return (
              <div key={level}>
                {/* Level header */}
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                    {levelLabels[level] ?? `Level ${level}`}
                  </span>
                  {slotPool !== null && slotsRemaining !== null && slotsMax !== null && (
                    <div className="flex gap-0.5 items-center">
                      {Array.from({ length: slotsMax }).map((_, i) => (
                        <span
                          key={i}
                          className={[
                            "w-2 h-2 rounded-full border",
                            i < slotsRemaining
                              ? "bg-indigo-400 border-indigo-400"
                              : "bg-transparent border-slate-600",
                          ].join(" ")}
                        />
                      ))}
                      <span className="text-xs text-slate-500 ml-1">
                        {slotsRemaining}/{slotsMax}
                      </span>
                    </div>
                  )}
                </div>

                {/* Spell list */}
                <div className="space-y-1">
                  {spells.map((spell) => {
                    const isExpended = slotsRemaining !== null && slotsRemaining === 0 && level > 0;
                    const isCasting = casting === spell.name;
                    return (
                      <button
                        key={spell.id}
                        disabled={isExpended || !!casting}
                        onClick={() => handleSpellClick(spell)}
                        className={[
                          "w-full text-left rounded-lg px-3 py-2 flex items-start gap-2 transition-colors",
                          isExpended
                            ? "opacity-40 cursor-not-allowed bg-slate-800"
                            : "bg-slate-800 hover:bg-slate-700 active:bg-slate-600",
                        ].join(" ")}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-white text-sm font-medium truncate">
                              {spell.name}
                            </span>
                            {isCasting && (
                              <div className="w-3 h-3 rounded-full border border-slate-500 border-t-indigo-400 animate-spin shrink-0" />
                            )}
                            {spell.needsTarget && !isCasting && (
                              <span className="text-slate-500 text-xs shrink-0">🎯</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className={`text-xs ${SCHOOL_COLORS[spell.school] ?? "text-slate-400"}`}>
                              {spell.school}
                            </span>
                            <span className="text-xs text-slate-500">
                              {CASTING_TIME_LABEL[spell.castingTime] ?? spell.castingTime}
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
