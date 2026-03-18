/**
 * Combat REPL — Event-Driven State Machine
 *
 * Handles the full interactive combat loop:
 *   IDLE → INITIATIVE → WAITING_FOR_TURN ↔ PLAYER_TURN ↔ ROLL_PROMPT
 *   ↕ REACTION_PROMPT / MOVE_REACTION → COMBAT_OVER
 *
 * Uses SSE EventStream for real-time AI turn display instead of polling.
 */

import type { Interface as ReadlineInterface } from "node:readline/promises";
import type { GameClient } from "./game-client.js";
import type { EventStream } from "./event-stream.js";
import type {
  CLIOptions,
  ActionResponse,
  TacticalState,
  TacticalCombatant,
  SessionCharacterRecord,
  SessionMonsterRecord,
  SessionNPCRecord,
  GameEvent,
  ReactionPendingAction,
} from "./types.js";
import {
  print,
  printColored,
  colors,
  banner,
  printSuccess,
  printError,
  printWarning,
  printNarration,
  printRollRequest,
  printActionResult,
  printTurnOrder,
  printTacticalState,
  printPlayerTurnPrompt,
  printQueryResponse,
  printVictory,
  printDefeat,
  displayEvent,
} from "./display.js";

// ============================================================================
// Types
// ============================================================================

export interface CombatContext {
  sessionId: string;
  characterId: string;
  encounterId: string | null;
  characters: SessionCharacterRecord[];
  monsters: SessionMonsterRecord[];
  npcs: SessionNPCRecord[];
}

type CombatState =
  | "IDLE"
  | "INITIATIVE_ROLL"
  | "WAITING_FOR_TURN"
  | "PLAYER_TURN"
  | "ROLL_PROMPT"
  | "MOVE_REACTION"
  | "REACTION_PROMPT"
  | "COMBAT_OVER";

// ============================================================================
// Combat REPL
// ============================================================================

export class CombatREPL {
  private state: CombatState = "IDLE";
  private eventStream: EventStream | null = null;
  private handledReactions = new Set<string>();
  private playerCombatantId: string | null = null;

  constructor(
    private readonly client: GameClient,
    private readonly ctx: CombatContext,
    private readonly options: CLIOptions,
    private readonly rl: ReadlineInterface,
  ) {}

  // ==========================================================================
  // Main Entry Point
  // ==========================================================================

  async run(): Promise<"quit" | "menu"> {
    banner("COMBAT START");
    print("The encounter begins! Rolling for initiative...\n");

    try {
      // Connect SSE stream
      const stream = this.client.connectEventStream(this.ctx.sessionId);
      this.eventStream = stream;
      try {
        await stream.connect();
      } catch (err) {
        printError(`Failed to connect event stream: ${err instanceof Error ? err.message : String(err)}`);
        printWarning("Continuing without real-time events (will use polling).");
        this.eventStream = null;
      }

      // Phase 1: Initiative
      await this.initiativePhase();

      if (this.state === "COMBAT_OVER") {
        return await this.postCombatLoop();
      }

      // Phase 2: Main combat loop
      await this.combatLoop();
    } finally {
      this.eventStream?.close();
    }

    // Phase 3: Post-combat loop
    return await this.postCombatLoop();
  }

  // ==========================================================================
  // Post-Combat Loop
  // ==========================================================================

  private async postCombatLoop(): Promise<"quit" | "menu"> {
    while (true) {
      print(`
${colors.bold}What would you like to do?${colors.reset}
  ${colors.cyan}1${colors.reset}) Take a short rest
  ${colors.cyan}2${colors.reset}) Take a long rest
  ${colors.cyan}3${colors.reset}) View character status
  ${colors.cyan}4${colors.reset}) Return to main menu
  ${colors.cyan}5${colors.reset}) Quit
`);

      const choice = await this.ask("Choose: ");

      switch (choice) {
        case "1":
        case "short rest":
        case "rest short":
          await this.handleRestCommand("short");
          break;
        case "2":
        case "long rest":
        case "rest long":
          await this.handleRestCommand("long");
          break;
        case "3":
        case "status":
          this.printStatusCommand();
          break;
        case "4":
        case "menu":
          return "menu";
        case "5":
        case "quit":
        case "exit":
          return "quit";
        default:
          printWarning("Invalid choice.");
      }
    }
  }

  // ==========================================================================
  // Initiative Phase
  // ==========================================================================

  private async initiativePhase(): Promise<void> {
    this.state = "INITIATIVE_ROLL";

    const initiateResp = await this.client.initiateCombat(this.ctx.sessionId, {
      text: "I attack the enemies",
      actorId: this.ctx.characterId,
    });

    if (initiateResp.requiresPlayerInput && initiateResp.rollType === "initiative") {
      printRollRequest(initiateResp, { suppress: this.options.noNarration });
      const initRoll = await this.ask("Enter your d20 roll for initiative: ");

      const rollResp = await this.client.submitRoll(this.ctx.sessionId, {
        text: `I rolled ${initRoll}`,
        actorId: this.ctx.characterId,
      });

      this.ctx.encounterId = rollResp.encounterId ?? null;
      printNarration(rollResp.narration, { suppress: this.options.noNarration });
      printSuccess(rollResp.message);

      if (rollResp.turnOrder) {
        printTurnOrder(rollResp.turnOrder);
      }

      // Determine our combatant ID from the tactical view
      await this.resolvePlayerCombatantId();

      this.state = "WAITING_FOR_TURN";
    }
  }

  // ==========================================================================
  // Main Combat Loop (Event-Driven)
  // ==========================================================================

  private async combatLoop(): Promise<void> {
    while (this.state !== "COMBAT_OVER") {
      // Check whose turn it is
      const tactical = await this.fetchTactical();
      if (!tactical) {
        printError("Failed to get combat state.");
        break;
      }

      // Check for combat end
      if (tactical.status === "Victory" || tactical.status === "Defeat") {
        this.handleCombatEnd(tactical.status);
        break;
      }

      const activeCombatant = tactical.combatants.find(
        (c) => c.id === tactical.activeCombatantId,
      );

      if (this.isPlayerCombatant(activeCombatant)) {
        // Player's turn
        this.state = "PLAYER_TURN";
        await this.playerTurn(tactical);
      } else {
        // AI turn — listen for events until it's the player's turn again
        this.state = "WAITING_FOR_TURN";
        await this.waitForPlayerTurn(tactical);
      }
    }
  }

