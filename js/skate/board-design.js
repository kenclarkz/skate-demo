// The Board Maker's design catalogue: what a deck looks like, on top of the
// palette-and-shape the rest of the game already understands.
//
// Every design is a list of "art blocks" — thin, chunky boxes that sit proud
// of the grip tape, in the deck-local art plane (the flat middle of the deck,
// where x is across the width and z is along the length, both measured from
// the board's centre in metres). board.js turns each of those into a real
// box() entry and merges it into the same single draw call as the deck, so a
// fully painted board still costs the game nothing but one draw call and a
// handful of vertices. There is no texture anywhere: a design is literally a
// pattern of coloured blocks, which is exactly the blocky, chunky, 8-bit
// aesthetic the game already draws everything in.
//
// The player-facing parts of a design are: the style (one of STYLES), a
// couple of colours for that style, an optional word of block-lettering, a
// hand-drawn pixel grid (for the block-art style), and a stack of sticker
// layers that sit on top of the base pattern and can be moved, rotated,
// scaled and deleted individually.

import { TYPES, typeById } from './boards.js';

// ---------------------------------------------------------------------------
// A tiny 3×5 block font — every letter, digit and a few marks, drawn the same
// way every other glyph in this module is drawn: a string of 1s and 0s.
// ---------------------------------------------------------------------------
const F = (a, b, c, d, e) => [a, b, c, d, e];
const FONT = {
  A: F('010', '101', '111', '101', '101'),
  B: F('110', '101', '110', '101', '110'),
  C: F('011', '100', '100', '100', '011'),
  D: F('110', '101', '101', '101', '110'),
  E: F('111', '100', '110', '100', '111'),
  F: F('111', '100', '110', '100', '100'),
  G: F('011', '100', '101', '101', '011'),
  H: F('101', '101', '111', '101', '101'),
  I: F('111', '010', '010', '010', '111'),
  J: F('001', '001', '001', '101', '010'),
  K: F('101', '101', '110', '101', '101'),
  L: F('100', '100', '100', '100', '111'),
  M: F('101', '111', '111', '101', '101'),
  N: F('101', '111', '111', '111', '101'),
  O: F('010', '101', '101', '101', '010'),
  P: F('110', '101', '110', '100', '100'),
  Q: F('010', '101', '101', '110', '011'),
  R: F('110', '101', '110', '101', '101'),
  S: F('011', '100', '010', '001', '110'),
  T: F('111', '010', '010', '010', '010'),
  U: F('101', '101', '101', '101', '010'),
  V: F('101', '101', '101', '010', '010'),
  W: F('101', '101', '111', '111', '101'),
  X: F('101', '101', '010', '101', '101'),
  Y: F('101', '101', '010', '010', '010'),
  Z: F('111', '001', '010', '100', '111'),
  0: F('010', '101', '101', '101', '010'),
  1: F('010', '110', '010', '010', '111'),
  2: F('110', '001', '010', '100', '111'),
  3: F('110', '001', '110', '001', '110'),
  4: F('101', '101', '111', '001', '001'),
  5: F('111', '100', '110', '001', '110'),
  6: F('010', '100', '110', '101', '010'),
  7: F('111', '001', '010', '010', '010'),
  8: F('010', '101', '010', '101', '010'),
  9: F('010', '101', '011', '001', '010'),
  '!': F('010', '010', '010', '000', '010'),
  '?': F('110', '001', '010', '000', '010'),
  '&': F('010', '101', '010', '101', '011'),
  '.': F('000', '000', '000', '000', '010'),
  '-': F('000', '000', '111', '000', '000'),
  "'": F('010', '010', '000', '000', '000'),
  ' ': F('000', '000', '000', '000', '000'),
};

