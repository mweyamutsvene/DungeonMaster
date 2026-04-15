/*
  Warnings:

  - You are about to drop the column `pendingAction` on the `CombatEncounter` table. All the data in the column will be lost.
  - You are about to drop the column `pendingActionAt` on the `CombatEncounter` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CombatEncounter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "round" INTEGER NOT NULL DEFAULT 1,
    "turn" INTEGER NOT NULL DEFAULT 0,
    "pendingActionQueue" JSONB,
    "mapData" JSONB,
    "surprise" JSONB,
    "battlePlans" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CombatEncounter_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "GameSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CombatEncounter" ("battlePlans", "createdAt", "id", "mapData", "pendingActionQueue", "round", "sessionId", "status", "surprise", "turn", "updatedAt") SELECT "battlePlans", "createdAt", "id", "mapData", "pendingActionQueue", "round", "sessionId", "status", "surprise", "turn", "updatedAt" FROM "CombatEncounter";
DROP TABLE "CombatEncounter";
ALTER TABLE "new_CombatEncounter" RENAME TO "CombatEncounter";
CREATE INDEX "CombatEncounter_sessionId_idx" ON "CombatEncounter"("sessionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
