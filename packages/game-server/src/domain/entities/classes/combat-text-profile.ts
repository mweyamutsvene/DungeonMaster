/**
 * ClassCombatTextProfile — Scalable class-specific combat text matching.
 *
 * Each D&D class defines a profile that maps text patterns to ability IDs.
 * This eliminates hardcoded class-specific maps scattered across the tabletop
 * service layer, making it trivial to add new classes without modifying
 * parsers or dispatchers.
 *
 * To add a new class's combat abilities:
 *   1. Define a ClassCombatTextProfile in the class's domain file (e.g. paladin.ts)
 *   2. Register it in registry.ts via getAllCombatTextProfiles()
 *   3. Done — the text parser and action dispatcher use profiles automatically.
 */

// ----- Types -----

/** Action economy categories that determine which handler receives the action. */
export type CombatActionCategory = "bonusAction" | "classAction";

/**
 * Maps a text pattern to an AbilityRegistry executor ID.
 * Used to route class-specific bonus actions and class actions from text input.
 */
export interface ClassActionMapping {
  /** Internal keyword identifier (e.g. "flurry-of-blows"). */
  keyword: string;
  /** Regex patterns matched against normalized text (lowercase, alphanumeric only). */
  normalizedPatterns: readonly RegExp[];
  /** AbilityRegistry executor ID to route to (e.g. "class:monk:flurry-of-blows"). */
  abilityId: string;
  /** Whether this is a bonus action or a class action (free/special). */
  category: CombatActionCategory;
}

// ----- Attack Reaction Definitions -----

/**
 * Input provided to attack reaction detectors.
 * Contains everything needed to decide whether a reaction is eligible.
 */
export interface AttackReactionInput {
  /** Target's class name (lowercase, e.g. "monk", "wizard"). Empty string if unknown. */
  className: string;
  /** Target's level. */
  level: number;
  /** Target's ability scores. */
  abilityScores: Record<string, number>;
  /** Target's combat resources (resource pools, flags, etc.). */
  resources: Record<string, unknown>;
  /** Whether the target has their reaction available. */
  hasReaction: boolean;
  /** Whether the target is a player character. */
  isCharacter: boolean;
  /** The incoming attack roll total. */
  attackRoll: number;
  /** The attacker's combatant ID. */
  attackerId: string;
  /** The target's current AC. */
  targetAC: number;
}

/**
 * Result from a successful attack reaction detection.
 * Provides just enough info for the two-phase service to build a ReactionOpportunity.
 */
export interface DetectedAttackReaction {
  /** Reaction type identifier (must match a ReactionType). */
  reactionType: string;
  /** Context data stored on the ReactionOpportunity. */
  context: Record<string, unknown>;
}

/**
 * Declares a class-specific attack reaction.
 * When a character is targeted by an attack, all registered reaction defs
 * are checked. If `detect()` returns a result, a reaction opportunity is created.
 *
 * Examples: Wizard's Shield spell, Monk's Deflect Attacks.
 *
 * Detection is a pure function — the two-phase service provides the inputs,
 * the domain layer owns the eligibility rules.
 */
export interface AttackReactionDef {
  /** Reaction type identifier (e.g. "shield", "deflect_attacks"). */
  reactionType: string;
  /** Class this reaction belongs to (lowercase). */
  classId: string;
  /**
   * Detect whether this reaction is available.
   * Returns reaction context if eligible, null otherwise.
   */
  detect(input: AttackReactionInput): DetectedAttackReaction | null;
}

// ----- Damage Reaction Definitions -----

/**
 * Input provided to damage reaction detectors.
 * Damage reactions trigger AFTER damage is applied (e.g. Absorb Elements, Hellish Rebuke).
 */
export interface DamageReactionInput {
  /** Target's class name (lowercase). */
  className: string;
  /** Target's level. */
  level: number;
  /** Target's ability scores. */
  abilityScores: Record<string, number>;
  /** Target's combat resources (resource pools, flags, etc.). */
  resources: Record<string, unknown>;
  /** Whether the target has their reaction available. */
  hasReaction: boolean;
  /** Whether the target is a player character. */
  isCharacter: boolean;
  /** The damage type that was just applied. */
  damageType: string;
  /** The amount of damage applied. */
  damageAmount: number;
  /** The attacker's combatant ID. */
  attackerId: string;
}

