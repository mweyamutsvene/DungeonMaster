import type { Creature } from "../entities/creatures/creature.js";
import {
  canSpendAction,
  canSpendBonusAction,
  canSpendMovement,
  canSpendReaction,
  freshActionEconomy,
  spendAction,
  spendBonusAction,
  spendMovement,
  spendReaction,
  type ActionEconomy,
  type SpecificActionType,
} from "../entities/combat/action-economy.js";
import type { ActiveEffect } from "../entities/combat/effects.js";
import { shouldRemoveAtEndOfTurn, shouldRemoveAtStartOfTurn } from "../entities/combat/effects.js";
import type { Position, MovementState } from "./movement.js";
import { createMovementState } from "./movement.js";
import type { DiceRoller } from "../rules/dice-roller.js";
import { rollInitiative, type InitiativeEntry } from "./initiative.js";

export interface Combatant {
  creature: Creature;
  actionEconomy: ActionEconomy;
}

export interface CombatState {
  round: number;
  turnIndex: number;
  order: InitiativeEntry[];
}

export class Combat {
  private readonly diceRoller: DiceRoller;
  private state: CombatState;
  private combatants: Map<string, Combatant>;
  private activeEffects: Map<string, ActiveEffect[]>; // creatureId -> effects
  private positions: Map<string, Position>; // creatureId -> position
  private movementStates: Map<string, MovementState>; // creatureId -> movement state

  public constructor(diceRoller: DiceRoller, creatures: readonly Creature[]) {
    if (creatures.length === 0) {
      throw new Error("Combat requires at least one combatant");
    }

    this.diceRoller = diceRoller;
    const order = rollInitiative(this.diceRoller, creatures);

    this.state = {
      round: 1,
      turnIndex: 0,
      order,
    };

    this.combatants = new Map(
      order.map(({ creature }) => [
        creature.getId(),
        {
          creature,
          actionEconomy: freshActionEconomy(creature.getSpeed()),
        },
      ]),
    );

    // Initialize effect and position tracking
    this.activeEffects = new Map();
    this.positions = new Map();
    this.movementStates = new Map();
  }

  public getRound(): number {
    return this.state.round;
  }

  public getTurnIndex(): number {
    return this.state.turnIndex;
  }

  public getOrder(): readonly InitiativeEntry[] {
    return this.state.order;
  }

  public getActiveCreature(): Creature {
    return this.state.order[this.state.turnIndex]!.creature;
  }

  public getActionEconomy(creatureId: string): ActionEconomy {
    const combatant = this.combatants.get(creatureId);
    if (!combatant) throw new Error(`Unknown combatant: ${creatureId}`);
    return combatant.actionEconomy;
  }

  public canSpendAction(creatureId: string): boolean {
    return canSpendAction(this.getActionEconomy(creatureId));
  }

  public canSpendBonusAction(creatureId: string): boolean {
    return canSpendBonusAction(this.getActionEconomy(creatureId));
  }

  public canSpendReaction(creatureId: string): boolean {
    return canSpendReaction(this.getActionEconomy(creatureId));
  }

  public canSpendMovement(creatureId: string, feet: number): boolean {
    return canSpendMovement(this.getActionEconomy(creatureId), feet);
  }

  public spendAction(creatureId: string, specificAction?: SpecificActionType): void {
    spendAction(this.getActionEconomy(creatureId), specificAction);
  }

  public spendBonusAction(creatureId: string): void {
    spendBonusAction(this.getActionEconomy(creatureId));
  }

  public spendReaction(creatureId: string): void {
    spendReaction(this.getActionEconomy(creatureId));
  }

  public spendMovement(creatureId: string, feet: number): void {
    spendMovement(this.getActionEconomy(creatureId), feet);
  }

  public hasUsedAction(creatureId: string, actionType: SpecificActionType): boolean {
    const economy = this.getActionEconomy(creatureId);
    return economy.actionsUsed.includes(actionType);
  }

