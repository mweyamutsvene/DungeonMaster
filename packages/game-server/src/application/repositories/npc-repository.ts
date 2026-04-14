import type { JsonValue, SessionNPCRecord } from "../types.js";

export type CreateNPCInput = {
  id: string;
  name: string;
  statBlock: JsonValue;
  faction?: string;
  aiControlled?: boolean;
};

export interface INPCRepository {
  createInSession(sessionId: string, input: CreateNPCInput): Promise<SessionNPCRecord>;
  createMany(sessionId: string, inputs: CreateNPCInput[]): Promise<SessionNPCRecord[]>;
  getById(id: string): Promise<SessionNPCRecord | null>;
  getManyByIds(ids: string[]): Promise<SessionNPCRecord[]>;
  listBySession(sessionId: string): Promise<SessionNPCRecord[]>;
  updateStatBlock(id: string, data: Partial<Record<string, unknown>>): Promise<SessionNPCRecord>;
  delete(id: string): Promise<void>;
}
