import type { LlmChatInput, LlmProvider } from "./types.js";

/**
 * Placeholder for future OpenAI support.
 *
 * Layer: Infrastructure (LLM transport).
 * Notes: Throws at construction time with an actionable error message.
 *        Set OPENAI_API_KEY if you have an API key, or use a different provider.
 */
export class OpenAiProvider implements LlmProvider {
  constructor() {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error(
        "OpenAI provider requires OPENAI_API_KEY environment variable. " +
        "Set it or use DM_LLM_PROVIDER=ollama (with DM_OLLAMA_MODEL) or " +
        "DM_LLM_PROVIDER=github-models (with DM_GITHUB_MODELS_MODEL + GITHUB_TOKEN) instead.",
      );
    }
    throw new Error(
      "OpenAI provider is not yet implemented. Contributions welcome. " +
      "Use DM_LLM_PROVIDER=ollama or DM_LLM_PROVIDER=github-models instead.",
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async chat(_input: LlmChatInput): Promise<string> {
    throw new Error("OpenAI provider is not yet implemented.");
  }
}
