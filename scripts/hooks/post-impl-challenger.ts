/**
 * Stop hook: post-implementation Challenger queue.
 *
 * After an agent session ends, scan `plans/` for any `plan-*.md` with
 * `status: APPROVED` (or `COMPLETE`) that does NOT have a matching
 * `challenge-{feature}-postimpl.md`. Surface them via `additionalContext`
 * so the next session can fire a Challenger pass.
 *
 * The Challenger reviews the SHIPPED implementation (not the plan) and
 * generates adversarial scenarios that could disagree with PHB 2024.
 * Catches edge cases SMEs missed because they validated intent, not behavior.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { emitContext } from './lib/normalize.js';

const plansDir = 'plans';
if (!existsSync(plansDir)) process.exit(0);

interface PlanMeta {
  file: string;
  feature: string;
  status: string;
}

function parseFrontmatter(content: string): Record<string, string> {
  const fm = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fm) return {};
  const result: Record<string, string> = {};
  for (const line of fm[1].split('\n')) {
    const match = line.match(/^(\w+):\s*(.+?)\s*$/);
    if (match) result[match[1]] = match[2];
  }
  return result;
}

const queued: PlanMeta[] = [];
const files = readdirSync(plansDir);
const planFiles = files.filter(f => f.startsWith('plan-') && f.endsWith('.md'));
const challengeFiles = new Set(files.filter(f => f.endsWith('-postimpl.md')));

for (const planFile of planFiles) {
  const fm = parseFrontmatter(readFileSync(join(plansDir, planFile), 'utf8'));
  if (fm.status !== 'APPROVED' && fm.status !== 'COMPLETE') continue;
  const feature = fm.feature ?? planFile.replace(/^plan-/, '').replace(/\.md$/, '');
  const expectedChallenge = `challenge-${feature}-postimpl.md`;
  if (challengeFiles.has(expectedChallenge)) continue;
  queued.push({ file: planFile, feature, status: fm.status });
}

if (queued.length === 0) process.exit(0);

const lines: string[] = [
  `**Post-implementation Challenger queue (${queued.length}):**`,
  '',
  'These shipped plans have no adversarial review yet. Next session, fire the Challenger agent to pressure-test the IMPLEMENTATION (not the plan) and write findings to `plans/challenge-<feature>-postimpl.md`:',
  '',
];
for (const p of queued.slice(0, 8)) {
  lines.push(`- \`${p.file}\` (status: ${p.status}, feature: ${p.feature})`);
}
if (queued.length > 8) lines.push(`- ... and ${queued.length - 8} more`);
lines.push(
  '',
  'Suggested invocation: `Agent("Challenger"): generate 3 adversarial scenarios against the {feature} implementation that could disagree with PHB 2024. Write to plans/challenge-{feature}-postimpl.md.`',
);

emitContext(lines.join('\n'), 'Stop');
process.exit(0);
