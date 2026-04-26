import type { JsonValue, SessionNPCRecord } from "../types.js";

export type CreateStatBlockNPCInput = {
  id: string;
  name: string;
  statBlock: JsonValue;
  className?: never;
  level?: never;
  sheet?: never;
  faction?: string;
  aiControlled?: boolean;
};

export type CreateClassBackedNPCInput = {
  id: string;
  name: string;
  className: string;
  level: number;
  sheet: JsonValue;
  statBlock?: never;
  faction?: string;
  aiControlled?: boolean;
};

export type CreateNPCInput = CreateStatBlockNPCInput | CreateClassBackedNPCInput;

export interface INPCRepository {
  createInSession(sessionId: string, input: CreateNPCInput): Promise<SessionNPCRecord>;
  createMany(sessionId: string, inputs: CreateNPCInput[]): Promise<SessionNPCRecord[]>;
  getById(id: string): Promise<SessionNPCRecord | null>;
  getManyByIds(ids: string[]): Promise<SessionNPCRecord[]>;
  listBySession(sessionId: string): Promise<SessionNPCRecord[]>;
  updateStatBlock(id: string, data: Partial<Record<string, unknown>>): Promise<SessionNPCRecord>;
  delete(id: string): Promise<void>;
}
