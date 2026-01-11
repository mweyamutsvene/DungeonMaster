import type { LlmChatInput, LlmProvider } from "./types.js";

/**
 * Placeholder for later.
 *
 * When we swap to OpenAI, we can implement this class behind the same `LlmProvider` interface.
 *
 * Layer: Infrastructure (LLM transport).
 * Notes: Not implemented; keep the interface stable for adapters/tests.
 */
export class OpenAiProvider implements LlmProvider {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async chat(_input: LlmChatInput): Promise<string> {
    throw new Error("OpenAI provider not implemented yet");
  }
}
