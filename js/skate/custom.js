// The Character Maker: a whole rider built from parts you pick, not a
// character from characters.js with clothes layered over it.
//
// The shop sells you three things — a character, a shirt, a hat — and each
// layer overrides the one beneath: an outfit recolours the torso of whoever is
// equipped, an accessory recolours the head. The maker is the same stack, but
// *you* are every layer of it, right down to the skin. So a made character is
// not a new slot in characters.js: it is a description — which skin, how tall,
// how stocky, which pants, which shoes, which shirt, which hat, which shades —
// that currentLook() resolves against the same palette+style pair the shop's
// selectOutfit() already rebuilds the rig with. One look pipeline, two ways of
// reaching it.
//
// Prices are for *access*, like the shop's, not for the parts themselves: the
// first time you pick a paid hat it costs coins, and then it is yours in the
// maker forever. There is no own/equip split for a maker part either — once a
// pair of pants is owned it just sits in the rack, priced nothing from then
// on, exactly like a board you have already bought.
//
// Two things are deliberately free. Every body (skin, height, build, hair) is
// free, because a store that charges a fat tax or a skin tax is gross, and it
// would split what the four prebuilt characters already give everyone free.
// And the two made-in shirt blanks are free too, so a first-time visitor can
// make a character in their own colours without a trip to the shop first —
// the maker is supposed to feel like a welcome mat, not like a paywall.

export const SKIN_TONES = [
  { id: 'fair', name: 'Fair', price: 0, color: 0xf0c8a0 },
  { id: 'warm', name: 'Warm', price: 0, color: 0xc9a07c },
  { id: 'olive', name: 'Olive', price: 0, color: 0xa87d52 },
  { id: 'brown', name: 'Brown', price: 0, color: 0x8a5f3d },
  { id: 'deep', name: 'Deep', price: 0, color: 0x5f3b24 },
];

export const HEIGHTS = [
  { id: 'short', name: 'Short', scale: 0.94 },
  { id: 'average', name: 'Average', scale: 1 },
  { id: 'tall', name: 'Tall', scale: 1.08 },
];

// A build is a sideways spread, not an up-down one. Short+stocky is a
// ball-of-a-person; tall+slim is a beanpole; average+regular is the plain
// figure the four prebuilt riders are drawn at, so the maker's neutral state
// is exactly the body everyone is already used to seeing.
export const BUILDS = [
  { id: 'slim', name: 'Slim', width: 0.95 },
  { id: 'regular', name: 'Regular', width: 1 },
  { id: 'stocky', name: 'Stocky', width: 1.14 },
];

export const PANTS = [
  { id: 'jeans', name: 'Jeans', price: 0, colors: { pants: 0x3d4658, pantsDark: 0x333b4b } },
  { id: 'khaki', name: 'Khaki', price: 0, colors: { pants: 0x9a8a5f, pantsDark: 0x7a6c48 } },
  { id: 'charcoal', name: 'Charcoal', price: 150, colors: { pants: 0x23262b, pantsDark: 0x1a1c20 } },
  { id: 'cargo', name: 'Cargo', price: 150, colors: { pants: 0x6a7a5c, pantsDark: 0x525f44 } },
];

export const SHOES = [
  { id: 'canvas', name: 'Canvas', price: 0, colors: { shoe: 0xe8e6df, sole: 0xb8b4a8 } },
  { id: 'court', name: 'Court', price: 0, colors: { shoe: 0x2b2b30, sole: 0xe8e6df } },
  { id: 'hightop', name: 'High-Top', price: 150, colors: { shoe: 0x8a2f2a, sole: 0x1f1a18 } },
  { id: 'skate', name: 'Skate', price: 200, colors: { shoe: 0x242a30, sole: 0xc9a04e } },
];

// The hair the prebuilt characters wear, offered in their own colours. The
// four shapes are the four `style.head` values the rig already knows how to
// draw, so the maker costs the geometry builder nothing new.
export const HAIRS = [
  { id: 'cap', name: 'Cap', price: 0, color: 0x2a2016 },
  { id: 'hair', name: 'Mane', price: 0, color: 0x2a2016 },
  { id: 'helmet', name: 'Helmet', price: 0, color: 0x2f3b52 },
  { id: 'tiger', name: 'Tiger', price: 0, color: 0x6b7a3a },
];

// The two made-in shirt blanks. Every bought outfit is a richer version of
// one of these two colours, so a made character always has a way to move
// into the shop's rack when the coins arrive.
export const SHIRTS = [
  { id: 'tee-white', name: 'White Tee', price: 0, colors: { shirt: 0xdcdcd6, sleeve: 0x9aa4b4 } },
  { id: 'tee-black', name: 'Black Tee', price: 0, colors: { shirt: 0x2a2d33, sleeve: 0x3a3f47 } },
  { id: 'tee-crimson', name: 'Crimson Tee', price: 150, colors: { shirt: 0xc65b4a, sleeve: 0x9a4638 } },
  { id: 'tee-ocean', name: 'Ocean Tee', price: 150, colors: { shirt: 0x3f7fb0, sleeve: 0x33648c } },
  { id: 'tee-forest', name: 'Forest Tee', price: 150, colors: { shirt: 0x5aa15c, sleeve: 0x477e49 } },
  { id: 'tee-amber', name: 'Amber Tee', price: 200, colors: { shirt: 0xcf9c3e, sleeve: 0xa87c30 } },
  { id: 'tee-violet', name: 'Violet Tee', price: 200, colors: { shirt: 0x8a5ac6, sleeve: 0x6d47a0 } },
  { id: 'tee-neon', name: 'Neon Tee', price: 300, colors: { shirt: 0x35ffe0, sleeve: 0x1f9e8c } },
];

