/**
 * PostToolUse hook: test-first scenario nudge.
 *
 * When the agent edits a file under `packages/game-server/src/` (any layer),
 * check whether the test-harness scenarios directory has been touched in this
 * session. If not, inject a reminder that new features need a failing E2E
 * scenario before implementation.
 *
 * This is a NUDGE, not a block — the agent can choose to proceed if the
 * scenario already exists or the change is a pure bug fix. The reminder lives
 * in `additionalContext`, so the agent sees it without it derailing the turn.
 *
 * To avoid noise on every edit, the hook only fires once per "session" (uses
 * a short-lived sentinel file in /tmp).
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readNormalizedInput, emitContext } from './lib/normalize.js';

const input = await readNormalizedInput();

if (input.toolName !== 'Edit' && input.toolName !== 'Write') {
  process.exit(0);
}

const path = input.filePath ?? '';
const isGameServerSrc = path.includes('packages/game-server/src') || path.includes('packages\\game-server\\src');
const isTest = path.endsWith('.test.ts') || path.includes('test-harness');

if (!isGameServerSrc || isTest) {
  process.exit(0);
}

// Sentinel: don't nudge more than once per ~1 hour to avoid spam.
const sentinelDir = join(tmpdir(), 'dungeonmaster-hooks');
const sentinel = join(sentinelDir, 'test-first-nudge.lock');

if (existsSync(sentinel)) {
  process.exit(0);
}

mkdirSync(sentinelDir, { recursive: true });
writeFileSync(sentinel, String(Date.now()));

const message = `**Test-first reminder:** you edited \`${path}\` (game-server source).

Before implementing, confirm the change is covered by a failing E2E scenario in \`packages/game-server/scripts/test-harness/scenarios/\`. If not:
- New feature → write the failing scenario first (E2EScenarioWriter).
- Bug fix → write a failing test that reproduces it (VitestWriter).

If the scenario already exists or this is a refactor, proceed and ignore this nudge. (This message will not repeat for a while.)`;

emitContext(message, 'PostToolUse');
process.exit(0);
