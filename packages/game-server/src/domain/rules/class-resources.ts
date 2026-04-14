import type { ResourcePool } from "../entities/combat/resource-pool.js";
import type { CharacterClassId } from "../entities/classes/class-definition.js";
import { getClassDefinition } from "../entities/classes/registry.js";

export interface DefaultResourcePoolsOptions {
  classId: CharacterClassId;
  level: number;

  /**
   * Needed for Bardic Inspiration uses.
   */
  charismaModifier?: number;
}

export function defaultResourcePoolsForClass(options: DefaultResourcePoolsOptions): ResourcePool[] {
  const { classId, level } = options;
  const def = getClassDefinition(classId);
  if (!def.resourcesAtLevel) return [];

  const abilityModifiers: Record<string, number> | undefined =
    options.charismaModifier !== undefined ? { charisma: options.charismaModifier } : undefined;

  return [...def.resourcesAtLevel(level, abilityModifiers)];
}
