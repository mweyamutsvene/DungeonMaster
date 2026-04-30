import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAppStore } from "../store/app-store";
import { gameServer } from "../hooks/use-game-server";
import type { Character } from "../types/api";

interface Monster {
  id: string;
  name: string;
  count: number;
  statBlock?: Record<string, unknown>;
}

// Pre-built scenario templates (mirroring player-cli scenarios)
const SCENARIO_TEMPLATES = {
  "solo-fighter": {
    name: "Solo Fighter vs Goblins",
    character: { name: "Thorin Ironfist", className: "Fighter", level: 5 },
    monsters: [
      { name: "Goblin Warrior", count: 2 },
    ],
  },
  "solo-wizard": {
    name: "Solo Wizard vs Cultists",
    character: { name: "Eldaris Moonwhisper", className: "Wizard", level: 5 },
    monsters: [
      { name: "Cultist", count: 3 },
    ],
  },
  "party-fighter-cleric": {
    name: "Fighter + Cleric vs Orc Warband",
    character: { name: "Thorin Ironfist", className: "Fighter", level: 5 },
    monsters: [
      { name: "Orc War Chief", count: 1 },
      { name: "Orc", count: 2 },
    ],
  },
};

export function SessionSetupPage() {
  const { id: sessionId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const setMyCharacterId = useAppStore((s) => s.setMyCharacterId);
  const setPendingRoll = useAppStore((s) => s.setPendingRoll);

  const [characters, setCharacters] = useState<Character[]>([]);
  const [monsters, setMonsters] = useState<Monster[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New character form
  const [newCharName, setNewCharName] = useState("");
  const [newCharClass, setNewCharClass] = useState("Fighter");
  const [newCharLevel, setNewCharLevel] = useState(5);

  // New monster form
  const [newMonName, setNewMonName] = useState("");
  const [newMonCount, setNewMonCount] = useState(1);

  const classes = ["Barbarian", "Bard", "Cleric", "Druid", "Fighter", "Monk", "Paladin", "Ranger", "Rogue", "Sorcerer", "Warlock", "Wizard"];

  // Load a pre-built scenario template
  async function loadScenario(templateKey: keyof typeof SCENARIO_TEMPLATES) {
    const template = SCENARIO_TEMPLATES[templateKey];
    setLoading(true);
    setError(null);
    try {
      // Add character
      const charRes = await gameServer.generateCharacter(sessionId!, {
        name: template.character.name,
        className: template.character.className,
        level: template.character.level,
      });
      const char = charRes as Character;
      setCharacters([char]);

      // Add monsters
      const newMons: Monster[] = [];
      for (const m of template.monsters) {
        const id = `mon-${Date.now()}-${newMons.length}`;
        newMons.push({ id, name: m.name, count: m.count });
      }
      setMonsters(newMons);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load scenario");
    } finally {
      setLoading(false);
    }
  }

  async function addCharacter() {
    if (!sessionId || !newCharName.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const char = await gameServer.generateCharacter(sessionId, {
        name: newCharName.trim(),
        className: newCharClass,
        level: newCharLevel,
      });
      setCharacters([...characters, char as Character]);
      setNewCharName("");
      setNewCharLevel(5);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add character");
    } finally {
      setLoading(false);
    }
  }

  function addMonster() {
    if (!newMonName.trim() || newMonCount < 1) return;
    const id = `mon-${Date.now()}`;
    setMonsters([
      ...monsters,
      { id, name: newMonName.trim(), count: newMonCount },
    ]);
    setNewMonName("");
    setNewMonCount(1);
  }

  function removeCharacter(id: string) {
    setCharacters(characters.filter((c) => c.id !== id));
  }

  function removeMonster(id: string) {
    setMonsters(monsters.filter((m) => m.id !== id));
  }

  async function startCombat() {
    if (!sessionId || characters.length === 0 || monsters.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      // First, add all monsters to the session with basic stat blocks
      for (const monster of monsters) {
        const statBlock = getBasicMonsterStatBlock(monster.name);
        for (let i = 0; i < monster.count; i++) {
          await gameServer.addMonster(sessionId, {
            name: monster.name,
            statBlock,
          });
        }
      }

      // Claim first character as "my character" before navigating
      const characterId = characters[0]!.id;
      setMyCharacterId(characterId);

      // Initiate combat via the tabletop flow — server creates a Pending encounter
      // and returns a roll request for initiative. Set pendingRoll BEFORE navigation
      // so DiceRollModal appears on SessionPage immediately.
      const initiateResp = await gameServer.initiateCombat(sessionId, {
        text: "start combat",
        actorId: characterId,
      });

      if (initiateResp.requiresPlayerInput && initiateResp.rollType === "initiative") {
        setPendingRoll({
          rollType: initiateResp.rollType,
          diceNeeded: initiateResp.diceNeeded ?? "d20",
          message: initiateResp.message,
          actorId: characterId,
        });
      }

      // Navigate to session page — DiceRollModal will show if pendingRoll is set
      navigate(`/session/${sessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start combat");
    } finally {
      setLoading(false);
    }
  }

  function getBasicMonsterStatBlock(name: string) {
    const monsterStats: Record<string, Record<string, unknown>> = {
      "Goblin Warrior": {
        abilityScores: {
          strength: 8,
          dexterity: 14,
          constitution: 10,
          intelligence: 10,
          wisdom: 8,
          charisma: 8,
        },
        maxHp: 7,
        armorClass: 15,
        speed: 30,
        attacks: [
          {
            name: "Scimitar",
            kind: "melee",
            attackBonus: 4,
            damage: { diceCount: 1, diceSides: 6, modifier: 2 },
            damageType: "slashing",
          },
        ],
      },
      Cultist: {
        abilityScores: {
          strength: 10,
          dexterity: 12,
          constitution: 11,
          intelligence: 11,
          wisdom: 10,
          charisma: 10,
        },
        maxHp: 5,
        armorClass: 12,
        speed: 30,
        attacks: [
          {
            name: "Dagger",
            kind: "melee",
            attackBonus: 2,
            damage: { diceCount: 1, diceSides: 4, modifier: 1 },
            damageType: "piercing",
          },
        ],
      },
      "Orc War Chief": {
        abilityScores: {
          strength: 18,
          dexterity: 12,
          constitution: 18,
          intelligence: 11,
          wisdom: 11,
          charisma: 10,
        },
        maxHp: 52,
        armorClass: 16,
        speed: 30,
        attacks: [
          {
            name: "Greataxe",
            kind: "melee",
            attackBonus: 7,
            damage: { diceCount: 1, diceSides: 12, modifier: 4 },
            damageType: "slashing",
          },
        ],
      },
      Orc: {
        abilityScores: {
          strength: 16,
          dexterity: 12,
          constitution: 16,
          intelligence: 7,
          wisdom: 11,
          charisma: 10,
        },
        maxHp: 15,
        armorClass: 13,
        speed: 30,
        attacks: [
          {
            name: "Greataxe",
            kind: "melee",
            attackBonus: 5,
            damage: { diceCount: 1, diceSides: 12, modifier: 3 },
            damageType: "slashing",
          },
        ],
      },
    };

    return monsterStats[name] || monsterStats["Goblin Warrior"];
  }

  return (
    <div className="h-full flex flex-col bg-slate-950 overflow-y-auto">
      {/* Header */}
      <div className="bg-slate-900 border-b border-slate-800 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-2xl font-bold text-amber-500">⚔️ Set Up Combat</h1>
          <p className="text-slate-400 text-sm mt-1">Choose a scenario or build your own</p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 px-6 py-8">
        <div className="max-w-4xl mx-auto space-y-8">
          {error && (
            <div className="bg-red-950/30 border border-red-900 text-red-400 rounded-lg px-4 py-3 text-sm">
              {error}
            </div>
          )}

          {/* Quick Scenario Picker */}
          {characters.length === 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-slate-300 uppercase">Quick Start</h2>
              <div className="grid grid-cols-1 gap-2">
                {Object.entries(SCENARIO_TEMPLATES).map(([key, template]) => (
                  <button
                    key={key}
                    onClick={() => loadScenario(key as keyof typeof SCENARIO_TEMPLATES)}
                    disabled={loading}
                    className="w-full text-left bg-slate-800 hover:bg-slate-700 disabled:opacity-50 border border-slate-700 rounded-lg px-4 py-3 transition-colors"
                  >
                    <p className="text-slate-100 font-medium text-sm">{template.name}</p>
                    <p className="text-slate-400 text-xs mt-1">
                      {template.character.name} ({template.character.className} {template.character.level}) vs{" "}
                      {template.monsters.map((m) => `${m.count}x ${m.name}`).join(", ")}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-slate-700" />
            <span className="text-slate-500 text-xs uppercase">or build custom</span>
            <div className="flex-1 h-px bg-slate-700" />
          </div>

          {/* Character Section */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-100">Your Party</h2>

            {/* Character List */}
            {characters.length > 0 ? (
              <div className="space-y-2">
                {characters.map((char) => (
                  <div
                    key={char.id}
                    className="flex items-center justify-between bg-slate-800 border border-slate-700 rounded-lg px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-xs shrink-0">
                        {char.name[0]?.toUpperCase()}
                      </div>
                      <div>
                        <p className="text-slate-100 font-medium">{char.name}</p>
                        <p className="text-slate-400 text-xs">
                          {(char.class ?? char.className ?? "Unknown")} · Level {char.level}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => removeCharacter(char.id)}
                      className="text-slate-500 hover:text-red-400 transition-colors"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-slate-500 text-sm italic">No characters added yet</p>
            )}

            {/* Add Character Form */}
            <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 space-y-3">
              <label className="block text-xs font-medium text-slate-400 uppercase">Add Character</label>
              <div className="grid grid-cols-12 gap-2">
                <input
                  type="text"
                  placeholder="Character name…"
                  value={newCharName}
                  onChange={(e) => setNewCharName(e.target.value)}
                  className="col-span-6 bg-slate-700 border border-slate-600 rounded px-3 py-2 text-slate-100 placeholder-slate-500 text-sm"
                />
                <select
                  value={newCharClass}
                  onChange={(e) => setNewCharClass(e.target.value)}
                  className="col-span-3 bg-slate-700 border border-slate-600 rounded px-3 py-2 text-slate-100 text-sm"
                >
                  {classes.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <select
                  value={newCharLevel}
                  onChange={(e) => setNewCharLevel(Number(e.target.value))}
                  className="col-span-2 bg-slate-700 border border-slate-600 rounded px-3 py-2 text-slate-100 text-sm"
                >
                  {Array.from({ length: 20 }).map((_, i) => (
                    <option key={i + 1} value={i + 1}>
                      L{i + 1}
                    </option>
                  ))}
                </select>
              </div>
              <button
                onClick={addCharacter}
                disabled={loading || !newCharName.trim()}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2 rounded text-sm transition-colors"
              >
                Add Character
              </button>
            </div>
          </div>

          {/* Monster Section */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-100">Enemies</h2>

            {/* Monster List */}
            {monsters.length > 0 ? (
              <div className="space-y-2">
                {monsters.map((mon) => (
                  <div
                    key={mon.id}
                    className="flex items-center justify-between bg-slate-800 border border-slate-700 rounded-lg px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-red-600 flex items-center justify-center text-white font-bold text-xs shrink-0">
                        {mon.name[0]?.toUpperCase()}
                      </div>
                      <div>
                        <p className="text-slate-100 font-medium">{mon.name}</p>
                        <p className="text-slate-400 text-xs">
                          {mon.count} {mon.count === 1 ? "enemy" : "enemies"}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => removeMonster(mon.id)}
                      className="text-slate-500 hover:text-red-400 transition-colors"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-slate-500 text-sm italic">No enemies added yet</p>
            )}

            {/* Add Monster Form */}
            <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 space-y-3">
              <label className="block text-xs font-medium text-slate-400 uppercase">Add Enemy</label>
              <div className="grid grid-cols-12 gap-2">
                <input
                  type="text"
                  placeholder="Enemy name (e.g., Goblin Warrior)…"
                  value={newMonName}
                  onChange={(e) => setNewMonName(e.target.value)}
                  className="col-span-9 bg-slate-700 border border-slate-600 rounded px-3 py-2 text-slate-100 placeholder-slate-500 text-sm"
                />
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={newMonCount}
                  onChange={(e) => setNewMonCount(Number(e.target.value))}
                  className="col-span-3 bg-slate-700 border border-slate-600 rounded px-3 py-2 text-slate-100 text-sm"
                />
              </div>
              <button
                onClick={addMonster}
                disabled={!newMonName.trim() || newMonCount < 1}
                className="w-full bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2 rounded text-sm transition-colors"
              >
                Add Enemy
              </button>
            </div>
          </div>

          {/* Start Combat Button */}
          <div className="pt-4 border-t border-slate-700">
            <button
              onClick={startCombat}
              disabled={loading || characters.length === 0 || monsters.length === 0}
              className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-bold py-4 rounded-lg text-lg transition-colors"
            >
              {loading ? "Starting Combat…" : "⚔️ Start Combat"}
            </button>
            {(characters.length === 0 || monsters.length === 0) && (
              <p className="text-slate-500 text-xs text-center mt-2">
                Add at least one character and one enemy to start
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
