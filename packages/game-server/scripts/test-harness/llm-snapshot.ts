/**
 * Prompt snapshot utilities for LLM TDD harness.
 *
 * Captures the exact messages sent to the LLM and compares against stored
 * snapshots to detect unintended prompt regressions.
 */

import * as fs from "fs";
import * as path from "path";

const SNAPSHOT_DIR = path.join(import.meta.dirname, "llm-snapshots");

export type PromptSnapshot = {
  messages: Array<{ role: string; content: string }>;
  /** Timestamp of last update (ISO string). */
  updatedAt: string;
};

function snapshotPath(category: string, name: string): string {
  return path.join(SNAPSHOT_DIR, category, `${name}.snap.json`);
}

/**
 * Save a prompt snapshot to disk.
 */
export function saveSnapshot(
  category: string,
  name: string,
  messages: Array<{ role: string; content: string }>,
): void {
  const filePath = snapshotPath(category, name);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const snapshot: PromptSnapshot = {
    messages,
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2) + "\n", "utf-8");
}

export type SnapshotDiff = {
  match: boolean;
  differences: string[];
};

/**
 * Compare captured messages against a stored snapshot.
 * Returns match=true when no snapshot exists (first run) or messages match.
 */
export function compareSnapshot(
  category: string,
  name: string,
  messages: Array<{ role: string; content: string }>,
): SnapshotDiff {
  const filePath = snapshotPath(category, name);

  if (!fs.existsSync(filePath)) {
    return { match: true, differences: ["(no snapshot on disk — run with --update-snapshots to create)"] };
  }

  const stored: PromptSnapshot = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  const differences: string[] = [];

  if (stored.messages.length !== messages.length) {
    differences.push(
      `Message count: expected ${stored.messages.length}, got ${messages.length}`,
    );
    return { match: false, differences };
  }

  for (let i = 0; i < stored.messages.length; i++) {
    const expected = stored.messages[i];
    const actual = messages[i];

    if (expected.role !== actual.role) {
      differences.push(`Message[${i}].role: expected "${expected.role}", got "${actual.role}"`);
    }

    if (expected.content !== actual.content) {
      // Find first divergence point for a useful message
      const maxCtx = 80;
      let pos = 0;
      while (pos < expected.content.length && pos < actual.content.length && expected.content[pos] === actual.content[pos]) {
        pos++;
      }
      const vicinity = actual.content.substring(Math.max(0, pos - 20), pos + 40);
      differences.push(
        `Message[${i}].content differs at char ${pos}: "...${vicinity}..."`,
      );
    }
  }

  return { match: differences.length === 0, differences };
}
