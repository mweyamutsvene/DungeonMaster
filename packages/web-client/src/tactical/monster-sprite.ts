// Generic monster sprite loader — idle, run animation, and death animation.
// All frames are cached by a key derived from the full profile path set so
// HMR-cleared module caches are detected and reloaded automatically.

import type { Facing } from "./hero-sprite.js";
import type { SpriteProfile } from "./sprite-profile.js";

const FACINGS: Facing[] = ["north", "south", "east", "west"];

export interface MonsterSpriteSet {
  idle: Partial<Record<Facing, HTMLImageElement>>;
  run: Partial<Record<Facing, HTMLImageElement[]>>;
  death: HTMLImageElement[];
}

const caches = new Map<string, MonsterSpriteSet>();
const pending = new Map<string, Promise<MonsterSpriteSet>>();

function cacheKey(profile: SpriteProfile): string {
  const idlePart  = FACINGS.map((f) => profile.idlePaths[f] ?? "").join("|");
  const runPart   = FACINGS.map((f) => (profile.runAnimationPaths?.[f] ?? []).join(",")).join("|");
  const deathPart = (profile.deathAnimationPaths ?? []).join(",");
  return `${idlePart}::${runPart}::${deathPart}`;
}

function loadImg(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null); // tolerate missing files gracefully
    img.src = src;
  });
}

/** Loads all sprite frames for a profile (idle + run + death). Cached. */
export function loadMonsterSprites(profile: SpriteProfile): Promise<MonsterSpriteSet> {
  const key = cacheKey(profile);
  if (caches.has(key)) return Promise.resolve(caches.get(key)!);
  if (pending.has(key)) return pending.get(key)!;
  const p = (async () => {
    // Idle frames
    const idleImgs = await Promise.all(
      FACINGS.map((f) => (profile.idlePaths[f] ? loadImg(profile.idlePaths[f]!) : Promise.resolve(null))),
    );
    const idleFallback = idleImgs.find((r) => r !== null) ?? null;
    const idle: Partial<Record<Facing, HTMLImageElement>> = {};
    FACINGS.forEach((f, i) => { const img = idleImgs[i] ?? idleFallback; if (img) idle[f] = img; });

    // Run animation frames
    const run: Partial<Record<Facing, HTMLImageElement[]>> = {};
    if (profile.runAnimationPaths) {
      for (const f of FACINGS) {
        const paths = profile.runAnimationPaths[f];
        if (paths?.length) {
          const frames = (await Promise.all(paths.map(loadImg))).filter((img): img is HTMLImageElement => img !== null);
          if (frames.length > 0) run[f] = frames;
        }
      }
    }

    // Death animation frames
    const death: HTMLImageElement[] = [];
    if (profile.deathAnimationPaths?.length) {
      for (const img of await Promise.all(profile.deathAnimationPaths.map(loadImg))) {
        if (img) death.push(img);
      }
    }

    const set: MonsterSpriteSet = { idle, run, death };
    caches.set(key, set);
    return set;
  })();
  pending.set(key, p);
  return p;
}

/** Returns the cached sprite set for a profile, or null if not yet loaded. */
export function getMonsterSprites(profile: SpriteProfile): MonsterSpriteSet | null {
  const key = cacheKey(profile);
  return caches.has(key) ? (caches.get(key) ?? null) : null;
}

export interface DrawMonsterOpts {
  /** Play run animation (ignored when deathFrameIndex is set). */
  running?: boolean;
  /** Which death animation frame to show. null = alive. Clamped to last frame. */
  deathFrameIndex?: number | null;
  /** performance.now() for animation cycling. */
  now?: number;
}

/**
 * Draw a monster sprite centered at (cx, cy).
 * Priority: death frame > run animation > idle.
 * Returns false if sprites not loaded yet.
 */
export function drawMonsterSprite(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  facing: Facing,
  profile: SpriteProfile,
  opts: DrawMonsterOpts = {},
): boolean {
  const sprites = getMonsterSprites(profile);
  if (!sprites) return false;
  const { running = false, deathFrameIndex = null, now = 0 } = opts;

  let img: HTMLImageElement | undefined;
  if (deathFrameIndex !== null && sprites.death.length > 0) {
    img = sprites.death[Math.min(deathFrameIndex, sprites.death.length - 1)];
  } else if (running) {
    const frames = sprites.run[facing] ?? sprites.run.south ?? sprites.run.north ?? sprites.run.east ?? sprites.run.west;
    if (frames?.length) {
      img = frames[Math.floor(now / (profile.runFrameMs ?? 100)) % frames.length];
    }
  }
  if (!img) {
    img = sprites.idle[facing] ?? sprites.idle.south ?? sprites.idle.north ?? sprites.idle.east ?? sprites.idle.west;
  }
  if (!img) return false;
  ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
  return true;
}
