/**
 * Shared JSON helper utilities for safe access to untyped JSON blobs.
 *
 * Used throughout the application layer to read fields from Prisma JsonValue objects
 * (character sheets, monster stat blocks, combatant resources, etc.).
 */

/** Type guard for plain objects — excludes arrays. */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Safely read a string value from a JSON object. Returns undefined if absent or wrong type. */
export function readString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === "string" ? v : undefined;
}

/**
 * Safely read a finite number value from a JSON object.
 * Returns null if absent, wrong type, or non-finite (NaN / Infinity).
 */
export function readNumber(obj: Record<string, unknown>, key: string): number | null {
  const v = obj[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Safely read a boolean value from a JSON object. Returns null if absent or wrong type. */
export function readBoolean(obj: Record<string, unknown>, key: string): boolean | null {
  const v = obj[key];
  return typeof v === "boolean" ? v : null;
}

/** Safely read an array value from a JSON object. Returns undefined if absent or wrong type. */
export function readArray<T = unknown>(obj: Record<string, unknown>, key: string): T[] | undefined {
  const v = obj[key];
  return Array.isArray(v) ? (v as T[]) : undefined;
}

/** Safely read a plain-object value from a JSON object. Returns undefined if absent, wrong type, or an array. */
export function readObject(obj: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const v = obj[key];
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}
