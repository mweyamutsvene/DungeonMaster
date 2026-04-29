/**
 * Pure / stateless text-parsing utilities for the tabletop combat flow.
 *
 * Every function in this module is a named export that does NOT depend on
 * `this.deps` or any repository — it only looks at the strings passed in.
 * This makes them trivially unit-testable.
 */

import { ValidationError } from "../../../errors.js";
import type { LlmRoster, CombatantRef } from "../../../commands/game-command.js";
import type { ActiveCondition } from "../../../../domain/entities/combat/conditions.js";
import {
  hasSelfAttackAdvantage,
  hasIncomingAttackDisadvantage,
  hasIncomingAttackAdvantage,
  hasOutgoingAttackDisadvantage,
  getProneAttackModifier,
} from "../../../../domain/entities/combat/conditions.js";

// ----- Formula helpers -----

/**
 * Double the dice count in a damage formula for critical hits.
 * D&D 5e 2024: Critical hit adds extra dice equal to the weapon's damage dice.
 * Examples: "1d8+3" → "2d8+3", "2d6" → "4d6", "1d10+5" → "2d10+5"
 */
export function doubleDiceInFormula(formula: string): string {
  return formula.replace(/(\d+)d(\d+)/g, (_match, count: string, sides: string) => {
    return `${parseInt(count, 10) * 2}d${sides}`;
  });
}

/**
 * Derive roll mode (advantage/disadvantage/normal) from combatant conditions.
 * D&D 5e 2024 rules — delegates to centralized condition helpers in conditions.ts.
 *
 * When both advantage and disadvantage apply, they cancel out → normal.
 *
 * @param distanceFt - Optional attacker-to-target distance. When provided, Prone
 *   advantage/disadvantage uses distance (≤5ft → melee advantage, >5ft → disadvantage)
 *   instead of weapon attackKind alone. This correctly handles reach weapons.
 */
export function deriveRollModeFromConditions(
  attackerConditions: readonly ActiveCondition[],
  targetConditions: readonly ActiveCondition[],
  attackKind: "melee" | "ranged",
  extraAdvantageSources = 0,
  extraDisadvantageSources = 0,
  distanceFt?: number,
): "normal" | "advantage" | "disadvantage" {
  let advantageSources = extraAdvantageSources;
  let disadvantageSources = extraDisadvantageSources;

  // Attacker conditions — delegate to condition helpers
  // hasSelfAttackAdvantage: Invisible, Hidden → advantage on own attacks
  if (hasSelfAttackAdvantage(attackerConditions)) advantageSources++;
  // hasOutgoingAttackDisadvantage: Blinded, Frightened, Poisoned, Restrained, Prone, Sapped, Addled → disadvantage
  if (hasOutgoingAttackDisadvantage(attackerConditions)) disadvantageSources++;

  // Target conditions — delegate to condition helpers
  // hasIncomingAttackAdvantage: Blinded, Paralyzed, Stunned, Unconscious, Petrified, Restrained, StunningStrikePartial → advantage
  if (hasIncomingAttackAdvantage(targetConditions)) advantageSources++;
  // hasIncomingAttackDisadvantage: Invisible → disadvantage on incoming attacks
  if (hasIncomingAttackDisadvantage(targetConditions)) disadvantageSources++;

  // Prone target: distance-aware advantage/disadvantage (D&D 5e 2024)
  // When distance is known, use it for accurate reach-weapon handling.
  // Fallback to weapon kind defaults when distance is not available.
  const proneDistance = distanceFt ?? (attackKind === "melee" ? 5 : 30);
  const proneModifier = getProneAttackModifier(targetConditions, proneDistance, attackKind);
  if (proneModifier === "advantage") advantageSources++;
  if (proneModifier === "disadvantage") disadvantageSources++;

  // D&D 5e: if any advantage AND any disadvantage → cancel to normal
  if (advantageSources > 0 && disadvantageSources > 0) return "normal";
  if (advantageSources > 0) return "advantage";
  if (disadvantageSources > 0) return "disadvantage";
  return "normal";
}

// ----- Movement / simple action parsers -----

