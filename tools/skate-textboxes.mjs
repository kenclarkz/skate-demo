// Focused headless check of the text boxes in the Board Maker and the Park
// Designer — the name field, the block-lettering field and the park-name field
// must all accept spaces, upper case and a fully-cleared field. This is the
// regression test for the "Text boxes" issue (deleting all text, spaces and
// upper case were swallowed by re-renders and default-name fallbacks).
//
//   python3 -m http.server 8080 --directory <repo> &
//   SMOKE_BASE=http://localhost:8080 node tools/skate-textboxes.mjs
//
// It drives the real UI: types into each box character by character, clears it
// and checks the live draft stays empty, then confirms a save still lands on a
// default name when the field was left blank.
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

// --- Board Maker: the deck name -------------------------------------------
await page.click('#btn-boardmaker');
await page.waitForTimeout(400);

const name = page.locator('#bm-name');
await name.click();
await page.keyboard.press('ControlOrMeta+A');
await page.keyboard.press('Backspace');
await name.pressSequentially('My Cool Board', { delay: 10 });
await page.waitForTimeout(200);
ok((await name.inputValue()) === 'My Cool Board', `board name keeps spaces + case: "${await name.inputValue()}"`);
let draftName = await page.evaluate(() => window.__skate.save.boardDraft.name);
ok(draftName === 'My Cool Board', `draft name keeps spaces + case (got "${draftName}")`);

await name.click();
await page.keyboard.press('ControlOrMeta+A');
await page.keyboard.press('Backspace');
await page.waitForTimeout(200);
ok((await name.inputValue()) === '', 'board name can be fully deleted (field empty)');
draftName = await page.evaluate(() => window.__skate.save.boardDraft.name);
ok(draftName === '', `empty board name stays empty in the draft (got "${draftName}")`);

await name.pressSequentially('Skate Park ', { delay: 5 });
await name.pressSequentially('UPPER', { delay: 5 });
await page.waitForTimeout(200);
ok((await name.inputValue()) === 'Skate Park UPPER', `space + upper case work mid-name: "${await name.inputValue()}"`);

// A save with a blank name still gets the default label.
await page.keyboard.press('ControlOrMeta+A');
await page.keyboard.press('Backspace');
await page.click('#btn-bm-save');
await page.waitForTimeout(400);
ok(await page.isVisible('#screen-start'), 'save returns to start');
const savedBoards = await page.evaluate(() => window.__skate.save.customBoards);
ok(savedBoards.length === 1 && savedBoards[0].name === 'My Board', `blank name saves with the default label (got "${savedBoards[0]?.name}")`);
await page.click('#btn-boardmaker');
await page.waitForTimeout(300);
await page.click('[data-bmaction="delete"]');
await page.waitForTimeout(200);

// --- Board Maker: the block-lettering box ----------------------------------
await page.click('[data-bmstyle="graffiti"]');
await page.waitForTimeout(300);
const letter = page.locator('#bm-text');
ok(await letter.isVisible(), 'lettering box appears for the graffiti style');
await letter.click();
await page.keyboard.press('ControlOrMeta+A');
await page.keyboard.press('Backspace');
await letter.pressSequentially('SKATE PRO', { delay: 10 });
await page.waitForTimeout(300);
ok((await letter.inputValue()) === 'SKATE PRO', `lettering box takes spaces + case over many keys: "${await letter.inputValue()}"`);
const draftText = await page.evaluate(() => window.__skate.save.boardDraft.text);
ok(draftText === 'SKATE PRO', `draft text matches (got "${draftText}")`);

// --- Park Designer: the park name ------------------------------------------
await page.click('#btn-bm-back');
await page.waitForTimeout(300);
await page.evaluate(() => window.__skate.showMyParks());
await page.waitForTimeout(300);
await page.click('#btn-mypark-new');
await page.waitForTimeout(400);
ok(await page.isVisible('#designer'), 'designer opens for a new park');

const pname = page.locator('#dg-name');
await pname.click();
await page.keyboard.press('ControlOrMeta+A');
await page.keyboard.press('Backspace');
await pname.pressSequentially('Big Skate Park', { delay: 10 });
await page.waitForTimeout(200);
ok((await pname.inputValue()) === 'Big Skate Park', `park name keeps spaces + case: "${await pname.inputValue()}"`);
await page.evaluate(() => document.getElementById('dg-name').blur()); // park name commits on blur
await page.waitForTimeout(200);
let file = await page.evaluate(() => window.__skate.designer.file);
ok(file.name === 'Big Skate Park', `park file name keeps spaces + case after blur (got "${file.name}")`);

await pname.click();
await page.keyboard.press('ControlOrMeta+A');
await page.keyboard.press('Backspace');
await page.waitForTimeout(200);
ok((await pname.inputValue()) === '', 'park name can be fully deleted (field empty)');
await page.evaluate(() => document.getElementById('dg-name').blur());
await page.waitForTimeout(200);
file = await page.evaluate(() => window.__skate.designer.file);
ok(file.name === '', `empty park name stays empty in the live file (got "${file.name}")`);

ok(errors.length === 0, `no page errors (${errors.length})`);
for (const e of errors.slice(0, 5)) console.log('   ', e.slice(0, 250));

await browser.close();
console.log(`\n${checks} checks, ${failures} failed`);
process.exit(failures ? 1 : 0);