  // ==========================================================================
  // Player Turn
  // ==========================================================================

  private async playerTurn(tactical: TacticalState): Promise<void> {
    // Display the current state
    printTacticalState(tactical);
    printPlayerTurnPrompt();

    while (this.state === "PLAYER_TURN") {
      const input = await this.ask("\n> ");
      if (!input) continue;

      // Handle special commands
      if (this.isEndTurnCommand(input)) {
        await this.handleEndTurn();
        return;
      }

      const cmd = input.toLowerCase().trim();

      if (cmd === "help" || cmd === "?") {
        this.printHelp();
        continue;
      }

      if (cmd === "status") {
        this.printStatusCommand();
        continue;
      }

      if (cmd === "spells") {
        this.printSpellsCommand();
        continue;
      }

      if (cmd === "abilities") {
        await this.printAbilitiesCommand();
        continue;
      }

      if (cmd === "inventory" || cmd === "inv" || cmd === "items") {
        await this.printInventoryCommand();
        continue;
      }

      if (cmd === "rest short" || cmd === "rest long") {
        await this.handleRestCommand(cmd === "rest long" ? "long" : "short");
        continue;
      }

      if (cmd === "rest") {
        printWarning("Usage: 'rest short' or 'rest long'");
        continue;
      }

      if (cmd === "tactical" || cmd === "map" || cmd === "look") {
        const tact = await this.fetchTactical();
        if (tact) printTacticalState(tact);
        continue;
      }

      if (this.looksLikeQuestion(input)) {
        await this.handleQuestion(input);
        continue;
      }

      // Submit action to the server
      await this.handleAction(input);

      // Re-check state if we completed an action — might have killed everyone
      if (this.state === "PLAYER_TURN") {
        const updated = await this.fetchTactical();
        if (updated) {
          if (updated.status === "Victory" || updated.status === "Defeat") {
            this.handleCombatEnd(updated.status);
            return;
          }
          // Check if turn has moved on (e.g., combat ended or extra attack available)
          const stillOurTurn = this.isPlayerCombatant(
            updated.combatants.find((c) => c.id === updated.activeCombatantId),
          );
          if (!stillOurTurn) {
            this.state = "WAITING_FOR_TURN";
            return;
          }
        }
      }
    }
  }

  // ==========================================================================
  // Action Handling
  // ==========================================================================

  private async handleAction(input: string): Promise<void> {
    if (!this.ctx.encounterId) {
      printError("No active encounter.");
      return;
    }

    let resp: ActionResponse;
    try {
      resp = await this.client.submitAction(this.ctx.sessionId, {
        text: input,
        actorId: this.ctx.characterId,
        encounterId: this.ctx.encounterId,
      });
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
      return;
    }

    // Check for reaction check (e.g., monster OA on player move)
    if (resp.type === "REACTION_CHECK" && resp.pendingActionId) {
      printNarration(resp.narration, { suppress: this.options.noNarration });
      await this.handleMoveReaction(resp);
      return;
    }

    // If the server wants a roll, enter the roll prompt loop
    if (resp.requiresPlayerInput && resp.rollType) {
      // narration will be shown by printRollRequest inside rollPromptLoop
      await this.rollPromptLoop(resp);
      return;
    }

    // Action completed — show narration + result once
    printNarration(resp.narration, { suppress: this.options.noNarration });
    if (resp.message) {
      printActionResult(resp, { suppressNarration: true });
    }

    // Display hit rider results (Stunning Strike, Open Hand Technique, etc.)
    this.displayHitRiders(resp);

    // Check combat end
    if (resp.combatEnded) {
      this.handleCombatEnd(resp.victoryStatus ?? "ended");
    }
  }

  // ==========================================================================
  // Roll Prompt Loop
  // ==========================================================================

  private async rollPromptLoop(initialResp: ActionResponse): Promise<void> {
    this.state = "ROLL_PROMPT";
    let resp = initialResp;

    while (resp.requiresPlayerInput && resp.rollType) {
      printRollRequest(resp, { suppress: this.options.noNarration });

      // Show eligible on-hit enhancements when a hit is confirmed (2024 post-hit flow)
      if (resp.eligibleEnhancements && resp.eligibleEnhancements.length > 0) {
        this.displayEligibleEnhancements(resp.eligibleEnhancements);
      }

      const diceHint = resp.diceNeeded ?? this.inferDiceHint(resp.rollType);
      const rollInput = await this.askForRoll(
        `Enter your ${diceHint} roll for ${resp.rollType}: `,
        resp.rollType,
      );

      resp = await this.client.submitRoll(this.ctx.sessionId, {
        text: `I rolled ${rollInput}`,
        actorId: this.ctx.characterId,
      });

      // Display result (message only — narration already shown by printRollRequest)
      if (resp.message) {
        printActionResult(resp, { suppressNarration: true });
      }

      // Display hit rider results (Stunning Strike, Open Hand Technique, etc.)
      this.displayHitRiders(resp);

      // Check combat end
      if (resp.combatEnded) {
        this.handleCombatEnd(resp.victoryStatus ?? "ended");
        return;
      }
    }

    this.state = "PLAYER_TURN";
  }

  // ==========================================================================
  // End Turn
  // ==========================================================================

  private async handleEndTurn(): Promise<void> {
    if (!this.ctx.encounterId) {
      printError("No active encounter.");
      return;
    }

    try {
      await this.client.endTurn(this.ctx.sessionId, {
        encounterId: this.ctx.encounterId,
        characterId: this.ctx.characterId,
      });
      printSuccess("Turn ended.");
      this.state = "WAITING_FOR_TURN";
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
    }
  }

