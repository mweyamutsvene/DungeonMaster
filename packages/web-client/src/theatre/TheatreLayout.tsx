// Theatre mode placeholder — built in the next phase after tactical mode is complete.

import { useAppStore } from "../store/app-store";

export function TheatreLayout() {
  const sessionId = useAppStore((s) => s.sessionId);
  const playerName = useAppStore((s) => s.playerName);

  return (
    <div className="h-full flex flex-col items-center justify-center bg-slate-950 gap-6 px-4">
      {/* Scene image placeholder */}
      <div className="w-full max-w-lg aspect-video bg-slate-900 rounded-xl border border-slate-800 flex items-center justify-center">
        <span className="text-slate-600 text-sm">Scene illustration</span>
      </div>

      {/* Narration scroll placeholder */}
      <div className="w-full max-w-lg bg-slate-900 rounded-xl border border-slate-800 p-4 space-y-2 min-h-[120px]">
        <p className="text-slate-500 text-sm italic">
          The tavern bustles with activity. Adventurers and merchants fill the
          common room, their voices blending into a warm cacophony…
        </p>
        <p className="text-slate-600 text-xs">Theatre mode — coming next phase</p>
      </div>

      {/* Action input placeholder */}
      <div className="w-full max-w-lg flex gap-2">
        <input
          type="text"
          placeholder="What do you do?"
          disabled
          className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-400 placeholder-slate-600 text-sm cursor-not-allowed"
        />
        <button
          disabled
          className="bg-amber-500/30 text-amber-700 px-4 py-2.5 rounded-lg font-medium text-sm cursor-not-allowed"
        >
          Act
        </button>
      </div>

      <div className="text-center text-slate-600 text-xs space-y-1">
        <p>Session: <span className="font-mono text-slate-500">{sessionId}</span></p>
        <p>Playing as: <span className="text-slate-400">{playerName || "—"}</span></p>
        <p className="text-slate-700">Waiting for combat to start…</p>
      </div>
    </div>
  );
}
