/**
 * Shared validation helpers for ability executors.
 *
 * Each helper returns a failed AbilityExecutionResult when a prerequisite is
 * not met, or null when the check passes.  The caller early-returns on non-null:
 *
 *   const err = requireActor(params); if (err) return err;
 *   const err2 = requireClassFeature(params, ACTION_SURGE, "Action Surge (requires Fighter level 2+)"); if (err2) return err2;
 */

import type { AbilityExecutionResult } from "../../../../../domain/abilities/ability-executor.js";
import { classHasFeature } from "../../../../../domain/entities/classes/registry.js";

// ─── Param guards ────────────────────────────────────────────────────────────

/** Returns MISSING_ACTOR if `params.actor` is absent. */
export function requireActor(
  params: Record<string, unknown> | undefined,
): AbilityExecutionResult | null {
  return params?.actor
    ? null
    : { success: false, summary: "No actor reference in params", error: "MISSING_ACTOR" };
}

/** Returns MISSING_SHEET if `params.sheet` is absent. */
export function requireSheet(
  params: Record<string, unknown> | undefined,
): AbilityExecutionResult | null {
  return params?.sheet
    ? null
    : { success: false, summary: "No character sheet in params", error: "MISSING_SHEET" };
}

/** Returns MISSING_RESOURCES if `params.resources` is absent. */
export function requireResources(
  params: Record<string, unknown> | undefined,
): AbilityExecutionResult | null {
  return params?.resources
    ? null
    : { success: false, summary: "No resources provided", error: "MISSING_RESOURCES" };
}

// ─── Class info extraction ────────────────────────────────────────────────────

/**
 * Extract subclass ID from executor params.
 * Normalizes to lowercase-with-dashes (e.g., "Open Hand" → "open-hand").
 */
export function extractSubclassId(params: Record<string, unknown> | undefined): string | undefined {
  const sheet = params?.sheet as Record<string, unknown> | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actorRef = params?.actor as any;
  const raw =
    (params?.subclass as string | undefined) ??
    (sheet?.subclass as string | undefined) ??
    (typeof actorRef?.getSubclass === "function" ? (actorRef.getSubclass() as string) : undefined);
  return raw ? raw.toLowerCase().replace(/\s+/g, "-") : undefined;
}

/**
 * Extract level and className from executor params.
 *
 * Lookup precedence (first wins):
 *   params.level / params.className → params.sheet.level / .className → actorRef.getLevel() / .getClassId()
 */
export function extractClassInfo(params: Record<string, unknown> | undefined): {
  level: number;
  className: string;
} {
  const sheet = params?.sheet as Record<string, unknown> | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actorRef = params?.actor as any;

  const level =
    (params?.level as number | undefined) ??
    (sheet?.level as number | undefined) ??
    (typeof actorRef?.getLevel === "function" ? (actorRef.getLevel() as number) : undefined) ??
    1;

  const className =
    (params?.className as string | undefined) ??
    (sheet?.className as string | undefined) ??
    (typeof actorRef?.getClassId === "function" ? (actorRef.getClassId() as string) : undefined) ??
    "";

  return { level, className };
}

// ─── Feature gate ─────────────────────────────────────────────────────────────

/**
 * Returns MISSING_FEATURE if the character does not have the specified class feature.
 *
 * @param featureKey  Feature key constant from `feature-keys.ts`
 * @param displayName Human-readable description (e.g. "Action Surge (requires Fighter level 2+)")
 */
export function requireClassFeature(
  params: Record<string, unknown> | undefined,
  featureKey: string,
  displayName: string,
): AbilityExecutionResult | null {
  const { level, className } = extractClassInfo(params);
  const subclassId = extractSubclassId(params);
  return classHasFeature(className, featureKey, level, subclassId)
    ? null
    : {
        success: false,
        summary: `This character does not have ${displayName}`,
        error: "MISSING_FEATURE",
      };
}
