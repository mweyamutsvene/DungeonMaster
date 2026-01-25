import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

// ===== TYPE DEFINITIONS =====

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

type EncounterState = {
  encounter: { id: string; status: string; round: number; turn: number };
  combatants: any[];
  activeCombatant: any;
};

type TacticalCombatant = {
  id: string;
  name: string;
  combatantType: "Character" | "Monster" | "NPC";
  hp: { current: number; max: number };
  position: { x: number; y: number } | null;
  distanceFromActive: number | null;
  actionEconomy: {
    actionAvailable: boolean;
    bonusActionAvailable: boolean;
    reactionAvailable: boolean;
    movementRemainingFeet: number;
  };
  resourcePools: Array<{ name: string; current: number; max: number }>;
  movement: {
    speed: number;
    dashed: boolean;
    movementSpent: boolean;
  };
  turnFlags: {
    actionSpent: boolean;
    bonusActionUsed: boolean;
    reactionUsed: boolean;
    disengaged: boolean;
  };
};

type TacticalState = {
  encounterId: string;
  activeCombatantId: string;
  combatants: TacticalCombatant[];
  map: JsonValue | null;
};

type CombatQueryResponse = {
  answer: string;
  context?: JsonValue;
};

// ===== UTILITIES =====

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

async function httpJson<T>(
  url: string,
  init?: RequestInit,
  options?: { timeoutMs?: number },
): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? 120_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s: ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

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

    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }

  return JSON.parse(text) as T;
}

function print(msg: string): void {
  output.write(msg + "\n");
}

function banner(msg: string): void {
  print("\n" + "=".repeat(60));
  print(msg);
  print("=".repeat(60) + "\n");
}

// ===== MAIN CLI CLASS =====

class DungeonMasterCLI {
  private baseUrl: string;
  private sessionId: string | null = null;
  private characterId: string | null = null;
  private encounterId: string | null = null;
  private rl: ReturnType<typeof createInterface>;
  private characters: SessionCharacterRecord[] = [];
  private monsters: SessionMonsterRecord[] = [];

  private isAsking = false;
  private pendingNarration: string[] = [];
  private narrationSeq = 0;
  private lastWeaponHint: string | null = null;

  private async waitForTurnChange(opts?: { timeoutMs?: number }): Promise<void> {
    const timeoutMs = opts?.timeoutMs ?? 15_000;
    const started = Date.now();

    while (Date.now() - started < timeoutMs) {
      await this.delay(750);
      const state = await this.getCombatState();
      if (!state) return;
      const activeId = state.activeCombatant?.characterId || state.activeCombatant?.monsterId || state.activeCombatant?.npcId;
      if (activeId === this.characterId) {
        // Show any narration events that occurred during monster turns
        await this.showNarrative();
        return;
      }
    }
  }

  private extractWeaponHint(text: string): string {
    const t = text.toLowerCase();
    if (t.includes("unarmed") || t.includes("fist") || t.includes("punch") || t.includes("kick")) {
      return "bare hands";
    }
    if (t.includes("quarterstaff")) return "quarterstaff";
    if (t.includes("sword")) return "sword";
    if (t.includes("dagger")) return "dagger";
    if (t.includes("bow")) return "bow";
    return "attack";
  }

  private extractTargetHintFromText(text: string): string | null {
    const m = text.match(/against\s+([^!\n]+)!/i);
    if (m && m[1]) return m[1].trim();
    return null;
  }

