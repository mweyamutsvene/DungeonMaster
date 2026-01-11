import type { ICombatRepository, ICharacterRepository, IMonsterRepository, INPCRepository, IEventRepository } from '../../../repositories/index.js';
import type { CombatEncounterRecord, CombatantStateRecord } from '../../../types.js';
import type { ActionService } from '../action-service.js';
import type { CombatService } from '../combat-service.js';
import type { FactionService } from '../helpers/faction-service.js';
import type { ICombatantResolver } from '../helpers/combatant-resolver.js';
import type { IAiDecisionMaker, AiDecision } from './ai-decision-maker.js';
import type { CombatMap } from '../../../../domain/rules/combat-map.js';
import type { AbilityRegistry } from '../abilities/ability-registry.js';
import { renderBattlefield, createCombatantEntity } from '../../../../domain/rules/battlefield-renderer.js';
import { listCreatureAbilities } from '../../../../domain/abilities/creature-abilities.js';
import { nanoid } from 'nanoid';

type TurnStepResult = {
  step: number;
  action: AiDecision['action'];
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
};

/**
 * LLM-driven tactical decision-making for AI-controlled combatants.
 * Layer: Application.
 * Notes: Uses `FactionService` + `ActionService`/`CombatService` for deterministic execution; LLM is optional and must not decide rules.
 */
export class MonsterAIService {
  private readonly aiDebugEnabled =
    process.env.DM_AI_DEBUG === "1" ||
    process.env.DM_AI_DEBUG === "true" ||
    process.env.DM_AI_DEBUG === "yes";

  private readonly downedSkipNarrated = new Set<string>();

  private aiLog(...args: unknown[]): void {
    if (this.aiDebugEnabled) console.log(...args);
  }

  private buildActorRef(aiCombatant: CombatantStateRecord):
    | { type: "Monster"; monsterId: string }
    | { type: "NPC"; npcId: string }
    | { type: "Character"; characterId: string }
    | null {
    if (aiCombatant.combatantType === "Monster" && aiCombatant.monsterId) {
      return { type: "Monster", monsterId: aiCombatant.monsterId };
    }
    if (aiCombatant.combatantType === "NPC" && aiCombatant.npcId) {
      return { type: "NPC", npcId: aiCombatant.npcId };
    }
    if (aiCombatant.combatantType === "Character" && aiCombatant.characterId) {
      return { type: "Character", characterId: aiCombatant.characterId };
    }
    return null;
  }
  constructor(
    private readonly combat: ICombatRepository,
    private readonly characters: ICharacterRepository,
    private readonly monsters: IMonsterRepository,
    private readonly npcs: INPCRepository,
    private readonly factionService: FactionService,
    private readonly actionService: ActionService,
    private readonly combatService: CombatService,
    private readonly combatantResolver: ICombatantResolver,
    private readonly abilityRegistry: AbilityRegistry,
    private readonly aiDecisionMaker?: IAiDecisionMaker,
    private readonly events?: IEventRepository,
  ) {}

  /**
   * AI decides whether to use a reaction (Opportunity Attack, Counterspell, etc.)
   * This allows tactical decision-making: save reaction for Shield spell, ignore low-value targets, etc.
   */
  private async aiDecideReaction(
    combatantState: CombatantStateRecord,
    reactionType: string,
    context: { targetName?: string; spellName?: string; hpPercent?: number }
  ): Promise<boolean> {
    // Simple heuristic for now (can be enhanced with LLM later):
    
    // Opportunity Attacks: Always use if healthy, skip if below 25% HP
    if (reactionType === 'opportunity_attack') {
      const hpPercent = combatantState.hpCurrent / combatantState.hpMax;
      if (hpPercent < 0.25) {
        this.aiLog(`[AI Reaction] ${combatantState.id} declining OA - low HP (${Math.round(hpPercent * 100)}%)`);
        return false;
      }
      this.aiLog(`[AI Reaction] ${combatantState.id} using OA on ${context.targetName}`);
      return true;
    }
    
    // Counterspell: Always attempt to counter
    if (reactionType === 'counterspell') {
      this.aiLog(`[AI Reaction] ${combatantState.id} counterspelling ${context.spellName}`);
      return true;
    }
    
    // Default: use reaction
    return true;
  }

  /**
   * Check if current turn belongs to an AI-controlled combatant and auto-process if needed
   * Returns true if an AI turn was processed
   */
  async processMonsterTurnIfNeeded(sessionId: string, encounterId: string): Promise<boolean> {
    const encounter = await this.combat.getEncounterById(encounterId);
    if (!encounter || encounter.status !== 'Active') {
      return false;
    }

    const combatants = await this.combat.listCombatants(encounterId);
    if (combatants.length === 0) {
      return false;
    }

    const currentCombatant = combatants[encounter.turn];
    if (!currentCombatant) {
      return false;
    }

    // Skip dead combatants entirely. This keeps the encounter moving and prevents
    // wasting LLM calls on 0-HP actors.
    if (currentCombatant.hpCurrent <= 0) {
      if (this.events) {
        const key = `${encounterId}:${currentCombatant.id}`;
        if (!this.downedSkipNarrated.has(key)) {
          this.downedSkipNarrated.add(key);

          let name = "Combatant";
          if (currentCombatant.combatantType === "Monster" && currentCombatant.monsterId) {
            const m = await this.monsters.getById(currentCombatant.monsterId);
            name = m?.name ?? "Monster";
          } else if (currentCombatant.combatantType === "NPC" && currentCombatant.npcId) {
            const n = await this.npcs.getById(currentCombatant.npcId);
            name = n?.name ?? "NPC";
          } else if (currentCombatant.combatantType === "Character" && currentCombatant.characterId) {
            const c = await this.characters.getById(currentCombatant.characterId);
            name = c?.name ?? "Character";
          }

          await this.events.append(sessionId, {
            id: nanoid(),
            type: "NarrativeText",
            payload: { encounterId, text: `${name} is down and cannot act.` },
          });
        }
      }
      await this.combatService.nextTurn(sessionId, { encounterId });
      return true;
    }

    // Check if this combatant is AI-controlled (Monster, NPC, or AI-controlled Character)
    const isAI = await this.factionService.isAIControlled(currentCombatant);
    if (!isAI) {
      return false;
    }

    this.aiLog('[MonsterAI] Processing AI combatant turn:', {
      type: currentCombatant.combatantType,
      id: currentCombatant.characterId || currentCombatant.monsterId || currentCombatant.npcId,
      turn: encounter.turn 
    });
    
    // It's an AI-controlled combatant's turn - process it with LLM intelligence
    await this.executeMonsterTurn(sessionId, encounter, currentCombatant, combatants);
    this.aiLog('[MonsterAI] Monster turn completed');
    return true;
  }