/** What a word may contain: everything FONT can draw, upper-cased. */
export function sanitizeText(text) {
  return String(text || '')
    .toUpperCase()
    .replace(/[^A-Z0-9!&?. '\-]/g, '')
    .trim();
}

// ---------------------------------------------------------------------------
// The sticker / icon sprites: chunky 7×7 glyphs for everything a deck gets
// plastered with. Each is an array of strings; a '.' is empty and any other
// character is a lit block in the sprite's own colour.
// ---------------------------------------------------------------------------
export const ICONS = {
  star: ['.X...X.', '..XXX..', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..X.X..', '.X...X.'],
  heart: ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'],
  coin: ['..XXX..', '.XXXXX.', 'XX.X.XX', 'XX.X.XX', 'XX...XX', '.XXXXX.', '..XXX..'],
  bolt: ['..X....', '..XX...', '...XX..', 'XXXXXX.', 'XXXXXX.', '...XX..', '..XX...'],
  skull: ['.XXXXX.', 'X.X.X.X', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '.XX.XX.', '.X...X.'],
  diamond: ['...X...', '..XXX..', '.XXXXX.', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'],
  ring: ['..XXX..', '.XX.XX.', 'XX...XX', 'XX...XX', 'XX...XX', '.XX.XX.', '..XXX..'],
  ghost: ['..XXX..', '.X.X.X.', 'X.....X', 'X..X..X', 'X.XX.XX', 'XXXXXXX', '..X.X..'],
  pac: ['..XXXX.', '.XXXXXX', 'XXXXXXX', 'XXXXXX.', '.XXXXX.', '..XXXX.', '..XXX..'],
  cross: ['X.....X', '.X...X.', '..X.X..', '...X...', '..X.X..', '.X...X.', 'X.....X'],
  arrow: ['..X....', '..XX...', 'XXXXXXX', 'XXXXXXX', '..XX...', '..X....', '..X....'],
  invader: ['.X...X.', '...X...', '.XXXXX.', 'XX.XX.X', 'XXXXXXX', 'X.XXX.X', '..X.X..'],
  crown: ['.X.X.X.', '.XXXXX.', 'X.XXX.X', 'XXXXXXX', 'XXXXXXX', 'XXXXXXX', '.XXXXX.'],
};

export const ICON_LIST = [
  'star',
  'heart',
  'coin',
  'bolt',
  'skull',
  'diamond',
  'ring',
  'ghost',
  'pac',
  'cross',
  'arrow',
  'invader',
  'crown',
];

// The block-art palette: index 0 is the eraser, everything after is a paint
// colour. Kept deliberately to the loud, saturated, 8-bit end of the scale.
export const PIXEL_PALETTE = [
  0x000000, // 0 — transparent / eraser
  0xffffff, // 1
  0xff2fa0, // 2
  0xffc93f, // 3
  0x35ffe0, // 4
  0x2f7fd1, // 5
  0x9a5cf6, // 6
  0x39e75f, // 7
  0xe6392e, // 8
  0x12141a, // 9
];

export const PIXEL_PAINT = PIXEL_PALETTE.slice(1);

export const BLOCKART_COLS = 12;
export const BLOCKART_ROWS = 6;

const emptyGrid = () => Array.from({ length: BLOCKART_ROWS }, () => Array(BLOCKART_COLS).fill(0));

/** The default block-art canvas: a chunky heart so a fresh board is not blank. */
function defaultPixels() {
  const grid = emptyGrid();
  const heart = [
    '.XX.XX.',
    'XXXXXXX',
    'XXXXXXX',
    'XXXXXXX',
    '.XXXXX.',
    '..XXX..',
  ];
  for (let r = 0; r < heart.length; r++) {
    for (let c = 0; c < heart[r].length; c++) {
      if (heart[r][c] === 'X') grid[r][c + 2] = 2;
    }
  }
  return grid;
}

// ---------------------------------------------------------------------------
// The styles themselves. `generate` receives the board shape and the whole
// draft and returns a list of art blocks; everything else about a style is
// presentation for the picker.
// ---------------------------------------------------------------------------
export const STYLES = [
  {
    id: 'plain',
    name: 'Plain',
    blurb: 'No graphics — just the deck colour and the accent stripe.',
  },
  {
    id: 'pixel',
    name: 'Pixel Deck',
    blurb: 'A retro pixel sunset in loud 8-bit colours.',
  },
  {
    id: 'graffiti',
    name: 'Graffiti Deck',
    blurb: 'Chunky spray-paint lettering, shadow and drips.',
  },
  {
    id: 'flame',
    name: 'Flame Deck',
    blurb: 'Blocky flames licking in from both ends of the deck.',
  },
  {
    id: 'lightning',
    name: 'Lightning Deck',
    blurb: 'Jagged pixel bolts down the length of the board.',
  },
  {
    id: 'camo',
    name: 'Camo Deck',
    blurb: 'Block-shaped camouflage in your two colours.',
  },
  {
    id: 'checker',
    name: 'Checker Deck',
    blurb: 'A classic checkerboard across the whole flat.',
  },
  {
    id: 'stickers',
    name: 'Sticker Bomb',
    blurb: 'Layer after layer of blocky stickers and icons.',
  },
  {
    id: 'arcade',
    name: 'Retro Arcade',
    blurb: 'Pixel characters, coins, stars and hearts from the arcade.',
  },
  {
    id: 'shop',
    name: 'Skate Shop',
    blurb: 'Bold geometric stripes and a big block-letter logo.',
  },
  {
    id: 'retro',
    name: 'Retro Wave',
    blurb: 'A ringed sunset sun over a scanline grid.',
  },
  {
    id: 'tiger',
    name: 'Tiger Deck',
    blurb: 'Wandering dark stripes in your pattern colour.',
  },
  {
    id: 'space',
    name: 'Space Deck',
    blurb: 'A ringed planet drifting across a starfield.',
  },
  {
    id: 'argyle',
    name: 'Argyle Deck',
    blurb: 'A lattice of diamonds in your two colours.',
  },
  {
    id: 'splat',
    name: 'Paint Splat',
    blurb: 'Big blobs of paint with drips running off them.',
  },
  {
    id: 'circuit',
    name: 'Circuit Deck',
    blurb: 'Glowing traces and nodes on a dark board.',
  },
  {
    id: 'sunburst',
    name: 'Sunburst',
    blurb: 'Rays of colour radiating from the middle of the deck.',
  },
  {
    id: 'chevron',
    name: 'Chevron Wave',
    blurb: 'A row of chunky chevrons, shaded like a surf crest.',
  },
  {
    id: 'shield',
    name: 'Shield Crest',
    blurb: 'A tapered crest with block lettering down the middle.',
  },
  {
    id: 'darts',
    name: 'Dartboard',
    blurb: 'Concentric scoring rings, right on the deck.',
  },
  {
    id: 'blockart',
    name: 'Custom Block Art',
    blurb: 'Paint your own design on a grid, block by block.',
  },
];

export const styleById = Object.fromEntries(STYLES.map((s) => [s.id, s]));

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
/** Darken (f < 1) or lighten (f > 1) a hex colour without importing three.js. */
export function shade(hex, f) {
  const to = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return (to((hex >> 16) & 255) << 16) | (to((hex >> 8) & 255) << 8) | to(hex & 255);
}

const hex = (v) => `#${v.toString(16).padStart(6, '0')}`;
export const colorHex = hex;

/** A deterministic generator, so a design looks the same on every reload. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (arr, r) => arr[Math.floor(r() * arr.length)];

/**
 * Turn a sprite (an array of equal-length strings) into art blocks. A '.'
 * is empty; any other character is looked up in `colorMap` and becomes a
 * block `cell` metres across, centred at (cx, cz).
 */
function spriteBlocks(sprite, colorMap, cx, cz, cell, rot = 0) {
  const blocks = [];
  const rows = sprite.length;
  const cols = sprite[0].length;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ch = sprite[r][c];
      const color = colorMap[ch];
      if (!color) continue;
      blocks.push({
        x: cx + (c - (cols - 1) / 2) * cell,
        z: cz + (r - (rows - 1) / 2) * cell,
        w: cell,
        d: cell,
        color,
        rot,
      });
    }
  }
  return blocks;
}

/**
 * The block-lettering. Glyphs are 3 wide and 5 tall with one block of letter
 * spacing; `cell` is sized so the whole word fits the flat area. `colorMap`
 * lets the shadow pass render the same word again in a second colour, offset
 * by `offset` cells.
 */
function textBlocks(text, cell, cx, cz, colorMap, offset = { dx: 0, dz: 0 }) {
  const t = sanitizeText(text) || 'S';
  const blocks = [];
  const pitch = 4;
  const totalW = t.length * pitch - 1;
  const x0 = cx - ((totalW - 1) * cell) / 2 + offset.dx * cell;
  const z0 = cz - 2 * cell + offset.dz * cell;
  for (let i = 0; i < t.length; i++) {
    const glyph = FONT[t[i]] || FONT['?'];
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 3; c++) {
        if (glyph[r][c] !== '1') continue;
        const color = colorMap[glyph[r][c]] || colorMap[' '];
        blocks.push({
          x: x0 + (i * pitch + c) * cell,
          z: z0 + r * cell,
          w: cell,
          d: cell,
          color,
        });
      }
    }
  }
  return blocks;
}