/** Parse "move to (x, y)" text into coordinates. */
export function tryParseMoveText(input: string): { x: number; y: number } | null {
  const normalized = input.trim().toLowerCase();
  if (!normalized.startsWith("move")) return null;

  // Reject compound commands ("move to X and attack Y") — handled by compound parser
  if (/\s+(?:and|then|,)\s+(?:attack|strike|hit|throw|cast|use)\b/.test(normalized)) return null;

  const match = normalized.match(/move\s*(?:to\s*)?\(?\s*(-?\d+)\s*[ ,]\s*(-?\d+)\s*\)?/);
  if (!match) return null;
  const x = Number.parseInt(match[1]!, 10);
  const y = Number.parseInt(match[2]!, 10);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

/**
 * Parse natural-language "move to <creature>" text, optionally with range intent.
 *
 * Matches patterns like:
 *   "move to Goblin", "move toward the Orc", "approach Dragon",
 *   "advance on Skeleton", "close in on Bandit", "move near Goblin Warrior",
 *   "get close to the orc", "move next to goblin"
 *
 * Range-aware patterns:
 *   "move within 30ft of Goblin" → desiredRange: 30
 *   "get within bow range of Orc" → desiredRange: 30
 *   "keep 20ft from Dragon" → desiredRange: 20
 *   "move to ranged position near Goblin" → desiredRange: 30
 *
 * Rejects text that contains coordinate parentheses (handled by tryParseMoveText).
 * Returns the matched CombatantRef, the raw target name, and optional desiredRange.
 */
export function tryParseMoveTowardText(
  input: string,
  roster: LlmRoster,
): { target: CombatantRef; rawTargetName: string; desiredRange?: number } | null {
  let normalized = input.trim().toLowerCase();

  // Don't steal from coordinate-based move parser
  if (/\(\s*-?\d+\s*[, ]\s*-?\d+\s*\)/.test(normalized)) return null;

  // Reject compound commands ("move toward X and attack Y") — handled by compound parser
  if (/\s+(?:and|then|,)\s+(?:attack|strike|hit|throw|cast|use)\b/.test(normalized)) return null;

  // --- Range-aware patterns (checked first so they don't get eaten by generic patterns) ---
  const rangePatterns: Array<{ pattern: RegExp; rangeGroup: number; nameGroup: number; fixedRange?: number }> = [
    // "move within 30ft of Goblin" / "get within 30 feet of Goblin"
    { pattern: /^(?:move|get)\s+within\s+(\d+)\s*(?:ft|feet|foot)\s+(?:of|from)\s+(?:the\s+)?(.+?)$/, rangeGroup: 1, nameGroup: 2 },
    // "keep 20ft from Dragon" / "keep 20 feet away from Dragon"
    { pattern: /^keep\s+(\d+)\s*(?:ft|feet|foot)\s+(?:away\s+)?(?:from)\s+(?:the\s+)?(.+?)$/, rangeGroup: 1, nameGroup: 2 },
    // "move to ranged position near Goblin" / "move to ranged position from Goblin"
    { pattern: /^move\s+to\s+ranged\s+position\s+(?:near|from)\s+(?:the\s+)?(.+?)$/, rangeGroup: -1, nameGroup: 1, fixedRange: 30 },
    // "get within bow range of Orc" / "move within bow range of Orc"
    { pattern: /^(?:move|get)\s+within\s+bow\s+range\s+(?:of|from)\s+(?:the\s+)?(.+?)$/, rangeGroup: -1, nameGroup: 1, fixedRange: 30 },
    // "get within spell range of Orc" / "move within spell range of Orc"
    { pattern: /^(?:move|get)\s+within\s+spell\s+range\s+(?:of|from)\s+(?:the\s+)?(.+?)$/, rangeGroup: -1, nameGroup: 1, fixedRange: 30 },
  ];

  for (const { pattern, rangeGroup, nameGroup, fixedRange } of rangePatterns) {
    const match = normalized.match(pattern);
    if (!match) continue;

    const rawName = match[nameGroup]!.trim();
    if (rawName.length === 0) continue;

    const ref = findCombatantByName(rawName, roster);
    if (ref) {
      const desiredRange = fixedRange ?? parseInt(match[rangeGroup]!, 10);
      return { target: ref, rawTargetName: rawName, desiredRange };
    }
  }

  // --- Standard move-toward patterns (default melee range) ---
  const patterns = [
    /^move\s+(?:to|toward|towards|near|next\s+to|up\s+to|closer\s+to)\s+(?:the\s+)?(.+?)$/,
    /^approach\s+(?:the\s+)?(.+?)$/,
    /^advance\s+(?:on|toward|towards)\s+(?:the\s+)?(.+?)$/,
    /^close\s+(?:distance|in)\s+(?:on|with|to)\s+(?:the\s+)?(.+?)$/,
    /^get\s+close(?:r)?\s+to\s+(?:the\s+)?(.+?)$/,
    /^go\s+(?:to|toward|towards)\s+(?:the\s+)?(.+?)$/,
    /^run\s+(?:to|toward|towards|at)\s+(?:the\s+)?(.+?)$/,
    /^charge\s+(?:at\s+)?(?:the\s+)?(.+?)$/,
    // "dash toward goblin" / "dash to X" = colloquial movement, not the Dash action
    /^dash\s+(?:toward|towards|to|at|near|up\s+to|next\s+to|closer\s+to)\s+(?:the\s+)?(.+?)$/,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match) continue;

    const rawName = match[1]!.trim();
    if (rawName.length === 0) continue;

    const ref = findCombatantByName(rawName, roster);
    if (ref) {
      return { target: ref, rawTargetName: rawName };
    }
  }

  return null;
}

/** Parse dash / dodge / disengage / ready from text. */
export function tryParseSimpleActionText(input: string): "dash" | "dodge" | "disengage" | "ready" | null {
  const normalized = input.trim().toLowerCase();
  // "cunning action dash/disengage/hide" should be handled by class ability parser, not here
  if (/\bcunning\b/.test(normalized)) return null;
  // "dash toward goblin" / "dash to orc" / "dash at dragon" = movement, NOT the Dash action.
  // Only "dash", "use dash", "take the dash action" etc. should trigger the Dash action.
  if (/\bdash\b/.test(normalized) && !/\bdash\s+(toward|towards|to|at|near|up\s+to|next\s+to|closer\s+to)\s+/i.test(normalized)) return "dash";
  if (/\b(dodge)\b/.test(normalized)) return "dodge";
  if (/\b(disengage)\b/.test(normalized)) return "disengage";
  if (/\b(ready)\b/.test(normalized)) return "ready";
  return null;
}

