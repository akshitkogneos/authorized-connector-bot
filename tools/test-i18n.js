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
import { LANGUAGES, connectorMatcher, connectorNames, re, strip, words } from '../src/i18n.js';

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

await check('"disable" wording is never read as "enable" (es/pt/fr/de/it/ko)', () => {
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
  // Korean rows, as read from a live account ("Calendar 작업 사용 설정").
  assert.equal(s('Calendar 작업 사용 설정'), 'Calendar');
  assert.equal(s('Drive작업 사용 설정'), 'Drive');
  assert.equal(s('Gmail 작업 사용 중지'), 'Gmail');
  // Some rows (e.g. Chat) say "Authorize" instead of "Enable actions".
  assert.equal(s('ChatAuthorize'), 'Chat');
  assert.equal(s('Chat Authorize'), 'Chat');
});

await check('"Authorize" rows count as "enable", but "Authorized" does not', () => {
  assert.ok(loose('enableActions').test('Authorize'));
  assert.ok(loose('enableActions').test('Autorizar'));
  assert.ok(!loose('enableActions').test('Authorized'));
  assert.ok(!loose('disableActions').test('Authorize'));
});

/* ------------------------------ Korean ------------------------------ */

await check('Korean wordings stay precomposed (fold() must not leave jamo behind)', () => {
  // NFD turns "설치" into 6 jamo; a regex built from those never matches a page.
  assert.ok(re('install').test('설치'), 're("install") does not match "설치"');
  assert.ok(re('getStarted').test('시작하기'));
  assert.ok(re('sources').test('소스'));
  assert.ok(re('skills').test('스킬'));
  assert.ok(re('home').test('새 채팅'));
  assert.ok(loose('enableActions').test('작업 사용 설정'));
});

await check('Korean whole-word traps: "설치" is not "설치됨", enable is not disable', () => {
  assert.ok(!re('install').test('설치됨'));
  assert.ok(!re('install').test('설치 제거'));
  assert.ok(re('installed').test('설치됨'));
  assert.ok(!loose('enableActions').test('작업 사용 중지'));
  assert.ok(!loose('enableActions').test('작업 비활성화'));
  assert.ok(loose('disableActions').test('작업 사용 중지'));
  // The "Enable all connectors" switch row must never look like a connector button.
  assert.ok(!loose('enableActions').test('모든 커넥터 사용 설정'));
});

/* ---------------------- Simplified & Traditional Chinese ------------------ */

await check('Chinese wordings from a live zh-CN account match', () => {
  assert.ok(re('getStarted').test('开始'));
  assert.ok(re('home').test('新对话'));
  assert.ok(re('skills').test('技能'));
  assert.ok(re('install').test('安装'));
  assert.ok(loose('enableActions').test('启用操作'));
  assert.ok(loose('disableActions').test('停用操作'));
});

await check('Traditional Chinese (zh-TW / zh-HK) wordings match', () => {
  assert.ok(re('next').test('登入'));
  assert.ok(re('next').test('繼續'));
  assert.ok(re('understand').test('我瞭解'));
  assert.ok(re('getStarted').test('開始'));
  assert.ok(re('home').test('新對話'));
  assert.ok(re('sources').test('來源'));
  assert.ok(re('skills').test('技能'));
  assert.ok(re('browseSkills').test('瀏覽技能'));
  assert.ok(re('install').test('安裝'));
  assert.ok(re('allow').test('允許'));
  assert.ok(re('chooseAccount').test('選擇帳戶'));
  assert.ok(loose('enableActions').test('啟用動作'));
  assert.ok(loose('enableActions').test('啟用操作'));
  assert.ok(loose('disableActions').test('停用動作'));
  assert.ok(loose('disableActions').test('停用操作'));
});

