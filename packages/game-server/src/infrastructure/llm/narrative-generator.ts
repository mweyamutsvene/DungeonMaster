import type { JsonValue } from "../../application/types.js";
import { llmDebugLog } from "./debug.js";
import type { LlmProvider } from "./types.js";

export interface INarrativeGenerator {
  narrate(input: { storyFramework: JsonValue; events: JsonValue[]; seed?: number }): Promise<string>;
}

/**
 * Minimal narration wrapper.
 *
 * This will eventually become the "events -> narrative" step used by the CLI/UI.
 *
 * Layer: Infrastructure (LLM adapter).
 * Notes: Generates prose only; must not invent or decide rule outcomes.
 */
export class NarrativeGenerator implements INarrativeGenerator {
  constructor(
    private readonly llm: LlmProvider,
    private readonly config: { model: string; temperature?: number; timeoutMs?: number },
  ) {}

  async narrate(input: { storyFramework: JsonValue; events: JsonValue[]; seed?: number }): Promise<string> {
    const messages = [
        {
          role: "system",
          content:
            "You are the narrator for a D&D session. Write concise, vivid prose. Do not invent rule outcomes; only narrate provided events.",
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              storyFramework: input.storyFramework,
              events: input.events,
            },
            null,
            2,
          ),
        },
      ] as const;

    const options = {
      model: this.config.model,
      temperature: this.config.temperature,
      seed: input.seed,
      timeoutMs: this.config.timeoutMs,
    };

    llmDebugLog("narrate.request", { input: { seed: input.seed }, messages, options });
    const raw = await this.llm.chat({ messages: [...messages], options });
    llmDebugLog("narrate.response", { raw });
    return raw;
  }
}
