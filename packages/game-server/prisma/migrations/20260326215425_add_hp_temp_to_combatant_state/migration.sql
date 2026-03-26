/*
  Warnings:

  - You are about to alter the column `actor` on the `PendingAction` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.
  - You are about to alter the column `data` on the `PendingAction` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.
  - You are about to alter the column `reactionOpportunities` on the `PendingAction` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.
  - You are about to alter the column `resolvedReactions` on the `PendingAction` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CombatantState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "encounterId" TEXT NOT NULL,
    "combatantType" TEXT NOT NULL,
    "characterId" TEXT,
    "monsterId" TEXT,
    "npcId" TEXT,
    "initiative" INTEGER,
    "hpCurrent" INTEGER NOT NULL,
    "hpMax" INTEGER NOT NULL,
    "hpTemp" INTEGER NOT NULL DEFAULT 0,
    "conditions" JSONB NOT NULL,
    "resources" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CombatantState_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "CombatEncounter" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CombatantState_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "SessionCharacter" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CombatantState_monsterId_fkey" FOREIGN KEY ("monsterId") REFERENCES "SessionMonster" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CombatantState_npcId_fkey" FOREIGN KEY ("npcId") REFERENCES "SessionNPC" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CombatantState" ("characterId", "combatantType", "conditions", "createdAt", "encounterId", "hpCurrent", "hpMax", "id", "initiative", "monsterId", "npcId", "resources", "updatedAt") SELECT "characterId", "combatantType", "conditions", "createdAt", "encounterId", "hpCurrent", "hpMax", "id", "initiative", "monsterId", "npcId", "resources", "updatedAt" FROM "CombatantState";
DROP TABLE "CombatantState";
ALTER TABLE "new_CombatantState" RENAME TO "CombatantState";
CREATE INDEX "CombatantState_encounterId_idx" ON "CombatantState"("encounterId");
CREATE INDEX "CombatantState_characterId_idx" ON "CombatantState"("characterId");
CREATE INDEX "CombatantState_monsterId_idx" ON "CombatantState"("monsterId");
CREATE INDEX "CombatantState_npcId_idx" ON "CombatantState"("npcId");
CREATE TABLE "new_PendingAction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "encounterId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'awaiting_reactions',
    "actor" JSONB NOT NULL,
    "data" JSONB NOT NULL,
    "reactionOpportunities" JSONB NOT NULL,
    "resolvedReactions" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    CONSTRAINT "PendingAction_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "CombatEncounter" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PendingAction" ("actor", "createdAt", "data", "encounterId", "expiresAt", "id", "reactionOpportunities", "resolvedReactions", "status", "type") SELECT "actor", "createdAt", "data", "encounterId", "expiresAt", "id", "reactionOpportunities", "resolvedReactions", "status", "type" FROM "PendingAction";
DROP TABLE "PendingAction";
ALTER TABLE "new_PendingAction" RENAME TO "PendingAction";
CREATE INDEX "PendingAction_encounterId_idx" ON "PendingAction"("encounterId");
CREATE INDEX "PendingAction_status_idx" ON "PendingAction"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
