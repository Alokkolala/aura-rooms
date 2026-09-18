/**
 * Hand-built 16x16 pixel sprites, baked once into offscreen canvases at load.
 * Everything is drawn a pixel at a time; nothing is scaled or smoothed until
 * the renderer blits a finished tile, so edges stay crisp at any zoom.
 *
 * Surface art is deliberately NEUTRAL. Nothing points anywhere, nothing is
 * labelled, and nothing uses go/stop colour coding — a surface that looked
 * like an exit would hand the agent the win condition it is supposed to infer.
 */

export const TILE = 16;

export const PAL = {
  void: '#241c26',
  ink: '#42302c',
  inkSoft: '#6b5049',

  // warm sandstone
  floorA: '#f2e0bd',
  floorAHi: '#fbf0d9',
  floorALo: '#c9a878',

  // cooler mauve stone — a different material, identical behaviour
  floorB: '#dcc5c5',
  floorBHi: '#f0dedd',
  floorBLo: '#a4868b',

  solid: '#93806f',
  solidTop: '#b6a392',
  solidDeep: '#63514a',

  striped: '#d4e7f2',
  stripedInk: '#8dc0dd',
  stripedDeep: '#6fa3c4',

  diagonal: '#f2dcee',
  diagonalInk: '#c9a1d6',
  diagonalDeep: '#a97fb9',

  concentric: '#f7ecd0',
  ringA: '#dfae4d',
  ringB: '#bd8839',

  body: '#fff5e2',
  bodyShade: '#ecd3ab',
  eye: '#42302c',
  glint: '#ffffff',
  cheek: '#f3a6a2',
  fin: '#67c1cf',
  finDeep: '#3f93a5',
} as const;

type Ctx = CanvasRenderingContext2D;

function blank(): { cv: HTMLCanvasElement; ctx: Ctx } {
  const cv = document.createElement('canvas');
  cv.width = TILE;
  cv.height = TILE;
  const ctx = cv.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return { cv, ctx };
}

function px(ctx: Ctx, x: number, y: number, color: string) {
  if (x < 0 || y < 0 || x >= TILE || y >= TILE) return;
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 1, 1);
}

function rect(ctx: Ctx, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/** Deterministic per-cell jitter so floors vary without looking random. */
function hash(x: number, y: number, salt: number): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2147483647) >>> 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * A plain floor. The two variants must read as obviously different MATERIALS at
 * a glance while behaving identically — they are the deliberate distractor, and
 * the agent is given two different codes for them. If they looked the same the
 * distractor would not exist; if they behaved differently the level design
 * would be lying.
 */
function floorTile(
  base: string,
  hi: string,
  lo: string,
  motif: 'grit' | 'diamond',
) {
  const { cv, ctx } = blank();
  rect(ctx, 0, 0, TILE, TILE, base);
  rect(ctx, 0, 0, TILE, 1, hi);
  rect(ctx, 0, 0, 1, TILE, hi);
  rect(ctx, 0, TILE - 1, TILE, 1, lo);
  rect(ctx, TILE - 1, 0, 1, TILE, lo);

  if (motif === 'grit') {
    for (let y = 2; y < TILE - 2; y++)
      for (let x = 2; x < TILE - 2; x++)
        if (hash(x, y, 7) > 0.93) px(ctx, x, y, lo);
  } else {
    // a small centred diamond, plus corner ticks
    for (let d = 0; d <= 3; d++)
      for (let k = -d; k <= d; k++) {
        px(ctx, 7 + k, 4 + d, d === 3 ? lo : hi);
        px(ctx, 7 + k, 11 - d, d === 3 ? lo : hi);
      }
    px(ctx, 2, 2, lo);
    px(ctx, TILE - 3, 2, lo);
    px(ctx, 2, TILE - 3, lo);
    px(ctx, TILE - 3, TILE - 3, lo);
  }
  return cv;
}

function solidTile() {
  const { cv, ctx } = blank();
  rect(ctx, 0, 0, TILE, TILE, PAL.solid);
  rect(ctx, 0, 0, TILE, 3, PAL.solidTop);
  rect(ctx, 0, TILE - 3, TILE, 3, PAL.solidDeep);
  rect(ctx, TILE - 2, 0, 2, TILE, PAL.solidDeep);
  rect(ctx, 0, 0, 1, TILE, PAL.solidTop);
  // a couple of chipped pixels so a big mass of these is not a flat slab
  px(ctx, 4, 7, PAL.solidDeep);
  px(ctx, 5, 7, PAL.solidDeep);
  px(ctx, 11, 10, PAL.solidDeep);
  px(ctx, 9, 5, PAL.solidTop);
  return cv;
}

function stripedTile() {
  const { cv, ctx } = blank();
  rect(ctx, 0, 0, TILE, TILE, PAL.striped);
  // straight bands, no arrowheads and no implied direction
  for (let x = 0; x < TILE; x++)
    if (((x / 3) | 0) % 2 === 0) rect(ctx, x, 0, 1, TILE, PAL.stripedInk);
  for (let i = 0; i < TILE; i++) {
    px(ctx, i, TILE - 1, PAL.stripedDeep);
    px(ctx, TILE - 1, i, PAL.stripedDeep);
  }
  return cv;
}

