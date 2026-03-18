/**
 * Mock LLM implementations for testing.
 *
 * These mocks provide deterministic responses for all LLM interfaces,
 * enabling combat E2E testing without requiring Ollama or any real LLM.
 *
 * Usage:
 * ```typescript
 * import { MockIntentParser, MockNarrativeGenerator } from './mocks/index.js';
 *
 * const app = buildApp({
 *   ...repos,
 *   intentParser: new MockIntentParser(),
 *   narrativeGenerator: new MockNarrativeGenerator(),
 * });
 * ```
 */

import type { IIntentParser } from "../intent-parser.js";
import type { INarrativeGenerator } from "../narrative-generator.js";
import type { IStoryGenerator, StoryFramework } from "../story-generator.js";
import type { ICharacterGenerator, GeneratedCharacterSheet } from "../character-generator.js";
import type { IAiDecisionMaker, AiDecision, AiCombatContext } from "../../../application/services/combat/ai/ai-types.js";
import type { JsonValue } from "../../../application/types.js";
import { getClassDefinition, isCharacterClassId } from "../../../domain/entities/classes/index.js";

// ============================================================================
// MockIntentParser
// ============================================================================

export type ParsedIntent = {
  kind: string;
  targetName?: string;
  destination?: { x: number; y: number };
  attackName?: string;
  bonusAction?: string;
  [key: string]: unknown;
};

/**
 * Pattern-matching intent parser that converts natural language to structured commands.
 * Returns deterministic results based on input text patterns.
 *
 * Uses the schemaHint (which contains the roster) to construct properly-formed
 * commands with real entity IDs.
 */
export class MockIntentParser implements IIntentParser {
  private overrides: Map<string, unknown> = new Map();

  /**
   * Register a custom response for a specific input text.
   */
  registerOverride(text: string, intent: unknown): void {
    this.overrides.set(text.toLowerCase(), intent);
  }

  async parseIntent(input: { text: string; seed?: number; schemaHint?: string }): Promise<unknown> {
    const text = input.text.toLowerCase().trim();
    const schemaHint = input.schemaHint ?? "";

    // Check for registered overrides first
    if (this.overrides.has(text)) {
      return this.overrides.get(text)!;
    }

    // Extract roster from schemaHint if available
    const roster = this.extractRoster(schemaHint);

    // Pattern: "throw/hurl/toss <weapon> at <target>"
    const throwMatch = text.match(/(?:i\s+)?(?:throw|hurl|toss)\s+(?:the\s+|a\s+|my\s+)?[\w\s]+?\s+at\s+(?:the\s+)?(.+?)$/i);
    if (throwMatch) {
      const targetName = throwMatch[1]!.trim().toLowerCase();
      return this.buildAttackCommand(targetName, roster);
    }

    // Pattern: "I attack the <target>" or "attack <target>" or "I shoot the <target>"
    const attackMatch = text.match(/(?:i\s+)?(?:attack|shoot|fire\s+at|strike)(?:\s+the)?\s+(.+?)(?:\s+with\s+.+)?$/i);
    if (attackMatch) {
      const targetName = attackMatch[1]!.trim().toLowerCase();
      return this.buildAttackCommand(targetName, roster);
    }

    // Pattern: "move to (x, y)" or "move to x, y"
    const moveMatch = text.match(/move\s+to\s+\(?(\d+)[,\s]+(\d+)\)?/i);
    if (moveMatch) {
      return this.buildMoveCommand(
        { x: parseInt(moveMatch[1]!, 10), y: parseInt(moveMatch[2]!, 10) },
        roster,
      );
    }

    // Pattern: "I rolled <number>" → extract the roll value
    const rollMatch = text.match(/(?:i\s+)?rolled?\s+(\d+)/i);
    if (rollMatch) {
      return { kind: "rollResult", rollType: "initiative", value: parseInt(rollMatch[1]!, 10) };
    }

    // Pattern: simple actions
    if (text.includes("dash")) {
      return { kind: "dash" };
    }
    if (text.includes("dodge")) {
      return { kind: "dodge" };
    }
    if (text.includes("disengage")) {
      return { kind: "disengage" };
    }
    if (text.includes("end turn") || text.includes("end my turn")) {
      return this.buildEndTurnCommand(roster);
    }

    // Pattern: question/query intents - classify by subject
    const querySubject = this.classifyQuerySubject(text);
    if (querySubject) {
      return { kind: "query", subject: querySubject };
    }

    // Default: unknown intent
    return { kind: "unknown", originalText: text };
  }

