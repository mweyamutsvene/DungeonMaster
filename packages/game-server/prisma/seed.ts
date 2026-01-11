import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Stage 1.3 seed scaffolding.

  await prisma.spellDefinition.upsert({
    where: { id: "example_spell" },
    update: {},
    create: {
      id: "example_spell",
      name: "Example Spell",
      level: 0,
      school: "Evocation",
      ritual: false,
      data: {
        note: "Placeholder record created by prisma/seed.ts",
      },
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
