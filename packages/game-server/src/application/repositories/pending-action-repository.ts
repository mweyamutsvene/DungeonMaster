/**
 * Repository for managing pending actions awaiting reaction resolution.
 * 
 * In-memory implementation for now; could be moved to database if needed.
 */

import type { PendingAction, PendingActionStatus, ReactionResponse, ReactionOpportunity } from "../../domain/entities/combat/pending-action.js";

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
  updateReactionResult(actionId: string, opportunityId: string, result: any): Promise<void>;
  
  /**
   * Clean up expired pending actions.
   */
  cleanupExpired(): Promise<void>;
}

/**
 * In-memory implementation of PendingActionRepository.
 */
export class InMemoryPendingActionRepository implements PendingActionRepository {
  private actions = new Map<string, PendingAction>();
  private statuses = new Map<string, PendingActionStatus>();

  async create(action: PendingAction): Promise<PendingAction> {
    this.actions.set(action.id, action);
    this.statuses.set(action.id, "awaiting_reactions");
    return action;
  }

  async getById(actionId: string): Promise<PendingAction | null> {
    return this.actions.get(actionId) ?? null;
  }

  async listByEncounter(encounterId: string): Promise<PendingAction[]> {
    return Array.from(this.actions.values()).filter(a => a.encounterId === encounterId);
  }

  async addReactionResponse(actionId: string, response: ReactionResponse): Promise<PendingAction> {
    const action = this.actions.get(actionId);
    if (!action) {
      throw new Error(`Pending action not found: ${actionId}`);
    }

    action.resolvedReactions.push(response);

    // Check if all reactions are resolved
    const allResolved = action.reactionOpportunities.every((opp: ReactionOpportunity) => 
      action.resolvedReactions.some((r: ReactionResponse) => r.opportunityId === opp.id)
    );

    if (allResolved) {
      this.statuses.set(actionId, "ready_to_complete");
    }

    return action;
  }

  async getStatus(actionId: string): Promise<PendingActionStatus> {
    const status = this.statuses.get(actionId);
    if (!status) {
      throw new Error(`Pending action not found: ${actionId}`);
    }

    // Check if expired
    const action = this.actions.get(actionId);
    if (action && action.expiresAt < new Date()) {
      this.statuses.set(actionId, "expired");
      return "expired";
    }

    return status;
  }

  async markCompleted(actionId: string): Promise<void> {
    this.statuses.set(actionId, "completed");
  }

  async markCancelled(actionId: string): Promise<void> {
    this.statuses.set(actionId, "cancelled");
  }

  async delete(actionId: string): Promise<void> {
    this.actions.delete(actionId);
    this.statuses.delete(actionId);
  }

  async update(action: PendingAction): Promise<PendingAction> {
    this.actions.set(action.id, action);
    return action;
  }

  async updateReactionResult(actionId: string, opportunityId: string, result: any): Promise<void> {
    const action = this.actions.get(actionId);
    if (!action) {
      throw new Error(`Pending action not found: ${actionId}`);
    }

    const reaction = action.resolvedReactions.find((r: ReactionResponse) => r.opportunityId === opportunityId);
    if (reaction) {
      reaction.result = result;
    }
  }

  async cleanupExpired(): Promise<void> {
    const now = new Date();
    for (const [id, action] of this.actions.entries()) {
      if (action.expiresAt < now) {
        await this.delete(id);
      }
    }
  }
}