  /**
   * Extract roster from the schemaHint JSON.
   */
  private extractRoster(schemaHint: string): Roster | null {
    try {
      // Find the JSON object at the end of the schema hint
      const rosterMatch = schemaHint.match(/Roster \(valid IDs[^)]*\):\s*(\{[\s\S]*\})$/);
      if (rosterMatch) {
        return JSON.parse(rosterMatch[1]!) as Roster;
      }
    } catch {
      // Ignore parse errors
    }
    return null;
  }

  /**
   * Classify a question into its query subject category.
   * Returns null if the text doesn't appear to be a question.
   */
  private classifyQuerySubject(text: string): string | null {
    // Check if it looks like a question (has question marks or starts with question words)
    const isQuestion =
      text.includes("?") ||
      /^(what|who|where|which|how|can|do|does|am|is|are)\s/i.test(text);

    if (!isQuestion) {
      return null;
    }

    // HP queries
    if (/\b(hp|health|hit\s*point|damage|hurt|injured|wounded)\b/i.test(text)) {
      return "hp";
    }

    // AC queries
    if (/\b(ac|armor\s*class|defence|defense)\b/i.test(text)) {
      return "ac";
    }

    // Weapon queries
    if (/\b(weapons?|sword|bow|axe|dagger|attacks?)\b/i.test(text)) {
      return "weapons";
    }

    // Spell queries
    if (/\b(spells?|cantrips?|magic|cast)\b/i.test(text)) {
      return "spells";
    }

    // Feature queries
    if (/\b(features?|abilities|traits?|class\s*feature|racial|special)\b/i.test(text)) {
      return "features";
    }

    // Stats/ability score queries
    if (/\b(stats?|ability\s*scores?|strength|dexterity|constitution|intelligence|wisdom|charisma|str|dex|con|int|wis|cha)\b/i.test(text)) {
      return "stats";
    }

    // Equipment/inventory queries
    if (/\b(equipment|items?|inventory|carrying|gear|pack)\b/i.test(text)) {
      return "equipment";
    }

    // Party queries
    if (/\b(party|allies|team|companions|group)\b/i.test(text)) {
      return "party";
    }

    // Actions queries
    if (/\b(action|what\s*can\s*i|turn|option|do\s+on)\b/i.test(text)) {
      return "actions";
    }

    // Tactical/positioning queries
    if (/\b(nearest|closest|which|enemy|distance|position|far|range)\b/i.test(text)) {
      return "tactical";
    }

    // Environment queries
    if (/\b(room|cover|terrain|environment|map|area|surroundings|nearby)\b/i.test(text)) {
      return "environment";
    }

    // Default: if it's a question but we can't classify, default to tactical
    return "tactical";
  }

  /**
   * Build a properly-formed attack command using roster IDs.
   */
  private buildAttackCommand(targetName: string, roster: Roster | null): unknown {
    // Find attacker (first character in roster)
    let attacker: { type: string; characterId?: string; monsterId?: string; npcId?: string } | undefined;
    if (roster?.characters && roster.characters.length > 0) {
      attacker = { type: "Character", characterId: roster.characters[0]!.id };
    }

    // Find target by name (fuzzy match)
    let target: { type: string; characterId?: string; monsterId?: string; npcId?: string } | undefined;
    if (roster?.monsters) {
      const monster = roster.monsters.find((m) => m.name.toLowerCase().includes(targetName));
      if (monster) {
        target = { type: "Monster", monsterId: monster.id };
      }
    }
    if (!target && roster?.npcs) {
      const npc = roster.npcs.find((n) => n.name.toLowerCase().includes(targetName));
      if (npc) {
        target = { type: "NPC", npcId: npc.id };
      }
    }
    if (!target && roster?.characters) {
      const char = roster.characters.find((c) => c.name.toLowerCase().includes(targetName));
      if (char) {
        target = { type: "Character", characterId: char.id };
      }
    }

    // Don't provide a spec - let the server determine weapon stats from character sheet
    // This ensures proper attack bonus and damage modifiers are used
    return {
      kind: "attack",
      attacker: attacker ?? { type: "Character", characterId: "unknown" },
      target: target ?? { type: "Monster", monsterId: "unknown" },
    };
  }

  /**
   * Build a move command using roster IDs.
   */
  private buildMoveCommand(destination: { x: number; y: number }, roster: Roster | null): unknown {
    let actor: { type: string; characterId?: string } | undefined;
    if (roster?.characters && roster.characters.length > 0) {
      actor = { type: "Character", characterId: roster.characters[0]!.id };
    }

    return {
      kind: "move",
      actor: actor ?? { type: "Character", characterId: "unknown" },
      destination,
    };
  }

  /**
   * Build an end turn command using roster IDs.
   */
  private buildEndTurnCommand(roster: Roster | null): unknown {
    let actor: { type: string; characterId?: string } | undefined;
    if (roster?.characters && roster.characters.length > 0) {
      actor = { type: "Character", characterId: roster.characters[0]!.id };
    }

    return {
      kind: "endTurn",
      actor: actor ?? { type: "Character", characterId: "unknown" },
    };
  }
}

