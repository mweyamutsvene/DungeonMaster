// Hero sprite asset loader.
// Sprites live in public/sprites/hero/ and are 92x92 top-down frames.
// Metadata provides idle rotations + a Running animation, both with all four
// cardinal facings (north / south / east / west).

export type Facing = "north" | "south" | "east" | "west";

const BASE = "/sprites/hero";

const IDLE_PATHS: Record<Facing, string> = {
  north: `${BASE}/rotations/north.png`,
  south: `${BASE}/rotations/south.png`,
  east: `${BASE}/rotations/east.png`,
  west: `${BASE}/rotations/west.png`,
};

const RUN_FRAME_COUNT = 6;
const RUN_DIR = `${BASE}/animations/Running-e8f89918`;
const FACINGS: Facing[] = ["north", "south", "east", "west"];
const RUN_PATHS: Record<Facing, string[]> = Object.fromEntries(
  FACINGS.map((f) => [
    f,
    Array.from({ length: RUN_FRAME_COUNT }, (_, i) =>
      `${RUN_DIR}/${f}/frame_${String(i).padStart(3, "0")}.png`,
    ),
  ]),
) as Record<Facing, string[]>;

export const RUN_FRAME_MS = 100; // animation cycle speed
export const HERO_SPRITE_PX = 92;

interface LoadedSprites {
  idle: Record<Facing, HTMLImageElement>;
  run: Record<Facing, HTMLImageElement[]>;
}

let cache: LoadedSprites | null = null;
let pending: Promise<LoadedSprites> | null = null;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}

export function loadHeroSprites(): Promise<LoadedSprites> {
  if (cache) return Promise.resolve(cache);
  if (pending) return pending;
  pending = (async () => {
    const [idleN, idleS, idleE, idleW, runN, runS, runE, runW] = await Promise.all([
      loadImage(IDLE_PATHS.north),
      loadImage(IDLE_PATHS.south),
      loadImage(IDLE_PATHS.east),
      loadImage(IDLE_PATHS.west),
      Promise.all(RUN_PATHS.north.map(loadImage)),
      Promise.all(RUN_PATHS.south.map(loadImage)),
      Promise.all(RUN_PATHS.east.map(loadImage)),
      Promise.all(RUN_PATHS.west.map(loadImage)),
    ]);
    cache = {
      idle: { north: idleN, south: idleS, east: idleE, west: idleW },
      run: { north: runN, south: runS, east: runE, west: runW },
    };
    return cache;
  })();
  return pending;
}

export function getHeroSprites(): LoadedSprites | null {
  return cache;
}

/** Derive facing from a movement vector; defaults to fallback if no movement. */
export function facingFromVector(dx: number, dy: number, fallback: Facing = "south"): Facing {
  if (dx === 0 && dy === 0) return fallback;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "east" : "west";
  return dy > 0 ? "south" : "north";
}

/**
 * Derive facing from an isometric grid movement delta (cell units).
 * In 2:1 iso the grid is rotated 45° so a grid step of (+1, 0) projects to
 * screen bottom-right ("east") and (+0, +1) projects to screen bottom-left
 * ("west"). We convert to screen-space before choosing the cardinal sprite.
 */
export function facingFromIsoGrid(gdx: number, gdy: number, fallback: Facing = "south"): Facing {
  if (gdx === 0 && gdy === 0) return fallback;
  // 2:1 iso projection (ignoring HALF_W/HALF_H scaling — only direction matters).
  const sdx = gdx - gdy;  // screen-space x: +ve = right = east
  const sdy = gdx + gdy;  // screen-space y: +ve = down = south
  if (Math.abs(sdx) > Math.abs(sdy)) return sdx > 0 ? "east" : "west";
  return sdy > 0 ? "south" : "north";
}

/**
 * Draw the hero centered at (cx, cy). When `running` is true, animates the
 * running cycle for the facing direction; otherwise draws the idle rotation.
 */
export function drawHeroSprite(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  facing: Facing,
  running: boolean,
  now: number,
): boolean {
  const sprites = cache;
  if (!sprites) return false;

  const img = running
    ? sprites.run[facing][Math.floor(now / RUN_FRAME_MS) % sprites.run[facing].length]
    : sprites.idle[facing];

  ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
  return true;
}
