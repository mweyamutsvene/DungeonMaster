/**
 * Catalog Routes
 *
 * Read-only endpoints for server-side game content catalogs.
 *
 * Endpoints:
 * - GET /monsters - List monster definitions from the rulebook catalog
 */

import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { CANTRIP_CATALOG } from "../../../domain/entities/spells/catalog/cantrips.js";
import { LEVEL_1_CATALOG } from "../../../domain/entities/spells/catalog/level-1.js";
import { LEVEL_2_CATALOG } from "../../../domain/entities/spells/catalog/level-2.js";
import { LEVEL_3_CATALOG } from "../../../domain/entities/spells/catalog/level-3.js";
import { LEVEL_4_CATALOG } from "../../../domain/entities/spells/catalog/level-4.js";
import { LEVEL_5_CATALOG } from "../../../domain/entities/spells/catalog/level-5.js";

export interface CatalogRouteDeps {
  prismaClient?: PrismaClient;
}

/**
 * Map a raw ParsedMonsterStatBlock (from the rulebook importer) to a
 * session-compatible stat block that creature-hydration can read.
 */
function mapToSessionStatBlock(data: Record<string, unknown>): Record<string, unknown> {
  // abilityScores is the same shape in both
  const abilityScores = data.abilityScores ?? {
    strength: 10, dexterity: 10, constitution: 10,
    intelligence: 10, wisdom: 10, charisma: 10,
  };

  // HP: ParsedMonsterStatBlock uses hitPointsMax, session uses maxHp / hp
  const maxHp = (data.hitPointsMax as number | undefined)
    ?? (data.maxHp as number | undefined)
    ?? (data.hp as number | undefined)
    ?? 10;

  // AC: same field name
  const armorClass = (data.armorClass as number | undefined) ?? 10;

  // Speed: ParsedMonsterStatBlock uses speed.baseFeet; session uses number
  const speedRaw = data.speed;
  let speed: number;
  if (typeof speedRaw === "number") {
    speed = speedRaw;
  } else if (speedRaw && typeof speedRaw === "object" && "baseFeet" in speedRaw) {
    speed = (speedRaw as { baseFeet: number }).baseFeet;
  } else {
    speed = 30;
  }

  // Challenge rating
  const challengeRating = (data.challengeRating as number | undefined)
    ?? (data.cr as number | undefined)
    ?? 0;

  // Proficiency bonus
  const proficiencyBonus = (data.proficiencyBonus as number | undefined) ?? 2;

  // Attacks: map ParsedMonsterAttack to session attack format
  const rawAttacks = Array.isArray(data.attacks) ? data.attacks : [];
  const attacks = rawAttacks
    .filter((a: unknown) => a && typeof a === "object")
    .map((a: unknown) => {
      const atk = a as Record<string, unknown>;
      const dmg = atk.damage && typeof atk.damage === "object"
        ? atk.damage as Record<string, unknown>
        : null;
      return {
        name: atk.name ?? "Attack",
        kind: atk.kind ?? "melee",
        attackBonus: atk.attackBonus ?? 0,
        damage: dmg
          ? {
              diceCount: dmg.diceCount ?? 1,
              diceSides: dmg.diceSides ?? 4,
              modifier: dmg.modifier ?? 0,
            }
          : { diceCount: 1, diceSides: 4, modifier: 0 },
        // ParsedMonsterAttack uses damage.type; session uses damageType at attack level
        damageType: (dmg?.type as string | undefined) ?? (atk.damageType as string | undefined) ?? "bludgeoning",
        ...(atk.rangeFeet ? { rangeFeet: atk.rangeFeet } : {}),
      };
    });

  return {
    abilityScores,
    maxHp,
    hp: maxHp,
    armorClass,
    speed,
    challengeRating,
    proficiencyBonus,
    attacks,
  };
}

export function registerCatalogRoutes(app: FastifyInstance, deps: CatalogRouteDeps): void {
  /**
   * GET /monsters
   * List monster definitions from the rulebook catalog.
   *
   * Query params:
   * - search: filter by name (case-insensitive substring)
   * - limit:  max results to return (default 50, max 200)
   * - offset: pagination offset (default 0)
   */
  app.get<{
    Querystring: { search?: string; limit?: string; offset?: string };
  }>("/monsters", async (req) => {
    if (!deps.prismaClient) {
      // No database available (e.g., in-memory test mode)
      return { monsters: [], total: 0 };
    }

    const search = typeof req.query.search === "string" ? req.query.search.trim() : undefined;
    const limit = Math.min(Math.max(parseInt(req.query.limit ?? "50", 10) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset ?? "0", 10) || 0, 0);

    const where = search
      ? { name: { contains: search, mode: "insensitive" as const } }
      : {};

    const [defs, total] = await Promise.all([
      deps.prismaClient.monsterDefinition.findMany({
        where,
        orderBy: [{ cr: "asc" }, { name: "asc" }],
        take: limit,
        skip: offset,
        select: { id: true, name: true, cr: true, size: true, kind: true, data: true },
      }),
      deps.prismaClient.monsterDefinition.count({ where }),
    ]);

    const monsters = defs.map((def) => ({
      id: def.id,
      name: def.name,
      cr: def.cr,
      size: def.size,
      kind: def.kind,
      statBlock: mapToSessionStatBlock(def.data as Record<string, unknown>),
    }));

    return { monsters, total };
  });

  /**
   * GET /spells
   * Return all spells from the canonical spell catalog with metadata.
   * Used by the web client to enrich spell IDs with display info.
   */
  app.get("/spells", async () => {
    const allSpells = [
      ...CANTRIP_CATALOG,
      ...LEVEL_1_CATALOG,
      ...LEVEL_2_CATALOG,
      ...LEVEL_3_CATALOG,
      ...LEVEL_4_CATALOG,
      ...LEVEL_5_CATALOG,
    ];

    return {
      spells: allSpells.map((s) => ({
        id: s.name.toLowerCase(),
        name: s.name,
        level: s.level,
        school: s.school,
        castingTime: s.castingTime,
        description: s.description,
        classLists: [...s.classLists],
      })),
    };
  });
}
