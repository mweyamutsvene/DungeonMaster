/**
 * AiContextBuilder - Constructs combat context payloads for AI decision making.
 *
 * Layer: Application
 * Responsibility: Build rich context including battlefield, allies, enemies, and state.
 */

import type { CombatantStateRecord, CombatEncounterRecord } from "../../../types.js";
import type { ICharacterRepository, IMonsterRepository, INPCRepository } from "../../../repositories/index.js";
import type { FactionService } from "../helpers/faction-service.js";
import type { ICombatantResolver } from "../helpers/combatant-resolver.js";
import type { CombatMap } from "../../../../domain/rules/combat-map.js";
import { renderBattlefield, createCombatantEntity } from "../../../../domain/rules/battlefield-renderer.js";
import { listCreatureAbilities } from "../../../../domain/abilities/creature-abilities.js";
import type { TurnStepResult, AiCombatContext } from "./ai-types.js";

export class AiContextBuilder {
  constructor(
    private readonly characters: ICharacterRepository,
    private readonly monsters: IMonsterRepository,
    private readonly npcs: INPCRepository,
    private readonly factionService: FactionService,
    private readonly combatantResolver: ICombatantResolver,
  ) {}

  /**
   * Extract position from combatant resources.
   */
  private getPosition(c: CombatantStateRecord): { x: number; y: number } | undefined {
    const resources = c.resources as Record<string, unknown> | null;
    return resources?.position as { x: number; y: number } | undefined;
  }

  /**
   * Extract action economy from combatant resources.
   */
  private getEconomy(c: CombatantStateRecord): {
    actionSpent: boolean;
    bonusActionSpent: boolean;
    reactionSpent: boolean;
    movementRemaining?: number;
  } | undefined {
    const resources = c.resources as Record<string, unknown> | null;
    if (!resources || typeof resources !== "object") return undefined;

    const movementRemaining =
      typeof resources.movementRemaining === "number" ? resources.movementRemaining : undefined;

    return {
      actionSpent: resources.actionSpent === true,
      bonusActionSpent: resources.bonusActionSpent === true,
      reactionSpent: resources.reactionSpent === true,
      ...(movementRemaining !== undefined ? { movementRemaining } : {}),
    };
  }

  /**
   * Build ally details for context.
   */
  private buildAllyDetails(
    allies: CombatantStateRecord[],
    nameMap: Map<string, string>,
  ): AiCombatContext["allies"] {
    return allies.map((a) => {
      const position = this.getPosition(a);
      return {
        name: nameMap.get(a.id) || "Ally",
        hp: {
          current: a.hpCurrent,
          max: a.hpMax,
          percentage: Math.round((a.hpCurrent / a.hpMax) * 100),
        },
        ...(position ? { position } : {}),
        initiative: a.initiative,
      };
    });
  }

