export type AiDecision = {
  action:
    | "attack"
    | "move"
    | "dash"
    | "dodge"
    | "disengage"
    | "help"
    | "hide"
    | "grapple"
    | "shove"
    | "search"
    | "useObject"
    | "castSpell"
    | "endTurn";
  target?: string;
  attackName?: string;
  destination?: { x: number; y: number };
  bonusAction?: string;
  endTurn?: boolean;
  intentNarration?: string; // Brief description of what the AI plans to do (before action execution)
  reasoning?: string;
  spellName?: string;
  seed?: number;
};

export interface IAiDecisionMaker {
  decide(input: {
    combatantName: string;
    combatantType: string;
    context: unknown;
  }): Promise<AiDecision | null>;
}