// ----- Ready action parser -----

export type ReadyResponseType = "attack" | "dash" | "move" | "disengage" | "spell";
export type ReadyTriggerType = "creature_moves_within_range" | "creature_attacks" | "custom";

export interface ParsedReadyAction {
  responseType: ReadyResponseType;
  triggerType: ReadyTriggerType;
  triggerDescription: string;
  /** Target creature name extracted from text (e.g., "the goblin"). */
  targetName?: string;
  /** Spell name if readying a spell (D&D 5e 2024: uses concentration until trigger). */
  spellName?: string;
}

/**
 * Parse ready action details from text.
 * Examples:
 *  - "ready an attack when the goblin moves within range"
 *  - "ready an attack against the goblin"
 *  - "ready to attack when a creature approaches"
 */
export function tryParseReadyText(input: string): ParsedReadyAction | null {
  const normalized = input.trim().toLowerCase();
  if (!/\bready\b/.test(normalized)) return null;

  // Determine what response is being readied
  let responseType: ReadyResponseType = "attack"; // default
  if (/\b(attack|strike|hit|slash|stab|throw|hurl|toss)\b/.test(normalized)) responseType = "attack";
  else if (/\b(dash|run|sprint)\b/.test(normalized)) responseType = "dash";
  else if (/\b(move|retreat|advance)\b/.test(normalized)) responseType = "move";
  else if (/\b(disengage|withdraw)\b/.test(normalized)) responseType = "disengage";

  // Determine trigger type
  let triggerType: ReadyTriggerType = "creature_moves_within_range"; // default
  if (/\b(attack|strikes?|hits?)\b.*\btrigger|when.*\b(attack|strikes?|hits?)\b/.test(normalized)) {
    triggerType = "creature_attacks";
  } else if (/\b(moves?|approach|comes?|enters?|within range|within reach|gets? close)\b/.test(normalized)) {
    triggerType = "creature_moves_within_range";
  }

  // Extract target name (e.g., "the goblin", "an orc")
  let targetName: string | undefined;
  const targetMatch = normalized.match(/(?:against|at|the|toward|on)\s+([\w\s]+?)(?:\s+(?:when|if|moves?|comes?|approach|gets?|$))/);
  if (targetMatch) {
    targetName = targetMatch[1]!.trim();
  }

  const triggerDescription = triggerType === "creature_moves_within_range"
    ? `${targetName ? targetName + " moves" : "a creature moves"} within reach`
    : triggerType === "creature_attacks"
    ? `${targetName ? targetName + " attacks" : "a creature attacks"}`
    : normalized;

  return { responseType, triggerType, triggerDescription, targetName };
}

// ----- Jump parser -----

export type JumpType = "long" | "high";

export interface ParsedJump {
  jumpType: JumpType;
  /** Distance the player wants to jump (optional; if omitted, use max). */
  requestedDistanceFeet?: number;
  /** Explicit destination coordinates for the jump direction (e.g., "jump toward (30, 10)"). */
  directionCoords?: { x: number; y: number };
  /** Target creature ref for jump direction (e.g., "jump toward the goblin"). */
  directionTarget?: CombatantRef;
}

/**
 * Parse jump commands from player text.
 *
 * Matches patterns like:
 *   "jump", "long jump", "high jump",
 *   "jump 10ft", "long jump 15 feet",
 *   "jump over the pit", "jump over obstacle",
 *   "leap", "leap across", "vault over",
 *   "jump toward (30, 10)", "jump toward the goblin"
 *
 * D&D 5e 2024: Jump is part of movement, not an action.
 * Long Jump = horizontal, High Jump = vertical.
 * Default is Long Jump (most common in combat).
 *
 * @param input  The player's text input.
 * @param roster  Optional combat roster for resolving creature names in "jump toward <creature>".
 */
