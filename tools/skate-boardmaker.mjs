// Focused headless check of the Board Maker flow — the screen that turns the
// maker's draft into a saved, equipped deck.
//
//   python3 -m http.server 8080 --directory <repo> &
//   SMOKE_BASE=http://localhost:8080 node tools/skate-boardmaker.mjs
//
// It drives the real UI (not the internals): opens the maker from the start
// menu, paints, re-colours, sticks, saves, edits, deletes and reloads, and
// fails on any page error along the way.
import { loadChromium, GL_ARGS } from './pw.mjs';

const BASE = process.env.SMOKE_BASE || 'http://localhost:8080/skate';

const chromium = await loadChromium();
const browser = await chromium.launch({ args: GL_ARGS });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

let checks = 0, failures = 0;
const ok = (cond, msg) => { checks++; console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) failures++; };

await page.goto(`${BASE}/index.html?debug=1`, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => !!window.__skate, null, { timeout: 30000 });
await page.waitForTimeout(1200);
await page.evaluate(() => window.__skate.showStart());

// Open the Board Maker from the start menu.
await page.click('#btn-boardmaker');
await page.waitForTimeout(500);
ok(await page.isVisible('#screen-boardmaker'), 'boardmaker screen is visible');
ok(await page.isHidden('#screen-start'), 'start screen hidden behind it');

// Racks populate from the catalogue.
const styleCount = await page.locator('#bm-style .maker-option').count();
ok(styleCount === 21, `style rack has 21 entries (got ${styleCount})`);
const typeCount = await page.locator('#bm-type .maker-option').count();
ok(typeCount === 7, `type rack has 7 entries (got ${typeCount})`);
const colorCount = await page.locator('#bm-colors .bm-color-row').count();
ok(colorCount === 6, `colour rack has 6 rows (got ${colorCount})`);
const noSaved = await page.textContent('#bm-saved');
ok(/No custom boards/.test(noSaved), 'empty saved rack shows the placeholder');

// Switch to block-art: a paint grid should appear.
await page.click('[data-bmstyle="blockart"]');
await page.waitForTimeout(300);
ok(await page.isVisible('[data-bmpixel]'), 'pixel grid appears for the block-art style');
const brushCount = await page.locator('.bm-brush').count();
ok(brushCount === 10, `brush rack has 9 paints + eraser (got ${brushCount})`);

// Paint a cell by clicking the canvas.
const box = await page.locator('[data-bmpixel]').boundingBox();
if (box) {
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.25);
  await page.waitForTimeout(200);
  const painted = await page.evaluate(() => {
    const c = document.querySelector('[data-bmpixel]');
    const g = c.getContext('2d');
    const px = g.getImageData(Math.floor(c.width / 2), Math.floor(c.height * 0.25), 1, 1).data;
    return px[0] !== 18 || px[1] !== 21 || px[2] !== 27; // not the empty cell grey
  });
  ok(painted, 'clicking the grid paints a cell');
}