interface Roster {
  characters?: Array<{ id: string; name: string }>;
  monsters?: Array<{ id: string; name: string }>;
  npcs?: Array<{ id: string; name: string }>;
}

// ============================================================================
// MockNarrativeGenerator
// ============================================================================

/**
 * Template-based narrative generator that produces consistent narration
 * based on event types without LLM latency.
 */
export class MockNarrativeGenerator implements INarrativeGenerator {
  private customNarrative: string | null = null;

  /**
   * Set a custom narrative to return for the next call.
   */
  setNextNarrative(narrative: string): void {
    this.customNarrative = narrative;
  }

  async narrate(input: { storyFramework: JsonValue; events: JsonValue[]; seed?: number }): Promise<string> {
    // Return custom narrative if set
    if (this.customNarrative) {
      const narrative = this.customNarrative;
      this.customNarrative = null;
      return narrative;
    }

    // Generate narrative based on event types
    const narratives: string[] = [];

    for (const event of input.events) {
      if (!isRecord(event)) continue;

      const eventType = event.type as string;
      const payload = (event.payload ?? {}) as Record<string, unknown>;

      switch (eventType) {
        // ---- Tabletop combat events ----
        case "initiativeRequest":
          narratives.push("Tensions rise as battle is about to begin. Roll for initiative!");
          break;

        case "combatStarted": {
          const firstActor = payload.firstActor as string | undefined;
          narratives.push(
            firstActor
              ? `Combat begins! ${firstActor} seizes the initiative.`
              : "Combat begins! Steel clashes and the battle is joined!",
          );
          break;
        }

        case "attackRequest": {
          const targetName = payload.targetName as string;
          narratives.push(
            `Preparing to strike at ${targetName}. Roll for attack!`,
          );
          break;
        }

        case "attackHit": {
          const targetName = payload.targetName as string;
          narratives.push(
            `The attack strikes true against ${targetName}! Roll for damage.`,
          );
          break;
        }

        case "attackMiss": {
          const targetName = payload.targetName as string;
          narratives.push(
            `The attack goes wide, missing ${targetName}.`,
          );
          break;
        }

        case "damageDealt": {
          const targetName = payload.targetName as string;
          const totalDamage = payload.totalDamage as number;
          const defeated = payload.defeated as boolean;
          if (defeated) {
            narratives.push(
              `${totalDamage} damage! ${targetName} crumples to the ground, defeated!`,
            );
          } else {
            narratives.push(
              `${totalDamage} damage! ${targetName} staggers from the blow.`,
            );
          }
          break;
        }

        case "movementComplete": {
          const distance = payload.distance as number | null;
          narratives.push(
            distance
              ? `Moving ${Math.round(distance)} feet across the battlefield.`
              : "Movement complete.",
          );
          break;
        }

        case "combatVictory": {
          const targetName = payload.targetName as string;
          const totalDamage = payload.totalDamage as number;
          const victoryStatus = payload.victoryStatus as string;
          narratives.push(
            `${totalDamage} damage! ${targetName} falls! ${victoryStatus}! All enemies have been vanquished!`,
          );
          break;
        }

        // ---- Legacy event types ----
        case "AttackResolved":
          if (payload.hit) {
            narratives.push(
              `${payload.attackerName} strikes true against ${payload.targetName}!`,
            );
          } else {
            narratives.push(
              `${payload.attackerName}'s attack misses ${payload.targetName}.`,
            );
          }
          break;

        case "DamageApplied":
          narratives.push(
            `${payload.targetName} takes ${payload.damage} ${payload.damageType ?? ""} damage.`.trim(),
          );
          break;

        case "CombatStarted":
          narratives.push("Initiative is rolled and combat begins!");
          break;

        case "TurnStarted":
          narratives.push(`${payload.combatantName} readies for action.`);
          break;

        case "TurnEnded":
          narratives.push(`${payload.combatantName} ends their turn.`);
          break;

        case "MovementComplete":
          narratives.push(`${payload.combatantName} moves across the battlefield.`);
          break;

        case "CliNarrationRequest":
          // Handle CLI-specific narration requests
          const phase = payload.phase as string;
          if (phase === "prompt_attack_roll") {
            narratives.push(`${payload.actorName} prepares to strike ${payload.targetName}.`);
          } else if (phase === "prompt_damage_roll") {
            narratives.push(`${payload.actorName}'s attack connects! Roll for damage.`);
          } else if (phase === "prompt_initiative_roll") {
            narratives.push("Tensions rise as combat is about to begin. Roll for initiative!");
          }
          break;

        default:
          // Generic fallback - safely check for message
          if (payload && payload.message) {
            narratives.push(payload.message as string);
          }
      }
    }

    return narratives.length > 0
      ? narratives.join(" ")
      : "The battle continues...";
  }
}