  /**
   * Execute a single AI-controlled combatant turn using LLM as the "brain"
   * Implements feedback loop: LLM decides action → server executes → LLM sees results → repeats until turn ends
   */
  private async executeMonsterTurn(
    sessionId: string,
    encounter: CombatEncounterRecord,
    aiCombatant: CombatantStateRecord,
    allCombatants: CombatantStateRecord[],
  ): Promise<void> {
    const aiCombatantId = aiCombatant.id;
    // Load the entity based on type
    let entityName: string;
    let entityData: any;
    
    if (aiCombatant.combatantType === 'Monster' && aiCombatant.monsterId) {
      const monster = await this.monsters.getById(aiCombatant.monsterId);
      if (!monster) {
        await this.combatService.nextTurn(sessionId, { encounterId: encounter.id });
        return;
      }
      entityName = monster.name;
      entityData = monster;
    } else if (aiCombatant.combatantType === 'NPC' && aiCombatant.npcId) {
      const npc = await this.npcs.getById(aiCombatant.npcId);
      if (!npc) {
        await this.combatService.nextTurn(sessionId, { encounterId: encounter.id });
        return;
      }
      entityName = npc.name;
      entityData = npc;
    } else if (aiCombatant.combatantType === 'Character' && aiCombatant.characterId) {
      const character = await this.characters.getById(aiCombatant.characterId);
      if (!character) {
        await this.combatService.nextTurn(sessionId, { encounterId: encounter.id });
        return;
      }
      entityName = character.name;
      entityData = character;
    } else {
      await this.combatService.nextTurn(sessionId, { encounterId: encounter.id });
      return;
    }

    // If no AI decision maker available, fall back to simple behavior
    if (!this.aiDecisionMaker) {
      await this.fallbackSimpleTurn(sessionId, encounter, entityData, allCombatants);
      return;
    }

    // Execute turn loop: LLM decides actions until it explicitly ends turn
    const actionHistory: string[] = [];
    const turnResults: TurnStepResult[] = [];
    let turnComplete = false;
    let iterations = 0;
    const maxIterations = 5; // Safety limit
    
    // Load recent narrative history to give LLM context of what happened before
    const recentNarrative: string[] = [];
    if (this.events) {
      try {
        const allEvents = await this.events.listBySession(sessionId);
        const narrativeEvents = allEvents
          .filter(e => {
            if (e.type !== 'NarrativeText') return false;
            const payload = e.payload as Record<string, unknown> | null | undefined;
            if (!payload) return false;
            return payload.encounterId === encounter.id && typeof payload.text === 'string';
          })
          .slice(-10); // Last 10 narrative events for context
        
        recentNarrative.push(...narrativeEvents.map(e => (e.payload as { text: string }).text));
      } catch (err) {
        // If event loading fails, continue without narrative context
        console.warn('[MonsterAI] Failed to load recent narrative:', err);
      }
    }

    // Use a mutable snapshot of combatants so each iteration can reflect the results of previous actions.
    let currentCombatants = allCombatants;
    let currentAiCombatant = aiCombatant;

    while (!turnComplete && iterations < maxIterations) {
      iterations++;

      // Build combat context for LLM
      const context = await this.buildCombatContext(
        entityData,
        currentAiCombatant,
        currentCombatants,
        encounter,
        recentNarrative,
        actionHistory,
        turnResults,
      );

      // Get AI decision
      const decision = await this.aiDecisionMaker.decide({
        combatantName: entityName,
        combatantType: aiCombatant.combatantType,
        context,
      });

      if (!decision) {
        // LLM failed to provide decision, end turn
        break;
      }

      const actorRef = this.buildActorRef(aiCombatant);

      // Emit decision so tests/transcripts can show turns even when no attack occurs.
      if (this.events && actorRef) {
        await this.events.append(sessionId, {
          id: nanoid(),
          type: "AiDecision",
          payload: {
            encounterId: encounter.id,
            actor: actorRef,
            decision: {
              action: decision.action,
              target: decision.target,
              attackName: decision.attackName,
              destination: (decision as any).destination,
              spellName: (decision as any).spellName,
              seed: (decision as any).seed,
              bonusAction: decision.bonusAction,
              intentNarration: decision.intentNarration,
              reasoning: decision.reasoning,
              endTurn: decision.endTurn,
            },
          },
        });
      }

      // Log intent narration if provided (before action execution)
      // Show narration for all actions including endTurn (explains why they're not acting)
      if (decision.intentNarration) {
        const intentText = decision.intentNarration.trim();
        this.aiLog('[MonsterAI] Intent:', intentText);
        if (this.events && intentText) {
          await this.events.append(sessionId, {
            id: nanoid(),
            type: 'NarrativeText',
            payload: {
              encounterId: encounter.id,
              ...(actorRef ? { actor: actorRef } : undefined),
              text: intentText,
            },
          });
        }
      }

      // Execute the action (rolls dice, applies damage, etc.)
      const result = await this.executeMonsterAction(
        sessionId,
        encounter.id,
        entityData,
        currentAiCombatant,
        decision,
        currentCombatants,
      );

      // Add result to history for next iteration
      actionHistory.push(result.summary);
      turnResults.push({
        ...result,
        step: iterations,
        intentNarration: decision.intentNarration,
        reasoning: decision.reasoning,
        decision: {
          target: decision.target,
          attackName: decision.attackName,
          destination: (decision as any).destination,
          bonusAction: decision.bonusAction,
          spellName: (decision as any).spellName,
          seed: (decision as any).seed,
          endTurn: decision.endTurn,
        },
      });

      // Refresh combatant snapshots so the LLM can see updated positions/resources next iteration.
      try {
        currentCombatants = await this.combat.listCombatants(encounter.id);
        currentAiCombatant =
          currentCombatants.find((c) => c.id === aiCombatantId) ?? currentAiCombatant;
      } catch {
        // If refresh fails, continue with existing snapshot.
      }

      // Check if turn should end (default to true for D&D action economy)
      // In D&D, you get ONE action per turn, so after taking an action, turn ends
      if (decision.endTurn !== false) {
        turnComplete = true;
        break;
      }
    }

    // Advance to next turn
    await this.combatService.nextTurn(sessionId, { encounterId: encounter.id });
  }