// Recolour the deck via the colour input.
await page.locator('#bmc-deck').evaluate((el) => {
  el.value = '#ff00aa';
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(200);
const deckVal = await page.locator('#bmc-deck').inputValue();
ok(deckVal === '#ff00aa', `deck colour picker reflects the pick (got ${deckVal})`);
const deckDraft = await page.evaluate(() => window.__skate.save.boardDraft.colors.deck);
ok(deckDraft === 0xff00aa, `deck colour landed in the draft (got #${deckDraft?.toString(16)})`);

// Neon under glow: the toggle starts off, and the colour wheel is disabled
// with it.
const glowToggle = page.locator('[data-bmglowtoggle]');
ok(await glowToggle.isVisible(), 'under-glow toggle is visible');
ok((await glowToggle.textContent()) === 'Off', `under-glow starts off (got "${await glowToggle.textContent()}")`);
ok(await page.locator('[data-bmglowcolor]').isDisabled(), 'glow colour wheel is disabled while off');

// Toggle it on: the wheel enables and a neon colour lands in the draft.
await glowToggle.click();
await page.waitForTimeout(200);
ok((await glowToggle.textContent()) === 'On', 'toggling the under-glow turns it on');
ok(await page.locator('[data-bmglowcolor]').isEnabled(), 'glow colour wheel enables when on');
const glowSeed = await page.evaluate(() => window.__skate.save.boardDraft.underGlow);
ok(glowSeed === 0x35ffe0, `turning it on seeds the default neon colour (got #${glowSeed?.toString(16)})`);

// Pick a colour on the wheel; the draft follows.
await page.locator('[data-bmglowcolor]').evaluate((el) => {
  el.value = '#ff2fa0';
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(200);
const glowPicked = await page.evaluate(() => window.__skate.save.boardDraft.underGlow);
ok(glowPicked === 0xff2fa0, `the colour wheel drives the glow colour (got #${glowPicked?.toString(16)})`);
const glowColorVal = await page.locator('[data-bmglowcolor]').inputValue();
ok(glowColorVal === '#ff2fa0', `glow colour picker reflects the pick (got ${glowColorVal})`);

// Toggle back off: the draft goes null and the wheel disables again.
await glowToggle.click();
await page.waitForTimeout(200);
const glowOff = await page.evaluate(() => window.__skate.save.boardDraft.underGlow);
ok(glowOff === null, 'toggling off clears the glow colour');
ok(await page.locator('[data-bmglowcolor]').isDisabled(), 'glow colour wheel disables when off');

// Back on: the pick is remembered, and the preview deck really builds its glow.
await glowToggle.click();
await page.waitForTimeout(200);
const glowResumed = await page.evaluate(() => window.__skate.save.boardDraft.underGlow);
ok(glowResumed === 0xff2fa0, `toggling back on resumes the remembered colour (got #${glowResumed?.toString(16)})`);
const glowMeshes = await page.evaluate(() => {
  const b = window.__skate.hud.bmPreview?.board;
  return b ? b.glow.length : -1;
});
ok(glowMeshes === 2, `preview board builds the glow meshes (got ${glowMeshes})`);

// Stickers: add one, then select it.
await page.click('[data-bmicon="star"]');
await page.waitForTimeout(200);
const layerChips = await page.locator('.bm-layer-chip').count();
ok(layerChips === 1, `one sticker layer exists after tapping the star (got ${layerChips})`);
ok(await page.isVisible('.bm-layer-inspector'), 'sticker inspector opens for the selected layer');
const sliderVal = await page.locator('[data-bmls]').inputValue();
ok(sliderVal === '1', `sticker size slider defaults to 1 (got ${sliderVal})`);
await page.locator('[data-bmlr]').evaluate((el) => { el.value = '90'; el.dispatchEvent(new Event('input', { bubbles: true })); });
await page.waitForTimeout(200);

// Name it and save.
await page.fill('#bm-name', 'Hot Pink Deck');
await page.waitForTimeout(200);
await page.click('#btn-bm-save');
await page.waitForTimeout(500);
ok(await page.isVisible('#screen-start'), 'save returns to the start screen');

// Reopen: the saved card should be there, equipped, named.
await page.click('#btn-boardmaker');
await page.waitForTimeout(400);
const cardText = await page.textContent('#bm-saved');
ok(/Hot Pink Deck/.test(cardText), 'saved deck shows under its name');
ok(/On now/.test(cardText), 'saved deck is equipped on save');
ok(/neon glow/.test(cardText), 'saved deck card mentions the neon glow');
const cardCount = await page.locator('.bm-saved-card').count();
ok(cardCount === 1, `exactly one saved deck card (got ${cardCount})`);

// Re-opening after a save has to start a fresh board, not the deck that was
// just saved — "make another one" is a new deck, not re-saving the same one.
const draftAfterSave = await page.inputValue('#bm-name');
ok(draftAfterSave !== 'Hot Pink Deck', `after a save the maker opens a fresh board, not the saved one (got "${draftAfterSave}")`);
const freshDraftStyle = await page.locator('.maker-option.current[data-bmstyle]').getAttribute('data-bmstyle');
ok(freshDraftStyle === 'plain', `after a save the maker opens with the default style (got ${freshDraftStyle})`);

// Tapping a saved card to equip it puts that deck on the turntable, while the
// working draft (still being built) is left alone in the racks.
await page.fill('#bm-name', 'Work In Progress');
await page.waitForTimeout(200);
await page.click('.bm-saved-card');
await page.waitForTimeout(300);
const previewName = await page.evaluate(() => window.__skate.hud.bmPreview?.board.design?.name);
ok(previewName === 'Hot Pink Deck', `tapping a saved card shows it on the turntable (got ${previewName})`);
const draftAfter = await page.inputValue('#bm-name');
ok(draftAfter === 'Work In Progress', 'tapping a saved card leaves the working draft untouched');

// Edit loads the deck back into the draft.
await page.click('[data-bmaction="edit"]');
await page.waitForTimeout(300);
const draftName = await page.inputValue('#bm-name');
ok(draftName === 'Hot Pink Deck', `editing loads the deck back into the draft (got ${draftName})`);
const draftStyle = await page.locator('.maker-option.current[data-bmstyle]').getAttribute('data-bmstyle');
ok(draftStyle === 'blockart', `editing restores the block-art style (got ${draftStyle})`);
const editGlow = await page.evaluate(() => window.__skate.save.boardDraft.underGlow);
ok(editGlow === 0xff2fa0, `editing restores the glow colour (got #${editGlow?.toString(16)})`);

// Delete removes the saved deck.
await page.click('[data-bmaction="delete"]');
await page.waitForTimeout(300);
const afterDel = await page.textContent('#bm-saved');
ok(/No custom boards/.test(afterDel), 'delete clears the saved deck');

// Two decks in a row: saving the second one adds it without clobbering the
// first, and the freshly saved deck is the one equipped.
await page.fill('#bm-name', 'Second Deck');
await page.click('#btn-bm-save');
await page.waitForTimeout(400);
await page.click('#btn-boardmaker');
await page.waitForTimeout(400);
await page.fill('#bm-name', 'Third Deck');
await page.click('#btn-bm-save');
await page.waitForTimeout(400);
await page.click('#btn-boardmaker');
await page.waitForTimeout(400);
const secondCards = await page.locator('.bm-saved-card').count();
ok(secondCards === 2, `saving another deck adds it to the rack (got ${secondCards} cards)`);
const secondText = await page.textContent('#bm-saved');
ok(
  /Second Deck/.test(secondText) && /Third Deck/.test(secondText),
  'both saved decks are on the rack'
);
const secondEquipped = await page.evaluate(() => window.__skate.save.boardId);
ok(secondEquipped.startsWith('custom:'), `the new deck is equipped (${secondEquipped})`);

// Round-trip: a saved deck survives a reload.
await page.fill('#bm-name', 'Keeper');
await page.click('#btn-bm-save');
await page.waitForTimeout(300);
const equippedId = await page.evaluate(() => window.__skate.save.boardId);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
const equippedAfterReload = await page.evaluate(() => window.__skate.save.boardId);
ok(
  equippedAfterReload === equippedId,
  `the equipped custom deck survives a reload (${equippedAfterReload})`
);
await page.click('#btn-boardmaker');
await page.waitForTimeout(400);
const kept = await page.textContent('#bm-saved');
ok(/Keeper/.test(kept), 'saved deck survives a page reload');

// --- The back of the deck --------------------------------------------------
// The maker edits two faces of a deck: the top and the underside, each with
// its own complete design, and the base pattern of either face can be moved
// around the deck instead of sitting where the generator put it.
{
  ok(await page.locator('[data-bmface="top"]').isVisible(), 'face toggle shows a Top of deck button');
  ok(await page.locator('[data-bmface="back"]').isVisible(), 'face toggle shows a Back of deck button');
  const topClass = await page.locator('[data-bmface="top"]').getAttribute('class');
  ok(topClass.includes('on'), 'top of deck is the face being designed by default');

  // Flip to the back: every rack now reads and edits the underside's design.
  await page.click('[data-bmface="back"]');
  await page.waitForTimeout(200);
  const backClass = await page.locator('[data-bmface="back"]').getAttribute('class');
  ok(backClass.includes('on'), 'toggling to the back highlights it');
  const backPlain = await page.evaluate(() => window.__skate.save.boardDraft.back.style);
  ok(backPlain === 'plain', `the back of a fresh board starts plain (got ${backPlain})`);

  // The preview deck has no back art yet; give the back a style and the
  // underside really gains the geometry — the same merged draw call, more
  // vertices.
  const vertsBefore = await page.evaluate(
    () => window.__skate.hud.bmPreview?.board.deck.geometry.attributes.position.count ?? 0
  );
  await page.click('[data-bmstyle="checker"]');
  await page.waitForTimeout(200);
  const faces = await page.evaluate(() => ({
    top: window.__skate.save.boardDraft.style,
    back: window.__skate.save.boardDraft.back.style,
  }));
  ok(faces.back === 'checker', `the back takes the picked style (got ${faces.back})`);
  ok(faces.top === 'plain', 'and the top of the deck is left untouched');
  const vertsAfter = await page.evaluate(
    () => window.__skate.hud.bmPreview?.board.deck.geometry.attributes.position.count ?? 0
  );
  ok(vertsAfter > vertsBefore, `the back design really renders on the deck (${vertsBefore} → ${vertsAfter} verts)`);

  // Moving the design: with a pattern on the face, the placement inspector
  // appears and its knobs move the whole base pattern in the draft.
  ok(await page.locator('.bm-placement').isVisible(), 'Move-the-design inspector appears once the back has a pattern');
  const pxBefore = await page.evaluate(() => window.__skate.save.boardDraft.back.px);
  await page.locator('[data-bmpx]').evaluate((el) => {
    el.value = '0.09';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(200);
  const pxAfter = await page.evaluate(() => window.__skate.save.boardDraft.back.px);
  ok(pxAfter === 0.09, `dragging the pattern across moves it in the draft (${pxBefore} → ${pxAfter})`);
  const topPx = await page.evaluate(() => window.__skate.save.boardDraft.px);
  ok(topPx === 0, 'and the top of the deck keeps its own placement');

  // The back design travels with the deck: save it and the saved card mentions
  // it, and the reload round-trip keeps it.
  await page.fill('#bm-name', 'Two-Sided Deck');
  await page.click('#btn-bm-save');
  await page.waitForTimeout(300);
  await page.click('#btn-boardmaker');
  await page.waitForTimeout(300);
  const backCard = await page.textContent('#bm-saved');
  ok(/back: Checker Deck/.test(backCard), 'saved deck card mentions the back design');
}

ok(errors.length === 0, `no page errors (${errors.length})`);
for (const e of errors.slice(0, 5)) console.log('   ', e.slice(0, 250));

await browser.close();
console.log(`\n${checks} checks, ${failures} failed`);
process.exit(failures ? 1 : 0);
