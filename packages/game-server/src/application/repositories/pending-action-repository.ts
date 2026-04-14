/**
 * Repository for managing pending actions awaiting reaction resolution.
 */

import type { PendingAction, PendingActionStatus, ReactionResponse, ReactionResult } from "../../domain/entities/combat/pending-action.js";

export interface PendingActionRepository {
  /**
   * Store a new pending action.
   */
  create(action: PendingAction): Promise<PendingAction>;
  
  /**
   * Retrieve a pending action by ID.
   */
  getById(actionId: string): Promise<PendingAction | null>;
  
  /**
   * List all pending actions for an encounter.
   */
  listByEncounter(encounterId: string): Promise<PendingAction[]>;
  
  /**
   * Add a reaction response to a pending action.
   */
  addReactionResponse(actionId: string, response: ReactionResponse): Promise<PendingAction>;
  
  /**
   * Get the status of a pending action.
   */
  getStatus(actionId: string): Promise<PendingActionStatus>;
  
  /**
   * Mark a pending action as completed.
   */
  markCompleted(actionId: string): Promise<void>;
  
  /**
   * Mark a pending action as cancelled.
   */
  markCancelled(actionId: string): Promise<void>;
  
  /**
   * Delete a pending action (after completion/cancellation).
   */
  delete(actionId: string): Promise<void>;
  
  /**
   * Update a pending action (for storing roll results).
   */
  update(action: PendingAction): Promise<PendingAction>;
  
  /**
   * Update the result of a specific reaction in a pending action.
   */
  updateReactionResult(actionId: string, opportunityId: string, result: ReactionResult): Promise<void>;
  
  /**
   * Clean up expired pending actions.
   */
  cleanupExpired(): Promise<void>;
}