  private async narratePhase(
    phase: string,
    input: { actorName?: string; targetName?: string; weapon?: string; text?: string; rollType?: string; resultText?: string },
    opts?: { timeoutMs?: number; seq?: number },
  ): Promise<void> {
    if (!this.sessionId) return;
    const seq = opts?.seq;

    const events = [
      {
        id: `cli-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        type: "CliNarrationRequest",
        payload: {
          phase,
          ...input,
          constraints: {
            doNotAssumeSuccessBeforeRoll: true,
            doNotInventWeaponsOrSpells: true,
            doNotReferToNarratorOrSayQuotesLikeNarratorIntones: true,
            keepOneToTwoSentences: true,
            doNotIssueDiceInstructions: true,
          },
        },
        createdAt: new Date().toISOString(),
      },
    ];

    try {
      const res = await httpJson<{ narrative: string }>(
        `${this.baseUrl}/sessions/${this.sessionId}/llm/narrate`,
        {
          method: "POST",
          body: JSON.stringify({ events }),
        },
        { timeoutMs: opts?.timeoutMs ?? 6000 },
      );

      if (seq !== undefined && seq !== this.narrationSeq) return;

      if (typeof res?.narrative === "string" && res.narrative.trim().length > 0) {
        const cleaned = this.sanitizeNarration(res.narrative, phase);
        if (cleaned.length > 0) this.enqueueNarration("\nNarrator: " + cleaned);
      }
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      // Keep this minimal; we want narration, but never hang.
      if (typeof msg === "string" && msg.includes("LLM narrative generator is not configured")) {
        this.enqueueNarration("\n(Narrator unavailable: server narration not configured)");
      }
    }
  }

  private sanitizeNarration(narrative: string, phase: string): string {
    let t = narrative.replace(/\s+/g, " ").trim();
    // Strip self-references.
    t = t.replace(/\bthe narrator\b/gi, "").replace(/\bnarrator\b/gi, "").replace(/\bintones\b/gi, "");
    // For prompt phases, strip explicit dice instructions.
    if (phase === "prompt_attack_roll" || phase === "prompt_damage_roll") {
      t = t.replace(/\broll\b[^.?!]*\b(d\d+|d20|d\d+\+\d+)\b[^.?!]*[.?!]?/gi, "").trim();
    }

    // For pre-roll phases, avoid implying a hit/impact.
    if (phase === "declare_action" || phase === "prompt_attack_roll") {
      t = t
        .replace(/\b(connects|connected|lands|landed|hits|hit|strikes|struck)\b/gi, "")
        .replace(/\s+/g, " ")
        .trim();
    }

    // If the player is fighting unarmed, strip obvious blade/weapon hallucinations
    // and avoid treating "unarmed strike" like a literal object.
    if (this.lastWeaponHint === "bare hands") {
      t = t
        .replace(/\b(unarmed strike)\b/gi, "fists")
        .replace(/\b(blade|blades|sword|steel|dagger|scimitar)\b/gi, "")
        .replace(/\s+/g, " ")
        .trim();
    }
    // Keep it short: first 2 sentences (or ~240 chars).
    const sentences = t.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
    t = sentences.slice(0, 2).join(" ").trim();
    if (t.length > 240) t = t.slice(0, 240).trim();
    return t;
  }

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.rl = createInterface({ input, output });
  }

  async run(): Promise<void> {
    banner("DUNGEONMASTER - Encounter Test Harness");
    print(`Server: ${this.baseUrl}`);
    print("LLM integration enabled for narrative and intent parsing.\n");

    await this.mainMenu();
    this.rl.close();
  }

  private async mainMenu(): Promise<void> {
    while (true) {
      print("\n=== MAIN MENU ===");
      print("1) Quick Encounter Setup (Fighter or Monk vs 2 Goblins)");
      print("2) View Session Info");
      print("3) Start Combat");
      print("4) Exit");
      
      const choice = await this.ask("Select option: ");
      
      if (choice === "1") {
        await this.setupQuickEncounter();
      } else if (choice === "2") {
        await this.viewSessionInfo();
      } else if (choice === "3") {
        if (!this.sessionId) {
          print("❌ No session. Run option 1 first.");
          continue;
        }
        await this.combatLoop();
      } else if (choice === "4") {
        print("Goodbye!");
        break;
      } else {
        print("Invalid choice.");
      }
    }
  }

  private async setupQuickEncounter(): Promise<void> {
    banner("QUICK ENCOUNTER SETUP");
    
    // 1. Create session
    print("Creating new session with LLM story framework...");
    const session = await httpJson<GameSessionRecord>(`${this.baseUrl}/sessions`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    this.sessionId = session.id;
    print(`✓ Session created: ${this.sessionId}`);

    // 2. Choose character class
    print("\nChoose your character:");
    print("1) Level 5 Fighter");
    print("2) Level 5 Monk");
    
    const classChoice = await this.ask("Select (1 or 2): ");
    const className = classChoice === "2" ? "monk" : "fighter";
    const name = className === "fighter" ? "Thorin Ironfist" : "Li Wei";
    
    print(`\nGenerating optimized level 5 ${className} character with LLM...`);
    
    const character = await httpJson<SessionCharacterRecord>(
      `${this.baseUrl}/sessions/${this.sessionId}/characters/generate`,
      {
        method: "POST",
        body: JSON.stringify({
          name,
          className,
          level: 5,
        }),
      },
    );
    this.characterId = character.id;
    this.characters = [character];
    print(`✓ Character created: ${character.name} (${className} level 5)`);

    // 3. Create two goblins
    print("\nSpawning 2 goblins...");
    
    const goblin1 = await httpJson<SessionMonsterRecord>(
      `${this.baseUrl}/sessions/${this.sessionId}/monsters`,
      {
        method: "POST",
        body: JSON.stringify({
          name: "Goblin Warrior",
          statBlock: {
            armorClass: 15,
            hp: 7,
            maxHp: 7,
            abilityScores: {
              strength: 8,
              dexterity: 14,
              constitution: 10,
              intelligence: 10,
              wisdom: 8,
              charisma: 8,
            },
            attacks: [
              {
                name: "Scimitar",
                kind: "melee",
                range: "melee",
                attackBonus: 4,
                damage: { diceCount: 1, diceSides: 6, modifier: 2 },
                damageType: "slashing",
              },
              {
                name: "Shortbow",
                kind: "ranged",
                range: "ranged",
                attackBonus: 4,
                damage: { diceCount: 1, diceSides: 6, modifier: 2 },
                damageType: "piercing",
              },
            ],
          },
        }),
      },
    );

    const goblin2 = await httpJson<SessionMonsterRecord>(
      `${this.baseUrl}/sessions/${this.sessionId}/monsters`,
      {
        method: "POST",
        body: JSON.stringify({
          name: "Goblin Archer",
          statBlock: {
            armorClass: 13,
            hp: 7,
            maxHp: 7,
            abilityScores: {
              strength: 8,
              dexterity: 14,
              constitution: 10,
              intelligence: 10,
              wisdom: 8,
              charisma: 8,
            },
            attacks: [
              {
                name: "Shortbow",
                kind: "ranged",
                range: "ranged",
                attackBonus: 4,
                damage: { diceCount: 1, diceSides: 6, modifier: 2 },
                damageType: "piercing",
              },
              {
                name: "Scimitar",
                kind: "melee",
                range: "melee",
                attackBonus: 4,
                damage: { diceCount: 1, diceSides: 6, modifier: 2 },
                damageType: "slashing",
              },
            ],
          },
        }),
      },
    );

    this.monsters = [goblin1, goblin2];
    print(`✓ Monsters spawned: ${goblin1.name}, ${goblin2.name}`);

    banner("ENCOUNTER READY");
    print(`Character: ${character.name} (${className} level 5)`);
    print(`Enemies: ${goblin1.name}, ${goblin2.name}`);
    print("\nReturn to main menu to start combat (option 3).");
  }

  private async viewSessionInfo(): Promise<void> {
    if (!this.sessionId) {
      print("❌ No active session.");
      return;
    }

    const session = await httpJson<{
      session: GameSessionRecord;
      characters: SessionCharacterRecord[];
      monsters: SessionMonsterRecord[];
    }>(`${this.baseUrl}/sessions/${this.sessionId}`);

    banner("SESSION INFO");
    print(`Session ID: ${session.session.id}`);
    print(`\nCharacters (${session.characters.length}):`);
    for (const char of session.characters) {
      print(`  - ${char.name} (${char.className} level ${char.level})`);
    }
    print(`\nMonsters (${session.monsters.length}):`);
    for (const mon of session.monsters) {
      print(`  - ${mon.name}`);
    }
  }

  private async combatLoop(): Promise<void> {
    if (!this.sessionId || !this.characterId) {
      print("❌ Missing session or character.");
      return;
    }

    banner("COMBAT START");
    print("The encounter begins! Rolling for initiative...");
    
    // Initiate combat with natural language
    const initiateResp = await httpJson<any>(
      `${this.baseUrl}/sessions/${this.sessionId}/combat/initiate`,
      {
        method: "POST",
        body: JSON.stringify({
          text: "I attack the goblins",
          actorId: this.characterId,
        }),
      },
    );

    if (initiateResp.requiresPlayerInput && initiateResp.rollType === "initiative") {
      print(`\n${initiateResp.message}`);
      const initRoll = await this.ask("Enter your d20 roll for initiative: ");
      
      const rollResp = await httpJson<any>(
        `${this.baseUrl}/sessions/${this.sessionId}/combat/roll-result`,
        {
          method: "POST",
          body: JSON.stringify({
            text: `I rolled ${initRoll}`,
            actorId: this.characterId,
          }),
        },
      );

      this.encounterId = rollResp.encounterId;
      
      print(`\n✓ ${rollResp.message}`);
      print("\n=== TURN ORDER ===");
      for (const turn of rollResp.turnOrder || []) {
        print(`  ${turn.actorName} (Initiative: ${turn.initiative})`);
      }
    }

    // Main combat loop
    while (true) {
      await this.delay(500);
      
      // Get current state
      const state = await this.getCombatState();
      if (!state) {
        print("\n❌ Combat ended or error getting state.");
        break;
      }

      print(`\n${"=".repeat(60)}`);
      print(`ROUND ${state.encounter.round} | Turn: ${state.activeCombatant?.combatantType}`);
      print(`${"=".repeat(60)}`);

      // Display combatants
      await this.displayCombatants(state);

      const activeId = state.activeCombatant?.characterId || 
                       state.activeCombatant?.monsterId || 
                       state.activeCombatant?.npcId;

      // Check if it's player's turn
      if (activeId === this.characterId) {
        await this.playerTurn(state);
      } else {
        print(`\nWaiting for ${state.activeCombatant?.combatantType}'s turn...`);
        // Monster AI runs on the server after the player ends their turn.
        // Poll until control returns to the player (or timeout).
        await this.waitForTurnChange({ timeoutMs: 20_000 });
      }

      // Check if combat is over
      const allMonstersDead = state.combatants
        .filter((c: any) => c.combatantType === "Monster")
        .every((c: any) => c.hpCurrent <= 0);
      
      const playerDead = state.combatants
        .filter((c: any) => c.combatantType === "Character")
        .every((c: any) => c.hpCurrent <= 0);

      if (allMonstersDead) {
        banner("VICTORY!");
        print("All enemies have been defeated!");
        break;
      }

      if (playerDead) {
        banner("DEFEAT");
        print("Your character has fallen...");
        break;
      }
    }

    print("\nReturning to main menu...");
  }

