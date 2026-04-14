/**
 * Mounted Combat — Domain Types & Helpers
 *
 * D&D 5e 2024 mounted combat foundation types.
 * Core mount/dismount mechanics are implemented as pure functions.
 * Full combat service integration is deferred:
 *
 * TODO: Integrate with CombatService turn order (controlled mount shares rider initiative)
 * TODO: Handle forced movement dismount saves (DC 10 Dex save)
 * TODO: Handle prone-while-mounted reaction dismount (DC 10 Dex save)
 * TODO: Movement syncing for controlled mounts (rider and mount move together)
 * TODO: Controlled mount action restriction (Dash/Disengage/Dodge only)
 * TODO: Independent mount AI turn logic
 */

import type { CreatureSize } from "../entities/core/types.js";

// ─── Types ─────────────────────────────────────────────────────────────

/** How the rider controls the mount. */
export type MountControlMode = "controlled" | "independent";

/**
 * Represents an active mount/rider pairing in combat.
 *
 * While mounted:
 * - Controlled: mount acts on rider's initiative, limited to Dash/Disengage/Dodge
 * - Independent: mount acts on its own initiative with full action economy
 */
export interface MountState {
  /** Entity ID of the mount creature */
  mountId: string;
  /** Entity ID of the rider creature */
  riderId: string;
  /** Whether the rider controls the mount or it acts independently */
  controlMode: MountControlMode;
}

/** Minimal creature data needed for mount checks. */
export interface MountableCreature {
  id: string;
  size: CreatureSize;
  speed: number;
}

// ─── Size ordering (reusable) ──────────────────────────────────────────

const SIZE_ORDER: readonly CreatureSize[] = [
  "Tiny",
  "Small",
  "Medium",
  "Large",
  "Huge",
  "Gargantuan",
] as const;

function sizeIndex(size: CreatureSize): number {
  return SIZE_ORDER.indexOf(size);
}

// ─── Active mount tracking (per-encounter, in-memory) ──────────────────

/** Map of riderId → MountState for quick lookup. */
const activeMounts = new Map<string, MountState>();

// ─── Helpers ───────────────────────────────────────────────────────────

/**
 * D&D 5e 2024: A willing creature that is at least one size larger
 * than the rider can serve as a mount.
 *
 * @returns true if the mount is at least one size category larger than the rider
 */
export function canMount(riderSize: CreatureSize, mountSize: CreatureSize): boolean {
  return sizeIndex(mountSize) >= sizeIndex(riderSize) + 1;
}

/**
 * Check if a rider can mount a specific creature.
 * Validates the size requirement (mount must be at least one size larger).
 */
export function canMountCreature(rider: MountableCreature, mount: MountableCreature): boolean {
  return canMount(rider.size, mount.size);
}

/**
 * D&D 5e 2024: Mounting or dismounting costs half the rider's movement speed.
 *
 * @param riderSpeed – Rider's base walking speed in feet
 * @returns The movement cost in feet to mount or dismount
 */
export function getMountingCost(riderSpeed: number): number {
  return Math.floor(riderSpeed / 2);
}

/**
 * Check if a creature is currently mounted (has an active mount state).
 */
export function isMounted(creatureId: string): boolean {
  return activeMounts.has(creatureId);
}

/**
 * Get the mount state for a rider, if any.
 */
export function getMountState(riderId: string): MountState | undefined {
  return activeMounts.get(riderId);
}

/**
 * Get the effective movement speed while mounted (uses mount's speed).
 * Returns the mount's speed, or 0 if the creature is not mounted.
 */
export function getMountSpeed(mount: MountableCreature): number {
  return mount.speed;
}

/**
 * Mount a creature. Validates the size requirement.
 * Returns the new MountState, or undefined if the mount is invalid.
 *
 * @param rider - The creature mounting
 * @param mount - The creature being mounted
 * @param controlMode - "controlled" (rider directs) or "independent" (mount acts on own)
 */
export function mountCreature(
  rider: MountableCreature,
  mount: MountableCreature,
  controlMode: MountControlMode = "controlled",
): MountState | undefined {
  if (!canMountCreature(rider, mount)) return undefined;

  const state: MountState = {
    mountId: mount.id,
    riderId: rider.id,
    controlMode,
  };
  activeMounts.set(rider.id, state);
  return state;
}

/**
 * Dismount a rider. PHB 2024: dismounting costs half the rider's movement speed.
 *
 * @param riderId - The creature dismounting
 * @returns The movement cost in feet spent to dismount, or 0 if not mounted
 */
export function dismount(riderId: string, riderSpeed: number): number {
  if (!activeMounts.has(riderId)) return 0;
  activeMounts.delete(riderId);
  return getMountingCost(riderSpeed);
}

/**
 * Clear all active mount states. Call at encounter end or for testing.
 */
export function clearMountStates(): void {
  activeMounts.clear();
}