  // ==========================================================================
  // Wait For Player Turn (Event-Driven)
  // ==========================================================================

  private async waitForPlayerTurn(tactical: TacticalState): Promise<void> {
    if (!this.ctx.encounterId) return;

    // Fall back to polling if SSE is not available
    if (!this.eventStream || !this.eventStream.isConnected) {
      await this.pollForPlayerTurn();
      return;
    }

    print(`\n${colors.dim}Waiting for other combatants...${colors.reset}`);

    // Register event display handlers
    const displayHandler = (event: GameEvent) => {
      displayEvent(event, { suppress: this.options.noNarration });
    };

    const displayTypes = [
      "AiDecision", "AttackResolved", "DamageApplied", "HealingApplied",
      "Move", "TurnAdvanced", "DeathSave", "ActionResolved",
      "OpportunityAttack", "ShieldCast", "DeflectAttacks",
      "ConcentrationBroken", "ConcentrationMaintained",
      "NarrativeText", "ReactionResolved",
    ];

    for (const type of displayTypes) {
      this.eventStream.on(type, displayHandler);
    }

    try {
      // Wait for either player turn, reaction prompt, or combat end
      while (this.state === "WAITING_FOR_TURN") {
        const event = await this.eventStream.waitFor(
          ["TurnAdvanced", "ReactionPrompt", "CombatEnded"],
          undefined,
          120_000,
        );

        if (event.type === "CombatEnded") {
          const result = event.payload.result as string ?? "ended";
          this.handleCombatEnd(result);
          return;
        }

        if (event.type === "ReactionPrompt") {
          // Check if this is for our character
          const pendingActionId = event.payload.pendingActionId as string;
          if (this.handledReactions.has(pendingActionId)) continue;

          const opportunity = event.payload.reactionOpportunity as Record<string, unknown> | undefined;
          const combatantId = opportunity?.combatantId as string | undefined;

          if (combatantId && combatantId === this.playerCombatantId) {
            // Hold events while handling the reaction — the AI turn may
            // complete and emit TurnAdvanced while we're awaiting user input.
            // Without buffering, that event would be lost (no waitFor listener).
            this.eventStream.holdEvents();
            try {
              await this.handleReactionPrompt(event);
            } finally {
              this.eventStream.releaseEvents();
            }
            // Loop back — waitFor will check the replay buffer first,
            // so any TurnAdvanced that fired during the reaction is caught.
            continue;
          }
          continue;
        }

        if (event.type === "TurnAdvanced") {
          // Check if it's now our turn by fetching tactical
          // Small delay to let server state settle
          await this.delay(200);
          const updated = await this.fetchTactical();
          if (!updated) continue;

          if (updated.status === "Victory" || updated.status === "Defeat") {
            this.handleCombatEnd(updated.status);
            return;
          }

          const activeCombatant = updated.combatants.find(
            (c) => c.id === updated.activeCombatantId,
          );

          if (this.isPlayerCombatant(activeCombatant)) {
            this.state = "PLAYER_TURN";
            return;
          }
        }
      }
    } catch (err) {
      // Timeout or error — fall back to polling
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("timed out")) {
        printWarning("Waiting for AI turns is taking a long time. Checking state...");
        // Fall through — combatLoop will re-check tactical state
        return;
      }
      throw err;
    } finally {
      // Clean up display handlers
      if (this.eventStream) {
        for (const type of displayTypes) {
          this.eventStream.off(type, displayHandler);
        }
      }
    }
  }

  /**
   * Polling fallback for when SSE is not available.
   */
  private async pollForPlayerTurn(): Promise<void> {
    print(`\n${colors.dim}Waiting for other combatants (polling)...${colors.reset}`);

    for (let i = 0; i < 120; i++) { // max ~2 minutes
      await this.delay(1000);
      const tactical = await this.fetchTactical();
      if (!tactical) continue;

      if (tactical.status === "Victory" || tactical.status === "Defeat") {
        this.handleCombatEnd(tactical.status);
        return;
      }

      const active = tactical.combatants.find((c) => c.id === tactical.activeCombatantId);
      if (this.isPlayerCombatant(active)) {
        this.state = "PLAYER_TURN";
        return;
      }
    }

    printWarning("Timed out waiting for player turn.");
  }

  // ==========================================================================
  // Move Reaction Handling (monster OA on player move)
  // ==========================================================================

  private async handleMoveReaction(resp: ActionResponse): Promise<void> {
    this.state = "MOVE_REACTION";
    const pendingActionId = resp.pendingActionId!;
    const opportunities = resp.opportunityAttacks ?? [];

    for (const opp of opportunities) {
      if (!opp.canAttack) continue;

      const name = opp.combatantName ?? "Enemy";
      const choice = await this.ask(
        `${colors.yellow}⚡ ${name} can take an Opportunity Attack! Allow? (y/n): ${colors.reset}`,
      );

      const useReaction = choice.toLowerCase().startsWith("y");
      try {
        await this.client.respondToReaction(this.ctx.encounterId!, pendingActionId, {
          combatantId: opp.combatantId,
          opportunityId: opp.opportunityId,
          choice: useReaction ? "use" : "decline",
        });
      } catch (err) {
        printError(`Reaction failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Complete the move
    try {
      let moveResp = await this.client.completeMove(this.ctx.sessionId, { pendingActionId });

      // Handle any player rolls needed (e.g., for OA damage resolution on player move)
      while (moveResp.requiresPlayerInput && moveResp.rollType) {
        printRollRequest(moveResp, { suppress: this.options.noNarration });
        const diceHint = moveResp.diceNeeded ?? this.inferDiceHint(moveResp.rollType);
        const rollInput = await this.ask(`Enter your ${diceHint} roll for ${moveResp.rollType}: `);

        moveResp = await this.client.completeMove(this.ctx.sessionId, {
          pendingActionId,
          roll: parseInt(rollInput, 10),
          rollType: moveResp.rollType,
        });

        if (moveResp.message) {
          printActionResult(moveResp, { suppress: this.options.noNarration });
        }
      }

      if (moveResp.message) {
        printActionResult(moveResp, { suppress: this.options.noNarration });
      }
    } catch (err) {
      printError(`Move completion failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    this.state = "PLAYER_TURN";
  }

  // ==========================================================================
  // Reaction Prompt (player reaction on monster action)
  // ==========================================================================

  private async handleReactionPrompt(event: GameEvent): Promise<void> {
    this.state = "REACTION_PROMPT";

    const pendingActionId = event.payload.pendingActionId as string;
    const actorName = event.payload.actorName as string ?? "Enemy";
    const opportunity = event.payload.reactionOpportunity as Record<string, unknown> | undefined;
    const reactionType = opportunity?.reactionType as string ?? "reaction";
    const combatantId = opportunity?.combatantId as string ?? "";

    this.handledReactions.add(pendingActionId);

    // Describe the reaction opportunity
    let prompt: string;
    switch (reactionType) {
      case "opportunity_attack":
        prompt = `${colors.yellow}⚡ ${actorName} is moving away! Take an Opportunity Attack? (y/n): ${colors.reset}`;
        break;
      case "shield":
      case "shield_spell":
        prompt = `${colors.cyan}🛡️ ${actorName} attacks you! Cast Shield to raise AC? (y/n): ${colors.reset}`;
        break;
      case "deflect_attacks":
        prompt = `${colors.cyan}🤚 ${actorName} hits you! Use Deflect Attacks? (y/n): ${colors.reset}`;
        break;
      case "counterspell":
        prompt = `${colors.magenta}✋ ${actorName} is casting a spell! Counterspell? (y/n): ${colors.reset}`;
        break;
      case "absorb_elements":
        prompt = `${colors.blue}🔮 You take elemental damage! Use Absorb Elements? (y/n): ${colors.reset}`;
        break;
      case "hellish_rebuke":
        prompt = `${colors.red}🔥 ${actorName} damages you! Use Hellish Rebuke? (y/n): ${colors.reset}`;
        break;
      default:
        prompt = `${colors.yellow}⚡ Reaction available (${reactionType})! Use it? (y/n): ${colors.reset}`;
    }

    const choice = await this.ask(prompt);
    const useReaction = choice.toLowerCase().startsWith("y");

    // We need the opportunityId, which may be in the reaction opportunity
    const opportunityId = opportunity?.opportunityId as string
      ?? opportunity?.id as string
      ?? combatantId; // fallback

    try {
      const result = await this.client.respondToReaction(
        this.ctx.encounterId!,
        pendingActionId,
        {
          combatantId,
          opportunityId,
          choice: useReaction ? "use" : "decline",
        },
      );

      if (result.message) {
        print(result.message);
      }

      // If this is a player OA and they chose "use", we need to roll
      if (useReaction && reactionType === "opportunity_attack") {
        await this.handleOpportunityAttackRolls(pendingActionId);
      }
    } catch (err) {
      printError(`Reaction failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    this.state = "WAITING_FOR_TURN";
  }

  /**
   * Submit player opportunity attack rolls via move/complete.
   */
  private async handleOpportunityAttackRolls(pendingActionId: string): Promise<void> {
    // First call to get the roll request
    let resp = await this.client.completeMove(this.ctx.sessionId, { pendingActionId });

    while (resp.requiresPlayerInput && resp.rollType) {
      printRollRequest(resp, { suppress: this.options.noNarration });
      const diceHint = resp.diceNeeded ?? this.inferDiceHint(resp.rollType);
      const rollInput = await this.ask(`Enter your ${diceHint} roll for ${resp.rollType}: `);

      resp = await this.client.completeMove(this.ctx.sessionId, {
        pendingActionId,
        roll: parseInt(rollInput, 10),
        rollType: resp.rollType,
      });

      if (resp.message) {
        printActionResult(resp, { suppress: this.options.noNarration });
      }
    }
  }

  // ==========================================================================
  // Question Handling (local + server)
  // ==========================================================================

  private async handleQuestion(input: string): Promise<void> {
    if (!this.ctx.encounterId) {
      printWarning("No active encounter for query.");
      return;
    }

    // Try local sheet-based answers first for simple questions
    const localAnswer = await this.tryLocalAnswer(input);
    if (localAnswer) {
      printColored(localAnswer, colors.cyan);
      return;
    }

    // Route to server's tactical query endpoint
    try {
      const result = await this.client.queryTactical(this.ctx.sessionId, {
        query: input,
        actorId: this.ctx.characterId,
        encounterId: this.ctx.encounterId,
      });
      printQueryResponse(result);
    } catch (err) {
      // If LLM is not configured, say so cleanly
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("not configured") || message.includes("LLM")) {
        printWarning("Tactical queries require LLM to be enabled on the server.");
      } else {
        printError(`Query failed: ${message}`);
      }
    }
  }

  /**
   * Try to answer a question from the character sheet / tactical view without hitting the server.
   */
  private async tryLocalAnswer(input: string): Promise<string | null> {
    const lower = input.toLowerCase();
    const sheet = this.ctx.characters[0]?.sheet as Record<string, unknown> | undefined;
    if (!sheet) return null;

    if (lower.includes("hp") || lower.includes("health") || lower.includes("hit point")) {
      // Check if asking about a specific creature (not the player)
      const allCreatureNames = [
        ...this.ctx.monsters.map((m) => m.name),
        ...this.ctx.npcs.map((n) => n.name),
      ];
      const mentionsOther = allCreatureNames.some(
        (name) => lower.includes(name.toLowerCase()),
      );
      if (mentionsOther) return null; // fall through to server tactical query

      const maxHp = sheet.maxHp ?? sheet.max_hp;
      const currentHp = sheet.currentHp ?? sheet.current_hp ?? maxHp;
      return `HP: ${currentHp}/${maxHp}`;
    }

    if (lower.includes("armor class") || /\bac\b/.test(lower)) {
      const ac = sheet.armorClass ?? sheet.armor_class;
      return ac != null ? `Armor Class: ${ac}` : null;
    }

    if (lower.includes("speed")) {
      const speed = sheet.speed;
      return speed != null ? `Speed: ${speed} ft` : null;
    }

    if (lower.includes("stats") || lower.includes("ability score")) {
      const scores = sheet.abilityScores as Record<string, number> | undefined;
      if (!scores) return null;
      return Object.entries(scores)
        .map(([k, v]) => `${k.slice(0, 3).toUpperCase()}: ${v}`)
        .join(" | ");
    }

    // Action economy queries — answered from the tactical view
    const asksAboutActions = /\b(action|bonus action|what can i do|what.*available|what.*options)\b/i.test(lower);
    if (asksAboutActions) {
      return await this.buildActionSummary(lower);
    }

    return null; // Can't answer locally — route to server
  }

  /**
   * Build a summary of available actions/bonus actions from the tactical view.
   */
  private async buildActionSummary(query: string): Promise<string | null> {
    const tactical = await this.fetchTactical();
    if (!tactical) return null;

    const active = tactical.combatants.find((c) => c.id === tactical.activeCombatantId);
    if (!active || !this.isPlayerCombatant(active)) return null;

    const ae = active.actionEconomy;
    const attacksUsed = ae.attacksUsed ?? 0;
    const attacksAllowed = ae.attacksAllowed ?? 1;
    const attacksRemaining = Math.max(0, attacksAllowed - attacksUsed);

    const wantsBonusOnly = /\bbonus\b/i.test(query) && !/\baction\b.*\bbonus\b/i.test(query) && !/\bwhat can\b/i.test(query);
    const wantsActionOnly = /\baction\b/i.test(query) && !/\bbonus\b/i.test(query) && !/\bwhat can\b/i.test(query);
    const wantsAll = !wantsBonusOnly && !wantsActionOnly;

    const lines: string[] = [];

    // ACTION section
    if (wantsAll || wantsActionOnly) {
      if (ae.actionAvailable) {
        const actionList = [
          attacksRemaining > 0
            ? `Attack (${attacksRemaining}/${attacksAllowed} remaining)`
            : null,
          "Dash (double movement)",
          "Dodge (enemies have disadvantage)",
          "Disengage (move without opportunity attacks)",
          "Help (give ally advantage)",
          "Hide, Shove, Grapple",
        ].filter(Boolean);
        lines.push("⚔ Actions available:");
        for (const a of actionList) {
          lines.push(`  • ${a}`);
        }
      } else {
        lines.push("⚔ Action: already spent this turn");
      }
    }

    // BONUS ACTION section
    if (wantsAll || wantsBonusOnly) {
      if (ae.bonusActionAvailable) {
        const bonusActions: string[] = [];
        // Read class-specific bonus actions from the character sheet
        const sheetBonusActions = (this.ctx.characters[0]?.sheet as Record<string, unknown>)?.bonusActions;
        if (Array.isArray(sheetBonusActions)) {
          for (const ba of sheetBonusActions) {
            if (typeof ba === "string") bonusActions.push(ba);
            else if (ba && typeof ba === "object" && "name" in ba) bonusActions.push((ba as Record<string, string>).name);
          }
        }
        // Common class bonus actions based on class
        const className = (this.ctx.characters[0]?.className ?? "").toLowerCase();
        if (bonusActions.length === 0) {
          if (className.includes("monk")) {
            bonusActions.push("Flurry of Blows (2 unarmed strikes, costs 1 ki)", "Patient Defense (Dodge as bonus, costs 1 ki)", "Step of the Wind (Dash/Disengage as bonus, costs 1 ki)");
          } else if (className.includes("rogue")) {
            bonusActions.push("Cunning Action (Dash, Disengage, or Hide)");
          } else if (className.includes("fighter")) {
            bonusActions.push("Second Wind (heal 1d10+level, if available)");
          }
        }
        // Two-weapon fighting / offhand attack
        bonusActions.push("Offhand Attack (if wielding two weapons)");

        lines.push("✨ Bonus actions available:");
        for (const ba of bonusActions) {
          lines.push(`  • ${ba}`);
        }
      } else {
        lines.push("✨ Bonus action: already used this turn");
      }
    }

    // MOVEMENT section (always show if asking "what can I do")
    if (wantsAll) {
      const moveLeft = Math.round(ae.movementRemainingFeet);
      if (moveLeft > 0) {
        lines.push(`🏃 Movement: ${moveLeft} ft remaining`);
      } else {
        lines.push("🏃 Movement: fully spent");
      }
    }

    // RESOURCES section
    if (wantsAll && active.resourcePools.length > 0) {
      const resources = active.resourcePools
        .map((p) => `${p.name}: ${p.current}/${p.max}`)
        .join(", ");
      lines.push(`📦 Resources: ${resources}`);
    }

    return lines.length > 0 ? lines.join("\n") : null;
  }

  // ==========================================================================
  // REPL Commands (help, status, spells, abilities, inventory, rest)
  // ==========================================================================

  private printHelp(): void {
    print(`
${colors.bold}Available Commands:${colors.reset}

${colors.cyan}Combat Actions:${colors.reset}
  ${colors.bold}attack <target>${colors.reset}     Attack a target (e.g., "I attack the Goblin with my sword")
  ${colors.bold}move to (x, y)${colors.reset}      Move to a position on the grid
  ${colors.bold}cast <spell>${colors.reset}         Cast a spell (e.g., "cast fireball at the goblins")
  ${colors.bold}dash${colors.reset}                 Double your movement for the turn
  ${colors.bold}dodge${colors.reset}                Impose disadvantage on attacks against you
  ${colors.bold}disengage${colors.reset}            Move without provoking opportunity attacks
  ${colors.bold}action surge${colors.reset}         (Fighter) Take an additional action
  ${colors.bold}flurry of blows${colors.reset}      (Monk) Make 2 bonus unarmed strikes (1 ki)
  ${colors.bold}patient defense${colors.reset}      (Monk) Dodge as a bonus action (1 ki)
  ${colors.bold}step of the wind${colors.reset}     (Monk) Dash/Disengage as bonus action (1 ki)
  ${colors.bold}second wind${colors.reset}          (Fighter) Heal 1d10+level as bonus action
  ${colors.bold}end turn${colors.reset}             End your turn (also: 'end', 'pass', 'done')

${colors.cyan}Info Commands:${colors.reset}
  ${colors.bold}status${colors.reset}               Show character sheet summary (HP, AC, conditions)
  ${colors.bold}spells${colors.reset}               Show prepared spells and remaining slots
  ${colors.bold}abilities${colors.reset}            Show class features and resource pools
  ${colors.bold}inventory${colors.reset}            Show your items (also: 'inv', 'items')
  ${colors.bold}tactical${colors.reset}             Redisplay the tactical map (also: 'map', 'look')
  ${colors.bold}help${colors.reset}                 Show this help text (also: '?')

${colors.cyan}Other:${colors.reset}
  ${colors.bold}rest short${colors.reset}           Take a short rest (between encounters)
  ${colors.bold}rest long${colors.reset}            Take a long rest (between encounters)
  ${colors.bold}<question>?${colors.reset}          Ask a tactical question (routed to LLM if available)
`);
  }

  private printStatusCommand(): void {
    const char = this.ctx.characters[0];
    if (!char) {
      printWarning("No character data available.");
      return;
    }

    const sheet = char.sheet as Record<string, unknown> | undefined;
    if (!sheet) {
      printWarning("No character sheet data available.");
      return;
    }

    const maxHp = sheet.maxHp ?? sheet.max_hp ?? "?";
    const currentHp = sheet.currentHp ?? sheet.current_hp ?? maxHp;
    const ac = sheet.armorClass ?? sheet.armor_class ?? "?";
    const speed = sheet.speed ?? "?";
    const profBonus = sheet.proficiencyBonus ?? sheet.proficiency_bonus ?? "?";

    banner("CHARACTER STATUS");
    print(`  ${colors.bold}${char.name}${colors.reset} — Level ${char.level} ${char.className ?? "Adventurer"}`);
    print(`  HP: ${colors.green}${currentHp}/${maxHp}${colors.reset} | AC: ${colors.cyan}${ac}${colors.reset} | Speed: ${speed} ft | Prof: +${profBonus}`);

    // Ability scores
    const scores = sheet.abilityScores as Record<string, number> | undefined;
    if (scores) {
      const line = Object.entries(scores)
        .map(([k, v]) => {
          const mod = Math.floor((v - 10) / 2);
          const modStr = mod >= 0 ? `+${mod}` : `${mod}`;
          return `${k.slice(0, 3).toUpperCase()} ${v} (${modStr})`;
        })
        .join(" | ");
      print(`  ${line}`);
    }

    // Attacks
    const attacks = sheet.attacks as Array<Record<string, unknown>> | undefined;
    if (attacks && attacks.length > 0) {
      print(`\n  ${colors.bold}Attacks:${colors.reset}`);
      for (const atk of attacks) {
        const bonus = typeof atk.attackBonus === "number" ? `+${atk.attackBonus}` : "?";
        const dmg = atk.damage as Record<string, unknown> | undefined;
        let dmgStr = "?";
        if (dmg) {
          dmgStr = `${dmg.diceCount ?? 1}d${dmg.diceSides ?? 6}`;
          if (typeof dmg.modifier === "number" && dmg.modifier !== 0) {
            dmgStr += dmg.modifier > 0 ? `+${dmg.modifier}` : `${dmg.modifier}`;
          }
        }
        print(`    • ${atk.name}: ${bonus} to hit, ${dmgStr} ${atk.damageType ?? ""}`);
      }
    }

    // Conditions from tactical view (if in combat)
    // We don't fetch here to keep it synchronous; conditions show in tactical display
  }

  private printSpellsCommand(): void {
    const char = this.ctx.characters[0];
    const sheet = char?.sheet as Record<string, unknown> | undefined;
    if (!sheet) {
      printWarning("No character sheet data available.");
      return;
    }

    banner("SPELLS");

    // Spell slots
    const slots = sheet.spellSlots as Record<string, unknown> | undefined;
    const usedSlots = sheet.usedSpellSlots as Record<string, unknown> | undefined;
    if (slots) {
      print(`  ${colors.bold}Spell Slots:${colors.reset}`);
      for (const [level, total] of Object.entries(slots)) {
        if (typeof total !== "number" || total === 0) continue;
        const used = (usedSlots && typeof usedSlots[level] === "number") ? usedSlots[level] as number : 0;
        const remaining = total - used;
        const color = remaining > 0 ? colors.green : colors.red;
        print(`    Level ${level}: ${color}${remaining}/${total}${colors.reset}`);
      }
    } else {
      print(`  ${colors.dim}No spell slots.${colors.reset}`);
    }

    // Prepared / known spells
    const spells = sheet.spells as Array<Record<string, unknown>> | string[] | undefined;
    const preparedSpells = sheet.preparedSpells as Array<Record<string, unknown>> | string[] | undefined;
    const spellList = preparedSpells ?? spells;

    if (spellList && spellList.length > 0) {
      print(`\n  ${colors.bold}Prepared Spells:${colors.reset}`);
      for (const spell of spellList) {
        if (typeof spell === "string") {
          print(`    • ${spell}`);
        } else if (typeof spell === "object" && spell !== null) {
          const name = spell.name ?? spell.spellId ?? "Unknown";
          const level = spell.level ?? spell.spellLevel;
          const levelStr = level != null ? ` (Level ${level})` : "";
          print(`    • ${name}${levelStr}`);
        }
      }
    }

    // Cantrips
    const cantrips = sheet.cantrips as string[] | Array<Record<string, unknown>> | undefined;
    if (cantrips && cantrips.length > 0) {
      print(`\n  ${colors.bold}Cantrips:${colors.reset}`);
      for (const c of cantrips) {
        if (typeof c === "string") {
          print(`    • ${c}`);
        } else if (typeof c === "object" && c !== null) {
          print(`    • ${(c as Record<string, unknown>).name ?? "Unknown"}`);
        }
      }
    }

    if (!slots && !spellList && !cantrips) {
      printColored("  This character has no spellcasting features.", colors.dim);
    }
  }

  private async printAbilitiesCommand(): Promise<void> {
    const char = this.ctx.characters[0];
    const sheet = char?.sheet as Record<string, unknown> | undefined;
    if (!sheet) {
      printWarning("No character sheet data available.");
      return;
    }

    banner("ABILITIES & FEATURES");

    const className = (char.className ?? "").toLowerCase();

    // Resource pools from tactical view
    const tactical = await this.fetchTactical();
    const active = tactical?.combatants.find(
      (c) => c.id === tactical.activeCombatantId || this.isPlayerCombatant(c),
    );

    if (active?.resourcePools && active.resourcePools.length > 0) {
      print(`  ${colors.bold}Resource Pools:${colors.reset}`);
      for (const pool of active.resourcePools) {
        const color = pool.current > 0 ? colors.green : colors.red;
        print(`    • ${pool.name}: ${color}${pool.current}/${pool.max}${colors.reset}`);
      }
    }

    // Class-specific feature summary
    print(`\n  ${colors.bold}Class Features (${char.className ?? "Unknown"}):${colors.reset}`);
    if (className.includes("fighter")) {
      print(`    • ${colors.yellow}Action Surge${colors.reset} — Take an additional action (1/rest)`);
      print(`    • ${colors.yellow}Second Wind${colors.reset} — Heal 1d10+level as bonus action (1/rest)`);
      if ((char.level ?? 0) >= 5) {
        print(`    • ${colors.yellow}Extra Attack${colors.reset} — Attack twice per action`);
      }
    } else if (className.includes("monk")) {
      print(`    • ${colors.yellow}Flurry of Blows${colors.reset} — 2 bonus unarmed strikes (1 ki)`);
      print(`    • ${colors.yellow}Patient Defense${colors.reset} — Dodge as bonus action (1 ki)`);
      print(`    • ${colors.yellow}Step of the Wind${colors.reset} — Dash/Disengage as bonus (1 ki)`);
      if ((char.level ?? 0) >= 5) {
        print(`    • ${colors.yellow}Stunning Strike${colors.reset} — On hit: target makes CON save or Stunned (1 ki)`);
        print(`    • ${colors.yellow}Extra Attack${colors.reset} — Attack twice per action`);
      }
      if ((char.level ?? 0) >= 3) {
        print(`    • ${colors.yellow}Deflect Attacks${colors.reset} — Reduce incoming damage (reaction)`);
      }
    } else if (className.includes("rogue")) {
      print(`    • ${colors.yellow}Sneak Attack${colors.reset} — Extra ${Math.ceil((char.level ?? 1) / 2)}d6 damage (1/turn)`);
      print(`    • ${colors.yellow}Cunning Action${colors.reset} — Dash, Disengage, or Hide as bonus action`);
    } else if (className.includes("wizard")) {
      print(`    • ${colors.yellow}Shield${colors.reset} — +5 AC until next turn (reaction, 1st-level slot)`);
      print(`    • ${colors.yellow}Arcane Recovery${colors.reset} — Recover spell slots (1/long rest)`);
    }

    // Conditions
    if (active?.conditions && active.conditions.length > 0) {
      print(`\n  ${colors.bold}Active Conditions:${colors.reset}`);
      for (const cond of active.conditions) {
        print(`    • ${colors.magenta}${cond}${colors.reset}`);
      }
    }
  }

  private async printInventoryCommand(): Promise<void> {
    try {
      const inv = await this.client.getInventory(this.ctx.sessionId, this.ctx.characterId);
      banner("INVENTORY");
      if (inv.inventory.length === 0) {
        printColored("  Your pack is empty.", colors.dim);
        return;
      }

      for (const item of inv.inventory) {
        const tags: string[] = [];
        if (item.equipped) tags.push(colors.green + "equipped" + colors.reset);
        if (item.attuned) tags.push(colors.cyan + "attuned" + colors.reset);
        if (item.slot) tags.push(colors.dim + item.slot + colors.reset);
        const qty = item.quantity > 1 ? ` x${item.quantity}` : "";
        const tagStr = tags.length > 0 ? ` [${tags.join(", ")}]` : "";
        print(`  • ${item.name}${qty}${tagStr}`);
      }

      print(`\n  Attunement: ${inv.attunedCount}/${inv.maxAttunementSlots} slots used`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("404") || msg.includes("Not Found")) {
        printColored("  No inventory data available.", colors.dim);
      } else {
        printError(`Failed to fetch inventory: ${msg}`);
      }
    }
  }

  private async handleRestCommand(type: "short" | "long"): Promise<void> {
    try {
      const result = await this.client.rest(this.ctx.sessionId, { type });
      const label = type === "long" ? "Long Rest" : "Short Rest";
      printSuccess(`${label} complete!`);
      for (const char of result.characters) {
        if (char.poolsRefreshed.length > 0) {
          print(`  ${colors.cyan}${char.name}${colors.reset}: refreshed ${char.poolsRefreshed.join(", ")}`);
        }
      }
    } catch (err) {
      printError(`Rest failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ==========================================================================
  // Utility Helpers
  // ==========================================================================

  private async fetchTactical(): Promise<TacticalState | null> {
    if (!this.ctx.encounterId) return null;
    try {
      return await this.client.getTacticalView(this.ctx.sessionId, this.ctx.encounterId);
    } catch {
      return null;
    }
  }

  private async resolvePlayerCombatantId(): Promise<void> {
    const tactical = await this.fetchTactical();
    if (!tactical) return;

    const match = tactical.combatants.find(
      (c) =>
        c.combatantType === "Character" &&
        // The server doesn't expose characterId on tactical, but we can match by name
        c.name === this.ctx.characters[0]?.name,
    );
    if (match) {
      this.playerCombatantId = match.id;
    }
  }

  private isPlayerCombatant(combatant: TacticalCombatant | undefined): boolean {
    if (!combatant) return false;
    if (combatant.combatantType !== "Character") return false;
    if (this.playerCombatantId) return combatant.id === this.playerCombatantId;
    // Fallback: match by name
    return combatant.name === this.ctx.characters[0]?.name;
  }

  private isEndTurnCommand(input: string): boolean {
    const lower = input.toLowerCase().trim();
    return lower === "end turn" || lower === "end" || lower === "pass" || lower === "done";
  }

  private looksLikeQuestion(input: string): boolean {
    if (input.endsWith("?")) return true;
    const lower = input.toLowerCase();
    if (lower.startsWith("query ")) return true;
    const questionWords = ["what", "which", "who", "where", "how", "why", "is", "are", "can", "do", "does"];
    return questionWords.some((w) => lower.startsWith(w + " "));
  }

  private inferDiceHint(rollType: string): string {
    switch (rollType) {
      case "initiative": return "d20";
      case "attack": return "d20";
      case "damage": return "damage dice";
      case "savingThrow": return "d20";
      case "abilityCheck": return "d20";
      default: return "dice";
    }
  }

  private handleCombatEnd(result: string): void {
    this.state = "COMBAT_OVER";
    const lower = (result ?? "").toLowerCase();
    if (lower === "victory" || lower === "win") {
      printVictory();
    } else if (lower === "defeat" || lower === "tpk") {
      printDefeat();
    } else {
      banner("COMBAT ENDED");
      print(`Result: ${result}`);
    }
  }

  /**
   * Ask for a dice roll. Validates that input starts with a number.
   * Accepts optional on-hit enhancement keywords after the number
   * (e.g., "8 with stunning strike", "6 and topple").
   * If the user types a bare ability keyword with no number, prompt them
   * to include the number first.
   */
  private async askForRoll(prompt: string, rollType: string): Promise<string> {
    while (true) {
      const input = await this.ask(prompt);
      // Allow plain numbers, or number expressions like "3+5"
      if (/^\d+([+\-]\d+)*$/.test(input)) {
        return input;
      }
      // Allow "<number> with <keyword>" or "<number> and <keyword>" patterns (on-hit enhancements)
      if (/^\d+([+\-]\d+)*\s+(with|and)\s+.+/i.test(input)) {
        return input;
      }
      // Detect bare ability keywords typed during roll prompt without a number
      if (/stun|flurry|patient|surge|second wind|dodge|topple|push|addle|smite/i.test(input)) {
        printWarning(
          `Include your roll number before the ability keyword.` +
          `\n  Example: '8 with stunning strike' or '6 with topple'`,
        );
      } else {
        printWarning(`Please enter a number for your ${rollType} roll.`);
      }
    }
  }

  /**
   * Display eligible on-hit enhancements the player can opt into (2024 post-hit flow).
   * Player includes the keyword in their damage roll text to activate.
   */
  private displayEligibleEnhancements(enhancements: Array<{ keyword: string; displayName: string; choiceOptions?: string[] }>): void {
    printColored("  ⚔ On-hit abilities available:", colors.yellow);
    for (const enh of enhancements) {
      if (enh.choiceOptions && enh.choiceOptions.length > 0) {
        printColored(`    • ${enh.displayName}: include "with ${enh.choiceOptions.join('" or "with ')}" in your roll`, colors.yellow);
      } else {
        printColored(`    • ${enh.displayName}: include "with ${enh.keyword.replace(/-/g, " ")}" in your roll`, colors.yellow);
      }
    }
    printColored("  (Or roll without keywords to decline)", colors.dim);
  }

  /**
   * Display hit rider enhancement results (Stunning Strike, Open Hand Technique, etc.)
   */
  /**
   * Strip leading displayName prefix from a summary to avoid "Name: Name: details" duplication.
   */
  private stripDisplayNamePrefix(displayName: string, summary: string): string {
    if (summary.startsWith(`${displayName}:`)) {
      return summary.slice(displayName.length + 1).trimStart();
    }
    return summary;
  }

  /**
   * Display hit rider enhancement results (Stunning Strike, Open Hand Technique, etc.)
   * Skips riders whose summary is already present in the message to avoid duplication.
   */
  private displayHitRiders(resp: ActionResponse): void {
    const msg = resp.message ?? "";

    if (resp.stunningStrike) {
      const ss = resp.stunningStrike;
      // Skip if the message already contains this enhancement's summary
      if (ss.summary && msg.includes(ss.summary)) return;
      const detail = ss.summary
        ? this.stripDisplayNamePrefix(ss.displayName ?? "Stunning Strike", ss.summary)
        : ss.saved === false
          ? `Target fails CON save (${ss.saveTotal} vs DC ${ss.saveDC}) — ${ss.conditionApplied ?? "Stunned"}!`
          : `Target succeeds CON save (${ss.saveTotal} vs DC ${ss.saveDC}) — partial effect.`;
      printColored(
        `  ⚡ ${ss.displayName ?? "Stunning Strike"}: ${detail}`,
        ss.saved === false ? colors.yellow : colors.cyan,
      );
    }
    if (resp.openHandTechnique) {
      const oht = resp.openHandTechnique;
      // Skip if the message already contains this enhancement's summary
      if (oht.summary && msg.includes(oht.summary)) return;
      const detail = this.stripDisplayNamePrefix(oht.displayName ?? "Open Hand Technique", oht.summary ?? "");
      printColored(`  🤚 ${oht.displayName}: ${detail}`, colors.cyan);
    }
    if (resp.enhancements) {
      for (const enh of resp.enhancements) {
        // Skip if the message already contains this enhancement's summary
        if (enh.summary && msg.includes(enh.summary)) continue;
        const detail = this.stripDisplayNamePrefix(enh.displayName ?? "", enh.summary ?? "");
        printColored(`  ✨ ${enh.displayName}: ${detail}`, colors.cyan);
      }
    }
  }

  private async ask(prompt: string): Promise<string> {
    return (await this.rl.question(prompt)).trim();
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
