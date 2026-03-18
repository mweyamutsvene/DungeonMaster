// Debug script to check current database state for combatants
import { createPrismaClient } from "../src/infrastructure/db/index.js";

const prisma = createPrismaClient();

async function main() {
  console.log("=== Checking CombatantState in database ===\n");

  const combatants = await prisma.combatantState.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      hpCurrent: true,
      hpMax: true,
      combatantType: true,
      monster: { select: { name: true } },
      character: { select: { name: true } },
      npc: { select: { name: true } },
    },
  });

  for (const c of combatants) {
    const name = c.monster?.name ?? c.character?.name ?? c.npc?.name ?? "Unknown";
    console.log(`${c.id} | ${name} | HP ${c.hpCurrent}/${c.hpMax} | ${c.combatantType}`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