export function tryParseJumpText(input: string, roster?: LlmRoster): ParsedJump | null {
  const normalized = input.trim().toLowerCase();

  // --- "jump toward (x, y)" direction pattern ---
  const coordDirMatch = normalized.match(
    /\b(?:jump|leap|vault)\s+(?:toward|towards|to|at)\s*\(?\s*(-?\d+)\s*[, ]\s*(-?\d+)\s*\)?(?:\s+(\d+)\s*(?:ft|feet|foot))?/,
  );
  if (coordDirMatch) {
    return {
      jumpType: "long",
      directionCoords: { x: parseInt(coordDirMatch[1], 10), y: parseInt(coordDirMatch[2], 10) },
      requestedDistanceFeet: coordDirMatch[3] ? parseInt(coordDirMatch[3], 10) : undefined,
    };
  }

  // --- "jump toward <creature>" direction pattern ---
  if (roster) {
    const creatureDirMatch = normalized.match(
      /\b(?:jump|leap|vault)\s+(?:toward|towards|to|at)\s+(?:the\s+)?(.+?)(?:\s+(\d+)\s*(?:ft|feet|foot))?$/,
    );
    if (creatureDirMatch) {
      const rawName = creatureDirMatch[1]!.replace(/\s+\d+\s*(?:ft|feet|foot)\s*$/, "").trim();
      const ref = findCombatantByName(rawName, roster);
      if (ref) {
        return {
          jumpType: "long",
          directionTarget: ref,
          requestedDistanceFeet: creatureDirMatch[2] ? parseInt(creatureDirMatch[2], 10) : undefined,
        };
      }
    }
  }

  // Explicit high jump
  const highMatch = normalized.match(
    /\b(?:high\s+jump|jump\s+(?:up|high|vertical(?:ly)?))\b(?:\s+(\d+)\s*(?:ft|feet|foot))?/,
  );
  if (highMatch) {
    return {
      jumpType: "high",
      requestedDistanceFeet: highMatch[1] ? parseInt(highMatch[1], 10) : undefined,
    };
  }

  // Explicit long jump with optional distance
  const longMatch = normalized.match(
    /\b(?:long\s+jump)\b(?:\s+(\d+)\s*(?:ft|feet|foot))?/,
  );
  if (longMatch) {
    return {
      jumpType: "long",
      requestedDistanceFeet: longMatch[1] ? parseInt(longMatch[1], 10) : undefined,
    };
  }

  // Generic "jump [over/across] [something] [distance]"
  const genericMatch = normalized.match(
    /\b(?:jump|leap|vault)\b(?:\s+(?:over|across|past)\b(?:\s+(?:the\s+)?[\w\s]+?)?)?(?:\s+(\d+)\s*(?:ft|feet|foot))?$/,
  );
  if (genericMatch) {
    return {
      jumpType: "long", // default to long jump (horizontal)
      requestedDistanceFeet: genericMatch[1] ? parseInt(genericMatch[1], 10) : undefined,
    };
  }

  return null;
}

// ----- Misc action parsers -----

/** Parse "hide" or "I hide". */
export function tryParseHideText(input: string): boolean {
  const normalized = input.trim().toLowerCase();
  return /\bhide\b/.test(normalized);
}

/** Parse "offhand attack", "off-hand attack", "offhand strike", "bonus attack", etc. */
export function tryParseOffhandAttackText(input: string): boolean {
  const normalized = input.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  return /offhandattack|offhandstrike|offhand$|bonusattack|twoweaponattack/.test(normalized);
}

/** Parse "search", "I search", "search for hidden", "look around", "search for enemies". */
export function tryParseSearchText(input: string): boolean {
  const normalized = input.trim().toLowerCase();
  return /\b(search|search for|look around|look for hidden|scan for)\b/.test(normalized);
}

/**
 * Parse "help <target>" or "help attack <target>".
 * Returns the target name if matched, null otherwise.
 */
export function tryParseHelpText(input: string): string | null {
  const normalized = input.trim().toLowerCase();
  const match = normalized.match(/\bhelp\s+(?:attack\s+)?(.+)/i);
  if (!match) return null;
  return match[1]!.trim();
}

/**
 * Parse "shove <target> [prone]" or "push <target>".
 * Returns { targetName, shoveType } if matched, null otherwise.
 */
export function tryParseShoveText(input: string): { targetName: string; shoveType: "push" | "prone" } | null {
  const normalized = input.trim().toLowerCase();
  // "shove X prone" or "shove X" or "push X"
  const shoveMatch = normalized.match(/\bshove\s+(.+?)(?:\s+(prone|push))?\s*$/i);
  if (shoveMatch) {
    const targetName = shoveMatch[1]!.trim();
    const shoveType: "push" | "prone" = shoveMatch[2]?.toLowerCase() === "prone" ? "prone" : "push";
    return { targetName, shoveType };
  }
  const pushMatch = normalized.match(/\bpush\s+(.+)/i);
  if (pushMatch) {
    return { targetName: pushMatch[1]!.trim(), shoveType: "push" };
  }
  return null;
}

/**
 * Parse "grapple <target>" or "I grapple the <target>".
 * Returns { targetName } if matched, null otherwise.
 */
export function tryParseGrappleText(input: string): { targetName: string } | null {
  const normalized = input.trim().toLowerCase();
  const match = normalized.match(/\bgrapple\s+(?:the\s+)?(.+)/i);
  if (match) {
    return { targetName: match[1]!.trim() };
  }
  return null;
}

/**
 * Parse "escape grapple", "break free", "break grapple" commands.
 * Returns true if matched, null otherwise.
 */
export function tryParseEscapeGrappleText(input: string): true | null {
  const normalized = input.trim().toLowerCase();
  if (/\b(?:escape\s+grapple|break\s+(?:free|grapple))\b/.test(normalized)) {
    return true;
  }
  return null;
}

/**
 * Parse "cast <spell> [at level N] [at <target>]" or "cast <spell> [at level N] on <target>".
 * Also strips "as a bonus action" / "as my bonus action" / "using a bonus action" suffixes
 * so the spell name is clean for catalog lookup. When stripped, sets isBonusActionFromText: true
 * as a fallback for callers when spellMatch?.isBonusAction is also false.
 * Returns { spellName, targetName?, castAtLevel?, isBonusActionFromText? } if matched, null otherwise.
 */
