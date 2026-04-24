/**
 * SessionStart hook: inject current repo state into context.
 *
 * Surfaces information the agent would otherwise need to grep for at session
 * start: current branch, in-flight plans, recent commits, open SME feedback
 * rounds. Keeps the agent oriented from message #1 instead of message #5.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { emitContext } from './lib/normalize.js';

function git(args: string[]): string {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
}

const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']) || '(unknown)';
const recentCommits = git(['log', '--oneline', '-5']) || '(no commits)';

const plansDir = 'plans';
const inFlightPlans: string[] = [];
const openFeedback: string[] = [];

if (existsSync(plansDir)) {
  for (const file of readdirSync(plansDir)) {
    if (file.startsWith('plan-')) inFlightPlans.push(file);
    if (file.startsWith('sme-feedback-') && (file.endsWith('-r2.md') || file.endsWith('-r3.md'))) {
      openFeedback.push(file);
    }
  }
}

const sections: string[] = [
  `**Branch:** ${branch}`,
  '',
  '**Recent commits:**',
  '```',
  recentCommits,
  '```',
];

if (inFlightPlans.length > 0) {
  sections.push('', '**Active plans (`plans/`):**');
  for (const p of inFlightPlans.slice(0, 8)) sections.push(`- ${p}`);
}

if (openFeedback.length > 0) {
  sections.push('', '**Open SME feedback rounds (>= r2):**');
  for (const f of openFeedback.slice(0, 8)) sections.push(`- ${f}`);
}

emitContext(sections.join('\n'), 'SessionStart');
process.exit(0);
