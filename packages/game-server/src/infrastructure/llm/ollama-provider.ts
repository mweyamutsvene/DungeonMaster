import type { LlmChatInput, LlmProvider } from "./types.js";
import { llmDebugLog } from "./debug.js";

type OllamaChatRequest = {
  model: string;
  messages: Array<{ role: string; content: string }>;
  stream: false;
  options?: Record<string, unknown>;
};

type OllamaChatResponse = {
  message?: { role: string; content: string };
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
 * Ollama-backed implementation of `LlmProvider`.
 * Layer: Infrastructure (LLM transport).
 * Notes: Pure I/O wrapper with retry + exponential backoff for transient errors.
 */
export class OllamaProvider implements LlmProvider {
  constructor(
    private readonly config: {
      baseUrl: string;
      defaultTimeoutMs: number;
    },
  ) {}

  async chat(input: LlmChatInput): Promise<string> {
    const timeoutMs = input.options.timeoutMs ?? this.config.defaultTimeoutMs;

    const request: OllamaChatRequest = {
      model: input.options.model,
      messages: input.messages.map((m) => ({ role: m.role, content: m.content })),
      stream: false,
      options: {
        temperature: input.options.temperature,
        seed: input.options.seed,
      },
    };

    const url = `${this.config.baseUrl.replace(/\/$/, "")}/api/chat`;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      llmDebugLog("ollama.request", { url, timeoutMs, request, attempt });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
          signal: controller.signal,
        });

        llmDebugLog("ollama.response_meta", { status: res.status, statusText: res.statusText });

        // Retry on 5xx server errors (not 4xx client errors)
        if (res.status >= 500 && attempt < MAX_RETRIES) {
          const backoffMs = BACKOFF_BASE_MS * Math.pow(2, attempt);
          llmDebugLog("ollama.retry", { status: res.status, backoffMs, attempt });
          console.log(`⏳ Ollama ${res.status} — retrying in ${backoffMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`);
          clearTimeout(timer);
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`Ollama chat failed: ${res.status} ${res.statusText}${body ? ` - ${body}` : ""}`);
        }

        const json = (await res.json()) as OllamaChatResponse;
        llmDebugLog("ollama.response_json", { json });
        const content = json.message?.content;
        if (!content) throw new Error("Ollama chat response missing message content");

        llmDebugLog("ollama.response", { content });
        return content;
      } catch (error: unknown) {
        clearTimeout(timer);
        // Retry on transient network errors
        if (isRetryableError(error) && attempt < MAX_RETRIES) {
          const backoffMs = BACKOFF_BASE_MS * Math.pow(2, attempt);
          llmDebugLog("ollama.retry_network", { error: String(error), backoffMs, attempt });
          console.log(`⏳ Ollama network error — retrying in ${backoffMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`);
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }

    throw new Error("Ollama: max retries exceeded");
  }
}
