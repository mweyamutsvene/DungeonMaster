import type { Prisma, PrismaClient } from "@prisma/client";

import type {
  IItemDefinitionRepository,
  ItemDefinitionUpsertInput,
} from "../../application/repositories/item-definition-repository.js";
import type { ItemDefinitionRecord } from "../../application/types.js";

/**
 * Prisma-backed access to runtime/custom item definitions.
 * Layer: Infrastructure (DB adapter).
 */
export class PrismaItemDefinitionRepository implements IItemDefinitionRepository {
  constructor(private readonly prisma: PrismaClient | Prisma.TransactionClient) {}

  async findById(id: string): Promise<ItemDefinitionRecord | null> {
    return this.prisma.itemDefinition.findUnique({ where: { id } });
  }

  async findByName(name: string): Promise<ItemDefinitionRecord | null> {
    return this.prisma.itemDefinition.findUnique({ where: { name } });
  }

  async listAll(): Promise<ItemDefinitionRecord[]> {
    return this.prisma.itemDefinition.findMany({
      orderBy: { name: "asc" },
    });
  }

  async upsert(item: ItemDefinitionUpsertInput): Promise<ItemDefinitionRecord> {
    return this.prisma.itemDefinition.upsert({
      where: { id: item.id },
      create: {
        id: item.id,
        name: item.name,
        category: item.category,
        data: item.data as Prisma.InputJsonValue,
      },
      update: {
        name: item.name,
        category: item.category,
        data: item.data as Prisma.InputJsonValue,
      },
    });
  }
}
