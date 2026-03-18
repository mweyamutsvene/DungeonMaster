import { GitHubModelsProvider } from "./github-models-provider.js";
import { OllamaProvider } from "./ollama-provider.js";
import type { LlmProvider } from "./types.js";

export function createLlmProviderFromEnv(): LlmProvider | undefined {
  const provider = (process.env.DM_LLM_PROVIDER ?? "ollama").toLowerCase();

  if (provider === "github-models") {
    const model = process.env.DM_GITHUB_MODELS_MODEL;
    if (!model) return undefined;

    const token = process.env.GITHUB_TOKEN;
    if (!token) return undefined;

    return new GitHubModelsProvider({
      baseUrl: process.env.DM_GITHUB_MODELS_BASE_URL ?? "https://models.inference.ai.azure.com",
      token,
      defaultTimeoutMs: Number(process.env.DM_LLM_TIMEOUT_MS ?? 30000),
    });
  }

  if (provider === "ollama") {
    const model = process.env.DM_OLLAMA_MODEL;
    if (!model) return undefined;

    return new OllamaProvider({
      baseUrl: process.env.DM_OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
      defaultTimeoutMs: Number(process.env.DM_LLM_TIMEOUT_MS ?? 20000),
    });
  }

  return undefined;
}

export function getDefaultModelFromEnv(): string | undefined {
  const provider = (process.env.DM_LLM_PROVIDER ?? "ollama").toLowerCase();
  if (provider === "github-models") return process.env.DM_GITHUB_MODELS_MODEL;
  return process.env.DM_OLLAMA_MODEL;
}
