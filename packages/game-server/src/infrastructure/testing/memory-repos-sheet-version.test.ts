/**
 * Unit tests for MemoryCharacterRepository optimistic-concurrency behavior
 * (`updateSheet` bumps sheetVersion; `updateSheetWithVersion` CAS).
 */

import { describe, it, expect } from "vitest";
import { MemoryCharacterRepository } from "./memory-repos.js";
import { ConflictError } from "../../application/errors.js";

async function makeChar(repo: MemoryCharacterRepository) {
  return repo.createInSession("session-1", {
    id: "char-1",
    name: "Test",
    level: 1,
    className: "fighter",
    sheet: { hp: 10 },
  });
}

describe("MemoryCharacterRepository sheetVersion", () => {
  it("createInSession initializes sheetVersion to 0", async () => {
    const repo = new MemoryCharacterRepository();
    const created = await makeChar(repo);
    expect(created.sheetVersion).toBe(0);
  });

  it("updateSheet increments sheetVersion on each write", async () => {
    const repo = new MemoryCharacterRepository();
    await makeChar(repo);
    const v1 = await repo.updateSheet("char-1", { hp: 9 });
    expect(v1.sheetVersion).toBe(1);
    const v2 = await repo.updateSheet("char-1", { hp: 8 });
    expect(v2.sheetVersion).toBe(2);
  });

  it("updateSheetWithVersion succeeds when expected matches", async () => {
    const repo = new MemoryCharacterRepository();
    await makeChar(repo);
    const v1 = await repo.updateSheetWithVersion("char-1", { hp: 7 }, 0);
    expect(v1.sheetVersion).toBe(1);
    expect(v1.sheet).toEqual({ hp: 7 });
  });

  it("updateSheetWithVersion throws ConflictError on mismatch", async () => {
    const repo = new MemoryCharacterRepository();
    await makeChar(repo);
    await repo.updateSheet("char-1", { hp: 9 }); // now version 1
    await expect(
      repo.updateSheetWithVersion("char-1", { hp: 5 }, 0),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("updateSheetWithVersion throws ConflictError on missing character", async () => {
    const repo = new MemoryCharacterRepository();
    await expect(
      repo.updateSheetWithVersion("nope", { hp: 5 }, 0),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
