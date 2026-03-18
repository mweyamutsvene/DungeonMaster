import type { LlmChatInput, LlmProvider } from "./types.js";
import { llmDebugLog } from "./debug.js";

type GitHubModelsChatRequest = {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  seed?: number;
};

type GitHubModelsChatResponse = {
  choices?: Array<{
    message?: { role: string; content: string };
  }>;
};

const MAX_RETRIES = 5;

function parseRetryAfterSeconds(body: string): number {
  // Try to extract "wait N seconds" from the error message
  const match = body.match(/wait\s+(\d+)\s+seconds/i);
  return match ? Number(match[1]) : 60;
}

/**
 * GitHub Models API provider — OpenAI-compatible chat completions endpoint.
 * Includes automatic retry with backoff for 429 rate-limit responses.
 *
 * Requires:
 *   - `GITHUB_TOKEN` env var (or a fine-grained PAT with Models access)
 *   - `DM_LLM_PROVIDER=github-models`
 *   - `DM_GITHUB_MODELS_MODEL` env var (e.g. "gpt-4o", "claude-sonnet-4", "llama-3.3-70b")
 *
 * Layer: Infrastructure (LLM transport).
 */
export class GitHubModelsProvider implements LlmProvider {
  constructor(
    private readonly config: {
      baseUrl: string;
      token: string;
      defaultTimeoutMs: number;
    },
  ) {}

  async chat(input: LlmChatInput): Promise<string> {
    const timeoutMs = input.options.timeoutMs ?? this.config.defaultTimeoutMs;
    const url = `${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`;

    const request: GitHubModelsChatRequest = {
      model: input.options.model,
      messages: input.messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: input.options.temperature,
      seed: input.options.seed,
    };

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      llmDebugLog("github-models.request", { url, timeoutMs, request, attempt });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.config.token}`,
          },
          body: JSON.stringify(request),
          signal: controller.signal,
        });

        llmDebugLog("github-models.response_meta", { status: res.status, statusText: res.statusText });

        if (res.status === 429 && attempt < MAX_RETRIES) {
          const body = await res.text().catch(() => "");
          const waitSec = parseRetryAfterSeconds(body);
          llmDebugLog("github-models.rate_limited", { waitSec, attempt });
          // eslint-disable-next-line no-console
          console.log(`⏳ Rate limited — waiting ${waitSec}s before retry (attempt ${attempt + 1}/${MAX_RETRIES})...`);
          clearTimeout(timer);
          await new Promise((r) => setTimeout(r, waitSec * 1000));
          continue;
        }

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(
            `GitHub Models chat failed: ${res.status} ${res.statusText}${body ? ` - ${body}` : ""}`,
          );
        }

        const json = (await res.json()) as GitHubModelsChatResponse;
        llmDebugLog("github-models.response_json", { json });

        const content = json.choices?.[0]?.message?.content;
        if (!content) throw new Error("GitHub Models chat response missing message content");

        llmDebugLog("github-models.response", { content });
        return content;
      } finally {
        clearTimeout(timer);
      }
    }

    throw new Error("GitHub Models: max retries exceeded due to rate limiting");
  }
}
