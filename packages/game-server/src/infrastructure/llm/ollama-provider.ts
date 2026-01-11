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

/**
 * Ollama-backed implementation of `LlmProvider`.
 * Layer: Infrastructure (LLM transport).
 * Notes: Pure I/O wrapper; callers control prompt, schema hints, and determinism via seed.
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

    llmDebugLog("ollama.request", {
      url: `${this.config.baseUrl.replace(/\/$/, "")}/api/chat`,
      timeoutMs,
      request,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${this.config.baseUrl.replace(/\/$/, "")}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      llmDebugLog("ollama.response_meta", { status: res.status, statusText: res.statusText });

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
    } finally {
      clearTimeout(timer);
    }
  }
}
