// The board catalogue: real board types, each with a price and a default paint.
//
// A "type" is a shape — deck length, width and kick, the silhouette that
// actually tells a longboard from a penny board apart at a glance — and the
// palette it ships in. Physics never sees either one: every type's trucks and
// wheels still sit exactly where physics puts them (see DEFAULT_SHAPE's comment
// in board.js), so nothing here changes how the board rides, only how it looks
// doing it.
//
// Buying a type is what gives the player its deck to ride; the starter street
// deck is owned by everyone. What the shop advertises is the type's own
// palette, and whatever the player builds on top of that shape is fully their
// own.

export const TYPES = [
  {
    id: 'street',
    name: 'Shortboard',
    price: 0,
    blurb: 'The popsicle shape everything else in the game was tuned around.',
    shape: { deckLen: 0.81, deckW: 0.205, kickStart: 0.145 },
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
    id: 'longboard',
    name: 'Longboard',
    price: 220,
    blurb: 'Nose to tail, well past its own trucks. Mellow kicks, if any.',
    shape: { deckLen: 1.05, deckW: 0.23, kickStart: 0.42 },
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
    id: 'penny',
    name: 'Penny Board',
    price: 180,
    blurb: 'Tiny, bright plastic, barely bigger than its own wheels.',
    shape: { deckLen: 0.56, deckW: 0.19, kickStart: 0.1 },
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
    id: 'cruiser',
    name: 'Cruiser',
    price: 300,
    blurb: 'Between the two: a street deck stretched for a smoother ride.',
    shape: { deckLen: 0.92, deckW: 0.215, kickStart: 0.3 },
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
    id: 'oldschool',
    name: 'Old School',
    price: 250,
    blurb: 'The wide, stubby pool deck of the eighties: a lot of board, very little kick.',
    shape: { deckLen: 0.82, deckW: 0.25, kickStart: 0.3 },
    palette: {
      deck: 0xc45a3c,
      grip: 0x1a1210,
      accent: 0xffd28a,
      ply: 0xe8c9a0,
      truck: 0xd9c7cf,
      wheel: 0xffe0b0,
      bearing: 0x8a7080,
      bolt: 0x4a2f2a,
    },
  },
  {
    id: 'freestyle',
    name: 'Freestyle',
    price: 280,
    blurb: 'A flat deck, nose and tail nearly level — made for manuals and rail flips.',
    shape: { deckLen: 0.78, deckW: 0.195, kickStart: 0.35 },
    palette: {
      deck: 0x2f7fd1,
      grip: 0x0c1420,
      accent: 0xffffff,
      ply: 0x9fd0ff,
      truck: 0xdfe2e6,
      wheel: 0xeceff2,
      bearing: 0x9297a0,
      bolt: 0x585b60,
    },
  },
  {
    id: 'mini',
    name: 'Mini Cruiser',
    price: 200,
    blurb: 'A pocket plastic cruiser: shorter than a penny, no wider than a street deck.',
    shape: { deckLen: 0.68, deckW: 0.2, kickStart: 0.16 },
    palette: {
      deck: 0x39e75f,
      grip: 0x0d1f12,
      accent: 0x12141a,
      ply: 0xa8f2c0,
      truck: 0xe8eaee,
      wheel: 0xbdff5c,
      bearing: 0x9297a0,
      bolt: 0x585b60,
    },
  },
];

export const typeById = Object.fromEntries(TYPES.map((t) => [t.id, t]));

// The catalogue is the types: what the shop sells, what save.js validates an
// owned board against, and what `boardId` points at when no custom deck is on.
export const byId = typeById;
export const DEFAULT_BOARD_ID = TYPES[0].id;
