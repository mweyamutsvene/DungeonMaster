/**
 * Combat Zone System
 *
 * Represents persistent area effects on the battlefield: auras that move with creatures,
 * placed zones from spells, and stationary terrain-like areas.
 *
 * Zones are stored per-encounter in the CombatMap's `zones` array (alongside cells/entities).
 * They produce effects on combatants based on triggers: entering, starting/ending turns in them,
 * or moving through them square-by-square.
 */

import type { Position } from '../../rules/movement.js';
import type { Ability } from '../core/ability-scores.js';
import type { ActiveEffect, EffectDuration } from './effects.js';

// ──────────────────────────────────────── Types ────────────────────────────────────────

/**
 * Shape of a zone on the combat grid.
 * Circle is the default; other shapes are reserved for future use (Wall of Fire, Cone of Cold).
 */
export type ZoneShape = 'circle' | 'line' | 'cone' | 'cube';

/**
 * How a zone is anchored on the battlefield.
 * - `aura`: Follows the `attachedTo` combatant (Spirit Guardians, Paladin Aura)
 * - `placed`: Stays at `center` (Cloud of Daggers, Moonbeam)
 * - `stationary`: Covers a fixed area, never moves (Spike Growth)
 */
export type ZoneType = 'aura' | 'placed' | 'stationary';

/**
 * When a zone effect triggers.
 * - `on_enter`: First time a creature enters the zone on a turn (or starts turn there)
 * - `on_start_turn`: At the start of a creature's turn while in the zone
 * - `on_end_turn`: At the end of a creature's turn while in the zone
 * - `per_5ft_moved`: Every 5 ft a creature moves inside the zone (Spike Growth)
 * - `passive`: Continuous effect applied while in zone (Paladin Aura save bonus)
 */
export type ZoneEffectTrigger =
  | 'on_enter'
  | 'on_start_turn'
  | 'on_end_turn'
  | 'per_5ft_moved'
  | 'passive';

/**
 * Describes a single mechanical effect of a zone.
 */
export interface ZoneEffect {
  /** When this effect triggers */
  readonly trigger: ZoneEffectTrigger;

  // ── Damage delivery ──
  /** Damage dice rolled when triggered */
  readonly damage?: {
    readonly diceCount: number;
    readonly diceSides: number;
    readonly modifier?: number;
  };
  /** Damage type (e.g., "radiant", "piercing") */
  readonly damageType?: string;

  // ── Saving throw ──
  /** Ability used for the saving throw */
  readonly saveAbility?: Ability;
  /** DC of the saving throw */
  readonly saveDC?: number;
  /** If true, creature takes half damage on a successful save */
  readonly halfDamageOnSave?: boolean;

  // ── Condition application ──
  /** Conditions applied while in zone or on failed save */
  readonly conditions?: readonly string[];

  // ── Passive effect (aura buffs) ──
  /** An ActiveEffect applied to creatures in the zone (Paladin Aura save bonus, etc.) */
  readonly activeEffect?: ActiveEffect;

  // ── Targeting ──
  /** Whether this effect applies to the zone creator's allies (default: false) */
  readonly affectsAllies?: boolean;
  /** Whether this effect applies to the zone creator's enemies (default: true) */
  readonly affectsEnemies?: boolean;
  /** Whether this effect applies to the zone creator themselves (default: false for damage, true for aura buffs) */
  readonly affectsSelf?: boolean;
}

/**
 * A persistent area effect on the combat map.
 */
export interface CombatZone {
  /** Unique identifier */
  readonly id: string;
  /** How this zone is anchored */
  readonly type: ZoneType;
  /** For aura zones: combatant ID the zone follows */
  readonly attachedTo?: string;
  /** Current center position (updated when aura moves) */
  readonly center: Position;
  /** Radius in feet */
  readonly radiusFeet: number;
  /** Shape of the zone */
  readonly shape: ZoneShape;

  /** For line/cone shapes: direction point or line endpoint */
  readonly direction?: Position;
  /** For line shapes: width in feet (default 5) */
  readonly width?: number;

  /** Mechanical effects that this zone applies */
  readonly effects: readonly ZoneEffect[];

  /** Lifetime management — reuses EffectDuration from ActiveEffect system */
  readonly duration: EffectDuration;
  /** For `duration: 'rounds'` — how many rounds remain */
  readonly roundsRemaining?: number;
  /** Name of the spell or feature that created this zone */
  readonly source: string;
  /** Combatant ID of the zone creator (for concentration tracking and faction targeting) */
  readonly sourceCombatantId: string;

  /** Combat round when the zone was created */
  readonly createdAtRound?: number;
  /** Turn index when the zone was created */
  readonly createdAtTurnIndex?: number;
}

// ──────────────────────────────────────── Factory ────────────────────────────────────────