  /**
   * Build rich combat context for AI decision maker including personality, tactics, and current state
   * Uses faction-based ally/enemy determination
   */
  private async buildCombatContext(
    entityData: any,
    aiCombatant: CombatantStateRecord,
    allCombatants: CombatantStateRecord[],
    encounter: CombatEncounterRecord,
    recentNarrative: string[],
    actionHistory: string[],
    turnResults: TurnStepResult[],
  ): Promise<{
    combatant: any;
    combat: any;
    allies: any[];
    enemies: any[];
    battlefield?: { grid: string; legend: string; size: { width: number; height: number } };
    recentNarrative: string[];
    actionHistory: string[];
    turnResults: TurnStepResult[];
    lastActionResult: TurnStepResult | null;
  }> {
    // Determine allies and enemies using faction service
    const allies = await this.factionService.getAllies(allCombatants, aiCombatant);
    const enemies = await this.factionService.getEnemies(allCombatants, aiCombatant);

    // Batch-load all names for allies and enemies
    const allRelevant = [...allies, ...enemies];
    const nameMap = await this.combatantResolver.getNames(allRelevant);

    // Extract position from resources if available
    const getPosition = (c: CombatantStateRecord): { x: number; y: number } | undefined => {
      const resources = c.resources as any;
      return resources?.position;
    };

    const getEconomy = (c: CombatantStateRecord):
      | {
          actionSpent: boolean;
          bonusActionSpent: boolean;
          reactionSpent: boolean;
          movementRemaining?: number;
        }
      | undefined => {
      const resources = c.resources as any;
      if (!resources || typeof resources !== 'object') return undefined;

      const movementRemaining =
        typeof resources.movementRemaining === 'number' ? resources.movementRemaining : undefined;

      return {
        actionSpent: resources.actionSpent === true,
        bonusActionSpent: resources.bonusActionSpent === true,
        reactionSpent: resources.reactionSpent === true,
        ...(movementRemaining !== undefined ? { movementRemaining } : {}),
      };
    };

    // Build ally details
    const allyDetails = allies.map((a: CombatantStateRecord) => {
      const position = getPosition(a);
      return {
        ...a,
        name: nameMap.get(a.id) || 'Ally',
        hp: {
          current: a.hpCurrent,
          max: a.hpMax,
          percentage: Math.round((a.hpCurrent / a.hpMax) * 100),
        },
        ...(position ? { position } : {}),
        initiative: a.initiative,
      };
    });

    // Build enemy details
    const enemyDetails = await Promise.all(
      enemies.map(async (e: CombatantStateRecord) => {
        const name = nameMap.get(e.id) || 'Enemy';
        const position = getPosition(e);
        let className = undefined;
        let level = undefined;
        let armorClass = undefined;
        let knownAbilities: string[] = [];
        
        if (e.combatantType === 'Character' && e.characterId) {
          const char = await this.characters.getById(e.characterId);
          if (char) {
            className = char.className || undefined;
            level = char.level;
            const sheet = char.sheet as any;
            armorClass = sheet?.armorClass;
            
            // Extract known abilities for tactical awareness
            try {
              const abilities = listCreatureAbilities({ creature: char as any });
              knownAbilities = abilities
                .filter(a => a.economy === 'bonus' || a.economy === 'reaction' || (a.source !== 'base' && a.economy === 'action'))
                .map(a => a.name);
            } catch {
              // Ignore errors in ability listing
            }
          }
        } else if (e.combatantType === 'NPC' && e.npcId) {
          const npc = await this.npcs.getById(e.npcId);
          if (npc) {
            const statBlock = npc.statBlock as any;
            className = statBlock?.className;
            level = statBlock?.level;
            armorClass = statBlock?.armorClass;
            
            // Extract known abilities
            try {
              const abilities = listCreatureAbilities({ creature: npc as any, monsterStatBlock: statBlock });
              knownAbilities = abilities
                .filter(a => a.economy === 'bonus' || a.economy === 'reaction' || (a.source !== 'base' && a.economy === 'action'))
                .map(a => a.name);
            } catch {
              // Ignore errors
            }
          }
        } else if (e.combatantType === 'Monster' && e.monsterId) {
          const monster = await this.monsters.getById(e.monsterId);
          if (monster) {
            const statBlock = monster.statBlock as any;
            armorClass = statBlock?.armorClass;
            
            // Extract known abilities
            try {
              const abilities = listCreatureAbilities({ creature: monster as any, monsterStatBlock: statBlock });
              knownAbilities = abilities
                .filter(a => a.economy === 'bonus' || a.economy === 'reaction' || (a.source !== 'base' && a.economy === 'action'))
                .map(a => a.name);
            } catch {
              // Ignore errors
            }
          }
        }
        
        return {
          name,
          class: className,
          level,
          hp: {
            current: e.hpCurrent,
            max: e.hpMax,
            percentage: Math.round((e.hpCurrent / e.hpMax) * 100),
          },
          ...(position ? { position } : {}),
          ac: armorClass,
          initiative: e.initiative,
          ...(knownAbilities.length > 0 ? { knownAbilities } : {}),
        };
      }),
    );

    // Build entity info based on type
    let entityInfo: any;
    const aiPosition = getPosition(aiCombatant);
    const aiEconomy = getEconomy(aiCombatant);
    if (aiCombatant.combatantType === 'Monster') {
      const statBlock = entityData.statBlock as any;
      entityInfo = {
        name: entityData.name,
        type: statBlock.type,
        alignment: statBlock.alignment,
        cr: statBlock.cr,
        hp: {
          current: aiCombatant.hpCurrent,
          max: aiCombatant.hpMax,
          percentage: Math.round((aiCombatant.hpCurrent / aiCombatant.hpMax) * 100),
        },
        ...(aiPosition ? { position: aiPosition } : {}),
        ...(aiEconomy ? { economy: aiEconomy } : {}),
        traits: statBlock.traits || [],
        actions: statBlock.actions || [],
        bonusActions: statBlock.bonusActions || [],
        reactions: statBlock.reactions || [],
      };
    } else if (aiCombatant.combatantType === 'NPC') {
      const statBlock = entityData.statBlock as any;
      entityInfo = {
        name: entityData.name,
        class: statBlock.className,
        level: statBlock.level,
        hp: {
          current: aiCombatant.hpCurrent,
          max: aiCombatant.hpMax,
          percentage: Math.round((aiCombatant.hpCurrent / aiCombatant.hpMax) * 100),
        },
        ...(aiPosition ? { position: aiPosition } : {}),
        ...(aiEconomy ? { economy: aiEconomy } : {}),
        spells: statBlock.spells || [],
        abilities: statBlock.abilities || [],
        actions: statBlock.actions || [],
      };
    } else {
      // AI-controlled Character
      const sheet = entityData.sheet as any;
      entityInfo = {
        name: entityData.name,
        class: entityData.className,
        level: entityData.level,
        hp: {
          current: aiCombatant.hpCurrent,
          max: aiCombatant.hpMax,
          percentage: Math.round((aiCombatant.hpCurrent / aiCombatant.hpMax) * 100),
        },
        ...(aiPosition ? { position: aiPosition } : {}),
        ...(aiEconomy ? { economy: aiEconomy } : {}),
        spells: sheet.spells || [],
        abilities: sheet.abilities || [],
      };
    }

    // Render battlefield if map data is present
    let battlefield: { grid: string; legend: string; size: { width: number; height: number } } | undefined;
    if (encounter.mapData) {
      const map = encounter.mapData as CombatMap;
      
      // Build entity list for battlefield rendering
      const entities = [];
      
      // Add self
      if (aiPosition) {
        entities.push(
          createCombatantEntity(
            { name: entityInfo.name, position: aiPosition, hpCurrent: aiCombatant.hpCurrent, hpMax: aiCombatant.hpMax, faction: (aiCombatant.character || aiCombatant.monster || aiCombatant.npc)?.faction || undefined },
            '@',
            true,
            (aiCombatant.character || aiCombatant.monster || aiCombatant.npc)?.faction || 'Unknown',
          ),
        );
      }
      
      // Add allies with numeric characters
      let allyChar = 1;
      for (const ally of allies) {
        const pos = getPosition(ally);
        const name = nameMap.get(ally.id) || 'Ally';
        if (pos && ally.id !== aiCombatant.id) {
          entities.push(
            createCombatantEntity(
              { name, position: pos, hpCurrent: ally.hpCurrent, hpMax: ally.hpMax, faction: (ally.character || ally.monster || ally.npc)?.faction || undefined },
              allyChar.toString(),
              false,
              (aiCombatant.character || aiCombatant.monster || aiCombatant.npc)?.faction || 'Unknown',
            ),
          );
          allyChar = (allyChar % 9) + 1; // Wrap 1-9
        }
      }
      
      // Add enemies with letter characters
      let enemyChar = 'A'.charCodeAt(0);
      for (const enemy of enemies) {
        const pos = getPosition(enemy);
        const name = nameMap.get(enemy.id) || 'Enemy';
        if (pos) {
          entities.push(
            createCombatantEntity(
              { name, position: pos, hpCurrent: enemy.hpCurrent, hpMax: enemy.hpMax, faction: (enemy.character || enemy.monster || enemy.npc)?.faction || undefined },
              String.fromCharCode(enemyChar),
              false,
              (aiCombatant.character || aiCombatant.monster || aiCombatant.npc)?.faction || 'Unknown',
            ),
          );
          enemyChar = enemyChar === 'Z'.charCodeAt(0) ? 'A'.charCodeAt(0) : enemyChar + 1; // Wrap A-Z
        }
      }
      
      const rendered = renderBattlefield(map, entities);
      battlefield = {
        grid: rendered.grid,
        legend: rendered.legend,
        size: { width: map.width, height: map.height },
      };
    }

    return {
      // Entity identity and personality
      combatant: entityInfo,

      // Combat state
      combat: {
        round: encounter.round,
        turn: encounter.turn,
        totalCombatants: allCombatants.length,
      },

      // Allies (same faction)
      allies: allyDetails,

      // Enemies (different faction)
      enemies: enemyDetails,

      // Battlefield visualization (if map present)
      ...(battlefield ? { battlefield } : {}),

      // Recent narrative from previous turns
      recentNarrative,

      // Previous actions this turn
      actionHistory,

      // Structured per-step results from this turn (preferred for follow-up decisions)
      turnResults,
      lastActionResult: turnResults.length > 0 ? turnResults[turnResults.length - 1] : null,
    };
  }