/** A chunky filled disc of `cell` blocks at (cx, cz) out to radius `r`. */
function discBlocks(cx, cz, r, cell, color) {
  const blocks = [];
  for (let x = cx - r; x <= cx + r; x += cell) {
    for (let z = cz - r; z <= cz + r; z += cell) {
      if (Math.hypot(x + cell / 2 - cx, z + cell / 2 - cz) <= r) {
        blocks.push({ x: x + cell / 2, z: z + cell / 2, w: cell, d: cell, color });
      }
    }
  }
  return blocks;
}

/** A cell size that fits `glyphs` glyphs of block text in the flat area. */
function fitTextCell(shape, glyphs, cap = 0.02) {
  const availW = shape.deckW * 0.88;
  const availL = shape.kickStart * 2 * 0.92;
  const glyphsW = Math.max(1, glyphs) * 4 - 1;
  return Math.min(availW / 5, availL / glyphsW, cap);
}

// ---------------------------------------------------------------------------
// One generator per style. Each returns a list of art blocks.
// ---------------------------------------------------------------------------
function genPixel(shape, draft) {
  const blocks = [];
  const cell = Math.min(shape.deckW / 14, 0.02);
  const L = shape.kickStart * 2;
  // Horizontal sky bands, then a sun, then a ground band — a pixel sunset.
  const bands = [0x2f7fd1, 0x35ffe0, 0xffc93f, 0xff2fa0];
  const n = Math.floor(L / cell);
  const bandH = Math.floor(n / bands.length);
  for (let r = 0; r < n; r++) {
    const band = Math.min(bands.length - 1, Math.floor(r / bandH));
    const y = r - n / 2 + 0.5;
    blocks.push({
      x: 0,
      z: y * cell,
      w: shape.deckW * 0.96,
      d: cell,
      color: bands[band],
    });
  }
  // The sun, a chunky square of yellow with a dark outline.
  const sun = 0xffc93f;
  const outline = shade(sun, 0.35);
  for (let r = 3; r <= 6; r++) {
    for (let c = 8; c <= 11; c++) {
      const edge = r === 3 || r === 6 || c === 8 || c === 11;
      const x = (c - 7) * cell;
      const z = (r - n / 2 + 0.5) * cell;
      blocks.push({ x, z, w: cell, d: cell, color: edge ? outline : sun });
    }
  }
  // A chunky ground strip along the tail edge.
  const ground = 0x12141a;
  const gy0 = -n / 2 - 0.5;
  for (let r = 0; r < 2; r++) {
    blocks.push({
      x: 0,
      z: (gy0 + r) * cell,
      w: shape.deckW * 0.96,
      d: cell,
      color: r === 0 ? ground : shade(ground, 1.8),
    });
  }
  return blocks;
}