export function tryParseCastSpellText(input: string): { spellName: string; targetName?: string; castAtLevel?: number; isBonusActionFromText?: boolean } | null {
  const normalized = input.trim().toLowerCase();
  // Strip "as a bonus action" / "as my bonus action" / "using a bonus action" suffixes
  const isBonusActionFromText = /\s+as\s+(?:a\s+|my\s+)?bonus\s+action\b|\s+using\s+(?:a\s+|my\s+)?bonus\s+action\b/i.test(normalized);
  const cleaned = normalized
    .replace(/\s+as\s+(?:a\s+|my\s+)?bonus\s+action\b/i, "")
    .replace(/\s+using\s+(?:a\s+|my\s+)?bonus\s+action\b/i, "");
  const match = cleaned.match(/\bcast\s+(.+?)(?:\s+at\s+level\s+(\d+))?(?:\s+(?:at|on)\s+(.+))?\s*$/i);
  if (!match) return null;
  const spellName = match[1]!.trim();
  const castAtLevel = match[2] ? parseInt(match[2], 10) : undefined;

  // Extract targetName from the ORIGINAL (case-preserved) input so @id: entity IDs survive intact.
  let targetName: string | undefined;
  if (match[3]) {
    const originalCleaned = input.trim()
      .replace(/\s+as\s+(?:a\s+|my\s+)?bonus\s+action\b/i, "")
      .replace(/\s+using\s+(?:a\s+|my\s+)?bonus\s+action\b/i, "");
    const originalMatch = originalCleaned.match(/\bcast\s+.+?(?:\s+at\s+level\s+\d+)?(?:\s+(?:at|on)\s+(.+))?\s*$/i);
    targetName = originalMatch?.[1]?.trim() ?? match[3].trim();
  }

  return { spellName, targetName, castAtLevel, ...(isBonusActionFromText && { isBonusActionFromText }) };
}

/**
 * Parse "pick up <item>" / "grab <item>" / "take <item>" commands.
 * Returns { itemName } if matched, null otherwise.
 */
export function tryParsePickupText(input: string): { itemName: string } | null {
  const normalized = input.trim().toLowerCase();
  const match = normalized.match(/\b(?:pick\s*up|grab|take|collect|retrieve)\s+(?:the\s+|a\s+|my\s+)?(.+?)$/i);
  if (!match) return null;
  const itemName = match[1]!.trim();
  if (!itemName || itemName.length === 0) return null;
  return { itemName };
}

/**
 * Parse "drop <item>" / "put down <item>" commands.
 * Returns { itemName } if matched, null otherwise.
 */
export function tryParseDropText(input: string): { itemName: string } | null {
  const normalized = input.trim().toLowerCase();
  const match = normalized.match(/\b(?:drop|put\s*down|discard|release|let\s*go\s*(?:of)?|toss\s*aside)\s+(?:the\s+|a\s+|my\s+)?(.+?)$/i);
  if (!match) return null;
  const itemName = match[1]!.trim();
  if (!itemName || itemName.length === 0) return null;
  return { itemName };
}

/**
 * Parse "draw <weapon>" / "unsheathe <weapon>" commands.
 * Returns { weaponName } if matched, null otherwise.
 */
export function tryParseDrawWeaponText(input: string): { weaponName: string } | null {
  const normalized = input.trim();
  const match = normalized.match(/\b(?:draw|unsheathe?|pull\s*out|ready)\s+(?:the\s+|a\s+|my\s+)?(.+?)$/i);
  if (!match) return null;
  const weaponName = match[1]!.trim();
  if (!weaponName || weaponName.length === 0) return null;
  return { weaponName };
}

/**
 * Parse "sheathe <weapon>" / "stow <weapon>" / "put away <weapon>" commands.
 * Returns { weaponName } if matched, null otherwise.
 */
export function tryParseSheatheWeaponText(input: string): { weaponName: string } | null {
  const normalized = input.trim();
  const match = normalized.match(/\b(?:sheathe?|stow|put\s*away|holster)\s+(?:the\s+|a\s+|my\s+)?(.+?)$/i);
  if (!match) return null;
  const weaponName = match[1]!.trim();
  if (!weaponName || weaponName.length === 0) return null;
  return { weaponName };
}

/**
 * Parse "use/drink/consume/quaff/eat <item>" text.
 * D&D 5e 2024: Per-item `actionCosts.use` controls whether this consumes an
 * Action or a Bonus Action (see `InteractionHandlers.handleUseItemAction`).
 * `eat` is a Goodberry-specific verb; `drink`/`quaff` for potions; `use` generic.
 *
 * Rejects inputs that match `give/hand/feed/administer X to Y` — those route
 * to `tryParseGiveItemText` / `tryParseAdministerItemText` instead.
 */
export function tryParseUseItemText(input: string): { itemName: string } | null {
  const normalized = input.trim();
  // Exclude give/administer patterns (they have a "to <target>" tail).
  if (/^(?:give|hand|feed|administer)\s+.+\s+to\s+\S+/i.test(normalized)) return null;
  const match = normalized.match(/\b(?:use|drink|consume|quaff|eat|take)\s+(?:a\s+|the\s+|my\s+|an?\s+)?(.+?)$/i);
  if (!match) return null;
  const itemName = match[1]!.trim();
  if (!itemName || itemName.length === 0) return null;
  return { itemName };
}

