export type LlmRole = "system" | "user" | "assistant";

export type LlmMessage = {
  role: LlmRole;
  content: string;
};

export type LlmGenerateOptions = {
  model: string;
  temperature?: number;
  seed?: number;
  timeoutMs?: number;
};

export type LlmChatInput = {
  messages: LlmMessage[];
  options: LlmGenerateOptions;
};

export interface LlmProvider {
  chat(input: LlmChatInput): Promise<string>;
}
