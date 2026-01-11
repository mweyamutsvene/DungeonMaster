-- AlterTable
ALTER TABLE "CombatEncounter" ADD COLUMN "pendingAction" JSONB;
ALTER TABLE "CombatEncounter" ADD COLUMN "pendingActionAt" DATETIME;
