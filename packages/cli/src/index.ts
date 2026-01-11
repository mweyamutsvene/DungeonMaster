import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

type GameSessionRecord = {
  id: string;
  storyFramework: JsonValue;
  createdAt: string;
  updatedAt: string;
};

type SessionCharacterRecord = {
  id: string;
  sessionId: string;
  name: string;
  level: number;
  className: string | null;
  sheet: JsonValue;
  createdAt: string;
  updatedAt: string;
};

type SessionMonsterRecord = {
  id: string;
  sessionId: string;
  name: string;
  monsterDefinitionId: string | null;
  statBlock: JsonValue;
  createdAt: string;
  updatedAt: string;
};

type SessionGetResponse = {
  session: GameSessionRecord;
  characters: SessionCharacterRecord[];
  monsters: SessionMonsterRecord[];
};

type CreateSessionResponse = GameSessionRecord;
type CreateCharacterResponse = SessionCharacterRecord;

type StartCombatResponse = { id: string } & Record<string, unknown>;

type CombatStateResponse = {
  encounter: any;
  combatants: any[];
  activeCombatant: any;
};

type CombatantRef =
  | { type: "Character"; characterId: string }
  | { type: "Monster"; monsterId: string };

type GameCommand =
  | { kind: "endTurn"; encounterId?: string; actor: CombatantRef }
  | {
      kind: "attack";
      encounterId?: string;
      attacker: CombatantRef;
      target: CombatantRef;
      seed?: number;
      spec?: unknown;
      monsterAttackName?: string;
    };

type LlmActResponse = { command: GameCommand; outcome: any };
type LlmNarrateResponse = { narrative: string };

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const val = argv[i + 1];
    if (val && !val.startsWith("--")) {
      out[key] = val;
      i++;
    } else {
      out[key] = "true";
    }
  }
  return out;
}

function safeJsonStringify(v: unknown): string {
  return JSON.stringify(
    v,
    (_k, val) => {
      if (typeof val === "bigint") return Number(val);
      return val;
    },
    2,
  );
}

function shortSessionTag(sessionId: string | null): string {
  if (!sessionId) return "";
  const core = sessionId;
  return core.length <= 6 ? core : core.slice(0, 6);
}

function currentCharacterLabel(characterId: string | null, characters: SessionCharacterRecord[]): string {
  if (!characterId) return "(no character)";
  const found = characters.find((c) => c.id === characterId);
  return found?.name ?? "(character)";
}

async function httpJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  const text = await res.text();
  if (!res.ok) {
    let parsed: any = undefined;
    try {
      parsed = JSON.parse(text) as any;
    } catch {
      parsed = undefined;
    }

    const message = typeof parsed?.message === "string" ? parsed.message : undefined;

    if (message === "LLM intent parser is not configured") {
      throw new Error(
        [
          `HTTP ${res.status} ${res.statusText}: ${message}`,
          "LLM is disabled on the server.",
          "Set DM_OLLAMA_MODEL (and optionally DM_OLLAMA_BASE_URL) in packages/game-server/.env or the shell env, then restart game-server.",
        ].join(" "),
      );
    }

    if (typeof message === "string" && message.startsWith("No combat encounter for session:")) {
      throw new Error(
        [
          `HTTP ${res.status} ${res.statusText}: ${message}`,
          "Combat is not started for this session.",
          "Run: combat start",
          "(Note: /llm/act currently only supports combat commands like attack/endTurn.)",
        ].join(" "),
      );
    }

    if (
      message ===
      "Attack spec is required (or provide monsterAttackName for monster attackers)"
    ) {
      throw new Error(
        [
          `HTTP ${res.status} ${res.statusText}: ${message}`,
          "The LLM returned an attack command without the required spec.",
          "Try again with more explicit phrasing (weapon + assumed numbers), e.g:",
          "act I attack the goblin with my sword (+5 to hit, 1d8+3 damage)",
          "If you just updated the server, restart game-server to pick up the improved schema hint.",
        ].join(" "),
      );
    }

    if (
      (typeof message === "string" && message.includes("already spent their action")) ||
      text.includes("already spent their action")
    ) {
      throw new Error(
        [
          `HTTP ${res.status} ${res.statusText}: ${message ?? text}`,
          "You already used your action this turn.",
          "Run: end",
          "(then try another 'act ...' on your next turn)",
        ].join(" "),
      );
    }

    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }

  return JSON.parse(text) as T;
}