/**
 * Parse "give <item> to <target>" / "hand <item> to <target>".
 * D&D 5e 2024: transfer only — no activation. Actor consumes free object
 * interaction (default) or falls through to Utilize action per the item's
 * `actionCosts.give`. See `InteractionHandlers.handleGiveItemAction`.
 */
export function tryParseGiveItemText(input: string): { itemName: string; targetName: string } | null {
  const normalized = input.trim();
  const match = normalized.match(/^(?:give|hand)\s+(?:a\s+|the\s+|my\s+|an?\s+)?(.+?)\s+to\s+(\S.*?)$/i);
  if (!match) return null;
  const itemName = match[1]!.trim();
  const targetName = match[2]!.trim();
  if (!itemName || !targetName) return null;
  return { itemName, targetName };
}

/**
 * Parse "feed <item> to <target>" / "administer <item> to <target>".
 * D&D 5e 2024: force-feed/apply. Actor consumes 1× item; target receives
 * the item's `potionEffects`. Works on unconscious targets. See
 * `InteractionHandlers.handleAdministerItemAction`.
 */
export function tryParseAdministerItemText(input: string): { itemName: string; targetName: string } | null {
  const normalized = input.trim();
  const match = normalized.match(/^(?:feed|administer)\s+(?:a\s+|the\s+|my\s+|an?\s+)?(.+?)\s+to\s+(\S.*?)$/i);
  if (!match) return null;
  const itemName = match[1]!.trim();
  const targetName = match[2]!.trim();
  if (!itemName || !targetName) return null;
  return { itemName, targetName };
}

/**
 * Parse "end turn", "end my turn", "pass", "done", "skip", "nothing".
 * Returns true if matched, null otherwise.
 */
export function tryParseEndTurnText(input: string): true | null {
  const normalized = input.trim().toLowerCase();
  if (/^(?:end\s+(?:my\s+)?turn|pass|done|skip|nothing)$/.test(normalized)) {
    return true;
  }
  return null;
}
// ----- Legendary action parser -----

export interface ParsedLegendaryAction {
  /** The specific legendary action name, if specified (e.g., "tail attack"). */
  actionName?: string;
}

/**
 * Parse "legendary <action>" commands.
 *
 * Matches patterns like:
 *   "legendary attack", "legendary tail attack", "legendary move",
 *   "use legendary action", "legendary action: wing attack",
 *   "legendary multiattack"
 *
 * Returns { actionName? } if matched, null otherwise.
 */
export function tryParseLegendaryAction(input: string): ParsedLegendaryAction | null {
  const normalized = input.trim().toLowerCase();
  // "legendary <something>" or "use legendary action [: <name>]"
  const match = normalized.match(
    /^(?:use\s+)?legendary\s+(?:action\s*[:\-]?\s*)?(.+?)$/,
  );
  if (match) {
    const actionName = match[1]!.trim();
    // Filter out bare "action" so "legendary action" with no specifics works
    if (actionName === "action" || actionName.length === 0) {
      return {};
    }
    return { actionName };
  }
  return null;
}

// ----- Compound move+attack parser -----

export interface ParsedCompoundMoveAttack {
  /** Move destination coordinates */
  move: { x: number; y: number };
  /** Attack target name (may be empty if not specified) */
  targetName?: string;
  /** Weapon hint from "with my X" */
  weaponHint?: string;
}

/**
 * Parse compound "move to (X,Y) and attack [target] [with weapon]" commands.
 *
 * Matches patterns like:
 *   "move to (5,5) and attack goblin"
 *   "move to 3, 7 then attack the orc with my longsword"
 *   "move (10,10), attack goblin warrior"
 *   "move to (2,4) and strike the bandit with my dagger"
 *
 * Returns both move destination and attack intent. The dispatcher handles
 * executing the move first, then the attack.
 */
export function tryParseCompoundMoveAttack(input: string): ParsedCompoundMoveAttack | null {
  const normalized = input.trim().toLowerCase();
  if (!normalized.startsWith("move")) return null;

  // Must contain a compound separator followed by an attack verb
  const compoundMatch = normalized.match(
    /^move\s*(?:to\s*)?\(?\s*(-?\d+)\s*[ ,]\s*(-?\d+)\s*\)?\s*(?:and|then|,)\s*(?:attack|strike|hit)\s*(.*)?$/,
  );
  if (!compoundMatch) return null;

  const x = Number.parseInt(compoundMatch[1]!, 10);
  const y = Number.parseInt(compoundMatch[2]!, 10);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  // Parse the attack part for target name and weapon hint
  const attackPart = (compoundMatch[3] ?? "").trim();
  let targetName: string | undefined;
  let weaponHint: string | undefined;

  if (attackPart) {
    // Try "target with my weapon" pattern
    const withMatch = attackPart.match(/^(?:the\s+)?(.+?)\s+with\s+(?:my\s+|a\s+)?(.+?)$/);
    if (withMatch) {
      targetName = withMatch[1]!.trim();
      weaponHint = withMatch[2]!.trim();
    } else {
      // Just a target name (strip leading "the")
      targetName = attackPart.replace(/^the\s+/, "").trim() || undefined;
    }
  }

  return { move: { x, y }, targetName, weaponHint };
}

