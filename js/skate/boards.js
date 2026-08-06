// The board catalogue: real board types, each in a couple of skins.
//
// A "type" is a shape — deck length, width and kick, the silhouette that
// actually tells a longboard from a penny board apart at a glance — and a
// "skin" is a palette on top of it. Physics never sees either one: every
// type's trucks and wheels still sit exactly where physics puts them (see
// DEFAULT_SHAPE's comment in board.js), so nothing here changes how the
// board rides, only how it looks doing it.

export const TYPES = [
  {
    id: 'street',
    name: 'Shortboard',
    blurb: 'The popsicle shape everything else in the game was tuned around.',
    shape: { deckLen: 0.81, deckW: 0.205, kickStart: 0.145 },
  },
  {
    id: 'longboard',
    name: 'Longboard',
    blurb: 'Nose to tail, well past its own trucks. Mellow kicks, if any.',
    shape: { deckLen: 1.05, deckW: 0.23, kickStart: 0.42 },
  },
  {
    id: 'penny',
    name: 'Penny Board',
    blurb: 'Tiny, bright plastic, barely bigger than its own wheels.',
    shape: { deckLen: 0.56, deckW: 0.19, kickStart: 0.1 },
  },
  {
    id: 'cruiser',
    name: 'Cruiser',
    blurb: 'Between the two: a street deck stretched for a smoother ride.',
    shape: { deckLen: 0.92, deckW: 0.215, kickStart: 0.3 },
  },
];

export const typeById = Object.fromEntries(TYPES.map((t) => [t.id, t]));

export const BOARDS = [
  {
    id: 'maple',
    name: 'Street Maple',
    type: 'street',
    price: 0,
    palette: {
      deck: 0x9b6a3f,
      grip: 0x1b1b1e,
      accent: 0xd6c064,
      ply: 0xd8b183,
      truck: 0xb9bec6,
      wheel: 0xe6e2d8,
      bearing: 0x8d8f93,
      bolt: 0x6e7378,
    },
  },
  {
    id: 'blackout',
    name: 'Blackout',
    type: 'street',
    price: 150,
    palette: {
      deck: 0x17161a,
      grip: 0x0c0c0e,
      accent: 0xd3323f,
      ply: 0x3a3a40,
      truck: 0x2a2b30,
      wheel: 0x1e1e22,
      bearing: 0x55565c,
      bolt: 0x0c0c0e,
    },
  },
  {
    id: 'neon',
    name: 'Neon Riot',
    type: 'street',
    price: 150,
    palette: {
      deck: 0xff2fa0,
      grip: 0x14121a,
      accent: 0x35ffe0,
      ply: 0xffb3e6,
      truck: 0xd8d8e0,
      wheel: 0xbdff5c,
      bearing: 0x6a6a72,
      bolt: 0x3a3a44,
    },
  },
  {
    id: 'longboard-ocean',
    name: 'Ocean Longboard',
    type: 'longboard',
    price: 220,
    palette: {
      deck: 0x0f6e8c,
      grip: 0x0a2230,
      accent: 0xf2f6f0,
      ply: 0x9fd8e6,
      truck: 0xc7ccc9,
      wheel: 0xdbeff2,
      bearing: 0x7c9aa3,
      bolt: 0x4c5f63,
    },
  },
  {
    id: 'longboard-sunset',
    name: 'Sunset Longboard',
    type: 'longboard',
    price: 260,
    palette: {
      deck: 0xe8722c,
      grip: 0x2a1730,
      accent: 0x7c3fa0,
      ply: 0xffd6a0,
      truck: 0xd9c7cf,
      wheel: 0xffe0b0,
      bearing: 0x8a7080,
      bolt: 0x4a2f4a,
    },
  },
  {
    id: 'penny-sky',
    name: 'Sky Penny',
    type: 'penny',
    price: 180,
    palette: {
      deck: 0x3fc6ff,
      grip: 0x0f2a38,
      accent: 0xffffff,
      ply: 0xbdeeff,
      truck: 0xe8eaee,
      wheel: 0xffffff,
      bearing: 0x9297a0,
      bolt: 0x585b60,
    },
  },
  {
    id: 'penny-coral',
    name: 'Coral Penny',
    type: 'penny',
    price: 200,
    palette: {
      deck: 0xff6f5e,
      grip: 0x2a1210,
      accent: 0xffe27a,
      ply: 0xffc9c0,
      truck: 0xe8eaee,
      wheel: 0xfff2c2,
      bearing: 0x9297a0,
      bolt: 0x585b60,
    },
  },
  {
    id: 'cruiser-chrome',
    name: 'Chrome Cruiser',
    type: 'cruiser',
    price: 300,
    palette: {
      deck: 0xc9ccd1,
      grip: 0x101114,
      accent: 0x2f7fd1,
      ply: 0xe8eaee,
      truck: 0xdfe2e6,
      wheel: 0xeceff2,
      bearing: 0x9297a0,
      bolt: 0x585b60,
    },
  },
  {
    id: 'cruiser-gold',
    name: 'Gold Rush Cruiser',
    type: 'cruiser',
    price: 400,
    palette: {
      deck: 0xc79a3a,
      grip: 0x1a1712,
      accent: 0x121212,
      ply: 0xe8c874,
      truck: 0xb08a34,
      wheel: 0xf0d68a,
      bearing: 0x7a5f22,
      bolt: 0x2a2216,
    },
  },
];

export const byId = Object.fromEntries(BOARDS.map((b) => [b.id, b]));
export const DEFAULT_BOARD_ID = BOARDS[0].id;
