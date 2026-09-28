/**
 * Self-test for src/i18n.js.
 *   npm run test:i18n
 *
 * Two layers:
 *   1. Pure regex checks in Node (the whole-word traps, accents, case).
 *   2. Every wording of every key rendered as a real <button> in headless
 *      Chromium and located through Playwright exactly the way the steps do
 *      (getByRole name + filter hasText). This is what catches a regex that
 *      Playwright cannot embed in a selector - such a locator does not throw
 *      where the bot uses it, it just never becomes visible.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { LANGUAGES, re, strip, words } from '../src/i18n.js';

let passed = 0;
const check = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`✔ ${name}`);
  } catch (err) {
    console.error(`✖ ${name}\n   ${err.message.split('\n').join('\n   ')}`);
    process.exitCode = 1;
  }
};

/* ------------------------- 1. regex semantics ------------------------ */

const loose = (key) => re(key, { exact: false });

await check('"disable" wording is never read as "enable" (es/pt/fr/de/it)', () => {
  for (const w of words('disableActions')) {
    assert.ok(!loose('enableActions').test(w), `"${w}" matched enableActions`);
    assert.ok(loose('disableActions').test(w), `"${w}" did not match disableActions`);
  }
});

await check('"enable" wording is never read as "disable"', () => {
  for (const w of words('enableActions')) {
    assert.ok(!loose('disableActions').test(w), `"${w}" matched disableActions`);
  }
});

await check('"Install" is exact: not "Desinstalar", not "Instalado"', () => {
  for (const w of words('installed')) assert.ok(!re('install').test(w), `"${w}" matched install`);
  assert.ok(re('install').test('Instalar'));
  assert.ok(re('installed').test('Instalado'));
});

await check('accent- and case-insensitive', () => {
  assert.ok(loose('enableActions').test('ATIVAR ACOES'));
  assert.ok(loose('enableActions').test('Ativar ações'));
  assert.ok(re('skills').test('fähigkeiten'));
  assert.ok(re('skills').test('COMPÉTENCES'));
});

await check('straight and curly apostrophes both match', () => {
  assert.ok(re('understand').test("J'ai compris"));
  assert.ok(re('understand').test('J’ai compris'));
  assert.ok(loose('signInRejected').test('Couldn’t sign you in'));
});

await check('strip() leaves just the connector name', () => {
  const s = (t) => strip(t, 'enableActions', 'disableActions').trim();
  assert.equal(s('Gmail Deshabilitar acciones'), 'Gmail');
  assert.equal(s('Google Drive Ativar ações'), 'Google Drive');
  // Row text is often glued together with no space before the button text.
  assert.equal(s('Google DriveHabilitar acciones'), 'Google Drive');
  assert.equal(s('GmailDeshabilitar acciones'), 'Gmail');
  assert.equal(s('Google CalendarDesativar ações'), 'Google Calendar');
  assert.equal(s('GmailEnable actions'), 'Gmail');
});

/* --------------------- 2. every wording, in a browser ---------------- */

const KEYS = [
  'next', 'understand', 'getStarted', 'sources', 'enableActions', 'disableActions', 'home',
  'continue', 'selectAll', 'allow', 'allowLoose', 'skills', 'browseSkills', 'install', 'installed',
  'chooseAccount', 'signInRejected', 'challenge', 'challengeDetail', 'emailField', 'passwordField',
];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const html = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

for (const key of KEYS) {
  await check(`every "${key}" wording is locatable through Playwright`, async () => {
    const list = words(key);
    await page.setContent(`<!doctype html><meta charset="utf-8">${list.map((w) => `<button>${html(w)}</button>`).join('')}`);

    // Exactly how the steps use it. A selector Playwright cannot parse throws here.
    const byRole = await page.getByRole('button', { name: re(key) }).count();
    const byRoleLoose = await page.getByRole('button', { name: loose(key) }).count();
    const byText = await page.locator('button').filter({ hasText: loose(key) }).count();
    const getByText = await page.getByText(loose(key)).count();

    assert.equal(byRole, list.length, `getByRole(exact) found ${byRole}/${list.length}`);
    assert.equal(byRoleLoose, list.length, `getByRole(loose) found ${byRoleLoose}/${list.length}`);
    assert.equal(byText, list.length, `filter(hasText) found ${byText}/${list.length}`);
    assert.ok(getByText >= 1, 'getByText found nothing');

    // ...and through .first().isVisible(), which is what firstVisible() calls.
    // This is the path that broke with a "u"-flag regex: chaining appends
    // " >> nth=0" to a selector Playwright had embedded unescaped. count()
    // alone does not exercise it.
    for (const [how, loc] of [
      ['getByRole(exact)', page.getByRole('button', { name: re(key) })],
      ['getByRole(loose)', page.getByRole('button', { name: loose(key) })],
      ['filter(hasText)', page.locator('button').filter({ hasText: loose(key) })],
      ['getByText', page.getByText(loose(key))],
    ]) {
      assert.ok(await loc.first().isVisible(), `${how}.first() is not visible`);
    }
  });
}

await check('in a browser, "Deshabilitar acciones" is not an "enable" button', async () => {
  await page.setContent(
    '<!doctype html><meta charset="utf-8"><button>Deshabilitar acciones</button><button>Habilitar acciones</button><button>Desativar ações</button>',
  );
  const enable = await page.locator('button').filter({ hasText: loose('enableActions') }).allTextContents();
  assert.deepEqual(enable, ['Habilitar acciones']);
});

await browser.close();

console.log(`\n${passed} check(s) passed · languages: ${LANGUAGES.join(', ')}`);