/**
 * Result from a successful damage reaction detection.
 */
export interface DetectedDamageReaction {
  /** Reaction type identifier (must match a ReactionType). */
  reactionType: string;
  /** Context data stored on the ReactionOpportunity. */
  context: Record<string, unknown>;
}

/**
 * Declares a class-specific damage reaction.
 * When a character takes damage, all registered damage reaction defs are checked.
 * If `detect()` returns a result, a damage reaction opportunity is created.
 *
 * Examples: Wizard's Absorb Elements, Warlock's Hellish Rebuke.
 */
export interface DamageReactionDef {
  /** Reaction type identifier (e.g. "absorb_elements", "hellish_rebuke"). */
  reactionType: string;
  /** Class this reaction belongs to (lowercase). Primary, but detection may not be class-gated. */
  classId: string;
  /**
   * Detect whether this reaction is available.
   * Returns reaction context if eligible, null otherwise.
   */
  detect(input: DamageReactionInput): DetectedDamageReaction | null;
}

// ----- Spell Reaction Definitions -----

/**
 * Input provided to spell reaction detectors (e.g. Counterspell).
 * Spell reactions trigger when a creature casts a spell.
 */
export interface SpellReactionInput {
  /** Reactor's class name (lowercase). */
  className: string;
  /** Reactor's level. */
  level: number;
  /** Reactor's ability scores. */
  abilityScores: Record<string, number>;
  /** Reactor's combat resources (resource pools, flags, etc.). */
  resources: Record<string, unknown>;
  /** Whether the reactor has their reaction available. */
  hasReaction: boolean;
  /** Whether the reactor is a player character. */
  isCharacter: boolean;
  /** Name of the spell being cast. */
  spellName: string;
  /** Level of the spell being cast. */
  spellLevel: number;
  /** The caster's combatant ID. */
  casterId: string;
  /** Distance from reactor to caster. */
  distance: number;
}

/**
 * Result from a successful spell reaction detection.
 */
export interface DetectedSpellReaction {
  /** Reaction type identifier. */
  reactionType: string;
  /** Context data stored on the ReactionOpportunity. */
  context: Record<string, unknown>;
}

/**
 * Declares a class-specific spell reaction (e.g. Counterspell).
 * When a creature casts a spell, all registered spell reaction defs are checked.
 */
export interface SpellReactionDef {
  /** Reaction type identifier (e.g. "counterspell"). */
  reactionType: string;
  /** Class this reaction belongs to (lowercase). */
  classId: string;
  /**
   * Detect whether this reaction is available.
   * Returns reaction context if eligible, null otherwise.
   */
  detect(input: SpellReactionInput): DetectedSpellReaction | null;
}

// ----- Detection function -----

/**
 * Detect all attack reactions available to a target.
 * Pure function: scans all profiles' attackReactions declarations.
 */
export function detectAttackReactions(
  input: AttackReactionInput,
  profiles: readonly ClassCombatTextProfile[],
): DetectedAttackReaction[] {
  const results: DetectedAttackReaction[] = [];
  for (const profile of profiles) {
    if (!profile.attackReactions) continue;
    for (const def of profile.attackReactions) {
      const result = def.detect(input);
      if (result) results.push(result);
    }
  }
  return results;
}

/**
 * Detect all damage reactions available to a target after taking damage.
 * Pure function: scans all profiles' damageReactions declarations.
 */
export function detectDamageReactions(
  input: DamageReactionInput,
  profiles: readonly ClassCombatTextProfile[],
): DetectedDamageReaction[] {
  const results: DetectedDamageReaction[] = [];
  for (const profile of profiles) {
    if (!profile.damageReactions) continue;
    for (const def of profile.damageReactions) {
      const result = def.detect(input);
      if (result) results.push(result);
    }
  }
  return results;
}

/**
 * Detect all spell reactions available from combatants observing a spell cast.
 * Pure function: scans all profiles' spellReactions declarations.
 */
export function detectSpellReactions(
  input: SpellReactionInput,
  profiles: readonly ClassCombatTextProfile[],
): DetectedSpellReaction[] {
  const results: DetectedSpellReaction[] = [];
  for (const profile of profiles) {
    if (!profile.spellReactions) continue;
    for (const def of profile.spellReactions) {
      const result = def.detect(input);
      if (result) results.push(result);
    }
  }
  return results;
}

