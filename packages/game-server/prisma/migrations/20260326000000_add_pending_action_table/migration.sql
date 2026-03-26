-- CreateTable
CREATE TABLE "PendingAction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "encounterId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'awaiting_reactions',
    "actor" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "reactionOpportunities" TEXT NOT NULL,
    "resolvedReactions" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    CONSTRAINT "PendingAction_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "CombatEncounter" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PendingAction_encounterId_idx" ON "PendingAction"("encounterId");

-- CreateIndex
CREATE INDEX "PendingAction_status_idx" ON "PendingAction"("status");
