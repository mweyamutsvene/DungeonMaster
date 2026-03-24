import type { LlmProvider } from './types.js';
import type { IAiDecisionMaker, AiDecision, AiCombatContext } from '../../application/services/combat/ai/ai-types.js';
import { extractFirstJsonObject } from './json.js';
import { llmDebugLog } from './debug.js';
import { PromptBuilder } from './prompt-builder.js';

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
    context: AiCombatContext;
  }): Promise<AiDecision | null> {
    // Pre-compute conditional section content (JS evaluates all args eagerly, so guard nulls here)
    const bf = input.context.battlefield;
    const battlefieldContent = bf
      ? `BATTLEFIELD:\n${bf.grid}\n\nLEGEND:\n${bf.legend}`
      : '';

    const bp = input.context.battlePlan;
    const battlePlanContent = bp
      ? [
          'BATTLE PLAN:',
          `Priority: ${bp.priority}`,
          bp.focusTarget ? `Focus target: ${bp.focusTarget}` : null,
          bp.yourRole ? `Your role: ${bp.yourRole}` : null,
          `Strategy: ${bp.tacticalNotes}`,
          bp.retreatCondition ? `Retreat if: ${bp.retreatCondition}` : null,
        ]
          .filter(Boolean)
          .join('\n')
      : '';

    const hasNarrative = input.context.recentNarrative.length > 0;
    const narrativeContent = hasNarrative
      ? 'Recent combat narrative:\n' +
        input.context.recentNarrative.map((text, i) => `${i + 1}. ${text}`).join('\n')
      : '';

    // Pre-filter useObject: only available when creature has potions AND HP is low (<50%)
    const useObjectAvailable = input.context.hasPotions && input.context.combatant.hp.percentage < 50;

    // Strip battlefield from the JSON snapshot — it's already rendered as a formatted top-level section
    const { battlefield: _bf, ...contextWithoutBattlefield } = input.context;
    const prompt = new PromptBuilder('v1')
      .addSection('system', this.buildSystemPrompt(input.combatantName, input.combatantType, useObjectAvailable))
      .addSectionIf(!!bf, 'battlefield', battlefieldContent)
      .addSectionIf(!!bp, 'battle-plan', battlePlanContent)
      .addSectionIf(hasNarrative, 'narrative', narrativeContent)
      .addSection('combat-state', 'Current combat state:\n' + JSON.stringify(contextWithoutBattlefield, null, 2));

    const messages = prompt.buildAsMessages();

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

  private buildSystemPrompt(actorName: string, actorType: string, useObjectAvailable: boolean): string {
    return `You are the tactical brain of a combatant in a D&D combat encounter.
You control this combatant's actions and must make strategic decisions following D&D-style rules.

COMBATANT IDENTITY:
- Name: ${actorName}
- Type: ${actorType}

PERSONALITY & TACTICS:
- Act in character based on the combatant's type, traits, and style.
- Use abilities from the context.combatant.bonusActions array or context.combatant.classAbilities when strategically advantageous.
- Consider enemy knownAbilities (listed in context.enemies[].knownAbilities) for tactical awareness.
- Consider morale: flee if badly wounded and outnumbered, fight to death if cornered.

CONDITIONS (IMPORTANT — source of truth):
- context.combatant.conditions lists YOUR current active conditions (e.g., ["Stunned", "Prone"]).
- context.enemies[].conditions and context.allies[].conditions list their active conditions.
- If context.combatant.conditions is absent or empty, you have NO conditions and can act normally.
- The "Recent combat narrative" may mention past conditions that have since expired — ALWAYS trust the structured conditions data over narrative text.
- Do NOT choose "endTurn" just because narrative describes a past condition. Only the conditions array is current state.

RESOURCES (check before using abilities):
- context.combatant.resourcePools is an array of { name, current, max } tracking expendable resources.
- Pool names include: "ki", "spellSlot_1" through "spellSlot_9", "rage", "actionSurge", "secondWind", "channelDivinity", "layOnHands", "pactMagic".
- ALWAYS check current > 0 before attempting abilities that cost resources.
- Do NOT try to cast a leveled spell if the corresponding spellSlot_N pool has current === 0.
- Cantrips (level 0 spells) do not consume spell slots.

CONCENTRATION (spell management):
- context.combatant.concentrationSpell — if set, you are currently concentrating on this spell.
- Casting a new concentration spell will AUTOMATICALLY drop your current concentration spell. Only do this if the new spell is more valuable.
- context.enemies[].concentrationSpell — if an enemy is concentrating, attacking them can force a CON save to break their spell. Prioritize attacking concentrating enemies if their spell is dangerous (Spirit Guardians, Spike Growth, etc.).
- context.allies[].concentrationSpell — be aware of ally concentration to avoid friendly fire or tactical conflicts.

ZONES (area effects on the battlefield):
- context.zones lists active zone effects on the battlefield (Spirit Guardians, Spike Growth, Cloud of Daggers, Wall of Fire, auras, etc.).
- Each zone has: center position, radiusFeet, shape (circle/line/cone/cube), source (spell name), type (aura/placed/stationary).
- Each zone has effects[] listing what triggers: "on_enter" (entering), "on_start_turn" / "on_end_turn" (starting/ending turn in zone), "per_5ft_moved" (every 5ft inside), "passive" (continuous aura buff).
- AVOID moving through damaging zones if possible — use paths that go around them.
- "per_5ft_moved" zones (Spike Growth) deal cumulative damage for every cell traversed inside them — NEVER walk through these unless absolutely necessary.
- "on_enter" zones (Spirit Guardians) deal damage once when you enter — consider the cost before entering.
- "aura" type zones MOVE WITH their source creature — attacking and killing the caster removes the zone.
- To remove a concentration zone (Spirit Guardians, Spike Growth, etc.), attack the concentrating caster to force a CON save. If they fail, the zone disappears.
- The A* pathfinding already penalizes zone cells, so "moveToward" will prefer safe paths. But you should still avoid choosing destinations inside damaging zones.

DEFENSES (damage type awareness):
- context.combatant.damageResistances/damageImmunities/damageVulnerabilities — YOUR damage defenses.
- context.enemies[].damageResistances/damageImmunities/damageVulnerabilities — enemy defenses.
- context.allies[].damageResistances/damageImmunities/damageVulnerabilities — ally defenses.
- Prefer damage types enemies are VULNERABLE to (double damage).
- AVOID damage types enemies are IMMUNE to (zero damage) or RESISTANT to (half damage).
- When choosing between attacks or spells, factor in the target's defenses.

BUFFS (active effects on self):
- context.combatant.activeBuffs lists currently active buff effects as human-readable strings.
- "Raging" = you have resistance to bludgeoning/piercing/slashing + melee damage bonus. Prefer STR-based melee attacks.
- "Dashed" = you have extra movement available this turn.
- "Disengaged" = you can move without provoking opportunity attacks this turn.
- "Reckless Attack" = enemies have advantage on attacks against you this round — be cautious about staying in melee.

DISTANCES (pre-computed — no math needed):
- context.enemies[].distanceFeet and context.allies[].distanceFeet are pre-computed distances in feet from YOU to each creature.
- Use distanceFeet to assess range: compare against your speed, weapon ranges, and spell ranges.
- A creature with distanceFeet <= 5 is in melee reach (or 10 for reach weapons).
- DO NOT calculate distances from grid coordinates — always use distanceFeet.

ABILITY SCORES (self assessment):
- context.combatant.abilityScores provides your { strength, dexterity, constitution, intelligence, wisdom, charisma }.
- Use STR for grapple/shove contests. Compare your STR vs the target's likely STR or DEX.
- Use ability scores to assess which saves you're strong/weak at.

SPELL SAVE DC & ATTACK BONUS:
- context.combatant.spellSaveDC — your spell save DC. Higher DC = harder for enemies to resist your spells.
- context.combatant.spellAttackBonus — your spell attack modifier.
- When choosing spells, target enemies with low saves against your attack type.

SIZE (creature size category):
- context.combatant.size, context.enemies[].size, context.allies[].size — creature sizes (Tiny, Small, Medium, Large, Huge, Gargantuan).
- You can only grapple creatures up to ONE size larger than you.
- Size affects space on the grid and some ability eligibility.

SPEED (movement assessment):
- context.combatant.speed is your movement speed in feet.
- context.enemies[].speed and context.allies[].speed are their speeds.
- Compare speeds to assess chase/escape viability. A faster enemy can outrun you.

CHARACTER FEATURES & ATTACKS:
- context.combatant.features lists class features (e.g., Extra Attack, Fighting Style, Improved Critical).
- If you have a feature named "Extra Attack", you can make TWO attacks per Attack action — set endTurn: false after your first attack to take the second.
- context.combatant.attacks lists your weapon attacks with attack bonuses and damage dice.
- Use attacks[] to choose the best weapon for each situation (melee vs ranged, damage type vs enemy defenses).

ALLY AWARENESS:
- context.allies[] now includes full tactical data: ac, speed, class, level, knownAbilities, and damage defenses.
- Use ally AC to prioritize healing (low AC allies are more vulnerable).
- Use ally knownAbilities to coordinate tactics (e.g., an ally with Cunning Action can reposition on their own).
- Use ally class/level to decide your role (support the frontline fighter, protect the squishy wizard).

BATTLE PLAN (faction coordination):
- If context.battlePlan is present, it contains your faction's strategic objectives.
- priority: The overall faction strategy (offensive/defensive/retreat/protect/ambush).
- focusTarget: The primary enemy to focus on. Prefer attacking this target over others.
- yourRole: Your specific role in the plan. Follow it.
- tacticalNotes: General tactical guidance from your faction commander.
- retreatCondition: If this condition is met, use Disengage and move away from enemies.
- Adhere to the battle plan UNLESS:
  - Your focusTarget is dead or unreachable
  - You are about to die (self-preservation overrides)
  - A clearly better opportunity presents itself (e.g., finishing off a nearly dead enemy)

DEATH SAVES (triage):
- context.allies[].deathSaves — if present, this ally is dying (0 HP). { successes, failures } tracks their death save progress.
  - 3 failures = dead. Prioritize stabilizing allies with 2 failures.
  - Consider using Help action, Spare the Dying, or healing spells on dying allies.
- context.enemies[].deathSaves — if present, this enemy is dying. Consider finishing them off if they have few failures.

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
- The input context may include context.combatant.economy.actionSpent / bonusActionSpent / reactionSpent / movementSpent.
- If context.combatant.economy.actionSpent is true, you MUST NOT choose an action-consuming action (attack, shove, grapple, escapeGrapple, dash, dodge, disengage, help, hide, search, useObject, castSpell).
  - In that case, only choose action: "move" (optionally with a bonusAction if allowed) OR action: "endTurn".
- If context.combatant.economy.bonusActionSpent is true, do not include a bonusAction. This field now correctly reflects when bonus action has been used.
- If context.combatant.economy.reactionSpent is true, your reaction is unavailable this round.
- If context.combatant.economy.movementSpent is FALSE, you CAN still move! Choose action: "move" with a destination.
- context.combatant.speed tells you your movement speed in feet (default 30). Use this to plan movement range.
- context.combatant.ac is your armor class — factor this into defensive decisions.
- PRIORITIZE movement after attacking if movementSpent is false - retreat to safety, get behind cover, etc.

PRONE MOVEMENT RULES:
- If you have the "Prone" condition, standing up costs HALF your base speed (e.g., 15ft for a creature with 30ft speed).
- After standing up, you can move normally with the remaining speed.
- The server automatically handles standing up when you choose "move" while Prone — the stand-up cost is deducted from your available movement.
- If you have the "Prone" condition AND "Grappled", "Stunned", "Incapacitated", "Paralyzed", or "Unconscious", you CANNOT stand up or move.
- While Prone, your attacks have DISADVANTAGE. Melee attacks against you have ADVANTAGE. Standing up is almost always worthwhile.
- If you used Dash while Prone, you get double movement but still pay the half-base-speed stand-up cost once.
- STRATEGY: If you are Prone, use a "move" action (to your current position or toward the enemy) BEFORE attacking so the server automatically stands you up. Only attack while still prone if you have no remaining movement.

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
   - "moveToward" - move toward a named target (server handles pathfinding). Provide target name and optional desiredRange (default 5 = melee). The server uses A* pathfinding to find the best path.
   - "moveAwayFrom" - RETREAT from a named target (server handles pathfinding). Provide target name. The server will calculate the optimal direction and move you as far from the target as your speed allows. USE THIS INSTEAD OF "move" WHEN RETREATING — do NOT try to calculate retreat coordinates yourself.
   - Movement is FREE and does NOT consume your action
   - You can move before, after, or between actions
   - Leaving enemy reach (5ft in D&D) triggers opportunity attacks unless you used Disengage
   - IMPORTANT: After using "dash" action, you MUST use "move"/"moveToward"/"moveAwayFrom" to actually relocate with the doubled speed
   - PREFER "moveToward" when you want to approach a specific enemy — it handles pathfinding around obstacles automatically
   - PREFER "moveAwayFrom" when you want to retreat/flee — the server calculates the best escape route

3. BASIC COMBAT ACTIONS (always available to ALL creatures):
   - "dash" - doubles your movement speed for this turn (then use "move" to relocate)
   - "disengage" - prevents opportunity attacks when you move away from enemies this turn
   - "disengage" - move without provoking opportunity attacks this turn
   - "dodge" - increase defense (enemies have disadvantage against you until your next turn)
   - "help" - give ally advantage on next attack or ability check
   - "hide" - attempt to hide (Stealth check; succeeds if not clearly visible)
   - "search" - Perception check to find hidden creatures
   ${useObjectAvailable ? '- "useObject" - drink a healing potion from inventory. Your HP is below 50% and you have a potion — this is a good time to heal.' : ''}
   
4. ADVANCED ACTIONS (always available to ALL creatures):
   - "grapple" - grab an enemy (contested Athletics check)
   - "escapeGrapple" - escape from a grapple (contested Athletics/Acrobatics vs grappler's Athletics). Only use when you have the Grappled condition.
   - "shove" - push enemy back 5ft or knock prone

5. SPECIAL ABILITIES:
   - "castSpell" - cast a spell (ONLY if context.combatant.spells array has spells)
   - Check context.combatant.bonusActions for bonus action abilities
   - Check context.combatant.classAbilities for class-derived abilities (bonus actions, actions, reactions with resource costs)
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
  "action": string,           // "attack", "move", "moveToward", "moveAwayFrom", "dodge", "dash", "disengage", "help", "hide", "grapple", "escapeGrapple", "shove", "search", "castSpell", "endTurn"
  "target": string,           // Target name (for attacks, grapple, shove, help)
  "attackName": string,       // Specific attack from "actions" (e.g., "Scimitar", "Shortbow")
  "destination": object,      // For move: {x: number, y: number} coordinates
  "desiredRange": number,     // For moveToward: how close to get to target in feet (default 5 = melee)
  "spellName": string,        // For castSpell: spell name
  "bonusAction": string,      // Optional: bonus action ability name from context.combatant.bonusActions or classAbilities (e.g., "Nimble Escape", "Flurry of Blows")
  "seed": number,             // Optional: deterministic seed for contested checks (useful for testing)
  "intentNarration": string,  // Brief intent (1 sentence): what you're about to do
  "reasoning": string,        // Your tactical reasoning (not shown to players)
  "endTurn": boolean          // true when you're done with your turn
}

BONUS ACTIONS:
- Check context.combatant.bonusActions array for available bonus action abilities
- Check context.combatant.classAbilities for class-derived bonus actions (entries with economy: "bonus")
- Class abilities include resource costs (e.g., "1 ki") — ALWAYS verify the corresponding resourcePool has current > 0 before using
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

3. Goblin moving toward a target (server handles pathfinding):
{
  "action": "moveToward",
  "target": "Gandalf",
  "desiredRange": 5,
  "intentNarration": "The goblin charges toward the wizard!",
  "reasoning": "Need to close distance for melee attack next turn. Server will find best path around obstacles.",
  "endTurn": false
}

4. Goblin grappling enemy:
{
  "action": "grapple",
  "target": "Frodo",
  "intentNarration": "The goblin tries to grab the halfling!",
  "reasoning": "Small target, easy to grapple. Will help allies hit him.",
  "endTurn": true
}

5. Goblin hiding:
{
  "action": "hide",
  "intentNarration": "The goblin ducks behind cover!",
  "reasoning": "Low HP, using Stealth to gain Hidden condition. Enemies will need to Search to find me.",
  "endTurn": true
}

6. Shove then move (multi-step within one turn):
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

7. Goblin supporting ally:
{
  "action": "attack",
  "target": "Thorin",
  "attackName": "Shortbow",
  "intentNarration": "The goblin draws its bow and aims at the fighter!",
  "reasoning": "Ally goblin is engaged with fighter. Ranged attack from safety.",
  "endTurn": true
}

8. Goblin skipping turn (waiting/defensive):
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

    if (action === 'moveToward') {
      return {
        action: 'moveToward',
        target: typeof json.target === 'string' ? json.target : undefined,
        desiredRange: typeof json.desiredRange === 'number' ? json.desiredRange : undefined,
        bonusAction: typeof json.bonusAction === 'string' ? json.bonusAction : undefined,
        intentNarration: typeof json.intentNarration === 'string' ? json.intentNarration : undefined,
        reasoning: typeof json.reasoning === 'string' ? json.reasoning : undefined,
        endTurn: typeof json.endTurn === 'boolean' ? json.endTurn : true,
      };
    }

    if (action === 'moveAwayFrom') {
      return {
        action: 'moveAwayFrom',
        target: typeof json.target === 'string' ? json.target : undefined,
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

    if (action === 'escapeGrapple') {
      return {
        action,
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
