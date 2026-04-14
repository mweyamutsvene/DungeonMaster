export function extractFirstJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  if (start === -1) {
    throw new Error("LLM output did not contain a JSON object");
  }

  // Track string state to handle braces inside JSON string values
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      if (inString) escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const candidate = text.slice(start, i + 1);
        return JSON.parse(candidate);
      }
    }
  }

  throw new Error("LLM output did not contain a complete JSON object");
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
