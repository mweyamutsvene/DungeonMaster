import { PrismaClient, Prisma } from "@prisma/client";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  monsterIdFromName,
  parseCreatureStatBlocksMarkdown,
} from "../src/content/rulebook/monsters-parser.js";

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

async function main(): Promise<void> {
  const docsRoot = getArg("--docsRoot");

  const resolvedDocsRoot = docsRoot
    ? path.resolve(process.cwd(), docsRoot)
    : path.resolve(process.cwd(), "..", "..", "RuleBookDocs", "markdown");

  const statBlocksPath = path.resolve(resolvedDocsRoot, "creature-stat-blocks.md");
  const markdown = await readFile(statBlocksPath, "utf8");

  const parsed = parseCreatureStatBlocksMarkdown(markdown);

  const prisma = new PrismaClient();

  try {
    console.log(`Parsed ${parsed.monsters.length} monster stat blocks`);

    const ops: Array<Promise<unknown>> = [];

    for (const monster of parsed.monsters) {
      const id = monsterIdFromName(monster.name);
      ops.push(
        prisma.monsterDefinition.upsert({
          where: { id },
          update: {
            name: monster.name,
            size: monster.size,
            kind: monster.kind,
            cr: monster.challengeRating ?? null,
            data: monster as unknown as Prisma.InputJsonValue,
          },
          create: {
            id,
            name: monster.name,
            size: monster.size,
            kind: monster.kind,
            cr: monster.challengeRating ?? null,
            data: monster as unknown as Prisma.InputJsonValue,
          },
        }),
      );
    }

    await Promise.all(ops);

    const counts = await prisma.monsterDefinition.count();
    console.log(`Imported MonsterDefinition rows: ${counts}`);
    console.log("Done.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
