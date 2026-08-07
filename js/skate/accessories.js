// The haberdashery: hats and shades, bought like boards and shirts and worn on
// top of whichever character is equipped. One head-slot at a time, like the
// one shirt and one board — equipping a hat swaps the character's headwear,
// equipping shades puts the face piece on and puts their own headwear back.
//
// Two kinds of override, in the same spirit as outfits.js but aimed at the
// head instead of the torso. A `hat` replaces the character's own headwear
// with one of the styles headParts() knows how to build, and re-colours the
// cap and band for it. `shades` turns on the face piece and re-colours its
// frame and lenses. "Original" overrides nothing, which is what leaves each
// rider in the kit they came in.

export const ACCESSORIES = [
  {
    id: 'none',
    name: 'Original',
    price: 0,
    hat: null, // whatever the equipped character already wears
    shades: null,
  },
  {
    id: 'red-cap',
    name: 'Red Cap',
    price: 120,
    hat: { style: 'cap', cap: 0xc65b4a, band: 0x7a2e22 },
    shades: null,
  },
  {
    id: 'midnight',
    name: 'Midnight Beanie',
    price: 120,
    hat: { style: 'beanie', cap: 0x1f2430, band: 0x14171e },
    shades: null,
  },
  {
    id: 'bucket',
    name: 'Bucket Hat',
    price: 200,
    hat: { style: 'bucket', cap: 0x8a9a5c, band: 0x6a7a44 },
    shades: null,
  },
  {
    id: 'tophat',
    name: 'Top Hat',
    price: 350,
    hat: { style: 'tophat', cap: 0x1c1c20, band: 0xc9a04e },
    shades: null,
  },
  {
    id: 'shades',
    name: 'Shades',
    price: 150,
    hat: null,
    shades: { frame: 0x141416, lens: 0x0f1420 },
  },
  {
    id: 'gold-shades',
    name: 'Gold Shades',
    price: 300,
    hat: null,
    shades: { frame: 0xc9a04e, lens: 0x2a1f10 },
  },
];

export const byId = Object.fromEntries(ACCESSORIES.map((a) => [a.id, a]));
export const DEFAULT_ACCESSORY_ID = ACCESSORIES[0].id;