// Hats and shades are shared with the shop's accessories, so the maker wears
// exactly the headwear the haberdashery sells. `none` and `flatcap` are the
// two head styles the maker can buy by hand; every other style lives behind
// its accessory's price. Each entry renames the accessory so the picker reads
// like a clothing rack ("Flat Cap") rather than like a shop catalogue
// ("Red Cap", 120 coins).
export const HATS = [
  { id: 'none', name: 'No Hat', price: 0, style: null, colors: null },
  { id: 'flatcap', name: 'Flat Cap', price: 0, style: 'flatcap', colors: { cap: 0x6a7a5c, band: 0x4a5640 } },
  { id: 'red-cap', name: 'Red Cap', price: 120, style: 'cap', colors: { cap: 0xc65b4a, band: 0x7a2e22 } },
  { id: 'midnight', name: 'Midnight Beanie', price: 120, style: 'beanie', colors: { cap: 0x1f2430, band: 0x14171e } },
  { id: 'bucket', name: 'Bucket Hat', price: 200, style: 'bucket', colors: { cap: 0x8a9a5c, band: 0x6a7a44 } },
  { id: 'tophat', name: 'Top Hat', price: 350, style: 'tophat', colors: { cap: 0x1c1c20, band: 0xc9a04e } },
];

export const SHADES = [
  { id: 'none', name: 'None', price: 0, colors: null },
  { id: 'aviator', name: 'Aviator', price: 0, colors: { shades: 0x141416, lens: 0x0f1420 } },
  { id: 'shades', name: 'Shades', price: 150, colors: { shades: 0x141416, lens: 0x0f1420 } },
  { id: 'gold-shades', name: 'Gold Shades', price: 300, colors: { shades: 0xc9a04e, lens: 0x2a1f10 } },
];

const byListId = (list) => Object.fromEntries(list.map((p) => [p.id, p]));
export const skinById = byListId(SKIN_TONES);
export const heightById = byListId(HEIGHTS);
export const buildById = byListId(BUILDS);
export const pantsById = byListId(PANTS);
export const shoeById = byListId(SHOES);
export const hairById = byListId(HAIRS);
export const shirtById = byListId(SHIRTS);
export const hatById = byListId(HATS);
export const shadeById = byListId(SHADES);

/** The parts a fresh maker starts from: free, and the shop's own defaults. */
export const DEFAULT_CUSTOM = {
  skin: SKIN_TONES[0].id,
  height: HEIGHTS[1].id,
  build: BUILDS[1].id,
  hair: HAIRS[0].id,
  pants: PANTS[0].id,
  shoes: SHOES[0].id,
  shirt: SHIRTS[0].id,
  hat: HATS[0].id,
  shades: SHADES[0].id,
};

/** Which catalogue owns which draft slot — for save.js's owned-lists. */
export const PART_BY_ID = {
  skin: skinById,
  height: heightById,
  build: buildById,
  hair: hairById,
  pants: pantsById,
  shoes: shoeById,
  shirt: shirtById,
  hat: hatById,
  shades: shadeById,
};

/** Roles that cost coins; the free body slots are never "owned". */
export const PAID_ROLES = ['pants', 'shoes', 'shirts', 'hats', 'shades'];

/**
 * The palette the rig is built from: the free made-in base, painted with the
 * picked pants, shoes, shirt and headwear, exactly as lookOf() paints a
 * character with an outfit and accessory — but with nobody underneath but
 * the base colours, because the maker has no character to inherit from.
 */
export function lookOf(c) {
  const pants = pantsById[c.pants];
  const shoes = shoeById[c.shoes];
  const shirt = shirtById[c.shirt];
  const hair = hairById[c.hair];
  const hat = hatById[c.hat];
  const shades = shadeById[c.shades];
  return {
    skin: skinById[c.skin].color,
    hair: hair.color,
    cap: hat.colors ? hat.colors.cap : hair.color,
    band: hat.colors ? hat.colors.band : hair.color,
    shirt: shirt.colors.shirt,
    sleeve: shirt.colors.sleeve,
    pants: pants.colors.pants,
    pantsDark: pants.colors.pantsDark,
    shoe: shoes.colors.shoe,
    sole: shoes.colors.sole,
    shades: shades.colors ? shades.colors.shades : 0x141416,
    lens: shades.colors ? shades.colors.lens : 0x0f1420,
  };
}

/**
 * The style the rig is built from. `hat` is null for "No Hat", which leaves
 * the maker's own hair; every other style names a head headParts() knows.
 */
export function styleOf(c) {
  return {
    head: hatById[c.hat].style || hairById[c.hair].id,
    shades: shadeById[c.shades].colors !== null,
  };
}

/** The one `look` object the whole game rebuilds with. */
export function customLook(c) {
  return { palette: lookOf(c), style: styleOf(c) };
}

/** A short, human-facing summary for the preview strip. */
export function summarize(c) {
  const body = `${heightById[c.height].name} · ${buildById[c.build].name} build`;
  return `${body} — ${pantsById[c.pants].name}, ${shoeById[c.shoes].name}, ${shirtById[c.shirt].name}`;
}