  /**
   * Execute the action decided by the AI
   */
  private async executeMonsterAction(
    sessionId: string,
    encounterId: string,
    entityData: any,
    aiCombatant: CombatantStateRecord,
    decision: AiDecision,
    allCombatants: CombatantStateRecord[],
  ): Promise<Omit<TurnStepResult, 'step'>> {
    try {
      const normalizeName = (name: string): string =>
        name
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

      const findCombatantByName = async (desiredName: string): Promise<CombatantStateRecord | null> => {
        const nameMap = await this.combatantResolver.getNames(allCombatants);
        const desired = normalizeName(desiredName);
        if (!desired) return null;

        const named = allCombatants
          .map((c) => ({ combatant: c, name: nameMap.get(c.id) }))
          .filter((x): x is { combatant: CombatantStateRecord; name: string } => typeof x.name === 'string');

        const exact = named.find((x) => normalizeName(x.name) === desired);
        if (exact) return exact.combatant;

        const partial = named.filter((x) => {
          const n = normalizeName(x.name);
          return n.includes(desired) || desired.includes(n);
        });
        if (partial.length === 1) return partial[0]!.combatant;

        return null;
      };

      const buildActorRef = (): any => {
        if (aiCombatant.combatantType === 'Monster' && aiCombatant.monsterId) {
          return { type: 'Monster', monsterId: aiCombatant.monsterId };
        }
        if (aiCombatant.combatantType === 'NPC' && aiCombatant.npcId) {
          return { type: 'NPC', npcId: aiCombatant.npcId };
        }
        if (aiCombatant.combatantType === 'Character' && aiCombatant.characterId) {
          return { type: 'Character', characterId: aiCombatant.characterId };
        }
        return null;
      };

      const toCombatantRef = (c: CombatantStateRecord): any | null => {
        if (c.combatantType === 'Character' && c.characterId) return { type: 'Character', characterId: c.characterId };
        if (c.combatantType === 'Monster' && c.monsterId) return { type: 'Monster', monsterId: c.monsterId };
        if (c.combatantType === 'NPC' && c.npcId) return { type: 'NPC', npcId: c.npcId };
        return null;
      };

      if (decision.action === 'attack') {
        if (!decision.target || !decision.attackName) {
          return {
            action: decision.action,
            ok: false,
            summary: 'Failed: Attack requires target and attackName',
            data: { reason: 'missing_parameters' },
          };
        }

        const attackerRef = buildActorRef();
        if (!attackerRef) {
          return {
            action: decision.action,
            ok: false,
            summary: 'Failed: Invalid combatant reference',
            data: { reason: 'invalid_combatant_reference' },
          };
        }

        const targetCombatant = await findCombatantByName(decision.target);
        if (!targetCombatant) {
          return {
            action: decision.action,
            ok: false,
            summary: `Failed: Target ${decision.target} not found`,
            data: { reason: 'target_not_found', target: decision.target },
          };
        }

        const targetRef = toCombatantRef(targetCombatant);
        if (!targetRef) {
          return {
            action: decision.action,
            ok: false,
            summary: 'Failed: Invalid target reference',
            data: { reason: 'invalid_target_reference' },
          };
        }

        const result = await this.actionService.attack(sessionId, {
          encounterId,
          attacker: attackerRef,
          target: targetRef,
          monsterAttackName: decision.attackName,
        });

        const hit = Boolean((result.result as any).hit);
        const damage = hit ? ((result.result as any).damage?.applied || 0) : 0;

        // Process bonus action if included
        const bonusResult = await this.executeBonusAction(sessionId, encounterId, aiCombatant, decision, attackerRef);

        const mainSummary = hit
          ? `Attack hit ${decision.target} for ${damage} damage`
          : `Attack missed ${decision.target}`;
        const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;

        return {
          action: decision.action,
          ok: true,
          summary: fullSummary,
          data: {
            hit,
            damage,
            target: decision.target,
            attackName: decision.attackName,
            ...(bonusResult ? { bonusAction: bonusResult } : {}),
          },
        };
      }

      if (decision.action === 'move') {
        if (!decision.destination) {
          return {
            action: decision.action,
            ok: false,
            summary: 'Failed: Move requires destination',
            data: { reason: 'missing_destination' },
          };
        }

        const actorRef = buildActorRef();
        if (!actorRef) {
          return {
            action: decision.action,
            ok: false,
            summary: 'Failed: Invalid combatant reference',
            data: { reason: 'invalid_combatant_reference' },
          };
        }

        const result = await this.actionService.move(sessionId, {
          encounterId,
          actor: actorRef,
          destination: decision.destination,
        });

        const movedFeet = result.result.movedFeet;
        const oaOpportunities = result.opportunityAttacks; // Who *could* attack

        // AI decision: Should each opponent use their reaction for OA?
        // This gives AI tactical control over reactions instead of auto-executing
        const aiDecisions: Array<{ attackerId: string; used: boolean; reason: string }> = [];
        
        for (const opp of oaOpportunities) {
          if (!opp.canAttack) {
            aiDecisions.push({ attackerId: opp.attackerId, used: false, reason: 'cannot_attack' });
            continue;
          }
          
          // Get the attacker's state for tactical decision
          const attackerState = allCombatants.find((c: CombatantStateRecord) => c.id === opp.attackerId);
          if (!attackerState) continue;
          
          // AI decides whether to use reaction
          const targetRef = actorRef;
          const shouldUseReaction = await this.aiDecideReaction(attackerState, 'opportunity_attack', {
            targetName: await this.combatantResolver.getName(targetRef, aiCombatant),
            hpPercent: attackerState.hpCurrent / attackerState.hpMax,
          });
          
          aiDecisions.push({
            attackerId: opp.attackerId,
            used: shouldUseReaction,
            reason: shouldUseReaction ? 'ai_used' : 'ai_declined'
          });
        }

        // Process bonus action if included
        const bonusResult = await this.executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);

        const usedCount = aiDecisions.filter(d => d.used).length;
        const oaSummary = oaOpportunities.length > 0 
          ? `, triggered ${usedCount}/${oaOpportunities.length} opportunity attack(s)`
          : '';
        const mainSummary = `Moved ${movedFeet}ft to (${decision.destination.x}, ${decision.destination.y})${oaSummary}`;
        const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;

        return {
          action: decision.action,
          ok: true,
          summary: fullSummary,
          data: {
            movedFeet,
            destination: decision.destination,
            opportunityAttacks: result.result.opportunityAttacks, // Keep executed attacks from ActionService
            aiReactionDecisions: aiDecisions, // Add AI decision tracking
            ...(bonusResult ? { bonusAction: bonusResult } : {}),
          },
        };
      }

      if (decision.action === 'disengage' || decision.action === 'dash' || decision.action === 'dodge') {
        const actorRef = buildActorRef();
        if (!actorRef) {
          return {
            action: decision.action,
            ok: false,
            summary: 'Failed: Invalid combatant reference',
            data: { reason: 'invalid_combatant_reference' },
          };
        }

        let mainSummary = '';
        if (decision.action === 'disengage') {
          await this.actionService.disengage(sessionId, { encounterId, actor: actorRef });
          mainSummary = 'Disengaged (no opportunity attacks while moving this turn)';
        } else if (decision.action === 'dash') {
          await this.actionService.dash(sessionId, { encounterId, actor: actorRef });
          mainSummary = 'Dashed (movement speed doubled for this turn)';
        } else {
          await this.actionService.dodge(sessionId, { encounterId, actor: actorRef });
          mainSummary = 'Dodged (enemies have disadvantage on attacks until next turn)';
        }

        // Process bonus action if included
        const bonusResult = await this.executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);
        const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;

        return {
          action: decision.action,
          ok: true,
          summary: fullSummary,
          data: bonusResult ? { bonusAction: bonusResult } : undefined,
        };
      }