// ============================================================================
// MockStoryGenerator
// ============================================================================

/**
 * Returns a fixed story framework for testing session creation.
 */
export class MockStoryGenerator implements IStoryGenerator {
  private customFramework: StoryFramework | null = null;

  /**
   * Set a custom framework to return for the next call.
   */
  setNextFramework(framework: StoryFramework): void {
    this.customFramework = framework;
  }

  async generateStoryFramework(_input?: { seed?: number }): Promise<StoryFramework> {
    if (this.customFramework) {
      const framework = this.customFramework;
      this.customFramework = null;
      return framework;
    }

    return {
      opening:
        "You find yourselves in a dimly lit tavern, The Rusty Dragon. A hooded figure approaches with an urgent request.",
      arc: "- Investigate the abandoned mine\n- Discover the goblin lair\n- Confront the hobgoblin warlord\n- Return victorious",
      ending:
        "With the goblin threat neutralized, peace returns to the village. The grateful townsfolk celebrate your heroism.",
      checkpoints: [
        {
          id: "cp1",
          description: "Enter the abandoned mine",
          trigger: "Party decides to investigate the mine entrance",
        },
        {
          id: "cp2",
          description: "Discover goblin presence",
          trigger: "First combat encounter with goblins",
        },
        {
          id: "cp3",
          description: "Find the warlord's chamber",
          trigger: "Party reaches the final encounter area",
        },
      ],
    };
  }
}

// ============================================================================
// MockCharacterGenerator
// ============================================================================

