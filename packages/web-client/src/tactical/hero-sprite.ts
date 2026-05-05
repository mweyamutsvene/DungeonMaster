// Hero sprite asset loader.
// All paths, sheet layout, and per-direction anchors are driven by
// /sprites/hero/metadata.json — no hardcoded sprite measurements here.
// When the hero sprite is user-selectable, swap BASE to the chosen sprite
// folder and the new metadata will carry its own layout + anchor values.

export type Facing = "north" | "south" | "east" | "west" | "northeast" | "northwest" | "southeast" | "southwest";

// ── Metadata types ────────────────────────────────────────────────────────

interface DirectionEntry {
  name: string;
  row: number;
  col: number;
  hCenterX: number;   // character's horizontal visual center as fraction of frame width
  feetAnchorY: number; // character's feet row as fraction of frame height
}

interface SheetMeta {
  path: string;
  layout: { columns: number; rows: number };
  directions: DirectionEntry[];
}

interface RunningDirectionEntry {
  name: string;
  row: number;
  hCenterX: number;
  feetAnchorY: number;
}

interface RunSheetMeta {
  path: string;
  layout: { columns: number; rows: number };
  directions: RunningDirectionEntry[];
}

interface AnimationMeta {
  [facing: string]: string[];
}

interface AtlasEntry {
  x: number;
  y: number;
  width: number;
  height: number;
  file: string;
}

export interface AtlasManifest {
  atlasWidth: number;
  atlasHeight: number;
  sheets: Record<string, AtlasEntry>;
}

interface HeroMetadata {
  frames: {
    neutral_idle_sheet: SheetMeta;
    running_sheet?: RunSheetMeta;
    animations: { [name: string]: AnimationMeta };
  };
  atlas?: { path: string; manifest: string };
}

// ── Runtime frame map built from metadata ─────────────────────────────────

type FrameEntry = { row: number; col: number; hCenterX: number; feetAnchorY: number };

// Filled in when metadata is fetched during loadHeroSprites().
let idleFrameMap: Partial<Record<Facing, FrameEntry>> = {};
let idleSheetCols = 4;
let idleSheetRows = 2;
let idleSheetPath = "/sprites/hero/sheets/neutral-idle-8dir.png";

type RunFrameEntry = { row: number; hCenterX: number; feetAnchorY: number };
let runFrameMap: Partial<Record<Facing, RunFrameEntry>> = {};
let runSheetCols = 6;
let runSheetRows = 8;

const ALL_FACINGS: Facing[] = ["north", "south", "east", "west", "northeast", "northwest", "southeast", "southwest"];

export const RUN_FRAME_MS = 100; // ms per animation frame
export const HERO_SPRITE_PX = 92;

/** Total duration of the unarmed-attack animation (3 frames). */
export const ATTACK_DURATION_MS = 360;
const ATTACK_COLS = 3;

/**
 * Running frames are cropped tightly around the character (~100% fill) while
 * idle frames have ~85% fill. Scale running draws down so both appear the
 * same visual size on screen. Tune this if the difference changes with new art.
 */
const RUN_ATLAS_SCALE = 0.82;

// ── Asset cache ───────────────────────────────────────────────────────────

interface LoadedSprites {
  idleSheet: HTMLImageElement | null;
  run: Record<Facing, HTMLImageElement[]>;
  runSheet: HTMLImageElement | null;
  /** Loaded when metadata.atlas is present — drives both idle and running. */
  atlas?: { img: HTMLImageElement; manifest: AtlasManifest };
}

/**
 * Maps each facing to the atlas sub-sheet key and row-within-sub-sheet.
 * Row 0 is always the first direction in the pair; row 1 is the second.
 * south/north are in running-north-south (south=row0, north=row1).
 * east/west are in running-east-west    (east=row0,  west=row1).
 * Diagonal pairs follow the same pattern.
 */
