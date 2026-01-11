/**
 * Application: Ability Registry
 * 
 * Central registry for ability executors. Maps ability IDs to execution handlers.
 * Supports dynamic registration and lookup.
 */

import type { AbilityExecutor, AbilityExecutionContext, AbilityExecutionResult } from "../../../../domain/abilities/ability-executor.js";

/**
 * Registry for ability executors.
 * 
 * Allows registration of executors that handle specific ability IDs or patterns.
 * Provides centralized lookup and execution.
 */
export class AbilityRegistry {
  private executors: AbilityExecutor[] = [];

  /**
   * Register an ability executor.
   * 
   * @param executor - Executor to register
   */
  register(executor: AbilityExecutor): void {
    this.executors.push(executor);
  }

  /**
   * Find an executor for the given ability ID.
   * 
   * @param abilityId - Ability ID to look up
   * @returns Executor if found, undefined otherwise
   */
  findExecutor(abilityId: string): AbilityExecutor | undefined {
    return this.executors.find(executor => executor.canExecute(abilityId));
  }

  /**
   * Execute an ability.
   * 
   * @param context - Execution context
   * @returns Execution result
   * @throws Error if no executor found for ability ID
   */
  async execute(context: AbilityExecutionContext): Promise<AbilityExecutionResult> {
    const executor = this.findExecutor(context.abilityId);
    
    if (!executor) {
      return {
        success: false,
        summary: `No executor found for ability: ${context.abilityId}`,
        error: `UNREGISTERED_ABILITY`,
        data: { abilityId: context.abilityId },
      };
    }

    try {
      return await executor.execute(context);
    } catch (error: any) {
      return {
        success: false,
        summary: `Ability execution failed: ${error.message}`,
        error: error.message,
        data: { abilityId: context.abilityId },
      };
    }
  }

  /**
   * Check if an executor is registered for the given ability ID.
   * 
   * @param abilityId - Ability ID to check
   * @returns True if executor exists
   */
  hasExecutor(abilityId: string): boolean {
    return this.findExecutor(abilityId) !== undefined;
  }

  /**
   * Get all registered executors (for testing/debugging).
   */
  getExecutors(): ReadonlyArray<AbilityExecutor> {
    return this.executors;
  }

  /**
   * Clear all registered executors (for testing).
   */
  clear(): void {
    this.executors = [];
  }
}

/**
 * Global ability registry instance.
 * This can be injected into services or used as a singleton.
 */
export const globalAbilityRegistry = new AbilityRegistry();
