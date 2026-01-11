import { OllamaProvider } from "./ollama-provider.js";
import type { LlmProvider } from "./types.js";

export function createLlmProviderFromEnv(): LlmProvider | undefined {
  const provider = (process.env.DM_LLM_PROVIDER ?? "ollama").toLowerCase();

  if (provider === "ollama") {
    const model = process.env.DM_OLLAMA_MODEL;
    if (!model) return undefined;

    // The model name is supplied later by callers via options.model.
    return new OllamaProvider({
      baseUrl: process.env.DM_OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
      defaultTimeoutMs: Number(process.env.DM_LLM_TIMEOUT_MS ?? 20000),
    });
  }

  return undefined;
}

export function getDefaultModelFromEnv(): string | undefined {
  return process.env.DM_OLLAMA_MODEL;
}
