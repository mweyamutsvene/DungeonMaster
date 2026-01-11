export type AiDecision = {
  action:
    | "attack"
    | "dash"
    | "dodge"
    | "disengage"
    | "help"
    | "castSpell"
    | "endTurn";
  target?: string;
  attackName?: string;
  bonusAction?: string;
  endTurn?: boolean;
  narration?: string;
  reasoning?: string;
  spellName?: string;
};

export interface IAiDecisionMaker {
  decide(input: {
    combatantName: string;
    combatantType: string;
    context: unknown;
  }): Promise<AiDecision | null>;
}
