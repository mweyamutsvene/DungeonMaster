import type { LlmChatInput, LlmProvider } from "./types.js";
import { llmDebugLog } from "./debug.js";

type OpenAiChatRequest = {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  seed?: number;
};

type OpenAiChatResponse = {
  choices?: Array<{
    message?: { role: string; content: string };
  }>;
};

/**
 * OpenAI-backed implementation of `LlmProvider`.
 *
 * Layer: Infrastructure (LLM transport).
 *
 * Requires:
 *   - `DM_OPENAI_API_KEY` env var
 *   - `DM_LLM_PROVIDER=openai`
 *   - `DM_OPENAI_MODEL` env var (e.g. "gpt-4o", "gpt-4o-mini")
 *
 * Notes: Uses the standard OpenAI chat completions endpoint.
 *        Compatible with any OpenAI-API-compatible service by overriding `DM_OPENAI_BASE_URL`.
 */
export class OpenAiProvider implements LlmProvider {
  constructor(
    private readonly config: {
      baseUrl: string;
      apiKey: string;
      defaultTimeoutMs: number;
    },
  ) {}

  async chat(input: LlmChatInput): Promise<string> {
    const timeoutMs = input.options.timeoutMs ?? this.config.defaultTimeoutMs;
    const url = `${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`;

    const request: OpenAiChatRequest = {
      model: input.options.model,
      messages: input.messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: input.options.temperature,
      seed: input.options.seed,
    };

    llmDebugLog("openai.request", { url, timeoutMs, request });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      llmDebugLog("openai.response_meta", { status: res.status, statusText: res.statusText });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(
          `OpenAI chat failed: ${res.status} ${res.statusText}${body ? ` - ${body}` : ""}`,
        );
      }

      const json = (await res.json()) as OpenAiChatResponse;
      llmDebugLog("openai.response_json", { json });

      const content = json.choices?.[0]?.message?.content;
      if (!content) throw new Error("OpenAI chat response missing message content");

      llmDebugLog("openai.response", { content });
      return content;
    } finally {
      clearTimeout(timer);
    }
  }
}
