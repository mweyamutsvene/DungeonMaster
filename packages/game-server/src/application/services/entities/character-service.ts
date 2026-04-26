import { nanoid } from "nanoid";

import { NotFoundError, ValidationError } from "../../errors.js";
import type { ICharacterRepository } from "../../repositories/character-repository.js";
import type { IEventRepository } from "../../repositories/event-repository.js";
import type { IGameSessionRepository } from "../../repositories/game-session-repository.js";
import type { CharacterUpdateData } from "../../repositories/character-repository.js";
import type { JsonValue, SessionCharacterRecord } from "../../types.js";
import { refreshClassResourcePools, spendHitDice, recoverHitDice, detectRestInterruption, type RestType, type RestInterruptionReason } from "../../../domain/rules/rest.js";
import type { DiceRoller } from "../../../domain/rules/dice-roller.js";
import type { ResourcePool } from "../../../domain/entities/combat/resource-pool.js";
import { isCharacterClassId, type CharacterClassId } from "../../../domain/entities/classes/class-definition.js";
import { getClassDefinition } from "../../../domain/entities/classes/registry.js";
import { validateArcaneRecovery } from "../../../domain/entities/classes/wizard.js";
import { enrichSheetAttacks } from "../../../domain/entities/items/weapon-catalog.js";
import { enrichSheetArmor } from "../../../domain/entities/items/armor-catalog.js";
import { enrichSheetClassFeatures } from "../../../domain/entities/classes/class-feature-enrichment.js";
import type { AbilityScoresData } from "../../../domain/entities/core/ability-scores.js";
import { getBackgroundDefinition } from "../../../domain/entities/backgrounds/registry.js";
import type { AbilityScore, BackgroundAsiChoice } from "../../../domain/entities/backgrounds/types.js";