      if (decision.action === 'help') {
        const actorRef = buildActorRef();
        if (!actorRef) {
          return {
            action: decision.action,
            ok: false,
            summary: 'Failed: Invalid combatant reference',
            data: { reason: 'invalid_combatant_reference' },
          };
        }
        if (!decision.target) {
          return {
            action: decision.action,
            ok: false,
            summary: 'Failed: Help requires a target',
            data: { reason: 'missing_target' },
          };
        }

        const targetCombatant = await findCombatantByName(decision.target);
        if (!targetCombatant) {
          return {
            action: decision.action,
            ok: false,
            summary: `Failed: Target ${decision.target} not found`,
            data: { reason: 'target_not_found', target: decision.target },
          };
        }

        const targetRef = toCombatantRef(targetCombatant);
        if (!targetRef) {
          return {
            action: decision.action,
            ok: false,
            summary: 'Failed: Invalid target reference',
            data: { reason: 'invalid_target_reference' },
          };
        }

        await this.actionService.help(sessionId, { encounterId, actor: actorRef, target: targetRef });

        // Process bonus action if included
        const bonusResult = await this.executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);
        const mainSummary = `Helped ${decision.target} (next check/attack gains advantage, depending on context)`;
        const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;

        return {
          action: decision.action,
          ok: true,
          summary: fullSummary,
          data: { target: decision.target, ...(bonusResult ? { bonusAction: bonusResult } : {}) },
        };
      }

      if (decision.action === 'castSpell') {
        const actorRef = buildActorRef();
        if (!actorRef) {
          return {
            action: decision.action,
            ok: false,
            summary: 'Failed: Invalid combatant reference',
            data: { reason: 'invalid_combatant_reference' },
          };
        }

        const spellNameRaw = (decision as any).spellName;
        const spellName = typeof spellNameRaw === 'string' ? spellNameRaw.trim() : '';
        if (spellName.length === 0) {
          return {
            action: decision.action,
            ok: false,
            summary: 'Failed: castSpell requires spellName',
            data: { reason: 'missing_spell_name' },
          };
        }

        await this.actionService.castSpell(sessionId, { encounterId, actor: actorRef, spellName });

        // Process bonus action if included
        const bonusResult = await this.executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);
        const mainSummary = `Cast spell: ${spellName}`;
        const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;

        return {
          action: decision.action,
          ok: true,
          summary: fullSummary,
          data: { spellName, ...(bonusResult ? { bonusAction: bonusResult } : {}) },
        };
      }

      if (decision.action === 'shove') {
        if (!decision.target) {
          return {
            action: decision.action,
            ok: false,
            summary: 'Failed: Shove requires target',
            data: { reason: 'missing_target' },
          };
        }

        const actorRef = buildActorRef();
        if (!actorRef) {
          return {
            action: decision.action,
            ok: false,
            summary: 'Failed: Invalid combatant reference',
            data: { reason: 'invalid_combatant_reference' },
          };
        }

        const targetCombatant = await findCombatantByName(decision.target);
        if (!targetCombatant) {
          return {
            action: decision.action,
            ok: false,
            summary: `Failed: Target ${decision.target} not found`,
            data: { reason: 'target_not_found', target: decision.target },
          };
        }

        const targetRef = toCombatantRef(targetCombatant);
        if (!targetRef) {
          return {
            action: decision.action,
            ok: false,
            summary: 'Failed: Invalid target reference',
            data: { reason: 'invalid_target_reference' },
          };
        }

        const seed = typeof (decision as any).seed === 'number' ? (decision as any).seed : undefined;
        const result = await this.actionService.shove(sessionId, {
          encounterId,
          actor: actorRef,
          target: targetRef,
          shoveType: 'push',
          ...(seed !== undefined ? { seed } : {}),
        } as any);

        const data: Record<string, unknown> = {
          target: decision.target,
          success: result.result.success,
          attackerRoll: result.result.attackerRoll,
          targetRoll: result.result.targetRoll,
          ...(result.result.pushedTo ? { pushedTo: result.result.pushedTo } : {}),
          ...(seed !== undefined ? { seed } : {}),
        };

        // Process bonus action if included
        const bonusResult = await this.executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);
        if (bonusResult) {
          data.bonusAction = bonusResult;
        }

        if (result.result.success) {
          const mainSummary = result.result.pushedTo
            ? `Shove succeeded: pushed ${decision.target} to (${result.result.pushedTo.x}, ${result.result.pushedTo.y})`
            : `Shove succeeded against ${decision.target}`;
          const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;
          return { action: decision.action, ok: true, summary: fullSummary, data };
        }

        const mainSummary = `Shove failed against ${decision.target} (attacker ${result.result.attackerRoll} vs target ${result.result.targetRoll})`;
        const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;
        return {
          action: decision.action,
          ok: true,
          summary: fullSummary,
          data,
        };
      }

      if (decision.action === 'endTurn') {
        // Process bonus action even if ending turn (e.g., Nimble Escape without main action)
        const bonusResult = await this.executeBonusAction(
          sessionId,
          encounterId,
          aiCombatant,
          decision,
          buildActorRef(),
        );
        const summary = bonusResult ? `Ended turn (bonus action: ${bonusResult.summary})` : 'Ended turn';
        return { action: decision.action, ok: true, summary, data: bonusResult ? { bonusAction: bonusResult } : undefined };
      }

      return {
        action: decision.action,
        ok: false,
        summary: `Action ${decision.action} not yet implemented`,
        data: { reason: 'not_implemented' },
      };
    } catch (error: any) {
      return {
        action: decision.action,
        ok: false,
        summary: `Error executing ${decision.action}: ${error.message}`,
        data: { reason: 'exception', message: error?.message },
      };
    }
  }

  /**
   * Execute bonus action using the ability registry.
   * Falls back to legacy string matching for backward compatibility.
   * Returns summary of bonus action result, or null if none.
   */
  private async executeBonusAction(
    sessionId: string,
    encounterId: string,
    aiCombatant: CombatantStateRecord,
    decision: AiDecision,
    actorRef: any,
  ): Promise<{ action: string; summary: string } | null> {
    if (!decision.bonusAction || typeof decision.bonusAction !== 'string') {
      return null;
    }

    if (!actorRef) {
      this.aiLog('[MonsterAI] Cannot execute bonus action: invalid actor ref');
      return null;
    }

    const bonusActionId = decision.bonusAction.trim();

    // Try registry first
    if (this.abilityRegistry.hasExecutor(bonusActionId)) {
      try {
        const result = await this.abilityRegistry.execute({
          sessionId,
          encounterId,
          actor: {} as any, // Not used by current executors
          combat: {} as any, // Not used by current executors
          abilityId: bonusActionId,
          params: {
            actor: actorRef, // Pass actor ref for service calls
          },
          services: {
            disengage: async (params: any) => this.actionService.disengage(sessionId, params),
            dash: async (params: any) => this.actionService.dash(sessionId, params),
            dodge: async (params: any) => this.actionService.dodge(sessionId, params),
            hide: async (params: any) => {
              // Hide not implemented yet
              throw new Error('Hide action not yet implemented');
            },
            attack: async (params: any) => this.actionService.attack(sessionId, params),
          },
        });

        return {
          action: bonusActionId,
          summary: result.summary,
        };
      } catch (error: any) {
        this.aiLog(`[MonsterAI] Registry execution failed: ${error.message}`);
        // Fall through to legacy handling
      }
    }

    // Legacy string matching for backward compatibility
    const bonus = bonusActionId.toLowerCase();

    try {
      // Nimble Escape: Disengage as bonus action
      if (bonus === 'nimble_escape_disengage' || bonus === 'disengage') {
        await this.actionService.disengage(sessionId, { encounterId, actor: actorRef });
        return { action: 'disengage', summary: 'Disengaged (bonus action)' };
      }

      // Nimble Escape: Hide as bonus action
      if (bonus === 'nimble_escape_hide' || bonus === 'hide') {
        // TODO: Implement hide action in action service
        this.aiLog('[MonsterAI] Hide action not yet implemented in action service');
        return { action: 'hide', summary: 'Attempted to hide (bonus action, not fully implemented)' };
      }

      // Cunning Action (Rogue): Dash as bonus action
      if (bonus === 'cunning_action_dash') {
        await this.actionService.dash(sessionId, { encounterId, actor: actorRef });
        return { action: 'dash', summary: 'Dashed (bonus action)' };
      }

      // Cunning Action (Rogue): Disengage as bonus action
      if (bonus === 'cunning_action_disengage') {
        await this.actionService.disengage(sessionId, { encounterId, actor: actorRef });
        return { action: 'disengage', summary: 'Disengaged (bonus action)' };
      }

      // Cunning Action (Rogue): Hide as bonus action
      if (bonus === 'cunning_action_hide') {
        // TODO: Implement hide action in action service
        this.aiLog('[MonsterAI] Hide action not yet implemented in action service');
        return { action: 'hide', summary: 'Attempted to hide (bonus action, not fully implemented)' };
      }

      // Off-hand attack (two-weapon fighting)
      if (bonus === 'offhand_attack') {
        this.aiLog('[MonsterAI] Off-hand attack bonus action not yet implemented');
        return { action: 'offhand_attack', summary: 'Off-hand attack (not implemented)' };
      }

      // Flurry of Blows (Monk)
      if (bonus === 'flurry_of_blows') {
        this.aiLog('[MonsterAI] Flurry of Blows bonus action not yet implemented');
        return { action: 'flurry_of_blows', summary: 'Flurry of Blows (not implemented)' };
      }

      // Unknown bonus action
      this.aiLog(`[MonsterAI] Unknown bonus action: ${decision.bonusAction}`);
      return { action: bonus, summary: `Bonus action ${decision.bonusAction} not implemented` };
    } catch (error: any) {
      this.aiLog(`[MonsterAI] Bonus action failed: ${error.message}`);
      return { action: bonus, summary: `Bonus action failed: ${error.message}` };
    }
  }

  /**
   * Fallback behavior when LLM is not available
   */
  private async fallbackSimpleTurn(
    sessionId: string,
    encounter: CombatEncounterRecord,
    monster: any,
    allCombatants: CombatantStateRecord[],
  ): Promise<void> {
    const alivePlayerCombatants = allCombatants.filter(
      (c) => c.combatantType === 'Character' && c.hpCurrent > 0,
    );

    if (alivePlayerCombatants.length === 0) {
      await this.combatService.nextTurn(sessionId, { encounterId: encounter.id });
      return;
    }

    const target = alivePlayerCombatants[0];
    const statBlock = monster.statBlock as any;
    const attacks = statBlock.attacks || [];

    if (attacks.length === 0) {
      await this.combatService.nextTurn(sessionId, { encounterId: encounter.id });
      return;
    }

    try {
      const result = await this.actionService.attack(sessionId, {
        encounterId: encounter.id,
        attacker: { type: 'Monster', monsterId: monster.id },
        target: { type: 'Character', characterId: target.characterId! },
        monsterAttackName: attacks[0].name,
      });

      if (this.events) {
        const hitOrMiss = (result.result as any).hit ? 'hit' : 'missed';
        const damage = (result.result as any).hit ? (result.result as any).damage?.applied || 0 : 0;

        await this.events.append(sessionId, {
          id: nanoid(),
          type: 'NarrativeText',
          payload: {
            encounterId: encounter.id,
            actor: { type: 'Monster', monsterId: monster.id },
            text:
              damage > 0
                ? `${monster.name} attacks and ${hitOrMiss} for ${damage} damage!`
                : `${monster.name} attacks but ${hitOrMiss}!`,
          },
        });
      }
    } catch (error) {
      console.error(`Monster turn failed for ${monster.name}:`, error);
    }
  }

  /**
   * Process all consecutive monster turns until a player turn is reached
   */
  async processAllMonsterTurns(sessionId: string, encounterId: string): Promise<void> {
    let processed = true;
    while (processed) {
      processed = await this.processMonsterTurnIfNeeded(sessionId, encounterId);
    }
  }
}

/**
 * Combat context structure used by AI decision maker
 */
interface CombatContext {
  combatant: {
    name: string;
    type?: string;
    alignment?: string;
    cr?: number;
    class?: string;
    level?: number;
    hp: {
      current: number;
      max: number;
      percentage: number;
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
    initiative: number | null;
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
    ac?: number;
    initiative: number | null;
  }>;
  actionHistory: string[];
}
