-- CreateTable
CREATE TABLE "SpellDefinition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "school" TEXT NOT NULL,
    "ritual" BOOLEAN NOT NULL DEFAULT false,
    "data" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ClassFeatureDefinition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "className" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ItemDefinition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ConditionDefinition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MonsterDefinition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "cr" REAL,
    "data" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "GameSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storyFramework" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SessionCharacter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "className" TEXT,
    "sheet" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SessionCharacter_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "GameSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SessionMonster" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "monsterDefinitionId" TEXT,
    "statBlock" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SessionMonster_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "GameSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SessionMonster_monsterDefinitionId_fkey" FOREIGN KEY ("monsterDefinitionId") REFERENCES "MonsterDefinition" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CombatEncounter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "round" INTEGER NOT NULL DEFAULT 1,
    "turn" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CombatEncounter_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "GameSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CombatantState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "encounterId" TEXT NOT NULL,
    "combatantType" TEXT NOT NULL,
    "characterId" TEXT,
    "monsterId" TEXT,
    "initiative" INTEGER,
    "hpCurrent" INTEGER NOT NULL,
    "hpMax" INTEGER NOT NULL,
    "conditions" JSONB NOT NULL,
    "resources" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CombatantState_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "CombatEncounter" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CombatantState_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "SessionCharacter" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CombatantState_monsterId_fkey" FOREIGN KEY ("monsterId") REFERENCES "SessionMonster" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GameEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GameEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "GameSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "SpellDefinition_name_key" ON "SpellDefinition"("name");

-- CreateIndex
CREATE INDEX "ClassFeatureDefinition_className_level_idx" ON "ClassFeatureDefinition"("className", "level");

-- CreateIndex
CREATE UNIQUE INDEX "ItemDefinition_name_key" ON "ItemDefinition"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ConditionDefinition_name_key" ON "ConditionDefinition"("name");

-- CreateIndex
CREATE UNIQUE INDEX "MonsterDefinition_name_key" ON "MonsterDefinition"("name");

-- CreateIndex
CREATE INDEX "SessionCharacter_sessionId_idx" ON "SessionCharacter"("sessionId");

-- CreateIndex
CREATE INDEX "SessionMonster_sessionId_idx" ON "SessionMonster"("sessionId");

-- CreateIndex
CREATE INDEX "SessionMonster_monsterDefinitionId_idx" ON "SessionMonster"("monsterDefinitionId");

-- CreateIndex
CREATE INDEX "CombatEncounter_sessionId_idx" ON "CombatEncounter"("sessionId");

-- CreateIndex
CREATE INDEX "CombatantState_encounterId_idx" ON "CombatantState"("encounterId");

-- CreateIndex
CREATE INDEX "CombatantState_characterId_idx" ON "CombatantState"("characterId");

-- CreateIndex
CREATE INDEX "CombatantState_monsterId_idx" ON "CombatantState"("monsterId");

-- CreateIndex
CREATE INDEX "GameEvent_sessionId_createdAt_idx" ON "GameEvent"("sessionId", "createdAt");