const ABILITY_KEYS: readonly AbilityScore[] = [
  "strength",
  "dexterity",
  "constitution",
  "intelligence",
  "wisdom",
  "charisma",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toAbilityScores(value: unknown): AbilityScoresData {
  const scores = isRecord(value) ? value : {};
  const normalized: AbilityScoresData = {
    strength: Number(scores.strength ?? 10),
    dexterity: Number(scores.dexterity ?? 10),
    constitution: Number(scores.constitution ?? 10),
    intelligence: Number(scores.intelligence ?? 10),
    wisdom: Number(scores.wisdom ?? 10),
    charisma: Number(scores.charisma ?? 10),
  };

  for (const key of ABILITY_KEYS) {
    if (!Number.isFinite(normalized[key])) {
      throw new ValidationError(`Invalid ability score for ${key}`);
    }
  }

  return normalized;
}

function validateAndApplyBackgroundAsi(params: {
  baseScores: AbilityScoresData;
  asiChoice: BackgroundAsiChoice | undefined;
  backgroundAbilities: readonly AbilityScore[];
}): AbilityScoresData {
  const { baseScores, asiChoice, backgroundAbilities } = params;
  if (!asiChoice) {
    throw new ValidationError("Background ASI choice is required when background is provided");
  }

  const entries = Object.entries(asiChoice).filter((entry): entry is [AbilityScore, number] =>
    typeof entry[1] === "number" && entry[1] > 0,
  );

  if (entries.length !== 3) {
    throw new ValidationError("Background ASI must include exactly three ability entries");
  }

  const allowed = new Set(backgroundAbilities);
  let ones = 0;
  let twos = 0;
  let total = 0;

  for (const [ability, increase] of entries) {
    if (!allowed.has(ability)) {
      throw new ValidationError(`Background ASI cannot increase ${ability} for this background`);
    }
    if (!Number.isInteger(increase) || (increase !== 1 && increase !== 2)) {
      throw new ValidationError(`Background ASI increase for ${ability} must be 1 or 2`);
    }
    if (increase === 1) ones += 1;
    if (increase === 2) twos += 1;
    total += increase;
  }

  const isSplit = total === 4 && twos === 1 && ones === 2;
  const isThreeOnes = total === 3 && twos === 0 && ones === 3;
  if (!isSplit && !isThreeOnes) {
    throw new ValidationError("Background ASI must be +2/+1/+1 or +1/+1/+1 across the background abilities");
  }

  const next: AbilityScoresData = { ...baseScores };
  for (const [ability, increase] of entries) {
    const after = next[ability] + increase;
    if (after > 20) {
      throw new ValidationError(`Background ASI would raise ${ability} above 20`);
    }
    next[ability] = after;
  }
  return next;
}

function mergeUniqueStrings(existing: unknown, additions: readonly string[]): string[] {
  const base = Array.isArray(existing) ? existing.filter((entry): entry is string => typeof entry === "string") : [];
  const merged = new Set(base);
  for (const value of additions) merged.add(value);
  return [...merged];
}

function mergeBackgroundEquipment(sheet: Record<string, unknown>, equipment: readonly { name: string; quantity: number }[]): void {
  const existing = Array.isArray(sheet.inventory) ? [...sheet.inventory] : [];

  for (const item of equipment) {
    const index = existing.findIndex((entry) => {
      if (!isRecord(entry)) return false;
      const name = entry.name;
      return typeof name === "string" && name.toLowerCase() === item.name.toLowerCase();
    });

    if (index >= 0) {
      const current = existing[index];
      if (!isRecord(current)) continue;
      const currentQty = typeof current.quantity === "number" ? current.quantity : 1;
      existing[index] = { ...current, quantity: currentQty + item.quantity };
      continue;
    }

    existing.push({
      name: item.name,
      quantity: item.quantity,
      equipped: false,
      attuned: false,
    });
  }

  sheet.inventory = existing;
}

function applyBackgroundPipeline(params: {
  sheet: Record<string, unknown>;
  backgroundId: string;
  asiChoice?: BackgroundAsiChoice;
  languageChoice?: string;
}): Record<string, unknown> {
  const background = getBackgroundDefinition(params.backgroundId);
  const baseScores = toAbilityScores(params.sheet.abilityScores);
  const adjustedScores = validateAndApplyBackgroundAsi({
    baseScores,
    asiChoice: params.asiChoice,
    backgroundAbilities: background.abilityScoreOptions,
  });

  const nextSheet: Record<string, unknown> = {
    ...params.sheet,
    background: background.id,
    abilityScores: adjustedScores,
    featIds: mergeUniqueStrings(params.sheet.featIds, [background.originFeat]),
    skillProficiencies: mergeUniqueStrings(params.sheet.skillProficiencies, [...background.skillProficiencies]),
    toolProficiencies: mergeUniqueStrings(params.sheet.toolProficiencies, [background.toolProficiency]),
  };

  const languageToAdd = background.language === "any"
    ? params.languageChoice?.trim()
    : background.language;
  if (languageToAdd) {
    nextSheet.languages = mergeUniqueStrings(params.sheet.languages, [languageToAdd]);
  }

  mergeBackgroundEquipment(nextSheet, background.startingEquipment);
  return nextSheet;
}

/**
 * Character CRUD for a given game session.
 * Layer: Application.
 * Notes: Validates inputs and emits game events via `IEventRepository` when configured.
 */
export class CharacterService {
  constructor(
    private readonly sessions: IGameSessionRepository,
    private readonly characters: ICharacterRepository,
    private readonly events?: IEventRepository,
    private readonly diceRoller?: DiceRoller,
  ) {}

  async addCharacter(
    sessionId: string,
    input: {
      name: string;
      level: number;
      className?: string | null;
      sheet: JsonValue;
      id?: string;
      classLevels?: Array<{ classId: string; level: number; subclass?: string }>;
      background?: string;
      asiChoice?: BackgroundAsiChoice;
      languageChoice?: string;
    },
  ): Promise<SessionCharacterRecord> {
    const session = await this.sessions.getById(sessionId);
    if (!session) throw new NotFoundError(`Session not found: ${sessionId}`);

    if (!input.name.trim()) throw new ValidationError("Character name is required");
    if (!Number.isInteger(input.level) || input.level < 1 || input.level > 20) {
      throw new ValidationError("Character level must be 1-20");
    }

    // Validate className against class registry
    if (input.className) {
      const classId = input.className.toLowerCase();
      if (!isCharacterClassId(classId)) {
        throw new ValidationError(`Unknown character class: "${input.className}". Valid classes can be found in the class registry.`);
      }
    }

    const id = input.id ?? nanoid();

    // Enrich sheet with canonical weapon properties and armor metadata from catalogs
    let sheet = input.sheet;
    if (isRecord(sheet)) {
      let nextSheet = { ...sheet };
      if (input.background) {
        nextSheet = applyBackgroundPipeline({
          sheet: nextSheet,
          backgroundId: input.background,
          asiChoice: input.asiChoice,
          languageChoice: input.languageChoice,
        });
      }

      sheet = enrichSheetClassFeatures(
        enrichSheetArmor(enrichSheetAttacks(nextSheet)),
        input.level,
        input.className ?? null,
      );
    }

    // Store classLevels in sheet JSON when provided (multiclass support)
    if (input.classLevels && input.classLevels.length > 0 && typeof sheet === "object" && sheet !== null) {
      (sheet as Record<string, unknown>).classLevels = input.classLevels;
    }

    const created = await this.characters.createInSession(sessionId, {
      id,
      name: input.name,
      level: input.level,
      className: input.className ?? null,
      sheet,
    });

    if (this.events) {
      await this.events.append(sessionId, {
        id: nanoid(),
        type: "CharacterAdded",
        payload: { characterId: id, name: input.name, level: input.level },
      });
    }

    return created;
  }

  async listCharacters(sessionId: string): Promise<SessionCharacterRecord[]> {
    const session = await this.sessions.getById(sessionId);
    if (!session) throw new NotFoundError(`Session not found: ${sessionId}`);
    return this.characters.listBySession(sessionId);
  }

  async getCharacterOrThrow(id: string): Promise<SessionCharacterRecord> {
    const character = await this.characters.getById(id);
    if (!character) throw new NotFoundError(`Character not found: ${id}`);
    return character;
  }

  async updateCharacter(
    sessionId: string,
    characterId: string,
    data: CharacterUpdateData,
  ): Promise<SessionCharacterRecord> {
    const session = await this.sessions.getById(sessionId);
    if (!session) throw new NotFoundError(`Session not found: ${sessionId}`);

    const character = await this.characters.getById(characterId);
    if (!character) throw new NotFoundError(`Character not found: ${characterId}`);
    if (character.sessionId !== sessionId) {
      throw new ValidationError(`Character ${characterId} does not belong to session ${sessionId}`);
    }

    const updated = await this.characters.update(characterId, data);

    if (this.events) {
      await this.events.append(sessionId, {
        id: nanoid(),
        type: "CharacterUpdated",
        payload: { characterId, name: updated.name },
      });
    }

    return updated;
  }

  async deleteCharacter(sessionId: string, characterId: string): Promise<void> {
    const session = await this.sessions.getById(sessionId);
    if (!session) throw new NotFoundError(`Session not found: ${sessionId}`);

    const character = await this.characters.getById(characterId);
    if (!character) throw new NotFoundError(`Character not found: ${characterId}`);
    if (character.sessionId !== sessionId) {
      throw new ValidationError(`Character ${characterId} does not belong to session ${sessionId}`);
    }

    await this.characters.delete(characterId);

    if (this.events) {
      await this.events.append(sessionId, {
        id: nanoid(),
        type: "CharacterDeleted",
        payload: { characterId, name: character.name },
      });
    }
  }

  /**
   * Begin a rest for a session. Records the start time via a `RestStarted` event
   * so that interruptions (combat, damage) can be detected when the rest completes.
   *
   * Returns the restId and startedAt timestamp that must be passed to `takeSessionRest()`
   * to enable interruption detection.
   */
  async beginRest(
    sessionId: string,
    restType: RestType,
  ): Promise<{ restId: string; restType: RestType; startedAt: Date }> {
    const session = await this.sessions.getById(sessionId);
    if (!session) throw new NotFoundError(`Session not found: ${sessionId}`);

    const restId = nanoid();
    const startedAt = new Date();

    if (this.events) {
      await this.events.append(sessionId, {
        id: nanoid(),
        type: "RestStarted",
        payload: { restType, restId },
      });
    }

    return { restId, restType, startedAt };
  }

  /**
   * Take a short or long rest for all characters in a session.
   * Refreshes class resource pools and (on long rest) restores HP.
   * On short rest, optionally spend Hit Dice to recover HP.
   * On long rest, recover spent Hit Dice (half total, rounded down, min 1).
   *
   * If `restStartedAt` is provided (from `beginRest()`), checks the event log for
   * interruptions (combat or damage) since that time. If interrupted, returns
   * `{ interrupted: true, interruptedBy }` without applying any rest benefits.
   */
  async takeSessionRest(
    sessionId: string,
    restType: RestType,
    hitDiceSpending?: Record<string, number>,
    restStartedAt?: Date,
    arcaneRecovery?: Record<string, Record<number, number>>,
  ): Promise<{
    interrupted?: boolean;
    interruptedBy?: RestInterruptionReason;
    characters: Array<{ id: string; name: string; poolsRefreshed: string[]; hitDiceSpent?: number; hpRecovered?: number; arcaneRecoverySlots?: Record<number, number> }>;
  }> {
    const session = await this.sessions.getById(sessionId);
    if (!session) throw new NotFoundError(`Session not found: ${sessionId}`);

    // Check for rest interruption if a start timestamp was provided
    if (restStartedAt && this.events) {
      const eventsSince = await this.events.listBySession(sessionId, { since: restStartedAt });
      const check = detectRestInterruption(restType, eventsSince);
      if (check.interrupted) {
        return { interrupted: true, interruptedBy: check.reason, characters: [] };
      }
    }

    const characters = await this.characters.listBySession(sessionId);
    const results: Array<{ id: string; name: string; poolsRefreshed: string[]; hitDiceSpent?: number; hpRecovered?: number; arcaneRecoverySlots?: Record<number, number> }> = [];

    // Collect all sheet updates, then flush in parallel for crash safety.
    // When called inside PrismaUnitOfWork.run(), these all execute within the same
    // Prisma transaction. Outside UoW, Promise.all() ensures fail-fast behavior.
    const pendingUpdates: Array<{ charId: string; sheet: JsonValue }> = [];

    for (const char of characters) {
      const sheet = (char.sheet as Record<string, unknown>) ?? {};
      const className = char.className ?? (sheet.className as string | undefined) ?? "";
      const level = char.level ?? 1;
      const pools: ResourcePool[] = Array.isArray(sheet.resourcePools)
        ? (sheet.resourcePools as ResourcePool[])
        : [];

      // Refresh class resource pools
      const abilityScores = sheet.abilityScores as Partial<AbilityScoresData> | undefined;
      const charismaScore = abilityScores?.charisma ?? 10;
      const charismaMod = Math.floor((charismaScore - 10) / 2);
      const wisdomScore = abilityScores?.wisdom ?? 10;
      const wisdomMod = Math.floor((wisdomScore - 10) / 2);
      const beforePools = pools.map(p => ({ ...p }));
      const refreshedPools = refreshClassResourcePools({
        classId: className.toLowerCase() as CharacterClassId,
        level,
        rest: restType,
        pools,
        charismaModifier: charismaMod,
        wisdomModifier: wisdomMod,
      });

      // Track which pools were refreshed
      const poolsRefreshed: string[] = [];
      for (let i = 0; i < refreshedPools.length; i++) {
        if (refreshedPools[i] && beforePools[i] && refreshedPools[i].current !== beforePools[i].current) {
          poolsRefreshed.push(refreshedPools[i].name);
        }
      }

      // Build updated sheet
      const updatedSheet: Record<string, unknown> = {
        ...sheet,
        resourcePools: refreshedPools,
      };

      let hitDiceSpent: number | undefined;
      let hpRecovered: number | undefined;

      // Resolve hit die info from class definition
      const classId = className.toLowerCase() as CharacterClassId;
      const classDef = className ? getClassDefinition(classId) : undefined;
      const hitDie = classDef?.hitDie ?? 8;
      const totalHitDice = level;
      const currentHitDiceRemaining = typeof sheet.hitDiceRemaining === "number"
        ? sheet.hitDiceRemaining
        : totalHitDice; // Default to full if not tracked yet

      if (restType === "short" && hitDiceSpending && hitDiceSpending[char.id] && this.diceRoller) {
        // Short rest: spend Hit Dice to recover HP
        const count = hitDiceSpending[char.id];
        const conScore = (sheet.abilityScores as Partial<AbilityScoresData> | undefined)?.constitution ?? 10;
        const conMod = Math.floor((conScore - 10) / 2);
        const currentHp = (sheet.currentHp as number) ?? (sheet.maxHp as number) ?? 10;
        const maxHp = (sheet.maxHp as number) ?? currentHp;

        const result = spendHitDice({
          hitDiceRemaining: currentHitDiceRemaining,
          hitDie,
          conModifier: conMod,
          count,
          currentHp,
          maxHp,
          diceRoller: this.diceRoller,
        });

        updatedSheet.currentHp = result.newHp;
        updatedSheet.hitDiceRemaining = result.hitDiceRemaining;
        hitDiceSpent = currentHitDiceRemaining - result.hitDiceRemaining;
        hpRecovered = result.hpRecovered;
      } else if (restType === "long") {
        // Long rest: restore HP to max and recover Hit Dice
        const maxHp = (sheet.maxHp as number) ?? (sheet.currentHp as number) ?? 10;
        updatedSheet.currentHp = maxHp;
        updatedSheet.hitDiceRemaining = recoverHitDice(currentHitDiceRemaining, totalHitDice);
      }

      // Arcane Recovery (Wizard L1, short rest only, once per long rest).
      // Apply AFTER pool refresh so spellSlot_* current values reflect pre-refund state.
      let arcaneRecoverySlots: Record<number, number> | undefined;
      if (restType === "short" && arcaneRecovery && arcaneRecovery[char.name]) {
        if (className.toLowerCase() !== "wizard") {
          throw new ValidationError(`Arcane Recovery: character "${char.name}" is not a Wizard`);
        }
        const validation = validateArcaneRecovery(level, arcaneRecovery[char.name]);
        if (!validation.ok) {
          throw new ValidationError(validation.error);
        }
        // Find arcaneRecovery pool on the (refreshed) pools list; short rest does not refresh it.
        const arcanePoolIdx = refreshedPools.findIndex(p => p.name === "arcaneRecovery");
        if (arcanePoolIdx === -1) {
          throw new ValidationError(`Arcane Recovery: pool not found on character "${char.name}"`);
        }
        const arcanePool = refreshedPools[arcanePoolIdx];
        if (arcanePool.current < 1) {
          throw new ValidationError(`Arcane Recovery: already used since last long rest (character "${char.name}")`);
        }
        // Apply: spend 1 from arcaneRecovery pool, increment requested spellSlot_N pools.
        const refundMap: Record<number, number> = {};
        const mutatedPools = [...refreshedPools];
        mutatedPools[arcanePoolIdx] = { ...arcanePool, current: arcanePool.current - 1 };
        if (!poolsRefreshed.includes("arcaneRecovery")) poolsRefreshed.push("arcaneRecovery");
        for (const [slotLevelStr, count] of Object.entries(arcaneRecovery[char.name])) {
          const slotLevel = Number(slotLevelStr);
          const countNum = Number(count);
          if (countNum <= 0) continue;
          const slotName = `spellSlot_${slotLevel}`;
          const slotIdx = mutatedPools.findIndex(p => p.name === slotName);
          if (slotIdx === -1) {
            throw new ValidationError(`Arcane Recovery: character "${char.name}" has no ${slotName}`);
          }
          const slot = mutatedPools[slotIdx];
          const newCurrent = slot.current + countNum;
          if (newCurrent > slot.max) {
            throw new ValidationError(`Arcane Recovery: ${slotName} would exceed max (${slot.current} + ${countNum} > ${slot.max})`);
          }
          mutatedPools[slotIdx] = { ...slot, current: newCurrent };
          refundMap[slotLevel] = countNum;
          if (!poolsRefreshed.includes(slotName)) poolsRefreshed.push(slotName);
        }
        updatedSheet.resourcePools = mutatedPools;
        arcaneRecoverySlots = refundMap;
      }

      pendingUpdates.push({ charId: char.id, sheet: updatedSheet as JsonValue });
      results.push({ id: char.id, name: char.name, poolsRefreshed, hitDiceSpent, hpRecovered, arcaneRecoverySlots });
    }

    // Flush all character sheet updates in parallel (fail-fast on any error)
    await Promise.all(
      pendingUpdates.map(u => this.characters.updateSheet(u.charId, u.sheet)),
    );

    if (this.events) {
      await this.events.append(sessionId, {
        id: nanoid(),
        type: "RestCompleted",
        payload: { restType, characters: results.map(r => ({ id: r.id, name: r.name })) },
      });
    }

    return { characters: results };
  }
}