/**
 * Create a new CombatZone with the given parameters.
 */
export function createZone(
  id: string,
  type: ZoneType,
  center: Position,
  radiusFeet: number,
  source: string,
  sourceCombatantId: string,
  effects: ZoneEffect[],
  duration: EffectDuration,
  options?: {
    attachedTo?: string;
    shape?: ZoneShape;
    roundsRemaining?: number;
    createdAtRound?: number;
    createdAtTurnIndex?: number;
    direction?: Position;
    width?: number;
  },
): CombatZone {
  return {
    id,
    type,
    center,
    radiusFeet,
    shape: options?.shape ?? 'circle',
    effects,
    duration,
    source,
    sourceCombatantId,
    ...(options?.attachedTo !== undefined ? { attachedTo: options.attachedTo } : {}),
    ...(options?.roundsRemaining !== undefined ? { roundsRemaining: options.roundsRemaining } : {}),
    ...(options?.createdAtRound !== undefined ? { createdAtRound: options.createdAtRound } : {}),
    ...(options?.createdAtTurnIndex !== undefined ? { createdAtTurnIndex: options.createdAtTurnIndex } : {}),
    ...(options?.direction !== undefined ? { direction: options.direction } : {}),
    ...(options?.width !== undefined ? { width: options.width } : {}),
  };
}

// ──────────────────────────────────────── Queries ────────────────────────────────────────

// ── Shape-specific position detectors ──

function isPositionInCircle(center: Position, radius: number, pos: Position): boolean {
  const dx = center.x - pos.x;
  const dy = center.y - pos.y;
  return Math.sqrt(dx * dx + dy * dy) <= radius + 0.0001;
}

/**
 * Axis-aligned square zone. radiusFeet = half the side length.
 * A 10ft cube centered at (10,10) with radiusFeet=5 covers (5,5) to (15,15).
 */
function isPositionInCube(center: Position, halfSide: number, pos: Position): boolean {
  return Math.abs(center.x - pos.x) <= halfSide + 0.0001
      && Math.abs(center.y - pos.y) <= halfSide + 0.0001;
}

/**
 * Line/wall zone from `start` to `end` with a given width.
 * Position is inside if its perpendicular distance from the line segment ≤ width/2.
 */
function isPositionInLine(start: Position, end: Position | undefined, width: number, pos: Position): boolean {
  if (!end) return false;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 0.0001) {
    // Degenerate: treat as point with radius = width/2
    return Math.sqrt((pos.x - start.x) ** 2 + (pos.y - start.y) ** 2) <= width / 2 + 0.0001;
  }
  // Project pos onto line segment, clamp to [0,1]
  const t = Math.max(0, Math.min(1, ((pos.x - start.x) * dx + (pos.y - start.y) * dy) / lenSq));
  const projX = start.x + t * dx;
  const projY = start.y + t * dy;
  return Math.sqrt((pos.x - projX) ** 2 + (pos.y - projY) ** 2) <= width / 2 + 0.0001;
}

/**
 * Cone zone from `origin` pointing toward `direction`, length = `radiusFeet`.
 * D&D 5e 2024: width at distance d = d (half-angle ≈ 26.6°).
 */
function isPositionInCone(origin: Position, direction: Position | undefined, radiusFeet: number, pos: Position): boolean {
  if (!direction) return false;
  const dx = pos.x - origin.x;
  const dy = pos.y - origin.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.0001) return true; // At origin = in cone
  if (dist > radiusFeet + 0.0001) return false;

  // Direction vector
  const dirDx = direction.x - origin.x;
  const dirDy = direction.y - origin.y;
  const dirLen = Math.sqrt(dirDx * dirDx + dirDy * dirDy);
  if (dirLen < 0.0001) return false;

  // Project onto direction axis
  const normX = dirDx / dirLen;
  const normY = dirDy / dirLen;
  const projDist = dx * normX + dy * normY;
  if (projDist < -0.0001) return false; // Behind origin
  if (projDist > radiusFeet + 0.0001) return false;

  // Perpendicular distance from center line
  const perpX = dx - projDist * normX;
  const perpY = dy - projDist * normY;
  const perpDist = Math.sqrt(perpX * perpX + perpY * perpY);

  // D&D 5e 2024: width at projDist = projDist → half-width = projDist / 2
  return perpDist <= projDist / 2 + 0.0001;
}

/**
 * Check whether a position is inside a zone, dispatching by shape.
 */
export function isPositionInZone(zone: CombatZone, position: Position): boolean {
  switch (zone.shape) {
    case 'cube':
      return isPositionInCube(zone.center, zone.radiusFeet, position);
    case 'line':
      return isPositionInLine(zone.center, zone.direction, zone.width ?? 5, position);
    case 'cone':
      return isPositionInCone(zone.center, zone.direction, zone.radiusFeet, position);
    case 'circle':
    default:
      return isPositionInCircle(zone.center, zone.radiusFeet, position);
  }
}