function genGraffiti(shape, draft) {
  const blocks = [];
  const text = sanitizeText(draft.text) || 'SKATE';
  const cell = fitTextCell(shape, text.length, 0.024);
  const front = draft.styleColor;
  const shadow = draft.styleColor2;
  // The drop shadow first, offset down and right, then the lettering.
  blocks.push(...textBlocks(text, cell, 0, -cell * 0.7, { ' ': shadow }, { dx: 1.2, dz: 1.2 }));
  blocks.push(...textBlocks(text, cell, 0, -cell * 0.7, { ' ': front }));
  // Drips: a couple of columns under the word run paint down the deck.
  const r = rng(0x6a1f);
  const drips = 3 + Math.floor(r() * 2);
  for (let i = 0; i < drips; i++) {
    const gx = (r() * 2 - 1) * shape.deckW * 0.3;
    const len = 1 + Math.floor(r() * 3);
    for (let j = 0; j < len; j++) {
      blocks.push({
        x: gx,
        z: cell * 2.6 + cell * 0.5 + j * cell,
        w: cell,
        d: cell,
        color: j % 2 ? front : shade(front, 0.75),
      });
    }
  }
  // A few splatter dots around the word, like overspray.
  for (let i = 0; i < 6; i++) {
    blocks.push({
      x: (r() * 2 - 1) * shape.deckW * 0.4,
      z: (r() * 2 - 1) * shape.kickStart * 0.7,
      w: cell * 0.6,
      d: cell * 0.6,
      color: r() < 0.5 ? front : shadow,
    });
  }
  return blocks;
}

function genFlame(shape, draft) {
  const blocks = [];
  const cell = Math.min(shape.deckW / 12, 0.024);
  const colors = [draft.styleColor2, draft.styleColor, shade(draft.styleColor, 0.7)];
  const halfL = shape.kickStart;
  const halfW = shape.deckW / 2;
  // Flames lick in from each end: a row of overlapping triangles that flare
  // wider as they recede from the nose/tail edge.
  const tips = 6;
  for (let i = 0; i < tips; i++) {
    const x = -halfW * 0.8 + (i / (tips - 1)) * halfW * 1.6;
    const len = 6 + Math.floor(Math.abs(Math.sin(i * 2.1)) * 6);
    for (let j = 0; j < len; j++) {
      const color = colors[Math.min(colors.length - 1, Math.floor((j / len) * 3))];
      const half = 0.4 + (j / len) * 0.9;
      blocks.push({
        x,
        z: halfL - cell / 2 - j * cell,
        w: cell * (1 + half),
        d: cell,
        color,
      });
    }
  }
  // And the same licking up the tail end, pointing the other way.
  for (let i = 0; i < tips; i++) {
    const x = -halfW * 0.8 + (i / (tips - 1)) * halfW * 1.6;
    const len = 6 + Math.floor(Math.abs(Math.cos(i * 1.7)) * 6);
    for (let j = 0; j < len; j++) {
      const color = colors[Math.min(colors.length - 1, Math.floor((j / len) * 3))];
      const half = 0.4 + (j / len) * 0.9;
      blocks.push({
        x,
        z: -halfL + cell / 2 + j * cell,
        w: cell * (1 + half),
        d: cell,
        color,
      });
    }
  }
  return blocks;
}

function genLightning(shape, draft) {
  const blocks = [];
  const cell = Math.min(shape.deckW / 9, 0.02);
  const halfL = shape.kickStart * 0.92;
  const main = draft.styleColor;
  const glow = draft.styleColor2;
  const drawBolt = (cx, phase, scale, flip) => {
    const n = Math.floor((halfL * 2) / cell);
    let x = 0;
    let dir = flip ? 1 : -1;
    for (let i = 0; i < n; i++) {
      const z = -halfL + i * cell + cell / 2;
      // The zigzag: every few blocks the bolt jogs sideways, keeping the
      // whole thing centred-ish so it stays on the deck.
      if (i % 4 === 2) {
        x += dir * cell * 2;
        dir = -dir;
      }
      if (i % 4 === 0) x += Math.sin(i * phase) * cell * 0.4;
      const px = cx + x;
      // A soft glow block behind the hot core.
      blocks.push({ x: px, z, w: cell * 1.4, d: cell * 1.4, color: glow });
      blocks.push({ x: px, z, w: cell, d: cell, color: main });
    }
  };
  drawBolt(-shape.deckW * 0.22, 1.7, 1, false);
  drawBolt(shape.deckW * 0.22, 2.3, 1, true);
  return blocks;
}

function genCamo(shape, draft) {
  const blocks = [];
  const cell = Math.min(shape.deckW / 12, 0.02);
  const halfL = shape.kickStart * 0.94;
  const halfW = shape.deckW / 2 - cell;
  const colors = [
    shade(draft.colors.deck, 0.55),
    shade(draft.colors.deck, 0.85),
    draft.styleColor,
    draft.styleColor2,
  ];
  // A fixed set of blob centres; every cell takes the colour of its nearest
  // blob, which is what makes camouflage read as blobs instead of noise.
  const r = rng(0xc4a0);
  const blobs = Array.from({ length: 7 }, () => ({
    x: (r() * 2 - 1) * halfW,
    z: (r() * 2 - 1) * halfL,
    r: 0.05 + r() * 0.05,
    c: Math.floor(r() * colors.length),
  }));
    for (let z = -halfL; z <= halfL; z += cell) {
    for (let x = -halfW; x <= halfW; x += cell) {
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < blobs.length; i++) {
        const d = Math.hypot(x - blobs[i].x, z - blobs[i].z);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      // The hard blob edge plus a little jitter is what keeps it from
      // looking like polka dots.
      if (bestD < blobs[best].r + r() * 0.02) {
        blocks.push({ x, z, w: cell, d: cell, color: colors[blobs[best].c] });
      }
    }
  }
  return blocks;
}

