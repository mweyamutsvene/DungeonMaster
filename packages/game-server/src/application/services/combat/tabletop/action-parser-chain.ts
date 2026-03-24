/**
 * ActionParserChain – pluggable text-to-action parsing + dispatch entries.
 *
 * Each entry pairs a pure `tryParse` function (returns T | null) with an
 * async `handle` method that executes the action.  The ActionDispatcher
 * iterates the chain in order and returns the first match — short-circuit
 * semantics identical to the former if/else cascade, but far easier to
 * extend.
 */

import type { LlmRoster } from "../../../commands/game-command.js";
import type {
  SessionCharacterRecord,
  SessionMonsterRecord,
  SessionNPCRecord,
} from "../../../types.js";
import type { ActionParseResult } from "./tabletop-types.js";

// ─── Public types ──────────────────────────────────────────────────────

/**
 * Context passed to every parser's `handle()` method.
 */
export interface DispatchContext {
  sessionId: string;
  encounterId: string;
  actorId: string;
  text: string;
  characters: SessionCharacterRecord[];
  monsters: SessionMonsterRecord[];
  npcs: SessionNPCRecord[];
  roster: LlmRoster;
}

/**
 * One entry in the parser chain.
 *
 * Generic `T` is the parse-result type (e.g. `{ x: number; y: number }`
 * for the move parser, `true` for boolean parsers).
 *
 * - `tryParse` must be pure & synchronous.  Return `null` for "no match".
 * - `handle` receives the non-null parse result and executes the action.
 */
export interface ActionParserEntry<T = unknown> {
  readonly id: string;
  tryParse(text: string, roster: LlmRoster): T | null;
  handle(parsed: T, ctx: DispatchContext): Promise<ActionParseResult>;
}
