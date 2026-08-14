// Who you are, as opposed to what you are wearing: ten riders, each with
// their own skin, hair, headwear and kit.
//
// Everything that distinguishes them lives above the collar or in a colour,
// never in a measurement. THIGH, SHIN, HIP_W, SHOULDER_W and the rest are what
// the leg IK solves against and what the stance in physics.js is written in, so
// a taller character would stand with their feet somewhere other than on the
// deck. Headwear and palette turn out to be plenty: at the distance a chase
// camera sits, a beanie and a helmet read as two different people far more
// strongly than two centimetres of inseam ever would.
//
// Outfits (outfits.js) are shirt colours layered on top of whichever of these is
// equipped, and accessories (accessories.js) can swap the headwear and add
// shades on top of that — so the pairing is a character *and* a shirt *and*
// whatever they have on their head, not one or the other.

import { PALETTE } from './skater.js';

export const CHARACTERS = [
  {
    id: 'ace',
    name: 'Ace',
    blurb: 'Cap, tee, and a lifetime of flat ground.',
    style: { head: 'cap', sleeves: 'short' },
    palette: { ...PALETTE },
  },
  {
    id: 'nova',
    name: 'Nova',
    blurb: 'Beanie down over the ears, hoodie sleeves all the way to the knuckles.',
    style: { head: 'beanie', sleeves: 'long' },
    palette: {
      ...PALETTE,
      skin: 0x8d5a3c,
      hair: 0x1b1410,
      cap: 0x2a2e36,
      shirt: 0x3d444e,
      sleeve: 0x2e333a,
      pants: 0x24262b,
      pantsDark: 0x1e2024,
      shoe: 0x232326,
      sole: 0xdad6cc,
      band: 0x1a1a1d,
    },
  },
  {
    id: 'rae',
    name: 'Rae',
    blurb: 'Ponytail out the back, no hat, straight to the deep end.',
    style: { head: 'hair', sleeves: 'short' },
    palette: {
      ...PALETTE,
      skin: 0xe3b892,
      hair: 0x7a3a1e,
      cap: 0x7a3a1e,
      shirt: 0x2f8f86,
      sleeve: 0x24706a,
      pants: 0x4a4a52,
      pantsDark: 0x3d3d44,
      shoe: 0xf0eee8,
      sole: 0xbfbbb1,
      band: 0x2a2a2e,
    },
  },
  {
    id: 'bolt',
    name: 'Bolt',
    blurb: 'Helmet on, and still first into the bowl every single time.',
    style: { head: 'helmet', sleeves: 'long' },
    palette: {
      ...PALETTE,
      skin: 0xa9714a,
      hair: 0x241a12,
      cap: 0xc4433a,
      shirt: 0xe8e4d8,
      sleeve: 0xc9573f,
      pants: 0x2d3340,
      pantsDark: 0x252a35,
      shoe: 0x2b2b30,
      sole: 0xe8e6df,
      band: 0x1f2027,
    },
  },
  // The legendaries: the flash of the line-up, kept to the same rule as
  // everyone above — everything that tells them apart lives in the headwear
  // and the palette, so they ride the exact same physics.
  {
    id: 'tigre',
    name: 'Tigre',
    blurb: 'Stripes and ears and a nose for the deep end.',
    style: { head: 'tiger', sleeves: 'long' },
    palette: {
      ...PALETTE,
      skin: 0xe8a23c,
      hair: 0x2a2010,
      cap: 0x1c1408,
      shirt: 0xd97b1f,
      sleeve: 0xbf5f12,
      pants: 0x3a2a14,
      pantsDark: 0x2e2010,
      shoe: 0x2a2a2e,
      sole: 0xe8d8c0,
      band: 0x141008,
    },
  },
  {
    id: 'shove',
    name: 'Tony Shove',
    blurb: 'The Birdman — blond mullet and all, minus the trademark.',
    style: { head: 'hair', sleeves: 'short' },
    palette: {
      ...PALETTE,
      skin: 0xdcb088,
      hair: 0xd9c06a,
      cap: 0xd9c06a,
      shirt: 0x2b2b30,
      sleeve: 0x1f1f22,
      pants: 0x3c3c44,
      pantsDark: 0x303036,
      shoe: 0x232326,
      sole: 0xe0dcd2,
      band: 0x141416,
    },
  },
  {
    id: 'briar',
    name: 'Briar',
    blurb: 'Ears up over the coping, hops the rails instead of grinding them.',
    style: { head: 'bunny', sleeves: 'long' },
    palette: {
      ...PALETTE,
      skin: 0xe8d8c8,
      hair: 0x8a5a3a,
      cap: 0x8a5a3a,
      shirt: 0xcfb89a,
      sleeve: 0xb89a7c,
      pants: 0x5a4a40,
      pantsDark: 0x4a3a32,
      shoe: 0x3a3230,
      sole: 0xe0dcd2,
      band: 0xd89a9a,
    },
  },
  {
    id: 'gnorbert',
    name: 'Gnorbert',
    blurb: 'A garden gnome with a deck, and nowhere to hide it.',
    style: { head: 'cone', sleeves: 'long' },
    palette: {
      ...PALETTE,
      skin: 0xe3b892,
      hair: 0x4a3624,
      cap: 0xb03028,
      shirt: 0x5a8a5c,
      sleeve: 0x477e49,
      pants: 0x3a3a42,
      pantsDark: 0x303038,
      shoe: 0x2b2b30,
      sole: 0xe8e6df,
      band: 0xc9a04e,
    },
  },
  {
    id: 'bananas',
    name: 'Bananas',
    blurb: 'A monkey costume: ears out to the sides, and no fear of heights.',
    style: { head: 'monkey', sleeves: 'long' },
    palette: {
      ...PALETTE,
      skin: 0xd8a878,
      hair: 0x7a4a24,
      cap: 0x5e371a,
      shirt: 0x8a5a2a,
      sleeve: 0x6b4420,
      pants: 0x4a3520,
      pantsDark: 0x3a2a18,
      shoe: 0x2b2b30,
      sole: 0xc9b49a,
      band: 0x3a2512,
    },
  },
  {
    id: 'raven',
    name: 'Raven',
    blurb: 'A bird-man costume: crest up, beak out, glide over every rail.',
    style: { head: 'birdman', sleeves: 'short' },
    palette: {
      ...PALETTE,
      skin: 0xf0c060,
      hair: 0xc9a04e,
      cap: 0x2f8f86,
      shirt: 0x2f8f86,
      sleeve: 0x24706a,
      pants: 0x1f4a46,
      pantsDark: 0x163a36,
      shoe: 0xc9573f,
      sole: 0xe8e6df,
      band: 0xd97b1f,
    },
  },
];

