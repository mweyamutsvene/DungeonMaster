import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../store/app-store";
import { gameServer } from "../hooks/use-game-server";

export function LobbyPage() {
  const navigate = useNavigate();
  const setSession = useAppStore((s) => s.setSession);
  const setPlayerName = useAppStore((s) => s.setPlayerName);

  const [name, setName] = useState("");
  const [sessionCode, setSessionCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !sessionCode.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await gameServer.getSession(sessionCode.trim());
      setPlayerName(name.trim());
      setSession(sessionCode.trim());
      navigate(`/session/${sessionCode.trim()}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Session not found");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/sessions", { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { id: string };
      setPlayerName(name.trim());
      setSession(data.id);
      navigate(`/session/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create session");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="h-full flex flex-col items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-sm space-y-8">
        {/* Title */}
        <div className="text-center space-y-1">
          <h1 className="text-4xl font-bold tracking-tight text-amber-500">⚔️ DungeonMaster</h1>
          <p className="text-slate-400 text-sm">D&amp;D 5e 2024 Combat Engine</p>
        </div>

        {/* Name field shared between join and create */}
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1 uppercase tracking-wider">
            Your Name
          </label>
          <input
            type="text"
            placeholder="Aldric the Bold"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
        </div>

        {/* Join existing */}
        <form onSubmit={handleJoin} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1 uppercase tracking-wider">
              Session Code
            </label>
            <input
              type="text"
              placeholder="Paste session ID…"
              value={sessionCode}
              onChange={(e) => setSessionCode(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500 font-mono text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !name.trim() || !sessionCode.trim()}
            className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-bold py-3 rounded-lg transition-colors"
          >
            {loading ? "Joining…" : "Join Session"}
          </button>
        </form>

        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-slate-700" />
          <span className="text-slate-500 text-xs uppercase tracking-wider">or</span>
          <div className="flex-1 h-px bg-slate-700" />
        </div>

        {/* Create new */}
        <form onSubmit={handleCreate}>
          <button
            type="submit"
            disabled={loading || !name.trim()}
            className="w-full bg-slate-700 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed text-slate-100 font-bold py-3 rounded-lg transition-colors"
          >
            {loading ? "Creating…" : "Create New Session"}
          </button>
        </form>

        {error && (
          <p className="text-red-400 text-sm text-center bg-red-950/30 rounded-lg px-4 py-2 border border-red-900">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