/**
 * Defines a class-specific attack enhancement declaration.
 * Examples: Monk's Stunning Strike, Paladin's Divine Smite.
 */
export interface AttackEnhancementDef {
  /** Internal keyword identifier (e.g. "stunning-strike"). */
  keyword: string;
  /** Human-readable name for display/prompts (e.g. "Stunning Strike"). */
  displayName?: string;
  /** Regex patterns matched against raw lowercase text. */
  patterns: readonly RegExp[];
  /** Minimum class level required. */
  minLevel: number;
  /** Resource pool cost to check availability. */
  resourceCost?: { pool: string; amount: number };
  /** Key in turn flags that tracks once-per-turn usage. */
  turnTrackingKey?: string;
  /** Whether this enhancement requires a melee attack. */
  requiresMelee?: boolean;
  /**
   * When the enhancement triggers.
   * - "onDeclare" (default): declared in the action text before rolling
   * - "onHit": offered post-hit, opted into via damage roll text
   */
  trigger?: "onDeclare" | "onHit";
  /** Choice options for enhancements like OHT: ["addle", "push", "topple"]. */
  choiceOptions?: readonly string[];
  /** If set, enhancement is only eligible when attack was part of this bonus action (e.g. "flurry-of-blows"). */
  requiresBonusAction?: string;
}

/**
 * A class's full combat text profile — everything the text parser and
 * action dispatcher need to understand what abilities this class can
 * declare via text input.
 */
export interface ClassCombatTextProfile {
  /** The class this profile belongs to (lowercase). */
  classId: string;
  /** Bonus action and class action text mappings (order matters — first match wins). */
  actionMappings: readonly ClassActionMapping[];
  /** Attack enhancement declarations (checked during attack action parsing). */
  attackEnhancements: readonly AttackEnhancementDef[];
  /** Attack reaction declarations (checked when this class's character is targeted). */
  attackReactions?: readonly AttackReactionDef[];
  /** Damage reaction declarations (checked after damage is applied to this class's character). */
  damageReactions?: readonly DamageReactionDef[];
  /** Spell reaction declarations (checked when a spell is cast near this class's character). */
  spellReactions?: readonly SpellReactionDef[];
}

// ----- Matching result types -----

/** Result of matching text against class action profiles. */
export interface ClassActionMatch {
  keyword: string;
  abilityId: string;
  category: CombatActionCategory;
}

// ----- Pure matching functions (take profiles as parameter — no implicit state) -----

/**
 * Try to match user text against all registered class action patterns.
 * Returns the first match with its ability ID and category.
 *
 * Scans all profiles since the character's class isn't known at parse time.
 * Class eligibility is validated later by the AbilityRegistry executor.
 */
export function tryMatchClassAction(
  text: string,
  profiles: readonly ClassCombatTextProfile[],
): ClassActionMatch | null {
  const normalized = text.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  for (const profile of profiles) {
    for (const mapping of profile.actionMappings) {
      if (mapping.normalizedPatterns.some((p) => p.test(normalized))) {
        return {
          keyword: mapping.keyword,
          abilityId: mapping.abilityId,
          category: mapping.category,
        };
      }
    }
  }
  return null;
}

/**
 * Match attack enhancement declarations in attack text.
 * Filters by class, level, melee requirement, resource availability, and
 * once-per-turn tracking.
 *
 * @param triggerFilter — when set, only match enhancements with the given trigger.
 *   Use "onDeclare" in the action dispatcher (skip onHit enhancements).
 *   Use "any" (default) to match all triggers.
 *
 * Returns the list of matched enhancement keywords (e.g. ["stunning-strike"]).
 */
