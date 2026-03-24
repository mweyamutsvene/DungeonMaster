import type { JsonValue } from "../../application/types.js";
import { llmDebugLog } from "./debug.js";
import type { LlmProvider } from "./types.js";

export interface INarrativeGenerator {
  narrate(input: { storyFramework: JsonValue; events: JsonValue[]; seed?: number }): Promise<string>;
}

/**
 * Minimal narration wrapper.
 *
 * This will eventually become the "events -> narrative" step used by the CLI/UI.
 *
 * Layer: Infrastructure (LLM adapter).
 * Notes: Generates prose only; must not invent or decide rule outcomes.
 */
export class NarrativeGenerator implements INarrativeGenerator {
  constructor(
    private readonly llm: LlmProvider,
    private readonly config: { model: string; temperature?: number; timeoutMs?: number },
  ) {}

  // TODO: Migrate inline messages construction to PromptBuilder (see prompt-builder.ts)
  async narrate(input: { storyFramework: JsonValue; events: JsonValue[]; seed?: number }): Promise<string> {
    const messages = [
        {
          role: "system",
          content:
            [
              "You are the narrator for a D&D session.",
              "Write 1-2 concise, vivid sentences describing ONLY what is explicitly present in the events.",
              "CRITICAL: Do not invent rule outcomes. If a roll has not happened yet, do not claim success/failure.",
              "CRITICAL: Do not invent weapons (no blades/swords/daggers unless explicitly specified). If a weaponName is present in the payload, you MUST mention that weapon by name. Only say 'fists' or 'strike' if the weaponName is 'Unarmed Strike' or absent.",
              "CRITICAL: Do not invent spells, NPCs, locations, scenery (forests/tunnels/shadows/dust), or backstory beyond the event payload.",
              "CRITICAL: Use pronouns that match established character gender consistently (no swapping he/she).",
              "CRITICAL: Never refer to yourself as 'the narrator' or say lines like 'the narrator intones'.",
              "CRITICAL: Use ONLY the actorName and targetName as they appear in the event payload. Do not use any other names. Do not use 'Aragorn', 'hero', 'adventurer' or any name not present in the event payload.",
              "If the payload includes constraints, follow them.",
            ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              storyFramework: input.storyFramework,
              events: input.events,
            },
            null,
            2,
          ),
        },
      ] as const;

    const options = {
      model: this.config.model,
      temperature: this.config.temperature,
      seed: input.seed,
      timeoutMs: this.config.timeoutMs,
    };

    llmDebugLog("narrate.request", { input: { seed: input.seed }, messages, options });
    const raw = await this.llm.chat({ messages: [...messages], options });
    llmDebugLog("narrate.response", { raw });
    return raw;
  }
}