  private async playerTurn(state: EncounterState): Promise<void> {
    print("\n🎲 YOUR TURN");
    print("What would you like to do?");
    print("Examples:");
    print("  - 'I attack the Goblin Warrior with my sword'");
    print("  - 'I cast a spell at the Goblin Archer'");
    print("  - 'move to (20, 10)'");
    print("  - 'query which goblin is nearest?'");
    print("  - 'I end my turn'");

    const action = await this.ask("\nYour action: ");

    this.lastWeaponHint = this.extractWeaponHint(action);

    const runTacticalQuery = async (q: string): Promise<void> => {
      if (!this.sessionId || !this.encounterId || !this.characterId) return;
      const trimmed = q.trim();
      if (!trimmed) {
        print("\nPlease provide a question.");
        return;
      }

      let res: CombatQueryResponse;
      try {
        print("\nThinking...");
        res = await httpJson<CombatQueryResponse>(
          `${this.baseUrl}/sessions/${this.sessionId}/combat/query`,
          {
            method: "POST",
            body: JSON.stringify({
              query: trimmed,
              actorId: this.characterId,
              encounterId: this.encounterId,
            }),
          },
          { timeoutMs: 30_000 },
        );
      } catch (err: any) {
        print(`\nQuery failed: ${err?.message ?? String(err)}`);
        return;
      }

      print("\n=== TACTICAL ANALYSIS ===");
      print(res.answer);

      const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;

      const ctx = res.context as unknown;
      if (isRecord(ctx)) {
        const distances = ctx.distances;
        if (Array.isArray(distances) && distances.length > 0) {
          print("\n--- Distances ---");
          for (const d of distances) {
            if (!isRecord(d)) continue;
            const targetId = d.targetId;
            const distance = d.distance;
            if (typeof targetId === "string" && typeof distance === "number") {
              print(`  - ${targetId}: ${Math.round(distance)} ft`);
            }
          }
        }

        const oa = ctx.oaPrediction;
        if (isRecord(oa)) {
          const destination = oa.destination;
          const movementRequiredFeet = oa.movementRequiredFeet;
          const movementRemainingFeet = oa.movementRemainingFeet;

          const hasAnyOaFields =
            destination !== undefined || movementRequiredFeet !== undefined || movementRemainingFeet !== undefined;
          if (hasAnyOaFields) {
            print("\n--- OA Prediction ---");

            if (isRecord(destination) && typeof destination.x === "number" && typeof destination.y === "number") {
              print(`  destination: (${destination.x}, ${destination.y})`);
            }
            if (typeof movementRequiredFeet === "number") {
              print(`  movementRequiredFeet: ${Math.round(movementRequiredFeet)} ft`);
            }
            if (typeof movementRemainingFeet === "number") {
              print(`  movementRemainingFeet: ${Math.round(movementRemainingFeet)} ft`);
            }

            const oaRisks = oa.oaRisks;
            if (Array.isArray(oaRisks) && oaRisks.length > 0) {
              print("  risks:");
              for (const r of oaRisks) {
                if (!isRecord(r)) continue;
                const name = r.combatantName;
                const id = r.combatantId;
                const reach = r.reach;
                const hasReaction = r.hasReaction;
                const label = typeof name === "string" ? name : typeof id === "string" ? id : "(unknown)";
                const reachText = typeof reach === "number" ? `${Math.round(reach)}ft reach` : "unknown reach";
                const reactionText =
                  typeof hasReaction === "boolean"
                    ? hasReaction
                      ? "reaction available"
                      : "no reaction"
                    : "reaction unknown";
                print(`    - ${label}: ${reachText}, ${reactionText}`);
              }
            }
          }
        }
      }
    };

    // Tactical query (Phase 4)
    if (action.trim().toLowerCase().startsWith("query ")) {
      const q = action.trim().slice("query ".length).trim();
      await runTacticalQuery(q);
      return;
    }

    // Route question-like inputs to tactical query (no explicit 'query ' required).
    const trimmed = action.trim();
    const looksLikeQuestion =
      trimmed.endsWith("?") ||
      /^(which|what|who|where|when|why|how|can|should|is|are|do|does|did)\b/i.test(trimmed);
    if (looksLikeQuestion) {
      await runTacticalQuery(trimmed);
      return;
    }

    // Narrate the player's declared intent (non-blocking) for real actions only.
    const seq = ++this.narrationSeq;
    void this.narratePhase(
      "declare_action",
      {
        actorName: this.characters.find((c) => c.id === this.characterId)?.name ?? "Player",
        weapon: this.lastWeaponHint ?? undefined,
        text: action,
      },
      { timeoutMs: 2500, seq },
    );

    // Avoid sending ambiguous movement intents that often hang on slow LLM parsing.
    // For now, require explicit coordinates.
    const trimmedLower = trimmed.toLowerCase();
    const hasCoordinatePair = /\b\d+\s*,\s*\d+\b/.test(trimmed);
    if (trimmedLower.startsWith("move to") && !trimmed.includes("(") && !hasCoordinatePair) {
      print("\nPlease specify coordinates for movement, e.g. 'move to (20, 10)'.");
      return;
    }

    if (action.toLowerCase().includes("end")) {
      await httpJson(`${this.baseUrl}/sessions/${this.sessionId}/actions`, {
        method: "POST",
        body: JSON.stringify({
          kind: "endTurn",
          encounterId: this.encounterId,
          actor: { type: "Character", characterId: this.characterId },
        }),
      });
      print("✓ Turn ended.");
      return;
    }

    // Initiate action
    let actionResp: any;
    try {
      actionResp = await httpJson<any>(
        `${this.baseUrl}/sessions/${this.sessionId}/combat/action`,
        {
          method: "POST",
          body: JSON.stringify({
            text: action,
            actorId: this.characterId!,
            encounterId: this.encounterId!,
          }),
        },
        { timeoutMs: 30_000 },
      );
    } catch (err: any) {
      print(`\nAction failed: ${err?.message ?? String(err)}`);
      return;
    }

    // Handle two-phase movement (opportunity attacks)
    if (actionResp?.type === "REACTION_CHECK" && typeof actionResp?.pendingActionId === "string") {
      await this.handleReactionCheck(actionResp);
      return;
    }

    // Handle roll requests
    await this.handleRollSequence(actionResp);
  }