function parseDiceExpression(expr: string): { diceCount: number; diceSides: number; modifier: number } {
  const trimmed = expr.trim().toLowerCase();
  const m = /^([0-9]+)?d([0-9]+)([+-][0-9]+)?$/.exec(trimmed);
  if (!m) throw new Error("Invalid dice expression. Use NdM+K, e.g. 1d20+3");
  const diceCount = m[1] ? Number(m[1]) : 1;
  const diceSides = Number(m[2]);
  const modifier = m[3] ? Number(m[3]) : 0;

  if (!Number.isInteger(diceCount) || diceCount <= 0) throw new Error("diceCount must be a positive integer");
  if (!Number.isInteger(diceSides) || diceSides <= 0) throw new Error("diceSides must be a positive integer");
  if (!Number.isInteger(modifier)) throw new Error("modifier must be an integer");

  return { diceCount, diceSides, modifier };
}

function rollDice(spec: { diceCount: number; diceSides: number; modifier: number }): { rolls: number[]; total: number } {
  const rolls: number[] = [];
  for (let i = 0; i < spec.diceCount; i++) {
    rolls.push(1 + Math.floor(Math.random() * spec.diceSides));
  }
  const total = rolls.reduce((a, b) => a + b, 0) + spec.modifier;
  return { rolls, total };
}