function genChecker(shape, draft) {
  const blocks = [];
  const cols = 8;
  const rows = Math.max(3, Math.round((shape.kickStart * 2 * cols) / shape.deckW));
  const cell = Math.min(shape.deckW / cols, (shape.kickStart * 2) / rows);
  const a = draft.styleColor;
  const b = draft.styleColor2;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const color = (r + c) % 2 === 0 ? a : b;
      blocks.push({
        x: (c - (cols - 1) / 2) * cell,
        z: (r - (rows - 1) / 2) * cell,
        w: cell,
        d: cell,
        color,
      });
    }
  }
  return blocks;
}

function genStickers(shape, draft) {
  const blocks = [];
  const r = rng(0x51c0);
  const cell = Math.min(shape.deckW / 9, 0.022);
  const halfL = shape.kickStart * 0.8;
  const halfW = shape.deckW / 2 - cell * 2;
  const n = 10;
  for (let i = 0; i < n; i++) {
    const icon = ICONS[pick(ICON_LIST, r)];
    const colors = {};
    colors['X'] = pick([draft.styleColor, draft.styleColor2, 0xffffff, 0xffc93f], r);
    const cx = (r() * 2 - 1) * halfW;
    const cz = (r() * 2 - 1) * halfL;
    const rot = (r() - 0.5) * 0.9;
    blocks.push(...spriteBlocks(icon, colors, cx, cz, cell * (1 + r() * 0.6), rot));
  }
  return blocks;
}

function genArcade(shape, draft) {
  const blocks = [];
  const cell = Math.min(shape.deckW / 10, 0.02);
  const halfL = shape.kickStart * 0.85;
  const front = draft.styleColor;
  const alt = draft.styleColor2;
  // A little arcade ghost (the "player") rides near the nose.
  blocks.push(...spriteBlocks(ICONS.invader, { X: 0x35ffe0, x: 0x35ffe0 }, 0, halfL * 0.55, cell * 1.15));
  // A row of coins, stars and hearts down the middle — the pickups.
  const row = [-halfL * 0.45, 0, halfL * 0.45];
  const glyphs = ['coin', 'star', 'heart'];
  row.forEach((cz, i) => {
    const icon = ICONS[glyphs[i]];
    const color = [0xffc93f, alt, 0xff2fa0][i];
    blocks.push(...spriteBlocks(icon, { X: color }, 0, cz, cell));
  });
  // An outline block, like the arcade cabinet's bezel, and a small score
  // line of block-lettering near the tail.
  blocks.push({
    x: 0,
    z: -halfL * 0.92,
    w: shape.deckW * 0.94,
    d: cell * 1.4,
    color: shade(0x12141a, 0.9),
  });
  const scoreCell = fitTextCell(shape, 2, 0.015);
  blocks.push(...textBlocks('1UP', scoreCell, shape.deckW * 0.2, -halfL * 0.92, { ' ': front }));
  return blocks;
}

function genShop(shape, draft) {
  const blocks = [];
  const front = draft.styleColor;
  const alt = draft.styleColor2;
  const halfL = shape.kickStart * 0.95;
  // Bold diagonal racing stripes, the geometric half of the design.
  const cell = Math.min(shape.deckW / 10, 0.018);
  for (let x = -shape.deckW / 2; x <= shape.deckW / 2; x += cell * 2) {
    blocks.push({
      x,
      z: 0,
      w: cell,
      d: halfL * 2,
      color: alt,
      rot: -0.5,
    });
  }
  // A chunky chevron at each end.
  for (const s of [1, -1]) {
    const cx = 0;
    const cz = s * halfL * 0.55;
    for (let i = 0; i < 4; i++) {
      blocks.push({
        x: cx,
        z: cz - s * i * cell * 0.6,
        w: shape.deckW * (0.9 - i * 0.16),
        d: cell,
        color: i % 2 ? front : shade(front, 0.7),
      });
    }
  }
  // The big block-letter logo, centred.
  const text = sanitizeText(draft.text) || 'S';
  const tCell = fitTextCell(shape, text.length, 0.026);
  const gripDark = (draft.colors.grip & 0x888888) < 0x444444;
  const logo = gripDark ? 0xffffff : 0x12141a;
  blocks.push(...textBlocks(text, tCell, 0, 0, { ' ': front }, { dx: 1.5, dz: 1.5 }));
  blocks.push(...textBlocks(text, tCell, 0, 0, { ' ': logo }));
  return blocks;
}