function diagonalTile() {
  const { cv, ctx } = blank();
  rect(ctx, 0, 0, TILE, TILE, PAL.diagonal);
  // symmetric cross-hatch: both diagonals are drawn, so the pattern carries
  // no handedness the agent could read a turn direction off
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      if ((x + y) % 5 === 0) px(ctx, x, y, PAL.diagonalInk);
      if ((x - y + 32) % 5 === 0) px(ctx, x, y, PAL.diagonalInk);
    }
  for (let i = 0; i < TILE; i++) {
    px(ctx, i, TILE - 1, PAL.diagonalDeep);
    px(ctx, TILE - 1, i, PAL.diagonalDeep);
  }
  return cv;
}

function concentricTile() {
  const { cv, ctx } = blank();
  rect(ctx, 0, 0, TILE, TILE, PAL.concentric);
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)) | 0;
      if (d === 6) px(ctx, x, y, PAL.ringA);
      if (d === 4) px(ctx, x, y, PAL.ringB);
      if (d === 2) px(ctx, x, y, PAL.ringA);
      if (d === 0) px(ctx, x, y, PAL.ringB);
    }
  return cv;
}

const BODY = [
  '................',
  '................',
  '.....oooooo.....',
  '...oobbbbbboo...',
  '..obbbbbbbbbbo..',
  '.obbbbbbbbbbbbo.',
  '.obbbbbbbbbbbbo.',
  '.obbbbbbbbbbbbo.',
  '.obbbbbbbbbbbbo.',
  '.obbbbbbbbbbbbo.',
  '.obbbbbbbbbbbbo.',
  '..obbbbbbbbbbo..',
  '..osbbbbbbbbso..',
  '...oossssssoo...',
  '.....oooooo.....',
  '................',
];

/** Accent fin marking the facing. Pixels are [x,y] at the sprite's edge. */
const FIN: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[7, 0], [8, 0], [6, 1], [7, 1], [8, 1], [9, 1]], // up
  [[15, 7], [15, 8], [14, 6], [14, 7], [14, 8], [14, 9]], // right
  [[7, 15], [8, 15], [6, 14], [7, 14], [8, 14], [9, 14]], // down
  [[0, 7], [0, 8], [1, 6], [1, 7], [1, 8], [1, 9]], // left
];

/** Eye pairs per facing; `null` means the entity is turned away from us. */
const EYES: ReadonlyArray<ReadonlyArray<number> | null> = [
  null, // up — back of the head, which doubles as an orientation cue
  [7, 11], // right
  [4, 10], // down
  [3, 7], // left
];

function entitySprite(dir: number, bob: number) {
  const { cv, ctx } = blank();
  const dy = bob; // 0 or 1 — the idle bounce

  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      const c = BODY[y][x];
      if (c === 'o') px(ctx, x, y + dy, PAL.ink);
      else if (c === 'b') px(ctx, x, y + dy, PAL.body);
      else if (c === 's') px(ctx, x, y + dy, PAL.bodyShade);
    }

  const eyes = EYES[dir];
  if (eyes) {
    for (const ex of eyes) {
      rect(ctx, ex, 7 + dy, 2, 3, PAL.eye);
      px(ctx, ex + 1, 7 + dy, PAL.glint);
    }
    px(ctx, eyes[0] - 1, 11 + dy, PAL.cheek);
    px(ctx, eyes[1] + 2, 11 + dy, PAL.cheek);
  } else {
    // a small swirl so the "away" pose still reads as a creature
    rect(ctx, 6, 7 + dy, 4, 1, PAL.bodyShade);
    rect(ctx, 7, 9 + dy, 3, 1, PAL.bodyShade);
  }

  for (const [fx, fy] of FIN[dir]) px(ctx, fx, fy + dy, PAL.fin);
  const tip = FIN[dir][0];
  px(ctx, tip[0], tip[1] + dy, PAL.finDeep);

  return cv;
}

export interface SpriteSet {
  tiles: Record<string, HTMLCanvasElement>;
  entity: HTMLCanvasElement[][]; // [dir][bobFrame]
}

let cached: SpriteSet | null = null;

export function sprites(): SpriteSet {
  if (cached) return cached;
  cached = {
    tiles: {
      '.': floorTile(PAL.floorA, PAL.floorAHi, PAL.floorALo, 'grit'),
      ',': floorTile(PAL.floorB, PAL.floorBHi, PAL.floorBLo, 'diamond'),
      '#': solidTile(),
      '~': stripedTile(),
      '/': diagonalTile(),
      O: concentricTile(),
    },
    entity: [0, 1, 2, 3].map((d) => [entitySprite(d, 0), entitySprite(d, 1)]),
  };
  return cached;
}
