import type { LlmChatInput, LlmProvider } from "./types.js";

/**
 * Placeholder for future OpenAI support.
 *
 * Layer: Infrastructure (LLM transport).
 * Notes: Throws at construction time — use DM_LLM_PROVIDER=ollama or github-models instead.
 */
export class OpenAiProvider implements LlmProvider {
  constructor() {
    throw new Error(
      "OpenAI provider is not yet implemented. Set DM_LLM_PROVIDER=ollama (with DM_OLLAMA_MODEL) or DM_LLM_PROVIDER=github-models (with DM_GITHUB_MODELS_MODEL + GITHUB_TOKEN) instead.",
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async chat(_input: LlmChatInput): Promise<string> {
    throw new Error("OpenAI provider is not yet implemented.");
  }
}
