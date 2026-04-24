/**
 * normalize.ts — single source of truth for hook input parsing.
 *
 * Both Claude Code and VS Code Copilot deliver hook payloads via stdin as JSON,
 * but they differ on field naming:
 *
 * | Field         | Claude Code     | VS Code Copilot |
 * |---------------|-----------------|-----------------|
 * | tool name     | `Edit`, `Write` | `editFiles`, `createFile` |
 * | file path key | `file_path`     | `filePath`      |
 * | command key   | `command`       | `command`       |
 *
 * This module reads stdin, parses the JSON, and returns a normalized shape so
 * the hook scripts in `scripts/hooks/*.ts` are tool-agnostic.
 *
 * Usage:
 *   import { readNormalizedInput } from './lib/normalize.js';
 *   const input = await readNormalizedInput();
 *   if (input.toolName === 'Edit' || input.toolName === 'Write') { ... }
 */

export type NormalizedToolName =
  | 'Edit'
  | 'Write'
  | 'Read'
  | 'Bash'
  | 'Grep'
  | 'Glob'
  | 'Agent'
  | 'TodoWrite'
  | 'WebFetch'
  | 'WebSearch'
  | 'NotebookEdit'
  | 'Other';

export interface NormalizedHookInput {
  /** Normalized to Claude naming for cross-tool consistency. */
  toolName: NormalizedToolName;
  /** Original tool name as delivered by the source tool (preserved for diagnostics). */
  rawToolName: string;
  /** File path the tool acted on, if applicable. */
  filePath?: string;
  /** Bash command the tool ran, if applicable. */
  command?: string;
  /** Hook event name (e.g. "PreToolUse", "PostToolUse"). */
  hookEventName?: string;
  /** The full original payload — fall back to this if you need a field this normalizer doesn't surface. */
  raw: Record<string, unknown>;
}

const TOOL_NAME_MAP: Record<string, NormalizedToolName> = {
  // Claude Code names (passthrough)
  Edit: 'Edit',
  Write: 'Write',
  Read: 'Read',
  Bash: 'Bash',
  Grep: 'Grep',
  Glob: 'Glob',
  Agent: 'Agent',
  TodoWrite: 'TodoWrite',
  WebFetch: 'WebFetch',
  WebSearch: 'WebSearch',
  NotebookEdit: 'NotebookEdit',
  // VS Code Copilot equivalents
  editFiles: 'Edit',
  replace_string_in_file: 'Edit',
  createFile: 'Write',
  create_file: 'Write',
  readFile: 'Read',
  read_file: 'Read',
  runCommand: 'Bash',
  run_in_terminal: 'Bash',
  search: 'Grep',
  grep_search: 'Grep',
  findFiles: 'Glob',
  file_search: 'Glob',
};

export function normalizeToolName(raw: string | undefined): NormalizedToolName {
  if (!raw) return 'Other';
  return TOOL_NAME_MAP[raw] ?? 'Other';
}

export function extractFilePath(toolInput: Record<string, unknown> | undefined): string | undefined {
  if (!toolInput) return undefined;
  // Claude uses snake_case; Copilot uses camelCase.
  const candidate = toolInput.file_path ?? toolInput.filePath ?? toolInput.path;
  if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  // Multi-file edits in Copilot put files under `files: [...]` — return the first.
  const files = toolInput.files;
  if (Array.isArray(files) && files.length > 0 && typeof files[0] === 'string') {
    return files[0];
  }
  return undefined;
}

export function extractCommand(toolInput: Record<string, unknown> | undefined): string | undefined {
  if (!toolInput) return undefined;
  const candidate = toolInput.command;
  if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  return undefined;
}

export async function readStdin(): Promise<string> {
  let data = '';
  for await (const chunk of process.stdin) {
    data += chunk;
  }
  return data;
}

export async function readNormalizedInput(): Promise<NormalizedHookInput> {
  const raw = await readStdin();
  let parsed: Record<string, unknown> = {};
  if (raw.trim().length > 0) {
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // Fall through with empty parsed; hook scripts can decide what to do.
    }
  }
  const rawToolName = (parsed.tool_name ?? parsed.toolName ?? '') as string;
  const toolInput = (parsed.tool_input ?? parsed.toolInput ?? {}) as Record<string, unknown>;
  return {
    toolName: normalizeToolName(rawToolName),
    rawToolName,
    filePath: extractFilePath(toolInput),
    command: extractCommand(toolInput),
    hookEventName: (parsed.hookEventName ?? parsed.hook_event_name) as string | undefined,
    raw: parsed,
  };
}

/**
 * Emit a hook output JSON to stdout. Both Claude Code and VS Code consume the
 * same `hookSpecificOutput.additionalContext` shape for context injection.
 */
export function emitContext(text: string, eventName?: string): void {
  const output = {
    hookSpecificOutput: {
      hookEventName: eventName ?? 'PostToolUse',
      additionalContext: text,
    },
  };
  process.stdout.write(JSON.stringify(output) + '\n');
}

/**
 * Block the operation (PreToolUse only) with a reason. Exit code 2 = blocking
 * error in both ecosystems.
 */
export function emitBlock(reason: string): never {
  const output = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
  process.stdout.write(JSON.stringify(output) + '\n');
  process.exit(2);
}