const RUNNING_DIR_ATLAS: Record<Facing, { key: string; row: number; cols: number }> = {
  south:     { key: "running-north-south", row: 0, cols: 6 },
  north:     { key: "running-north-south", row: 1, cols: 6 },
  east:      { key: "running-east-west",   row: 0, cols: 6 },
  west:      { key: "running-east-west",   row: 1, cols: 6 },
  northeast: { key: "running-ne-nw",       row: 1, cols: 6 },
  northwest: { key: "running-ne-nw",       row: 0, cols: 6 },
  southeast: { key: "running-se-sw",       row: 1, cols: 6 },
  southwest: { key: "running-se-sw",       row: 0, cols: 6 },
};

/** Atlas key for each facing's attack strip (3 frames, single row per sheet). */
const ATTACK_DIR_ATLAS: Record<Facing, string> = {
  north:     "attack-north",
  south:     "attack-south",
  east:      "attack-east",
  west:      "attack-west",
  northeast: "attack-northeast",
  northwest: "attack-northwest",
  southeast: "attack-southeast",
  southwest: "attack-southwest",
};

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

async function fetchHeroMetadata(base: string): Promise<HeroMetadata> {
  const res = await fetch(`${base}/metadata.json`);
  if (!res.ok) throw new Error(`Failed to load hero metadata: ${res.status}`);
  return res.json() as Promise<HeroMetadata>;
}

export function loadHeroSprites(base = "/sprites/hero"): Promise<LoadedSprites> {
  if (cache) return Promise.resolve(cache);
  if (pending) return pending;
  pending = (async () => {
    const meta = await fetchHeroMetadata(base);

    // Build idle frame map from metadata.
    const sheet = meta.frames.neutral_idle_sheet;
    idleSheetPath = `${base}/${sheet.path}`;
    idleSheetCols = sheet.layout.columns;
    idleSheetRows = sheet.layout.rows;
    idleFrameMap = {};
    for (const d of sheet.directions) {
      const facing = d.name as Facing;
      if (ALL_FACINGS.includes(facing)) {
        idleFrameMap[facing] = { row: d.row, col: d.col, hCenterX: d.hCenterX, feetAnchorY: d.feetAnchorY };
      }
    }

    // Build run frame map from metadata (for anchor values — atlas row indices override .row).
    const rsMeta = meta.frames.running_sheet;
    if (rsMeta) {
      runSheetCols = rsMeta.layout.columns;
      runSheetRows = rsMeta.layout.rows;
      runFrameMap = {};
      for (const d of rsMeta.directions) {
        const facing = d.name as Facing;
        if (ALL_FACINGS.includes(facing)) {
          runFrameMap[facing] = { row: d.row, hCenterX: d.hCenterX, feetAnchorY: d.feetAnchorY };
        }
      }
    }

    // ── Atlas path (preferred) ─────────────────────────────────────────────
    // If metadata declares an atlas, load the single combined PNG + manifest.
    // This covers both the idle sheet and all running direction-pair sheets.
    if (meta.atlas) {
      const [manifestRes, atlasImg] = await Promise.all([
        fetch(`${base}/${meta.atlas.manifest}`).then((r) => r.json() as Promise<AtlasManifest>),
        loadImage(`${base}/${meta.atlas.path}`),
      ]);
      cache = {
        idleSheet: null,
        run: { north: [], south: [], east: [], west: [], northeast: [], northwest: [], southeast: [], southwest: [] },
        runSheet: null,
        atlas: { img: atlasImg, manifest: manifestRes },
      };
      return cache;
    }

    // ── Fallback: load individual sheets / per-frame images ────────────────
    let runSheetImg: HTMLImageElement | null = null;
    if (rsMeta) {
      runSheetImg = await loadImage(`${base}/${rsMeta.path}`);
    }

    // Resolve run animation paths from metadata (legacy per-frame format).
    const animEntries = Object.values(meta.frames.animations ?? {});
    const runFramePaths: Partial<Record<Facing, string[]>> = {};
    for (const anim of animEntries) {
      for (const f of ALL_FACINGS) {
        if (anim[f] && !runFramePaths[f]) {
          runFramePaths[f] = anim[f].map((p) => `${base}/${p}`);
        }
      }
    }

    const loadFacing = (f: Facing) =>
      Promise.all((runFramePaths[f] ?? []).map(loadImage));

    const [idleSheetImg, runN, runS, runE, runW] = await Promise.all([
      loadImage(idleSheetPath),
      loadFacing("north"),
      loadFacing("south"),
      loadFacing("east"),
      loadFacing("west"),
    ]);

    cache = {
      idleSheet: idleSheetImg,
      run: { north: runN, south: runS, east: runE, west: runW, northeast: [], northwest: [], southeast: [], southwest: [] },
      runSheet: runSheetImg,
    };
    return cache;
  })();
  return pending;
}

