import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { LlmChatInput, LlmProvider } from "./types.js";
import { llmDebugLog } from "./debug.js";

const MAX_RETRIES = 2;
const BACKOFF_BASE_MS = 2000;

/**
 * GitHub Copilot CLI provider — pipes prompts via stdin to `gh copilot`.
 *
 * Writes the prompt to a temp file, then streams it into the CLI's stdin.
 * This avoids Windows command-line length limits that silently truncate
 * long `-p` argument values.
 *
 * Uses `--silent` for clean output and `--no-custom-instructions` to prevent
 * the CLI from loading repo-specific instruction files.
 * Runs from the OS temp directory so the CLI doesn't pick up any
 * workspace AGENTS.md / copilot-instructions.md.
 *
 * Requires:
 *   - `gh` CLI installed and authenticated (`gh auth login`)
 *   - GitHub Copilot CLI installed (auto-installs on first `gh copilot` run)
 *   - `DM_LLM_PROVIDER=copilot`
 *   - `DM_COPILOT_MODEL` env var (default "gpt-4.1")
 *
 * Layer: Infrastructure (LLM transport via CLI subprocess).
 */
export class CopilotProvider implements LlmProvider {
  constructor(
    private readonly config: {
      defaultTimeoutMs: number;
    },
  ) {}

  async chat(input: LlmChatInput): Promise<string> {
    const timeoutMs = input.options.timeoutMs ?? this.config.defaultTimeoutMs;
    const model = input.options.model;

    // Flatten messages into a single prompt with a wrapper that overrides
    // the Copilot CLI agent's built-in coding assistant personality.
    const parts: string[] = [
      "IMPORTANT: You are NOT a coding assistant for this request. " +
      "Follow the instructions below and respond ONLY with the requested output. " +
      "No preamble, no meta-commentary, no explanations of what you will do. " +
      "Just produce the output directly.",
    ];
    for (const msg of input.messages) {
      if (msg.role === "system") {
        parts.push(`[Instructions]\n${msg.content}`);
      } else if (msg.role === "assistant") {
        parts.push(`[Assistant]\n${msg.content}`);
      } else {
        parts.push(`[Input]\n${msg.content}`);
      }
    }
    const prompt = parts.join("\n\n");

    // Write prompt to a temp file — streamed into stdin to avoid arg length limits.
    const promptFile = join(tmpdir(), `copilot-prompt-${randomUUID()}.txt`);
    await writeFile(promptFile, prompt, "utf-8");

    const args = [
      "copilot",
      "--model", model,
      "--silent",
      "--no-custom-instructions",
    ];

    try {
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        llmDebugLog("copilot.request", { model, promptLength: prompt.length, attempt });

        try {
          const content = await this.runCli(args, promptFile, timeoutMs);

          if (!content) {
            throw new Error("Copilot CLI returned empty response");
          }

          llmDebugLog("copilot.response", { contentLength: content.length, content: content.slice(0, 200) });
          return content;
        } catch (error: unknown) {
          if (error instanceof Error && error.message.includes("ENOENT")) {
            throw new Error(
              "Copilot provider requires `gh` CLI. Install from https://cli.github.com/ and run `gh auth login`.",
            );
          }

          const isRetryable = error instanceof Error && (
            error.message.includes("ETIMEDOUT") ||
            error.message.includes("killed") ||
            error.message.includes("SIGTERM")
          );

          if (isRetryable && attempt < MAX_RETRIES) {
            const backoffMs = BACKOFF_BASE_MS * Math.pow(2, attempt);
            llmDebugLog("copilot.retry", { error: String(error), backoffMs, attempt });
            // eslint-disable-next-line no-console
            console.log(`⏳ Copilot CLI timeout — retrying in ${backoffMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`);
            await new Promise((r) => setTimeout(r, backoffMs));
            continue;
          }

          throw error;
        }
      }

      throw new Error("Copilot CLI: max retries exceeded");
    } finally {
      unlink(promptFile).catch(() => {});
    }
  }

  /** Spawn `gh copilot` and stream the prompt file into stdin. */
  private runCli(args: string[], promptFile: string, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn("gh", args, {
        cwd: tmpdir(),
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          proc.kill("SIGTERM");
          reject(new Error("Copilot CLI timed out (killed)"));
        }
      }, timeoutMs);

      proc.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
      proc.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

      proc.on("error", (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      });

      proc.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);

        const stderr = Buffer.concat(stderrChunks).toString().trim();
        if (stderr) llmDebugLog("copilot.stderr", { stderr });

        if (code !== 0) {
          reject(new Error(`Copilot CLI exited with code ${code}: ${stderr}`));
          return;
        }

        resolve(Buffer.concat(stdoutChunks).toString().trim());
      });

      // Stream prompt file into stdin
      createReadStream(promptFile).pipe(proc.stdin);
    });
  }
}
