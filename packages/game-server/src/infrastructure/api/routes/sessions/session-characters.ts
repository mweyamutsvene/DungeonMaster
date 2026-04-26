/**
 * Session Characters Routes
 *
 * Handles character management within a session.
 *
 * Endpoints:
 * - POST /sessions/:id/characters - Add a character to a session
 * - DELETE /sessions/:id/characters/:characterId - Remove a character from a session
 * - POST /sessions/:id/characters/generate - Generate a character via LLM
 * - POST /sessions/:id/rest/begin - Begin a rest (records start time for interruption detection)
 * - POST /sessions/:id/rest - Take a short or long rest (refreshes resources)
 */

import type { FastifyInstance } from "fastify";
import type { SessionRouteDeps } from "./types.js";
import { NotFoundError, ValidationError } from "../../../../application/errors.js";
import { breakConcentration, getConcentrationSpellName } from "../../../../application/services/combat/helpers/concentration-helper.js";
import { validateASIChoice, type ASIChoice } from "../../../../domain/rules/ability-score-improvement.js";
import { getMaxPreparedSpells, getSpellCasterType, isSpellAvailable } from "../../../../domain/rules/spell-preparation.js";
import { getSpellcastingAbility } from "../../../../domain/rules/spell-casting.js";

export function registerSessionCharacterRoutes(app: FastifyInstance, deps: SessionRouteDeps): void {
  /**
   * POST /sessions/:id/characters
   * Add a character with a provided sheet to the session.
   */
  app.post<{
    Params: { id: string };
    Body: {
      name: string;
      level: number;
      className?: string | null;
      sheet: unknown;
      background?: string;
      asiChoice?: Record<string, number>;
      languageChoice?: string;
    };
  }>("/sessions/:id/characters", async (req) => {
    const sessionId = req.params.id;

    const input = {
      name: req.body.name,
      level: req.body.level,
      className: req.body.className ?? null,
      sheet: req.body.sheet,
      background: req.body.background,
      asiChoice: req.body.asiChoice,
      languageChoice: req.body.languageChoice,
    };

    if (deps.unitOfWork) {
      return deps.unitOfWork.run(async (repos) => {
        const services = deps.createServicesForRepos(repos);
        return services.characters.addCharacter(sessionId, input);
      });
    }

    return deps.characters.addCharacter(sessionId, input);
  });

  /**
   * DELETE /sessions/:id/characters/:characterId
   * Remove a character from the session.
   */
  app.delete<{
    Params: { id: string; characterId: string };
  }>("/sessions/:id/characters/:characterId", async (req) => {
    const sessionId = req.params.id;
    await deps.sessions.getSessionOrThrow(sessionId);

    const character = await deps.charactersRepo.getById(req.params.characterId);
    if (!character || character.sessionId !== sessionId) {
      throw new NotFoundError(`Character ${req.params.characterId} not found in session ${sessionId}`);
    }

    await deps.charactersRepo.delete(req.params.characterId);
    return { deleted: true };
  });

  /**
   * POST /sessions/:id/characters/generate
   * Generate a character sheet via LLM or use a provided sheet.
   */
  app.post<{
    Params: { id: string };
    Body: { name: string; className: string; level?: number; sheet?: unknown; seed?: number };
  }>("/sessions/:id/characters/generate", async (req) => {
    const sessionId = req.params.id;

    const name = req.body.name;
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      throw new ValidationError("name is required");
    }

    const className = req.body.className;
    if (!className || typeof className !== "string" || className.trim().length === 0) {
      throw new ValidationError("className is required");
    }

    const level = req.body.level ?? 1;
    const seed = req.body.seed;

    // If sheet provided, use it directly; otherwise generate via LLM
    let sheet = req.body.sheet;
    if (!sheet && deps.characterGenerator) {
      sheet = await deps.characterGenerator.generateCharacter({
        className,
        level,
        seed,
      });
    }

    if (!sheet) {
      throw new ValidationError("No character sheet provided and no character generator available");
    }

    const input = {
      name,
      level,
      className,
      sheet,
    };

    if (deps.unitOfWork) {
      return deps.unitOfWork.run(async (repos) => {
        const services = deps.createServicesForRepos(repos);
        return services.characters.addCharacter(sessionId, input);
      });
    }

    return deps.characters.addCharacter(sessionId, input);
  });

  /**
   * POST /sessions/:id/rest/begin
   * Begin a rest for the session. Records the start time via a RestStarted event so
   * that interruptions (combat started, damage taken during long rest) can be detected
   * when the rest completes via POST /sessions/:id/rest.
   *
   * Returns { restId, restType, startedAt } — pass `startedAt` back to /rest to
   * enable interruption detection.
   */
  app.post<{
    Params: { id: string };
    Body: { type: "short" | "long" };
  }>("/sessions/:id/rest/begin", async (req) => {
    const sessionId = req.params.id;
    const { type: restType } = req.body;

    if (!restType || (restType !== "short" && restType !== "long")) {
      throw new ValidationError("Rest type must be 'short' or 'long'");
    }

    return deps.characters.beginRest(sessionId, restType);
  });

  /**
   * POST /sessions/:id/rest
   * Take a short or long rest for all characters in the session.
   * Refreshes class resource pools; long rest also restores HP.
   * Optional hitDiceSpending: { [characterId]: count } to spend Hit Dice on short rest.
   * Optional restStartedAt: ISO timestamp from POST /rest/begin — if provided, checks
   * for combat or damage interruptions since that time. Returns { interrupted: true } if
   * the rest was interrupted without applying any benefits.
   */
  app.post<{
    Params: { id: string };
    Body: { type: "short" | "long"; hitDiceSpending?: Record<string, number>; restStartedAt?: string; arcaneRecovery?: Record<string, Record<number, number>> };
  }>("/sessions/:id/rest", async (req) => {
    const sessionId = req.params.id;
    const { type: restType, hitDiceSpending, restStartedAt, arcaneRecovery } = req.body;

    if (!restType || (restType !== "short" && restType !== "long")) {
      throw new ValidationError("Rest type must be 'short' or 'long'");
    }

    const startedAt = restStartedAt ? new Date(restStartedAt) : undefined;

    let result: Awaited<ReturnType<typeof deps.characters.takeSessionRest>>;

    if (deps.unitOfWork) {
      result = await deps.unitOfWork.run(async (repos) => {
        const services = deps.createServicesForRepos(repos);
        return services.characters.takeSessionRest(sessionId, restType, hitDiceSpending, startedAt, arcaneRecovery);
      });
    } else {
      result = await deps.characters.takeSessionRest(sessionId, restType, hitDiceSpending, startedAt, arcaneRecovery);
    }

    // Clear concentration on all combatants in any active encounter (D&D 5e: rest ends concentration)
    if (!result.interrupted) {
      const activeEncounter = await deps.combatRepo.findActiveEncounter(sessionId);
      if (activeEncounter) {
        const combatants = await deps.combatRepo.listCombatants(activeEncounter.id);
        for (const c of combatants) {
          if (getConcentrationSpellName(c.resources)) {
            await breakConcentration(c, activeEncounter.id, deps.combatRepo);
          }
        }
      }
    }

    return result;
  });

  /**
   * PATCH /sessions/:id/characters/:characterId
   * Update character data: ASI choices, skill proficiencies, skill expertise, prepared/known spells.
   * Validates ASI rules (correct levels, no score > 20, etc).
   * Validates spell preparation limits for prepared casters.
   */
  app.patch<{
    Params: { id: string; characterId: string };
    Body: {
      asiChoices?: ASIChoice[];
      skillProficiencies?: string[];
      skillExpertise?: string[];
      preparedSpells?: string[];
      knownSpells?: string[];
    };
  }>("/sessions/:id/characters/:characterId", async (req) => {
    const sessionId = req.params.id;
    const characterId = req.params.characterId;

    await deps.sessions.getSessionOrThrow(sessionId);
    const character = await deps.charactersRepo.getById(characterId);
    if (!character || character.sessionId !== sessionId) {
      throw new NotFoundError(`Character ${characterId} not found in session ${sessionId}`);
    }

    const sheet = (character.sheet as Record<string, unknown>) ?? {};
    const updatedSheet: Record<string, unknown> = { ...sheet };

    // --- ASI Choices ---
    if (req.body.asiChoices !== undefined) {
      const classId = (sheet.classId as string) ?? character.className?.toLowerCase() ?? "";
      const baseScores = (sheet.abilityScores as Record<string, number>) ?? {};

      for (const choice of req.body.asiChoices) {
        const error = validateASIChoice(choice, classId, baseScores);
        if (error) throw new ValidationError(`Invalid ASI choice: ${error}`);
      }

      updatedSheet.asiChoices = req.body.asiChoices;
    }

    // --- Skill Proficiencies ---
    if (req.body.skillProficiencies !== undefined) {
      if (!Array.isArray(req.body.skillProficiencies)) {
        throw new ValidationError("skillProficiencies must be an array of strings");
      }
      updatedSheet.skillProficiencies = req.body.skillProficiencies;
    }

    // --- Skill Expertise ---
    if (req.body.skillExpertise !== undefined) {
      if (!Array.isArray(req.body.skillExpertise)) {
        throw new ValidationError("skillExpertise must be an array of strings");
      }
      // Expertise must be a subset of proficiencies
      const profs = (req.body.skillProficiencies ?? updatedSheet.skillProficiencies ?? []) as string[];
      for (const skill of req.body.skillExpertise) {
        if (!profs.includes(skill)) {
          throw new ValidationError(`Expertise in '${skill}' requires proficiency in that skill`);
        }
      }
      updatedSheet.skillExpertise = req.body.skillExpertise;
    }

    // --- Prepared Spells ---
    if (req.body.preparedSpells !== undefined) {
      if (!Array.isArray(req.body.preparedSpells)) {
        throw new ValidationError("preparedSpells must be an array of spell IDs");
      }
      const classId = (sheet.classId as string) ?? character.className?.toLowerCase() ?? "";
      const casterType = getSpellCasterType(classId);

      if (casterType === "prepared" && req.body.preparedSpells.length > 0) {
        const spellAbility = getSpellcastingAbility(classId);
        const abilityScores = (sheet.abilityScores as Record<string, number>) ?? {};
        const score = abilityScores[spellAbility] ?? 10;
        const abilityMod = Math.floor((score - 10) / 2);
        const maxPrepared = getMaxPreparedSpells(classId, character.level, abilityMod);

        if (req.body.preparedSpells.length > maxPrepared) {
          throw new ValidationError(
            `Too many prepared spells: ${req.body.preparedSpells.length} exceeds maximum of ${maxPrepared} for level ${character.level} ${classId}`
          );
        }
      }

      updatedSheet.preparedSpells = req.body.preparedSpells;
    }

    // --- Known Spells ---
    if (req.body.knownSpells !== undefined) {
      if (!Array.isArray(req.body.knownSpells)) {
        throw new ValidationError("knownSpells must be an array of spell IDs");
      }
      updatedSheet.knownSpells = req.body.knownSpells;
    }

    const updated = await deps.charactersRepo.updateSheet(characterId, updatedSheet);
    return updated;
  });

  /**
   * GET /sessions/:id/characters/:characterId/spells
   * Get spell management info: caster type, prepared/known lists, max slots.
   */
  app.get<{
    Params: { id: string; characterId: string };
  }>("/sessions/:id/characters/:characterId/spells", async (req) => {
    const sessionId = req.params.id;
    const characterId = req.params.characterId;

    await deps.sessions.getSessionOrThrow(sessionId);
    const character = await deps.charactersRepo.getById(characterId);
    if (!character || character.sessionId !== sessionId) {
      throw new NotFoundError(`Character ${characterId} not found in session ${sessionId}`);
    }

    const sheet = (character.sheet as Record<string, unknown>) ?? {};
    const classId = (sheet.classId as string) ?? character.className?.toLowerCase() ?? "";
    const casterType = getSpellCasterType(classId);
    const spellAbility = getSpellcastingAbility(classId);
    const abilityScores = (sheet.abilityScores as Record<string, number>) ?? {};
    const score = abilityScores[spellAbility] ?? 10;
    const abilityMod = Math.floor((score - 10) / 2);
    const maxPrepared = getMaxPreparedSpells(classId, character.level, abilityMod);
    const preparedSpells = Array.isArray(sheet.preparedSpells) ? sheet.preparedSpells as string[] : [];
    const knownSpells = Array.isArray(sheet.knownSpells) ? sheet.knownSpells as string[] : [];

    return {
      classId,
      casterType,
      spellcastingAbility: spellAbility,
      maxPreparedSpells: maxPrepared,
      preparedSpells,
      knownSpells,
    };
  });
}