export function matchAttackEnhancements(
  text: string,
  attackKind: "melee" | "ranged",
  classId: string,
  level: number,
  turnFlags: Record<string, unknown>,
  resourcePools: ReadonlyArray<{ name: string; current: number }>,
  profiles: readonly ClassCombatTextProfile[],
  triggerFilter: "onDeclare" | "onHit" | "any" = "any",
): string[] {
  const profile = profiles.find((p) => p.classId === classId.toLowerCase());
  if (!profile) return [];

  const normalized = text.trim().toLowerCase();
  const results: string[] = [];

  for (const enhancement of profile.attackEnhancements) {
    const trigger = enhancement.trigger ?? "onDeclare";
    // Trigger filter
    if (triggerFilter !== "any" && trigger !== triggerFilter) continue;
    // Level gate
    if (level < enhancement.minLevel) continue;
    // Melee requirement
    if (enhancement.requiresMelee && attackKind !== "melee") continue;
    // Text pattern match
    if (!enhancement.patterns.some((p) => p.test(normalized))) continue;
    // Once-per-turn check
    if (enhancement.turnTrackingKey && turnFlags[enhancement.turnTrackingKey] === true) continue;
    // Resource availability check
    if (enhancement.resourceCost) {
      const pool = resourcePools.find((p) => p.name === enhancement.resourceCost!.pool);
      if (!pool || pool.current < enhancement.resourceCost.amount) continue;
    }

    results.push(enhancement.keyword);
  }

  return results;
}

// ----- On-Hit Enhancement Types -----

/** Eligible on-hit enhancement returned to the client for post-hit opt-in. */
export interface EligibleOnHitEnhancement {
  keyword: string;
  displayName: string;
  resourceCost?: { pool: string; amount: number };
  choiceOptions?: readonly string[];
}

/**
 * Get all eligible on-hit enhancements for a creature.
 * Does NOT check text patterns — just eligibility (level, melee, once-per-turn, resources).
 *
 * @param bonusAction — the bonus action that produced this attack (e.g. "flurry-of-blows")
 */
export function getEligibleOnHitEnhancements(
  attackKind: "melee" | "ranged",
  classId: string,
  level: number,
  turnFlags: Record<string, unknown>,
  resourcePools: ReadonlyArray<{ name: string; current: number }>,
  profiles: readonly ClassCombatTextProfile[],
  bonusAction?: string,
): EligibleOnHitEnhancement[] {
  const profile = profiles.find((p) => p.classId === classId.toLowerCase());
  if (!profile) return [];

  const results: EligibleOnHitEnhancement[] = [];

  for (const enhancement of profile.attackEnhancements) {
    const trigger = enhancement.trigger ?? "onDeclare";
    if (trigger !== "onHit") continue;
    // Level gate
    if (level < enhancement.minLevel) continue;
    // Melee requirement
    if (enhancement.requiresMelee && attackKind !== "melee") continue;
    // Bonus action gate (e.g. OHT only on flurry hits)
    if (enhancement.requiresBonusAction && bonusAction !== enhancement.requiresBonusAction) continue;
    // Once-per-turn check
    if (enhancement.turnTrackingKey && turnFlags[enhancement.turnTrackingKey] === true) continue;
    // Resource availability check
    if (enhancement.resourceCost) {
      const pool = resourcePools.find((p) => p.name === enhancement.resourceCost!.pool);
      if (!pool || pool.current < enhancement.resourceCost.amount) continue;
    }

    results.push({
      keyword: enhancement.keyword,
      displayName: enhancement.displayName ?? enhancement.keyword,
      ...(enhancement.resourceCost ? { resourceCost: enhancement.resourceCost } : {}),
      ...(enhancement.choiceOptions ? { choiceOptions: enhancement.choiceOptions } : {}),
    });
  }

  return results;
}

/** Result of matching on-hit enhancement keywords in damage text. */
export interface MatchedOnHitEnhancement {
  keyword: string;
  choice?: string;
}

/**
 * Match on-hit enhancement keywords in damage roll text.
 * Returns matched enhancement keywords and any choice values (e.g. "topple" for OHT).
 */
export function matchOnHitEnhancementsInText(
  text: string,
  eligibleDefs: readonly AttackEnhancementDef[],
): MatchedOnHitEnhancement[] {
  const normalized = text.trim().toLowerCase();
  const results: MatchedOnHitEnhancement[] = [];

  for (const def of eligibleDefs) {
    if (!def.patterns.some((p) => p.test(normalized))) continue;

    let choice: string | undefined;
    if (def.choiceOptions) {
      for (const opt of def.choiceOptions) {
        if (new RegExp(`\\b${opt}\\b`, "i").test(normalized)) {
          choice = opt;
          break;
        }
      }
      // If choiceOptions exist but none matched, skip — player must specify a choice
      if (!choice) continue;
    }

    results.push({ keyword: def.keyword, choice });
  }

  return results;
}
