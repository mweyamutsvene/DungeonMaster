import { spawnSync } from "node:child_process";

/**
 * Small helper for running vitest with explicit env vars in a cross-platform way.
 *
 * Usage:
 *   tsx scripts/run-vitest-with-env.ts KEY=VALUE OTHER=VALUE -- <vitest args...>
 *
 * Example:
 *   tsx scripts/run-vitest-with-env.ts DM_RUN_LLM_TESTS=1 -- run src/foo.test.ts
 */

function isEnvAssignment(arg: string): boolean {
  const eq = arg.indexOf("=");
  return eq > 0 && !arg.startsWith("--");
}

const separatorIndex = process.argv.indexOf("--");
const rawArgs = separatorIndex === -1 ? process.argv.slice(2) : process.argv.slice(2, separatorIndex);
const vitestArgs = separatorIndex === -1 ? [] : process.argv.slice(separatorIndex + 1);

for (const arg of rawArgs) {
  if (!isEnvAssignment(arg)) {
    throw new Error(
      `Invalid env assignment: ${JSON.stringify(arg)}. Expected KEY=VALUE before "--".`,
    );
  }

  const eq = arg.indexOf("=");
  const key = arg.slice(0, eq).trim();
  const value = arg.slice(eq + 1);
  if (!key) throw new Error(`Invalid env assignment (empty key): ${JSON.stringify(arg)}`);
  process.env[key] = value;
}

if (vitestArgs.length === 0) {
  throw new Error('Missing vitest args after "--". Example: -- run src/foo.test.ts');
}

const result = spawnSync("vitest", vitestArgs, {
  stdio: "inherit",
  shell: true,
  env: process.env,
});

process.exit(result.status ?? 1);