/**
 * Find all zones at a given position from a list of zones.
 */
export function getZonesAtPosition(zones: readonly CombatZone[], position: Position): CombatZone[] {
  return zones.filter(z => isPositionInZone(z, position));
}

/**
 * Determine if a zone should target a particular combatant based on faction targeting rules.
 *
 * @param effect The zone effect to check
 * @param combatantId The combatant being checked
 * @param sourceCombatantId The zone creator's combatant ID
 * @param areSameFaction True if combatant and source are on the same faction (both PCs, both monsters, etc.)
 */
export function doesZoneEffectAffect(
  effect: ZoneEffect,
  combatantId: string,
  sourceCombatantId: string,
  areSameFaction: boolean,
): boolean {
  const isSelf = combatantId === sourceCombatantId;

  if (isSelf) {
    return effect.affectsSelf ?? false;
  }

  if (areSameFaction) {
    return effect.affectsAllies ?? false;
  }

  // Different faction → enemy
  return effect.affectsEnemies ?? true;
}

// ──────────────────────────────────────── Mutations ────────────────────────────────────────

/**
 * Move an aura zone's center to match its attached combatant's new position.
 * Returns a new zone with updated center, or the same zone if it's not an aura.
 */
export function syncAuraZoneCenter(zone: CombatZone, newCenter: Position): CombatZone {
  if (zone.type !== 'aura') return zone;
  return { ...zone, center: newCenter };
}

/**
 * Decrement `roundsRemaining` for a zone with `duration: 'rounds'`.
 * Returns null if the zone has expired (0 or fewer rounds remaining).
 */
export function decrementZoneRounds(zone: CombatZone): CombatZone | null {
  if (zone.duration !== 'rounds' || zone.roundsRemaining === undefined) return zone;
  const remaining = zone.roundsRemaining - 1;
  if (remaining <= 0) return null;
  return { ...zone, roundsRemaining: remaining };
}

/**
 * Remove all zones from a concentration caster.
 * Called when concentration breaks.
 */
export function removeConcentrationZones(
  zones: readonly CombatZone[],
  sourceCombatantId: string,
): CombatZone[] {
  return zones.filter(
    z => !(z.duration === 'concentration' && z.sourceCombatantId === sourceCombatantId),
  );
}

/**
 * Get all effects from a list of zones that would trigger at a specific time
 * for a combatant at a given position.
 */
export function getTriggeredZoneEffects(
  zones: readonly CombatZone[],
  trigger: ZoneEffectTrigger,
  position: Position,
  combatantId: string,
  isSameFactionAs: (sourceCombatantId: string) => boolean,
): Array<{ zone: CombatZone; effect: ZoneEffect }> {
  const results: Array<{ zone: CombatZone; effect: ZoneEffect }> = [];

  for (const zone of zones) {
    if (!isPositionInZone(zone, position)) continue;

    for (const effect of zone.effects) {
      if (effect.trigger !== trigger) continue;
      if (!doesZoneEffectAffect(effect, combatantId, zone.sourceCombatantId, isSameFactionAs(zone.sourceCombatantId))) continue;
      results.push({ zone, effect });
    }
  }

  return results;
}

/**
 * Get all passive zone effects that apply to a combatant at a position.
 * Used for aura buffs (Paladin Aura, etc.)
 */
export function getPassiveZoneEffects(
  zones: readonly CombatZone[],
  position: Position,
  combatantId: string,
  isSameFactionAs: (sourceCombatantId: string) => boolean,
): Array<{ zone: CombatZone; effect: ZoneEffect }> {
  return getTriggeredZoneEffects(zones, 'passive', position, combatantId, isSameFactionAs);
}

/**
 * Calculate a flat saving throw bonus from passive zone effects at a position.
 * Returns the sum of all applicable passive zone ActiveEffect bonuses targeting `saving_throws`.
 */
export function getPassiveZoneSaveBonus(
  zones: readonly CombatZone[],
  position: Position,
  combatantId: string,
  isSameFactionAs: (sourceCombatantId: string) => boolean,
  ability?: string,
): number {
  const passives = getPassiveZoneEffects(zones, position, combatantId, isSameFactionAs);
  let bonus = 0;
  for (const { effect } of passives) {
    const ae = effect.activeEffect;
    if (!ae) continue;
    if (ae.target !== 'saving_throws') continue;
    // If effect is ability-specific, only apply if matching
    if (ae.ability && ability && ae.ability !== ability) continue;
    if (ae.type === 'bonus') bonus += ae.value ?? 0;
    if (ae.type === 'penalty') bonus -= ae.value ?? 0;
  }
  return bonus;
}