/**
 * Returns optimized character sheets based on class without LLM.
 * Uses pre-defined templates for common D&D classes.
 */
export class MockCharacterGenerator implements ICharacterGenerator {
  private readonly classTemplates: Record<string, Partial<GeneratedCharacterSheet>> = {
    fighter: {
      abilityScores: { strength: 16, dexterity: 14, constitution: 15, intelligence: 10, wisdom: 12, charisma: 8 },
      background: "Soldier",
      species: "Human",
      skills: ["Athletics", "Intimidation"],
      proficiencies: {
        armor: ["Light", "Medium", "Heavy", "Shields"],
        weapons: ["Simple", "Martial"],
        tools: [],
        savingThrows: ["Strength", "Constitution"],
      },
      equipment: [
        { name: "Chain Mail", quantity: 1, type: "armor" },
        { name: "Longsword", quantity: 1, type: "weapon" },
        { name: "Shield", quantity: 1, type: "armor" },
        { name: "Light Crossbow", quantity: 1, type: "weapon" },
        { name: "Crossbow Bolts", quantity: 20, type: "gear" },
      ],
    },
    monk: {
      abilityScores: { strength: 10, dexterity: 16, constitution: 14, intelligence: 10, wisdom: 15, charisma: 8 },
      background: "Acolyte",
      species: "Human",
      skills: ["Acrobatics", "Stealth"],
      proficiencies: {
        armor: [],
        weapons: ["Simple", "Shortswords"],
        tools: [],
        savingThrows: ["Strength", "Dexterity"],
      },
      equipment: [
        { name: "Shortsword", quantity: 1, type: "weapon" },
        { name: "Dart", quantity: 10, type: "weapon" },
        { name: "Explorer's Pack", quantity: 1, type: "gear" },
      ],
    },
    wizard: {
      abilityScores: { strength: 8, dexterity: 14, constitution: 14, intelligence: 16, wisdom: 12, charisma: 10 },
      background: "Sage",
      species: "Elf",
      skills: ["Arcana", "Investigation"],
      proficiencies: {
        armor: [],
        weapons: ["Daggers", "Darts", "Slings", "Quarterstaffs", "Light Crossbows"],
        tools: [],
        savingThrows: ["Intelligence", "Wisdom"],
      },
      equipment: [
        { name: "Quarterstaff", quantity: 1, type: "weapon" },
        { name: "Spellbook", quantity: 1, type: "gear" },
        { name: "Component Pouch", quantity: 1, type: "gear" },
        { name: "Scholar's Pack", quantity: 1, type: "gear" },
      ],
    },
    rogue: {
      abilityScores: { strength: 10, dexterity: 16, constitution: 14, intelligence: 12, wisdom: 10, charisma: 14 },
      background: "Criminal",
      species: "Halfling",
      skills: ["Stealth", "Sleight of Hand", "Perception", "Deception"],
      proficiencies: {
        armor: ["Light"],
        weapons: ["Simple", "Hand Crossbows", "Longswords", "Rapiers", "Shortswords"],
        tools: ["Thieves' Tools"],
        savingThrows: ["Dexterity", "Intelligence"],
      },
      equipment: [
        { name: "Rapier", quantity: 1, type: "weapon" },
        { name: "Shortbow", quantity: 1, type: "weapon" },
        { name: "Arrows", quantity: 20, type: "gear" },
        { name: "Leather Armor", quantity: 1, type: "armor" },
        { name: "Thieves' Tools", quantity: 1, type: "tool" },
      ],
    },
    cleric: {
      abilityScores: { strength: 14, dexterity: 10, constitution: 14, intelligence: 10, wisdom: 16, charisma: 12 },
      background: "Acolyte",
      species: "Dwarf",
      skills: ["Medicine", "Religion"],
      proficiencies: {
        armor: ["Light", "Medium", "Shields"],
        weapons: ["Simple"],
        tools: [],
        savingThrows: ["Wisdom", "Charisma"],
      },
      equipment: [
        { name: "Mace", quantity: 1, type: "weapon" },
        { name: "Scale Mail", quantity: 1, type: "armor" },
        { name: "Shield", quantity: 1, type: "armor" },
        { name: "Holy Symbol", quantity: 1, type: "gear" },
      ],
    },
  };

