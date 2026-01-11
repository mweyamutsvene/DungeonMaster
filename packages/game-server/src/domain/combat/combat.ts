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
} from "../entities/combat/action-economy.js";
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

  public spendAction(creatureId: string): void {
    spendAction(this.getActionEconomy(creatureId));
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

  public endTurn(): void {
    const nextIndex = this.state.turnIndex + 1;

    if (nextIndex >= this.state.order.length) {
      // New round
      this.state = {
        ...this.state,
        round: this.state.round + 1,
        turnIndex: 0,
      };

      // Reset action economy for all combatants
      for (const combatant of this.combatants.values()) {
        combatant.actionEconomy = freshActionEconomy(combatant.creature.getSpeed());
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
  }
}
