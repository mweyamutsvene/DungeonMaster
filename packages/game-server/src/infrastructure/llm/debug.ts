function isDebugEnabled(): boolean {
  const v = process.env.DM_LLM_DEBUG;
  if (!v) return false;
  return v === "1" || v.toLowerCase() === "true" || v.toLowerCase() === "yes";
}

function safeSerialize(value: unknown): string {
  return JSON.stringify(
    value,
    (_k, val) => {
      if (typeof val === "bigint") return Number(val);
      return val;
    },
    2,
  );
}

export function llmDebugLog(event: string, payload: unknown): void {
  if (!isDebugEnabled()) return;

  const line = {
    ts: new Date().toISOString(),
    event: `llm.${event}`,
    payload,
  };

  // Keep it simple: pino logger isn't easily threaded through here.
  // This is gated behind DM_LLM_DEBUG.
  // eslint-disable-next-line no-console
  console.log(safeSerialize(line));
}