function genRetro(shape, draft) {
  const blocks = [];
  const halfL = shape.kickStart;
  const halfW = shape.deckW / 2;
  const cell = Math.min(shape.deckW / 16, 0.015);
  const front = draft.styleColor;
  const alt = draft.styleColor2;
  const dark = shade(draft.colors.deck, 0.4);
  // The retro sky: a dark base, then a big ringed sun hanging low.
  for (let z = -halfL; z <= halfL; z += cell) {
    blocks.push({ x: 0, z: z + cell / 2, w: halfW * 2, d: cell, color: dark });
  }
  const sunR = halfW * 0.42;
  const sunC = { x: 0, z: -halfL * 0.35 };
  blocks.push(...discBlocks(sunC.x, sunC.z, sunR, cell, 0xffc93f));
  blocks.push(...discBlocks(sunC.x, sunC.z, sunR - cell * 0.9, cell, front));
  blocks.push(...discBlocks(sunC.x, sunC.z, sunR - cell * 1.8, cell, 0xffc93f));
  // Horizontal scanlines across the lower half, for the classic grid.
  const rows = Math.floor((halfL * 0.6) / (cell * 1.2));
  for (let i = 0; i < rows; i++) {
    const cz = halfL - cell * 0.5 - i * cell * 1.2;
    blocks.push({ x: 0, z: cz, w: halfW * 2, d: cell, color: alt });
  }
  return blocks;
}

function genTiger(shape, draft) {
  const blocks = [];
  const halfL = shape.kickStart;
  const halfW = shape.deckW / 2;
  const cell = Math.min(shape.deckW / 14, 0.016);
  const r = rng(0x74f1);
  const stripes = 5 + Math.floor(r() * 2);
  const band = (halfW * 2) / (stripes + 1);
  for (let s = 0; s < stripes; s++) {
    let x = -halfW + (s + 1) * band;
    for (let z = -halfL; z <= halfL; z += cell) {
      x += (r() - 0.5) * cell * 0.7;
      x = Math.max(-halfW + cell, Math.min(halfW - cell, x));
      blocks.push({
        x,
        z: z + cell / 2,
        w: cell * (1.1 + r() * 0.7),
        d: cell,
        color: draft.styleColor,
      });
    }
  }
  return blocks;
}

function genSpace(shape, draft) {
  const blocks = [];
  const halfL = shape.kickStart;
  const halfW = shape.deckW / 2;
  const cell = Math.min(shape.deckW / 16, 0.015);
  const dark = 0x0d1020;
  for (let z = -halfL; z <= halfL; z += cell) {
    blocks.push({ x: 0, z: z + cell / 2, w: halfW * 2, d: cell, color: dark });
  }
  // A ringed planet in the corner, then scattered stars.
  const px = halfW * 0.35;
  const pz = halfL * 0.42;
  const pr = halfW * 0.32;
  blocks.push(...discBlocks(px, pz, pr, cell, draft.styleColor));
  blocks.push(...discBlocks(px, pz, pr - cell, cell, shade(draft.styleColor, 0.55)));
  blocks.push({ x: px, z: pz, w: pr * 2.4, d: cell * 0.55, color: draft.styleColor2, rot: -0.35 });
  const r = rng(0x57a9);
  const stars = 24;
  for (let i = 0; i < stars; i++) {
    const sx = (r() * 2 - 1) * halfW * 0.85;
    const sz = (r() * 2 - 1) * halfL * 0.85;
    const c = r() < 0.7 ? 0xffffff : 0xffc93f;
    blocks.push({ x: sx, z: sz, w: cell * (0.6 + r() * 0.6), d: cell * (0.6 + r() * 0.6), color: c });
  }
  return blocks;
}

function genArgyle(shape, draft) {
  const blocks = [];
  const halfL = shape.kickStart;
  const halfW = shape.deckW / 2;
  const a = draft.styleColor;
  const b = draft.styleColor2;
  const cell = Math.min(shape.deckW / 10, 0.016);
  const pitch = cell * 3;
  const size = pitch * 0.72;
  const halfDiag = size / Math.SQRT2;
  for (let i = 0; i * pitch < halfW * 2 + pitch; i++) {
    for (let j = 0; j * pitch < halfL * 2 + pitch; j++) {
      const cx = Math.max(-halfW + halfDiag, Math.min(halfW - halfDiag, -halfW + i * pitch + pitch / 2));
      const cz = Math.max(-halfL + halfDiag, Math.min(halfL - halfDiag, -halfL + j * pitch + pitch / 2));
      if ((i + j) % 2) continue;
      blocks.push({ x: cx, z: cz, w: size, d: size, color: a, rot: Math.PI / 4 });
    }
  }
  // A small outline diamond in the empty slots, for the lattice look.
  for (let i = 0; i * pitch < halfW * 2 + pitch; i++) {
    for (let j = 0; j * pitch < halfL * 2 + pitch; j++) {
      const cx = Math.max(-halfW + halfDiag, Math.min(halfW - halfDiag, -halfW + i * pitch + pitch / 2));
      const cz = Math.max(-halfL + halfDiag, Math.min(halfL - halfDiag, -halfL + j * pitch + pitch / 2));
      if ((i + j) % 2 === 0) continue;
      blocks.push({ x: cx, z: cz, w: pitch * 0.42, d: pitch * 0.42, color: b, rot: Math.PI / 4 });
    }
  }
  return blocks;
}