  async generateCharacter(input: { className: string; level?: number; seed?: number }): Promise<GeneratedCharacterSheet> {
    const level = input.level ?? 1;
    const className = input.className.toLowerCase();

    const template = this.classTemplates[className] ?? this.classTemplates["fighter"]!;
    const conMod = Math.floor(((template.abilityScores?.constitution ?? 10) - 10) / 2);

    // Calculate HP: max at level 1, average thereafter
    // Hit die comes from domain class definitions — no hardcoded map needed
    const classDef = isCharacterClassId(className) ? getClassDefinition(className) : null;
    const hitDie = classDef?.hitDie ?? 8;
    const baseHp = hitDie + conMod;
    const additionalHp = level > 1 ? (level - 1) * (Math.floor(hitDie / 2) + 1 + conMod) : 0;
    const hp = baseHp + additionalHp;

    // Calculate AC based on equipment
    let armorClass = 10 + Math.floor(((template.abilityScores?.dexterity ?? 10) - 10) / 2);
    const hasChainMail = template.equipment?.some((e) => e.name === "Chain Mail");
    const hasScaleMail = template.equipment?.some((e) => e.name === "Scale Mail");
    const hasLeatherArmor = template.equipment?.some((e) => e.name === "Leather Armor");
    const hasShield = template.equipment?.some((e) => e.name === "Shield");

    if (hasChainMail) armorClass = 16;
    else if (hasScaleMail) armorClass = 14 + Math.min(2, Math.floor(((template.abilityScores?.dexterity ?? 10) - 10) / 2));
    else if (hasLeatherArmor) armorClass = 11 + Math.floor(((template.abilityScores?.dexterity ?? 10) - 10) / 2);

    // Monk Unarmored Defense: 10 + DEX mod + WIS mod (domain rule)
    if (className === "monk" && !hasLeatherArmor) {
      const dexMod = Math.floor(((template.abilityScores?.dexterity ?? 10) - 10) / 2);
      const wisMod = Math.floor(((template.abilityScores?.wisdom ?? 10) - 10) / 2);
      armorClass = 10 + dexMod + wisMod;
    }

    if (hasShield) armorClass += 2;

    return {
      hp,
      maxHp: hp,
      armorClass,
      abilityScores: template.abilityScores ?? {
        strength: 10,
        dexterity: 10,
        constitution: 10,
        intelligence: 10,
        wisdom: 10,
        charisma: 10,
      },
      background: template.background ?? "Folk Hero",
      species: template.species ?? "Human",
      skills: template.skills ?? [],
      proficiencies: template.proficiencies ?? {
        armor: [],
        weapons: [],
        tools: [],
        savingThrows: [],
      },
      equipment: template.equipment ?? [],
      personality: {
        traits: ["Determined and focused"],
        ideals: ["Glory in battle"],
        bonds: ["Protecting the innocent"],
        flaws: ["Too proud to back down"],
      },
    };
  }
}

// ============================================================================
// MockAiDecisionMaker
// ============================================================================

/**
 * Returns predictable AI decisions for monster/NPC turns.
 * Inspects the context to find actual enemy names and attacks.
 */
/**
 * Captured context entry from a single decide() call.
 * Stores both the raw input and the typed context for assertion.
 */
export interface CapturedAiContext {
  combatantName: string;
  combatantType: string;
  context: AiCombatContext;
}

export class MockAiDecisionMaker implements IAiDecisionMaker {
  private queuedDecisions: AiDecision[] = [];
  private defaultBehavior: "attack" | "endTurn" | "flee" | "castSpell" | "approach" | "grapple" | "hide" = "attack";
  private defaultBonusAction?: string;

  /** Captured contexts from every decide() call, for test assertions. */
  private _capturedContexts: CapturedAiContext[] = [];