// ----- Roster / ref helpers -----

/** Look up an actor in the roster and return the combatant ref. */
export function inferActorRef(id: string, roster: LlmRoster): { type: "Character"; characterId: string } | { type: "Monster"; monsterId: string } | { type: "NPC"; npcId: string } {
  if (roster.characters.some((c) => c.id === id)) return { type: "Character" as const, characterId: id };
  if (roster.monsters.some((m) => m.id === id)) return { type: "Monster" as const, monsterId: id };
  if (roster.npcs.some((n) => n.id === id)) return { type: "NPC" as const, npcId: id };
  throw new ValidationError(`actorId not found in roster: ${id}`);
}

// ----- Attack text parser -----

export interface ParsedAttackText {
  /** Creature name extracted from text, if any. */
  targetName?: string;
  /** Weapon name extracted from text, if any. */
  weaponHint?: string;
  /** True when the user explicitly said "nearest". */
  nearest: boolean;
}

/**
 * Parse attack commands from player text.
 *
 * Matches patterns like:
 *   "attack goblin", "attack the goblin warrior",
 *   "attack goblin with longsword", "attack with longsword",
 *   "attack nearest goblin", "attack nearest goblin with longsword",
 *   "strike the orc", "hit the bandit with my dagger",
 *   "I attack the goblin"
 *
 * Does NOT match patterns already handled by other parsers:
 *   - "offhand attack" / "bonus attack" (→ tryParseOffhandAttackText)
 *   - Text containing "throw" / "hurl" (→ handled in handleAttackAction thrown path)
 *
 * Returns parsed fields; target resolution (picking nearest among same-named)
 * happens in the dispatcher which has access to combatant positions.
 */
