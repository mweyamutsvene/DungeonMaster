import type { JsonValue } from "../types.js";

export type SessionNPCRecord = {
  id: string;
  sessionId: string;
  name: string;
  statBlock: JsonValue;
  faction: string;
  aiControlled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateNPCInput = {
  id: string;
  name: string;
  statBlock: JsonValue;
  faction?: string;
  aiControlled?: boolean;
};

export interface INPCRepository {
  createInSession(sessionId: string, input: CreateNPCInput): Promise<SessionNPCRecord>;
  getById(id: string): Promise<SessionNPCRecord | null>;
  getManyByIds(ids: string[]): Promise<SessionNPCRecord[]>;
  listBySession(sessionId: string): Promise<SessionNPCRecord[]>;
  delete(id: string): Promise<void>;
}