  // ---------------------------------------------------------------------------
  // Context spy API
  // ---------------------------------------------------------------------------

  /** All contexts captured since last clear. */
  get capturedContexts(): ReadonlyArray<CapturedAiContext> {
    return this._capturedContexts;
  }

  /** Most recent context, or undefined if none captured. */
  getLastContext(): CapturedAiContext | undefined {
    return this._capturedContexts.at(-1);
  }

  /** Clear captured contexts (call between test scenarios). */
  clearCapturedContexts(): void {
    this._capturedContexts.length = 0;
  }

  // ---------------------------------------------------------------------------
  // Decision configuration
  // ---------------------------------------------------------------------------

  /**
   * Queue a decision to be returned on the next call.
   * Decisions are returned in FIFO order.
   */
  queueDecision(decision: AiDecision): void {
    this.queuedDecisions.push(decision);
  }

  /**
   * Set the default behavior when queue is empty.
   */
  setDefaultBehavior(behavior: "attack" | "endTurn" | "flee" | "castSpell" | "approach" | "grapple" | "hide"): void {
    this.defaultBehavior = behavior;
  }

  /**
   * Set a bonus action to be included in attack decisions.
   */
  setDefaultBonusAction(bonusAction: string | undefined): void {
    this.defaultBonusAction = bonusAction;
  }

