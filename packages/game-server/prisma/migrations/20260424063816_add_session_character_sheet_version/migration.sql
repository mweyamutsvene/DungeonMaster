-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SessionCharacter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "className" TEXT,
    "sheet" JSONB NOT NULL,
    "sheetVersion" INTEGER NOT NULL DEFAULT 0,
    "faction" TEXT NOT NULL DEFAULT 'party',
    "aiControlled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SessionCharacter_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "GameSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_SessionCharacter" ("aiControlled", "className", "createdAt", "faction", "id", "level", "name", "sessionId", "sheet", "updatedAt") SELECT "aiControlled", "className", "createdAt", "faction", "id", "level", "name", "sessionId", "sheet", "updatedAt" FROM "SessionCharacter";
DROP TABLE "SessionCharacter";
ALTER TABLE "new_SessionCharacter" RENAME TO "SessionCharacter";
CREATE INDEX "SessionCharacter_sessionId_idx" ON "SessionCharacter"("sessionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
