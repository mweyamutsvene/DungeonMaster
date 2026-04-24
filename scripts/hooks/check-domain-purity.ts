/**
 * PostToolUse hook: domain-purity check.
 *
 * After an edit to any file under `packages/game-server/src/domain/**`, scan
 * for forbidden imports (Fastify, Prisma, LLM providers). Domain code must be
 * pure — it can be reasoned about without knowing the runtime — so any leak
 * across the DDD boundary is a bug.
 *
 * Behavior: warns via `additionalContext` (non-blocking). The agent sees the
 * warning in the same turn and can fix before moving on.
 */

import { readFileSync, existsSync } from 'node:fs';
import { readNormalizedInput, emitContext } from './lib/normalize.js';

const input = await readNormalizedInput();

if (input.toolName !== 'Edit' && input.toolName !== 'Write') {
  process.exit(0);
}

const path = input.filePath ?? '';
const isDomainFile = (path.includes('packages/game-server/src/domain') ||
                     path.includes('packages\\game-server\\src\\domain')) &&
                    (path.endsWith('.ts') || path.endsWith('.tsx'));

if (!isDomainFile) {
  process.exit(0);
}

if (!existsSync(path)) {
  process.exit(0);
}

const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /from ['"]fastify['"]/, reason: 'Fastify import in domain layer' },
  { pattern: /from ['"]@prisma\/client['"]/, reason: '@prisma/client import in domain layer' },
  { pattern: /from ['"].*infrastructure\/llm/, reason: 'LLM infrastructure import in domain layer' },
  { pattern: /from ['"].*infrastructure\/api/, reason: 'API infrastructure import in domain layer' },
  { pattern: /from ['"].*infrastructure\/db/, reason: 'DB infrastructure import in domain layer' },
];

const content = readFileSync(path, 'utf8');
const violations: string[] = [];
for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
  if (pattern.test(content)) {
    violations.push(`- ${reason}`);
  }
}

if (violations.length === 0) {
  process.exit(0);
}

const message = `Domain-purity violation in ${path}:\n${violations.join('\n')}\n\nThe domain layer must NOT import from Fastify, Prisma, LLM providers, or infrastructure adapters. Move side-effecting code to the application or infrastructure layer.`;
emitContext(message, 'PostToolUse');
process.exit(0);
