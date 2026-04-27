// Mirrors the GameEventInput union from game-server's event-repository.
// Keep in sync when the server adds new event types.

export interface CombatantRef {
  type: "Character" | "Monster" | "NPC";
  characterId?: string;
  monsterId?: string;
  npcId?: string;
}

export interface Position {
  x: number;
  y: number;
}

// --- Payloads ---

export interface CombatStartedPayload { encounterId: string }
export interface CombatEndedPayload { encounterId: string; result: string; reason?: string }
export interface TurnAdvancedPayload { encounterId: string; round: number; turn: number }

export interface DamageAppliedPayload {
  encounterId: string;
  target: CombatantRef;
  amount: number;
  hpCurrent: number;
  [key: string]: unknown;
}

export interface HealingAppliedPayload {
  encounterId: string;
  healer: CombatantRef;
  target: CombatantRef;
  amount: number;
  hpCurrent: number;
}

export interface AttackResolvedPayload {
  encounterId: string;
  attacker?: CombatantRef;
  target?: CombatantRef;
  hit?: boolean;
  [key: string]: unknown;
}

export interface ActionResolvedPayload {
  encounterId: string;
  actor: CombatantRef;
  action: string;
  [key: string]: unknown;
}

export interface MovePayload {
  encounterId: string;
  actorId: string;
  from: Position;
  to: Position;
  distanceMoved: number;
  interrupted?: boolean;
}

export interface NarrativeTextPayload {
  encounterId: string;
  actor?: CombatantRef;
  text: string;
}

export interface ReactionPromptPayload {
  encounterId: string;
  pendingActionId: string;
  combatantId: string;
  combatantName: string;
  reactionOpportunity: {
    reactionType: string;
    oaType?: "weapon" | "spell";
    canUse: boolean;
    reason?: string;
    context: Record<string, unknown>;
  };
  actor: CombatantRef;
  actorName: string;
  expiresAt: string;
}

export interface ReactionResolvedPayload {
  encounterId: string;
  pendingActionId: string;
  combatantId: string;
  combatantName: string;
  reactionType: string;
  choice: "use" | "decline";
  result?: unknown;
}

export interface OpportunityAttackPayload {
  encounterId: string;
  attackerId: string;
  attackerName?: string;
  targetId: string;
  attackRoll?: number;
  hit: boolean;
  critical?: boolean;
  damage?: number;
}

export interface DeathSavePayload {
  encounterId: string;
  roll: number;
  result: string;
  deathSaves: { successes: number; failures: number };
  combatantId?: string;
  actor?: CombatantRef;
  hpRestored?: number;
}

// --- Discriminated union (no catch-all — enables TypeScript narrowing) ---

export type ServerEvent =
  | { type: "CombatStarted"; payload: CombatStartedPayload }
  | { type: "CombatEnded"; payload: CombatEndedPayload }
  | { type: "TurnAdvanced"; payload: TurnAdvancedPayload }
  | { type: "DamageApplied"; payload: DamageAppliedPayload }
  | { type: "HealingApplied"; payload: HealingAppliedPayload }
  | { type: "AttackResolved"; payload: AttackResolvedPayload }
  | { type: "ActionResolved"; payload: ActionResolvedPayload }
  | { type: "Move"; payload: MovePayload }
  | { type: "NarrativeText"; payload: NarrativeTextPayload }
  | { type: "ReactionPrompt"; payload: ReactionPromptPayload }
  | { type: "ReactionResolved"; payload: ReactionResolvedPayload }
  | { type: "DeathSave"; payload: DeathSavePayload }
  | { type: "OpportunityAttack"; payload: OpportunityAttackPayload };

export type ServerEventType = ServerEvent["type"];

// Raw wire format before narrowing — used in the SSE hook only.
export interface RawServerEvent {
  type: string;
  payload: unknown;
}