  private async handleRollSequence(response: any): Promise<void> {
    let currentResp = response;
    let lastPrintedMessage: string | null = null;
    const normalizeMessage = (m: string) => m.replace(/\s+/g, " ").trim();

    while (currentResp.requiresPlayerInput && currentResp.type === "REQUEST_ROLL") {
      const seq = ++this.narrationSeq;
      const msg = typeof currentResp.message === "string" ? currentResp.message : "";
      const targetName = this.extractTargetHintFromText(msg) ?? undefined;

      // Ask the narrator to set the scene WITHOUT claiming success.
      // Do not narrate the literal "Roll d20..." line; that's deterministic output.
      if (currentResp.rollType === "attack") {
        await this.narratePhase(
          "prompt_attack_roll",
          {
            targetName,
            weapon: this.lastWeaponHint ?? undefined,
            rollType: "attack",
            text: "Describe the wind-up and tension. Do not assume a hit. Do not tell the player what dice to roll.",
          },
          { timeoutMs: 4000, seq },
        );
      } else if (currentResp.rollType === "damage") {
        await this.narratePhase(
          "prompt_damage_roll",
          {
            targetName,
            weapon: this.lastWeaponHint ?? undefined,
            rollType: "damage",
            text: "Describe the impact. Do not tell the player what dice to roll.",
          },
          { timeoutMs: 4000, seq },
        );
      }

      if (typeof currentResp.message === "string" && currentResp.message.length > 0) {
        const normalized = normalizeMessage(currentResp.message);
        const normalizedLast = lastPrintedMessage ? normalizeMessage(lastPrintedMessage) : null;
        if (normalizedLast === null || normalized !== normalizedLast) {
          print(`\n${currentResp.message}`);
          lastPrintedMessage = currentResp.message;
        }
      }
      
      const rollPrompt = currentResp.rollType === "attack" 
        ? "Enter your d20 roll for the attack: "
        : currentResp.rollType === "damage"
        ? `Enter your damage roll (${currentResp.diceNeeded}): `
        : "Enter your roll: ";

      const roll = await this.ask(rollPrompt);
      // No extra narration here; keep prompts crisp and ordered.
      
      currentResp = await httpJson<any>(
        `${this.baseUrl}/sessions/${this.sessionId}/combat/roll-result`,
        {
          method: "POST",
          body: JSON.stringify({
            text: `I rolled ${roll}`,
            actorId: this.characterId!,
          }),
        },
        { timeoutMs: 30_000 },
      );
    }

    // Print the final result message once (e.g. damage applied) after the loop completes.
    if (typeof currentResp?.message === "string" && currentResp.message.length > 0) {
      const normalized = normalizeMessage(currentResp.message);
      const normalizedLast = lastPrintedMessage ? normalizeMessage(lastPrintedMessage) : null;
      if (normalizedLast === null || normalized !== normalizedLast) {
        print(`\n${currentResp.message}`);
      }

      // Narrate the outcome after the deterministic result prints.
      const seq = ++this.narrationSeq;
      void this.narratePhase(
        "resolve_roll",
        {
          resultText: currentResp.message,
          text: "Summarize the outcome in 1-2 sentences and ask what to do next.",
        },
        { timeoutMs: 5000, seq },
      );
    }
  }