function genSplat(shape, draft) {
  const blocks = [];
  const halfL = shape.kickStart;
  const halfW = shape.deckW / 2;
  const r = rng(0x5ecc);
  const cell = Math.min(shape.deckW / 14, 0.016);
  const a = draft.styleColor;
  const b = draft.styleColor2;
  const n = 3 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const rad = cell * (2 + r() * 3);
    const cx = (r() * 2 - 1) * (halfW - rad);
    const cz = (r() * 2 - 1) * (halfL - rad);
    const color = i % 2 ? a : b;
    blocks.push(...discBlocks(cx, cz, rad, cell, color));
    const drips = 2 + Math.floor(r() * 3);
    for (let j = 0; j < drips; j++) {
      const dx = Math.max(-halfW + cell, Math.min(halfW - cell, cx + (r() * 2 - 1) * rad * 0.8));
      const dz = Math.max(-halfL + cell, Math.min(halfL - cell, cz + rad * (0.7 + r() * 0.7)));
      blocks.push({ x: dx, z: dz, w: cell, d: cell * (1 + r() * 1.4), color });
    }
  }
  return blocks;
}

function genCircuit(shape, draft) {
  const blocks = [];
  const halfL = shape.kickStart;
  const halfW = shape.deckW / 2;
  const cell = Math.min(shape.deckW / 16, 0.014);
  const dark = shade(draft.colors.deck, 0.35);
  const trace = draft.styleColor;
  const node = draft.styleColor2;
  for (let z = -halfL; z <= halfL; z += cell) {
    blocks.push({ x: 0, z: z + cell / 2, w: halfW * 2, d: cell, color: dark });
  }
  // Orthogonal traces, then the pads at their joints.
  const r = rng(0x4ca9);
  for (let i = 0; i < 6; i++) {
    const cz = -halfL * 0.8 + r() * halfL * 1.6;
    const len = halfW * 2 * (0.35 + r() * 0.55);
    blocks.push({ x: 0, z: cz, w: len, d: cell * 0.7, color: trace });
  }
  for (let i = 0; i < 5; i++) {
    const cx = -halfW * 0.8 + r() * halfW * 1.6;
    const len = halfL * 2 * (0.35 + r() * 0.55);
    blocks.push({ x: cx, z: 0, w: cell * 0.7, d: len, color: trace });
  }
  for (let i = 0; i < 9; i++) {
    const cx = (r() * 2 - 1) * halfW * 0.75;
    const cz = (r() * 2 - 1) * halfL * 0.75;
    blocks.push({ x: cx, z: cz, w: cell * 1.8, d: cell * 1.8, color: node });
  }
  return blocks;
}

function genSunburst(shape, draft) {
  const blocks = [];
  const halfL = shape.kickStart;
  const halfW = shape.deckW / 2;
  const a = draft.styleColor;
  const b = draft.styleColor2;
  const cell = Math.min(shape.deckW / 10, 0.02);
  const rays = 12;
  const len = Math.min(halfW * 2, halfL * 2) * 0.98;
  for (let i = 0; i < rays; i++) {
    const ang = (i / rays) * Math.PI * 2;
    blocks.push({ x: 0, z: 0, w: cell * 2, d: len, color: i % 2 ? a : b, rot: ang });
  }
  // A bright hub in the middle.
  blocks.push(...discBlocks(0, 0, cell * 2.2, cell * 0.7, 0xffc93f));
  return blocks;
}

function genChevron(shape, draft) {
  const blocks = [];
  const halfL = shape.kickStart;
  const halfW = shape.deckW / 2;
  const cell = Math.min(shape.deckW / 10, 0.02);
  const waves = 4;
  for (let w = 0; w < waves; w++) {
    const cz = -halfL * 0.68 + (w / (waves - 1)) * halfL * 1.36;
    const base = w % 2 ? draft.styleColor : draft.styleColor2;
    for (let i = -4; i <= 4; i++) {
      blocks.push({
        x: i * cell,
        z: cz + Math.abs(i) * cell * 0.5,
        w: cell,
        d: cell,
        color: i < 0 ? shade(base, 1.18) : base,
      });
    }
  }
  return blocks;
}

function genShield(shape, draft) {
  const blocks = [];
  const halfL = shape.kickStart;
  const halfW = shape.deckW / 2;
  const cell = Math.min(shape.deckW / 10, 0.02);
  const front = draft.styleColor;
  const alt = draft.styleColor2;
  const text = sanitizeText(draft.text) || 'S';
  const w = halfW * 0.8;
  const h = halfL * 0.72;
  const top = halfL * 0.32;
  // The shield body: a wide top that tapers to a point.
  for (let z = top; z >= top - h; z -= cell) {
    const t = (top - z) / h;
    const half = w * (1 - t * 0.55);
    blocks.push({ x: 0, z: z + cell / 2, w: half * 2, d: cell, color: front });
  }
  // A vertical centre stripe, studs top and bottom.
  blocks.push({ x: 0, z: top - h / 2, w: w * 0.24, d: h, color: alt });
  blocks.push({ x: 0, z: top - h * 0.82, w: cell * 1.4, d: cell * 1.4, color: 0xffffff });
  blocks.push({ x: 0, z: top - h * 0.18, w: cell * 1.4, d: cell * 1.4, color: 0xffffff });
  // Block lettering rides the centre stripe, sized to stay on the shield.
  const mid = top - h / 2;
  const tCell = Math.min(fitTextCell(shape, text.length, 0.024), (w * 0.94) / (text.length * 4 - 1));
  blocks.push(...textBlocks(text, tCell, 0, mid, { ' ': front }, { dx: 1.4, dz: 1.4 }));
  blocks.push(...textBlocks(text, tCell, 0, mid, { ' ': 0xffffff }));
  return blocks;
}

