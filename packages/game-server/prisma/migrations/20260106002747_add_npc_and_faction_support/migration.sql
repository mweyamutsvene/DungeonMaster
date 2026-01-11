-- CreateTable
CREATE TABLE "SessionNPC" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "statBlock" JSONB NOT NULL,
    "faction" TEXT NOT NULL DEFAULT 'party',
    "aiControlled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SessionNPC_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "GameSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

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
    "conditions" JSONB NOT NULL,
    "resources" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CombatantState_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "CombatEncounter" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CombatantState_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "SessionCharacter" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CombatantState_monsterId_fkey" FOREIGN KEY ("monsterId") REFERENCES "SessionMonster" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CombatantState_npcId_fkey" FOREIGN KEY ("npcId") REFERENCES "SessionNPC" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CombatantState" ("characterId", "combatantType", "conditions", "createdAt", "encounterId", "hpCurrent", "hpMax", "id", "initiative", "monsterId", "resources", "updatedAt") SELECT "characterId", "combatantType", "conditions", "createdAt", "encounterId", "hpCurrent", "hpMax", "id", "initiative", "monsterId", "resources", "updatedAt" FROM "CombatantState";
DROP TABLE "CombatantState";
ALTER TABLE "new_CombatantState" RENAME TO "CombatantState";
CREATE INDEX "CombatantState_encounterId_idx" ON "CombatantState"("encounterId");
CREATE INDEX "CombatantState_characterId_idx" ON "CombatantState"("characterId");
CREATE INDEX "CombatantState_monsterId_idx" ON "CombatantState"("monsterId");
CREATE INDEX "CombatantState_npcId_idx" ON "CombatantState"("npcId");
CREATE TABLE "new_SessionCharacter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "className" TEXT,
    "sheet" JSONB NOT NULL,
    "faction" TEXT NOT NULL DEFAULT 'party',
    "aiControlled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SessionCharacter_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "GameSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_SessionCharacter" ("className", "createdAt", "id", "level", "name", "sessionId", "sheet", "updatedAt") SELECT "className", "createdAt", "id", "level", "name", "sessionId", "sheet", "updatedAt" FROM "SessionCharacter";
DROP TABLE "SessionCharacter";
ALTER TABLE "new_SessionCharacter" RENAME TO "SessionCharacter";
CREATE INDEX "SessionCharacter_sessionId_idx" ON "SessionCharacter"("sessionId");
CREATE TABLE "new_SessionMonster" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "monsterDefinitionId" TEXT,
    "statBlock" JSONB NOT NULL,
    "faction" TEXT NOT NULL DEFAULT 'enemy',
    "aiControlled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SessionMonster_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "GameSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SessionMonster_monsterDefinitionId_fkey" FOREIGN KEY ("monsterDefinitionId") REFERENCES "MonsterDefinition" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SessionMonster" ("createdAt", "id", "monsterDefinitionId", "name", "sessionId", "statBlock", "updatedAt") SELECT "createdAt", "id", "monsterDefinitionId", "name", "sessionId", "statBlock", "updatedAt" FROM "SessionMonster";
DROP TABLE "SessionMonster";
ALTER TABLE "new_SessionMonster" RENAME TO "SessionMonster";
CREATE INDEX "SessionMonster_sessionId_idx" ON "SessionMonster"("sessionId");
CREATE INDEX "SessionMonster_monsterDefinitionId_idx" ON "SessionMonster"("monsterDefinitionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "SessionNPC_sessionId_idx" ON "SessionNPC"("sessionId");
