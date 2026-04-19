/**
 * SpellDeliveryHandler — interface + shared context type for spell delivery strategy pattern.
 *
 * Each delivery mode (attack roll, save, healing, buff/debuff, zone) implements
 * SpellDeliveryHandler. SpellActionHandler dispatches via find(h => h.canHandle(spell)).
 */

import type { PreparedSpellDefinition } from '../../../../../domain/entities/spells/prepared-spell-definition.js';
import type { LlmRoster } from '../../../../commands/game-command.js';
import type { ActionParseResult, TabletopCombatServiceDeps } from '../tabletop-types.js';
import type { TabletopEventEmitter } from '../tabletop-event-emitter.js';
import type { SavingThrowResolver } from '../rolls/saving-throw-resolver.js';
import type { SessionCharacterRecord, CombatEncounterRecord, CombatantStateRecord } from '../../../../types.js';
import type { CombatantRef } from '../../helpers/combatant-ref.js';
import type { CharacterSheet } from '../../helpers/hydration-types.js';

/**
 * All data needed for a spell cast, resolved once by SpellActionHandler before dispatch.
 * Encounter state is fetched AFTER slot spending so resources reflect the deduction.
 */
export interface SpellCastingContext {
  sessionId: string;
  encounterId: string;
  actorId: string;
  castInfo: { spellName: string; targetName?: string; castAtLevel?: number };
  spellMatch: PreparedSpellDefinition;
  spellLevel: number;
  /** The effective slot level consumed (equals castAtLevel if upcasting, else spellLevel). */
  castAtLevel?: number;
  isConcentration: boolean;
  /** Whether this spell uses the bonus action (from catalog or text detection). */
  isBonusAction: boolean;
  /** Character sheet — typed from the raw JSON stored in SQLite. */
  sheet: CharacterSheet | null;
  characters: SessionCharacterRecord[];
  actor: CombatantRef;
  roster: LlmRoster;
  /** Current encounter (fetched after slot spending) */
  encounter: CombatEncounterRecord;
  /** All combatants in the encounter (fetched after slot spending) */
  combatants: CombatantStateRecord[];
  /** The caster's combatant entry (fetched after slot spending) */
  actorCombatant: CombatantStateRecord | undefined;
}

/**
 * Shared dependencies injected into every delivery handler.
 */
export interface SpellDeliveryDeps {
  deps: TabletopCombatServiceDeps;
  eventEmitter: TabletopEventEmitter;
  debugLogsEnabled: boolean;
  savingThrowResolver: SavingThrowResolver | null;
}

/**
 * Strategy interface for spell delivery modes.
 */
export interface SpellDeliveryHandler {
  /** Returns true if this handler should process the given spell. */
  canHandle(spell: PreparedSpellDefinition): boolean;
  /** Executes the delivery. Context includes fully-resolved encounter state. */
  handle(ctx: SpellCastingContext): Promise<ActionParseResult>;
}
