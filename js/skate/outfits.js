// The shirt rack: colours layered over whichever character is equipped, the same
// way boards.js is skins for the deck.
//
// These are *overrides*, not whole palettes. Each one names only the four keys a
// shirt actually changes — body, sleeves, hat and belt — so a shirt can be worn
// by any of the four riders in characters.js without also overwriting their skin,
// their hair or their shoes. "Original" overrides nothing at all, which is what
// leaves each character in the kit they came in.

export const OUTFITS = [
  {
    id: 'street',
    name: 'Original',
    price: 0,
    shirt: null, // whatever the equipped character already wears
  },
  {
    id: 'crimson',
    name: 'Crimson',
    price: 150,
    shirt: { shirt: 0xc65b4a, sleeve: 0x9a4638, cap: 0x7a2e22, band: 0x3a1a14 },
  },
  {
    id: 'ocean',
    name: 'Ocean',
    price: 150,
    shirt: { shirt: 0x3f7fb0, sleeve: 0x33648c, cap: 0x244a63, band: 0x1a3346 },
  },
  {
    id: 'forest',
    name: 'Forest',
    price: 150,
    shirt: { shirt: 0x5aa15c, sleeve: 0x477e49, cap: 0x35502f, band: 0x233821 },
  },
  {
    id: 'amber',
    name: 'Amber',
    price: 200,
    shirt: { shirt: 0xcf9c3e, sleeve: 0xa87c30, cap: 0x7a5a20, band: 0x4a3814 },
  },
  {
    id: 'violet',
    name: 'Violet',
    price: 200,
    shirt: { shirt: 0x8a5ac6, sleeve: 0x6d47a0, cap: 0x4a2e7a, band: 0x2e1c4a },
  },
  {
    id: 'neon',
    name: 'Neon',
    price: 300,
    // The brightest one on purpose — this is the shirt the wind glow shows
    // up best on.
    shirt: { shirt: 0x35ffe0, sleeve: 0x1f9e8c, cap: 0x0f5449, band: 0x0a3a30 },
  },
];

export const byId = Object.fromEntries(OUTFITS.map((o) => [o.id, o]));
export const DEFAULT_OUTFIT_ID = OUTFITS[0].id;
