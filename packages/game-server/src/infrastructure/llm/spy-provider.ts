import type { LlmProvider, LlmChatInput } from "./types.js";

/**
 * Transparent wrapper around a real LlmProvider that captures every call
 * for prompt snapshot testing and assertion purposes.
 *
 * Layer: Infrastructure (testing utility)
 */
export class SpyLlmProvider implements LlmProvider {
  private captures: Array<{ input: LlmChatInput; response: string }> = [];

  constructor(private readonly inner: LlmProvider) {}

  async chat(input: LlmChatInput): Promise<string> {
    const response = await this.inner.chat(input);
    this.captures.push({ input, response });
    return response;
  }

  /** All captured calls in order. */
  getCapturedCalls(): ReadonlyArray<{ input: LlmChatInput; response: string }> {
    return this.captures;
  }

  /** Most recent captured call, or undefined if none. */
  getLastCall(): { input: LlmChatInput; response: string } | undefined {
    return this.captures.at(-1);
  }

  /** Reset captured calls (between scenarios). */
  clearCaptures(): void {
    this.captures = [];
  }
}
