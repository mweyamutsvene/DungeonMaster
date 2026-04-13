import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { LlmChatInput, LlmProvider } from "./types.js";
import { llmDebugLog } from "./debug.js";

const execFileAsync = promisify(execFile);

type CopilotChatResponse = {
  choices?: Array<{
    message?: { role: string; content: string };
  }>;
};

const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 2000;
const COPILOT_API_URL = "https://api.githubcopilot.com/chat/completions";

/** Cache the token so we don't shell out to `gh` on every single request. */
let cachedToken: { value: string; expiresAt: number } | undefined;
const TOKEN_TTL_MS = 30 * 1000; // refresh every 30s — gh OAuth tokens may rotate frequently

async function getGhToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.value;
  }
  const { stdout } = await execFileAsync("gh", ["auth", "token"], {
    timeout: 10_000,
    windowsHide: true,
  });
  const token = stdout.trim();
  if (!token) throw new Error("gh auth token returned empty — run `gh auth login` first.");
  cachedToken = { value: token, expiresAt: Date.now() + TOKEN_TTL_MS };
  return token;
}

/**
 * GitHub Copilot API provider — calls the OpenAI-compatible
 * `api.githubcopilot.com/chat/completions` endpoint using a token
 * obtained from the `gh` CLI.
 *
 * Requires:
 *   - `gh` CLI installed and authenticated (`gh auth login`)
 *   - Active GitHub Copilot subscription
 *   - `DM_LLM_PROVIDER=copilot`
 *   - `DM_COPILOT_MODEL` env var (default "gpt-4.1")
 *
 * Layer: Infrastructure (LLM transport).
 */
export class CopilotProvider implements LlmProvider {
  constructor(
    private readonly config: {
      defaultTimeoutMs: number;
    },
  ) {}

  async chat(input: LlmChatInput): Promise<string> {
    const timeoutMs = input.options.timeoutMs ?? this.config.defaultTimeoutMs;
    const token = await getGhToken();

    const request = {
      model: input.options.model,
      messages: input.messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: input.options.temperature,
      seed: input.options.seed,
    };

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      llmDebugLog("copilot.request", { model: request.model, messageCount: request.messages.length, attempt });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await fetch(COPILOT_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(request),
          signal: controller.signal,
        });

        llmDebugLog("copilot.response_meta", { status: res.status, statusText: res.statusText });

        // Retry on 429 rate limit, 403 (token may need refresh), or 5xx server errors
        if ((res.status === 429 || res.status === 403 || res.status >= 500) && attempt < MAX_RETRIES) {
          const backoffMs = BACKOFF_BASE_MS * Math.pow(2, attempt);
          llmDebugLog("copilot.retry", { status: res.status, backoffMs, attempt });
          // eslint-disable-next-line no-console
          console.log(`⏳ Copilot ${res.status} — retrying in ${backoffMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`);
          clearTimeout(timer);
          // Force token refresh on 403 in case it expired
          if (res.status === 403) cachedToken = undefined;
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(
            `Copilot chat failed: ${res.status} ${res.statusText}${body ? ` - ${body}` : ""}`,
          );
        }

        const json = (await res.json()) as CopilotChatResponse;
        llmDebugLog("copilot.response_json", { json });

        const content = json.choices?.[0]?.message?.content;
        if (!content) throw new Error("Copilot chat response missing message content");

        llmDebugLog("copilot.response", { content });
        return content;
      } catch (error: unknown) {
        clearTimeout(timer);

        // If gh is not installed, give a clear message
        if (error instanceof Error && error.message.includes("ENOENT")) {
          throw new Error(
            "Copilot provider requires `gh` CLI. Install from https://cli.github.com/ and run `gh auth login`.",
          );
        }

        // Retry on transient network errors
        if (error instanceof Error && attempt < MAX_RETRIES) {
          const msg = error.message.toLowerCase();
          const isTransient = msg.includes("fetch failed") || msg.includes("econnrefused") ||
            msg.includes("econnreset") || msg.includes("etimedout") ||
            msg.includes("socket hang up") || msg.includes("abort");
          if (isTransient) {
            const backoffMs = BACKOFF_BASE_MS * Math.pow(2, attempt);
            llmDebugLog("copilot.retry_network", { error: String(error), backoffMs, attempt });
            // eslint-disable-next-line no-console
            console.log(`⏳ Copilot network error — retrying in ${backoffMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`);
            await new Promise((r) => setTimeout(r, backoffMs));
            continue;
          }
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }

    throw new Error("Copilot: max retries exceeded");
  }
}
