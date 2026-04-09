export type ActionType = "Action" | "BonusAction" | "Reaction" | "Movement";
export type SpecificActionType = "Attack" | "Dash" | "Dodge" | "Help" | "Hide" | "Ready" | "Search" | "UseObject" | "CastSpell";

export interface ActionEconomy {
  readonly actionAvailable: boolean;
  readonly bonusActionAvailable: boolean;
  readonly reactionAvailable: boolean;
  readonly movementRemainingFeet: number;
  readonly actionsUsed: readonly SpecificActionType[];
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

// ── Immutable updaters (return new objects) ─────────────────────────

export function withActionSpent(economy: ActionEconomy, specificAction?: SpecificActionType): ActionEconomy {
  if (!economy.actionAvailable) {
    throw new Error("Action already spent this turn");
  }
  return {
    ...economy,
    actionAvailable: false,
    actionsUsed: specificAction ? [...economy.actionsUsed, specificAction] : [...economy.actionsUsed],
  };
}

export function withBonusActionSpent(economy: ActionEconomy): ActionEconomy {
  if (!economy.bonusActionAvailable) {
    throw new Error("Bonus action already spent this turn");
  }
  return { ...economy, bonusActionAvailable: false };
}

export function withReactionSpent(economy: ActionEconomy): ActionEconomy {
  if (!economy.reactionAvailable) {
    throw new Error("Reaction already spent this turn");
  }
  return { ...economy, reactionAvailable: false };
}

export function withMovementSpent(economy: ActionEconomy, feet: number): ActionEconomy {
  if (!Number.isInteger(feet) || feet < 0) {
    throw new Error("Movement feet must be an integer >= 0");
  }
  if (feet === 0) return economy;
  if (economy.movementRemainingFeet < feet) {
    throw new Error("Not enough movement remaining");
  }
  return { ...economy, movementRemainingFeet: economy.movementRemainingFeet - feet };
}

// ── Mutable helpers (legacy — kept for gradual migration) ───────────

/** @deprecated Use withActionSpent() for immutable updates */
export function spendAction(economy: ActionEconomy, specificAction?: SpecificActionType): void {
  if (!economy.actionAvailable) {
    throw new Error("Action already spent this turn");
  }
  (economy as any).actionAvailable = false;
  if (specificAction) {
    (economy.actionsUsed as SpecificActionType[]).push(specificAction);
  }
}

/** @deprecated Use withBonusActionSpent() for immutable updates */
export function spendBonusAction(economy: ActionEconomy): void {
  if (!economy.bonusActionAvailable) {
    throw new Error("Bonus action already spent this turn");
  }
  (economy as any).bonusActionAvailable = false;
}

/** @deprecated Use withReactionSpent() for immutable updates */
export function spendReaction(economy: ActionEconomy): void {
  if (!economy.reactionAvailable) {
    throw new Error("Reaction already spent this turn");
  }
  (economy as any).reactionAvailable = false;
}

/** @deprecated Use withMovementSpent() for immutable updates */
export function spendMovement(economy: ActionEconomy, feet: number): void {
  if (!Number.isInteger(feet) || feet < 0) {
    throw new Error("Movement feet must be an integer >= 0");
  }
  if (feet === 0) return;
  if (economy.movementRemainingFeet < feet) {
    throw new Error("Not enough movement remaining");
  }
  (economy as any).movementRemainingFeet -= feet;
}