function help(): void {
  output.write(
    [
      "\nDungeonMaster CLI (Phase 2: game-server test harness)",
      "Commands:",
      "  help                         Show this help",
      "  server <url>                 Set server base URL (default http://127.0.0.1:3000)",
      "  new [seed]                   Create a new session (optional storySeed)",
      "  use <sessionId>              Switch to an existing session",
      "  who                          Show current server/session/character",
      "  session                      Fetch and print session summary",
      "  characters                   List session characters",
      "  monsters                     List session monsters",
      "  spawn <name>                 Create a monster in session (e.g. goblin)",
      "  addchar <name> [class] [lvl]  Create character in session",
      "  as <id|name|#>               Select current character",
      "  sheet                        Print selected character sheet",
      "  combat start                 Start combat with all characters",
      "  combat state                 Show current encounter state",
      "  act <text>                   Natural language → parse + execute via /llm/act",
      "  end                          Alias for: act I end my turn",
      "  roll <NdM+K>                 Roll dice locally (e.g. 1d20+3, 2d6-1)",
      "  quit                         Exit",
      "\nNotes:",
      "- For 'act' to work, game-server must have LLM enabled (e.g. DM_OLLAMA_MODEL set).",
      "- Narration is attempted via /llm/narrate when configured.",
      ""
    ].join("\n")
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  let baseUrl = (args.server ?? process.env.DM_SERVER_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
  let sessionId: string | null = args.session ?? null;
  let characterId: string | null = args.character ?? null;
  let lastEncounterId: string | null = null;

  const rl = createInterface({ input, output });

  output.write(`\nConnected server: ${baseUrl}\n`);
  if (!sessionId) output.write("No session yet. Use: new\n");
  help();

  while (true) {
    const sessionTag = sessionId ? shortSessionTag(sessionId) : "no-session";

    let chars: SessionCharacterRecord[] = [];
    if (sessionId) {
      try {
        const s = await httpJson<SessionGetResponse>(`${baseUrl}/sessions/${sessionId}`);
        chars = s.characters;
      } catch {
        // ignore prompt failures
      }
    }

    const actorLabel = currentCharacterLabel(characterId, chars);
    const prompt = sessionId ? `${actorLabel} @ ${sessionTag}> ` : `DM> `;

    const line: string = String(await rl.question(`\n${prompt}`)).trim();
    if (!line) continue;

    const parts: string[] = line.split(" ");
    const cmd: string = parts[0] ?? "";
    const rest: string[] = parts.slice(1);
    const tail: string = rest.join(" ").trim();

    try {
      if (cmd === "quit" || cmd === "exit") {
        break;
      }

      if (cmd === "help") {
        help();
        continue;
      }

      if (cmd === "server") {
        if (!tail) {
          output.write(`Current server: ${baseUrl}\n`);
          continue;
        }
        baseUrl = tail.replace(/\/$/, "");
        output.write(`Server set to: ${baseUrl}\n`);
        continue;
      }

      if (cmd === "new") {
        const seed = tail ? Number(tail) : undefined;
        if (tail && (!Number.isFinite(seed) || !Number.isInteger(seed))) {
          output.write("seed must be an integer\n");
          continue;
        }

        const res = await httpJson<CreateSessionResponse>(`${baseUrl}/sessions`, {
          method: "POST",
          body: JSON.stringify({ storyFramework: {}, storySeed: seed }),
        });
        sessionId = res.id;
        characterId = null;
        lastEncounterId = null;
        output.write(`Created session: ${sessionId}\n`);
        continue;
      }

      if (cmd === "use") {
        if (!tail) {
          output.write("Usage: use <sessionId>\n");
          continue;
        }
        const token = tail.trim().replace(/[>\]]+$/g, "");
        await httpJson<SessionGetResponse>(`${baseUrl}/sessions/${token}`);
        sessionId = token;
        characterId = null;
        lastEncounterId = null;
        output.write(`Using session: ${sessionId}\n`);
        continue;
      }

      if (cmd === "who") {
        output.write(`Server: ${baseUrl}\n`);
        output.write(`Session: ${sessionId ?? "(none)"}\n`);
        output.write(`Character: ${characterId ?? "(none)"}\n`);
        if (lastEncounterId) output.write(`Encounter: ${lastEncounterId}\n`);
        continue;
      }

      if (cmd === "session") {
        if (!sessionId) throw new Error("No session. Run: new");
        const res = await httpJson<SessionGetResponse>(`${baseUrl}/sessions/${sessionId}`);
        output.write(`Session: ${res.session.id}\n`);
        output.write(`Characters: ${res.characters.length}\n`);
        output.write(`Monsters: ${res.monsters.length}\n`);
        continue;
      }

      if (cmd === "characters") {
        if (!sessionId) throw new Error("No session. Run: new");
        const res = await httpJson<SessionGetResponse>(`${baseUrl}/sessions/${sessionId}`);
        if (res.characters.length === 0) {
          output.write("(no characters)\n");
          continue;
        }
        for (let i = 0; i < res.characters.length; i++) {
          const c = res.characters[i]!;
          output.write(`${i + 1}) ${c.name}  (${c.className ?? "(no class)"} L${c.level})  id=${c.id}\n`);
        }
        continue;
      }

      if (cmd === "monsters") {
        if (!sessionId) throw new Error("No session. Run: new");
        const res = await httpJson<SessionGetResponse>(`${baseUrl}/sessions/${sessionId}`);
        if (res.monsters.length === 0) {
          output.write("(no monsters)\n");
          continue;
        }
        for (let i = 0; i < res.monsters.length; i++) {
          const m = res.monsters[i]!;
          output.write(`${i + 1}) ${m.name}  id=${m.id}\n`);
        }
        continue;
      }

      if (cmd === "spawn") {
        if (!sessionId) throw new Error("No session. Run: new");
        if (!tail) {
          output.write("Usage: spawn <name> (e.g. spawn goblin)\n");
          continue;
        }

        const name = tail.trim();

        // Minimal stat block required by ActionService: armorClass + abilityScores.
        // Keep this intentionally generic; you can later replace via monster imports/definitions.
        const statBlock = {
          armorClass: 13,
          abilityScores: {
            strength: 10,
            dexterity: 12,
            constitution: 10,
            intelligence: 10,
            wisdom: 10,
            charisma: 10,
          },
        };

        const created = await httpJson<SessionMonsterRecord>(`${baseUrl}/sessions/${sessionId}/monsters`, {
          method: "POST",
          body: JSON.stringify({ name, statBlock }),
        });

        output.write(`Spawned monster: ${created.name} id=${created.id}\n`);
        continue;
      }

      if (cmd === "addchar") {
        if (!sessionId) throw new Error("No session. Run: new");
        const name = rest[0];
        const className = rest[1] ?? "fighter";
        const levelRaw = rest[2];
        const level = levelRaw ? Number(levelRaw) : 1;

        if (!name) {
          output.write("Usage: addchar <name> [class] [level]\n");
          continue;
        }
        if (!Number.isInteger(level) || level <= 0) {
          output.write("level must be a positive integer\n");
          continue;
        }

        // Use the new LLM-powered character generation endpoint
        output.write(`Generating optimized ${className} character sheet for ${name}...\n`);
        
        const created = await httpJson<CreateCharacterResponse>(`${baseUrl}/sessions/${sessionId}/characters/generate`, {
          method: "POST",
          body: JSON.stringify({ name, className, level }),
        });

        characterId = created.id;
        output.write(`Created character: ${created.name} (Level ${level} ${className}) id=${created.id}\n`);
        continue;
      }

      if (cmd === "as") {
        if (!sessionId) throw new Error("No session. Run: new");
        if (!tail) {
          output.write("Usage: as <id|name|#>\n");
          continue;
        }
        const res = await httpJson<SessionGetResponse>(`${baseUrl}/sessions/${sessionId}`);
        const token = tail.trim();

        let nextId: string | null = null;
        const idx = Number(token);
        if (Number.isInteger(idx) && idx >= 1 && idx <= res.characters.length) {
          nextId = res.characters[idx - 1]?.id ?? null;
        } else {
          const byId = res.characters.find((c) => c.id === token) ?? null;
          if (byId) nextId = byId.id;

          if (!nextId) {
            const byName = res.characters.find((c) => c.name.toLowerCase() === token.toLowerCase()) ?? null;
            if (byName) nextId = byName.id;
          }
        }

        if (!nextId) {
          output.write(`Unknown character: ${token}\n`);
          continue;
        }

        characterId = nextId;
        const chosen = res.characters.find((c) => c.id === nextId) ?? null;
        output.write(`Selected character: ${chosen?.name ?? nextId}\n`);
        continue;
      }

      if (cmd === "sheet") {
        if (!sessionId) throw new Error("No session. Run: new");
        if (!characterId) {
          output.write("No character selected. Use: characters; as <#>\n");
          continue;
        }
        const res = await httpJson<SessionGetResponse>(`${baseUrl}/sessions/${sessionId}`);
        const c = res.characters.find((x) => x.id === characterId) ?? null;
        if (!c) {
          output.write("Selected character not found in session\n");
          continue;
        }
        output.write(`${c.name} (${c.className ?? "(no class)"} L${c.level})\n`);
        output.write(`${safeJsonStringify(c.sheet)}\n`);
        continue;
      }

      if (cmd === "combat") {
        if (!sessionId) throw new Error("No session. Run: new");
        const sub = rest[0];
        if (sub !== "start" && sub !== "state") {
          output.write("Usage: combat start | combat state\n");
          continue;
        }

        if (sub === "start") {
          const s = await httpJson<SessionGetResponse>(`${baseUrl}/sessions/${sessionId}`);
          if (s.characters.length === 0) {
            output.write("No characters in session. Use: addchar\n");
            continue;
          }

          const combatants = s.characters.map((c, i) => ({
            combatantType: "Character",
            characterId: c.id,
            initiative: null,
            hpCurrent: 10,
            hpMax: 10,
            conditions: [],
            resources: { actionSpent: false, index: i },
          }));

          const monsterCombatants = s.monsters.map((m, i) => ({
            combatantType: "Monster",
            monsterId: m.id,
            initiative: null,
            hpCurrent: 10,
            hpMax: 10,
            conditions: [],
            resources: { actionSpent: false, index: s.characters.length + i },
          }));

          const started = await httpJson<StartCombatResponse>(`${baseUrl}/sessions/${sessionId}/combat/start`, {
            method: "POST",
            body: JSON.stringify({ combatants: [...combatants, ...monsterCombatants] }),
          });

          lastEncounterId = (started as any).id ?? null;
          output.write(`Combat started. encounterId=${lastEncounterId ?? "(unknown)"}\n`);
          continue;
        }

        const encounterId = lastEncounterId;
        if (!encounterId) {
          output.write("No encounterId known yet. Run: combat start\n");
          continue;
        }
        const st = await httpJson<CombatStateResponse>(
          `${baseUrl}/sessions/${sessionId}/combat?encounterId=${encodeURIComponent(encounterId)}`,
        );
        output.write(`Encounter ${st.encounter?.id ?? ""} round=${st.encounter?.round} turn=${st.encounter?.turn}\n`);
        const active = st.activeCombatant;
        const activeLabel =
          active?.combatantType === "Character" ? `Character:${active.characterId}` : `Monster:${active.monsterId}`;
        output.write(`Active: ${activeLabel}\n`);
        continue;
      }

      if (cmd === "end") {
        if (!sessionId) throw new Error("No session. Run: new");
        const res = await httpJson<LlmActResponse>(`${baseUrl}/sessions/${sessionId}/llm/act`, {
          method: "POST",
          body: JSON.stringify({ text: "I end my turn" }),
        });
        output.write(`${safeJsonStringify(res.command)}\n`);
        output.write(`${safeJsonStringify(res.outcome)}\n`);

        try {
          const events = [{ type: "TurnEnded", payload: res.outcome }];
          const nar = await httpJson<LlmNarrateResponse>(`${baseUrl}/sessions/${sessionId}/llm/narrate`, {
            method: "POST",
            body: JSON.stringify({ events }),
          });
          output.write(`\n${nar.narrative}\n`);
        } catch {
          // narration optional
        }
        continue;
      }

      if (cmd === "act") {
        if (!sessionId) throw new Error("No session. Run: new");
        if (!tail) {
          output.write("Usage: act <text>\n");
          continue;
        }
        const res = await httpJson<LlmActResponse>(`${baseUrl}/sessions/${sessionId}/llm/act`, {
          method: "POST",
          body: JSON.stringify({ text: tail }),
        });
        output.write(`${safeJsonStringify(res.command)}\n`);
        output.write(`${safeJsonStringify(res.outcome)}\n`);

        try {
          const events =
            res.command.kind === "attack"
              ? [{ type: "AttackResolved", payload: { command: res.command, outcome: res.outcome } }]
              : [{ type: "TurnEnded", payload: { command: res.command, outcome: res.outcome } }];
          const nar = await httpJson<LlmNarrateResponse>(`${baseUrl}/sessions/${sessionId}/llm/narrate`, {
            method: "POST",
            body: JSON.stringify({ events }),
          });
          output.write(`\n${nar.narrative}\n`);
        } catch {
          // narration optional
        }
        continue;
      }

      if (cmd === "roll") {
        if (!tail) {
          output.write("Usage: roll <NdM+K> (e.g. 1d20+3)\n");
          continue;
        }
        const spec = parseDiceExpression(tail);
        const rolled = rollDice(spec);
        output.write(`Rolls: [${rolled.rolls.join(", ")}]`);
        if (spec.modifier !== 0) output.write(` ${spec.modifier >= 0 ? "+" : ""}${spec.modifier}`);
        output.write(` => Total: ${rolled.total}\n`);
        continue;
      }

      output.write(`Unknown command: ${cmd}. Type: help\n`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      output.write(`Error: ${msg}\n`);
      if (args.debug === "true") {
        output.write(`${safeJsonStringify(err)}\n`);
      }
    }
  }

  rl.close();
}

main().catch((e) => {
  output.write(`Fatal: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
});
