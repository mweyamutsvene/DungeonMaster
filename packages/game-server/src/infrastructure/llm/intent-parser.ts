import { extractFirstJsonObject } from "./json.js";
import { llmDebugLog } from "./debug.js";
import type { LlmProvider } from "./types.js";

export interface IIntentParser {
  parseIntent(input: { text: string; seed?: number; schemaHint?: string }): Promise<unknown>;
}

/**
 * Minimal intent parser wrapper.
 *
 * For now, this is intentionally generic since our HTTP API already accepts structured commands.
 * We'll specialize this once we decide the stable command schema for more action kinds.
 *
 * Layer: Infrastructure (LLM adapter).
 * Notes: Produces structured intents; must not be used to decide rules/mechanics.
 */
export class IntentParser implements IIntentParser {
  constructor(
    private readonly llm: LlmProvider,
    private readonly config: { model: string; temperature?: number; timeoutMs?: number },
  ) {}

  async parseIntent(input: { text: string; seed?: number; schemaHint?: string }): Promise<unknown> {
    const messages = [
        {
          role: "system",
          content:
            "You convert natural language into a single JSON object that matches the requested schema hint. Output ONLY JSON.",
        },
        {
          role: "user",
          content: [
            input.schemaHint ? `Schema hint:\n${input.schemaHint}` : "",
            "Player text:",
            input.text,
            "",
            "Return ONLY a single JSON object.",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ] as const;

    const options = {
      model: this.config.model,
      temperature: this.config.temperature,
      seed: input.seed,
      timeoutMs: this.config.timeoutMs,
    };

    llmDebugLog("intent.request", { input, messages, options });

    const raw = await this.llm.chat({ messages: [...messages], options });
    llmDebugLog("intent.response", { raw });

    const json = extractFirstJsonObject(raw);
    llmDebugLog("intent.parsed_json", { json });
    return json;
  }
}