export function getHeroSprites(): LoadedSprites | null {
  return cache;
}

/** Return the pre-loaded idle sprite sheet (or null if not yet loaded / using atlas). */
export function getIdleSheet(): HTMLImageElement | null {
  return cache?.idleSheet ?? null;
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
 * screen bottom-right and (+0, +1) projects to screen bottom-left.
 * Returns all 8 directions including diagonals.
 */
export function facingFromIsoGrid(gdx: number, gdy: number, fallback: Facing = "south"): Facing {
  if (gdx === 0 && gdy === 0) return fallback;
  // 2:1 iso projection (ignoring HALF_W/HALF_H scaling — only direction matters).
  const sdx = gdx - gdy;  // screen-space x: +ve = right
  const sdy = gdx + gdy;  // screen-space y: +ve = down
  const ax = Math.abs(sdx);
  const ay = Math.abs(sdy);
  // Diagonal threshold: if neither axis dominates strongly, use diagonal facing.
  const DIAG = 0.45;
  if (ax > 0 && ay > 0 && ax / (ax + ay) > DIAG && ay / (ax + ay) > DIAG) {
    if (sdx > 0 && sdy > 0) return "southeast";
    if (sdx > 0 && sdy < 0) return "northeast";
    if (sdx < 0 && sdy > 0) return "southwest";
    return "northwest";
  }
  if (ax > ay) return sdx > 0 ? "east" : "west";
  return sdy > 0 ? "south" : "north";
}

/**
 * Draw the hero centered at (cx, cy). When `running` is true, animates the
 * running cycle for the facing direction; otherwise slices the correct frame
 * from the neutral-idle sprite sheet.
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

  if (running) {
    // ── Atlas running animation ──────────────────────────────────────────
    if (sprites.atlas) {
      const dirInfo = RUNNING_DIR_ATLAS[facing];
      const entry = sprites.atlas.manifest.sheets[dirInfo.key];
      if (entry) {
        const anchor = runFrameMap[facing];
        const fw = Math.floor(entry.width / dirInfo.cols);
        const fh = Math.floor(entry.height / 2); // each sub-sheet always has 2 direction rows
        const frameIdx = Math.floor(now / RUN_FRAME_MS) % dirInfo.cols;
        const hcx = anchor?.hCenterX ?? 0.5;
        const fay = anchor?.feetAnchorY ?? 0.99;
        const aspect = fw / fh;
        const scaledSize = size * RUN_ATLAS_SCALE;
        const dw = aspect >= 1 ? scaledSize : scaledSize * aspect;
        const dh = aspect >= 1 ? scaledSize / aspect : scaledSize;
        const destX = cx - hcx * dw;
        const destY = cy - fay * dh;
        ctx.drawImage(
          sprites.atlas.img,
          entry.x + frameIdx * fw, entry.y + dirInfo.row * fh,
          fw, fh,
          destX, destY, dw, dh,
        );
        return true;
      }
    }
    // ── Single combined run-sheet ────────────────────────────────────────
    if (sprites.runSheet && runFrameMap[facing]) {
      const frame = runFrameMap[facing]!;
      const sheet = sprites.runSheet;
      const fw = Math.floor(sheet.naturalWidth / runSheetCols);
      const fh = Math.floor(sheet.naturalHeight / runSheetRows);
      const frameIdx = Math.floor(now / RUN_FRAME_MS) % runSheetCols;
      const aspect = fw / fh;
      const dw = aspect >= 1 ? size : size * aspect;
      const dh = aspect >= 1 ? size / aspect : size;
      const destX = cx - frame.hCenterX * dw;
      const destY = cy - frame.feetAnchorY * dh;
      ctx.drawImage(sheet, frameIdx * fw, frame.row * fh, fw, fh, destX, destY, dw, dh);
    } else {
      // Legacy per-frame fallback
      const frames = sprites.run[facing];
      if (!frames?.length) return false;
      const img = frames[Math.floor(now / RUN_FRAME_MS) % frames.length];
      const aspect = img.naturalWidth / img.naturalHeight;
      const dw = aspect >= 1 ? size : size * aspect;
      const dh = aspect >= 1 ? size / aspect : size;
      ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
    }
  } else {
    const frame = idleFrameMap[facing];
    if (!frame) return false;
    // ── Atlas idle ───────────────────────────────────────────────────────
    if (sprites.atlas) {
      const entry = sprites.atlas.manifest.sheets["neutral-idle-8dir"];
      if (entry) {
        const fw = Math.floor(entry.width / idleSheetCols);
        const fh = Math.floor(entry.height / idleSheetRows);
        const aspect = fw / fh;
        const dw = aspect >= 1 ? size : size * aspect;
        const dh = aspect >= 1 ? size / aspect : size;
        const destX = cx - frame.hCenterX * dw;
        const destY = cy - frame.feetAnchorY * dh;
        ctx.drawImage(
          sprites.atlas.img,
          entry.x + frame.col * fw, entry.y + frame.row * fh,
          fw, fh,
          destX, destY, dw, dh,
        );
        return true;
      }
    }
    // ── Direct idle sheet ────────────────────────────────────────────────
    if (!sprites.idleSheet) return false;
    const sheet = sprites.idleSheet;
    const fw = Math.floor(sheet.naturalWidth / idleSheetCols);
    const fh = Math.floor(sheet.naturalHeight / idleSheetRows);
    const aspect = fw / fh;
    const dw = aspect >= 1 ? size : size * aspect;
    const dh = aspect >= 1 ? size / aspect : size;
    const destX = cx - frame.hCenterX * dw;
    const destY = cy - frame.feetAnchorY * dh;
    ctx.drawImage(sheet, frame.col * fw, frame.row * fh, fw, fh, destX, destY, dw, dh);
  }

  return true;
}

/**
 * Draw the unarmed-attack animation frame for `facing` at progress 0..1
 * (0 = first frame, 1 = past last frame). Returns false when the atlas /
 * facing entry is unavailable so callers can fall back to the idle sprite.
 */
export function drawHeroAttack(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  facing: Facing,
  progress: number,
): boolean {
  const sprites = cache;
  if (!sprites?.atlas) return false;
  const key = ATTACK_DIR_ATLAS[facing];
  const entry = sprites.atlas.manifest.sheets[key];
  if (!entry) return false;
  const fw = Math.floor(entry.width / ATTACK_COLS);
  const fh = entry.height;
  const frameIdx = Math.min(ATTACK_COLS - 1, Math.max(0, Math.floor(progress * ATTACK_COLS)));
  // Use the running atlas scale + feet anchor so attack sprites match running size.
  const anchor = runFrameMap[facing];
  const hcx = anchor?.hCenterX ?? 0.5;
  const fay = anchor?.feetAnchorY ?? 0.99;
  const aspect = fw / fh;
  const scaledSize = size * RUN_ATLAS_SCALE;
  const dw = aspect >= 1 ? scaledSize : scaledSize * aspect;
  const dh = aspect >= 1 ? scaledSize / aspect : scaledSize;
  const destX = cx - hcx * dw;
  const destY = cy - fay * dh;
  ctx.drawImage(
    sprites.atlas.img,
    entry.x + frameIdx * fw, entry.y,
    fw, fh,
    destX, destY, dw, dh,
  );
  return true;
}
