// The haberdashery: hats, shades and backpacks, bought and worn on top of
// whichever character is equipped. One accessory-slot at a time — equipping a
// hat swaps the character's headwear, equipping shades puts the face piece on,
// equipping a backpack slings it over the shoulders — while shirts (outfits.js)
// and pants (pants.js) are their own slots on the same screen.
//
// Three kinds of override, in the same spirit as outfits.js but aimed at the
// head and the back instead of the torso. A `hat` replaces the character's own
// headwear with one of the styles headParts() knows how to build, and
// re-colours the cap and band for it. `shades` turns on the face piece and
// re-colours its frame and lenses. `pack` adds the backpack geometry skater.js
// builds and re-colours its shell and straps. "Original" overrides nothing,
// which is what leaves each rider in the kit they came in.
//
// Every item is colorable: the colour keys it owns (cap/band for a hat,
// shades/lens for sunglasses, pack/strap for a backpack) feed straight into the
// rig's palette, and the shop lets an owner repaint any of them.

export const HATS = [
  {
    id: 'red-cap',
    name: 'Red Cap',
    price: 120,
    hat: { style: 'cap', cap: 0xc65b4a, band: 0x7a2e22 },
  },
  {
    id: 'midnight',
    name: 'Midnight Beanie',
    price: 120,
    hat: { style: 'beanie', cap: 0x1f2430, band: 0x14171e },
  },
  {
    id: 'bucket',
    name: 'Bucket Hat',
    price: 200,
    hat: { style: 'bucket', cap: 0x8a9a5c, band: 0x6a7a44 },
  },
  {
    id: 'tophat',
    name: 'Top Hat',
    price: 350,
    hat: { style: 'tophat', cap: 0x1c1c20, band: 0xc9a04e },
  },
  {
    id: 'straw',
    name: 'Straw Sun Hat',
    price: 250,
    hat: { style: 'straw', cap: 0xe0c77a, band: 0xb08a34 },
  },
];

export const SUNGLASSES = [
  {
    id: 'shades',
    name: 'Shades',
    price: 150,
    shades: { frame: 0x141416, lens: 0x0f1420 },
  },
  {
    id: 'aviator',
    name: 'Aviators',
    price: 150,
    shades: { frame: 0x2a2d33, lens: 0x18222e },
  },
  {
    id: 'gold-shades',
    name: 'Gold Shades',
    price: 300,
    shades: { frame: 0xc9a04e, lens: 0x2a1f10 },
  },
  {
    id: 'sky-shades',
    name: 'Sky Shades',
    price: 250,
    shades: { frame: 0x3f7fb0, lens: 0x10263a },
  },
  {
    id: 'rose-shades',
    name: 'Rose Shades',
    price: 250,
    shades: { frame: 0x8a3a5c, lens: 0x2a1020 },
  },
];

export const BACKPACKS = [
  {
    id: 'daypack',
    name: 'Canvas Pack',
    price: 180,
    pack: { pack: 0x9a8a5f, strap: 0x6a5a3c },
  },
  {
    id: 'street-pack',
    name: 'Street Pack',
    price: 200,
    pack: { pack: 0x23262b, strap: 0xc4433a },
  },
  {
    id: 'vintage',
    name: 'Vintage Pack',
    price: 220,
    pack: { pack: 0x6a7a5c, strap: 0x4a5640 },
  },
  {
    id: 'sunset',
    name: 'Sunset Pack',
    price: 260,
    pack: { pack: 0xe8722c, strap: 0x7c3fa0 },
  },
  {
    id: 'neon-pack',
    name: 'Neon Pack',
    price: 300,
    pack: { pack: 0x35ffe0, strap: 0xff2fa0 },
  },
];

// The full rack in display order: hats, then sunglasses, then backpacks. The
// "Original" (nothing) entry is what a fresh player is equipped with; it is
// not sold, so it carries no category and never appears in a category grid.
export const ACCESSORIES = [
  {
    id: 'none',
    name: 'Original',
    price: 0,
    category: 'none',
    hat: null,
    shades: null,
    pack: null,
  },
  ...HATS,
  ...SUNGLASSES,
  ...BACKPACKS,
];

export const CATEGORIES = [
  ['hats', 'Hats', HATS],
  ['sunglasses', 'Sunglasses', SUNGLASSES],
  ['backpacks', 'Backpacks', BACKPACKS],
];

export const byId = Object.fromEntries(ACCESSORIES.map((a) => [a.id, a]));
export const DEFAULT_ACCESSORY_ID = ACCESSORIES[0].id;

/** The colour keys an item of each category carries, for the colour wheel. */
export const colorKeys = (a) => (a.hat ? ['cap', 'band'] : a.shades ? ['shades', 'lens'] : a.pack ? ['pack', 'strap'] : []);

/** The default colours behind those keys, so a wheel can reset to them. */
export const defaultColors = (a) => (a.hat ? { cap: a.hat.cap, band: a.hat.band } : a.shades ? { shades: a.shades.frame, lens: a.shades.lens } : a.pack ? { pack: a.pack.pack, strap: a.pack.strap } : {});
