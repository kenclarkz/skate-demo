// Who you are, as opposed to what you are wearing: four riders, each with their
// own skin, hair, headwear and kit.
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
// equipped — so the pairing is a character *and* a shirt, not one or the other.

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
];

export const byId = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));
export const DEFAULT_CHARACTER_ID = CHARACTERS[0].id;

/**
 * The palette the rig is actually built from: the character, with the equipped
 * shirt painted over the top. An outfit with no `shirt` of its own ("Original")
 * leaves the character in their own clothes, which is the only way four riders
 * with four different kits can share one shirt rack without all ending up in
 * the same off-white tee.
 */
export function lookOf(character, outfit) {
  return outfit && outfit.shirt ? { ...character.palette, ...outfit.shirt } : { ...character.palette };
}