  async decide(input: {
    combatantName: string;
    combatantType: string;
    context: unknown;
  }): Promise<AiDecision | null> {
    // Capture context for test assertions
    this._capturedContexts.push({
      combatantName: input.combatantName,
      combatantType: input.combatantType,
      context: input.context as AiCombatContext,
    });

    if (this.queuedDecisions.length > 0) {
      return this.queuedDecisions.shift()!;
    }
    
    // Extract context to find enemies and attacks
    const ctx = input.context as Record<string, unknown> | undefined;
    
    if (this.defaultBehavior === "endTurn" || !ctx) {
      return { action: "endTurn", intentNarration: `${input.combatantName} ends their turn.` };
    }

    // Smart Prone handling: if Prone and movement not spent, move to stand up first
    // This mirrors what a real AI would do — standing up removes disadvantage on attacks
    const combatantCtx = ctx.combatant as Record<string, unknown> | undefined;
    const conditions = Array.isArray(combatantCtx?.conditions) ? combatantCtx!.conditions as string[] : [];
    const economy = combatantCtx?.economy as Record<string, unknown> | undefined;
    const movementSpent = economy?.movementSpent === true;
    const isProne = conditions.some(c => c.toLowerCase() === "prone");
    
    if (isProne && !movementSpent) {
      // Stand up by moving — even moving to current position triggers stand-up logic.
      // Try to stay in place (stand up without changing position) for simplicity.
      const position = combatantCtx?.position as { x: number; y: number } | undefined;
      
      if (position) {
        return {
          action: "move",
          destination: position, // Move to current position = just stand up
          endTurn: false,
          intentNarration: `${input.combatantName} stands up from prone.`,
        };
      }
    }

    // Grapple behavior: grapple the nearest enemy
    if (this.defaultBehavior === "grapple") {
      const grappleEnemies = Array.isArray(ctx.enemies)
        ? ctx.enemies as Array<{ name: string; hp?: { current: number; max: number } }>
        : [];
      const livingEnemy = grappleEnemies.find(e => !e.hp || e.hp.current > 0);
      if (livingEnemy) {
        return {
          action: "grapple",
          target: livingEnemy.name,
          endTurn: true,
          intentNarration: `${input.combatantName} tries to grab ${livingEnemy.name}!`,
        } satisfies AiDecision;
      }
    }

    // Hide behavior: attempt to hide
    if (this.defaultBehavior === "hide") {
      return {
        action: "hide",
        endTurn: true,
        intentNarration: `${input.combatantName} tries to hide!`,
      } satisfies AiDecision;
    }
    
    // Approach behavior: move toward the nearest enemy using moveToward action
    if (this.defaultBehavior === "approach") {
      const approachEnemies = Array.isArray(ctx.enemies)
        ? ctx.enemies as Array<{ name: string; hp?: { current: number; max: number } }>
        : [];
      const livingEnemy = approachEnemies.find(e => !e.hp || e.hp.current > 0);
      if (livingEnemy) {
        return {
          action: "moveToward",
          target: livingEnemy.name,
          desiredRange: 5,
          endTurn: true,
          intentNarration: `${input.combatantName} moves toward ${livingEnemy.name}!`,
        } satisfies AiDecision;
      }
    }

    // Flee behavior: move away from enemies
    if (this.defaultBehavior === "flee") {
      // Find nearest enemy to flee from
      const enemies = Array.isArray(ctx.enemies) ? ctx.enemies as Array<{ name: string }> : [];
      const fleeTarget = enemies[0]?.name;
      if (fleeTarget) {
        return {
          action: "moveAwayFrom",
          target: fleeTarget,
          intentNarration: `${input.combatantName} darts away from ${fleeTarget}!`,
        };
      }
      // Fallback: no enemies found, just end turn
      return {
        action: "endTurn",
        intentNarration: `${input.combatantName} holds position.`,
      };
    }

    // CastSpell behavior: pick the first available spell from combatant context
    if (this.defaultBehavior === "castSpell") {
      const combatant = ctx.combatant as Record<string, unknown> | undefined;
      const spells = Array.isArray(combatant?.spells) ? combatant!.spells as Array<{ name: string; level?: number }> : [];

      if (spells.length > 0) {
        const spell = spells[0]!;
        return {
          action: "castSpell",
          spellName: spell.name,
          spellLevel: typeof spell.level === "number" ? spell.level : 1,
          intentNarration: `${input.combatantName} casts ${spell.name}!`,
        };
      }
      // No spells available — fall through to attack
    }
    
    // Find an enemy to attack from enemies array
    const enemies = Array.isArray(ctx.enemies) 
      ? ctx.enemies as Array<{ name: string; hp?: { current: number; max: number }; concentrationSpell?: string }> 
      : undefined;
    
    // Get available attacks from combatant info
    const combatant = ctx.combatant as Record<string, unknown> | undefined;
    // Attacks can be in "attacks" (stat block format) or "actions" (legacy)
    let attacks: Array<{ name: string }> | undefined;
    if (combatant) {
      if (Array.isArray(combatant.attacks)) {
        attacks = combatant.attacks as Array<{ name: string }>;
      } else if (Array.isArray(combatant.actions)) {
        attacks = combatant.actions as Array<{ name: string }>;
      }
    }
    
    // Get target name - prefer concentration casters (break their zone spells)
    let targetName: string | undefined;
    if (enemies && enemies.length > 0) {
      const livingEnemies = enemies.filter(e => !e.hp || e.hp.current > 0);
      // Prioritize concentration casters — attacking them can break zone spells
      const concentrator = livingEnemies.find(e => e.concentrationSpell);
      targetName = (concentrator ?? livingEnemies[0])?.name;
    }
    
    // Get attack name
    let attackName: string | undefined;
    if (attacks && attacks.length > 0) {
      attackName = attacks[0]?.name;
    }
    
    // If we couldn't find valid targets/attacks, end turn
    if (!targetName || !attackName) {
      return { 
        action: "endTurn", 
        intentNarration: `${input.combatantName} finds no suitable targets and ends their turn.` 
      };
    }
    
    return {
      action: "attack",
      target: targetName,
      attackName: attackName,
      bonusAction: this.defaultBonusAction,
      intentNarration: `${input.combatantName} attacks ${targetName} with ${attackName}!`,
    } satisfies AiDecision;
  }
}

// ============================================================================
// Utilities
// ============================================================================

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ============================================================================
// Exports
// ============================================================================

export type {
  IIntentParser,
  INarrativeGenerator,
  IStoryGenerator,
  ICharacterGenerator,
  IAiDecisionMaker,
  AiDecision,
  StoryFramework,
  GeneratedCharacterSheet,
};