  private async showNarrative(): Promise<void> {
    try {
      // Get recent events
      const events = await httpJson<any[]>(
        `${this.baseUrl}/sessions/${this.sessionId}/events-json?limit=10`,
        undefined,
        { timeoutMs: 10_000 },
      );

      if (!events || events.length === 0) return;

      // Request narrative from LLM
      const narResp = await httpJson<{ narrative: string }>(
        `${this.baseUrl}/sessions/${this.sessionId}/llm/narrate`,
        {
          method: "POST",
          body: JSON.stringify({ events }),
        },
        { timeoutMs: 15_000 },
      );

      if (narResp.narrative) {
        this.enqueueNarration("\n📖 " + narResp.narrative);
      }
    } catch (err) {
      // Narrative is optional; keep quiet to avoid spam.
    }
  }

  private enqueueNarration(message: string): void {
    if (this.isAsking) {
      this.pendingNarration.push(message);
      return;
    }
    print(message);
  }

  private async handleReactionCheck(resp: any): Promise<void> {
    if (!this.sessionId || !this.encounterId) return;

    const pendingActionId = resp.pendingActionId as string;
    const opportunities = Array.isArray(resp.opportunityAttacks) ? resp.opportunityAttacks : [];
    const actionable = opportunities.filter((o: any) => o && o.canAttack === true);

    print("\n⚠️  REACTION OPPORTUNITY DETECTED");
    if (actionable.length === 0) {
      print("No actionable reactions reported; completing move...");
    }

    for (const opp of actionable) {
      const name = typeof opp.combatantName === "string" ? opp.combatantName : opp.combatantId;
      const id = typeof opp.combatantId === "string" ? opp.combatantId : "";
      const opportunityId = typeof opp.opportunityId === "string" ? opp.opportunityId : "";
      if (!id || !opportunityId) continue;

      const ans = (await this.ask(`Allow ${name} Opportunity Attack? (y/n): `)).trim().toLowerCase();
      const choice = ans === "y" || ans === "yes" ? "use" : "decline";

      await httpJson(
        `${this.baseUrl}/encounters/${this.encounterId}/reactions/${pendingActionId}/respond`,
        {
          method: "POST",
          body: JSON.stringify({
            combatantId: id,
            opportunityId,
            choice,
          }),
        },
        { timeoutMs: 15_000 },
      );
    }

    const completed = await httpJson<any>(
      `${this.baseUrl}/sessions/${this.sessionId}/combat/move/complete`,
      {
        method: "POST",
        body: JSON.stringify({ pendingActionId }),
      },
      { timeoutMs: 30_000 },
    );

    if (completed?.message) {
      print(`\n${completed.message}`);
    }

    const executed = Array.isArray(completed?.opportunityAttacks) ? completed.opportunityAttacks : [];
    if (executed.length > 0) {
      print("\n=== OPPORTUNITY ATTACKS ===");
      for (const oa of executed) {
        const attacker = oa.attackerName ?? oa.attackerId ?? "Attacker";
        const damage = typeof oa.damage === "number" ? oa.damage : 0;
        print(`  - ${attacker} hits for ${damage} damage`);
      }
    }

    // Narrative is optional; do not block movement flow
    void this.showNarrative();
  }

