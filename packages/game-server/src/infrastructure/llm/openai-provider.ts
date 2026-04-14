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

const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1000;

/** Check if an error is a transient network error worth retrying. */
function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes("fetch failed") || msg.includes("econnrefused") ||
      msg.includes("econnreset") || msg.includes("etimedout") ||
      msg.includes("socket hang up") || msg.includes("network");
  }
  return false;
}

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
 * Notes: Uses the standard OpenAI chat completions endpoint with retry + exponential backoff.
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

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      llmDebugLog("openai.request", { url, timeoutMs, request, attempt });

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

        // Retry on 429 rate limit or 5xx server errors (not other 4xx client errors)
        if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
          const backoffMs = BACKOFF_BASE_MS * Math.pow(2, attempt);
          llmDebugLog("openai.retry", { status: res.status, backoffMs, attempt });
          console.log(`⏳ OpenAI ${res.status} — retrying in ${backoffMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`);
          clearTimeout(timer);
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }

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
      } catch (error: unknown) {
        clearTimeout(timer);
        // Retry on transient network errors
        if (isRetryableError(error) && attempt < MAX_RETRIES) {
          const backoffMs = BACKOFF_BASE_MS * Math.pow(2, attempt);
          llmDebugLog("openai.retry_network", { error: String(error), backoffMs, attempt });
          console.log(`⏳ OpenAI network error — retrying in ${backoffMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`);
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }

    throw new Error("OpenAI: max retries exceeded");
  }
}
