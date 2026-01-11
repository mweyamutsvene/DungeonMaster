export function extractFirstJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("LLM output did not contain a JSON object");
  }

  const candidate = text.slice(start, end + 1);
  return JSON.parse(candidate);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assertString(value: unknown, name: string): string {
  if (typeof value !== "string") throw new Error(`Expected ${name} to be a string`);
  return value;
}

export function assertArray(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Expected ${name} to be an array`);
  return value;
}