  private async displayCombatants(state: EncounterState): Promise<void> {
    print("\n=== COMBATANTS ===");

    const tactical = await this.getTacticalState();
    if (tactical) {
      const active = tactical.combatants.find((c) => c.id === tactical.activeCombatantId) ?? null;
      if (active?.position) {
        print(`Active position: (${active.position.x}, ${active.position.y})`);
      }

      if (active?.actionEconomy) {
        const ae = active.actionEconomy;
        const flags = active.turnFlags;
        print(
          [
            `Turn economy:`,
            `Action ${ae.actionAvailable ? "ready" : "spent"}`, 
            `Bonus ${ae.bonusActionAvailable ? "ready" : "used"}`,
            `Reaction ${ae.reactionAvailable ? "ready" : "used"}`,
            `Move ${Math.round(ae.movementRemainingFeet)} ft`,
            flags?.disengaged ? "(disengaged)" : "",
          ]
            .filter(Boolean)
            .join(" | "),
        );
      }

      if (active?.resourcePools && active.resourcePools.length > 0) {
        const summary = active.resourcePools
          .map((p) => `${p.name}: ${p.current}/${p.max}`)
          .join(" | ");
        print(`Resources: ${summary}`);
      }

      for (const c of tactical.combatants) {
        const hp = `${c.hp.current}/${c.hp.max}`;
        const status = c.hp.current <= 0 ? " [DEFEATED]" : "";
        const isActive = c.id === tactical.activeCombatantId ? " [ACTIVE]" : "";
        const pos = c.position ? `(${c.position.x}, ${c.position.y})` : "(no position)";
        const dist = c.distanceFromActive !== null ? ` | ${Math.round(c.distanceFromActive)} ft` : "";
        print(`  ${c.name}: HP ${hp} | ${pos}${dist}${status}${isActive}`);
      }
      return;
    }

    // Fallback to legacy display
    for (const combatant of state.combatants) {
      const name = combatant.characterId 
        ? this.characters.find((c) => c.id === combatant.characterId)?.name || "Character"
        : this.monsters.find((m) => m.id === combatant.monsterId)?.name || "Monster";

      const hp = `${combatant.hpCurrent}/${combatant.hpMax}`;
      const status = combatant.hpCurrent <= 0 ? " [DEFEATED]" : "";
      const active = combatant.id === state.activeCombatant?.id ? " [ACTIVE]" : "";

      print(`  ${name}: HP ${hp}${status}${active}`);
    }
  }