  /**
   * Build enemy details for context (async - loads entity data).
   */
  private async buildEnemyDetails(
    enemies: CombatantStateRecord[],
    nameMap: Map<string, string>,
  ): Promise<AiCombatContext["enemies"]> {
    return Promise.all(
      enemies.map(async (e) => {
        const name = nameMap.get(e.id) || "Enemy";
        const position = this.getPosition(e);
        let className: string | undefined;
        let level: number | undefined;
        let armorClass: number | undefined;
        let knownAbilities: string[] = [];

        if (e.combatantType === "Character" && e.characterId) {
          const char = await this.characters.getById(e.characterId);
          if (char) {
            className = char.className || undefined;
            level = char.level;
            const sheet = char.sheet as Record<string, unknown>;
            armorClass = sheet?.armorClass as number | undefined;

            try {
              const abilities = listCreatureAbilities({ creature: char as unknown as Parameters<typeof listCreatureAbilities>[0]["creature"] });
              knownAbilities = abilities
                .filter((a) => a.economy === "bonus" || a.economy === "reaction" || (a.source !== "base" && a.economy === "action"))
                .map((a) => a.name);
            } catch {
              // Ignore errors in ability listing
            }
          }
        } else if (e.combatantType === "NPC" && e.npcId) {
          const npc = await this.npcs.getById(e.npcId);
          if (npc) {
            const statBlock = npc.statBlock as Record<string, unknown>;
            className = statBlock?.className as string | undefined;
            level = statBlock?.level as number | undefined;
            armorClass = statBlock?.armorClass as number | undefined;

            try {
              const abilities = listCreatureAbilities({ creature: npc as unknown as Parameters<typeof listCreatureAbilities>[0]["creature"], monsterStatBlock: statBlock });
              knownAbilities = abilities
                .filter((a) => a.economy === "bonus" || a.economy === "reaction" || (a.source !== "base" && a.economy === "action"))
                .map((a) => a.name);
            } catch {
              // Ignore errors
            }
          }
        } else if (e.combatantType === "Monster" && e.monsterId) {
          const monster = await this.monsters.getById(e.monsterId);
          if (monster) {
            const statBlock = monster.statBlock as Record<string, unknown>;
            armorClass = statBlock?.armorClass as number | undefined;

            try {
              const abilities = listCreatureAbilities({ creature: monster as unknown as Parameters<typeof listCreatureAbilities>[0]["creature"], monsterStatBlock: statBlock });
              knownAbilities = abilities
                .filter((a) => a.economy === "bonus" || a.economy === "reaction" || (a.source !== "base" && a.economy === "action"))
                .map((a) => a.name);
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
  }

  /**
   * Build entity info for the AI combatant itself.
   */
  private buildEntityInfo(
    entityData: Record<string, unknown>,
    aiCombatant: CombatantStateRecord,
  ): AiCombatContext["combatant"] {
    const aiPosition = this.getPosition(aiCombatant);
    const aiEconomy = this.getEconomy(aiCombatant);

    if (aiCombatant.combatantType === "Monster") {
      const statBlock = entityData.statBlock as Record<string, unknown>;
      return {
        name: entityData.name as string,
        type: statBlock.type as string | undefined,
        alignment: statBlock.alignment as string | undefined,
        cr: statBlock.cr as number | undefined,
        hp: {
          current: aiCombatant.hpCurrent,
          max: aiCombatant.hpMax,
          percentage: Math.round((aiCombatant.hpCurrent / aiCombatant.hpMax) * 100),
        },
        ...(aiPosition ? { position: aiPosition } : {}),
        ...(aiEconomy ? { economy: aiEconomy } : {}),
        traits: (statBlock.traits as unknown[]) || [],
        attacks: (statBlock.attacks as unknown[]) || [],
        actions: (statBlock.actions as unknown[]) || [],
        bonusActions: (statBlock.bonusActions as unknown[]) || [],
        reactions: (statBlock.reactions as unknown[]) || [],
      };
    } else if (aiCombatant.combatantType === "NPC") {
      const statBlock = entityData.statBlock as Record<string, unknown>;
      return {
        name: entityData.name as string,
        class: statBlock.className as string | undefined,
        level: statBlock.level as number | undefined,
        hp: {
          current: aiCombatant.hpCurrent,
          max: aiCombatant.hpMax,
          percentage: Math.round((aiCombatant.hpCurrent / aiCombatant.hpMax) * 100),
        },
        ...(aiPosition ? { position: aiPosition } : {}),
        ...(aiEconomy ? { economy: aiEconomy } : {}),
        spells: (statBlock.spells as unknown[]) || [],
        abilities: (statBlock.abilities as unknown[]) || [],
        actions: (statBlock.actions as unknown[]) || [],
      };
    } else {
      // AI-controlled Character
      const sheet = entityData.sheet as Record<string, unknown>;
      return {
        name: entityData.name as string,
        class: entityData.className as string | undefined,
        level: entityData.level as number | undefined,
        hp: {
          current: aiCombatant.hpCurrent,
          max: aiCombatant.hpMax,
          percentage: Math.round((aiCombatant.hpCurrent / aiCombatant.hpMax) * 100),
        },
        ...(aiPosition ? { position: aiPosition } : {}),
        ...(aiEconomy ? { economy: aiEconomy } : {}),
        spells: (sheet?.spells as unknown[]) || [],
        abilities: (sheet?.abilities as unknown[]) || [],
      };
    }
  }

  /**
   * Render battlefield visualization if map data is present.
   */
  private renderBattlefieldContext(
    encounter: CombatEncounterRecord,
    aiCombatant: CombatantStateRecord,
    entityInfo: AiCombatContext["combatant"],
    allies: CombatantStateRecord[],
    enemies: CombatantStateRecord[],
    nameMap: Map<string, string>,
  ): AiCombatContext["battlefield"] | undefined {
    if (!encounter.mapData) return undefined;

    const map = encounter.mapData as CombatMap;
    const aiPosition = this.getPosition(aiCombatant);
    const entities: Parameters<typeof renderBattlefield>[1] = [];

    // Add self
    if (aiPosition) {
      entities.push(
        createCombatantEntity(
          {
            name: entityInfo.name,
            position: aiPosition,
            hpCurrent: aiCombatant.hpCurrent,
            hpMax: aiCombatant.hpMax,
            faction: undefined,
          },
          "@",
          true,
          "Unknown",
        ),
      );
    }

    // Add allies with numeric characters
    let allyChar = 1;
    for (const ally of allies) {
      const pos = this.getPosition(ally);
      const name = nameMap.get(ally.id) || "Ally";
      if (pos && ally.id !== aiCombatant.id) {
        entities.push(
          createCombatantEntity(
            { name, position: pos, hpCurrent: ally.hpCurrent, hpMax: ally.hpMax, faction: undefined },
            allyChar.toString(),
            false,
            "Unknown",
          ),
        );
        allyChar = (allyChar % 9) + 1;
      }
    }

    // Add enemies with letter characters
    let enemyChar = "A".charCodeAt(0);
    for (const enemy of enemies) {
      const pos = this.getPosition(enemy);
      const name = nameMap.get(enemy.id) || "Enemy";
      if (pos) {
        entities.push(
          createCombatantEntity(
            { name, position: pos, hpCurrent: enemy.hpCurrent, hpMax: enemy.hpMax, faction: undefined },
            String.fromCharCode(enemyChar),
            false,
            "Unknown",
          ),
        );
        enemyChar = enemyChar === "Z".charCodeAt(0) ? "A".charCodeAt(0) : enemyChar + 1;
      }
    }

    const rendered = renderBattlefield(map, entities);
    return {
      grid: rendered.grid,
      legend: rendered.legend,
      size: { width: map.width, height: map.height },
    };
  }

  /**
   * Build complete combat context for AI decision maker.
   */
  async build(
    entityData: Record<string, unknown>,
    aiCombatant: CombatantStateRecord,
    allCombatants: CombatantStateRecord[],
    encounter: CombatEncounterRecord,
    recentNarrative: string[],
    actionHistory: string[],
    turnResults: TurnStepResult[],
  ): Promise<AiCombatContext> {
    // Determine allies and enemies using faction service
    const allies = await this.factionService.getAllies(allCombatants, aiCombatant);
    const enemies = await this.factionService.getEnemies(allCombatants, aiCombatant);

    // Batch-load all names for allies and enemies
    const allRelevant = [...allies, ...enemies];
    const nameMap = await this.combatantResolver.getNames(allRelevant);

    // Build component parts
    const entityInfo = this.buildEntityInfo(entityData, aiCombatant);
    const allyDetails = this.buildAllyDetails(allies, nameMap);
    const enemyDetails = await this.buildEnemyDetails(enemies, nameMap);
    const battlefield = this.renderBattlefieldContext(
      encounter,
      aiCombatant,
      entityInfo,
      allies,
      enemies,
      nameMap,
    );

    return {
      combatant: entityInfo,
      combat: {
        round: encounter.round,
        turn: encounter.turn,
        totalCombatants: allCombatants.length,
      },
      allies: allyDetails,
      enemies: enemyDetails,
      ...(battlefield ? { battlefield } : {}),
      recentNarrative,
      actionHistory,
      turnResults,
      lastActionResult: turnResults.length > 0 ? turnResults[turnResults.length - 1] : null,
    };
  }
}