  public endTurn(): void {
    const activeCreature = this.getActiveCreature();
    const activeId = activeCreature.getId();

    // Clean up effects that expire at end of this creature's turn
    this.cleanupExpiredEffects(activeId, 'end');

    const nextIndex = this.state.turnIndex + 1;

    if (nextIndex >= this.state.order.length) {
      // New round
      this.state = {
        ...this.state,
        round: this.state.round + 1,
        turnIndex: 0,
      };

      // Reset action economy and movement for all combatants
      for (const combatant of this.combatants.values()) {
        combatant.actionEconomy = freshActionEconomy(combatant.creature.getSpeed());
        // Reset jump multiplier at end of round
        const creatureId = combatant.creature.getId();
        const movState = this.movementStates.get(creatureId);
        if (movState) {
          // Create new state with reset multiplier (immutable)
          this.movementStates.set(creatureId, {
            ...movState,
            jumpDistanceMultiplier: 1,
          });
        }
      }

      return;
    }

    this.state = { ...this.state, turnIndex: nextIndex };

    // Reset action economy for the new active creature
    const active = this.getActiveCreature();
    const combatant = this.combatants.get(active.getId());
    if (combatant) {
      combatant.actionEconomy = freshActionEconomy(active.getSpeed());
    }

    // Clean up effects that expire at start of new active creature's turn
    this.cleanupExpiredEffects(active.getId(), 'start');
  }

  // === Active Effects ===

  public addEffect(creatureId: string, effect: ActiveEffect): void {
    const effects = this.activeEffects.get(creatureId) || [];
    effects.push(effect);
    this.activeEffects.set(creatureId, effects);
  }

  public getEffects(creatureId: string): readonly ActiveEffect[] {
    return this.activeEffects.get(creatureId) || [];
  }

  public removeEffect(creatureId: string, effectId: string): boolean {
    const effects = this.activeEffects.get(creatureId);
    if (!effects) return false;

    const index = effects.findIndex(e => e.id === effectId);
    if (index === -1) return false;

    effects.splice(index, 1);
    if (effects.length === 0) {
      this.activeEffects.delete(creatureId);
    }
    return true;
  }

  private cleanupExpiredEffects(creatureId: string, timing: 'start' | 'end'): void {
    const effects = this.activeEffects.get(creatureId);
    if (!effects) return;

    const currentRound = this.state.round;
    const currentTurnIndex = this.state.turnIndex;
    const isThisCreatureTurn = this.getActiveCreature().getId() === creatureId;

    const remaining = effects.filter(effect => {
      if (timing === 'end') {
        return !shouldRemoveAtEndOfTurn(effect, currentRound, currentTurnIndex, isThisCreatureTurn);
      } else {
        // For start timing, remove effects that should expire at start of turn
        return !shouldRemoveAtStartOfTurn(effect, currentRound, currentTurnIndex, isThisCreatureTurn);
      }
    });

    if (remaining.length === 0) {
      this.activeEffects.delete(creatureId);
    } else {
      this.activeEffects.set(creatureId, remaining);
    }
  }

  // === Position & Movement ===

  public setPosition(creatureId: string, position: Position): void {
    this.positions.set(creatureId, position);
  }

  public getPosition(creatureId: string): Position | undefined {
    return this.positions.get(creatureId);
  }

  public getMovementState(creatureId: string): MovementState | undefined {
    return this.movementStates.get(creatureId);
  }

  public initializeMovementState(creatureId: string, position: Position, speed: number): void {
    this.movementStates.set(creatureId, createMovementState(position, speed));
  }

  public setJumpMultiplier(creatureId: string, multiplier: number): void {
    const state = this.movementStates.get(creatureId);
    if (state) {
      this.movementStates.set(creatureId, {
        ...state,
        jumpDistanceMultiplier: multiplier,
      });
    }
  }
}
