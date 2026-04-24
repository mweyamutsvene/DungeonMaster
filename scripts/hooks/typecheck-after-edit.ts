/**
 * PostToolUse hook: typecheck after .ts edits in game-server.
 *
 * Runs `pnpm -C packages/game-server typecheck` when an Edit or Write tool
 * touches a TypeScript file under `packages/game-server/`. Injects compiler
 * errors back into the agent's context via `additionalContext`, so the agent
 * sees them within the same turn instead of waiting for a manual check.
 *
 * Cost-aware: only fires for Edit/Write on .ts files. Skips test files (those
 * have their own watcher tooling).
 */

import { spawnSync } from 'node:child_process';
import { readNormalizedInput, emitContext } from './lib/normalize.js';

const input = await readNormalizedInput();

if (input.toolName !== 'Edit' && input.toolName !== 'Write') {
  process.exit(0);
}

const path = input.filePath ?? '';
if (!path.endsWith('.ts') && !path.endsWith('.tsx')) {
  process.exit(0);
}
if (!path.includes('packages/game-server') && !path.includes('packages\\game-server')) {
  process.exit(0);
}

const result = spawnSync('pnpm', ['-C', 'packages/game-server', 'typecheck'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
});

if (result.status === 0) {
  // Silent success — don't spam context.
  process.exit(0);
}

const output = (result.stdout + '\n' + result.stderr).trim();
// Cap injected text so context stays focused on errors, not progress noise.
const trimmed = output.split('\n').filter(line => /error TS\d+/.test(line)).slice(0, 30).join('\n');
const message = trimmed.length > 0
  ? `Typecheck failed after edit to ${path}:\n${trimmed}`
  : `Typecheck failed after edit to ${path}. Run \`pnpm -C packages/game-server typecheck\` for full output.`;

emitContext(message, 'PostToolUse');
process.exit(0);
