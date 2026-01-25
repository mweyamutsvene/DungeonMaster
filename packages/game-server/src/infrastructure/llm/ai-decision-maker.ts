import type { LlmProvider } from './types.js';
import type { IAiDecisionMaker, AiDecision } from '../../application/services/combat/ai/ai-types.js';
import { extractFirstJsonObject } from './json.js';
import { llmDebugLog } from './debug.js';

export interface CombatContext {
  combatant: {
    name: string;
    type: string;
    alignment?: string;
    cr?: number;
    class?: string;
    level?: number;
    hp: {
      current: number;
      max: number;
      percentage: number;
    };
    position?: { x: number; y: number };
    economy?: {
      actionSpent: boolean;
      bonusActionSpent: boolean;
      reactionSpent: boolean;
      movementRemaining?: number;
    };
    traits?: any[];
    actions?: any[];
    bonusActions?: any[];
    reactions?: any[];
    spells?: any[];
    abilities?: any[];
  };
  combat: {
    round: number;
    turn: number;
    totalCombatants: number;
  };
  allies: Array<{
    name: string;
    hp: {
      current: number;
      max: number;
      percentage: number;
    };
    position?: { x: number; y: number };
    initiative: number;
  }>;
  enemies: Array<{
    name: string;
    class?: string;
    level?: number;
    hp: {
      current: number;
      max: number;
      percentage: number;
    };
    position?: { x: number; y: number };
    ac?: number;
    initiative: number;
    knownAbilities?: string[];  // Tactical awareness: known special abilities
  }>;
  battlefield?: {
    grid: string;
    legend: string;
    size: { width: number; height: number };
  };
  recentNarrative: string[];
  actionHistory: string[];
  turnResults?: Array<{
    step: number;
    action: string;
    ok: boolean;
    intentNarration?: string;
    reasoning?: string;
    decision?: {
      target?: string;
      attackName?: string;
      destination?: { x: number; y: number };
      bonusAction?: string;
      spellName?: string;
      seed?: number;
      endTurn?: boolean;
    };
    summary: string;
    data?: Record<string, unknown>;
  }>;
  lastActionResult?: {
    step: number;
    action: string;
    ok: boolean;
    intentNarration?: string;
    reasoning?: string;
    decision?: {
      target?: string;
      attackName?: string;
      destination?: { x: number; y: number };
      bonusAction?: string;
      spellName?: string;
      seed?: number;
      endTurn?: boolean;
    };
    summary: string;
    data?: Record<string, unknown>;
  } | null;
}

/**
 * Infrastructure adapter: LLM-based AI decision maker
 * Layer: Infrastructure
 * Purpose: Handles prompt building and JSON parsing for Monster AI decisions
 */
export class LlmAiDecisionMaker implements IAiDecisionMaker {
  private readonly aiDebugEnabled =
    process.env.DM_AI_DEBUG === "1" ||
    process.env.DM_AI_DEBUG === "true" ||
    process.env.DM_AI_DEBUG === "yes";

  constructor(
    private readonly llm: LlmProvider,
    private readonly config: {
      model: string;
      temperature?: number;
      seed?: number;
      timeoutMs?: number;
    },
  ) {}

  private aiLog(...args: unknown[]): void {
    if (this.aiDebugEnabled) console.log(...args);
  }