function genDarts(shape, draft) {
  const blocks = [];
  const halfL = shape.kickStart;
  const halfW = shape.deckW / 2;
  const cell = Math.min(shape.deckW / 12, 0.018);
  const a = draft.styleColor;
  const b = draft.styleColor2;
  const rMax = Math.min(halfW, halfL) * 0.95;
  const rings = 5;
  for (let ring = rings; ring >= 0; ring--) {
    const r = (ring / rings) * rMax;
    blocks.push(...discBlocks(0, 0, r, cell, ring % 2 ? a : b));
  }
  return blocks;
}

function genBlockart(shape, draft) {
  const blocks = [];
  const cells = draft.pixels;
  const W = shape.deckW * 0.9;
  const L = shape.kickStart * 2 * 0.9;
  const cell = Math.min(W / BLOCKART_COLS, L / BLOCKART_ROWS);
  for (let r = 0; r < BLOCKART_ROWS; r++) {
    for (let c = 0; c < BLOCKART_COLS; c++) {
      const idx = cells && cells[r] && cells[r][c] ? cells[r][c] : 0;
      if (!idx || !PIXEL_PALETTE[idx]) continue;
      blocks.push({
        x: (c - (BLOCKART_COLS - 1) / 2) * cell,
        z: (r - (BLOCKART_ROWS - 1) / 2) * cell,
        w: cell,
        d: cell,
        color: PIXEL_PALETTE[idx],
      });
    }
  }
  return blocks;
}

const GENERATORS = {
  plain: () => [],
  pixel: genPixel,
  graffiti: genGraffiti,
  flame: genFlame,
  lightning: genLightning,
  camo: genCamo,
  checker: genChecker,
  stickers: genStickers,
  arcade: genArcade,
  shop: genShop,
  retro: genRetro,
  tiger: genTiger,
  space: genSpace,
  argyle: genArgyle,
  splat: genSplat,
  circuit: genCircuit,
  sunburst: genSunburst,
  chevron: genChevron,
  shield: genShield,
  darts: genDarts,
  blockart: genBlockart,
};

// ---------------------------------------------------------------------------
// The finished design, and the draft it starts from.
// ---------------------------------------------------------------------------
export const DEFAULT_BOARD_DRAFT = {
  name: 'My Board',
  type: TYPES[0].id,
  colors: {
    deck: 0x9b6a3f,
    grip: 0x1b1b1e,
    accent: 0xd6c064,
    ply: 0xd8b183,
    truck: 0xb9bec6,
    wheel: 0xe6e2d8,
    bearing: 0x8d8f93,
    bolt: 0x6e7378,
  },
  style: 'plain',
  text: 'SKATE',
  styleColor: 0xd3323f,
  styleColor2: 0x35ffe0,
  // Neon under glow: `null` is off, a hex colour is a glowing strip
  // underneath the deck. Built by board.js into its own emissive meshes.
  underGlow: null,
  pixels: defaultPixels(),
  pixelBrush: 3,
  layers: [],
};

/**
 * Every art block the draft paints, base style and sticker layers combined.
 * Called by board.js's buildDeck, which turns each block into a box sitting
 * proud of the grip tape.
 *
 * @param {object} shape the board type's shape — deckW and kickStart matter
 * @param {object} draft a board-maker draft
 * @returns {{blocks: Array, skipStripe: boolean}}
 */
export function buildDesignBlocks(shape, draft) {
  const d = draft || DEFAULT_BOARD_DRAFT;
  const gen = GENERATORS[d.style] || GENERATORS.plain;
  const blocks = gen(shape, d);
  const layerColors = { X: d.styleColor, x: d.styleColor2 };
  // Sticker layers always sit on top of the base pattern.
  for (const layer of d.layers || []) {
    if (!layer || !ICONS[layer.icon]) continue;
    const sprite = ICONS[layer.icon];
    const color = layer.color || d.styleColor;
    const scale = layer.scale == null ? 1 : layer.scale;
    const cell = Math.min(shape.deckW / 9, 0.024) * scale;
    blocks.push(...spriteBlocks(sprite, { X: color, x: color }, layer.x, layer.z, cell, layer.rot || 0));
  }
  return { blocks, skipStripe: blocks.length > 0 };
}

/** The palette a board is built from: the draft's own colours. */
export function designPalette(draft) {
  const d = draft || DEFAULT_BOARD_DRAFT;
  return { ...DEFAULT_BOARD_DRAFT.colors, ...d.colors };
}

/** A short human-facing summary for the preview strip and saved cards. */
export function summarizeDesign(draft) {
  const style = styleById[draft.style]?.name || 'Plain';
  const type = typeById[draft.type]?.name || 'Shortboard';
  const extras = draft.layers.length ? ` +${draft.layers.length} sticker${draft.layers.length === 1 ? '' : 's'}` : '';
  const glow = draft.underGlow != null ? ' · neon glow' : '';
  return `${type} · ${style}${extras}${glow}`;
}