  private async getTacticalState(): Promise<TacticalState | null> {
    try {
      if (!this.sessionId || !this.encounterId) return null;
      return await httpJson<TacticalState>(
        `${this.baseUrl}/sessions/${this.sessionId}/combat/${this.encounterId}/tactical`,
        undefined,
        { timeoutMs: 10_000 },
      );
    } catch {
      return null;
    }
  }

  private async getCombatState(): Promise<EncounterState | null> {
    try {
      if (!this.sessionId || !this.encounterId) return null;
      
      return await httpJson<EncounterState>(
        `${this.baseUrl}/sessions/${this.sessionId}/combat?encounterId=${this.encounterId}`,
        undefined,
        { timeoutMs: 10_000 },
      );
    } catch (err) {
      return null;
    }
  }

  private async ask(question: string): Promise<string> {
    this.isAsking = true;
    try {
      return (await this.rl.question(question)).trim();
    } finally {
      this.isAsking = false;
      if (this.pendingNarration.length > 0) {
        const toFlush = [...this.pendingNarration];
        this.pendingNarration = [];
        for (const m of toFlush) print(m);
      }
    }
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private createFighterSheet(): any {
    return {
      maxHp: 47,
      armorClass: 18,
      speed: 30,
      proficiencyBonus: 3,
      abilityScores: {
        strength: 16,
        dexterity: 14,
        constitution: 15,
        intelligence: 10,
        wisdom: 12,
        charisma: 8,
      },
      savingThrows: {
        strength: 6,
        constitution: 5,
      },
      skills: {
        athletics: 6,
        intimidation: 2,
        perception: 4,
      },
      weapons: [
        {
          name: "Longsword",
          attackBonus: 6,
          damageFormula: "1d8+3",
          damageType: "slashing",
          properties: ["versatile"],
        },
        {
          name: "Longbow",
          attackBonus: 5,
          damageFormula: "1d8+2",
          damageType: "piercing",
          range: { normal: 150, long: 600 },
        },
      ],
      features: [
        { name: "Fighting Style (Dueling)", description: "+2 damage with one-handed weapon" },
        { name: "Second Wind", description: "Bonus action: regain 1d10+5 HP (1/short rest)" },
        { name: "Action Surge", description: "Take an additional action (1/short rest)" },
        { name: "Extra Attack", description: "Attack twice when you take the Attack action" },
      ],
    };
  }

  private createMonkSheet(): any {
    return {
      maxHp: 38,
      armorClass: 16,
      speed: 45,
      proficiencyBonus: 3,
      abilityScores: {
        strength: 10,
        dexterity: 16,
        constitution: 14,
        intelligence: 11,
        wisdom: 16,
        charisma: 8,
      },
      savingThrows: {
        strength: 3,
        dexterity: 6,
      },
      skills: {
        acrobatics: 6,
        insight: 6,
        stealth: 6,
      },
      kiPoints: 5,
      martialArts: "1d6",
      unarmedStrike: {
        name: "Unarmed Strike",
        attackBonus: 6,
        damageFormula: "1d6+3",
        damageType: "bludgeoning",
      },
      weapons: [
        {
          name: "Quarterstaff",
          attackBonus: 6,
          damageFormula: "1d6+3",
          damageType: "bludgeoning",
          properties: ["versatile", "monk"],
        },
      ],
      features: [
        { name: "Martial Arts", description: "Use DEX for unarmed strikes and monk weapons, bonus action unarmed strike after Attack action" },
        { name: "Ki", description: "5 ki points per short rest" },
        { name: "Flurry of Blows", description: "1 ki: 2 unarmed strikes as bonus action" },
        { name: "Patient Defense", description: "1 ki: Dodge as bonus action" },
        { name: "Step of the Wind", description: "1 ki: Disengage or Dash as bonus action, double jump distance" },
        { name: "Unarmored Defense", description: "AC = 10 + DEX + WIS" },
        { name: "Deflect Missiles", description: "Reduce ranged damage by 1d10+8" },
        { name: "Slow Fall", description: "Reduce fall damage by 25" },
        { name: "Extra Attack", description: "Attack twice when you take the Attack action" },
        { name: "Stunning Strike", description: "1 ki: Force CON save (DC 14) or be stunned" },
      ],
    };
  }
}

// ===== MAIN ENTRY POINT =====

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = args.server ?? process.env.DM_SERVER_URL ?? "http://127.0.0.1:3001";

  const cli = new DungeonMasterCLI(baseUrl);
  await cli.run();
}

main().catch((e) => {
  output.write(`Fatal error: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
});