  async decide(input: {
    combatantName: string;
    combatantType: string;
    context: CombatContext;
  }): Promise<AiDecision | null> {
    const systemPrompt = this.buildSystemPrompt(input.combatantName, input.combatantType);
    
    // Build user message with battlefield, narrative, and state
    let userMessage = '';
    
    // Add battlefield visualization if available
    if (input.context.battlefield) {
      userMessage += 'BATTLEFIELD:\n' + 
        input.context.battlefield.grid + '\n\n' +
        'LEGEND:\n' + input.context.battlefield.legend + '\n\n';
    }
    
    // Add recent narrative context if available
    if (input.context.recentNarrative && input.context.recentNarrative.length > 0) {
      userMessage += 'Recent combat narrative:\n' + 
        input.context.recentNarrative.map((text, i) => `${i + 1}. ${text}`).join('\n') +
        '\n\n';
    }
    
    // Add combat state JSON
    userMessage += 'Current combat state:\n' + JSON.stringify(input.context, null, 2);

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: userMessage },
    ];

    const options = {
      model: this.config.model,
      temperature: this.config.temperature ?? 0.7,
      seed: this.config.seed,
      timeoutMs: this.config.timeoutMs ?? 30000,
    };

    const tryParse = (raw: string): AiDecision | null => {
      const json = extractFirstJsonObject(raw);
      llmDebugLog('monster-ai.parsed_json', { json });
      return this.parseDecision(json);
    };

    try {
      this.aiLog('[LlmAiDecisionMaker] Calling LLM with options:', options);
      llmDebugLog('monster-ai.request', { context: input.context, messages, options });

      const raw = await this.llm.chat({ messages, options });
      this.aiLog('[LlmAiDecisionMaker] Got LLM response:', raw.substring(0, 200));
      llmDebugLog('monster-ai.response', { raw });

      try {
        return tryParse(raw);
      } catch (parseErr) {
        // One retry with an explicit JSON-only instruction.
        this.aiLog('[LlmAiDecisionMaker] Parse failed, retrying once:', parseErr);
        const retryMessages = [
          ...messages,
          {
            role: 'user' as const,
            content:
              'Your previous response did not contain a JSON object. Reply with ONLY a single JSON object matching the schema. No prose, no markdown, no code fences.',
          },
        ];

        const retryRaw = await this.llm.chat({ messages: retryMessages, options });
        this.aiLog('[LlmAiDecisionMaker] Got LLM retry response:', retryRaw.substring(0, 200));
        llmDebugLog('monster-ai.retry_response', { raw: retryRaw });
        return tryParse(retryRaw);
      }
    } catch (error) {
      console.error('[LlmAiDecisionMaker] Decision failed:', error);
      return null;
    }
  }

  private buildSystemPrompt(actorName: string, actorType: string): string {
    return `You are the tactical brain of a combatant in a D&D combat encounter.
You control this combatant's actions and must make strategic decisions following D&D-style rules.

COMBATANT IDENTITY:
- Name: ${actorName}
- Type: ${actorType}

PERSONALITY & TACTICS:
- Act in character based on the combatant's type, traits, and style.
- Use abilities from the context.combatant.bonusActions array when strategically advantageous.
- Consider enemy knownAbilities (listed in context.enemies[].knownAbilities) for tactical awareness.
- Consider morale: flee if badly wounded and outnumbered, fight to death if cornered.

D&D RULES (Action Economy):
- You have ONE ACTION per turn
- You may have ONE BONUS ACTION if abilities allow it (specified in bonusActions)
- You can use ONE REACTION per round (not on your turn, e.g., opportunity attacks)
- Some creatures have Multiattack (allows multiple attacks as one action)
- Movement can provoke OPPORTUNITY ATTACKS if you leave enemy reach without Disengage

IMPORTANT: This system may ask you for MULTIPLE DECISIONS within a single turn.
- Treat each response as the NEXT STEP of your turn.
- A typical turn can be: (Action) then (Move), or (Move) then (Action), plus an optional (Bonus Action).
- "move" represents movement and does NOT consume your Action.
- Use endTurn: false when you intend to take additional steps this turn (e.g., after "dash" you MUST still use "move" to relocate).
- Use endTurn: true only when you are fully done with your turn.

CRITICAL - DASH ACTION MECHANICS:
- "dash" is an ACTION that DOUBLES your available movement speed for this turn
- After using "dash", you MUST choose "move" (with endTurn: false) to actually relocate
- Example: Dash (action) → gives 60ft total movement → then "move" to new position
- DO NOT set endTurn: true after "dash" unless you want to waste the extra movement

ACTION ECONOMY ENFORCEMENT (read the context):
- The input context may include context.combatant.economy.actionSpent / bonusActionSpent / reactionSpent.
- If context.combatant.economy.actionSpent is true, you MUST NOT choose an action-consuming action (attack, shove, grapple, dash, dodge, disengage, help, hide, search, useObject, castSpell).
  - In that case, only choose action: "move" (optionally with a bonusAction if allowed) OR action: "endTurn".
- If context.combatant.economy.bonusActionSpent is true, do not include a bonusAction.

ACTION RESULT FEEDBACK (read the context):
- The context may include context.lastActionResult and context.turnResults describing what happened earlier this turn.
- Use this to decide your next step. Example: if you tried a shove and it failed, you can still choose to move (accepting opportunity attacks), Disengage (if action is still available), or endTurn.

AVAILABLE ACTIONS:
1. ATTACK - Use weapon or natural attack from "actions" array
   - "Scimitar", "Shortbow", "Bite", etc.
   - "Multiattack" - if available, use this to make multiple attacks as one action
   - ONLY use attacks listed in context.combatant.actions array

2. MOVEMENT (always available, does NOT cost an action):
   - "move" - move to a new position (provide destination coordinates)
   - Movement is FREE and does NOT consume your action
   - You can move before, after, or between actions
   - Leaving enemy reach (5ft in D&D) triggers opportunity attacks unless you used Disengage
   - IMPORTANT: After using "dash" action, you MUST use "move" to actually relocate with the doubled speed

3. BASIC COMBAT ACTIONS (always available to ALL creatures):
   - "dash" - doubles your movement speed for this turn (then use "move" to relocate)
   - "disengage" - prevents opportunity attacks when you move away from enemies this turn
   - "disengage" - move without provoking opportunity attacks this turn
   - "dodge" - increase defense (enemies have disadvantage against you until your next turn)
   - "help" - give ally advantage on next attack or ability check
   - "hide" - attempt to hide (requires cover or obscurement)
   - "search" - look for hidden creatures or objects
   - "useObject" - interact with objects (open doors, pull levers, drink potions)
   
4. ADVANCED ACTIONS (always available to ALL creatures):
   - "grapple" - grab an enemy (contested Athletics check)
   - "shove" - push enemy back 5ft or knock prone

5. SPECIAL ABILITIES:
   - "castSpell" - cast a spell (ONLY if context.combatant.spells array has spells)
   - Check context.combatant.bonusActions for bonus action abilities
   - Check context.combatant.reactions for reaction abilities

6. END TURN:
   - "endTurn" - finish your turn if no better options available

TACTICAL POSITIONING:
- Use context.combatant.position and enemies[].position if available
- Consider range: melee (5-10ft), ranged (30-120ft typical)
- Use terrain: cover provides AC bonuses, difficult terrain slows movement
- Opportunity attacks: leaving enemy reach without Disengage triggers free attack
- Flanking: position allies on opposite sides of enemy for advantage

GROUP TACTICS:
- Coordinate with allies: focus fire on wounded enemies, protect injured allies
- Don't all do the same thing; use variety for tactical advantage
- Consider your role: damage dealer, tank, supporter
- Use Grapple/Shove to control enemies for allies

OUTPUT FORMAT:
Respond with ONLY a single JSON object containing (no other text, no markdown, no code fences):
{
  "action": string,           // "attack", "move", "dodge", "dash", "disengage", "help", "hide", "grapple", "shove", "search", "useObject", "castSpell", "endTurn"
  "target": string,           // Target name (for attacks, grapple, shove, help)
  "attackName": string,       // Specific attack from "actions" (e.g., "Scimitar", "Shortbow")
  "destination": object,      // For move: {x: number, y: number} coordinates
  "spellName": string,        // For castSpell: spell name
  "bonusAction": string,      // Optional: bonus action ability name from context.combatant.bonusActions (e.g., "Nimble Escape", "Cunning Action")
  "seed": number,             // Optional: deterministic seed for contested checks (useful for testing)
  "intentNarration": string,  // Brief intent (1 sentence): what you're about to do
  "reasoning": string,        // Your tactical reasoning (not shown to players)
  "endTurn": boolean          // true when you're done with your turn
}

BONUS ACTIONS:
- Check context.combatant.bonusActions array for available bonus action abilities
- Common examples: "Nimble Escape" (Goblin: disengage/hide), "Cunning Action" (Rogue: dash/disengage/hide), "Flurry of Blows" (Monk: extra unarmed strikes)
- Include bonusAction field with the ability name when you want to use it
- The server will handle the specific execution of the bonus action

IMPORTANT: Always provide intentNarration, even for defensive actions or waiting.

TURN END RULES:
- You still only get ONE action per turn.
- You may still move before/after that action.
- If you use your action but still want to move, set endTurn: false and follow up with action: "move".
- For Multiattack, you still only get ONE action total.
- If you want to skip your turn (wait/hold), use action: "endTurn" with intentNarration explaining why

EXAMPLES:
1. Goblin attacking with scimitar:
{
  "action": "attack",
  "target": "Gandalf",
  "attackName": "Scimitar",
  "bonusAction": "Nimble Escape",
  "intentNarration": "The goblin lunges at the wizard with its scimitar!",
  "reasoning": "Wizard is low HP and has low AC. Using Nimble Escape to disengage and avoid retaliation.",
  "endTurn": true
}

2. Goblin moving tactically:
{
  "action": "move",
  "destination": {"x": 25, "y": 30},
  "intentNarration": "The goblin scurries to flank the fighter!",
  "reasoning": "Moving to better position for next turn's attack. Distance is within movement range.",
  "endTurn": true
}

3. Goblin grappling enemy:
{
  "action": "grapple",
  "target": "Frodo",
  "intentNarration": "The goblin tries to grab the halfling!",
  "reasoning": "Small target, easy to grapple. Will help allies hit him.",
  "endTurn": true
}

4. Goblin using terrain:
{
  "action": "hide",
  "bonusAction": "Nimble Escape",
  "intentNarration": "The goblin ducks behind the crates!",
  "reasoning": "Low HP, using cover to hide with Nimble Escape bonus action. Will attack with advantage next turn.",
  "endTurn": true
}

5. Shove then move (multi-step within one turn):
First response:
{
  "action": "shove",
  "target": "Brave Fighter",
  "intentNarration": "The goblin plants its feet and tries to slam the fighter backward!",
  "reasoning": "Create space so I can run without provoking an opportunity attack.",
  "endTurn": false
}
Second response (after you are asked again):
{
  "action": "move",
  "destination": {"x": 0, "y": 0},
  "intentNarration": "With the fighter pushed back, the goblin bolts for the exit!",
  "reasoning": "Now I'm outside melee reach; repositioning to safety.",
  "endTurn": true
}

6. Goblin supporting ally:
{
  "action": "attack",
  "target": "Thorin",
  "attackName": "Shortbow",
  "intentNarration": "The goblin draws its bow and aims at the fighter!",
  "reasoning": "Ally goblin is engaged with fighter. Ranged attack from safety.",
  "endTurn": true
}

7. Goblin skipping turn (waiting/defensive):
{
  "action": "endTurn",
  "intentNarration": "The goblin holds its ground, circling warily.",
  "reasoning": "Low on HP, waiting for ally to engage first. No good targets in range."
}`;
  }

  private parseDecision(json: any): AiDecision | null {
    if (!json || typeof json !== 'object') {
      return null;
    }

    const action = json.action;
    if (typeof action !== 'string') {
      return null;
    }

    // Map action types to AiDecision discriminated union
    if (action === 'attack') {
      return {
        action: 'attack',
        target: typeof json.target === 'string' ? json.target : undefined,
        attackName: typeof json.attackName === 'string' ? json.attackName : undefined,
        bonusAction: typeof json.bonusAction === 'string' ? json.bonusAction : undefined,
        intentNarration: typeof json.intentNarration === 'string' ? json.intentNarration : undefined,
        reasoning: typeof json.reasoning === 'string' ? json.reasoning : undefined,
        endTurn: typeof json.endTurn === 'boolean' ? json.endTurn : true,
      };
    }

    if (action === 'move') {
      return {
        action: 'move',
        destination: json.destination && typeof json.destination === 'object' 
          ? json.destination 
          : undefined,
        bonusAction: typeof json.bonusAction === 'string' ? json.bonusAction : undefined,
        intentNarration: typeof json.intentNarration === 'string' ? json.intentNarration : undefined,
        reasoning: typeof json.reasoning === 'string' ? json.reasoning : undefined,
        endTurn: typeof json.endTurn === 'boolean' ? json.endTurn : true,
      };
    }

    if (action === 'grapple' || action === 'shove') {
      return {
        action,
        target: typeof json.target === 'string' ? json.target : undefined,
        seed: typeof json.seed === 'number' && Number.isInteger(json.seed) ? json.seed : undefined,
        bonusAction: typeof json.bonusAction === 'string' ? json.bonusAction : undefined,
        intentNarration: typeof json.intentNarration === 'string' ? json.intentNarration : undefined,
        reasoning: typeof json.reasoning === 'string' ? json.reasoning : undefined,
        endTurn: typeof json.endTurn === 'boolean' ? json.endTurn : true,
      };
    }

    if (action === 'dodge' || action === 'dash' || action === 'disengage' || action === 'help' || action === 'hide' || action === 'search' || action === 'useObject') {
      return {
        action,
        target: action === 'help' && typeof json.target === 'string' ? json.target : undefined,
        bonusAction: typeof json.bonusAction === 'string' ? json.bonusAction : undefined,
        intentNarration: typeof json.intentNarration === 'string' ? json.intentNarration : undefined,
        reasoning: typeof json.reasoning === 'string' ? json.reasoning : undefined,
        endTurn: typeof json.endTurn === 'boolean' ? json.endTurn : true,
      };
    }

    if (action === 'castSpell') {
      return {
        action: 'castSpell',
        spellName: typeof json.spellName === 'string' ? json.spellName : undefined,
        target: typeof json.target === 'string' ? json.target : undefined,
        bonusAction: typeof json.bonusAction === 'string' ? json.bonusAction : undefined,
        intentNarration: typeof json.intentNarration === 'string' ? json.intentNarration : undefined,
        reasoning: typeof json.reasoning === 'string' ? json.reasoning : undefined,
        endTurn: typeof json.endTurn === 'boolean' ? json.endTurn : true,
      };
    }

    if (action === 'endTurn') {
      return {
        action: 'endTurn',
        intentNarration: typeof json.intentNarration === 'string' ? json.intentNarration : undefined,
        reasoning: typeof json.reasoning === 'string' ? json.reasoning : undefined,
      };
    }

    // Unknown action type
    return null;
  }
}
