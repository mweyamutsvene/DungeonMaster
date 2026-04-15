-- AlterTable
ALTER TABLE "CombatEncounter" ADD COLUMN "pendingActionQueue" JSONB;

-- AlterTable
ALTER TABLE "GameEvent" ADD COLUMN "encounterId" TEXT;
ALTER TABLE "GameEvent" ADD COLUMN "round" INTEGER;
ALTER TABLE "GameEvent" ADD COLUMN "turnNumber" INTEGER;

-- CreateIndex
CREATE INDEX "GameEvent_encounterId_round_idx" ON "GameEvent"("encounterId", "round");
