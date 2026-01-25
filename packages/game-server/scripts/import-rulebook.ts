import { PrismaClient, Prisma } from "@prisma/client";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { parseEquipmentMarkdown } from "../src/content/rulebook/equipment-parser.js";
import { parseFeatsMarkdown } from "../src/content/rulebook/feats-parser.js";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

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

  const equipmentPath = path.resolve(resolvedDocsRoot, "equipment.md");
  const featsPath = path.resolve(resolvedDocsRoot, "feats.md");

  const [equipmentMd, featsMd] = await Promise.all([
    readFile(equipmentPath, "utf8"),
    readFile(featsPath, "utf8"),
  ]);

  const equipment = parseEquipmentMarkdown(equipmentMd);
  const feats = parseFeatsMarkdown(featsMd);

  const prisma = new PrismaClient();

  try {
    console.log(`Parsed ${equipment.weapons.length} weapons, ${equipment.armor.length} armor items`);
    console.log(`Parsed ${feats.feats.length} feats`);

    const ops: Array<Promise<unknown>> = [];

    for (const weapon of equipment.weapons) {
      const id = `weapon_${slugify(weapon.name)}`;
      ops.push(
        prisma.itemDefinition.upsert({
          where: { id },
          update: {
            name: weapon.name,
            category: "weapon",
            data: weapon as unknown as Prisma.InputJsonValue,
          },
          create: {
            id,
            name: weapon.name,
            category: "weapon",
            data: weapon as unknown as Prisma.InputJsonValue,
          },
        }),
      );
    }

    for (const armor of equipment.armor) {
      const id = `armor_${slugify(armor.name)}`;
      ops.push(
        prisma.itemDefinition.upsert({
          where: { id },
          update: {
            name: armor.name,
            category: "armor",
            data: armor as unknown as Prisma.InputJsonValue,
          },
          create: {
            id,
            name: armor.name,
            category: "armor",
            data: armor as unknown as Prisma.InputJsonValue,
          },
        }),
      );
    }

    for (const feat of feats.feats) {
      const id = `feat_${slugify(feat.name)}`;
      ops.push(
        prisma.itemDefinition.upsert({
          where: { id },
          update: {
            name: feat.name,
            category: "feat",
            data: feat as unknown as Prisma.InputJsonValue,
          },
          create: {
            id,
            name: feat.name,
            category: "feat",
            data: feat as unknown as Prisma.InputJsonValue,
          },
        }),
      );
    }

    await Promise.all(ops);

    const counts = await prisma.itemDefinition.groupBy({
      by: ["category"],
      _count: { _all: true },
      where: { category: { in: ["weapon", "armor", "feat"] } },
    });

    console.log("Imported counts:");
    for (const c of counts) {
      console.log(`- ${c.category}: ${c._count._all}`);
    }

    console.log("Done.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
