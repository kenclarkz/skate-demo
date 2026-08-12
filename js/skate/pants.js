// The pants rack: leg colours layered over whichever character is equipped, the
// same way outfits.js layers a shirt over the torso.
//
// Overrides, not whole palettes: each names only the two keys pants actually
// change — the thigh and the darker shin — so any rider can wear them without
// their shoes, shirt or headwear being touched. "Jeans" is the free default,
// the same dark denim every shipped character already skates in.

export const PANTS = [
  {
    id: 'jeans',
    name: 'Jeans',
    price: 0,
    colors: { pants: 0x3d4658, pantsDark: 0x333b4b },
  },
  {
    id: 'khaki',
    name: 'Khaki',
    price: 150,
    colors: { pants: 0x9a8a5f, pantsDark: 0x7a6c48 },
  },
  {
    id: 'charcoal',
    name: 'Charcoal',
    price: 150,
    colors: { pants: 0x23262b, pantsDark: 0x1a1c20 },
  },
  {
    id: 'cargo',
    name: 'Cargo',
    price: 150,
    colors: { pants: 0x6a7a5c, pantsDark: 0x525f44 },
  },
  {
    id: 'slate',
    name: 'Slate Denim',
    price: 200,
    colors: { pants: 0x3a4152, pantsDark: 0x2e3442 },
  },
];

export const byId = Object.fromEntries(PANTS.map((p) => [p.id, p]));
export const DEFAULT_PANTS_ID = PANTS[0].id;

/** The colour keys pants own, for their colour wheel in the shop. */
export const colorKeys = () => ['pants', 'pantsDark'];

/** The default colours behind those keys, so a wheel can reset to them. */
export const defaultColors = (p) => ({ ...p.colors });
