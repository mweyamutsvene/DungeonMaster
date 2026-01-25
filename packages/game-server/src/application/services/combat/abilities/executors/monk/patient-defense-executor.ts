/**
 * Patient Defense Executor
 * 
 * Handles the Monk's "Patient Defense" class feature (level 2+).
 * Spend 1 ki point to take the Dodge action as a bonus action.
 */

import type { AbilityExecutor, AbilityExecutionContext, AbilityExecutionResult } from "../../../../../../domain/abilities/ability-executor.js";

/**
 * Executor for Patient Defense (Monk class feature).
 * 
 * Handles:
 * - class:monk:patient-defense
 * - Backward compat: patient_defense
 * 
 * Prerequisites:
 * - Must have at least 1 ki point available
 * - Spends 1 ki point
 * - Takes the Dodge action
 */
export class PatientDefenseExecutor implements AbilityExecutor {
  canExecute(abilityId: string): boolean {
    const normalized = abilityId.toLowerCase().replace(/[^a-z0-9]+/g, '');
    return (
      normalized === 'classmonkpatientdefense' ||
      normalized === 'patientdefense'
    );
  }

  async execute(context: AbilityExecutionContext): Promise<AbilityExecutionResult> {
    const { services, params } = context;

    // Get actor ref from params (passed by AiTurnOrchestrator)
    const actorRef = params?.actor;
    if (!actorRef) {
      return {
        success: false,
        summary: 'No actor reference in params',
        error: 'MISSING_ACTOR',
      };
    }

    // Check if dodge service is available
    if (!services.dodge) {
      return {
        success: false,
        summary: 'Dodge service not available',
        error: 'MISSING_SERVICE',
      };
    }

    // Validate ki points - passed via params.resources
    const resources = params?.resources;
    if (!resources) {
      return {
        success: false,
        summary: 'No resources provided for ki validation',
        error: 'MISSING_RESOURCES',
      };
    }

    try {
      // Import resource utils dynamically to avoid circular deps
      const { hasResourceAvailable } = await import('../../../helpers/resource-utils.js');
      
      // Check ki availability
      if (!hasResourceAvailable(resources, 'ki', 1)) {
        return {
          success: false,
          summary: 'Insufficient ki points for Patient Defense (requires 1 ki)',
          error: 'INSUFFICIENT_KI',
        };
      }
    } catch (error: any) {
      // If validation fails, return error
      return {
        success: false,
        summary: `Ki validation failed: ${error.message}`,
        error: 'VALIDATION_ERROR',
      };
    }

    try {
      // Execute dodge action
      await services.dodge({
        encounterId: context.encounterId,
        actor: actorRef,
      });

      return {
        success: true,
        summary: 'Dodged (bonus action via Patient Defense, spent 1 ki)',
        resourcesSpent: { kiPoints: 1 },
        data: {
          abilityName: 'Patient Defense',
          kiSpent: 1,
          spendResource: { poolName: 'ki', amount: 1 },
        },
      };
    } catch (error: any) {
      return {
        success: false,
        summary: `Patient Defense failed: ${error.message}`,
        error: error.message,
      };
    }
  }
}