await check('Chinese traps: "已安装"/"已安裝"/"解除安裝" are not install, "已授权"/"已授權"/"取消授權"/"解除授權" are not authorize, disable is not enable', () => {
  assert.ok(!re('install').test('已安装'));
  assert.ok(!re('install').test('已安裝'));
  assert.ok(!re('install').test('解除安裝'));
  assert.ok(!loose('install').test('已安裝'));
  assert.ok(!loose('install').test('解除安裝'));
  assert.ok(re('installed').test('已安装'));
  assert.ok(re('installed').test('已安裝'));
  assert.ok(re('installed').test('解除安裝'));
  assert.ok(!loose('enableActions').test('已授权'));
  assert.ok(!loose('enableActions').test('未授权'));
  assert.ok(!loose('enableActions').test('取消授权'));
  assert.ok(!loose('enableActions').test('已授權'));
  assert.ok(!loose('enableActions').test('未授權'));
  assert.ok(!loose('enableActions').test('取消授權'));
  assert.ok(!loose('enableActions').test('解除授權'));
  assert.ok(loose('enableActions').test('授权'));
  assert.ok(loose('enableActions').test('授權'));
  assert.ok(!loose('enableActions').test('停用操作'));
  assert.ok(!loose('enableActions').test('停用動作'));
  assert.ok(!loose('enableActions').test('启用所有连接器'));
  assert.ok(!loose('enableActions').test('啟用所有連接器'));
});

await check('strip() isolates Chinese connector names (Simplified & Traditional)', () => {
  const s = (t) => strip(t, 'enableActions', 'disableActions').trim();
  assert.equal(s('Google 云端硬盘启用操作'), 'Google 云端硬盘');
  assert.equal(s('Gmail 停用操作'), 'Gmail');
  assert.equal(s('Google 雲端硬碟啟用動作'), 'Google 雲端硬碟');
  assert.equal(s('Google 日曆 停用動作'), 'Google 日曆');
});

/* ---------------------------- connector picker ---------------------------- */

await check('connectorMatcher: catalog ids match every language, others are substrings', () => {
  assert.equal(connectorMatcher([]), null);
  assert.equal(connectorMatcher(null), null);
  const m = connectorMatcher(['drive', 'calendar']);
  for (const l of [
    'Drive', 'Google Drive', 'Google 云端硬盘', 'Google 雲端硬碟', '雲端硬碟', '드라이브',
    'Calendar', 'Google 日历', 'Google 日曆', '日曆', 'Google Agenda',
  ]) {
    assert.ok(m(l), `${l} should match`);
  }
  for (const l of ['Gmail', 'Chat', 'Google Chat', 'Google Search', 'Enable all connectors']) {
    assert.ok(!m(l), `${l} should not match`);
  }
  const chat = connectorMatcher(['chat']);
  assert.ok(chat('Chat') && chat('Google Chat'));
  assert.ok(!chat('Chatbot'), 'whole-word: "Chat" is not "Chatbot"');
  const custom = connectorMatcher(['jira']);
  assert.ok(custom('Atlassian Jira') && !custom('Gmail'));
  assert.deepEqual(connectorNames(['gmail', 'Jira']), ['Gmail', 'Jira']);
});

/* --------------------- 2. every wording, in a browser ---------------- */

const KEYS = [
  'next', 'understand', 'getStarted', 'sources', 'enableActions', 'disableActions', 'home', 'close',
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

await check('in a browser, only "작업 사용 설정" is a Korean "enable" button', async () => {
  await page.setContent(
    '<!doctype html><meta charset="utf-8"><button>모든 커넥터 사용 설정</button><button>작업 사용 중지</button><button>작업 사용 설정</button>',
  );
  const enable = await page.locator('button').filter({ hasText: loose('enableActions') }).allTextContents();
  assert.deepEqual(enable, ['작업 사용 설정']);
});

await check('in a browser, only "啟用動作" and "授權" are Traditional Chinese "enable" buttons', async () => {
  await page.setContent(
    '<!doctype html><meta charset="utf-8"><button>啟用所有連接器</button><button>停用動作</button><button>已授權</button><button>取消授權</button><button>解除授權</button><button>啟用動作</button><button>授權</button>',
  );
  const enable = await page.locator('button').filter({ hasText: loose('enableActions') }).allTextContents();
  assert.deepEqual(enable, ['啟用動作', '授權']);
});

await browser.close();

console.log(`\n${passed} check(s) passed · languages: ${LANGUAGES.join(', ')}`);