export const byId = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));
export const DEFAULT_CHARACTER_ID = CHARACTERS[0].id;

/**
 * The palette the rig is actually built from: the character, with the equipped
 * shirt and pants painted over the top, then whatever the bought accessories
 * re-colour. An outfit with no `shirt` of its own ("Original") leaves the
 * character in their own clothes, which is the only way ten riders with
 * ten different kits can share one shirt rack without all ending up in the
 * same off-white tee. Likewise an accessory with no `hat`/`shades`/`pack`
 * ("Original") changes nothing at all.
 *
 * `accessories` is the set being worn — up to three items, one per category, so
 * a hat's cap/band, a pair of shades' frame/lens and a backpack's pack/strap
 * can all land on the same rider without ever writing over each other.
 *
 * `colors` carries the shop's per-item repaints — { accessory, outfit, pants }
 * maps keyed by the equipped item's id — so a bought hat, shirt or pair of
 * pants can be repainted from its own colour keys. Repaints only ever add to
 * the item's own colours; nothing else is touched.
 */
export function lookOf(character, outfit, accessories, pants, colors = {}) {
  const repaint = (map, id) => (map && id ? map[id] : null);
  let p = { ...character.palette };
  if (outfit?.shirt) p = { ...p, ...outfit.shirt, ...repaint(colors.outfit, outfit.id) };
  for (const a of accessories || []) {
    if (!a) continue;
    if (a.hat) p = { ...p, cap: a.hat.cap, band: a.hat.band, ...repaint(colors.accessory, a.id) };
    if (a.shades) p = { ...p, shades: a.shades.frame, lens: a.shades.lens, ...repaint(colors.accessory, a.id) };
    if (a.pack) p = { ...p, pack: a.pack.pack, strap: a.pack.strap, ...repaint(colors.accessory, a.id) };
  }
  if (pants?.colors) p = { ...p, ...pants.colors, ...repaint(colors.pants, pants.id) };
  return p;
}

/**
 * The style the rig is built from: the character's own headwear and sleeves,
 * with an equipped hat swapping the headwear for its own, an equipped pair of
 * shades flagging the face piece headParts() adds, and an equipped backpack
 * flagging the pack geometry skater.js builds. `style` is what tells the
 * geometry builder which head to draw; `lookOf` supplies its colours. Wearing
 * all three at once is the whole point — each one sets a different flag.
 */
export function styleOf(character, accessories) {
  const hat = (accessories || []).find((a) => a?.hat);
  const hasShades = (accessories || []).some((a) => a?.shades);
  const hasPack = (accessories || []).some((a) => a?.pack);
  return {
    ...character.style,
    head: hat ? hat.hat.style : character.style.head,
    shades: !!hasShades,
    pack: !!hasPack,
  };
}
