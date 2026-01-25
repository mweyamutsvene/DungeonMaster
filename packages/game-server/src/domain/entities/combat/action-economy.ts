export type ActionType = "Action" | "BonusAction" | "Reaction" | "Movement";
export type SpecificActionType = "Attack" | "Dash" | "Dodge" | "Help" | "Hide" | "Ready" | "Search" | "UseObject" | "CastSpell";

export interface ActionEconomy {
  actionAvailable: boolean;
  bonusActionAvailable: boolean;
  reactionAvailable: boolean;
  movementRemainingFeet: number;
  actionsUsed: SpecificActionType[]; // Track which specific actions were taken
}

export function freshActionEconomy(movementFeet: number): ActionEconomy {
  return {
    actionAvailable: true,
    bonusActionAvailable: true,
    reactionAvailable: true,
    movementRemainingFeet: movementFeet,
    actionsUsed: [],
  };
}

export function canSpendAction(economy: ActionEconomy): boolean {
  return economy.actionAvailable;
}

export function canSpendBonusAction(economy: ActionEconomy): boolean {
  return economy.bonusActionAvailable;
}

export function canSpendReaction(economy: ActionEconomy): boolean {
  return economy.reactionAvailable;
}

export function canSpendMovement(economy: ActionEconomy, feet: number): boolean {
  return economy.movementRemainingFeet >= feet;
}

export function spendAction(economy: ActionEconomy, specificAction?: SpecificActionType): void {
  if (!economy.actionAvailable) {
    throw new Error("Action already spent this turn");
  }
  economy.actionAvailable = false;
  if (specificAction) {
    economy.actionsUsed.push(specificAction);
  }
}

export function spendBonusAction(economy: ActionEconomy): void {
  if (!economy.bonusActionAvailable) {
    throw new Error("Bonus action already spent this turn");
  }
  economy.bonusActionAvailable = false;
}

export function spendReaction(economy: ActionEconomy): void {
  if (!economy.reactionAvailable) {
    throw new Error("Reaction already spent this turn");
  }
  economy.reactionAvailable = false;
}

export function spendMovement(economy: ActionEconomy, feet: number): void {
  if (!Number.isInteger(feet) || feet < 0) {
    throw new Error("Movement feet must be an integer >= 0");
  }
  if (feet === 0) return;
  if (economy.movementRemainingFeet < feet) {
    throw new Error("Not enough movement remaining");
  }
  economy.movementRemainingFeet -= feet;
}
