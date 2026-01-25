import type { AbilityExecutor, AbilityExecutionContext, AbilityExecutionResult } from "../../../../../../domain/abilities/ability-executor.js";
import { makeSavingThrow, calculateSaveDC } from "../../../../../../domain/rules/saving-throws.js";
import { Character } from "../../../../../../domain/entities/creatures/character.js";

/**
 * Open Hand Technique (Monk Level 3 - Open Hand Subclass)
 * 
 * When you use Flurry of Blows, choose one of the following for each target:
 * - Addle: Target has Disadvantage on next attack roll before start of your next turn
 * - Push: Target must succeed on Strength save (DC 8 + Proficiency + Wisdom) or be pushed 15 feet
 * - Topple: Target must succeed on Dexterity save (DC 8 + Proficiency + Wisdom) or have Prone condition
 */
export class OpenHandTechniqueExecutor implements AbilityExecutor {
  canExecute(abilityId: string): boolean {
    const normalized = abilityId.toLowerCase().replace(/[^a-z0-9]+/g, '');
    return (
      normalized === 'openhandtechnique' ||
      normalized === 'classmonkopenhandtechnique'
    );
  }

  async execute(context: AbilityExecutionContext): Promise<AbilityExecutionResult> {
    const { actor, params } = context;

    const actorRef = params?.actor;
    if (!actorRef) {
      return {
        success: false,
        summary: 'No actor reference in params',
        error: 'MISSING_ACTOR',
      };
    }

    // Validate level requirement (Monk level 3+ with Open Hand subclass)
    const level = (actorRef as any).level || 1;
    if (level < 3) {
      return {
        success: false,
        summary: 'Open Hand Technique requires Monk level 3',
        error: 'LEVEL_TOO_LOW',
      };
    }

    // Validate Open Hand subclass
    if (actorRef instanceof Character) {
      const subclass = actorRef.getSubclass();
      if (subclass !== 'Open Hand') {
        return {
          success: false,
          summary: 'Open Hand Technique requires Open Hand subclass',
          error: 'INVALID_SUBCLASS',
        };
      }
    }

    const targetRef = params?.target;
    if (!targetRef) {
      return {
        success: false,
        summary: 'No target specified for Open Hand Technique',
        error: 'MISSING_TARGET',
      };
    }

    // Get technique choice from params (addle, push, or topple)
    const technique = (params?.technique as string)?.toLowerCase() || 'addle';
    
    // Calculate save DC: 8 + proficiency bonus + Wisdom modifier
    const monkLevel = (actorRef as any).level || 3;
    const wisdomScore = (actorRef as any).abilityScores?.wisdom || 10;
    const saveDC = calculateSaveDC(monkLevel, wisdomScore);

    switch (technique) {
      case 'addle': {
        // Apply disadvantage on next attack (no save)
        const combat = context.combat;
        if (!combat) {
          return {
            success: false,
            summary: 'Combat context required for Open Hand Technique (Addle)',
            error: 'MISSING_COMBAT_CONTEXT',
          };
        }

        // Add disadvantage effect to target
        const targetId = typeof targetRef === 'object' && targetRef && 'getId' in targetRef && typeof (targetRef as any).getId === 'function' 
          ? (targetRef as any).getId() 
          : String(targetRef);
        
        // Get current combat round and turn for effect tracking
        const currentRound = combat.getRound ? combat.getRound() : 1;
        const currentTurnIndex = combat.getTurnIndex ? combat.getTurnIndex() : 0;
        
        combat.addEffect(targetId, {
          id: `addle_${Date.now()}`,
          type: 'disadvantage',
          target: 'next_attack',
          duration: 'until_start_of_next_turn',
          source: `${actor.getName()} (Open Hand Technique)`,
          description: 'Disadvantage on next attack roll',
          appliedAtRound: currentRound,
          appliedAtTurnIndex: currentTurnIndex,
        });

        return {
          success: true,
          summary: `${actor.getName()} uses Open Hand Technique (Addle)! Target has disadvantage on next attack.`,
          data: {
            abilityName: 'Open Hand Technique',
            technique: 'Addle',
            effect: 'disadvantage_on_next_attack',
            duration: 'until_start_of_actors_next_turn',
          },
        };
      }

      case 'push': {
        // Strength save or pushed 15 feet
        const combat = context.combat;
        if (!combat) {
          return {
            success: false,
            summary: 'Combat context required for Open Hand Technique (Push)',
            error: 'MISSING_COMBAT_CONTEXT',
          };
        }

        const saveResult = makeSavingThrow({
          creature: {
            abilityScores: (targetRef as any).abilityScores || {},
            level: (targetRef as any).level || 1,
          },
          dc: saveDC,
          ability: 'strength',
        });

        if (saveResult.success) {
          return {
            success: true,
            summary: `${actor.getName()} uses Open Hand Technique (Push), but target saves!`,
            data: {
              abilityName: 'Open Hand Technique',
              technique: 'Push',
              saved: true,
              saveRoll: saveResult.roll,
              saveTotal: saveResult.total,
              saveDC,
            },
          };
        }

        // Apply forced movement (push 15 feet away from actor)
        const targetId = typeof targetRef === 'object' && targetRef && 'getId' in targetRef && typeof (targetRef as any).getId === 'function' 
          ? (targetRef as any).getId() 
          : String(targetRef);
        const actorPos = combat.getPosition(actor.getId()) || { x: 0, y: 0 };
        const targetPos = combat.getPosition(targetId) || { x: 5, y: 0 };

        // Calculate direction vector (simple grid-based push)
        const dx = targetPos.x - actorPos.x;
        const dy = targetPos.y - actorPos.y;
        const distance = Math.sqrt(dx * dx + dy * dy) || 1;
        
        // Push 15 feet in the direction away from actor
        const newX = targetPos.x + (dx / distance) * 15;
        const newY = targetPos.y + (dy / distance) * 15;
        
        combat.setPosition(targetId, { x: newX, y: newY, elevation: targetPos.elevation });

        return {
          success: true,
          summary: `${actor.getName()} uses Open Hand Technique (Push)! Target is pushed 15 feet.`,
          data: {
            abilityName: 'Open Hand Technique',
            technique: 'Push',
            saved: false,
            effect: 'pushed_15_feet',
            forcedMovement: {
              direction: 'away',
              distance: 15,
              from: actorPos,
              to: { x: newX, y: newY, elevation: targetPos.elevation },
            },
            saveRoll: saveResult.roll,
            saveTotal: saveResult.total,
            saveDC,
          },
        };
      }

      case 'topple': {
        // Topple: Target makes Dexterity save or is knocked prone
        const saveResult = makeSavingThrow({
          creature: {
            abilityScores: (targetRef as any).abilityScores || {},
            level: (targetRef as any).level || 1,
          },
          dc: saveDC,
          ability: 'dexterity',
        });

        if (saveResult.success) {
          return {
            success: true,
            summary: `${actor.getName()} uses Open Hand Technique (Topple), but target saves!`,
            data: {
              abilityName: 'Open Hand Technique',
              technique: 'Topple',
              saved: true,
              saveRoll: saveResult.roll,
              saveTotal: saveResult.total,
              saveDC,
            },
          };
        }

        // Apply Prone condition to target
        if (targetRef && typeof targetRef === 'object' && 'addCondition' in targetRef && typeof (targetRef as any).addCondition === 'function') {
          (targetRef as any).addCondition('Prone');
        }

        return {
          success: true,
          summary: `${actor.getName()} uses Open Hand Technique (Topple)! Target is knocked prone.`,
          data: {
            abilityName: 'Open Hand Technique',
            technique: 'Topple',
            saved: false,
            effect: 'prone',
            conditionApplied: 'Prone',
            saveRoll: saveResult.roll,
            saveTotal: saveResult.total,
            saveDC,
          },
        };
      }

      default: {
        return {
          success: false,
          summary: `Unknown Open Hand Technique: ${technique}`,
          error: 'INVALID_TECHNIQUE',
        };
      }
    }
  }
}
