/**
 * Lightweight prompt builder for LLM system/user messages.
 *
 * Sections are stored in insertion order. Named sections allow conditional inclusion,
 * removal, and structured assembly without fragile string concatenation.
 *
 * Convention for buildAsMessages():
 *   - Section named "system" → becomes the system message (role: "system")
 *   - All other sections → joined and become the user message (role: "user")
 *
 * Layer: Infrastructure (LLM utility)
 */
export class PromptBuilder {
  private readonly sections: Map<string, string> = new Map();
  private readonly version: string;

  constructor(version: string) {
    this.version = version;
  }

  /** Add or replace a named section. Returns `this` for chaining. */
  addSection(name: string, content: string): this {
    this.sections.set(name, content);
    return this;
  }

  /** Add a named section only when `condition` is true. Returns `this` for chaining.
   *
   * NOTE: `content` is always evaluated by the caller before this call (JavaScript
   * eager evaluation). Guard nullable access in the calling code before passing content.
   */
  addSectionIf(condition: boolean, name: string, content: string): this {
    if (condition) {
      this.sections.set(name, content);
    }
    return this;
  }

  /** Remove a section by name (no-op if absent). Returns `this` for chaining. */
  removeSection(name: string): this {
    this.sections.delete(name);
    return this;
  }

  /** Concatenate all sections in insertion order, separated by double newlines. */
  build(): string {
    return [...this.sections.values()].join("\n\n");
  }

  /**
   * Split sections into system + user messages for LLM chat APIs.
   *
   * The section named "system" becomes role:"system".
   * All other sections are joined and become role:"user".
   * If either part is empty it is omitted from the result.
   */
  buildAsMessages(): Array<{ role: "system" | "user"; content: string }> {
    const systemParts: string[] = [];
    const userParts: string[] = [];

    for (const [name, content] of this.sections) {
      if (name === "system") {
        systemParts.push(content);
      } else {
        userParts.push(content);
      }
    }

    const messages: Array<{ role: "system" | "user"; content: string }> = [];
    if (systemParts.length > 0) {
      messages.push({ role: "system", content: systemParts.join("\n\n") });
    }
    if (userParts.length > 0) {
      messages.push({ role: "user", content: userParts.join("\n\n") });
    }
    return messages;
  }

  getVersion(): string {
    return this.version;
  }

  /**
   * Estimate the total token count across all sections.
   * Uses ~4 characters per token heuristic.
   */
  estimateTokens(): number {
    let totalChars = 0;
    for (const content of this.sections.values()) {
      totalChars += content.length;
    }
    return Math.ceil(totalChars / 4);
  }
}