export function tryParseAttackText(input: string, roster: LlmRoster): ParsedAttackText | null {
  // Fast path: explicit entity-ID from programmatic clients (e.g. the web canvas).
  // Accepts "attack @id:<entityId>" — bypasses roster name lookup entirely.
  const idMatch = input.trim().match(/^(?:attack\s+)?@id:([a-zA-Z0-9_-]+)$/i);
  if (idMatch) {
    return { targetName: `@id:${idMatch[1]}`, nearest: false };
  }

  const normalized = input.trim().toLowerCase();

  // Skip if it's an offhand/bonus attack
  const stripped = normalized.replace(/[^a-z0-9]+/g, "");
  if (/offhandattack|offhandstrike|offhand$|bonusattack|twoweaponattack/.test(stripped)) return null;

  // Unarmed strike / punch / kick — recognized BEFORE the generic attack verb check.
  // Returns no weaponHint; target name is optional (defaults to nearest hostile).
  const unarmedVerb = normalized.match(
    /^(?:i\s+|i'll\s+|let\s+me\s+|i\s+will\s+|i\s+want\s+to\s+)?(?:unarmed(?:\s+(?:strike|attack))?|with\s+my\s+fists?|fist\s+attack|fists?|bare\s+hands?|punch|kick)\b(.*)$/,
  );
  if (unarmedVerb) {
    const unarmedRest = unarmedVerb[1]!.trim().replace(/^(?:the|a|an|at|on)\s+/i, "").trim();
    let unarmedTarget: string | undefined;
    if (unarmedRest.length > 0) {
      const ref = findCombatantByName(unarmedRest, roster);
      if (ref) unarmedTarget = unarmedRest;
    }
    return { targetName: unarmedTarget, nearest: !unarmedTarget };
  }

  // Must start with an attack-like verb
  // Allow leading "I" / "i'll" / "let me" etc.
  const attackVerb = normalized.match(
    /^(?:i\s+|i'll\s+|let\s+me\s+|i\s+will\s+|i\s+want\s+to\s+)?(?:attack|strike|hit|slash|stab|punch|kick|fist|swing\s+at|swing\s+my|throw|hurl|toss)\b(.*)$/,
  );
  if (!attackVerb) return null;

  const rest = attackVerb[1]!.trim();
  let nearest = false;
  let targetName: string | undefined;
  let weaponHint: string | undefined;

  // Detect throw-style text: "throw {weapon} at {target}" — weapon comes first
  const isThrowVerb = /^(?:i\s+|i'll\s+|let\s+me\s+|i\s+will\s+|i\s+want\s+to\s+)?(?:throw|hurl|toss)\b/i.test(normalized);
  const throwAtMatch = isThrowVerb
    ? rest.match(/^(?:my\s+|the\s+|a\s+)?(.+?)\s+at\s+(?:the\s+)?(.+?)$/)
    : null;

  // Split on " with " / " using " to separate target from weapon
  const withMatch = !throwAtMatch
    ? rest.match(/^(.*?)\s+(?:with|using)\s+(?:my\s+|the\s+|a\s+)?(.+?)$/)
    : null;

  let targetPart: string;
  if (throwAtMatch) {
    weaponHint = throwAtMatch[1]!.trim();
    targetPart = throwAtMatch[2]!.trim();
  } else if (withMatch) {
    targetPart = withMatch[1]!.trim();
    weaponHint = withMatch[2]!.trim();
  } else {
    targetPart = rest;
  }

  // Strip leading articles/prepositions
  targetPart = targetPart.replace(/^(?:the|a|an|at)\s+/i, "").trim();

  // Check for "nearest" keyword
  if (/^nearest\b/.test(targetPart)) {
    nearest = true;
    targetPart = targetPart.replace(/^nearest\s*/, "").trim();
  }

  // If targetPart is empty, this is "attack with longsword" style (no target named)
  // → pick nearest hostile
  if (targetPart.length > 0) {
    // Verify the target name matches something in the roster
    const ref = findCombatantByName(targetPart, roster);
    if (ref) {
      targetName = targetPart;
    } else {
      // If the text after the verb doesn't match a roster name, it might be
      // "attack with longsword" where "longsword" was parsed as targetPart.
      // In that case, treat it as a weapon hint with no explicit target.
      // But only if we didn't already extract a weapon from "with".
      if (!weaponHint) {
        weaponHint = targetPart;
        targetName = undefined;
      } else {
        // Neither target nor known entity — bail to LLM
        return null;
      }
    }
  }

  return { targetName, weaponHint, nearest: nearest || !targetName };
}

/** Find a combatant in the roster by fuzzy name match or exact @id: protocol. */
export function findCombatantByName(name: string, roster: LlmRoster): CombatantRef | null {
  // Fast path: explicit entity ID from programmatic clients (@id:<entityId> protocol)
  if (name.startsWith("@id:")) {
    const entityId = name.slice(4);
    const charEntry = roster.characters.find((c) => c.id === entityId);
    if (charEntry) return { type: "Character", characterId: entityId };
    const monEntry = roster.monsters.find((m) => m.id === entityId);
    if (monEntry) return { type: "Monster", monsterId: entityId };
    const npcEntry = roster.npcs.find((n) => n.id === entityId);
    if (npcEntry) return { type: "NPC", npcId: entityId };
    return null;
  }

  const normalized = name.toLowerCase();

  // Check characters
  for (const c of roster.characters) {
    if (c.name.toLowerCase().includes(normalized) || normalized.includes(c.name.toLowerCase())) {
      return { type: "Character", characterId: c.id };
    }
  }

  // Check NPCs
  for (const n of roster.npcs) {
    if (n.name.toLowerCase().includes(normalized) || normalized.includes(n.name.toLowerCase())) {
      return { type: "NPC", npcId: n.id };
    }
  }

  // Check monsters
  for (const m of roster.monsters) {
    if (m.name.toLowerCase().includes(normalized) || normalized.includes(m.name.toLowerCase())) {
      return { type: "Monster", monsterId: m.id };
    }
  }

  return null;
}

/**
 * Find ALL combatants matching a fuzzy name.
 * Returns every matching ref (useful for disambiguating same-named monsters).
 */
export function findAllCombatantsByName(name: string, roster: LlmRoster): CombatantRef[] {
  const normalized = name.toLowerCase();
  const results: CombatantRef[] = [];

  for (const c of roster.characters) {
    if (c.name.toLowerCase().includes(normalized) || normalized.includes(c.name.toLowerCase())) {
      results.push({ type: "Character", characterId: c.id });
    }
  }
  for (const n of roster.npcs) {
    if (n.name.toLowerCase().includes(normalized) || normalized.includes(n.name.toLowerCase())) {
      results.push({ type: "NPC", npcId: n.id });
    }
  }
  for (const m of roster.monsters) {
    if (m.name.toLowerCase().includes(normalized) || normalized.includes(m.name.toLowerCase())) {
      results.push({ type: "Monster", monsterId: m.id });
    }
  }
  return results;
}

/** Get a human-readable name for an actor from the roster. */
export function getActorNameFromRoster(actorId: string, roster: LlmRoster): string {
  const char = roster.characters.find((c) => c.id === actorId);
  if (char) return char.name;
  const monster = roster.monsters.find((m) => m.id === actorId);
  if (monster) return monster.name;
  const npc = roster.npcs.find((n) => n.id === actorId);
  if (npc) return npc.name;
  return "The adventurer";
}

/** Resolve a CombatantRef to a display name from the roster. */
export function getNameFromCombatantRef(ref: CombatantRef, roster: LlmRoster): string {
  if (ref.type === "Character") {
    const c = roster.characters.find((ch) => ch.id === (ref as any).characterId);
    if (c) return c.name;
  } else if (ref.type === "Monster") {
    const m = roster.monsters.find((mo) => mo.id === (ref as any).monsterId);
    if (m) return m.name;
  } else if (ref.type === "NPC") {
    const n = roster.npcs.find((np) => np.id === (ref as any).npcId);
    if (n) return n.name;
  }
  return "the target";
}

// ----- Damage utilities -----

/** Extract the modifier from a damage formula string (e.g. "1d8+3" → 3). */
export function parseDamageModifier(formula: unknown, explicit?: number): number {
  if (typeof explicit === "number") return explicit;
  if (typeof formula !== "string") return 0;
  const m = formula.match(/([+-])\s*(\d+)\b/);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  const n = Number(m[2]);
  return Number.isFinite(n) ? sign * n : 0;
}
