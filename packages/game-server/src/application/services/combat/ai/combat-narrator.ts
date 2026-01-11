export type CombatNarrateInput = {
  storyFramework: unknown;
  events: unknown[];
  seed: number;
};

/**
 * Application-level narration port.
 *
 * Infrastructure may implement this using an LLM, but application services must not depend on infra LLM types.
 */
export interface ICombatNarrator {
  narrate(input: CombatNarrateInput): Promise<string>;
}
